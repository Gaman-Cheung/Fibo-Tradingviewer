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


PROVIDER = "baostock"
SCOPE = "CN_A"
RETENTION_SESSIONS = 400
MIN_DAILY_ROWS = 4000
UPLOAD_BATCH_SIZE = 1000
MAX_DAILY_CATCHUP = 5
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

    def get_checkpoint(self) -> dict:
        response = self._request(
            "GET",
            "market_sync_checkpoint",
            params={"select": "*", "provider": f"eq.{PROVIDER}", "scope": f"eq.{SCOPE}", "limit": "1"},
        )
        rows = response.json()
        return rows[0] if rows else {}

    def save_checkpoint(self, **values) -> None:
        row = {"provider": PROVIDER, "scope": SCOPE, "synced_at": utc_now(), **values}
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


def parse_args(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(description="BaoStock full-market synchronization")
    parser.add_argument("--mode", choices=("smoke", "daily", "backfill", "repair"), default="daily")
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
            run_smoke(client, args.sessions)
        else:
            db = SupabaseRest()
            run_sync(args, client, db)
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
