# System Map

```text
Auth HTML ───────> auth-app ───────> shared Supabase client
Terminal HTML ───> terminal-app ───> identity / storage / cloud contract
                         ├─────────> Fibonacci + Composite Signal
                         └─────────> DOM render and interaction adapters
Wave HTML ───────> wave-app ───────> shared identity / storage / Supabase
                         ├─────────> wave model + validation + math
                         └─────────> tables, tabs, mobile cards and canvas
```

```text
Tracker HTML ----> tracker-app ----> Pool permanent ID + market repository
                         |---------> pure MA / MACD / scenario engine
                         `---------> single-instrument cards and canvas
GitHub Action ----> BaoStock Python ----> additive market tables in Supabase
```

## Ownership

- Shared permanent identity and Pool reconciliation: `src/core/instrument-identity.js`.
- Versioned local migrations: `src/core/migrations.js`.
- Supabase payload compatibility: `src/core/cloud-payload.js`.
- Terminal calculations: `src/terminal/`.
- Wave calculations: `src/wave/`.
- Trend calculations: `src/tracker/`.
- BaoStock code normalization and Tracker queries: `src/core/market-code.js` and `src/core/market-repository.js`.
- DOM, navigation, drag/drop, modal and responsive behavior: `src/apps/`.
- The declarative event controller replaces executable HTML event attributes and keeps handlers module-scoped.

The HTML entrypoints contain structure only. Page CSS consumes shared tokens and may not redefine shared tokens or business behavior.

## Presentation layers

```text
tokens.css -> components.css -> auth.css / terminal.css / wave.css / tracker.css
```

- Shared visual constants and compatibility aliases: `assets/css/tokens.css`.
- Reusable system-neutral UI primitives: `assets/css/components.css`.
- Page layout and page-specific styling: the matching page stylesheet.
- Visual rules and new-system starter pattern: `docs/DESIGN_SYSTEM.md`.

Page CSS consumes semantic tokens and must not own shared `:root` variables.
