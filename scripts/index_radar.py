"""Pure BaoStock index-universe and Index Radar calculations.

Allowed dependencies: Python standard library only.
Forbidden dependencies: Supabase, HTTP, Pool/permanent IDs, browser state and
Terminal trading algorithms. The synchronization adapter supplies official
index rows and persists the returned JSON-compatible snapshots.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Iterable

try:
    from .index_catalog_seed_v2 import INDEX_CATALOG_SEED_V2
except ImportError:  # Direct import when scripts/ is on sys.path.
    from index_catalog_seed_v2 import INDEX_CATALOG_SEED_V2


ALGORITHM_VERSION = 1
UNIVERSE_VERSION = 2
BENCHMARK_MARKET = "SH"
BENCHMARK_CODE = "000300"
MIN_HISTORY_POINTS = 62
MIN_RADAR_COVERAGE = 0.95
MIN_LEADER_SCORE = 60.0
FLAT_SLOPE_PCT = 0.01


EVENT_POINTS = {
    "ma60_reclaim_confirmed": 9,
    "ma60_breakout": 8,
    "high_20d_breakout": 7,
    "relative_strength_new_high": 6,
    "ma60_turn_up": 6,
    "acceleration_3d": 5,
    "persistent_advance": 4,
    "streak_3d": 3,
    "surge_1d": 2,
}

EVENT_LABELS = {
    "ma60_reclaim_confirmed": "MA60 Reclaim Confirmed",
    "ma60_breakout": "MA60 Breakout",
    "high_20d_breakout": "20D High Breakout",
    "relative_strength_new_high": "Relative Strength New High",
    "ma60_turn_up": "MA60 Turn Up",
    "acceleration_3d": "3D Acceleration",
    "persistent_advance": "Persistent Advance",
    "streak_3d": "3-Day Streak",
    "surge_1d": "1D Surge",
    "ma60_retest": "MA60 Retest",
    "healthy_retest": "Healthy Retest",
    "near_ma60": "Near MA60",
}

RISK_LABELS = {
    "extended": "Extended",
    "ma60_breakdown": "MA60 Breakdown",
}


# These vocabularies document how the reviewed v1 seed was prepared. Runtime
# classification is code-keyed by INDEX_CATALOG_SEED_V2; future codes are not
# guessed from their names and remain explicitly disabled as OTHER.
BOND_WORDS = ("债", "国债", "企债", "公司债", "信用债", "转债", "票据")
FUND_WORDS = ("基金指数",)
STYLE_WORDS = ("成长", "价值", "红利", "低波", "等权", "基本面", "治理", "责任", "高贝塔")
BROAD_WORDS = (
    "综合指数", "A股指数", "B股指数", "上证50", "上证180", "上证380",
    "沪深300", "中证500", "中证800", "中证1000", "中证2000", "深证成指",
    "深证综指", "创业板指", "科创50", "中小板指", "全市场", "全指",
)

BROAD_CODES = {
    "SH:000001", "SH:000002", "SH:000003", "SH:000009", "SH:000010",
    "SH:000016", "SH:000017", "SH:000020", "SH:000043", "SH:000044",
    "SH:000045", "SH:000046", "SH:000047", "SH:000090", "SH:000300",
    "SH:000903", "SH:000905", "SH:000906", "SH:000985",
    "SZ:399001", "SZ:399002", "SZ:399003", "SZ:399004", "SZ:399005",
    "SZ:399006", "SZ:399008", "SZ:399009", "SZ:399100", "SZ:399101",
    "SZ:399102", "SZ:399106", "SZ:399107", "SZ:399300", "SZ:399303",
    "SZ:399330", "SZ:399333", "SZ:399344",
}


THEME_RULES = (
    ("semiconductor", "Semiconductor", "theme", ("半导体", "芯片", "集成电路")),
    ("ai_computing", "AI & Computing", "theme", ("人工智能", "算力", "云计算", "大数据", "数据产业")),
    ("software_security", "Software & Security", "sector", ("软件", "计算机", "信息安全", "网络安全")),
    ("communications", "Communications", "sector", ("通信", "电信", "5G", "物联网")),
    ("electronics", "Electronics", "sector", ("电子", "元器件", "光电子", "面板")),
    ("robotics", "Robotics", "theme", ("机器人", "工业母机", "自动化")),
    ("defense_aerospace", "Defense & Aerospace", "sector", ("军工", "国防", "航天", "航空", "低空")),
    ("solar", "Solar", "theme", ("光伏", "太阳能")),
    ("wind_power", "Wind Power", "theme", ("风电",)),
    ("battery_storage", "Battery & Storage", "theme", ("电池", "储能", "锂电")),
    ("new_energy_vehicle", "New Energy Vehicle", "theme", ("新能源车", "智能汽车", "车联网")),
    ("automotive", "Automotive", "sector", ("汽车",)),
    ("power_grid", "Power Grid", "theme", ("电网", "电力设备")),
    ("utilities", "Utilities", "sector", ("公用事业", "电力", "燃气", "水务")),
    ("new_energy", "New Energy", "theme", ("新能源", "清洁能源", "绿色能源")),
    ("coal", "Coal", "sector", ("煤炭",)),
    ("oil_gas", "Oil & Gas", "sector", ("石油", "油气", "能源行业")),
    ("metals", "Metals", "sector", ("有色", "金属", "钢铁", "稀土", "黄金", "铜", "铝")),
    ("chemicals_materials", "Chemicals & Materials", "sector", ("化工", "化学", "原材料", "新材料")),
    ("construction", "Construction", "sector", ("建筑", "建材", "基建", "工程")),
    ("real_estate", "Real Estate", "sector", ("地产", "房地产")),
    ("machinery_industrial", "Machinery & Industrial", "sector", ("机械", "工业", "装备制造", "智能制造")),
    ("transportation", "Transportation", "sector", ("交通", "交运", "运输", "物流", "港口", "机场", "航运")),
    ("banking", "Banking", "sector", ("银行",)),
    ("securities", "Securities", "sector", ("证券", "券商")),
    ("insurance", "Insurance", "sector", ("保险",)),
    ("finance", "Finance", "sector", ("金融",)),
    ("healthcare", "Healthcare", "sector", ("医药", "医疗", "卫生", "生物", "疫苗", "中药", "创新药")),
    ("food_beverage", "Food & Beverage", "sector", ("食品", "饮料", "白酒")),
    ("consumer", "Consumer", "sector", ("消费", "家电", "零售", "商业")),
    ("agriculture", "Agriculture", "sector", ("农业", "农林", "牧渔", "养殖", "种业")),
    ("media_gaming", "Media & Gaming", "sector", ("传媒", "游戏", "影视", "文化")),
    ("tourism", "Tourism", "sector", ("旅游", "酒店")),
    ("textile_apparel", "Textile & Apparel", "sector", ("纺织", "服装")),
    ("environmental", "Environmental", "theme", ("环保", "碳中和", "低碳", "生态")),
    ("internet", "Internet", "theme", ("互联网",)),
    ("quantum", "Quantum Technology", "theme", ("量子",)),
    ("satellite", "Satellite", "theme", ("卫星", "商业航天")),
    ("nuclear", "Nuclear Power", "theme", ("核电",)),
)


def symbol_key(market: str, code: str) -> str:
    return f"{str(market).upper()}:{str(code).strip()}"


def is_seeded_index(market: str, code: str) -> bool:
    return symbol_key(market, code) in INDEX_CATALOG_SEED_V2


def classify_index(market: str, code: str, name: str) -> dict:
    """Return an explicit category/theme result for every discovered index."""
    market = str(market).upper()
    code = str(code).strip()
    key = symbol_key(market, code)
    seeded = INDEX_CATALOG_SEED_V2.get(key)
    if seeded:
        _, category, theme_group, theme_label, radar_enabled = seeded
        return {
            "category": category,
            "theme_group": theme_group,
            "theme_label": theme_label,
            "radar_enabled": radar_enabled,
        }
    return {"category": "other", "theme_group": "", "theme_label": "", "radar_enabled": False}


def normalize_index_universe(rows: Iterable[dict]) -> list[dict]:
    """Keep BaoStock SH.000*/SZ.399* index codes and classify each one."""
    normalized: list[dict] = []
    for row in rows:
        raw = str(row.get("code", "")).strip().lower()
        if not (raw.startswith("sh.000") or raw.startswith("sz.399")):
            continue
        market, code = raw.split(".", 1)
        if len(code) != 6 or not code.isdigit():
            continue
        name = str(row.get("code_name", row.get("name", ""))).strip() or raw
        classification = classify_index(market, code, name)
        normalized.append({
            "provider": "baostock",
            "market": market.upper(),
            "code": code,
            "name": name,
            "category": classification["category"],
            "theme_group": classification["theme_group"],
            "theme_label": classification["theme_label"],
            "radar_enabled": classification["radar_enabled"],
            "active": str(row.get("tradeStatus", row.get("trade_status", "1"))) == "1",
            "universe_version": UNIVERSE_VERSION,
        })
    normalized.sort(key=lambda item: (item["market"], item["code"]))
    return normalized


def _truthy_status(value) -> bool:
    return value in (True, 1, "1", "true", "True", None, "")


def prepare_histories(rows: Iterable[dict]) -> dict[str, dict]:
    grouped: dict[str, dict[str, dict]] = defaultdict(dict)
    for row in rows:
        market = str(row.get("market", "")).upper()
        code = str(row.get("code", "")).strip()
        trade_date = str(row.get("trade_date", row.get("date", "")))[:10]
        try:
            close = float(row.get("close"))
        except (TypeError, ValueError):
            continue
        if market not in ("SH", "SZ") or len(code) != 6 or not trade_date or close <= 0:
            continue
        if not _truthy_status(row.get("trade_status", row.get("tradestatus"))):
            continue
        grouped[symbol_key(market, code)][trade_date] = {"date": trade_date, "close": close}

    prepared: dict[str, dict] = {}
    for key, by_date in grouped.items():
        ordered = [by_date[value] for value in sorted(by_date)]
        dates = [item["date"] for item in ordered]
        closes = [item["close"] for item in ordered]
        prefix = [0.0]
        for close in closes:
            prefix.append(prefix[-1] + close)
        prepared[key] = {
            "dates": dates,
            "closes": closes,
            "prefix": prefix,
            "index": {value: index for index, value in enumerate(dates)},
        }
    return prepared


def _ma(series: dict, index: int, period: int) -> float | None:
    if index + 1 < period:
        return None
    return (series["prefix"][index + 1] - series["prefix"][index + 1 - period]) / period


def _return_pct(series: dict, index: int, sessions: int) -> float | None:
    if index < sessions:
        return None
    start = series["closes"][index - sessions]
    if start <= 0:
        return None
    return (series["closes"][index] / start - 1) * 100


def _round(value, digits=4):
    return round(float(value), digits) if value is not None else None


def _event(key: str, points: int | None = None, kind: str = "signal") -> dict:
    return {
        "key": key,
        "label": EVENT_LABELS[key],
        "points": EVENT_POINTS.get(key, 0) if points is None else points,
        "kind": kind,
    }


def calculate_candidate(series: dict, benchmark: dict, trade_date: str, catalog: dict, intraday: dict | None = None) -> dict | None:
    index = series["index"].get(trade_date)
    benchmark_index = benchmark["index"].get(trade_date)
    if index is None or benchmark_index is None or index < MIN_HISTORY_POINTS - 1 or benchmark_index < 20:
        return None
    if series["dates"][index - 20] != benchmark["dates"][benchmark_index - 20]:
        return None

    close = series["closes"][index]
    previous_close = series["closes"][index - 1]
    ma20 = _ma(series, index, 20)
    ma20_previous = _ma(series, index - 1, 20)
    ma60 = _ma(series, index, 60)
    ma60_previous = _ma(series, index - 1, 60)
    ma60_previous2 = _ma(series, index - 2, 60)
    if None in (ma20, ma20_previous, ma60, ma60_previous, ma60_previous2):
        return None

    ret1 = _return_pct(series, index, 1)
    ret3 = _return_pct(series, index, 3)
    ret5 = _return_pct(series, index, 5)
    ret20 = _return_pct(series, index, 20)
    benchmark_ret5 = _return_pct(benchmark, benchmark_index, 5)
    benchmark_ret20 = _return_pct(benchmark, benchmark_index, 20)
    if None in (ret1, ret3, ret5, ret20, benchmark_ret5, benchmark_ret20):
        return None

    rs5 = ret5 - benchmark_ret5
    rs20 = ret20 - benchmark_ret20
    ma20_slope_pct = (ma20 - ma20_previous) / ma20_previous * 100
    ma60_slope_pct = (ma60 - ma60_previous) / ma60_previous * 100
    ma60_previous_slope_pct = (ma60_previous - ma60_previous2) / ma60_previous2 * 100
    distance_ma60_pct = (close / ma60 - 1) * 100

    previous_ma60 = ma60_previous
    close_two_days_ago = series["closes"][index - 2]
    ma60_two_days_ago = ma60_previous2
    breakdown = previous_close >= previous_ma60 and close < ma60
    events: list[dict] = []
    if close_two_days_ago <= ma60_two_days_ago and previous_close > previous_ma60 and close > ma60:
        events.append(_event("ma60_reclaim_confirmed"))
    if previous_close <= previous_ma60 and close > ma60:
        events.append(_event("ma60_breakout"))
    if close > max(series["closes"][index - 20:index]):
        events.append(_event("high_20d_breakout"))

    ratio_values: list[float] = []
    ratio_valid = True
    for offset in range(20, -1, -1):
        date_value = series["dates"][index - offset]
        other_index = benchmark["index"].get(date_value)
        if other_index is None or benchmark["closes"][other_index] <= 0:
            ratio_valid = False
            break
        ratio_values.append(series["closes"][index - offset] / benchmark["closes"][other_index])
    if ratio_valid and ratio_values[-1] > max(ratio_values[:-1]):
        events.append(_event("relative_strength_new_high"))
    if ma60_slope_pct > FLAT_SLOPE_PCT and ma60_previous_slope_pct <= FLAT_SLOPE_PCT:
        events.append(_event("ma60_turn_up"))
    if ret3 >= 5:
        events.append(_event("acceleration_3d"))
    positive_10d = sum(
        1 for cursor in range(index - 9, index + 1)
        if cursor > 0 and series["closes"][cursor] > series["closes"][cursor - 1]
    )
    if positive_10d >= 7:
        events.append(_event("persistent_advance"))
    if all(series["closes"][cursor] > series["closes"][cursor - 1] for cursor in range(index - 2, index + 1)):
        events.append(_event("streak_3d"))
    if ret1 >= 5:
        events.append(_event("surge_1d"))

    ma60_rising = ma60_slope_pct > FLAT_SLOPE_PCT
    above_history = 0
    for cursor in range(index - 14, index + 1):
        cursor_ma60 = _ma(series, cursor, 60)
        if cursor_ma60 is not None and series["closes"][cursor] > cursor_ma60:
            above_history += 1
    near_ma60 = abs(distance_ma60_pct) <= 0.8 and ma60_rising and rs20 > 0 and above_history >= 10
    if near_ma60:
        events.append(_event("near_ma60", 0, "context"))

    if intraday and str(intraday.get("date", ""))[:10] == trade_date:
        try:
            high = float(intraday.get("high"))
            low = float(intraday.get("low"))
        except (TypeError, ValueError):
            high = low = 0
        if low > 0 and low <= ma60 <= high:
            healthy = previous_close > previous_ma60 and close > ma60 and ma60_rising
            events.append(_event("healthy_retest" if healthy else "ma60_retest", 0, "context"))

    event_points_raw = sum(EVENT_POINTS.get(item["key"], 0) for item in events)
    event_score = min(15, event_points_raw)
    trend_above = 5 if close > ma60 else 0
    trend_ma60 = 10 if ma60_rising else 0
    alignment = close > ma20 > ma60 and ma20_slope_pct > FLAT_SLOPE_PCT and ma60_rising
    trend_alignment = 15 if alignment else 0
    risks: list[dict] = []
    risk_penalty = 0
    if distance_ma60_pct > 12:
        risks.append({"key": "extended", "label": RISK_LABELS["extended"], "penalty": 10})
        risk_penalty += 10
    if breakdown:
        risks.append({"key": "ma60_breakdown", "label": RISK_LABELS["ma60_breakdown"], "penalty": 0})

    return {
        "market": catalog["market"],
        "code": catalog["code"],
        "name": catalog["name"],
        "category": catalog["category"],
        "themeGroup": catalog["theme_group"],
        "themeLabel": catalog.get("theme_label", ""),
        "tradeDate": trade_date,
        "events": events,
        "risks": risks,
        "breakdown": breakdown,
        "eventPointsRaw": event_points_raw,
        "eventScore": event_score,
        "riskPenalty": risk_penalty,
        "trendScore": trend_above + trend_ma60 + trend_alignment,
        "trendBreakdown": {"aboveMA60": trend_above, "ma60Rising": trend_ma60, "alignment": trend_alignment},
        "metrics": {
            "close": _round(close),
            "return1D": _round(ret1),
            "return3D": _round(ret3),
            "return5D": _round(ret5),
            "return20D": _round(ret20),
            "benchmarkReturn5D": _round(benchmark_ret5),
            "benchmarkReturn20D": _round(benchmark_ret20),
            "rs5": _round(rs5),
            "rs20": _round(rs20),
            "ma20": _round(ma20),
            "ma60": _round(ma60),
            "ma20SlopePct": _round(ma20_slope_pct),
            "ma60SlopePct": _round(ma60_slope_pct),
            "distanceMA60Pct": _round(distance_ma60_pct),
            "positive10D": positive_10d,
        },
    }


def _percentile_map(candidates: list[dict], metric: str) -> dict[str, float]:
    values = sorted((float(item["metrics"][metric]), symbol_key(item["market"], item["code"])) for item in candidates)
    if not values:
        return {}
    if len(values) == 1:
        return {values[0][1]: 1.0}
    result: dict[str, float] = {}
    cursor = 0
    while cursor < len(values):
        end = cursor + 1
        while end < len(values) and values[end][0] == values[cursor][0]:
            end += 1
        average_rank = (cursor + end - 1) / 2
        percentile = average_rank / (len(values) - 1)
        for index in range(cursor, end):
            result[values[index][1]] = percentile
        cursor = end
    return result


def score_candidates(candidates: list[dict]) -> list[dict]:
    rs5_percentiles = _percentile_map(candidates, "rs5")
    rs20_percentiles = _percentile_map(candidates, "rs20")
    scored: list[dict] = []
    for source in candidates:
        item = {**source, "metrics": dict(source["metrics"]), "trendBreakdown": dict(source["trendBreakdown"])}
        key = symbol_key(item["market"], item["code"])
        rs5_score = 25 * rs5_percentiles.get(key, 0)
        rs20_score = 30 * rs20_percentiles.get(key, 0)
        score = rs5_score + rs20_score + item["trendScore"] + item["eventScore"] - item["riskPenalty"]
        item["score"] = _round(score, 2)
        item["scoreBreakdown"] = {
            "rs5": _round(rs5_score, 2),
            "rs20": _round(rs20_score, 2),
            "trend": item["trendScore"],
            "event": item["eventScore"],
            "risk": item["riskPenalty"],
        }
        item["qualifies"] = (
            score >= MIN_LEADER_SCORE
            and item["metrics"]["close"] > item["metrics"]["ma60"]
            and (item["metrics"]["rs5"] > 0 or item["metrics"]["rs20"] > 0)
            and not item["breakdown"]
        )
        scored.append(item)
    return scored


def _leader_codes(snapshot: dict) -> set[str]:
    return {symbol_key(item.get("market", ""), item.get("code", "")) for item in snapshot.get("leaders", [])}


def _theme_limits(qualified: list[dict]) -> dict[str, int]:
    top_five = qualified[:5]
    grouped: dict[str, list[dict]] = defaultdict(list)
    for item in top_five:
        grouped[item["themeGroup"]].append(item)
    limits: dict[str, int] = {}
    for group, members in grouped.items():
        limits[group] = 2 if len(members) >= 2 and abs(members[0]["score"] - members[1]["score"]) <= 5 else 1
    return limits


def select_leaders(scored: list[dict], prior_snapshots: list[dict] | None = None) -> list[dict]:
    prior_snapshots = prior_snapshots or []
    prior_30_counts = {
        symbol_key(item["market"], item["code"]): sum(
            symbol_key(item["market"], item["code"]) in _leader_codes(snapshot)
            for snapshot in prior_snapshots[-30:]
        )
        for item in scored
    }
    qualified = sorted(
        (item for item in scored if item.get("qualifies")),
        key=lambda item: (
            -item["score"],
            -prior_30_counts.get(symbol_key(item["market"], item["code"]), 0),
            -item["metrics"]["rs20"],
            -item["metrics"]["rs5"],
            item["market"],
            item["code"],
        ),
    )
    for rank, item in enumerate(qualified, 1):
        item["rawRank"] = rank
    limits = _theme_limits(qualified)
    selected: list[dict] = []
    group_counts: dict[str, int] = defaultdict(int)
    for item in qualified:
        group = item["themeGroup"]
        limit = limits.get(group, 1)
        if group_counts[group] >= limit:
            continue
        selected.append(item)
        group_counts[group] += 1
        if len(selected) == 5:
            break

    yesterday_codes = _leader_codes(prior_snapshots[-1]) if prior_snapshots else set()
    if len(selected) == 5 and yesterday_codes:
        cutoff = selected[-1]["score"]
        selected_codes = {symbol_key(item["market"], item["code"]) for item in selected}
        retention = [
            item for item in qualified
            if symbol_key(item["market"], item["code"]) in yesterday_codes
            and symbol_key(item["market"], item["code"]) not in selected_codes
            and item.get("rawRank", 999) <= 8
            and item["score"] >= MIN_LEADER_SCORE
            and item["score"] >= cutoff - 5
        ]
        for retained in retention:
            newcomers = [item for item in selected if symbol_key(item["market"], item["code"]) not in yesterday_codes]
            if not newcomers:
                break
            replace = min(newcomers, key=lambda item: item["score"])
            trial = [item for item in selected if item is not replace]
            counts = defaultdict(int)
            for item in trial:
                counts[item["themeGroup"]] += 1
            group = retained["themeGroup"]
            if counts[group] >= limits.get(group, 1):
                continue
            selected = trial + [retained]
            selected_codes.discard(symbol_key(replace["market"], replace["code"]))
            selected_codes.add(symbol_key(retained["market"], retained["code"]))

    selected.sort(key=lambda item: (
        -item["score"],
        -prior_30_counts.get(symbol_key(item["market"], item["code"]), 0),
        -item["metrics"]["rs20"],
        item["market"],
        item["code"],
    ))
    for rank, item in enumerate(selected, 1):
        key = symbol_key(item["market"], item["code"])
        consecutive = 1
        for snapshot in reversed(prior_snapshots):
            if key not in _leader_codes(snapshot):
                break
            consecutive += 1
        item["rank"] = rank
        item["appearances"] = {
            "consecutive": consecutive,
            "days15": 1 + sum(key in _leader_codes(snapshot) for snapshot in prior_snapshots[-14:]),
            "days30": 1 + sum(key in _leader_codes(snapshot) for snapshot in prior_snapshots[-29:]),
        }
    return selected


def build_snapshot(
    catalog_rows: list[dict],
    histories: dict[str, dict],
    trade_date: str,
    prior_snapshots: list[dict] | None = None,
    intraday_by_symbol: dict[str, dict[str, dict]] | None = None,
) -> dict | None:
    prior_snapshots = prior_snapshots or []
    intraday_by_symbol = intraday_by_symbol or {}
    benchmark = histories.get(symbol_key(BENCHMARK_MARKET, BENCHMARK_CODE))
    if not benchmark or trade_date not in benchmark["index"]:
        return None
    enabled = [row for row in catalog_rows if row.get("active", True) and row.get("radar_enabled")]
    candidates: list[dict] = []
    for catalog in enabled:
        key = symbol_key(catalog["market"], catalog["code"])
        series = histories.get(key)
        if not series:
            continue
        intraday = intraday_by_symbol.get(key, {}).get(trade_date)
        candidate = calculate_candidate(series, benchmark, trade_date, catalog, intraday)
        if candidate:
            candidates.append(candidate)
    coverage = len(candidates) / len(enabled) if enabled else 0
    if not enabled or coverage < MIN_RADAR_COVERAGE:
        return None
    scored = score_candidates(candidates)
    leaders = select_leaders(scored, prior_snapshots)
    return {
        "provider": "baostock",
        "trade_date": trade_date,
        "algorithm_version": ALGORITHM_VERSION,
        "universe_version": UNIVERSE_VERSION,
        "benchmark_market": BENCHMARK_MARKET,
        "benchmark_code": BENCHMARK_CODE,
        "universe_count": sum(1 for row in catalog_rows if row.get("active", True)),
        "eligible_count": len(enabled),
        "coverage": _round(coverage, 6),
        "leaders": leaders,
    }


def build_historical_snapshots(
    catalog_rows: list[dict],
    market_rows: list[dict],
    trade_dates: Iterable[str] | None = None,
    prior_snapshots: list[dict] | None = None,
    intraday_by_symbol: dict[str, dict[str, dict]] | None = None,
) -> list[dict]:
    histories = prepare_histories(market_rows)
    benchmark = histories.get(symbol_key(BENCHMARK_MARKET, BENCHMARK_CODE))
    if not benchmark:
        return []
    dates = list(trade_dates or benchmark["dates"])
    accumulated = list(prior_snapshots or [])
    built: list[dict] = []
    for trade_date in dates:
        snapshot = build_snapshot(catalog_rows, histories, trade_date, accumulated, intraday_by_symbol)
        if snapshot:
            built.append(snapshot)
            accumulated.append(snapshot)
    return built
