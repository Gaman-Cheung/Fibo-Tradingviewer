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
