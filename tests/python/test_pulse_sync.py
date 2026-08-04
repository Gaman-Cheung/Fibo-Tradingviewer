import unittest
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import scripts.sync_baostock as sync


class PulseClient:
    def all_securities(self, trade_date):
        return [{"code":"sh.600000","code_name":"Pudong Bank"}]


class PulseDb:
    def __init__(self, *, verified=True, mismatch=False):
        self.verified = verified
        self.mismatch = mismatch
        self.calls = []
        self.checkpoints = {
            "CN_A":{"last_status":"ok","latest_trade_date":"2026-08-03"},
            "CN_INDEX":{"last_status":"ok","latest_trade_date":"2026-08-03"},
            "CN_PULSE":{},
        }
        self.published = []

    def get_checkpoint(self, scope="CN_A"):
        return dict(self.checkpoints.get(scope, {}))

    def save_checkpoint(self, scope="CN_A", **values):
        self.calls.append(("checkpoint", scope, values.get("last_status")))
        self.checkpoints.setdefault(scope, {}).update(values)

    def get_index_catalog(self):
        return [{"market":"SH","code":"000039","category":"sector","theme_group":"technology","radar_enabled":True,"active":True,"universe_version":2}]

    def get_etf_catalog(self):
        return [{"market":"SH","code":"510300"}]

    def load_pulse_market_rows(self, start_date, end_date):
        return [
            {"market":"SH","code":"600000","trade_date":"2026-08-02","close":9.9},
            {"market":"SH","code":"600000","trade_date":end_date,"close":10},
            {"market":"SH","code":"000039","trade_date":end_date,"close":100},
            {"market":"SH","code":"510300","trade_date":end_date,"close":4},
        ]

    def upsert_pulse_members(self, rows):
        self.calls.append(("members", len(rows)))
        self.member_rows = rows

    def count_pulse_members(self, trade_date, calculation_id):
        return len(self.member_rows) - int(self.mismatch)

    def upsert_pulse_snapshots(self, rows):
        self.calls.append(("snapshots", len(rows)))
        self.published = [dict(row) for row in rows]

    def get_pulse_snapshots(self, limit=60):
        return self.published[-limit:]

    def get_pulse_snapshots_for_dates(self, trade_dates):
        requested=set(trade_dates)
        return [row for row in self.published if row["trade_date"] in requested]

    def prune_pulse_snapshots_before(self, cutoff):
        self.calls.append(("prune_snapshots", cutoff))

    def prune_pulse_members(self, rows):
        self.calls.append(("prune_members", len(rows)))


def built_payload(stock_rows, index_rows, catalog, dates, **kwargs):
    snapshots=[]
    members={}
    for trade_date in dates:
        snapshots.append({
            "provider":"baostock","trade_date":trade_date,"algorithm_version":1,
            "index_universe_version":2,"pulse_score":65,"pulse_state":"Healthy Strength",
            "stock_eligible_count":4200,"index_eligible_count":220,"stock_coverage":.99,"index_coverage":.98,
            "participation":{"score":60},"trend_breadth":{"score":70},
            "expansion":{"score":55},"leadership":{"score":75},
        })
        if trade_date in set(kwargs.get("member_dates", [])):
            members[trade_date]=[{
                "provider":"baostock","trade_date":trade_date,"member_type":"stock","market":"SH","code":"600000",
                "name":"Pudong Bank","theme_group":"","close":10,"return_1d":1,"return_5d":2,
                "direction_1d":1,"direction_5d":1,"strong_up":False,"strong_down":False,
                "above_ma20":True,"above_ma60":True,"ma20_rising":True,"ma60_rising":True,
                "new_high_20":False,"new_low_20":False,"ma60_breakout":False,"ma60_breakdown":False,
                "distance_ma20_pct":1,"distance_ma60_pct":2,"ma20_slope_pct":.1,"ma60_slope_pct":.1,
            }]
    return snapshots,members


class PulseSyncTests(unittest.TestCase):
    def test_backfill_uses_121_stored_sessions_to_rebuild_exactly_60_snapshots(self):
        calendar=[(date(2026,1,1)+timedelta(days=index)).isoformat() for index in range(130)]
        client=SimpleNamespace(trading_dates=lambda start,end:[value for value in calendar if value <= end.isoformat()])
        args=SimpleNamespace(mode="backfill",start=None,end=None)
        targets,history_start=sync._pulse_dates(args,client,calendar[-1])
        self.assertEqual(len(targets),60)
        self.assertEqual(targets,calendar[-60:])
        self.assertEqual(history_start,calendar[-121])

    def test_split_uses_complete_index_and_etf_catalogs(self):
        rows=[
            {"market":"SH","code":"600000"},
            {"market":"SH","code":"000039"},
            {"market":"SH","code":"510300"},
        ]
        stocks,indices=sync._split_pulse_rows(
            rows,[{"market":"SH","code":"000039"}],[{"market":"SH","code":"510300"}]
        )
        self.assertEqual([row["code"] for row in stocks],["600000"])
        self.assertEqual([row["code"] for row in indices],["000039"])

    def test_source_checkpoint_dates_must_match(self):
        db=PulseDb()
        db.checkpoints["CN_INDEX"]["latest_trade_date"]="2026-08-02"
        with self.assertRaisesRegex(RuntimeError,"dates differ"):
            sync._pulse_market_date(db)

    def test_member_verification_precedes_snapshot_and_cleanup(self):
        db=PulseDb()
        args=SimpleNamespace(mode="backfill",start=None,end=None)
        with (
            patch.object(sync,"_pulse_dates",return_value=(["2026-08-02","2026-08-03"],"2026-06-01")),
            patch.object(sync,"MIN_DAILY_ROWS",1),
            patch.object(sync,"build_market_pulse_history",side_effect=built_payload),
        ):
            sync.run_pulse_sync(args,PulseClient(),db)
        kinds=[call[0] for call in db.calls]
        self.assertLess(kinds.index("members"),kinds.index("snapshots"))
        self.assertLess(kinds.index("snapshots"),kinds.index("prune_members"))
        self.assertEqual(db.checkpoints["CN_PULSE"]["last_status"],"ok")
        self.assertEqual(db.checkpoints["CN_PULSE"]["retention_sessions"],60)
        self.assertTrue(all(row.get("calculation_id") for row in db.published))

    def test_failed_member_count_keeps_aggregate_and_cleanup_unpublished(self):
        db=PulseDb(mismatch=True)
        args=SimpleNamespace(mode="daily",start=None,end=None)
        with (
            patch.object(sync,"_pulse_dates",return_value=(["2026-08-03"],"2026-06-01")),
            patch.object(sync,"MIN_DAILY_ROWS",1),
            patch.object(sync,"build_market_pulse_history",side_effect=built_payload),
        ):
            with self.assertRaisesRegex(RuntimeError,"member verification failed"):
                sync.run_pulse_sync(args,PulseClient(),db)
        kinds=[call[0] for call in db.calls]
        self.assertNotIn("snapshots",kinds)
        self.assertNotIn("prune_members",kinds)
        self.assertEqual(db.checkpoints["CN_PULSE"]["last_status"],"error")

    def test_historical_repair_verifies_requested_date_without_rewinding_checkpoint(self):
        db=PulseDb()
        db.checkpoints["CN_PULSE"]={"latest_trade_date":"2026-08-03","backfill_cursor":"2026-08-03","last_row_count":4321}
        db.published=[{
            "provider":"baostock","trade_date":"2026-08-03","calculation_id":"existing-latest",
            "stock_eligible_count":4200,
        }]
        def merge_snapshots(rows):
            existing={row["trade_date"]:row for row in db.published}
            existing.update({row["trade_date"]:dict(row) for row in rows})
            db.calls.append(("snapshots",len(rows)))
            db.published=sorted(existing.values(),key=lambda row:row["trade_date"])
        db.upsert_pulse_snapshots=merge_snapshots
        args=SimpleNamespace(mode="repair",start="2026-08-02",end="2026-08-02")
        with (
            patch.object(sync,"_pulse_dates",return_value=(["2026-08-02"],"2026-06-01")),
            patch.object(sync,"MIN_DAILY_ROWS",1),
            patch.object(sync,"build_market_pulse_history",side_effect=built_payload),
        ):
            sync.run_pulse_sync(args,PulseClient(),db)
        self.assertEqual(db.checkpoints["CN_PULSE"]["latest_trade_date"],"2026-08-03")
        self.assertEqual(db.checkpoints["CN_PULSE"]["backfill_cursor"],"2026-08-03")
        self.assertEqual(db.checkpoints["CN_PULSE"]["last_row_count"],4321)
        self.assertEqual(db.published[-1]["trade_date"],"2026-08-03")

    def test_pulse_refuses_an_enabled_index_from_the_wrong_universe(self):
        db=PulseDb()
        db.get_index_catalog=lambda:[{
            "market":"SH","code":"000039","category":"sector","theme_group":"technology",
            "radar_enabled":True,"active":True,"universe_version":1,
        }]
        args=SimpleNamespace(mode="daily",start=None,end=None)
        with patch.object(sync,"_pulse_dates",return_value=(["2026-08-03"],"2026-06-01")):
            with self.assertRaisesRegex(RuntimeError,"Index Universe v2"):
                sync.run_pulse_sync(args,PulseClient(),db)
        self.assertEqual(db.checkpoints["CN_PULSE"]["last_status"],"error")

    def test_cli_accepts_pulse_without_changing_other_retention_defaults(self):
        args=sync.parse_args(["--mode","backfill","--dataset","pulse"])
        self.assertEqual(args.dataset,"pulse")
        self.assertEqual(args.sessions,400)
        self.assertEqual(args.etf_sessions,144)


if __name__ == "__main__":
    unittest.main()
