"""Synchronize BaoStock's full SH/SZ daily market into Supabase.

Modes:
  smoke    Connect and compare reconstructed closes with BaoStock QFQ data.
  daily    Sync the latest completed trading day (and up to five missed days).
  backfill Resume a checkpointed rolling-session backfill.
  repair   Re-fetch an explicit inclusive date range.

The browser never receives the service-role credential. This module has no
dependency on Pool, permanent IDs, DOM code, or trading algorithms.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
import json
import os
import socket
import sys
import time as time_module
from typing import Callable, Iterable
from zoneinfo import ZoneInfo

import requests

try:
    from .etf_radar import (
        ALGORITHM_VERSION as ETF_RADAR_ALGORITHM_VERSION,
        ETF_SCOPES,
        MIN_AVERAGE_AMOUNT_20D,
        UNIVERSE_VERSION as ETF_RADAR_UNIVERSE_VERSION,
        build_etf_historical_snapshots,
        classify_etf,
        is_seeded_etf,
        normalize_etf_universe,
    )
    from .index_radar import (
        ALGORITHM_VERSION as RADAR_ALGORITHM_VERSION,
        BENCHMARK_CODE,
        BENCHMARK_MARKET,
        MIN_RADAR_COVERAGE,
        UNIVERSE_VERSION as RADAR_UNIVERSE_VERSION,
        build_historical_snapshots,
        classify_index,
        is_seeded_index,
        normalize_index_universe,
        symbol_key,
    )
except ImportError:  # Direct `python scripts/sync_baostock.py` execution.
    from etf_radar import (
        ALGORITHM_VERSION as ETF_RADAR_ALGORITHM_VERSION,
        ETF_SCOPES,
        MIN_AVERAGE_AMOUNT_20D,
        UNIVERSE_VERSION as ETF_RADAR_UNIVERSE_VERSION,
        build_etf_historical_snapshots,
        classify_etf,
        is_seeded_etf,
        normalize_etf_universe,
    )
    from index_radar import (
        ALGORITHM_VERSION as RADAR_ALGORITHM_VERSION,
        BENCHMARK_CODE,
        BENCHMARK_MARKET,
        MIN_RADAR_COVERAGE,
        UNIVERSE_VERSION as RADAR_UNIVERSE_VERSION,
        build_historical_snapshots,
        classify_index,
        is_seeded_index,
        normalize_index_universe,
        symbol_key,
    )


PROVIDER = "baostock"
SCOPE = "CN_A"
INDEX_SCOPE = "CN_INDEX"
ETF_SCOPE = "CN_ETF"
RETENTION_SESSIONS = 400
ETF_RETENTION_SESSIONS = 144
MIN_DAILY_ROWS = 4000
MIN_INDEX_COUNT = 450
MIN_ETF_DAILY_ROWS = 300
UPLOAD_BATCH_SIZE = 1000
MAX_DAILY_CATCHUP = 5
INDEX_QUERY_CODE_BATCH = 80
SHANGHAI = ZoneInfo("Asia/Shanghai")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def chunks(rows: list[dict], size: int = UPLOAD_BATCH_SIZE) -> Iterable[list[dict]]:
    for index in range(0, len(rows), size):
        yield rows[index:index + size]


def collect_query(result) -> list[dict]:
    rows: list[dict] = []
    while result.error_code == "0" and result.next():
        rows.append(dict(zip(result.fields, result.get_row_data())))
    if result.error_code != "0":
        raise RuntimeError(f"BaoStock {result.error_code}: {result.error_msg}")
    return rows


def normalize_daily_rows(rows: Iterable[dict], synced_at: str) -> list[dict]:
    normalized: list[dict] = []
    for row in rows:
        raw_symbol = str(row.get("code", "")).strip().lower()
        if not (raw_symbol.startswith("sh.") or raw_symbol.startswith("sz.")):
            continue
        market, code = raw_symbol.split(".", 1)
        close_text = str(row.get("close", "")).strip()
        if len(code) != 6 or not code.isdigit() or not close_text:
            continue
        close = float(close_text)
        if close <= 0:
            continue
        pct_text = str(row.get("pctChg", "")).strip()
        normalized.append({
            "provider": PROVIDER,
            "market": market.upper(),
            "code": code,
            "trade_date": str(row.get("date", "")),
            "close": close,
            "pct_chg": float(pct_text) if pct_text else None,
            "trade_status": str(row.get("tradestatus", "")) == "1",
            "synced_at": synced_at,
        })
    return normalized


def normalize_index_rows(rows: Iterable[dict], synced_at: str) -> tuple[list[dict], dict[str, dict[str, dict]]]:
    """Normalize persistent index fields and keep High/Low only in memory."""
    normalized: list[dict] = []
    intraday: dict[str, dict[str, dict]] = {}
    for row in rows:
        raw_symbol = str(row.get("code", "")).strip().lower()
        if not (raw_symbol.startswith("sh.000") or raw_symbol.startswith("sz.399")):
            continue
        market, code = raw_symbol.split(".", 1)
        close_text = str(row.get("close", "")).strip()
        trade_date = str(row.get("date", ""))[:10]
        if len(code) != 6 or not code.isdigit() or not close_text or not trade_date:
            continue
        try:
            close = float(close_text)
        except (TypeError, ValueError):
            continue
        if close <= 0:
            continue
        pct_text = str(row.get("pctChg", "")).strip()
        normalized.append({
            "provider": PROVIDER,
            "market": market.upper(),
            "code": code,
            "trade_date": trade_date,
            "close": close,
            "pct_chg": float(pct_text) if pct_text else None,
            "trade_status": str(row.get("tradestatus", "1")) == "1",
            "synced_at": synced_at,
        })
        high_text, low_text = str(row.get("high", "")).strip(), str(row.get("low", "")).strip()
        try:
            high, low = float(high_text), float(low_text)
        except (TypeError, ValueError):
            continue
        if high > 0 and low > 0:
            key = symbol_key(market, code)
            intraday.setdefault(key, {})[trade_date] = {
                "date": trade_date,
                "high": high,
                "low": low,
            }
    return normalized, intraday


def normalize_etf_rows(rows: Iterable[dict], synced_at: str) -> tuple[list[dict], dict[str, dict[str, dict]]]:
    """Keep only the ETF fields required by Radar; High/Low remain transient."""
    normalized: list[dict] = []
    intraday: dict[str, dict[str, dict]] = {}
    for row in rows:
        raw_symbol = str(row.get("code", "")).strip().lower()
        if not (raw_symbol.startswith("sh.") or raw_symbol.startswith("sz.")):
            continue
        market, code = raw_symbol.split(".", 1)
        trade_date = str(row.get("date", ""))[:10]
        try:
            close = float(str(row.get("close", "")).strip())
        except (TypeError, ValueError):
            continue
        if len(code) != 6 or not code.isdigit() or not trade_date or close <= 0:
            continue
        pct_text = str(row.get("pctChg", "")).strip()
        amount_text = str(row.get("amount", "")).strip()
        try:
            amount = float(amount_text) if amount_text else None
        except (TypeError, ValueError):
            amount = None
        normalized.append({
            "provider": PROVIDER,
            "market": market.upper(),
            "code": code,
            "trade_date": trade_date,
            "close": close,
            "pct_chg": float(pct_text) if pct_text else None,
            "trade_status": str(row.get("tradestatus", "1")) == "1",
            "amount": amount if amount is not None and amount >= 0 else None,
            "synced_at": synced_at,
        })
        try:
            high = float(str(row.get("high", "")).strip())
            low = float(str(row.get("low", "")).strip())
        except (TypeError, ValueError):
            continue
        if high > 0 and low > 0:
            key = symbol_key(market, code)
            intraday.setdefault(key, {})[trade_date] = {
                "date": trade_date,
                "high": high,
                "low": low,
            }
    return normalized, intraday


def reconstruct_front_adjusted(raw_rows: list[dict]) -> list[float]:
    """Rebuild BaoStock's return-adjusted series, anchored to the latest raw close."""
    if not raw_rows:
        return []
    adjusted = [0.0] * len(raw_rows)
    adjusted[-1] = float(raw_rows[-1]["close"])
    for index in range(len(raw_rows) - 1, 0, -1):
        pct = raw_rows[index].get("pctChg", raw_rows[index].get("pct_chg"))
        try:
            rate = float(pct) / 100 if pct not in (None, "") else None
        except (TypeError, ValueError):
            rate = None
        if rate is not None and rate > -1:
            adjusted[index - 1] = adjusted[index] / (1 + rate)
            continue
        current_raw = float(raw_rows[index]["close"])
        previous_raw = float(raw_rows[index - 1]["close"])
        if current_raw <= 0 or previous_raw <= 0:
            raise ValueError("Cannot reconstruct adjusted series from invalid close/pctChg data.")
        adjusted[index - 1] = adjusted[index] * previous_raw / current_raw
    return adjusted


def completed_market_date(now: datetime | None = None) -> date:
    current = (now or datetime.now(SHANGHAI)).astimezone(SHANGHAI)
    return current.date() if current.time() >= time(18, 0) else current.date() - timedelta(days=1)


class SupabaseRest:
    def __init__(self) -> None:
        self.url = os.environ["SUPABASE_URL"].rstrip("/")
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        last_error: Exception | None = None
        headers = kwargs.pop("headers", self.headers)
        timeout = kwargs.pop("timeout", 60)
        for attempt in range(1, 4):
            try:
                response = requests.request(
                    method,
                    f"{self.url}/rest/v1/{path}",
                    headers=headers,
                    timeout=timeout,
                    **kwargs,
                )
                response.raise_for_status()
                return response
            except (requests.RequestException, OSError) as exc:
                last_error = exc
                if attempt < 3:
                    delay = 2 ** (attempt - 1)
                    print(f"      Supabase attempt {attempt}/3 failed; retrying in {delay}s: {exc}", flush=True)
                    time_module.sleep(delay)
        raise RuntimeError(f"Supabase request failed after 3 attempts: {last_error}")

    def get_checkpoint(self, scope: str = SCOPE) -> dict:
        response = self._request(
            "GET",
            "market_sync_checkpoint",
            params={"select": "*", "provider": f"eq.{PROVIDER}", "scope": f"eq.{scope}", "limit": "1"},
        )
        rows = response.json()
        return rows[0] if rows else {}

    def save_checkpoint(self, scope: str = SCOPE, **values) -> None:
        row = {"provider": PROVIDER, "scope": scope, "synced_at": utc_now(), **values}
        headers = {**self.headers, "Prefer": "resolution=merge-duplicates,return=minimal"}
        self._request(
            "POST",
            "market_sync_checkpoint?on_conflict=provider,scope",
            headers=headers,
            data=json.dumps([row]),
        )

    def upsert_daily_rows(self, rows: list[dict]) -> None:
        headers = {**self.headers, "Prefer": "resolution=merge-duplicates,return=minimal"}
        total_batches = (len(rows) + UPLOAD_BATCH_SIZE - 1) // UPLOAD_BATCH_SIZE
        for batch_number, batch in enumerate(chunks(rows), 1):
            self._request(
                "POST",
                "market_daily_bar?on_conflict=provider,market,code,trade_date",
                headers=headers,
                data=json.dumps(batch, separators=(",", ":")),
                timeout=90,
            )
            print(f"      uploaded batch {batch_number}/{total_batches} ({len(batch):,} rows)", flush=True)

    def prune_before(self, cutoff: str) -> None:
        self._request(
            "DELETE",
            "market_daily_bar",
            params={"provider": f"eq.{PROVIDER}", "trade_date": f"lt.{cutoff}"},
            headers={**self.headers, "Prefer": "return=minimal"},
            timeout=120,
        )

    def get_index_catalog(self) -> list[dict]:
        response = self._request(
            "GET",
            "market_index_catalog",
            params={"select": "*", "provider": f"eq.{PROVIDER}", "order": "market.asc,code.asc"},
        )
        return response.json()

    def upsert_index_catalog(self, rows: list[dict]) -> None:
        if not rows:
            return
        headers = {**self.headers, "Prefer": "resolution=merge-duplicates,return=minimal"}
        for batch in chunks(rows):
            self._request(
                "POST",
                "market_index_catalog?on_conflict=provider,market,code",
                headers=headers,
                data=json.dumps(batch, ensure_ascii=False, separators=(",", ":")),
            )

    def load_index_history(self, catalog: list[dict], start_date: str) -> list[dict]:
        rows: list[dict] = []
        active = [row for row in catalog if row.get("active", True)]
        for market in ("SH", "SZ"):
            codes = sorted({str(row.get("code", "")) for row in active if row.get("market") == market})
            for code_batch in chunks(codes, INDEX_QUERY_CODE_BATCH):
                offset = 0
                while True:
                    response = self._request(
                        "GET",
                        "market_daily_bar",
                        params={
                            "select": "market,code,trade_date,close,pct_chg,trade_status",
                            "provider": f"eq.{PROVIDER}",
                            "market": f"eq.{market}",
                            "code": f"in.({','.join(code_batch)})",
                            "trade_date": f"gte.{start_date}",
                            "order": "trade_date.asc,code.asc",
                            "limit": "1000",
                            "offset": str(offset),
                        },
                        timeout=120,
                    )
                    page = response.json()
                    rows.extend(page)
                    if len(page) < 1000:
                        break
                    offset += len(page)
        return rows

    def get_radar_snapshots(self, limit: int = 30, before: str | None = None) -> list[dict]:
        params = {
            "select": "*",
            "provider": f"eq.{PROVIDER}",
            "order": "trade_date.desc",
            "limit": str(limit),
        }
        if before:
            params["trade_date"] = f"lt.{before}"
        response = self._request("GET", "market_index_radar_snapshot", params=params)
        return list(reversed(response.json()))

    def delete_radar_snapshot_dates(self, trade_dates: list[str]) -> None:
        for date_batch in chunks(sorted(set(trade_dates)), 100):
            self._request(
                "DELETE",
                "market_index_radar_snapshot",
                params={"provider": f"eq.{PROVIDER}", "trade_date": f"in.({','.join(date_batch)})"},
                headers={**self.headers, "Prefer": "return=minimal"},
            )

    def prune_radar_snapshots_before(self, cutoff: str) -> None:
        self._request(
            "DELETE",
            "market_index_radar_snapshot",
            params={"provider": f"eq.{PROVIDER}", "trade_date": f"lt.{cutoff}"},
            headers={**self.headers, "Prefer": "return=minimal"},
        )

    def upsert_radar_snapshots(self, rows: list[dict]) -> None:
        if not rows:
            return
        headers = {**self.headers, "Prefer": "resolution=merge-duplicates,return=minimal"}
        payload = [{**row, "computed_at": utc_now()} for row in rows]
        for batch in chunks(payload, 100):
            self._request(
                "POST",
                "market_index_radar_snapshot?on_conflict=provider,trade_date",
                headers=headers,
                data=json.dumps(batch, ensure_ascii=False, separators=(",", ":")),
                timeout=120,
            )

    def get_etf_catalog(self) -> list[dict]:
        rows: list[dict] = []
        offset = 0
        while True:
            response = self._request(
                "GET",
                "market_etf_catalog",
                params={
                    "select": "*",
                    "provider": f"eq.{PROVIDER}",
                    "order": "market.asc,code.asc",
                    "limit": "1000",
                    "offset": str(offset),
                },
            )
            page = response.json()
            rows.extend(page)
            if len(page) < 1000:
                return rows
            offset += len(page)

    def upsert_etf_catalog(self, rows: list[dict]) -> None:
        if not rows:
            return
        headers = {**self.headers, "Prefer": "resolution=merge-duplicates,return=minimal"}
        for batch in chunks(rows):
            self._request(
                "POST",
                "market_etf_catalog?on_conflict=provider,market,code",
                headers=headers,
                data=json.dumps(batch, ensure_ascii=False, separators=(",", ":")),
            )

    def load_etf_history(self, catalog: list[dict], start_date: str) -> list[dict]:
        """Read only reviewed ETF symbols plus CSI300; never all market rows."""
        symbols = {
            (str(row.get("market", "")), str(row.get("code", "")))
            for row in catalog if row.get("active", True) and row.get("radar_enabled")
        }
        symbols.add((BENCHMARK_MARKET, BENCHMARK_CODE))
        rows: list[dict] = []
        for market in ("SH", "SZ"):
            codes = sorted(code for item_market, code in symbols if item_market == market)
            for code_batch in chunks(codes, INDEX_QUERY_CODE_BATCH):
                offset = 0
                while True:
                    response = self._request(
                        "GET",
                        "market_daily_bar",
                        params={
                            "select": "market,code,trade_date,close,pct_chg,trade_status,amount",
                            "provider": f"eq.{PROVIDER}",
                            "market": f"eq.{market}",
                            "code": f"in.({','.join(code_batch)})",
                            "trade_date": f"gte.{start_date}",
                            "order": "trade_date.asc,code.asc",
                            "limit": "1000",
                            "offset": str(offset),
                        },
                        timeout=120,
                    )
                    page = response.json()
                    rows.extend(page)
                    if len(page) < 1000:
                        break
                    offset += len(page)
        return rows

    def get_etf_radar_snapshots(self, scope: str, limit: int = 30, before: str | None = None) -> list[dict]:
        params = {
            "select": "*",
            "provider": f"eq.{PROVIDER}",
            "scope": f"eq.{scope}",
            "order": "trade_date.desc",
            "limit": str(limit),
        }
        if before:
            params["trade_date"] = f"lt.{before}"
        response = self._request("GET", "market_etf_radar_snapshot", params=params)
        return list(reversed(response.json()))

    def delete_etf_radar_snapshot_dates(self, scope: str, trade_dates: list[str]) -> None:
        for date_batch in chunks(sorted(set(trade_dates)), 100):
            self._request(
                "DELETE",
                "market_etf_radar_snapshot",
                params={
                    "provider": f"eq.{PROVIDER}",
                    "scope": f"eq.{scope}",
                    "trade_date": f"in.({','.join(date_batch)})",
                },
                headers={**self.headers, "Prefer": "return=minimal"},
            )

    def prune_etf_radar_snapshots_before(self, scope: str, cutoff: str) -> None:
        self._request(
            "DELETE",
            "market_etf_radar_snapshot",
            params={"provider": f"eq.{PROVIDER}", "scope": f"eq.{scope}", "trade_date": f"lt.{cutoff}"},
            headers={**self.headers, "Prefer": "return=minimal"},
        )

    def upsert_etf_radar_snapshots(self, rows: list[dict]) -> None:
        if not rows:
            return
        headers = {**self.headers, "Prefer": "resolution=merge-duplicates,return=minimal"}
        payload = [{**row, "computed_at": utc_now()} for row in rows]
        for batch in chunks(payload, 100):
            self._request(
                "POST",
                "market_etf_radar_snapshot?on_conflict=provider,scope,trade_date",
                headers=headers,
                data=json.dumps(batch, ensure_ascii=False, separators=(",", ":")),
                timeout=120,
            )

    def prune_etf_before(self, cutoff: str, catalog: list[dict]) -> None:
        """Delete old rows only for catalogued ETF codes.

        This method must stay separate from ``prune_before``: a global
        144-session cutoff would destroy the 400-session A-share/index store.
        """
        for market in ("SH", "SZ"):
            codes = sorted({
                str(row.get("code", "")) for row in catalog
                if row.get("market") == market and len(str(row.get("code", ""))) == 6
            })
            for code_batch in chunks(codes, INDEX_QUERY_CODE_BATCH):
                self._request(
                    "DELETE",
                    "market_daily_bar",
                    params={
                        "provider": f"eq.{PROVIDER}",
                        "market": f"eq.{market}",
                        "code": f"in.({','.join(code_batch)})",
                        "trade_date": f"lt.{cutoff}",
                    },
                    headers={**self.headers, "Prefer": "return=minimal"},
                    timeout=120,
                )


class BaoStockClient:
    def __init__(self, timeout_seconds: int = 45) -> None:
        import baostock as bs

        self.bs = bs
        self.timeout_seconds = timeout_seconds
        socket.setdefaulttimeout(timeout_seconds)
        self.connected = False

    def connect(self) -> None:
        last_error: Exception | None = None
        for attempt in range(1, 4):
            try:
                print(f"[BaoStock] login attempt {attempt}/3...", flush=True)
                login = self.bs.login()
                if login.error_code != "0":
                    raise RuntimeError(f"BaoStock {login.error_code}: {login.error_msg}")
                self.connected = True
                return
            except Exception as exc:
                last_error = exc
                self.close()
                if attempt < 3:
                    delay = 2 ** (attempt - 1)
                    print(f"      login failed; retrying in {delay}s: {exc}", flush=True)
                    time_module.sleep(delay)
        raise RuntimeError(f"BaoStock login failed after 3 attempts: {last_error}")

    def close(self) -> None:
        try:
            if self.connected:
                self.bs.logout()
        except Exception:
            pass
        self.connected = False

    def reconnect(self) -> None:
        self.close()
        self.connect()

    def query(self, label: str, factory: Callable[[], object]) -> list[dict]:
        last_error: Exception | None = None
        for attempt in range(1, 4):
            try:
                return collect_query(factory())
            except Exception as exc:
                last_error = exc
                if attempt < 3:
                    delay = 2 ** (attempt - 1)
                    print(f"      {label} attempt {attempt}/3 failed; reconnecting in {delay}s: {exc}", flush=True)
                    time_module.sleep(delay)
                    self.reconnect()
        raise RuntimeError(f"{label} failed after 3 attempts: {last_error}")

    def trading_dates(self, start: date, end: date) -> list[str]:
        rows = self.query(
            "trading calendar",
            lambda: self.bs.query_trade_dates(start_date=start.isoformat(), end_date=end.isoformat()),
        )
        return [row["calendar_date"] for row in rows if row.get("is_trading_day") == "1"]

    def daily_a_shares(self, trade_date: str) -> list[dict]:
        return self.query(
            f"all A shares for {trade_date}",
            lambda: self.bs.query_daily_history_k_AStock(date=trade_date),
        )

    def daily_etfs(self, trade_date: str) -> list[dict]:
        return self.query(
            f"all ETFs for {trade_date}",
            lambda: self.bs.query_daily_history_k_ETF(date=trade_date),
        )

    def all_securities(self, trade_date: str) -> list[dict]:
        return self.query(
            f"all securities for {trade_date}",
            lambda: self.bs.query_all_stock(day=trade_date),
        )

    def index_history(self, symbol: str, start: str, end: str) -> list[dict]:
        return self.query(
            f"{symbol} index history",
            lambda: self.bs.query_history_k_data_plus(
                symbol,
                "date,code,high,low,close,pctChg,tradestatus",
                start_date=start,
                end_date=end,
                frequency="d",
                adjustflag="3",
            ),
        )

    def history(self, symbol: str, start: str, end: str, adjustflag: str) -> list[dict]:
        return self.query(
            f"{symbol} history adjustflag={adjustflag}",
            lambda: self.bs.query_history_k_data_plus(
                symbol,
                "date,code,close,pctChg,tradestatus",
                start_date=start,
                end_date=end,
                frequency="d",
                adjustflag=adjustflag,
            ),
        )


def recent_trading_dates(client: BaoStockClient, sessions: int, cutoff: date) -> list[str]:
    lookback_days = max(700, sessions * 2)
    dates = client.trading_dates(cutoff - timedelta(days=lookback_days), cutoff)
    if len(dates) < sessions:
        raise RuntimeError(f"Only {len(dates)} trading dates returned; {sessions} required.")
    return dates[-sessions:]


def sync_one_date(client: BaoStockClient, db: SupabaseRest, trade_date: str) -> int:
    print(f"[SYNC] {trade_date}: downloading full A-share snapshot...", flush=True)
    raw_rows = client.daily_a_shares(trade_date)
    rows = normalize_daily_rows(raw_rows, utc_now())
    if len(rows) < MIN_DAILY_ROWS:
        raise RuntimeError(
            f"{trade_date} returned only {len(rows):,} valid SH/SZ rows; expected at least {MIN_DAILY_ROWS:,}. "
            "Nothing was uploaded and retention was not pruned."
        )
    print(f"      validated {len(rows):,} rows; uploading...", flush=True)
    db.upsert_daily_rows(rows)
    return len(rows)


def run_smoke(client: BaoStockClient, sessions: int) -> None:
    cutoff = completed_market_date()
    dates = recent_trading_dates(client, min(max(sessions, 60), RETENTION_SESSIONS), cutoff)
    start, end = dates[0], dates[-1]
    print(f"[SMOKE] Comparing sh.600000 raw returns with official QFQ ({start}..{end})...", flush=True)
    raw = client.history("sh.600000", start, end, "3")
    official = client.history("sh.600000", start, end, "2")
    if not raw or len(raw) != len(official):
        raise RuntimeError(f"Smoke history mismatch: raw={len(raw)}, qfq={len(official)}")
    reconstructed = reconstruct_front_adjusted(raw)
    max_relative_error = max(
        abs(value - float(row["close"])) / max(abs(float(row["close"])), 1e-12)
        for value, row in zip(reconstructed, official)
    )
    print(f"      rows={len(raw):,}, max relative error={max_relative_error:.8f}", flush=True)
    if max_relative_error > 1e-4:
        raise RuntimeError(f"Front-adjusted reconstruction exceeded tolerance: {max_relative_error:.8f}")
    sample = client.daily_a_shares(end)
    valid = normalize_daily_rows(sample, utc_now())
    if len(valid) < MIN_DAILY_ROWS:
        raise RuntimeError(f"Full-market smoke returned only {len(valid):,} valid rows.")
    print(f"PASS: BaoStock full-market endpoint returned {len(valid):,} rows; Supabase was not used.", flush=True)


def run_sync(args, client: BaoStockClient, db: SupabaseRest) -> None:
    cutoff = completed_market_date()
    checkpoint = db.get_checkpoint()
    retention_dates = recent_trading_dates(client, args.sessions, cutoff)
    target_dates: list[str]

    if args.mode == "backfill":
        cursor = checkpoint.get("backfill_cursor")
        target_dates = [value for value in retention_dates if not cursor or value > cursor]
    elif args.mode == "repair":
        if not args.start or not args.end:
            raise ValueError("repair mode requires --start and --end.")
        start_date, end_date = date.fromisoformat(args.start), date.fromisoformat(args.end)
        if start_date > end_date:
            raise ValueError("--start must not be later than --end.")
        target_dates = client.trading_dates(start_date, min(end_date, cutoff))
    else:
        calendar = client.trading_dates(cutoff - timedelta(days=30), cutoff)
        latest = checkpoint.get("latest_trade_date")
        missing = [value for value in calendar if latest and value > latest]
        if not latest:
            missing = calendar[-1:]
        target_dates = missing or [calendar[-1]]
        if len(target_dates) > MAX_DAILY_CATCHUP:
            raise RuntimeError(
                f"Daily sync found {len(target_dates)} missing sessions. Run backfill or repair instead of skipping a large gap."
            )

    if not target_dates:
        print(f"[SYNC] No pending trading dates for {args.mode} mode.", flush=True)
        db.save_checkpoint(
            last_status="ok", last_error=None, last_mode=args.mode,
            retention_sessions=args.sessions,
        )
        return

    print(f"[SYNC] mode={args.mode}, dates={len(target_dates)}, range={target_dates[0]}..{target_dates[-1]}", flush=True)
    try:
        for index, trade_date in enumerate(target_dates, 1):
            print(f"[PROGRESS] {index}/{len(target_dates)}", flush=True)
            row_count = sync_one_date(client, db, trade_date)
            values = {
                "last_status": "running" if index < len(target_dates) else "ok",
                "last_error": None,
                "last_mode": args.mode,
                "last_row_count": row_count,
                "latest_trade_date": max(str(checkpoint.get("latest_trade_date") or trade_date), trade_date),
                "oldest_trade_date": retention_dates[0],
                "retention_sessions": args.sessions,
            }
            if args.mode == "backfill":
                values["backfill_cursor"] = trade_date
            db.save_checkpoint(**values)
            checkpoint.update(values)
    except Exception as exc:
        db.save_checkpoint(
            last_status="error", last_error=str(exc)[:1000], last_mode=args.mode,
            retention_sessions=args.sessions,
        )
        raise

    cutoff_date = retention_dates[0]
    print(f"[RETENTION] Removing rows before {cutoff_date}; keeping {args.sessions} trading sessions...", flush=True)
    db.prune_before(cutoff_date)
    db.save_checkpoint(
        last_status="ok", last_error=None, last_mode=args.mode,
        oldest_trade_date=cutoff_date,
        latest_trade_date=max(str(checkpoint.get("latest_trade_date") or target_dates[-1]), target_dates[-1]),
        retention_sessions=args.sessions,
    )
    print("[OK] Full-market synchronization completed.", flush=True)


def discover_index_catalog(client: BaoStockClient, db: SupabaseRest | None, trade_date: str) -> list[dict]:
    raw = client.all_securities(trade_date)
    discovered = normalize_index_universe(raw)
    if len(discovered) < MIN_INDEX_COUNT:
        raise RuntimeError(
            f"Index discovery returned only {len(discovered):,} SH.000/SZ.399 rows; "
            f"expected at least {MIN_INDEX_COUNT:,}."
        )
    enabled = sum(1 for row in discovered if row["radar_enabled"] and row["active"])
    print(f"[INDEX] discovered={len(discovered):,}, radar-enabled={enabled:,}", flush=True)
    unseeded = [row for row in discovered if not is_seeded_index(row["market"], row["code"])]
    if unseeded:
        sample = ", ".join(f"{row['market']}.{row['code']} {row['name']}" for row in unseeded[:8])
        print(
            f"[INDEX CLASSIFICATION WARNING] {len(unseeded):,} code(s) are absent from Radar universe v{RADAR_UNIVERSE_VERSION}; "
            f"they remain category=other and Radar-disabled. Sample: {sample}",
            flush=True,
        )
    if db is None:
        return discovered

    existing = {symbol_key(row["market"], row["code"]): row for row in db.get_index_catalog()}
    synced_at = utc_now()
    merged: list[dict] = []
    seen: set[str] = set()
    for row in discovered:
        key = symbol_key(row["market"], row["code"])
        seen.add(key)
        merged.append({**existing.get(key, {}), **row, "synced_at": synced_at})
    for key, row in existing.items():
        if key in seen:
            continue
        # A delisted/already-inactive code is absent from today's provider
        # universe, but it is still part of the reviewed catalog contract.
        # Re-apply the code-keyed seed so every retained row is upgraded when
        # Universe changes instead of leaving old inactive rows on v1.
        classification = classify_index(row["market"], row["code"], row.get("name", ""))
        merged.append({
            **row,
            **classification,
            "active": False,
            "universe_version": RADAR_UNIVERSE_VERSION,
            "synced_at": synced_at,
        })
    db.upsert_index_catalog(merged)
    return sorted(merged, key=lambda item: (item["market"], item["code"]))


def run_index_smoke(client: BaoStockClient, sessions: int) -> None:
    cutoff = completed_market_date()
    dates = recent_trading_dates(client, min(max(sessions, 62), RETENTION_SESSIONS), cutoff)
    catalog = discover_index_catalog(client, None, dates[-1])
    samples = ["sh.000300", "sh.000032", "sz.399812"]
    for symbol in samples:
        rows = client.index_history(symbol, dates[0], dates[-1])
        persistent, _ = normalize_index_rows(rows, utc_now())
        if len(persistent) < 60:
            raise RuntimeError(f"Index smoke {symbol} returned only {len(persistent)} valid sessions.")
        print(f"      {symbol}: {len(persistent):,} official sessions", flush=True)
    enabled = sum(1 for row in catalog if row["radar_enabled"] and row["active"])
    if enabled < 50:
        raise RuntimeError(f"Only {enabled} industry/theme indices were classified; expected at least 50.")
    print(
        f"PASS: BaoStock index endpoint returned {len(catalog):,} indices; "
        f"{enabled:,} are eligible by catalog rules. Supabase was not used.",
        flush=True,
    )


def _catalog_progress_row(item: dict, rows: list[dict], status: str = "ok", error: str | None = None) -> dict:
    dates = sorted(str(row["trade_date"]) for row in rows)
    previous_from = str(item.get("history_from") or "")
    previous_latest = str(item.get("latest_trade_date") or "")
    return {
        **item,
        "history_from": min([value for value in (previous_from, dates[0] if dates else "") if value], default=None),
        "latest_trade_date": max([value for value in (previous_latest, dates[-1] if dates else "") if value], default=None),
        "last_status": status,
        "last_error": error,
        "synced_at": utc_now(),
    }


def _history_start_for_radar(retention_dates: list[str], target_dates: list[str], full_rebuild: bool) -> str:
    if full_rebuild or not target_dates:
        return retention_dates[0]
    first_index = retention_dates.index(target_dates[0])
    return retention_dates[max(0, first_index - 100)]


def publish_radar_snapshots(db: SupabaseRest, snapshots: list[dict], target_dates: list[str], retention_start: str) -> None:
    """Publish validated snapshots before any cleanup of the prior valid set."""
    built_dates = {snapshot["trade_date"] for snapshot in snapshots}
    first_built_index = target_dates.index(snapshots[0]["trade_date"])
    missing_after_history_warmup = [value for value in target_dates[first_built_index:] if value not in built_dates]
    if missing_after_history_warmup:
        raise RuntimeError(
            f"Radar snapshot sequence has {len(missing_after_history_warmup)} gap(s) after history warmup; "
            f"first missing date is {missing_after_history_warmup[0]}."
        )

    # Publish first. Cleanup happens only after every snapshot batch succeeds so
    # a failed repair/backfill cannot erase the last valid leaderboard.
    db.upsert_radar_snapshots(snapshots)
    db.delete_radar_snapshot_dates(target_dates[:first_built_index])
    db.prune_radar_snapshots_before(retention_start)


def _run_index_sync(args, client: BaoStockClient, db: SupabaseRest) -> None:
    cutoff = completed_market_date()
    retention_dates = recent_trading_dates(client, args.sessions, cutoff)
    latest_date = retention_dates[-1]
    catalog = discover_index_catalog(client, db, latest_date)
    active = [row for row in catalog if row.get("active", True)]
    if len(active) < MIN_INDEX_COUNT:
        raise RuntimeError(f"Only {len(active):,} active indices remain after catalog reconciliation.")

    if args.mode == "repair":
        if not args.start or not args.end:
            raise ValueError("repair mode requires --start and --end.")
        requested_start, requested_end = date.fromisoformat(args.start), date.fromisoformat(args.end)
        if requested_start > requested_end:
            raise ValueError("--start must not be later than --end.")
        fetch_start = requested_start.isoformat()
        fetch_end = min(requested_end, cutoff).isoformat()
    elif args.mode == "backfill":
        fetch_start, fetch_end = retention_dates[0], latest_date
    else:
        fetch_start, fetch_end = retention_dates[-5], latest_date

    checkpoint = db.get_checkpoint(INDEX_SCOPE)
    db.save_checkpoint(
        INDEX_SCOPE,
        last_status="running",
        last_error=None,
        last_mode=args.mode,
        retention_sessions=args.sessions,
        last_row_count=len(active),
    )
    intraday_by_symbol: dict[str, dict[str, dict]] = {}
    uploaded_rows = 0
    try:
        for index, item in enumerate(active, 1):
            if args.mode == "backfill":
                history_from = str(item.get("history_from") or "")
                history_latest = str(item.get("latest_trade_date") or "")
                if history_from and history_from <= fetch_start and history_latest and history_latest >= fetch_end and item.get("last_status") == "ok":
                    continue
            symbol = f"{item['market'].lower()}.{item['code']}"
            symbol_start = fetch_start
            if args.mode == "daily" and not item.get("history_from"):
                symbol_start = retention_dates[0]
            raw_rows = client.index_history(symbol, symbol_start, fetch_end)
            persistent, transient = normalize_index_rows(raw_rows, utc_now())
            if not persistent:
                updated = _catalog_progress_row(item, [], "insufficient", "No valid official index rows returned.")
                db.upsert_index_catalog([updated])
                item.update(updated)
                continue
            db.upsert_daily_rows(persistent)
            uploaded_rows += len(persistent)
            intraday_by_symbol.update(transient)
            updated = _catalog_progress_row(item, persistent)
            db.upsert_index_catalog([updated])
            item.update(updated)
            if index == 1 or index % 25 == 0 or index == len(active):
                print(f"[INDEX PROGRESS] {index}/{len(active)} symbols; uploaded={uploaded_rows:,}", flush=True)
    except Exception as exc:
        db.save_checkpoint(
            INDEX_SCOPE,
            last_status="error",
            last_error=str(exc)[:1000],
            last_mode=args.mode,
            retention_sessions=args.sessions,
            last_row_count=len(active),
        )
        raise

    catalog = db.get_index_catalog()
    latest_snapshots = db.get_radar_snapshots(limit=1)
    latest_snapshot = latest_snapshots[-1] if latest_snapshots else None
    version_changed = bool(latest_snapshot) and (
        int(latest_snapshot.get("algorithm_version") or 0) != RADAR_ALGORITHM_VERSION
        or int(latest_snapshot.get("universe_version") or 0) != RADAR_UNIVERSE_VERSION
    )
    full_rebuild = args.mode in ("backfill", "repair") or not latest_snapshot or version_changed
    if full_rebuild:
        target_dates = retention_dates
        prior_snapshots: list[dict] = []
    else:
        last_snapshot_date = str(latest_snapshot.get("trade_date") or "")
        target_dates = [value for value in retention_dates[-5:] if value > last_snapshot_date]
        if not target_dates:
            target_dates = [latest_date]
        prior_snapshots = db.get_radar_snapshots(limit=30, before=target_dates[0])

    history_start = _history_start_for_radar(retention_dates, target_dates, full_rebuild)
    print(f"[RADAR] loading official index history from {history_start}...", flush=True)
    market_rows = db.load_index_history(catalog, history_start)
    print(f"      loaded {len(market_rows):,} persistent rows; building snapshots...", flush=True)
    snapshots = build_historical_snapshots(
        catalog,
        market_rows,
        target_dates,
        prior_snapshots=prior_snapshots,
        intraday_by_symbol=intraday_by_symbol,
    )
    expected_latest = target_dates[-1]
    if not snapshots or snapshots[-1]["trade_date"] != expected_latest:
        enabled_count = sum(1 for row in catalog if row.get("active", True) and row.get("radar_enabled"))
        raise RuntimeError(
            f"Radar did not produce the expected {expected_latest} snapshot. "
            f"Check benchmark history and the {MIN_RADAR_COVERAGE:.0%} coverage gate across {enabled_count} enabled indices."
        )
    publish_radar_snapshots(db, snapshots, target_dates, retention_dates[0])

    print(f"[INDEX RETENTION] keeping {args.sessions} official sessions from {retention_dates[0]}...", flush=True)
    db.prune_before(retention_dates[0])
    db.save_checkpoint(
        INDEX_SCOPE,
        last_status="ok",
        last_error=None,
        last_mode=args.mode,
        latest_trade_date=latest_date,
        oldest_trade_date=retention_dates[0],
        retention_sessions=args.sessions,
        last_row_count=len(active),
    )
    print(f"[OK] Index sync completed; published {len(snapshots):,} Radar snapshot(s).", flush=True)


def run_index_sync(args, client: BaoStockClient, db: SupabaseRest) -> None:
    """Run index synchronization and persist every terminal failure on CN_INDEX."""
    try:
        _run_index_sync(args, client, db)
    except Exception as exc:
        try:
            db.save_checkpoint(
                INDEX_SCOPE,
                last_status="error",
                last_error=str(exc)[:1000],
                last_mode=args.mode,
                retention_sessions=args.sessions,
            )
        except Exception as checkpoint_error:
            print(f"[INDEX CHECKPOINT WARNING] Could not record failure: {checkpoint_error}", flush=True)
        raise


def discover_etf_catalog(
    client: BaoStockClient,
    db: SupabaseRest | None,
    trade_date: str,
    raw_etf_rows: list[dict] | None = None,
) -> tuple[list[dict], list[dict]]:
    """Discover every ETF but enable Radar only for reviewed code seeds."""
    raw_etf_rows = list(raw_etf_rows) if raw_etf_rows is not None else client.daily_etfs(trade_date)
    if len(raw_etf_rows) < MIN_ETF_DAILY_ROWS:
        raise RuntimeError(
            f"ETF discovery returned only {len(raw_etf_rows):,} rows for {trade_date}; "
            f"expected at least {MIN_ETF_DAILY_ROWS:,}."
        )
    names: dict[str, str] = {}
    try:
        for row in client.all_securities(trade_date):
            raw = str(row.get("code", "")).strip().lower()
            name = str(row.get("code_name", row.get("name", ""))).strip()
            if raw and name:
                names[raw] = name
    except Exception as exc:
        # Names are display metadata. A transient all-stock lookup must not
        # prevent raw ETF synchronization when the code-keyed seed is enough.
        print(f"[ETF NAME WARNING] Could not refresh official names: {exc}", flush=True)

    discovered = normalize_etf_universe(raw_etf_rows, names)
    enabled = sum(1 for row in discovered if row["radar_enabled"] and row["active"])
    print(f"[ETF] discovered={len(discovered):,}, radar-enabled={enabled:,}", flush=True)
    unseeded = [row for row in discovered if not is_seeded_etf(row["market"], row["code"])]
    if unseeded:
        sample = ", ".join(f"{row['market']}.{row['code']} {row['name']}" for row in unseeded[:8])
        print(
            f"[ETF CLASSIFICATION WARNING] {len(unseeded):,} code(s) are absent from ETF universe "
            f"v{ETF_RADAR_UNIVERSE_VERSION}; raw rows remain stored but Radar-disabled. Sample: {sample}",
            flush=True,
        )
    if db is None:
        return discovered, raw_etf_rows

    existing = {symbol_key(row["market"], row["code"]): row for row in db.get_etf_catalog()}
    synced_at = utc_now()
    merged: list[dict] = []
    seen: set[str] = set()
    for row in discovered:
        key = symbol_key(row["market"], row["code"])
        seen.add(key)
        merged.append({**existing.get(key, {}), **row, "synced_at": synced_at})
    for key, row in existing.items():
        if key in seen:
            continue
        # Preserve inactive/delisted records and still apply the reviewed v2
        # classification. Otherwise an already-inactive row that is no longer
        # returned by BaoStock would never be included in the publication
        # upsert and could remain on the previous Universe indefinitely.
        classification = classify_etf(row["market"], row["code"], row.get("name", ""))
        merged.append({
            **row,
            **classification,
            "active": False,
            "universe_version": ETF_RADAR_UNIVERSE_VERSION,
            "synced_at": synced_at,
        })
    db.upsert_etf_catalog(merged)
    return sorted(merged, key=lambda item: (item["market"], item["code"])), raw_etf_rows


def run_etf_smoke(client: BaoStockClient, sessions: int) -> None:
    cutoff = completed_market_date()
    dates = recent_trading_dates(client, max(62, min(sessions, ETF_RETENTION_SESSIONS)), cutoff)
    raw_rows: list[dict] = []
    trade_date = dates[-1]
    # BaoStock can publish the trade calendar shortly before the bulk ETF
    # snapshot. Look back up to five official sessions for a diagnostic sample.
    for candidate_date in reversed(dates[-5:]):
        raw_rows = client.daily_etfs(candidate_date)
        if len(raw_rows) >= MIN_ETF_DAILY_ROWS:
            trade_date = candidate_date
            break
    catalog, _ = discover_etf_catalog(client, None, trade_date, raw_rows)
    normalized, _ = normalize_etf_rows(raw_rows, utc_now())
    if len(normalized) < MIN_ETF_DAILY_ROWS:
        raise RuntimeError(f"ETF smoke returned only {len(normalized):,} valid rows.")
    amount_count = sum(row.get("amount") is not None for row in normalized)
    if amount_count / len(normalized) < MIN_RADAR_COVERAGE:
        raise RuntimeError(f"ETF smoke amount coverage is only {amount_count}/{len(normalized)}.")
    scopes = {row.get("radar_scope") for row in catalog if row.get("radar_enabled")}
    if not set(ETF_SCOPES).issubset(scopes):
        raise RuntimeError("Reviewed ETF catalog does not expose both EQUITY_ETF and CROSS_ASSET scopes.")
    print(
        f"PASS: BaoStock ETF endpoint returned {len(normalized):,} rows for {trade_date}; "
        f"amount coverage={amount_count/len(normalized):.1%}. Supabase was not used.",
        flush=True,
    )


def _etf_catalog_progress(catalog: list[dict], rows: list[dict]) -> list[dict]:
    by_key: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        by_key[symbol_key(row["market"], row["code"])].append(str(row["trade_date"]))
    synced_at = utc_now()
    updated: list[dict] = []
    for item in catalog:
        dates = sorted(by_key.get(symbol_key(item["market"], item["code"]), []))
        if not dates:
            continue
        previous_from = str(item.get("history_from") or "")
        previous_latest = str(item.get("latest_trade_date") or "")
        row = {
            **item,
            "history_from": min(value for value in (previous_from, dates[0]) if value),
            "latest_trade_date": max(value for value in (previous_latest, dates[-1]) if value),
            "last_status": "ok",
            "last_error": None,
            "synced_at": synced_at,
        }
        item.update(row)
        updated.append(row)
    return updated


def publish_etf_radar_snapshots(
    db: SupabaseRest,
    scope: str,
    snapshots: list[dict],
    target_dates: list[str],
    retention_start: str,
) -> None:
    built_dates = {snapshot["trade_date"] for snapshot in snapshots}
    if not snapshots:
        raise RuntimeError(f"{scope} produced no Radar snapshots.")
    first_built_index = target_dates.index(snapshots[0]["trade_date"])
    missing = [value for value in target_dates[first_built_index:] if value not in built_dates]
    if missing:
        raise RuntimeError(f"{scope} snapshot sequence has {len(missing)} gap(s); first is {missing[0]}.")
    db.upsert_etf_radar_snapshots(snapshots)
    db.delete_etf_radar_snapshot_dates(scope, target_dates[:first_built_index])
    db.prune_etf_radar_snapshots_before(scope, retention_start)


def _etf_target_dates(args, client: BaoStockClient, retention_dates: list[str], cutoff: date, checkpoint: dict) -> list[str]:
    if args.mode == "backfill":
        cursor = str(checkpoint.get("backfill_cursor") or "")
        return [value for value in retention_dates if not cursor or value > cursor]
    if args.mode == "repair":
        if not args.start or not args.end:
            raise ValueError("repair mode requires --start and --end.")
        start_date, end_date = date.fromisoformat(args.start), date.fromisoformat(args.end)
        if start_date > end_date:
            raise ValueError("--start must not be later than --end.")
        return [
            value for value in client.trading_dates(start_date, min(end_date, cutoff))
            if value >= retention_dates[0]
        ]
    # Daily intentionally re-fetches five sessions so delayed amount/pctChg
    # corrections are idempotently incorporated.
    return retention_dates[-5:]


def _etf_catalog_history_start(catalog: list[dict]) -> str | None:
    """Return the earliest ETF session that is known to contain stored rows."""
    dates = [str(row.get("history_from") or "") for row in catalog]
    available = [value for value in dates if value]
    return min(available) if available else None


def _is_skippable_etf_leading_gap(
    mode: str,
    trade_date: str,
    raw_rows: list[dict],
    coverage_start: str | None,
) -> bool:
    """Allow only an empty provider prefix before the first known ETF session.

    A non-empty but malformed/small response is never skipped. Once official
    ETF history has begun, an empty date is a real sequence gap and remains a
    hard failure.
    """
    return (
        mode == "backfill"
        and not raw_rows
        and (coverage_start is None or trade_date < coverage_start)
    )


def _run_etf_sync(args, client: BaoStockClient, db: SupabaseRest) -> None:
    cutoff = completed_market_date()
    retention_dates = recent_trading_dates(client, args.etf_sessions, cutoff)
    latest_date = retention_dates[-1]
    latest_raw = client.daily_etfs(latest_date)
    if len(latest_raw) < MIN_ETF_DAILY_ROWS:
        # A just-finished session may not have reached the bulk endpoint yet.
        for candidate_date in reversed(retention_dates[-5:-1]):
            candidate = client.daily_etfs(candidate_date)
            if len(candidate) >= MIN_ETF_DAILY_ROWS:
                latest_date, latest_raw = candidate_date, candidate
                retention_dates = [value for value in retention_dates if value <= latest_date]
                break
    catalog, latest_raw = discover_etf_catalog(client, db, latest_date, latest_raw)
    known_catalog_keys = {symbol_key(row["market"], row["code"]) for row in catalog}
    checkpoint = db.get_checkpoint(ETF_SCOPE)
    target_dates = _etf_target_dates(args, client, retention_dates, cutoff, checkpoint)
    if not target_dates and args.mode != "backfill":
        print(f"[ETF] No pending dates for {args.mode} mode.", flush=True)
        db.save_checkpoint(
            ETF_SCOPE, last_status="ok", last_error=None, last_mode=args.mode,
            retention_sessions=args.etf_sessions,
        )
        return
    if not target_dates:
        print("[ETF] Raw backfill cursor is complete; validating and rebuilding both Radar scopes...", flush=True)

    db.save_checkpoint(
        ETF_SCOPE,
        last_status="running",
        last_error=None,
        last_mode=args.mode,
        retention_sessions=args.etf_sessions,
        last_row_count=len(catalog),
    )
    latest_cache = {latest_date: latest_raw}
    intraday_by_symbol: dict[str, dict[str, dict]] = {}
    uploaded_rows = 0
    coverage_start = _etf_catalog_history_start(catalog)
    skipped_leading_dates: list[str] = []
    try:
        for position, trade_date in enumerate(target_dates, 1):
            print(f"[ETF PROGRESS] {position}/{len(target_dates)} · {trade_date}", flush=True)
            raw = latest_cache.get(trade_date) or client.daily_etfs(trade_date)
            persistent, transient = normalize_etf_rows(raw, utc_now())
            if len(persistent) < MIN_ETF_DAILY_ROWS:
                if _is_skippable_etf_leading_gap(args.mode, trade_date, raw, coverage_start):
                    skipped_leading_dates.append(trade_date)
                    values = {
                        "last_status": "running",
                        "last_error": None,
                        "last_mode": args.mode,
                        "last_row_count": 0,
                        "retention_sessions": args.etf_sessions,
                        "backfill_cursor": trade_date,
                    }
                    db.save_checkpoint(ETF_SCOPE, **values)
                    checkpoint.update(values)
                    print(
                        f"[ETF COVERAGE] {trade_date} predates BaoStock bulk ETF history; "
                        "recorded as an unavailable leading session and continued.",
                        flush=True,
                    )
                    continue
                raise RuntimeError(
                    f"{trade_date} returned only {len(persistent):,} valid ETF rows; "
                    "nothing was uploaded for that date and the checkpoint did not advance."
                )
            amount_count = sum(row.get("amount") is not None for row in persistent)
            if amount_count / len(persistent) < MIN_RADAR_COVERAGE:
                raise RuntimeError(
                    f"{trade_date} ETF amount coverage is only {amount_count}/{len(persistent)}; upload aborted."
                )
            newly_seen = [
                row for row in normalize_etf_universe(raw)
                if symbol_key(row["market"], row["code"]) not in known_catalog_keys
            ]
            if trade_date != latest_date:
                for row in newly_seen:
                    row["active"] = False
            if newly_seen:
                db.upsert_etf_catalog(newly_seen)
                catalog.extend(newly_seen)
                known_catalog_keys.update(symbol_key(row["market"], row["code"]) for row in newly_seen)
            db.upsert_daily_rows(persistent)
            uploaded_rows += len(persistent)
            if coverage_start is None or trade_date < coverage_start:
                coverage_start = trade_date
                if skipped_leading_dates:
                    print(
                        f"[ETF COVERAGE] BaoStock bulk ETF history begins at {coverage_start}; "
                        f"{len(skipped_leading_dates)} leading session(s) were unavailable. "
                        f"The retention target remains {args.etf_sessions} sessions.",
                        flush=True,
                    )
            for key, values in transient.items():
                intraday_by_symbol.setdefault(key, {}).update(values)
            progress = _etf_catalog_progress(catalog, persistent)
            db.upsert_etf_catalog(progress)
            values = {
                "last_status": "running",
                "last_error": None,
                "last_mode": args.mode,
                "last_row_count": len(persistent),
                "oldest_trade_date": coverage_start,
                "retention_sessions": args.etf_sessions,
            }
            if args.mode == "backfill":
                values["backfill_cursor"] = trade_date
            db.save_checkpoint(ETF_SCOPE, **values)
            checkpoint.update(values)

        catalog = db.get_etf_catalog()
        coverage_start = _etf_catalog_history_start(catalog) or coverage_start
        if coverage_start is None:
            raise RuntimeError(
                "BaoStock returned no valid ETF session inside the requested retention window; "
                "the checkpoint remains incomplete."
            )
        full_rebuild = args.mode in ("backfill", "repair")
        build_plan: dict[str, tuple[list[dict], list[str], list[dict]]] = {}
        for scope in ETF_SCOPES:
            latest_snapshots = db.get_etf_radar_snapshots(scope, limit=1)
            latest_snapshot = latest_snapshots[-1] if latest_snapshots else None
            version_changed = bool(latest_snapshot) and (
                int(latest_snapshot.get("algorithm_version") or 0) != ETF_RADAR_ALGORITHM_VERSION
                or int(latest_snapshot.get("universe_version") or 0) != ETF_RADAR_UNIVERSE_VERSION
            )
            rebuild_scope = full_rebuild or not latest_snapshot or version_changed
            snapshot_dates = retention_dates if rebuild_scope else retention_dates[-5:]
            priors = [] if rebuild_scope else db.get_etf_radar_snapshots(scope, limit=30, before=snapshot_dates[0])
            build_plan[scope] = ([], snapshot_dates, priors)

        print(
            f"[ETF RADAR] loading up to {args.etf_sessions} sessions from {retention_dates[0]} "
            f"(actual provider coverage starts {coverage_start})...",
            flush=True,
        )
        market_rows = db.load_etf_history(catalog, retention_dates[0])
        print(f"      loaded {len(market_rows):,} ETF/benchmark rows; building both scopes...", flush=True)
        for scope, (_, snapshot_dates, priors) in list(build_plan.items()):
            snapshots = build_etf_historical_snapshots(
                catalog,
                market_rows,
                snapshot_dates,
                scope,
                prior_snapshots=priors,
                intraday_by_symbol=intraday_by_symbol,
            )
            if not snapshots or snapshots[-1]["trade_date"] != snapshot_dates[-1]:
                raise RuntimeError(
                    f"{scope} did not produce {snapshot_dates[-1]}; check CSI300, the 95% coverage gate, "
                    f"and the RMB {MIN_AVERAGE_AMOUNT_20D:,.0f} 20D liquidity rule."
                )
            build_plan[scope] = (snapshots, snapshot_dates, priors)

        # Build and validate both scopes before publishing either one.
        for scope, (snapshots, snapshot_dates, _) in build_plan.items():
            publish_etf_radar_snapshots(db, scope, snapshots, snapshot_dates, retention_dates[0])

        print(
            f"[ETF RETENTION] deleting only catalogued ETF rows before {retention_dates[0]}; "
            "A-share/index rows are untouched...",
            flush=True,
        )
        db.prune_etf_before(retention_dates[0], catalog)
        db.save_checkpoint(
            ETF_SCOPE,
            last_status="ok",
            last_error=None,
            last_mode=args.mode,
            latest_trade_date=max(str(checkpoint.get("latest_trade_date") or latest_date), latest_date),
            oldest_trade_date=coverage_start,
            retention_sessions=args.etf_sessions,
            last_row_count=uploaded_rows,
        )
        print("[OK] ETF sync completed; Equity and Cross Asset Radar snapshots published.", flush=True)
    except Exception as exc:
        db.save_checkpoint(
            ETF_SCOPE,
            last_status="error",
            last_error=str(exc)[:1000],
            last_mode=args.mode,
            retention_sessions=args.etf_sessions,
        )
        raise


def run_etf_sync(args, client: BaoStockClient, db: SupabaseRest) -> None:
    """Run ETF synchronization and always persist terminal failure on CN_ETF."""
    try:
        _run_etf_sync(args, client, db)
    except Exception as exc:
        try:
            db.save_checkpoint(
                ETF_SCOPE,
                last_status="error",
                last_error=str(exc)[:1000],
                last_mode=args.mode,
                retention_sessions=args.etf_sessions,
            )
        except Exception as checkpoint_error:
            print(f"[ETF CHECKPOINT WARNING] Could not record failure: {checkpoint_error}", flush=True)
        raise


def parse_args(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(description="BaoStock full-market synchronization")
    parser.add_argument("--mode", choices=("smoke", "daily", "backfill", "repair"), default="daily")
    parser.add_argument("--dataset", choices=("a-shares", "indices", "etfs", "all"), default="all")
    parser.add_argument("--start", help="Repair start date (YYYY-MM-DD)")
    parser.add_argument("--end", help="Repair end date (YYYY-MM-DD)")
    parser.add_argument("--sessions", type=int, default=RETENTION_SESSIONS)
    parser.add_argument("--etf-sessions", type=int, default=ETF_RETENTION_SESSIONS)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not 240 <= args.sessions <= RETENTION_SESSIONS:
        raise ValueError(f"--sessions must be between 240 and {RETENTION_SESSIONS}.")
    if not 120 <= args.etf_sessions <= ETF_RETENTION_SESSIONS:
        raise ValueError(f"--etf-sessions must be between 120 and {ETF_RETENTION_SESSIONS}.")
    client = BaoStockClient()
    client.connect()
    try:
        if args.mode == "smoke":
            if args.dataset in ("a-shares", "all"):
                run_smoke(client, args.sessions)
            if args.dataset in ("indices", "all"):
                run_index_smoke(client, args.sessions)
            if args.dataset in ("etfs", "all"):
                run_etf_smoke(client, args.etf_sessions)
        else:
            db = SupabaseRest()
            if args.dataset in ("a-shares", "all"):
                run_sync(args, client, db)
            if args.dataset in ("indices", "all"):
                run_index_sync(args, client, db)
            if args.dataset in ("etfs", "all"):
                run_etf_sync(args, client, db)
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        raise SystemExit(130)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        raise SystemExit(1)
