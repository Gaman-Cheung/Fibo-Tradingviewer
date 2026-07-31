"""Pure ETF Radar classification, price normalization and ranking.

ETF Radar deliberately reuses Index Radar v1 candidate/score semantics while
adding only ETF-specific universe gates: reviewed scope, 20-session liquidity,
one representative per Theme Group and the Cross Asset category cap.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Iterable

try:
    from .etf_catalog_seed_v2 import ETF_CATALOG_SEED_V2
    from .index_radar import (
        BENCHMARK_CODE,
        BENCHMARK_MARKET,
        MIN_HISTORY_POINTS,
        MIN_LEADER_SCORE,
        MIN_RADAR_COVERAGE,
        calculate_candidate,
        prepare_histories,
        score_candidates,
        symbol_key,
    )
except ImportError:  # Direct import when scripts/ is on sys.path.
    from etf_catalog_seed_v2 import ETF_CATALOG_SEED_V2
    from index_radar import (
        BENCHMARK_CODE,
        BENCHMARK_MARKET,
        MIN_HISTORY_POINTS,
        MIN_LEADER_SCORE,
        MIN_RADAR_COVERAGE,
        calculate_candidate,
        prepare_histories,
        score_candidates,
        symbol_key,
    )


ALGORITHM_VERSION = 1
UNIVERSE_VERSION = 2
EQUITY_SCOPE = "EQUITY_ETF"
CROSS_ASSET_SCOPE = "CROSS_ASSET"
ETF_SCOPES = (EQUITY_SCOPE, CROSS_ASSET_SCOPE)
MIN_AVERAGE_AMOUNT_20D = 20_000_000.0
CROSS_ASSET_CATEGORY_LIMIT = 2


def is_seeded_etf(market: str, code: str) -> bool:
    return symbol_key(market, code) in ETF_CATALOG_SEED_V2


def classify_etf(market: str, code: str, name: str = "") -> dict:
    """Classify only reviewed Market+Code pairs; never infer from a name."""
    seeded = ETF_CATALOG_SEED_V2.get(symbol_key(market, code))
    if not seeded:
        return {
            "category": "other",
            "radar_scope": None,
            "theme_group": "",
            "theme_label": "",
            "radar_enabled": False,
        }
    _, category, scope, theme_group, theme_label, enabled = seeded
    return {
        "category": category,
        "radar_scope": scope,
        "theme_group": theme_group,
        "theme_label": theme_label,
        "radar_enabled": bool(enabled),
    }


def normalize_etf_universe(rows: Iterable[dict], names: dict[str, str] | None = None) -> list[dict]:
    """Normalize a BaoStock ETF daily snapshot into the reviewed catalog."""
    names = names or {}
    by_symbol: dict[str, dict] = {}
    for row in rows:
        raw = str(row.get("code", "")).strip().lower()
        if not (raw.startswith("sh.") or raw.startswith("sz.")):
            continue
        market, code = raw.split(".", 1)
        if len(code) != 6 or not code.isdigit():
            continue
        key = symbol_key(market, code)
        name = str(
            row.get("code_name")
            or row.get("name")
            or names.get(raw)
            or names.get(key)
            or ETF_CATALOG_SEED_V2.get(key, (raw,))[0]
        ).strip() or raw
        classification = classify_etf(market, code, name)
        by_symbol[key] = {
            "provider": "baostock",
            "market": market.upper(),
            "code": code,
            "name": name,
            **classification,
            # Presence in the official ETF endpoint means the listing is part
            # of today's universe. ``tradestatus=0`` can merely be a temporary
            # suspension and must not permanently deactivate its catalog row.
            "active": True,
            "universe_version": UNIVERSE_VERSION,
        }
    return sorted(by_symbol.values(), key=lambda item: (item["market"], item["code"]))


def _truthy_status(value) -> bool:
    return value in (True, 1, "1", "true", "True", None, "")


def _continuous_closes(ordered: list[dict]) -> list[float]:
    """Anchor to latest official close and walk backward using pctChg."""
    if not ordered:
        return []
    adjusted = [0.0] * len(ordered)
    adjusted[-1] = float(ordered[-1]["close"])
    for index in range(len(ordered) - 1, 0, -1):
        pct = ordered[index].get("pct_chg", ordered[index].get("pctChg"))
        try:
            rate = float(pct) / 100 if pct not in (None, "") else None
        except (TypeError, ValueError):
            rate = None
        if rate is not None and rate > -1:
            adjusted[index - 1] = adjusted[index] / (1 + rate)
        else:
            current = float(ordered[index]["close"])
            previous = float(ordered[index - 1]["close"])
            if current <= 0 or previous <= 0:
                raise ValueError("ETF continuous series contains an invalid close.")
            adjusted[index - 1] = adjusted[index] * previous / current
    return adjusted


def prepare_etf_histories(rows: Iterable[dict], etf_symbols: set[str] | None = None) -> dict[str, dict]:
    """Prepare adjusted ETF histories and raw benchmark history.

    ``etf_symbols`` keeps the CSI300 benchmark on official raw closes.  When it
    is omitted every supplied symbol is treated as an ETF, which is useful for
    pure normalization tests.
    """
    grouped: dict[str, dict[str, dict]] = defaultdict(dict)
    for row in rows:
        market = str(row.get("market", "")).upper()
        code = str(row.get("code", "")).strip()
        trade_date = str(row.get("trade_date", row.get("date", "")))[:10]
        if market not in ("SH", "SZ") or len(code) != 6 or not trade_date:
            continue
        if not _truthy_status(row.get("trade_status", row.get("tradestatus"))):
            continue
        try:
            close = float(row.get("close"))
        except (TypeError, ValueError):
            continue
        if close <= 0:
            continue
        grouped[symbol_key(market, code)][trade_date] = {
            **row,
            "market": market,
            "code": code,
            "trade_date": trade_date,
            "close": close,
        }

    prepared: dict[str, dict] = {}
    for key, by_date in grouped.items():
        ordered = [by_date[value] for value in sorted(by_date)]
        dates = [item["trade_date"] for item in ordered]
        raw_closes = [float(item["close"]) for item in ordered]
        closes = _continuous_closes(ordered) if etf_symbols is None or key in etf_symbols else raw_closes
        prefix = [0.0]
        for close in closes:
            prefix.append(prefix[-1] + close)
        amounts: list[float | None] = []
        for item in ordered:
            try:
                amount = float(item.get("amount")) if item.get("amount") not in (None, "") else None
            except (TypeError, ValueError):
                amount = None
            amounts.append(amount if amount is not None and amount >= 0 else None)
        prepared[key] = {
            "dates": dates,
            "closes": closes,
            "rawCloses": raw_closes,
            "amounts": amounts,
            "prefix": prefix,
            "index": {value: index for index, value in enumerate(dates)},
        }
    return prepared


def average_amount_20d(series: dict, trade_date: str) -> float | None:
    index = series.get("index", {}).get(trade_date)
    if index is None or index < 19:
        return None
    values = series.get("amounts", [])[index - 19:index + 1]
    if len(values) != 20 or any(value is None for value in values):
        return None
    return sum(values) / 20


def _theme_key(item: dict) -> str:
    group = str(item.get("theme_group", item.get("themeGroup", ""))).strip()
    return group or symbol_key(item.get("market", ""), item.get("code", ""))


def select_liquid_theme_representatives(
    catalog_rows: list[dict],
    histories: dict[str, dict],
    trade_date: str,
    scope: str,
) -> tuple[list[tuple[dict, float]], float, int]:
    """Return one most-liquid ETF for every data-covered Theme Group."""
    enabled = [
        row for row in catalog_rows
        if row.get("active", True) and row.get("radar_enabled") and row.get("radar_scope") == scope
    ]
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in enabled:
        grouped[_theme_key(row)].append(row)
    if not grouped:
        return [], 0.0, 0

    covered = 0
    applicable_groups = 0
    representatives: list[tuple[dict, float]] = []
    for members in grouped.values():
        liquid: list[tuple[dict, float]] = []
        amount_coverage_complete = True
        group_exists = False
        for row in members:
            series = histories.get(symbol_key(row["market"], row["code"]))
            index = series.get("index", {}).get(trade_date) if series else None
            if index is None:
                # A fund that did not exist yet is not a historical candidate.
                # Once catalog history has begun, a missing date is coverage
                # failure rather than permission to fall back to another code.
                history_from = str(row.get("history_from") or "")
                if history_from and history_from <= trade_date:
                    group_exists = True
                    amount_coverage_complete = False
                    break
                continue
            group_exists = True
            average = average_amount_20d(series, trade_date)
            if average is None:
                amount_coverage_complete = False
                break
            liquid.append((row, average))
        if not group_exists:
            continue
        applicable_groups += 1
        if not amount_coverage_complete or not liquid:
            continue
        representative, average = sorted(
            liquid,
            key=lambda pair: (-pair[1], pair[0]["market"], pair[0]["code"]),
        )[0]
        winner_series = histories[symbol_key(representative["market"], representative["code"])]
        winner_index = winner_series["index"].get(trade_date)
        # Select the true liquidity winner first. A newer high-volume ETF with
        # fewer than 62 sessions removes the Theme from today's candidate set;
        # an older, less-liquid ETF is never substituted.
        if winner_index is None or winner_index < MIN_HISTORY_POINTS - 1:
            continue
        covered += 1
        # A low-liquidity winner removes the whole theme. We never fall back to
        # a second ETF because doing so would contradict the representative rule.
        if average >= MIN_AVERAGE_AMOUNT_20D:
            representatives.append((representative, average))
    coverage = covered / applicable_groups if applicable_groups else 0.0
    return representatives, coverage, applicable_groups


def _prior_theme_set(snapshot: dict) -> set[str]:
    return {_theme_key(item) for item in snapshot.get("leaders", [])}


def select_etf_leaders(scored: list[dict], scope: str, prior_snapshots: list[dict] | None = None) -> list[dict]:
    """Strict Theme dedup, optional Cross Asset category cap and stability."""
    prior_snapshots = prior_snapshots or []
    prior_30_counts = {
        _theme_key(item): sum(_theme_key(item) in _prior_theme_set(snapshot) for snapshot in prior_snapshots[-30:])
        for item in scored
    }
    qualified = sorted(
        (item for item in scored if item.get("qualifies")),
        key=lambda item: (
            -item["score"],
            -prior_30_counts.get(_theme_key(item), 0),
            -item["metrics"]["rs20"],
            -item["metrics"]["rs5"],
            item["market"],
            item["code"],
        ),
    )
    for rank, item in enumerate(qualified, 1):
        item["rawRank"] = rank

    selected: list[dict] = []
    categories: dict[str, int] = defaultdict(int)
    for item in qualified:
        category = str(item.get("category", "other"))
        if scope == CROSS_ASSET_SCOPE and categories[category] >= CROSS_ASSET_CATEGORY_LIMIT:
            continue
        selected.append(item)
        categories[category] += 1
        if len(selected) == 5:
            break

    yesterday_themes = _prior_theme_set(prior_snapshots[-1]) if prior_snapshots else set()
    if len(selected) == 5 and yesterday_themes:
        selected_themes = {_theme_key(item) for item in selected}
        cutoff = selected[-1]["score"]
        retained = [
            item for item in qualified
            if _theme_key(item) in yesterday_themes
            and _theme_key(item) not in selected_themes
            and item.get("rawRank", 999) <= 8
            and item["score"] >= MIN_LEADER_SCORE
            and item["score"] >= cutoff - 5
        ]
        for candidate in retained:
            newcomers = [item for item in selected if _theme_key(item) not in yesterday_themes]
            if not newcomers:
                break
            replace = min(newcomers, key=lambda item: item["score"])
            trial = [item for item in selected if item is not replace] + [candidate]
            if scope == CROSS_ASSET_SCOPE:
                counts: dict[str, int] = defaultdict(int)
                for item in trial:
                    counts[str(item.get("category", "other"))] += 1
                if any(value > CROSS_ASSET_CATEGORY_LIMIT for value in counts.values()):
                    continue
            selected = trial
            selected_themes.discard(_theme_key(replace))
            selected_themes.add(_theme_key(candidate))

    selected.sort(key=lambda item: (
        -item["score"],
        -prior_30_counts.get(_theme_key(item), 0),
        -item["metrics"]["rs20"],
        item["market"],
        item["code"],
    ))
    for rank, item in enumerate(selected, 1):
        theme = _theme_key(item)
        consecutive = 1
        for snapshot in reversed(prior_snapshots):
            if theme not in _prior_theme_set(snapshot):
                break
            consecutive += 1
        item["rank"] = rank
        item["appearances"] = {
            "consecutive": consecutive,
            "days15": 1 + sum(theme in _prior_theme_set(snapshot) for snapshot in prior_snapshots[-14:]),
            "days30": 1 + sum(theme in _prior_theme_set(snapshot) for snapshot in prior_snapshots[-29:]),
        }
    return selected


def build_etf_snapshot(
    catalog_rows: list[dict],
    histories: dict[str, dict],
    trade_date: str,
    scope: str,
    prior_snapshots: list[dict] | None = None,
    intraday_by_symbol: dict[str, dict[str, dict]] | None = None,
) -> dict | None:
    if scope not in ETF_SCOPES:
        raise ValueError(f"Unsupported ETF Radar scope: {scope}")
    prior_snapshots = prior_snapshots or []
    intraday_by_symbol = intraday_by_symbol or {}
    benchmark = histories.get(symbol_key(BENCHMARK_MARKET, BENCHMARK_CODE))
    if not benchmark or trade_date not in benchmark.get("index", {}):
        return None

    representatives, coverage, theme_count = select_liquid_theme_representatives(
        catalog_rows, histories, trade_date, scope
    )
    if not theme_count or coverage < MIN_RADAR_COVERAGE:
        return None
    candidates: list[dict] = []
    for catalog, average_amount in representatives:
        key = symbol_key(catalog["market"], catalog["code"])
        candidate = calculate_candidate(
            histories[key], benchmark, trade_date, catalog,
            intraday_by_symbol.get(key, {}).get(trade_date),
        )
        if not candidate:
            # A representative that passed the data-coverage check must also
            # align with the benchmark. Never publish a deceptively complete
            # scope after silently dropping it here.
            return None
        candidate["radarScope"] = scope
        candidate["averageAmount20D"] = round(average_amount, 2)
        candidate["assetCategory"] = catalog["category"]
        candidates.append(candidate)

    scored = score_candidates(candidates)
    leaders = select_etf_leaders(scored, scope, prior_snapshots)
    scope_catalog = [
        row for row in catalog_rows
        if row.get("active", True) and row.get("radar_scope") == scope
    ]
    return {
        "provider": "baostock",
        "scope": scope,
        "trade_date": trade_date,
        "algorithm_version": ALGORITHM_VERSION,
        "universe_version": UNIVERSE_VERSION,
        "benchmark_market": BENCHMARK_MARKET,
        "benchmark_code": BENCHMARK_CODE,
        "universe_count": len(scope_catalog),
        "eligible_count": len(representatives),
        "coverage": round(coverage, 6),
        "leaders": leaders,
    }


def build_etf_historical_snapshots(
    catalog_rows: list[dict],
    market_rows: list[dict],
    trade_dates: Iterable[str],
    scope: str,
    prior_snapshots: list[dict] | None = None,
    intraday_by_symbol: dict[str, dict[str, dict]] | None = None,
) -> list[dict]:
    etf_symbols = {symbol_key(row["market"], row["code"]) for row in catalog_rows}
    histories = prepare_etf_histories(market_rows, etf_symbols)
    accumulated = list(prior_snapshots or [])
    built: list[dict] = []
    for trade_date in trade_dates:
        snapshot = build_etf_snapshot(
            catalog_rows, histories, trade_date, scope,
            prior_snapshots=accumulated,
            intraday_by_symbol=intraday_by_symbol,
        )
        if snapshot:
            built.append(snapshot)
            accumulated.append(snapshot)
    return built
