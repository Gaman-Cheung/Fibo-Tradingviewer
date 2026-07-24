# Fibo Trading Viewer

Static multi-page trading journal and Elliott Wave analysis system for GitHub Pages.

## Entrypoints

- `TradingViewer.html` — authentication for the unified workspace
- `Terminal.html` — Instrument Pool, Look First and Then Leap
- `WaveAnalysis.html` — Elliott Wave analysis

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
