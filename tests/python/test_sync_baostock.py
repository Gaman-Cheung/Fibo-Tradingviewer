import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch
from zoneinfo import ZoneInfo

import scripts.sync_baostock as sync_module
from scripts.sync_baostock import (
    ETF_RETENTION_SESSIONS,
    SupabaseRest,
    _is_skippable_etf_leading_gap,
    _etf_target_dates,
    chunks,
    completed_market_date,
    normalize_daily_rows,
    normalize_etf_rows,
    parse_args,
    publish_etf_radar_snapshots,
    reconstruct_front_adjusted,
    run_sync,
    sync_one_date,
)


class FakeClient:
    def __init__(self, dates=None, daily_rows=None):
        self.dates = dates or ["2026-01-02","2026-01-05","2026-01-06"]
        self.daily_rows = daily_rows or []
    def trading_dates(self, start, end):
        return list(self.dates)
    def daily_a_shares(self, trade_date):
        return list(self.daily_rows)


class FakeDb:
    def __init__(self, checkpoint=None):
        self.checkpoint = dict(checkpoint or {})
        self.saved = []
        self.uploaded = []
        self.pruned = []
    def get_checkpoint(self):
        return dict(self.checkpoint)
    def save_checkpoint(self, **values):
        self.saved.append(values)
        self.checkpoint.update(values)
    def upsert_daily_rows(self, rows):
        self.uploaded.extend(rows)
    def prune_before(self, cutoff):
        self.pruned.append(cutoff)


class FakeEtfClient:
    def __init__(self, rows_by_date):
        self.rows_by_date = rows_by_date
        self.requested_dates = []

    def daily_etfs(self, trade_date):
        self.requested_dates.append(trade_date)
        return list(self.rows_by_date.get(trade_date, []))


class FakeEtfDb:
    def __init__(self, catalog, checkpoint=None):
        self.catalog = catalog
        self.checkpoint = dict(checkpoint or {})
        self.saved = []
        self.uploaded = []
        self.pruned = []
        self.snapshots = []

    def get_checkpoint(self, scope):
        return dict(self.checkpoint)

    def save_checkpoint(self, scope, **values):
        self.saved.append((scope, values))
        self.checkpoint.update(values)

    def get_etf_catalog(self):
        return self.catalog

    def upsert_etf_catalog(self, rows):
        return None

    def upsert_daily_rows(self, rows):
        self.uploaded.extend(rows)

    def get_etf_radar_snapshots(self, scope, limit=30, before=None):
        return []

    def load_etf_history(self, catalog, start_date):
        return []

    def upsert_etf_radar_snapshots(self, rows):
        self.snapshots.extend(rows)

    def delete_etf_radar_snapshot_dates(self, scope, trade_dates):
        return None

    def prune_etf_radar_snapshots_before(self, scope, cutoff):
        return None

    def prune_etf_before(self, cutoff, catalog):
        self.pruned.append(cutoff)


class SyncBaoStockTests(unittest.TestCase):
    def test_daily_normalization_keeps_only_valid_sh_sz_rows(self):
        rows = normalize_daily_rows([
            {"date":"2026-02-05","code":"sh.600000","close":"10.2300","pctChg":"0.9872","tradestatus":"1"},
            {"date":"2026-02-05","code":"sz.000001","close":"11.0","pctChg":"","tradestatus":"0"},
            {"date":"2026-02-05","code":"bj.430001","close":"3.0","pctChg":"1","tradestatus":"1"},
            {"date":"2026-02-05","code":"sh.bad","close":"3.0","pctChg":"1","tradestatus":"1"},
        ], "2026-02-05T11:00:00Z")
        self.assertEqual([(row["market"],row["code"]) for row in rows], [("SH","600000"),("SZ","000001")])
        self.assertTrue(rows[0]["trade_status"])
        self.assertFalse(rows[1]["trade_status"])
        self.assertIsNone(rows[1]["pct_chg"])

    def test_reconstruction_anchors_latest_raw_close(self):
        raw = [
            {"close":"10", "pctChg":"0"},
            {"close":"5.5", "pctChg":"10"},
            {"close":"6.05", "pctChg":"10"},
        ]
        adjusted = reconstruct_front_adjusted(raw)
        self.assertAlmostEqual(adjusted[0], 5)
        self.assertAlmostEqual(adjusted[1], 5.5)
        self.assertAlmostEqual(adjusted[2], 6.05)

    def test_completed_date_waits_until_after_close(self):
        zone = ZoneInfo("Asia/Shanghai")
        self.assertEqual(str(completed_market_date(datetime(2026,7,24,17,59,tzinfo=zone))), "2026-07-23")
        self.assertEqual(str(completed_market_date(datetime(2026,7,24,18,0,tzinfo=zone))), "2026-07-24")

    def test_chunks_and_cli_modes_are_deterministic(self):
        self.assertEqual([len(batch) for batch in chunks(list(range(7)),3)], [3,3,1])
        self.assertEqual(parse_args(["--mode","backfill"]).mode, "backfill")
        self.assertEqual(parse_args(["--mode","repair","--start","2026-01-01","--end","2026-01-02"]).end, "2026-01-02")
        etf_args = parse_args(["--mode","backfill","--dataset","etfs"])
        self.assertEqual(etf_args.etf_sessions, ETF_RETENTION_SESSIONS)
        self.assertEqual(etf_args.dataset, "etfs")

    def test_backfill_resumes_after_checkpoint_and_prunes_only_after_success(self):
        client = FakeClient()
        db = FakeDb({"backfill_cursor":"2026-01-05","latest_trade_date":"2026-01-05"})
        args = SimpleNamespace(mode="backfill",sessions=3,start=None,end=None)
        with patch.object(sync_module,"sync_one_date",return_value=5200) as fetch:
            run_sync(args,client,db)
        fetch.assert_called_once_with(client,db,"2026-01-06")
        self.assertEqual(db.checkpoint["backfill_cursor"],"2026-01-06")
        self.assertEqual(db.pruned,["2026-01-02"])

    def test_abnormal_snapshot_never_uploads(self):
        client = FakeClient(daily_rows=[
            {"date":"2026-01-06","code":"sh.600000","close":"10","pctChg":"1","tradestatus":"1"}
        ])
        db = FakeDb()
        with self.assertRaisesRegex(RuntimeError,"only 1 valid"):
            sync_one_date(client,db,"2026-01-06")
        self.assertEqual(db.uploaded,[])

    def test_etf_normalization_keeps_amount_and_discards_persistent_high_low(self):
        persistent, transient = normalize_etf_rows([
            {
                "date":"2026-01-06","code":"sh.510300","high":"4.2","low":"4.0",
                "close":"4.1","pctChg":"1.25","tradestatus":"1","amount":"25000000",
            },
            {"date":"2026-01-06","code":"bj.510300","close":"4","amount":"1"},
        ], "2026-01-06T11:00:00Z")
        self.assertEqual(len(persistent), 1)
        self.assertEqual(persistent[0]["amount"], 25_000_000)
        self.assertNotIn("high", persistent[0])
        self.assertEqual(transient["SH:510300"]["2026-01-06"]["low"], 4.0)

    def test_etf_daily_refetches_five_sessions_and_backfill_resumes(self):
        dates = [f"2026-01-{day:02d}" for day in range(1, 11)]
        client = FakeClient(dates=dates)
        daily = SimpleNamespace(mode="daily", start=None, end=None)
        self.assertEqual(_etf_target_dates(daily, client, dates, datetime.now().date(), {}), dates[-5:])
        backfill = SimpleNamespace(mode="backfill", start=None, end=None)
        self.assertEqual(
            _etf_target_dates(backfill, client, dates, datetime.now().date(), {"backfill_cursor":dates[5]}),
            dates[6:],
        )

    def test_etf_leading_gap_policy_never_hides_partial_or_mid_sequence_data(self):
        self.assertTrue(_is_skippable_etf_leading_gap("backfill", "2025-12-24", [], None))
        self.assertTrue(_is_skippable_etf_leading_gap("backfill", "2025-12-24", [], "2026-01-05"))
        self.assertFalse(_is_skippable_etf_leading_gap("backfill", "2026-01-06", [], "2026-01-05"))
        self.assertFalse(_is_skippable_etf_leading_gap("daily", "2025-12-24", [], None))
        self.assertFalse(
            _is_skippable_etf_leading_gap(
                "backfill",
                "2025-12-24",
                [{"date":"2025-12-24","code":"broken"}],
                None,
            )
        )

    def test_etf_backfill_skips_only_empty_provider_prefix_and_records_real_start(self):
        dates = ["2025-12-24", "2025-12-25", "2025-12-26"]

        def row(trade_date):
            return {
                "date":trade_date, "code":"sh.510300", "high":"4.1", "low":"3.9",
                "close":"4", "pctChg":"0", "tradestatus":"1", "amount":"30000000",
            }

        rows_by_date = {dates[0]: [], dates[1]: [row(dates[1])], dates[2]: [row(dates[2])]}
        client = FakeEtfClient(rows_by_date)
        catalog = [{
            "provider":"baostock", "market":"SH", "code":"510300", "name":"CSI 300 ETF",
            "category":"equity_broad", "radar_scope":"EQUITY_ETF", "theme_group":"csi300",
            "short_label":"CSI 300", "radar_enabled":True, "active":True,
            "universe_version":1, "history_from":None, "latest_trade_date":None,
        }]
        db = FakeEtfDb(catalog)
        args = SimpleNamespace(mode="backfill", etf_sessions=144, start=None, end=None)

        def snapshots(catalog_rows, market_rows, snapshot_dates, scope, **kwargs):
            return [{"trade_date":snapshot_dates[-1], "scope":scope, "leaders":[]}]

        with (
            patch.object(sync_module, "recent_trading_dates", return_value=dates),
            patch.object(sync_module, "discover_etf_catalog", return_value=(catalog, rows_by_date[dates[-1]])),
            patch.object(sync_module, "MIN_ETF_DAILY_ROWS", 1),
            patch.object(sync_module, "build_etf_historical_snapshots", side_effect=snapshots),
        ):
            sync_module._run_etf_sync(args, client, db)

        cursors = [values.get("backfill_cursor") for _, values in db.saved if values.get("backfill_cursor")]
        self.assertEqual(cursors, dates)
        self.assertEqual(len(db.uploaded), 2)
        self.assertEqual(db.checkpoint["oldest_trade_date"], dates[1])
        self.assertEqual(db.checkpoint["retention_sessions"], 144)
        self.assertEqual(db.pruned, [dates[0]])

    def test_etf_backfill_still_fails_on_empty_date_after_coverage_begins(self):
        dates = ["2026-01-05", "2026-01-06", "2026-01-07"]

        def row(trade_date):
            return {
                "date":trade_date, "code":"sh.510300", "close":"4", "pctChg":"0",
                "tradestatus":"1", "amount":"30000000",
            }

        rows_by_date = {dates[0]: [row(dates[0])], dates[1]: [], dates[2]: [row(dates[2])]}
        client = FakeEtfClient(rows_by_date)
        catalog = [{
            "provider":"baostock", "market":"SH", "code":"510300", "history_from":None,
            "latest_trade_date":None, "radar_enabled":True, "active":True,
        }]
        db = FakeEtfDb(catalog)
        args = SimpleNamespace(mode="backfill", etf_sessions=144, start=None, end=None)

        with (
            patch.object(sync_module, "recent_trading_dates", return_value=dates),
            patch.object(sync_module, "discover_etf_catalog", return_value=(catalog, rows_by_date[dates[-1]])),
            patch.object(sync_module, "MIN_ETF_DAILY_ROWS", 1),
        ):
            with self.assertRaisesRegex(RuntimeError, "returned only 0 valid ETF rows"):
                sync_module._run_etf_sync(args, client, db)

        self.assertEqual(db.checkpoint["backfill_cursor"], dates[0])
        self.assertEqual(len(db.uploaded), 1)
        self.assertEqual(db.pruned, [])

    def test_etf_retention_delete_is_scoped_to_catalog_codes(self):
        db = SupabaseRest.__new__(SupabaseRest)
        db.headers = {}
        calls = []
        db._request = lambda method, path, **kwargs: calls.append((method, path, kwargs))
        catalog = [
            {"market":"SH","code":"510300"},
            {"market":"SH","code":"510500"},
            {"market":"SZ","code":"159915"},
        ]
        db.prune_etf_before("2026-01-01", catalog)
        self.assertEqual(len(calls), 2)
        self.assertTrue(all(call[1] == "market_daily_bar" for call in calls))
        self.assertTrue(all(call[2]["params"]["trade_date"] == "lt.2026-01-01" for call in calls))
        self.assertTrue(all("code" in call[2]["params"] and "market" in call[2]["params"] for call in calls))

    def test_etf_catalog_read_paginates_beyond_supabase_default_limit(self):
        class Response:
            def __init__(self, rows):
                self.rows = rows

            def json(self):
                return self.rows

        db = SupabaseRest.__new__(SupabaseRest)
        db.headers = {}
        pages = [
            [{"market":"SH","code":f"{index:06d}"} for index in range(1000)],
            [{"market":"SZ","code":f"{index:06d}"} for index in range(615)],
        ]
        calls = []

        def request(method, path, **kwargs):
            calls.append((method, path, kwargs["params"]))
            return Response(pages[len(calls) - 1])

        db._request = request
        rows = db.get_etf_catalog()
        self.assertEqual(len(rows), 1615)
        self.assertEqual([call[2]["offset"] for call in calls], ["0", "1000"])
        self.assertTrue(all(call[2]["limit"] == "1000" for call in calls))

    def test_universe_publication_upgrades_inactive_catalog_rows_missing_from_daily_discovery(self):
        class IndexClient:
            def all_securities(self, trade_date):
                return [{"code":"sh.000300", "code_name":"沪深300", "tradeStatus":"1"}]

        class IndexDb:
            def __init__(self):
                self.rows = [{
                    "provider":"baostock", "market":"SH", "code":"000039",
                    "name":"上证信息", "category":"other", "theme_group":"",
                    "theme_label":"", "radar_enabled":False, "active":False,
                    "universe_version":1,
                }]
                self.upserted = []

            def get_index_catalog(self):
                return list(self.rows)

            def upsert_index_catalog(self, rows):
                self.upserted = list(rows)

        index_db = IndexDb()
        with patch.object(sync_module, "MIN_INDEX_COUNT", 1):
            sync_module.discover_index_catalog(IndexClient(), index_db, "2026-07-30")
        inactive_index = next(row for row in index_db.upserted if row["code"] == "000039")
        self.assertFalse(inactive_index["active"])
        self.assertEqual(inactive_index["universe_version"], 2)
        self.assertEqual((inactive_index["category"], inactive_index["theme_group"]),
                         ("sector", "information_technology"))

        class EtfClient:
            def all_securities(self, trade_date):
                return []

        class EtfDb:
            def __init__(self):
                self.rows = [{
                    "provider":"baostock", "market":"SH", "code":"518600",
                    "name":"黄金ETF", "category":"other", "radar_scope":None,
                    "theme_group":"", "theme_label":"", "radar_enabled":False,
                    "active":False, "universe_version":1,
                }]
                self.upserted = []

            def get_etf_catalog(self):
                return list(self.rows)

            def upsert_etf_catalog(self, rows):
                self.upserted = list(rows)

        etf_db = EtfDb()
        raw = [{"code":"sh.510300", "close":"4", "amount":"30000000", "tradestatus":"1"}]
        with patch.object(sync_module, "MIN_ETF_DAILY_ROWS", 1):
            sync_module.discover_etf_catalog(EtfClient(), etf_db, "2026-07-30", raw)
        inactive_etf = next(row for row in etf_db.upserted if row["code"] == "518600")
        self.assertFalse(inactive_etf["active"])
        self.assertEqual(inactive_etf["universe_version"], 2)
        self.assertEqual(
            (inactive_etf["category"], inactive_etf["radar_scope"], inactive_etf["theme_group"]),
            ("commodity", "CROSS_ASSET", "gold"),
        )

    def test_etf_snapshot_upload_failure_never_deletes_prior_scope_history(self):
        class FailingDb:
            def __init__(self):
                self.calls=[]
            def upsert_etf_radar_snapshots(self,rows):
                self.calls.append("upsert")
                raise RuntimeError("upload failed")
            def delete_etf_radar_snapshot_dates(self,scope,dates):
                self.calls.append("delete")
            def prune_etf_radar_snapshots_before(self,scope,cutoff):
                self.calls.append("prune")
        db=FailingDb()
        with self.assertRaisesRegex(RuntimeError,"upload failed"):
            publish_etf_radar_snapshots(
                db,"EQUITY_ETF",
                [{"trade_date":"2026-01-02","scope":"EQUITY_ETF","leaders":[]}],
                ["2026-01-01","2026-01-02"],
                "2026-01-01",
            )
        self.assertEqual(db.calls,["upsert"])


if __name__ == "__main__":
    unittest.main()
