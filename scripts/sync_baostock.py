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
    from .index_radar import (
        ALGORITHM_VERSION as RADAR_ALGORITHM_VERSION,
        BENCHMARK_CODE,
        BENCHMARK_MARKET,
        MIN_RADAR_COVERAGE,
        UNIVERSE_VERSION as RADAR_UNIVERSE_VERSION,
        build_historical_snapshots,
        is_seeded_index,
        normalize_index_universe,
        symbol_key,
    )
except ImportError:  # Direct `python scripts/sync_baostock.py` execution.
    from index_radar import (
        ALGORITHM_VERSION as RADAR_ALGORITHM_VERSION,
        BENCHMARK_CODE,
        BENCHMARK_MARKET,
        MIN_RADAR_COVERAGE,
        UNIVERSE_VERSION as RADAR_UNIVERSE_VERSION,
        build_historical_snapshots,
        is_seeded_index,
        normalize_index_universe,
        symbol_key,
    )


PROVIDER = "baostock"
SCOPE = "CN_A"
INDEX_SCOPE = "CN_INDEX"
RETENTION_SESSIONS = 400
MIN_DAILY_ROWS = 4000
MIN_INDEX_COUNT = 450
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
        if key not in seen and row.get("active"):
            merged.append({**row, "active": False, "synced_at": synced_at})
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


def parse_args(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(description="BaoStock full-market synchronization")
    parser.add_argument("--mode", choices=("smoke", "daily", "backfill", "repair"), default="daily")
    parser.add_argument("--dataset", choices=("a-shares", "indices", "all"), default="all")
    parser.add_argument("--start", help="Repair start date (YYYY-MM-DD)")
    parser.add_argument("--end", help="Repair end date (YYYY-MM-DD)")
    parser.add_argument("--sessions", type=int, default=RETENTION_SESSIONS)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not 240 <= args.sessions <= RETENTION_SESSIONS:
        raise ValueError(f"--sessions must be between 240 and {RETENTION_SESSIONS}.")
    client = BaoStockClient()
    client.connect()
    try:
        if args.mode == "smoke":
            if args.dataset in ("a-shares", "all"):
                run_smoke(client, args.sessions)
            if args.dataset in ("indices", "all"):
                run_index_smoke(client, args.sessions)
        else:
            db = SupabaseRest()
            if args.dataset in ("a-shares", "all"):
                run_sync(args, client, db)
            if args.dataset in ("indices", "all"):
                run_index_sync(args, client, db)
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
