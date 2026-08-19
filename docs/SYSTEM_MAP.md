# System Map

```text
Auth HTML ───────> auth-app ───────> shared Supabase client
Terminal HTML ───> terminal-app ───> identity / storage / cloud contract
                         ├─────────> Fibonacci + Composite Signal
                         ├─────────> index-radar-controller -> latest snapshot + 60-session Leadership Memory
                         └─────────> DOM render and interaction adapters
Wave HTML ───────> wave-app ───────> shared identity / storage / Supabase
                         ├─────────> wave model + validation + math
                         └─────────> tables, tabs, mobile cards and canvas
```

```text
Tracker HTML ----> tracker-app ----> Pool permanent ID + market repository
                         |---------> pure MA / MACD / scenario engine
                         `---------> single-instrument cards and canvas
GitHub Action (primary) -----\
                             > shared BaoStock sync core ----> full-market tables in Supabase
Manual Windows launcher -----/              |
                                            `---- smoke / daily / backfill / repair
                                                   |-- CN_A -> A-share close history
                                                   |-- CN_INDEX -> index catalog/history/Radar snapshots
                                                   |-- CN_PULSE -> official breadth/member snapshots
                                                   `-- CN_ETF -> ETF catalog/144-session history/two Radar scopes
```

## Ownership

- Shared permanent identity and Pool reconciliation: `src/core/instrument-identity.js`.
- Versioned local migrations: `src/core/migrations.js`.
- Canonical cross-page Current/VR storage: `src/core/shared-live-inputs.js`; Terminal and Tracker must not create a second owner.
- Supabase payload compatibility: `src/core/cloud-payload.js`.
- Terminal calculations: `src/terminal/`.
- Wave calculations: `src/wave/`.
- Trend calculations: `src/tracker/`; `trend-engine.js` owns the unchanged formulas, `scenario-comparison.js` coordinates simultaneous Flat/Trend/Custom results, `ma-projection.js` derives conditional SMA tails from one selected visible path, and `chart-model.js` owns display-only history/forecast geometry including the zero-tail all-hidden state.
- BaoStock code normalization plus Tracker history and Terminal latest-close queries: `src/core/market-code.js` and `src/core/market-repository.js`.
- Full-market synchronization: GitHub Action and `SyncBaoStock.cmd` both call `scripts/sync_baostock.py`; neither implementation may duplicate sync rules. A `daily / all` run finishes with one read-only freshness audit over CN_A/CN_INDEX/CN_PULSE/CN_ETF and the four published Market Context snapshot dates.
- Universe review source: `scripts/universe/index_universe_v2.csv` and `scripts/universe/etf_universe_v2.csv` contain the evidenced 507-index / 1,615-ETF review. `scripts/radar_universe_v2.py` validates them, generates deterministic v2 Market+Code seeds and provides the read-only history/capacity Dry Run; `docs/RADAR_UNIVERSE_V2_AUDIT.md` records the accepted baseline and rollout checks.
- Runtime classification seeds: `scripts/index_catalog_seed_v2.py` and `scripts/etf_catalog_seed_v2.py`. Discovery stores a future unknown code as `other`, but runtime never infers a Radar category from the security name. The v1 seeds remain as rollback evidence only.
- Market Radar ranking: pure `scripts/index_radar.py` retains Sector Index v1; pure `scripts/etf_radar.py` reuses its candidate/score semantics and owns ETF liquidity, strict Theme representation and Cross Asset caps. Supabase latest/history reads share `src/core/index-radar-repository.js`; browser normalization, scope-isolated Leadership Memory and help live in `src/radar/`; `src/apps/index-radar-controller.js` owns lazy scope loading, five-minute/Shanghai-day session-cache freshness, foreground refresh, grids and dialogs. No Radar module imports Pool identity or Terminal algorithms.
- FIBO Market Pulse: pure `scripts/market_pulse.py` owns the four 25% breadth groups and member flags; `src/core/market-pulse-repository.js` reads only precomputed snapshots and 50-row member pages; `src/pulse/` owns browser normalization, chart geometry and help; `src/apps/market-pulse-controller.js` owns the isolated four-card dashboard, Canvas and detail filters. The Market Context router defaults to Pulse, places all four scopes in one responsive-height viewport, and keeps all three Radar algorithms and card contents unchanged.
- BaoStock connectivity/local CSV diagnostics: `scripts/test_baostock_local.py`; it never writes Supabase.
- DOM, navigation, drag/drop, modal and responsive behavior: `src/apps/`.
- Shared Push button state and confirmation behavior: `src/apps/cloud-action-feedback.js` plus the shared component states in `assets/css/components.css`.
- The declarative event controller replaces executable HTML event attributes and keeps handlers module-scoped.

The HTML entrypoints contain structure only. Page CSS consumes shared tokens and may not redefine shared tokens or business behavior.

Terminal MACD suggestions load history through the shared market repository, calculate through pure `src/tracker` helpers, and are applied only by the Terminal controller after explicit user confirmation. They never write a score directly.

## Presentation layers

```text
tokens.css -> components.css -> auth.css / terminal.css / wave.css / tracker.css
```

- Shared visual constants and compatibility aliases: `assets/css/tokens.css`.
- Reusable system-neutral UI primitives: `assets/css/components.css`.
- Page layout and page-specific styling: the matching page stylesheet.
- Visual rules and new-system starter pattern: `docs/DESIGN_SYSTEM.md`.

Page CSS consumes semantic tokens and must not own shared `:root` variables.

### Presentation ownership rule

```text
tokens.css       -> values and semantic roles
components.css   -> shared geometry, states and responsive behavior
page.css         -> page composition and unique visualization only
```

- `components.css` exclusively owns the shared Header, Button, Modal, Form Control, Card and Mobile Navigation primitives.
- A page stylesheet may set grid placement, column composition, page-only chart/table geometry and section ordering.
- A page stylesheet may not resize or restyle a shared primitive, reproduce it under a page-prefixed class, or add a later override layer to imitate another system.
- When a pattern is needed by a second page, move its reusable presentation into `components.css` as part of that change; all later pages must consume that shared implementation.
