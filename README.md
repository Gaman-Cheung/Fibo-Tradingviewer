# Fibo Trading Viewer

Static multi-page trading journal and Elliott Wave analysis system for GitHub Pages.

## Entrypoints

- `TradingViewer.html` — authentication for the unified workspace
- `Terminal.html` — Instrument Pool, Look First and Then Leap
- `WaveAnalysis.html` — Elliott Wave analysis

- `TrendTracker.html` — MA/MACD trend tracking and scenario analysis

## Market sync and Look First Index Radar

1. Apply `supabase/migrations/20260724_trend_tracker.sql`, `supabase/migrations/20260725_baostock_full_market.sql`, then `supabase/migrations/20260729_index_radar.sql` in the Supabase SQL editor.
2. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as GitHub repository Actions secrets.
3. Manually run the **Sync BaoStock full market** Action with `smoke / indices`.
4. After smoke passes, run `backfill / indices`. The 507-index job resumes from per-symbol catalog progress after interruption.
5. Verify the latest Radar snapshot and database capacity, then leave the schedule on `daily / all` at 19:00 Asia/Shanghai on weekdays.

The database stores the latest 400 trading sessions for every SH/SZ A-share. Tracker matches the shared history by explicit Market + six-digit Code; Pool and permanent IDs never own or duplicate prices.

`SyncBaoStock.cmd` is the fallback entry and calls the exact same synchronization core:

```text
SyncBaoStock.cmd smoke
SyncBaoStock.cmd daily
SyncBaoStock.cmd backfill
SyncBaoStock.cmd repair 2026-01-01 2026-01-31
SyncBaoStock.cmd smoke indices
SyncBaoStock.cmd backfill indices
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
