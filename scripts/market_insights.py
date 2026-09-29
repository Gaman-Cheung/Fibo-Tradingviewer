"""Pure Market Insights v1: separate from all existing trading algorithms."""
from collections import defaultdict
from datetime import date
import json
import math
from statistics import mean, pstdev
try:
    from .market_insights_basket import BASKET_SYMBOLS
except ImportError:
    from market_insights_basket import BASKET_SYMBOLS

VERSION = "insights-v1"
WINDOWS = (1, 3, 13, 60)
SCOPES = ("SECTOR_INDEX", "EQUITY_ETF", "CROSS_ASSET")
WEIGHTS = {"momentum5": .25, "momentum20": .35, "position60": .25, "slope20": .15}


def enabled(value):
    return value in (True, 1, "true", "1")


def key(row):
    return f"{row['market']}:{row['code']}"


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def group_bars(rows):
    result = defaultdict(dict)
    for row in rows:
        day = str(row.get("trade_date", ""))
        date.fromisoformat(day)
        target = result[key(row)]
        if day in target and target[day] != row:
            raise ValueError("Conflicting duplicate market bar")
        target[day] = row
    return result


def metrics(history, calendar, end, etf=False):
    """62 aligned official closes, no padding, no raw-close ETF fallback."""
    if end < 61:
        return None
    rows = [history.get(day) for day in calendar[end-61:end+1]]
    if any(not row or not enabled(row.get("trade_status")) or
           number(row.get("close")) is None or number(row["close"]) <= 0 for row in rows):
        return None
    closes = [float(row["close"]) for row in rows]
    if etf:
        for i in range(61, 0, -1):
            pct = number(rows[i].get("pct_chg"))
            if pct is None or pct <= -100:
                return None
            closes[i-1] = closes[i] / (1 + pct / 100)
    returns = [math.log(closes[i]/closes[i-1]) for i in range(42, 62)]
    sigma = max(.005, pstdev(returns))
    ma20, prev20, ma60 = mean(closes[-20:]), mean(closes[-21:-1]), mean(closes[-60:])
    factors = {
        "momentum5": math.tanh(math.log(closes[-1]/closes[-6])/(sigma*math.sqrt(5))),
        "momentum20": math.tanh(math.log(closes[-1]/closes[-21])/(sigma*math.sqrt(20))),
        "position60": math.tanh(math.log(closes[-1]/ma60)/(sigma*math.sqrt(60))),
        "slope20": math.tanh(math.log(ma20/prev20)/(sigma/math.sqrt(20))),
    }
    return {"score": 50 + 50*sum(WEIGHTS[k]*v for k,v in factors.items()),
            "return5": (closes[-1]/closes[-6]-1)*100,
            "return20": (closes[-1]/closes[-21]-1)*100,
            "distanceMA60": (closes[-1]/ma60-1)*100,
            "sigma20": sigma, "factors": factors}


def amount20(history, calendar, end):
    if end < 19:
        return None
    rows = [history.get(day) for day in calendar[end-19:end+1]]
    values = [number(row.get("amount")) if row and enabled(row.get("trade_status")) else None for row in rows]
    return mean(values) if all(v is not None and v >= 0 for v in values) else None


def select_groups(catalog, histories, calendar, scope):
    groups = defaultdict(list)
    for item in catalog:
        if not enabled(item.get("active", True)) or not enabled(item.get("radar_enabled")):
            continue
        if scope == "SECTOR_INDEX":
            if item.get("category") not in ("sector", "theme"):
                continue
        elif item.get("radar_scope") != scope:
            continue
        groups[item.get("theme_group") or key(item)].append(item)
    selected, reasons = {}, {}
    for theme, members in groups.items():
        if scope == "SECTOR_INDEX":
            selected[theme] = sorted(members, key=key)
            continue
        amounts = [(amount20(histories.get(key(item), {}), calendar, len(calendar)-1), item) for item in members]
        if any(amount is None for amount, _ in amounts):
            reasons[theme] = "incomplete_theme_amount_history"
            continue
        amount, item = sorted(amounts, key=lambda pair: (-pair[0], key(pair[1])))[0]
        if amount < 20_000_000:
            reasons[theme] = "below_20m_amount"
            continue
        selected[theme] = [item]
    return selected, reasons, len(groups)


def score_group(members, histories, calendar, end, etf):
    values = [metrics(histories.get(key(item), {}), calendar, end, etf) for item in members]
    if any(value is None for value in values):
        return None
    return {"score": mean(v["score"] for v in values),
            "members": [{"symbol": key(item), **value} for item,value in zip(members,values)]}


def panel(rows, field, reverse):
    ordered = sorted(rows, key=lambda r: ((-1 if reverse else 1)*r[field], r["themeKey"]))[:8]
    largest = max((abs(r[field]) for r in ordered), default=1) or 1
    return [{"themeKey": r["themeKey"], "label": r["label"],
             "radius": round(.12+.8*(1-(abs(r[field])/largest if field == "delta" else
                                        r[field]/100 if reverse else 1-r[field]/100)), 6),
             "score": round(r["score"], 6),
             **({"delta": round(r["delta"], 6)} if field == "delta" else {})} for r in ordered]


def build_scan(catalog, histories, calendar, scope):
    selected, excluded, expected = select_groups(catalog, histories, calendar, scope)
    latest, dated = {}, {str(w): {} for w in WINDOWS}
    for theme, members in selected.items():
        value = score_group(members, histories, calendar, len(calendar)-1, scope != "SECTOR_INDEX")
        if value is None:
            excluded[theme] = "incomplete_62_session_history"
            continue
        latest[theme] = {"themeKey": theme, "label": members[0].get("theme_label") or theme, **value}
        for w in WINDOWS:
            baseline = score_group(members, histories, calendar, len(calendar)-1-w, scope != "SECTOR_INDEX")
            if baseline is not None:
                dated[str(w)][theme] = {**latest[theme], "baselineScore": baseline["score"],
                                        "delta": value["score"]-baseline["score"]}
    windows, coverage = {}, {}
    for w in WINDOWS:
        values = list(dated[str(w)].values())
        coverage[str(w)] = {"comparable": len(values), "current": len(latest),
                            "missingThemes": sorted(set(latest)-set(dated[str(w)]))}
        # The current UI cannot label per-window partial coverage: fail closed.
        if len(calendar) < 62+w or not latest or len(values) != len(latest):
            continue
        windows[str(w)] = {"baselineDate": calendar[-1-w],
                          "strengthening": panel([r for r in values if r["delta"] > 1e-9], "delta", True),
                          "weakening": panel([r for r in values if r["delta"] < -1e-9], "delta", False)}
    scan = {"presentationVersion": 1, "scope": scope, "tradeDate": calendar[-1],
            "algorithmVersion": VERSION, "universeVersion": "live-reviewed-catalog-v2",
            "coverageLabel": f"{len(latest)}/{expected} themes",
            "levels": {"strong": panel(latest.values(), "score", True), "weak": panel(latest.values(), "score", False)},
            "windows": windows}
    return scan, {"excluded": excluded, "windows": coverage, "scores": latest}, dated


def basket_symbols():
    return {theme: set(symbols) for theme, symbols in BASKET_SYMBOLS.items()}


def build_regime(day, latest, historical, pulse):
    allowed = basket_symbols()
    if not pulse or pulse.get("trade_date") != day or pulse.get("algorithm_version") != 1:
        return None, "matching_pulse_v1_unavailable"
    p = number(pulse.get("pulse_score"))
    if p is None or not 0 <= p <= 100:
        return None, "invalid_pulse_score"
    for values in (latest, historical):
        if any(theme not in values or any(m["symbol"] not in symbols for m in values[theme]["members"])
               for theme,symbols in allowed.items()):
            return None, "reviewed_basket_or_13_session_history_incomplete"
    def style(values, baseline=False):
        score = lambda name: values[name]["baselineScore" if baseline else "score"]
        small = mean(score(name) for name in ("csi1000", "csi2000"))
        growth = mean(score(name) for name in ("chinext", "star50"))
        defensive = mean(score(name) for name in ("dividend", "dividend_low_vol"))
        return 50 + (mean([small, growth])-defensive)/2
    current, previous = style(latest), style(historical, True)
    change = 50+(current-previous)/2
    value = .6*p+.3*current+.1*change
    label = ("明显防御", "偏防御", "中性分化", "偏进攻", "明显进攻")[min(4, int(value//20))]
    return {"presentationVersion": 1, "tradeDate": day, "algorithmVersion": VERSION,
            "coverageLabel": "6/6 reviewed ETF proxies + Pulse", "value": round(value, 6),
            "label": label, "explanation": "60%市场宽度 + 30%进攻/防御风格 + 10%风格13日变化。中证1000/2000为小盘代理，不是微盘指数；非银不入篮子，不预测涨跌。",
            "breakdown": {"pulse": p, "style": current, "styleChange": change}}, None


def calculate_insights(data):
    indices, etfs = data["index_catalog"], data["etf_catalog"]
    if any(item.get("universe_version") != 2 for item in indices+etfs if enabled(item.get("radar_enabled"))):
        raise ValueError("Trial requires reviewed Universe v2 catalogs")
    index_history, etf_history = group_bars(data["index_rows"]), group_bars(data["etf_rows"])
    calendar = sorted(day for day,row in index_history.get("SH:000300", {}).items()
                      if enabled(row.get("trade_status")) and (number(row.get("close")) or 0) > 0)
    if len(calendar) < 62:
        raise ValueError("Fewer than 62 official benchmark sessions")
    scans, diagnostics, dates = {}, {}, {}
    for scope in SCOPES:
        scans[scope], diagnostics[scope], dates[scope] = build_scan(
            indices if scope == "SECTOR_INDEX" else etfs,
            index_history if scope == "SECTOR_INDEX" else etf_history, calendar, scope)
    regime, regime_missing = build_regime(calendar[-1], diagnostics["EQUITY_ETF"]["scores"],
                                          dates["EQUITY_ETF"]["13"], data.get("pulse"))
    # Candidate wire payload includes all theme scores, not a duplicate of raw history.
    payload = {"tradeDate": calendar[-1], "algorithmVersion": VERSION, "scans": scans, "regime": regime,
               "themeScores": {scope: d["scores"] for scope,d in diagnostics.items()}}
    size = len(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8"))
    source_status = {scope: data.get("checkpoints", {}).get(scope, {}) for scope in ("CN_A", "CN_INDEX", "CN_PULSE", "CN_ETF")}
    return {"readOnly": True, "publishable": False, "algorithmStatus": "approved_v1_not_published",
            "payload": payload, "diagnostics": diagnostics, "regimeMissing": regime_missing,
            "sourceCheckpoints": source_status,
            "storageEstimate": {"jsonBytesPerSnapshot": size, "sixtySnapshotsJsonMiB": round(size*60/1024**2, 4),
                                "databaseSizeMeasured": False, "remainingHeadroomMiB": None},
            "limitations": ["Current-universe retrospective comparison, not an investable historical backtest",
                            "ETF changes use the same current representative at both endpoints",
                            "Full-window missing coverage is unavailable, never padded",
                            "Storage is uncompressed JSON only; indexes/TOAST and Dashboard headroom not measured"]}
