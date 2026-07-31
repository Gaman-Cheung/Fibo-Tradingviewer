# Fibo Trading Viewer

Static multi-page trading journal and Elliott Wave analysis system for GitHub Pages.

## Entrypoints

- `TradingViewer.html` — authentication for the unified workspace
- `Terminal.html` — Instrument Pool, Look First and Then Leap
- `WaveAnalysis.html` — Elliott Wave analysis

- `TrendTracker.html` — MA/MACD trend tracking and scenario analysis

## Market sync and Look First Index Radar

1. Apply `supabase/migrations/20260724_trend_tracker.sql`, `20260725_baostock_full_market.sql`, `20260729_index_radar.sql`, then `20260731_etf_market_radar.sql` in the Supabase SQL editor.
2. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as GitHub repository Actions secrets.
3. Manually run the **Sync BaoStock full market** Action with `smoke / indices`.
4. After smoke passes, run `backfill / indices`. The 507-index job resumes from per-symbol catalog progress after interruption.
5. Validate the reviewed Universe v2 with `npm run audit:radar`; use `npm run audit:radar:dry-run` before publication, then run `daily / indices` followed by `daily / etfs` so version changes rebuild snapshots from stored history.
6. Verify both ETF Scope snapshots and database capacity, then leave the schedule on `daily / all` at 19:00 Asia/Shanghai on weekdays.

The database stores 400 sessions for SH/SZ A-shares and indices, and 144 sessions for ETFs. ETF cleanup is Market+Code scoped and cannot shorten the existing 400-session store. Tracker matches shared history by explicit Market + six-digit Code; Pool and permanent IDs never own or duplicate prices.

`SyncBaoStock.cmd` is the fallback entry and calls the exact same synchronization core:

```text
SyncBaoStock.cmd smoke
SyncBaoStock.cmd daily
SyncBaoStock.cmd backfill
SyncBaoStock.cmd repair 2026-01-01 2026-01-31
SyncBaoStock.cmd smoke indices
SyncBaoStock.cmd backfill indices
SyncBaoStock.cmd smoke etfs
SyncBaoStock.cmd backfill etfs
SyncBaoStock.cmd daily all
```

Smoke does not require or write Supabase. Other local modes create an ignored `.venv`, read the ignored `.env.local`, and write directly to Supabase. The service-role key never enters browser code or Git. `scripts/test_baostock_local.py` remains a separate local-CSV diagnostic.

## Local development

Run `start-local.ps1`, or run:

```powershell
npm install
npm run start
```

Open `http://127.0.0.1:4173/TradingViewer.html`. ES Modules are intentionally not supported through direct `file://` opening.

## Verification

```powershell
npm test
npm run test:sync
npm run test:e2e
```

Read [AGENTS.md](AGENTS.md) before any AI-assisted change.
