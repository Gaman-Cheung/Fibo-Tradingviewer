import unittest
from datetime import date, timedelta

from scripts.etf_catalog_seed_v2 import ETF_CATALOG_SEED_V2
from scripts.etf_radar import (
    CROSS_ASSET_SCOPE,
    EQUITY_SCOPE,
    MIN_AVERAGE_AMOUNT_20D,
    build_etf_snapshot,
    classify_etf,
    normalize_etf_universe,
    prepare_etf_histories,
    select_etf_leaders,
    select_liquid_theme_representatives,
)
from scripts.index_radar import symbol_key


def history_rows(market, code, closes, amount, start=date(2026, 1, 1)):
    rows = []
    previous = None
    for index, close in enumerate(closes):
        pct = 0 if previous is None else (close / previous - 1) * 100
        rows.append({
            "market": market,
            "code": code,
            "trade_date": (start + timedelta(days=index)).isoformat(),
            "close": close,
            "pct_chg": pct,
            "trade_status": True,
            "amount": amount,
        })
        previous = close
    return rows


def scored_item(code, score, theme, category="overseas"):
    return {
        "market": "SH",
        "code": code,
        "name": code,
        "category": category,
        "themeGroup": theme,
        "themeLabel": theme,
        "score": score,
        "qualifies": True,
        "metrics": {"rs20": score / 10, "rs5": score / 20, "close": 110, "ma60": 100},
        "events": [],
        "risks": [],
    }


class EtfRadarTests(unittest.TestCase):
    def test_seed_is_code_keyed_and_unknown_names_are_never_guessed(self):
        self.assertEqual(len(ETF_CATALOG_SEED_V2), 1615)
        known = classify_etf("SH", "510300", "anything")
        self.assertEqual((known["radar_scope"], known["theme_group"]), (EQUITY_SCOPE, "csi300"))
        unknown = classify_etf("SH", "599999", "Gold Semiconductor ETF")
        self.assertEqual(unknown, {
            "category": "other", "radar_scope": None, "theme_group": "",
            "theme_label": "", "radar_enabled": False,
        })
        catalog = normalize_etf_universe([
            {"code": "sh.510300", "code_name": "CSI 300", "tradestatus": "1"},
            {"code": "sh.599999", "code_name": "Gold Semiconductor ETF", "tradestatus": "1"},
        ])
        self.assertTrue(catalog[0]["radar_enabled"])
        self.assertFalse(catalog[1]["radar_enabled"])

    def test_continuous_series_is_anchored_to_latest_official_close(self):
        rows = [
            {"market": "SH", "code": "510300", "trade_date": "2026-01-01", "close": 10, "pct_chg": 0, "trade_status": True, "amount": 1},
            {"market": "SH", "code": "510300", "trade_date": "2026-01-02", "close": 5.5, "pct_chg": 10, "trade_status": True, "amount": 2},
            {"market": "SH", "code": "510300", "trade_date": "2026-01-03", "close": 6.05, "pct_chg": 10, "trade_status": True, "amount": 3},
        ]
        series = prepare_etf_histories(rows)[symbol_key("SH", "510300")]
        self.assertEqual(series["rawCloses"], [10, 5.5, 6.05])
        self.assertAlmostEqual(series["closes"][0], 5)
        self.assertAlmostEqual(series["closes"][1], 5.5)
        self.assertAlmostEqual(series["closes"][2], 6.05)

    def test_highest_20d_amount_is_the_only_theme_representative(self):
        closes = [100 + index * 0.1 for index in range(70)]
        rows = (
            history_rows("SH", "510300", closes, 30_000_000)
            + history_rows("SH", "510310", closes, 50_000_000)
            + history_rows("SH", "510500", closes, 19_000_000)
        )
        histories = prepare_etf_histories(rows)
        catalog = [
            {"market": "SH", "code": "510300", "theme_group": "csi300", "radar_scope": EQUITY_SCOPE, "radar_enabled": True, "active": True},
            {"market": "SH", "code": "510310", "theme_group": "csi300", "radar_scope": EQUITY_SCOPE, "radar_enabled": True, "active": True},
            {"market": "SH", "code": "510500", "theme_group": "csi500", "radar_scope": EQUITY_SCOPE, "radar_enabled": True, "active": True},
        ]
        trade_date = rows[69]["trade_date"]
        representatives, coverage, themes = select_liquid_theme_representatives(catalog, histories, trade_date, EQUITY_SCOPE)
        self.assertEqual(themes, 2)
        self.assertEqual(coverage, 1)
        self.assertEqual([(row["code"], average) for row, average in representatives], [("510310", 50_000_000)])
        self.assertGreater(MIN_AVERAGE_AMOUNT_20D, 19_000_000)

    def test_newer_liquidity_winner_never_falls_back_to_an_older_second_etf(self):
        long_closes=[100+index*.1 for index in range(70)]
        short_closes=[100+index*.2 for index in range(30)]
        rows=(
            history_rows("SH","510300",long_closes,30_000_000)
            + history_rows("SH","510310",short_closes,80_000_000,start=date(2026,2,10))
        )
        histories=prepare_etf_histories(rows)
        catalog=[
            {"market":"SH","code":"510300","theme_group":"csi300","radar_scope":EQUITY_SCOPE,"radar_enabled":True,"active":True},
            {"market":"SH","code":"510310","theme_group":"csi300","radar_scope":EQUITY_SCOPE,"radar_enabled":True,"active":True},
        ]
        trade_date=rows[-1]["trade_date"]
        representatives,coverage,themes=select_liquid_theme_representatives(
            catalog,histories,trade_date,EQUITY_SCOPE
        )
        self.assertEqual(themes,1)
        self.assertEqual(representatives,[])
        self.assertEqual(coverage,0)

    def test_cross_asset_cap_is_applied_after_strict_theme_dedup(self):
        scored = [
            scored_item("510001", 100, "us1", "overseas"),
            scored_item("510002", 99, "us2", "overseas"),
            scored_item("510003", 98, "us3", "overseas"),
            scored_item("510004", 97, "gold", "commodity"),
            scored_item("510005", 96, "bond1", "bond"),
            scored_item("510006", 95, "cash", "money"),
        ]
        leaders = select_etf_leaders(scored, CROSS_ASSET_SCOPE)
        self.assertEqual(len(leaders), 5)
        self.assertEqual(sum(item["category"] == "overseas" for item in leaders), 2)
        self.assertNotIn("510003", {item["code"] for item in leaders})

    def test_stability_buffer_cannot_create_a_third_cross_asset_category_card(self):
        scored = [
            scored_item("510001",100,"us1","overseas"),
            scored_item("510002",99,"us2","overseas"),
            scored_item("510003",98,"gold","commodity"),
            scored_item("510004",97,"bond","bond"),
            scored_item("510005",96,"cash","money"),
            scored_item("510006",95,"us3","overseas"),
        ]
        yesterday={"trade_date":"2026-07-29","leaders":[{
            "market":"SH","code":"510006","themeGroup":"us3","category":"overseas",
        }]}
        leaders=select_etf_leaders(scored,CROSS_ASSET_SCOPE,[yesterday])
        self.assertNotIn("510006",{item["code"] for item in leaders})
        self.assertEqual(sum(item["category"]=="overseas" for item in leaders),2)

    def test_theme_continuity_survives_representative_change(self):
        yesterday = {
            "scope": EQUITY_SCOPE,
            "trade_date": "2026-07-29",
            "leaders": [{"market": "SH", "code": "510300", "themeGroup": "csi300"}],
        }
        replacement = scored_item("510310", 90, "csi300", "equity_broad")
        leaders = select_etf_leaders([replacement], EQUITY_SCOPE, [yesterday])
        self.assertEqual(leaders[0]["code"], "510310")
        self.assertEqual(leaders[0]["appearances"]["consecutive"], 2)

    def test_snapshot_reuses_index_v1_rs20_score_and_quality_gate(self):
        benchmark = history_rows("SH", "000300", [100 + index * 0.02 for index in range(90)], 0)
        etf = history_rows("SH", "510300", [100 + index * 0.4 for index in range(90)], 60_000_000)
        histories = prepare_etf_histories(
            benchmark + etf,
            {symbol_key("SH", "510300")},
        )
        catalog = [{
            "market":"SH","code":"510300","name":"CSI 300 ETF","category":"equity_broad",
            "theme_group":"csi300","theme_label":"CSI 300","radar_scope":EQUITY_SCOPE,
            "radar_enabled":True,"active":True,
        }]
        trade_date=etf[-1]["trade_date"]
        snapshot=build_etf_snapshot(catalog,histories,trade_date,EQUITY_SCOPE)
        self.assertIsNotNone(snapshot)
        self.assertEqual(snapshot["scope"], EQUITY_SCOPE)
        self.assertEqual(len(snapshot["leaders"]), 1)
        leader=snapshot["leaders"][0]
        self.assertGreater(leader["metrics"]["rs20"], 0)
        self.assertEqual(leader["scoreBreakdown"]["rs5"], 25)
        self.assertEqual(leader["scoreBreakdown"]["rs20"], 30)
        self.assertGreaterEqual(leader["score"], 60)
        self.assertEqual(leader["averageAmount20D"], 60_000_000)

    def test_snapshot_rejects_scope_when_theme_data_coverage_is_below_95_percent(self):
        benchmark = history_rows("SH", "000300", [100 + index * 0.02 for index in range(90)], 0)
        etf = history_rows("SH", "510300", [100 + index * 0.4 for index in range(90)], 60_000_000)
        histories = prepare_etf_histories(benchmark + etf,{symbol_key("SH", "510300")})
        catalog = [
            {
                "market":"SH","code":"510300","name":"CSI 300 ETF","category":"equity_broad",
                "theme_group":"csi300","theme_label":"CSI 300","radar_scope":EQUITY_SCOPE,
                "radar_enabled":True,"active":True,
            },
            {
                "market":"SH","code":"510500","name":"Missing ETF","category":"equity_broad",
                "theme_group":"csi500","theme_label":"CSI 500","radar_scope":EQUITY_SCOPE,
                "radar_enabled":True,"active":True,"history_from":"2026-01-01",
            },
        ]
        self.assertIsNone(build_etf_snapshot(catalog,histories,etf[-1]["trade_date"],EQUITY_SCOPE))


if __name__ == "__main__":
    unittest.main()
