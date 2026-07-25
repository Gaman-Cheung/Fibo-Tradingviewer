"""Incrementally synchronize front-adjusted BaoStock closes into Supabase.

Required environment: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
The service-role credential is intentionally consumed only by this server-side job.
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import date, datetime, timedelta
from typing import Iterable

import requests

PROVIDER = "baostock"
SUPPORTED_MARKETS = {"SH", "SZ"}


def provider_code(market: str, code: str) -> str:
    market = str(market or "").upper().strip()
    code = str(code or "").strip()
    if market not in SUPPORTED_MARKETS or len(code) != 6 or not code.isdigit():
        raise ValueError(f"Unsupported BaoStock symbol: {market} {code}")
    return f"{market.lower()}.{code}"


def unique_symbols(bindings: Iterable[dict]) -> list[tuple[str, str]]:
    return sorted({(str(row.get("market", "")).upper(), str(row.get("code", "")))
                   for row in bindings if row.get("active") and str(row.get("market", "")).upper() in SUPPORTED_MARKETS})


class SupabaseRest:
    def __init__(self) -> None:
        self.url = os.environ["SUPABASE_URL"].rstrip("/")
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def get(self, table: str, params: dict | None = None) -> list[dict]:
        response = requests.get(f"{self.url}/rest/v1/{table}", headers=self.headers, params=params, timeout=45)
        response.raise_for_status()
        return response.json()

    def upsert(self, table: str, rows: list[dict], conflict: str) -> None:
        if not rows:
            return
        headers = {**self.headers, "Prefer": "resolution=merge-duplicates,return=minimal"}
        response = requests.post(f"{self.url}/rest/v1/{table}?on_conflict={conflict}", headers=headers, data=json.dumps(rows), timeout=60)
        response.raise_for_status()


def collect_query(result) -> list[dict]:
    rows = []
    while result.error_code == "0" and result.next():
        rows.append(dict(zip(result.fields, result.get_row_data())))
    if result.error_code != "0":
        raise RuntimeError(result.error_msg)
    return rows


def factor_signature(bs, symbol: str, start: str, end: str) -> str:
    query = bs.query_adjust_factor(code=symbol, start_date=start, end_date=end)
    payload = collect_query(query)
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=True).encode()).hexdigest()


def fetch_closes(bs, symbol: str, start: str, end: str) -> list[dict]:
    query = bs.query_history_k_data_plus(symbol, "date,close,tradestatus", start_date=start,
                                         end_date=end, frequency="d", adjustflag="2")
    rows = collect_query(query)
    return [{"trade_date": row["date"], "close": float(row["close"])}
            for row in rows if row.get("tradestatus") == "1" and row.get("close") not in ("", "0")]


def main() -> None:
    import baostock as bs

    db = SupabaseRest()
    bindings = db.get("market_instrument_bindings", {"select": "market,code,active", "active": "eq.true"})
    states = db.get("market_sync_state", {"select": "*", "provider": f"eq.{PROVIDER}"})
    state_by_symbol = {(row["market"], row["code"]): row for row in states}
    today = date.today()
    end = today.isoformat()
    login = bs.login()
    if login.error_code != "0":
        raise RuntimeError(login.error_msg)
    try:
        for market, code in unique_symbols(bindings):
            symbol = provider_code(market, code)
            state = state_by_symbol.get((market, code), {})
            try:
                factor_start = (today - timedelta(days=550)).isoformat()
                signature = factor_signature(bs, symbol, factor_start, end)
                last_trade_date = date.fromisoformat(state["last_trade_date"]) if state.get("last_trade_date") else None
                stale_gap = bool(last_trade_date and (today - last_trade_date).days > 14)
                full_refresh = os.getenv("FULL_REPAIR", "false").lower() == "true" or not last_trade_date or state.get("factor_signature") != signature or stale_gap
                start = (today - timedelta(days=550 if full_refresh else 14)).isoformat()
                closes = fetch_closes(bs, symbol, start, end)
                closes = closes[-300:] if full_refresh else closes[-5:]
                now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
                db.upsert("market_daily_close", [{"provider": PROVIDER, "market": market, "code": code,
                           "trade_date": row["trade_date"], "close": row["close"], "adjust_mode": "front", "synced_at": now}
                          for row in closes], "provider,market,code,trade_date")
                db.upsert("market_sync_state", [{"provider": PROVIDER, "market": market, "code": code,
                           "last_trade_date": closes[-1]["trade_date"] if closes else state.get("last_trade_date"),
                           "factor_signature": signature, "last_status": "ok", "last_error": None, "synced_at": now}],
                          "provider,market,code")
            except Exception as exc:  # keep other symbols progressing
                now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
                db.upsert("market_sync_state", [{"provider": PROVIDER, "market": market, "code": code,
                           "last_trade_date": state.get("last_trade_date"), "factor_signature": state.get("factor_signature"),
                           "last_status": "error", "last_error": str(exc)[:1000], "synced_at": now}],
                          "provider,market,code")
                print(f"{symbol}: {exc}")
    finally:
        bs.logout()


if __name__ == "__main__":
    main()
