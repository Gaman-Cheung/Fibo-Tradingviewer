# AI Change Rules

This file is mandatory reading before changing the project.

## Non-negotiable contracts

1. `instrument.id` is the only identity key. Ticker/name is mutable and may repeat.
2. Never merge, delete, reorder or remap records solely because their Tickers match.
3. Do not change trading weights, thresholds, labels or formulas without explicit user authorization.
4. Keep the public entry filenames `TradingViewer.html`, `Terminal.html`, `WaveAnalysis.html`, `TrendTracker.html` and all storage/Supabase wire keys compatible.
5. A data-contract change requires an idempotent migration and a regression test.

## Module boundaries

- `src/core`: shared configuration, identity, storage, migration and cloud wire formats.
- `src/terminal`: pure Look First/Then Leap calculations. No DOM, storage or network access.
- `src/wave`: pure Wave calculations and validation. No DOM, storage or network access.
- `src/tracker`: pure MA, MACD, confirmation and scenario calculations. No DOM, storage or network access.
- `src/apps`: page controllers and rendering adapters. They may access the DOM and call core services.
- `assets/css`: tokens, common components and page-specific presentation.

## Design system

- Read `docs/DESIGN_SYSTEM.md` before creating or restyling any page or shared component.
- `assets/css/tokens.css` is the only owner of shared visual constants and `:root` design variables.
- New page CSS must use semantic tokens, must not copy the legacy aliases, and must not redefine shared tokens.
- Token value changes are cross-system UI changes and require desktop and iPhone regression tests.

Do not copy a core implementation into an app. Do not make a pure algorithm import an app module.

## Required workflow

1. Read `docs/SYSTEM_MAP.md`, `docs/DATA_CONTRACTS.md`, the relevant algorithm section and `docs/DESIGN_SYSTEM.md` for UI work.
2. Change only the owning module and its tests.
3. Run `npm test`. For UI changes also run `npm run test:e2e` in both configured projects.
4. Report exactly which modules and contracts changed. Explicitly say when algorithms were untouched.

## Compatibility

`legacy/2026-07-24` is the frozen pre-modularization reference. Never edit it. Compare against it when a behavior is uncertain.
