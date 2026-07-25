"""Test the official BaoStock client and write market data to local CSV files.

This diagnostic is deliberately isolated from Supabase and application storage.
It verifies login, the daily all-A-share endpoint, and the front-adjusted history
endpoint before the project adopts a full-market synchronization design.
"""
from __future__ import annotations

import argparse
import csv
import importlib.metadata
from pathlib import Path
import sys
import time

import baostock as bs


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = PROJECT_ROOT / "local-market-data"


def collect(result) -> list[list[str]]:
    rows: list[list[str]] = []
    while result.error_code == "0" and result.next():
        rows.append(result.get_row_data())
    if result.error_code != "0":
        raise RuntimeError(f"BaoStock {result.error_code}: {result.error_msg}")
    return rows


def write_csv(path: Path, fields: list[str], rows: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(fields)
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Download BaoStock samples to local CSV files only.")
    parser.add_argument("--date", default="2026-02-05", help="Known trading date for the all-A-share snapshot")
    parser.add_argument("--symbol", default="sh.600000", help="Symbol used for front-adjusted history test")
    parser.add_argument("--start", default="2026-01-19", help="History test start date")
    parser.add_argument("--end", default="2026-02-05", help="History test end date")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Local output directory")
    args = parser.parse_args()

    version = importlib.metadata.version("baostock")
    print(f"[1/4] Official baostock version: {version}", flush=True)
    if not hasattr(bs, "query_daily_history_k_AStock"):
        print("ERROR: This BaoStock build lacks query_daily_history_k_AStock; install baostock>=0.9.3.", file=sys.stderr)
        return 2

    print("[2/4] Connecting to BaoStock (www.baostock.com:10030)...", flush=True)
    started = time.monotonic()
    login = bs.login()
    elapsed = time.monotonic() - started
    print(f"      login code={login.error_code}, message={login.error_msg!r}, elapsed={elapsed:.1f}s", flush=True)
    if login.error_code != "0":
        return 3

    try:
        print(f"[3/4] Downloading all A-share rows for {args.date}...", flush=True)
        daily = bs.query_daily_history_k_AStock(date=args.date)
        daily_rows = collect(daily)
        daily_path = args.output / f"baostock_all_a_{args.date}.csv"
        write_csv(daily_path, daily.fields, daily_rows)
        print(f"      wrote {len(daily_rows):,} rows -> {daily_path}", flush=True)

        print(f"[4/4] Downloading front-adjusted closes for {args.symbol}...", flush=True)
        history = bs.query_history_k_data_plus(
            args.symbol,
            "date,code,close,adjustflag,tradestatus",
            start_date=args.start,
            end_date=args.end,
            frequency="d",
            adjustflag="2",
        )
        history_rows = collect(history)
        history_path = args.output / f"baostock_{args.symbol.replace('.', '_')}_qfq.csv"
        write_csv(history_path, history.fields, history_rows)
        print(f"      wrote {len(history_rows):,} rows -> {history_path}", flush=True)
    finally:
        bs.logout()

    print("PASS: BaoStock data was downloaded and saved locally; Supabase was not used.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
