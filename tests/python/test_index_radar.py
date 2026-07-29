import unittest
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import scripts.sync_baostock as sync_module
from scripts.index_radar import (
    EVENT_POINTS,
    MIN_LEADER_SCORE,
    build_snapshot,
    calculate_candidate,
    classify_index,
    prepare_histories,
    score_candidates,
    select_leaders,
    symbol_key,
)
from scripts.index_catalog_seed_v1 import INDEX_CATALOG_SEED_V1
from scripts.sync_baostock import INDEX_SCOPE, normalize_index_rows, publish_radar_snapshots, run_index_sync


def dated_rows(market, code, closes, start=date(2026, 1, 1)):
    return [
        {
            "market": market,
            "code": code,
            "trade_date": (start + timedelta(days=index)).isoformat(),
            "close": close,
            "trade_status": True,
        }
        for index, close in enumerate(closes)
    ]


def candidate_item(code, score, group, *, rs20=1.0, qualifies=True):
    return {
        "market": "SH",
        "code": code,
        "name": code,
        "category": "theme",
        "themeGroup": group,
        "themeLabel": group,
        "score": score,
        "qualifies": qualifies,
        "metrics": {"rs20": rs20, "rs5": rs20, "close": 110, "ma60": 100},
        "events": [],
        "risks": [],
    }


class IndexRadarAlgorithmTests(unittest.TestCase):
    def test_classification_is_explicit_and_benchmark_never_enters_radar(self):
        self.assertEqual(len(INDEX_CATALOG_SEED_V1), 507)
        self.assertEqual(classify_index("SH", "000300", "沪深300")["category"], "broad")
        self.assertFalse(classify_index("SH", "000300", "沪深300")["radar_enabled"])
        computing = classify_index("SZ", "399363", "国证算力基础设施主题指数")
        self.assertEqual((computing["category"], computing["theme_group"]), ("theme", "ai_computing"))
        unknown = classify_index("SH", "009999", "未来未分类样本")
        self.assertEqual(unknown, {"category": "other", "theme_group": "", "theme_label": "", "radar_enabled": False})

    def test_events_use_official_closes_and_event_score_is_capped(self):
        dates = 90
        benchmark_closes = [100 + index * 0.01 for index in range(dates)]
        closes = [100.0] * 70 + [100 + (index - 69) * 0.3 for index in range(70, 87)] + [107, 112, 118]
        rows = dated_rows("SH", "000300", benchmark_closes) + dated_rows("SZ", "399812", closes)
        histories = prepare_histories(rows)
        trade_date = histories[symbol_key("SZ", "399812")]["dates"][-1]
        catalog = {"market": "SZ", "code": "399812", "name": "半导体", "category": "theme", "theme_group": "semiconductor"}
        result = calculate_candidate(
            histories[symbol_key("SZ", "399812")],
            histories[symbol_key("SH", "000300")],
            trade_date,
            catalog,
        )
        keys = {event["key"] for event in result["events"]}
        self.assertTrue({"high_20d_breakout", "relative_strength_new_high", "acceleration_3d", "persistent_advance", "streak_3d", "surge_1d"}.issubset(keys))
        self.assertGreater(sum(EVENT_POINTS[key] for key in keys if key in EVENT_POINTS), 15)
        self.assertEqual(result["eventScore"], 15)

    def test_retest_high_low_is_transient_and_addressed_by_symbol_and_date(self):
        raw = [
            {"date": "2026-07-27", "code": "sz.399812", "high": "105", "low": "95", "close": "102", "pctChg": "1", "tradestatus": "1"},
            {"date": "2026-07-28", "code": "sz.399812", "high": "108", "low": "99", "close": "106", "pctChg": "3.9", "tradestatus": "1"},
        ]
        persistent, transient = normalize_index_rows(raw, "2026-07-28T11:00:00Z")
        self.assertNotIn("high", persistent[0])
        self.assertNotIn("low", persistent[0])
        self.assertEqual(set(transient["SZ:399812"]), {"2026-07-27", "2026-07-28"})

    def test_extended_deducts_ten_and_breakdown_cannot_qualify(self):
        base = {
            "market": "SH", "code": "000032", "name": "能源", "category": "sector",
            "themeGroup": "energy", "themeLabel": "Energy", "events": [], "trendBreakdown": {},
            "eventScore": 0, "trendScore": 30, "breakdown": True,
            "riskPenalty": 10, "risks": [{"key": "extended", "label": "Extended", "penalty": 10}],
            "metrics": {"rs5": 8, "rs20": 10, "close": 120, "ma60": 100},
        }
        scored = score_candidates([base])[0]
        self.assertEqual(scored["scoreBreakdown"]["risk"], 10)
        self.assertFalse(scored["qualifies"])
        self.assertGreaterEqual(scored["score"], MIN_LEADER_SCORE)

    def test_theme_deduplication_allows_second_only_when_both_are_raw_top_five(self):
        scored = [
            candidate_item("000001", 100, "chips"),
            candidate_item("000002", 97, "chips"),
            candidate_item("000003", 96, "software"),
            candidate_item("000004", 95, "robotics"),
            candidate_item("000005", 94, "defense"),
            candidate_item("000006", 93, "chips"),
            candidate_item("000007", 92, "healthcare"),
        ]
        leaders = select_leaders(scored)
        chip_codes = [item["code"] for item in leaders if item["themeGroup"] == "chips"]
        self.assertEqual(chip_codes, ["000001", "000002"])
        self.assertNotIn("000006", chip_codes)
        self.assertLessEqual(len(leaders), 5)

    def test_stability_buffer_and_appearance_counts_use_final_prior_lists(self):
        scored = [candidate_item(f"00000{index}", 101 - index * 4, f"g{index}") for index in range(1, 7)]
        scored[-1]["score"] = 80
        yesterday = {"trade_date": "2026-07-28", "leaders": [{"market": "SH", "code": "000006"}]}
        prior = [
            {"trade_date": "2026-07-26", "leaders": [{"market": "SH", "code": "000006"}]},
            {"trade_date": "2026-07-27", "leaders": [{"market": "SH", "code": "000006"}]},
            yesterday,
        ]
        leaders = select_leaders(scored, prior)
        retained = next(item for item in leaders if item["code"] == "000006")
        self.assertEqual(retained["appearances"], {"consecutive": 4, "days15": 4, "days30": 4})
        self.assertEqual(len(leaders), 5)

    def test_recent_final_appearance_breaks_an_exact_score_tie_without_adding_points(self):
        newcomer = candidate_item("000010", 80, "new", rs20=9)
        recurring = candidate_item("000011", 80, "old", rs20=2)
        prior = [{"trade_date": "2026-07-28", "leaders": [{"market": "SH", "code": "000011"}]}]
        leaders = select_leaders([newcomer, recurring], prior)
        self.assertEqual([item["code"] for item in leaders], ["000011", "000010"])
        self.assertEqual([item["score"] for item in leaders], [80, 80])

    def test_coverage_below_95_percent_publishes_nothing(self):
        benchmark = dated_rows("SH", "000300", [100 + index * 0.1 for index in range(70)])
        histories = prepare_histories(benchmark)
        catalog = [
            {"market": "SH", "code": "000300", "name": "沪深300", "category": "broad", "theme_group": "", "radar_enabled": False, "active": True},
            {"market": "SZ", "code": "399812", "name": "半导体", "category": "theme", "theme_group": "chips", "radar_enabled": True, "active": True},
        ]
        self.assertIsNone(build_snapshot(catalog, histories, benchmark[-1]["trade_date"]))


class IndexSyncFailureTests(unittest.TestCase):
    def test_snapshot_upload_failure_never_deletes_the_prior_valid_board(self):
        class FailingDb:
            def __init__(self):
                self.calls = []

            def upsert_radar_snapshots(self, rows):
                self.calls.append("upsert")
                raise RuntimeError("upload failed")

            def delete_radar_snapshot_dates(self, dates):
                self.calls.append("delete")

            def prune_radar_snapshots_before(self, cutoff):
                self.calls.append("prune")

        db = FailingDb()
        with self.assertRaisesRegex(RuntimeError, "upload failed"):
            publish_radar_snapshots(
                db,
                [{"trade_date": "2026-07-28", "leaders": []}],
                ["2026-07-27", "2026-07-28"],
                "2026-01-01",
            )
        self.assertEqual(db.calls, ["upsert"])

    def test_snapshot_sequence_gap_is_rejected_before_upload(self):
        class FakeDb:
            def upsert_radar_snapshots(self, rows):
                raise AssertionError("must not upload a gapped sequence")

        with self.assertRaisesRegex(RuntimeError, "sequence has 1 gap"):
            publish_radar_snapshots(
                FakeDb(),
                [{"trade_date": "2026-07-26"}, {"trade_date": "2026-07-28"}],
                ["2026-07-26", "2026-07-27", "2026-07-28"],
                "2026-01-01",
            )

    def test_any_radar_publication_failure_marks_cn_index_error(self):
        class FakeDb:
            def __init__(self):
                self.saved = []

            def save_checkpoint(self, scope=sync_module.SCOPE, **values):
                self.saved.append((scope, values))

        db = FakeDb()
        args = SimpleNamespace(mode="daily", sessions=400)
        with patch.object(sync_module, "_run_index_sync", side_effect=RuntimeError("coverage failed")):
            with self.assertRaisesRegex(RuntimeError, "coverage failed"):
                run_index_sync(args, object(), db)
        self.assertEqual(db.saved[-1][0], INDEX_SCOPE)
        self.assertEqual(db.saved[-1][1]["last_status"], "error")
        self.assertIn("coverage failed", db.saved[-1][1]["last_error"])


if __name__ == "__main__":
    unittest.main()
