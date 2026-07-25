# Fibo Trading Viewer

Static multi-page trading journal and Elliott Wave analysis system for GitHub Pages.

## Entrypoints

- `TradingViewer.html` — authentication for the unified workspace
- `Terminal.html` — Instrument Pool, Look First and Then Leap
- `WaveAnalysis.html` — Elliott Wave analysis

- `TrendTracker.html` — MA/MACD trend tracking and scenario analysis

## Trend Tracker market sync

1. Apply `supabase/migrations/20260724_trend_tracker.sql` in the Supabase SQL editor.
2. Add GitHub Actions secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Manually run **Sync BaoStock closes** once; it then runs at 19:30 China time on weekdays.

The service-role key never enters browser code. New symbols backfill 300 sessions, routine runs upsert the latest five sessions, and the workflow's `full_repair` input forces a full refresh.

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
npm run test:e2e
```

Read [AGENTS.md](AGENTS.md) before any AI-assisted change.
