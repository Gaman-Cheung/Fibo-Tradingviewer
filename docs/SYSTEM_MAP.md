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
                                                   `-- CN_ETF -> ETF catalog/144-session history/two Radar scopes
```

## Ownership

- Shared permanent identity and Pool reconciliation: `src/core/instrument-identity.js`.
- Versioned local migrations: `src/core/migrations.js`.
- Canonical cross-page Current/VR storage: `src/core/shared-live-inputs.js`; Terminal and Tracker must not create a second owner.
- Supabase payload compatibility: `src/core/cloud-payload.js`.
- Terminal calculations: `src/terminal/`.
- Wave calculations: `src/wave/`.
- Trend calculations: `src/tracker/`; `trend-engine.js` owns the unchanged formulas, `scenario-comparison.js` coordinates simultaneous Flat/Trend/Custom results, `ma-projection.js` derives conditional SMA tails from one selected path, and `chart-model.js` owns display-only history/forecast geometry.
- BaoStock code normalization plus Tracker history and Terminal latest-close queries: `src/core/market-code.js` and `src/core/market-repository.js`.
- Full-market synchronization: GitHub Action and `SyncBaoStock.cmd` both call `scripts/sync_baostock.py`; neither implementation may duplicate sync rules.
- Index classification seed: `scripts/index_catalog_seed_v1.py` owns the reviewed 507-code universe result. Unknown future codes remain `other` and Radar-disabled until an explicit universe-version update.
- ETF classification seed: `scripts/etf_catalog_seed_v1.py` owns reviewed Market+Code classification for Equity ETF and Cross Asset. Discovery stores unknown ETFs as `other`, but runtime never infers a Radar category from the security name.
- Market Radar ranking: pure `scripts/index_radar.py` retains Sector Index v1; pure `scripts/etf_radar.py` reuses its candidate/score semantics and owns ETF liquidity, strict Theme representation and Cross Asset caps. Supabase latest/history reads share `src/core/index-radar-repository.js`; browser normalization, scope-isolated Leadership Memory and help live in `src/radar/`; `src/apps/index-radar-controller.js` owns lazy scope loading, session cache, grids and dialogs. No Radar module imports Pool identity or Terminal algorithms.
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
