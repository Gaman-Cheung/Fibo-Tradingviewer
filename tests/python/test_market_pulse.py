import copy
import unittest
from datetime import date, timedelta

from scripts.market_pulse import (
    BROAD_INDICES,
    MIN_VALID_CLOSES,
    _security_metrics,
    balance_score,
    build_market_pulse_history,
    prepare_market_series,
    pulse_state,
    stock_snapshot_coverage,
)


def dates(count=70):
    start = date(2026, 1, 1)
    return [(start + timedelta(days=index)).isoformat() for index in range(count)]


def rows_for(market, code, values, trade_dates, *, traded=True):
    rows = []
    for index, (trade_date, close) in enumerate(zip(trade_dates, values)):
        pct = 0 if index == 0 else (close / values[index - 1] - 1) * 100
        rows.append({
            "market": market,
            "code": code,
            "trade_date": trade_date,
            "close": close,
            "pct_chg": pct,
            "trade_status": traded,
        })
    return rows


def broad_rows(trade_dates):
    output = []
    for offset, (market, code, _) in enumerate(BROAD_INDICES):
        output.extend(rows_for(market, code, [100 + offset + index for index in range(len(trade_dates))], trade_dates))
    return output


class MarketPulseTests(unittest.TestCase):
    def test_balance_floor_and_state_boundaries_are_exact(self):
        self.assertEqual(balance_score(1, 0, 100), 60)
        self.assertEqual(balance_score(5, 0, 100), 100)
        self.assertEqual(balance_score(0, 0, 100), 50)
        self.assertEqual(balance_score(0, 5, 100), 0)
        self.assertEqual(pulse_state(19.999), "Risk-Off")
        self.assertEqual(pulse_state(20), "Weakening")
        self.assertEqual(pulse_state(40), "Mixed")
        self.assertEqual(pulse_state(60), "Healthy Strength")
        self.assertEqual(pulse_state(80), "Broad Strength")

    def test_continuous_preparation_anchors_returns_and_never_mutates_input(self):
        trade_dates = dates(3)
        source = rows_for("SH", "600000", [10, 5.5, 6.05], trade_dates)
        source[1]["pct_chg"] = 10
        source[2]["pct_chg"] = 10
        original = copy.deepcopy(source)
        prepared = prepare_market_series(source, continuous=True)["SH:600000"]
        self.assertAlmostEqual(prepared.points[0].value, 5)
        self.assertAlmostEqual(prepared.points[1].value, 5.5)
        self.assertAlmostEqual(prepared.points[2].value, 6.05)
        self.assertEqual(source, original)

    def test_snapshot_calculates_strong_crosses_and_all_four_groups(self):
        trade_dates = dates(MIN_VALID_CLOSES)
        stock_rows = []
        stock_rows += rows_for("SH", "600001", [100] * (MIN_VALID_CLOSES - 1) + [105], trade_dates)
        stock_rows += rows_for("SZ", "000001", [100] * (MIN_VALID_CLOSES - 1) + [94], trade_dates)
        sector = rows_for("SH", "000039", [100 + index for index in range(MIN_VALID_CLOSES)], trade_dates)
        index_rows = broad_rows(trade_dates) + sector
        catalog = [{
            "market": "SH", "code": "000039", "name": "Information Technology",
            "category": "sector", "theme_group": "technology", "radar_enabled": True, "active": True,
        }]
        snapshots, members = build_market_pulse_history(
            stock_rows, index_rows, catalog, [trade_dates[-1]],
            member_dates=[trade_dates[-1]], enforce_coverage=False,
        )
        snapshot = snapshots[0]
        self.assertEqual(snapshot["algorithm_version"], 1)
        self.assertEqual(snapshot["stock_eligible_count"], 2)
        self.assertEqual(snapshot["participation"]["strong_up_count"], 1)
        self.assertEqual(snapshot["participation"]["strong_down_count"], 1)
        self.assertEqual(snapshot["expansion"]["ma60_breakout_count"], 1)
        self.assertEqual(snapshot["expansion"]["ma60_breakdown_count"], 1)
        self.assertEqual(snapshot["leadership"]["broad_confirmation_pct"], 100)
        self.assertEqual(snapshot["leadership"]["broad_confirmed_count"], 4)
        self.assertEqual(len(members[trade_dates[-1]]), 2 + 1 + 4)
        self.assertTrue(0 <= snapshot["pulse_score"] <= 100)

    def test_strict_metric_boundaries_keep_unchanged_and_exact_ma_slope_neutral(self):
        trade_dates = dates(MIN_VALID_CLOSES)

        def metrics(values):
            prepared = prepare_market_series(
                rows_for("SH", "600001", values, trade_dates), continuous=False
            )["SH:600001"]
            return _security_metrics(prepared, trade_dates[-1])

        unchanged = metrics([100] * MIN_VALID_CLOSES)
        self.assertEqual(unchanged["direction_1d"], 0)
        self.assertEqual(unchanged["direction_5d"], 0)
        self.assertFalse(unchanged["new_high_20"])
        self.assertFalse(unchanged["new_low_20"])
        self.assertFalse(unchanged["ma20_rising"])
        self.assertFalse(unchanged["ma60_rising"])

        exact_slope = metrics([100] * (MIN_VALID_CLOSES - 1) + [100.6])
        self.assertFalse(exact_slope["ma60_rising"])
        above_slope = metrics([100] * (MIN_VALID_CLOSES - 1) + [100.601])
        self.assertTrue(above_slope["ma60_rising"])

        exact_up = metrics([100] * (MIN_VALID_CLOSES - 1) + [105])
        exact_down = metrics([100] * (MIN_VALID_CLOSES - 1) + [95])
        self.assertTrue(exact_up["strong_up"])
        self.assertTrue(exact_up["new_high_20"])
        self.assertTrue(exact_down["strong_down"])
        self.assertTrue(exact_down["new_low_20"])

    def test_st_member_is_included_while_short_and_halted_latest_rows_are_excluded(self):
        trade_dates = dates(MIN_VALID_CLOSES)
        stock_rows = rows_for("SH", "600001", [100 + index for index in range(MIN_VALID_CLOSES)], trade_dates)
        stock_rows += rows_for("SH", "600002", [100] * (MIN_VALID_CLOSES - 1), trade_dates[:-1])
        halted = rows_for("SZ", "000001", [100] * MIN_VALID_CLOSES, trade_dates)
        halted[-1]["trade_status"] = False
        stock_rows += halted
        index_rows = broad_rows(trade_dates)
        index_rows += rows_for("SH", "000039", [100 + index for index in range(MIN_VALID_CLOSES)], trade_dates)
        catalog = [{
            "market":"SH","code":"000039","name":"Technology","category":"sector",
            "theme_group":"technology","radar_enabled":True,"active":True,
        }]
        original = copy.deepcopy((stock_rows, index_rows, catalog))
        snapshots, members = build_market_pulse_history(
            stock_rows, index_rows, catalog, [trade_dates[-1]],
            names={"SH:600001":"*ST Sample"}, member_dates=[trade_dates[-1]], enforce_coverage=False,
        )
        stock_members = [row for row in members[trade_dates[-1]] if row["member_type"] == "stock"]
        self.assertEqual(snapshots[0]["stock_eligible_count"], 1)
        self.assertEqual([(row["code"], row["name"]) for row in stock_members], [("600001", "*ST Sample")])
        self.assertEqual((stock_rows, index_rows, catalog), original)

    def test_theme_group_weighting_prevents_duplicate_indices_from_dominating(self):
        trade_dates = dates(MIN_VALID_CLOSES)
        stock_rows = rows_for("SH", "600001", [100 + index for index in range(MIN_VALID_CLOSES)], trade_dates)
        index_rows = broad_rows(trade_dates)
        index_rows += rows_for("SH", "000039", [100 + index for index in range(MIN_VALID_CLOSES)], trade_dates)
        index_rows += rows_for("SH", "000040", [200 - index for index in range(MIN_VALID_CLOSES)], trade_dates)
        index_rows += rows_for("SH", "000041", [100 + index for index in range(MIN_VALID_CLOSES)], trade_dates)
        catalog = [
            {"market":"SH","code":"000039","name":"A1","category":"sector","theme_group":"a","radar_enabled":True,"active":True},
            {"market":"SH","code":"000040","name":"A2","category":"sector","theme_group":"a","radar_enabled":True,"active":True},
            {"market":"SH","code":"000041","name":"B1","category":"theme","theme_group":"b","radar_enabled":True,"active":True},
        ]
        snapshots, _ = build_market_pulse_history(
            stock_rows, index_rows, catalog, [trade_dates[-1]], enforce_coverage=False
        )
        leadership = snapshots[0]["leadership"]
        self.assertEqual(leadership["theme_count"], 2)
        self.assertAlmostEqual(leadership["theme_above_ma60_pct"], 75)
        self.assertAlmostEqual(leadership["theme_ma60_rising_pct"], 75)

    def test_stock_coverage_uses_previous_five_session_median(self):
        counts = {f"2026-01-{day:02d}": 100 for day in range(1, 6)}
        counts["2026-01-06"] = 94
        self.assertAlmostEqual(stock_snapshot_coverage(counts, "2026-01-06"), 0.94)
        counts["2026-01-06"] = 105
        self.assertEqual(stock_snapshot_coverage(counts, "2026-01-06"), 1)


if __name__ == "__main__":
    unittest.main()
