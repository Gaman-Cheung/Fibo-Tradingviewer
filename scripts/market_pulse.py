"""Pure FIBO Market Pulse v1 breadth calculations.

This module accepts already-loaded official market rows and never accesses
BaoStock, Supabase, the browser, Pool identity or Terminal calculations.

The four locked groups are Participation, Trend Breadth, Expansion and
Leadership. Strong Up uses the shared +5% boundary; MA60 Breakout is paired
with its mirror Breakdown. Broad confirmation includes CNI 2000.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from statistics import median
from typing import Iterable


ALGORITHM_VERSION = 1
INDEX_UNIVERSE_VERSION = 2
HISTORY_SESSIONS = 60
MIN_VALID_CLOSES = 62
MIN_PUBLISH_COVERAGE = 0.95
STRONG_RETURN_PCT = 5.0
MA_RISING_THRESHOLD = 0.0001
BALANCE_FLOOR_SHARE = 0.05

BROAD_INDICES = (
    ("SH", "000300", "CSI 300"),
    ("SH", "000905", "CSI 500"),
    ("SH", "000852", "CSI 1000"),
    ("SZ", "399303", "CNI 2000"),
)


class PulseCoverageError(ValueError):
    """Raised when an official-date Pulse snapshot is not publishable."""


def _finite(value, fallback=None):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if number == number and abs(number) != float("inf") else fallback


def _traded(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "t", "yes"}


def _key(market, code) -> str:
    return f"{str(market).upper()}:{str(code)}"


def _mean(values: Iterable[float]) -> float:
    materialized = list(values)
    return sum(materialized) / len(materialized) if materialized else 0.0


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return min(high, max(low, value))


def balance_score(positive: float, negative: float, eligible: float) -> float:
    """Return the v1 confidence-dampened 0..100 positive/negative balance."""
    positive = max(0.0, float(positive))
    negative = max(0.0, float(negative))
    eligible = max(0.0, float(eligible))
    denominator = max(positive + negative, BALANCE_FLOOR_SHARE * eligible)
    if denominator <= 0:
        return 50.0
    return clamp(50.0 + 50.0 * (positive - negative) / denominator)


def pulse_state(score: float) -> str:
    value = clamp(float(score))
    if value >= 80:
        return "Broad Strength"
    if value >= 60:
        return "Healthy Strength"
    if value >= 40:
        return "Mixed"
    if value >= 20:
        return "Weakening"
    return "Risk-Off"


@dataclass(frozen=True)
class PreparedPoint:
    trade_date: str
    value: float
    raw_close: float


@dataclass(frozen=True)
class PreparedSecurity:
    market: str
    code: str
    points: tuple[PreparedPoint, ...]
    date_index: dict[str, int]


def _continuous_values(rows: list[dict]) -> list[float]:
    values = [0.0] * len(rows)
    if not rows:
        return values
    values[-1] = float(rows[-1]["_close"])
    for index in range(len(rows) - 1, 0, -1):
        rate = _finite(rows[index].get("pct_chg", rows[index].get("pctChg")))
        if rate is not None and rate > -100:
            values[index - 1] = values[index] / (1.0 + rate / 100.0)
        else:
            current_raw = float(rows[index]["_close"])
            previous_raw = float(rows[index - 1]["_close"])
            values[index - 1] = values[index] * previous_raw / current_raw
    return values


def prepare_market_series(rows: Iterable[dict], *, continuous: bool) -> dict[str, PreparedSecurity]:
    """Prepare immutable per-symbol traded-close sequences without mutating input."""
    grouped: dict[str, list[dict]] = defaultdict(list)
    for source in rows:
        market = str(source.get("market", "")).upper()
        code = str(source.get("code", ""))
        trade_date = str(source.get("trade_date", source.get("tradeDate", "")))[:10]
        close = _finite(source.get("close"))
        if market not in {"SH", "SZ"} or len(code) != 6 or close is None or close <= 0:
            continue
        if not _traded(source.get("trade_status", source.get("tradeStatus", True))):
            continue
        grouped[_key(market, code)].append({**source, "_market": market, "_code": code,
                                            "_date": trade_date, "_close": close})

    prepared: dict[str, PreparedSecurity] = {}
    for symbol, symbol_rows in grouped.items():
        by_date = {row["_date"]: row for row in symbol_rows if row["_date"]}
        ordered = [by_date[value] for value in sorted(by_date)]
        values = _continuous_values(ordered) if continuous else [float(row["_close"]) for row in ordered]
        points = tuple(
            PreparedPoint(row["_date"], float(value), float(row["_close"]))
            for row, value in zip(ordered, values)
        )
        market, code = symbol.split(":", 1)
        prepared[symbol] = PreparedSecurity(
            market=market,
            code=code,
            points=points,
            date_index={point.trade_date: index for index, point in enumerate(points)},
        )
    return prepared


def _security_metrics(security: PreparedSecurity, trade_date: str) -> dict | None:
    end = security.date_index.get(trade_date)
    if end is None or end + 1 < MIN_VALID_CLOSES:
        return None
    points = security.points[:end + 1]
    values = [point.value for point in points]
    current, previous = values[-1], values[-2]
    ma20 = _mean(values[-20:])
    previous_ma20 = _mean(values[-21:-1])
    ma60 = _mean(values[-60:])
    previous_ma60 = _mean(values[-61:-1])
    return_1d = (current / previous - 1.0) * 100.0
    return_5d = (current / values[-6] - 1.0) * 100.0
    ma20_slope = ma20 / previous_ma20 - 1.0
    ma60_slope = ma60 / previous_ma60 - 1.0
    prior_20 = values[-21:-1]
    return {
        "close": points[-1].raw_close,
        "return_1d": return_1d,
        "return_5d": return_5d,
        "direction_1d": 1 if return_1d > 0 else -1 if return_1d < 0 else 0,
        "direction_5d": 1 if return_5d > 0 else -1 if return_5d < 0 else 0,
        "strong_up": return_1d >= STRONG_RETURN_PCT,
        "strong_down": return_1d <= -STRONG_RETURN_PCT,
        "above_ma20": current > ma20,
        "above_ma60": current > ma60,
        "ma20_rising": ma20_slope > MA_RISING_THRESHOLD,
        "ma60_rising": ma60_slope > MA_RISING_THRESHOLD,
        "new_high_20": current > max(prior_20),
        "new_low_20": current < min(prior_20),
        "ma60_breakout": previous <= previous_ma60 and current > ma60,
        "ma60_breakdown": previous >= previous_ma60 and current < ma60,
        "distance_ma20_pct": (current / ma20 - 1.0) * 100.0,
        "distance_ma60_pct": (current / ma60 - 1.0) * 100.0,
        "ma20_slope_pct": ma20_slope * 100.0,
        "ma60_slope_pct": ma60_slope * 100.0,
    }


def _member_row(security: PreparedSecurity, trade_date: str, metrics: dict, *, member_type: str,
                names: dict[str, str], theme_group: str = "") -> dict:
    return {
        "provider": "baostock",
        "trade_date": trade_date,
        "member_type": member_type,
        "market": security.market,
        "code": security.code,
        "name": str(names.get(_key(security.market, security.code)) or f"{security.market}.{security.code}"),
        "theme_group": theme_group,
        **metrics,
    }


def _stock_date_counts(rows: Iterable[dict]) -> dict[str, int]:
    symbols_by_date: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        market = str(row.get("market", "")).upper()
        code = str(row.get("code", ""))
        trade_date = str(row.get("trade_date", ""))[:10]
        close = _finite(row.get("close"))
        if market in {"SH", "SZ"} and len(code) == 6 and trade_date and close is not None and close > 0:
            symbols_by_date[trade_date].add(_key(market, code))
    return {trade_date: len(symbols) for trade_date, symbols in symbols_by_date.items()}


def stock_snapshot_coverage(counts: dict[str, int], trade_date: str) -> float:
    dates = sorted(value for value in counts if value < trade_date)
    previous_counts = [counts[value] for value in dates[-5:] if counts[value] > 0]
    current = counts.get(trade_date, 0)
    if not previous_counts:
        return 1.0 if current else 0.0
    expected = float(median(previous_counts))
    return clamp(current / expected, 0.0, 1.0) if expected else 0.0


def _participation(members: list[dict]) -> dict:
    eligible = len(members)
    up_1d = sum(row["direction_1d"] > 0 for row in members)
    up_5d = sum(row["direction_5d"] > 0 for row in members)
    strong_up = sum(row["strong_up"] for row in members)
    strong_down = sum(row["strong_down"] for row in members)
    up_1d_pct = 100.0 * up_1d / eligible if eligible else 0.0
    up_5d_pct = 100.0 * up_5d / eligible if eligible else 0.0
    strong_balance = balance_score(strong_up, strong_down, eligible)
    return {
        "score": _mean((up_1d_pct, up_5d_pct, strong_balance)),
        "eligible": eligible,
        "up_1d_count": up_1d,
        "up_1d_pct": up_1d_pct,
        "up_5d_count": up_5d,
        "up_5d_pct": up_5d_pct,
        "median_return_1d_pct": median([row["return_1d"] for row in members]) if members else 0.0,
        "strong_up_count": strong_up,
        "strong_down_count": strong_down,
        "strong_balance": strong_balance,
    }


def _trend_breadth(members: list[dict]) -> dict:
    eligible = len(members)
    def count_and_pct(field):
        count = sum(bool(row[field]) for row in members)
        return count, 100.0 * count / eligible if eligible else 0.0
    above20, above20_pct = count_and_pct("above_ma20")
    above60, above60_pct = count_and_pct("above_ma60")
    rising20, rising20_pct = count_and_pct("ma20_rising")
    rising60, rising60_pct = count_and_pct("ma60_rising")
    return {
        "score": _mean((above20_pct, above60_pct, rising20_pct, rising60_pct)),
        "eligible": eligible,
        "above_ma20_count": above20,
        "above_ma20_pct": above20_pct,
        "above_ma60_count": above60,
        "above_ma60_pct": above60_pct,
        "ma20_rising_count": rising20,
        "ma20_rising_pct": rising20_pct,
        "ma60_rising_count": rising60,
        "ma60_rising_pct": rising60_pct,
    }


def _expansion(members: list[dict]) -> dict:
    eligible = len(members)
    high = sum(row["new_high_20"] for row in members)
    low = sum(row["new_low_20"] for row in members)
    breakout = sum(row["ma60_breakout"] for row in members)
    breakdown = sum(row["ma60_breakdown"] for row in members)
    high_low_balance = balance_score(high, low, eligible)
    bo_bd_balance = balance_score(breakout, breakdown, eligible)
    return {
        "score": _mean((high_low_balance, bo_bd_balance)),
        "eligible": eligible,
        "new_high_20_count": high,
        "new_low_20_count": low,
        "net_new_high": high - low,
        "high_low_balance": high_low_balance,
        "ma60_breakout_count": breakout,
        "ma60_breakdown_count": breakdown,
        "bo_bd_balance": bo_bd_balance,
    }


def _catalog_lookup(index_catalog: Iterable[dict]) -> dict[str, dict]:
    return {_key(row.get("market"), row.get("code")): dict(row) for row in index_catalog}


def _leadership(index_series: dict[str, PreparedSecurity], index_catalog: list[dict], trade_date: str,
                names: dict[str, str]) -> tuple[dict, list[dict], float]:
    catalog = _catalog_lookup(index_catalog)
    expected = {
        symbol for symbol, row in catalog.items()
        if row.get("active", True) and row.get("radar_enabled")
        and str(row.get("category", "")) in {"sector", "theme"}
    }
    grouped: dict[str, list[tuple[PreparedSecurity, dict, dict]]] = defaultdict(list)
    member_rows: list[dict] = []
    for symbol in sorted(expected):
        security = index_series.get(symbol)
        metrics = _security_metrics(security, trade_date) if security else None
        if not metrics:
            continue
        row = catalog[symbol]
        theme = str(row.get("theme_group") or symbol)
        display_names = {**names, symbol: str(row.get("name") or names.get(symbol) or symbol)}
        member = _member_row(security, trade_date, metrics, member_type="sector_index",
                             names=display_names, theme_group=theme)
        member_rows.append(member)
        grouped[theme].append((security, metrics, row))

    eligible_index_count = sum(len(values) for values in grouped.values())
    coverage = eligible_index_count / len(expected) if expected else 0.0
    theme_count = len(grouped)
    weighted_above = weighted_rising = weighted_high = weighted_low = 0.0
    for values in grouped.values():
        weight = 1.0 / len(values)
        weighted_above += sum(weight for _, metrics, _ in values if metrics["above_ma60"])
        weighted_rising += sum(weight for _, metrics, _ in values if metrics["ma60_rising"])
        weighted_high += sum(weight for _, metrics, _ in values if metrics["new_high_20"])
        weighted_low += sum(weight for _, metrics, _ in values if metrics["new_low_20"])
    theme_above_pct = 100.0 * weighted_above / theme_count if theme_count else 0.0
    theme_rising_pct = 100.0 * weighted_rising / theme_count if theme_count else 0.0
    theme_expansion = balance_score(weighted_high, weighted_low, theme_count)

    broad_details = []
    for market, code, label in BROAD_INDICES:
        symbol = _key(market, code)
        security = index_series.get(symbol)
        metrics = _security_metrics(security, trade_date) if security else None
        if not metrics:
            raise PulseCoverageError(f"Missing 62-session broad index {market}.{code} on {trade_date}.")
        row = catalog.get(symbol, {})
        display_names = {**names, symbol: str(row.get("name") or names.get(symbol) or label)}
        member_rows.append(_member_row(security, trade_date, metrics, member_type="broad_index",
                                       names=display_names))
        confirmation = 50.0 * int(metrics["above_ma60"]) + 50.0 * int(metrics["ma60_rising"])
        broad_details.append({
            "market": market,
            "code": code,
            "name": display_names[symbol],
            "above_ma60": metrics["above_ma60"],
            "ma60_rising": metrics["ma60_rising"],
            "confirmation": confirmation,
        })
    broad_confirmation = _mean(item["confirmation"] for item in broad_details)
    score = _mean((theme_above_pct, theme_rising_pct, theme_expansion, broad_confirmation))
    return ({
        "score": score,
        "eligible_index_count": eligible_index_count,
        "expected_index_count": len(expected),
        "theme_count": theme_count,
        "theme_above_ma60_pct": theme_above_pct,
        "theme_ma60_rising_pct": theme_rising_pct,
        "theme_new_high_weight": weighted_high,
        "theme_new_low_weight": weighted_low,
        "theme_high_low_balance": theme_expansion,
        "broad_confirmation_pct": broad_confirmation,
        "broad_confirmed_count": sum(item["confirmation"] == 100 for item in broad_details),
        "broad_indices": broad_details,
    }, member_rows, coverage)


def build_market_pulse_history(stock_rows: list[dict], index_rows: list[dict], index_catalog: list[dict],
                               snapshot_dates: Iterable[str], *, names: dict[str, str] | None = None,
                               member_dates: Iterable[str] = (), enforce_coverage: bool = True
                               ) -> tuple[list[dict], dict[str, list[dict]]]:
    """Build ordered aggregate snapshots and optional latest member rows."""
    stock_input = [dict(row) for row in stock_rows]
    index_input = [dict(row) for row in index_rows]
    dates = sorted(dict.fromkeys(str(value)[:10] for value in snapshot_dates if value))
    member_date_set = set(str(value)[:10] for value in member_dates)
    names = dict(names or {})
    stock_series = prepare_market_series(stock_input, continuous=True)
    index_series = prepare_market_series(index_input, continuous=False)
    counts = _stock_date_counts(stock_input)
    snapshots: list[dict] = []
    members_by_date: dict[str, list[dict]] = {}

    for trade_date in dates:
        stock_members = []
        for security in stock_series.values():
            metrics = _security_metrics(security, trade_date)
            if metrics:
                stock_members.append(_member_row(security, trade_date, metrics, member_type="stock", names=names))
        participation = _participation(stock_members)
        trend = _trend_breadth(stock_members)
        expansion = _expansion(stock_members)
        leadership, index_members, index_coverage = _leadership(
            index_series, index_catalog, trade_date, names
        )
        stock_coverage = stock_snapshot_coverage(counts, trade_date)
        if enforce_coverage and stock_coverage < MIN_PUBLISH_COVERAGE:
            raise PulseCoverageError(
                f"A-share coverage {stock_coverage:.2%} is below {MIN_PUBLISH_COVERAGE:.0%} on {trade_date}."
            )
        if enforce_coverage and index_coverage < MIN_PUBLISH_COVERAGE:
            raise PulseCoverageError(
                f"Sector/theme coverage {index_coverage:.2%} is below {MIN_PUBLISH_COVERAGE:.0%} on {trade_date}."
            )
        score = _mean((participation["score"], trend["score"], expansion["score"], leadership["score"]))
        snapshots.append({
            "provider": "baostock",
            "trade_date": trade_date,
            "algorithm_version": ALGORITHM_VERSION,
            "index_universe_version": INDEX_UNIVERSE_VERSION,
            "pulse_score": score,
            "pulse_state": pulse_state(score),
            "stock_eligible_count": len(stock_members),
            "index_eligible_count": leadership["eligible_index_count"],
            "stock_coverage": stock_coverage,
            "index_coverage": index_coverage,
            "participation": participation,
            "trend_breadth": trend,
            "expansion": expansion,
            "leadership": leadership,
        })
        if trade_date in member_date_set:
            members_by_date[trade_date] = stock_members + index_members
    return snapshots, members_by_date
