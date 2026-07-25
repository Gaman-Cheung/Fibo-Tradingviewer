import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch
from zoneinfo import ZoneInfo

import scripts.sync_baostock as sync_module
from scripts.sync_baostock import (
    chunks,
    completed_market_date,
    normalize_daily_rows,
    parse_args,
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


if __name__ == "__main__":
    unittest.main()
