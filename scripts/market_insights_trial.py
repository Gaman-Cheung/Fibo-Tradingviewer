"""Read-only trial runner for the approved independent Market Insights v1 engine."""
import argparse
import json
import os
from pathlib import Path
try:
    from .market_insights import (calculate_insights as run_trial, enabled, key, build_regime, build_scan, group_bars, metrics, basket_symbols)
except ImportError:
    from market_insights import (calculate_insights as run_trial, enabled, key, build_regime, build_scan, group_bars, metrics, basket_symbols)

def live_input(env_file=None):
    if env_file:
        for line in Path(env_file).read_text(encoding="utf-8-sig").splitlines():
            name, separator, value = line.strip().partition("=")
            if separator and name in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
                os.environ[name] = value.strip().strip('"').strip("'")
    if not all(os.environ.get(k) for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")):
        raise ValueError("Server-side connection configuration unavailable")
    from sync_baostock import SupabaseRest
    import requests
    import time

    class ReadOnlyRest(SupabaseRest):
        def __init__(self):
            super().__init__()
            self.session = requests.Session()

        def _request(self, method, path, **kwargs):
            if method != "GET":
                raise RuntimeError("Trial forbids database writes")
            kwargs["timeout"] = (10, 90)
            for attempt in range(3):
                try:
                    response = self.session.get(f"{self.url}/rest/v1/{path}", headers=self.headers, **kwargs)
                    response.raise_for_status()
                    return response
                except requests.RequestException:
                    if attempt == 2:
                        raise RuntimeError(f"Read-only GET {path} failed after three attempts") from None
                    time.sleep(attempt+1)

    db = ReadOnlyRest()
    checkpoints = {scope: db.get_checkpoint(scope) for scope in ("CN_A", "CN_INDEX", "CN_PULSE", "CN_ETF")}
    indices, etfs = db.get_index_catalog(), db.get_etf_catalog()
    benchmark = [item for item in indices if key(item) == "SH:000300"]
    benchmark_rows = db.load_index_history(benchmark, "1900-01-01")
    days = sorted({r["trade_date"] for r in benchmark_rows if enabled(r.get("trade_status"))})
    if not days:
        raise ValueError("Benchmark unavailable")
    # Latest t-60 plus the 62-close warmup: don't download unrelated 400-day histories.
    start = days[max(0, len(days)-122)]
    candidates = [item for item in indices if enabled(item.get("radar_enabled")) and item.get("category") in ("sector", "theme")]
    index_rows = db.load_index_history(candidates+benchmark, start)
    etf_rows = db.load_etf_history(etfs, start)
    pulse_rows = db.get_pulse_snapshots(limit=1)
    return {"index_catalog": indices, "etf_catalog": etfs, "index_rows": index_rows,
            "etf_rows": etf_rows, "pulse": pulse_rows[-1] if pulse_rows else None, "checkpoints": checkpoints}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--live", action="store_true")
    source.add_argument("--input", type=Path, help="Local market-only JSON fixture/export")
    parser.add_argument("--env-file", type=Path, help="Read existing server-side config without copying it")
    parser.add_argument("--output", type=Path, help="New local report file; refuses to overwrite")
    args = parser.parse_args()
    data = live_input(args.env_file) if args.live else json.loads(args.input.read_text(encoding="utf-8"))
    report = run_trial(data)
    rendered = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)
    if args.output:
        with args.output.open("x", encoding="utf-8") as handle:
            handle.write(rendered + "\n")
        print(json.dumps({"report": str(args.output), "tradeDate": report["payload"]["tradeDate"],
                          "storageEstimate": report["storageEstimate"], "regimeMissing": report["regimeMissing"]}, ensure_ascii=False))
    else:
        print(rendered)


if __name__ == "__main__":
    main()
