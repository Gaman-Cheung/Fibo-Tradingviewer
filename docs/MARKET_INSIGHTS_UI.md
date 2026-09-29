# Market Insights — UI integration

Status: **Insights v1 adapter integrated; online deployment remains manual** (2026-09-29).
Originally UI-only, this module now reads the separately approved independent snapshots.

## Baseline and boundaries

The source is the user-extracted `R:/codex new/Fibo-Tradingviewer-main/`, copied byte-for-byte (126 files) into this independent output workspace. Its initial local Git commit is a comparison snapshot, not the old repository history. No remote is configured or pushed. The 0820 input and the extracted source remain untouched. Existing 0819 refresh/freshness checks, 0820 workspace synchronization, weekday 19:00 Taipei/Shanghai workflow, and all existing algorithm versions remain intact.

For an existing GitHub repository, preserve its real commit history: clone/fetch the actual remote and apply/review this output's changes on that history before publishing. Do not force-push this newly initialized comparison repository over the remote. The old 0820 checkout remains useful as an archive of local history/configuration, but is not the development baseline.

The UI adds no localStorage key or cloud field and never calculates from market prices, Top5 persistence or Pulse values. The separately approved backend owns the new table/migration and publication; see `MARKET_INSIGHTS_GUIDE.md` and `DEPLOY_MARKET_INSIGHTS.md`.

## Ownership

- `src/core/market-insights-source.js`: reads the latest authenticated `market_insights_snapshot` bundle. Missing migration returns `not_configured`; empty table returns `empty`; permission/network/version failures are errors. It never reads old Top5 or raw bars.
- `src/radar/market-insights-view-model.js`: strict presentation validation and display geometry only. It contains no score, weighting, classification or bullish/bearish threshold calculation.
- `src/apps/market-insights-controller.js`: view/window state, independent cache, unavailable/error states, chart rendering and shared help. State is page-session only; windows are isolated by scope.
- `src/apps/market-context-motion.js`: interruptible, token-driven motion honoring reduced-motion preference.
- `src/apps/index-radar-controller.js`: integration into the existing router and help modal. `initializeIndexRadar({client, insightsSource})` supports test injection; production uses the independent read-only repository.
- `assets/css/terminal.css`: composition and new unique visualizations. Shared control-state transitions are owned by `assets/css/components.css`; tokens are unchanged.

## Presentation DTO v1 (not a database wire contract)

The source receives `{scope}` and returns one of:

```js
{status:'not_configured', scan:null, regime:null}
{status:'empty', scan:null, regime:null}
{status:'ready', scan, regime} // at least one independent valid result
```

It may throw on network or publication failure. The controller validates data, isolates scope requests, and retains the last valid result on a refresh failure, with an explicit warning/retry. Cache expiration uses the existing five-minute/Shanghai-day helper, checked on selection and foreground return; no timer is added. Missing results are not filled from another scope. It must be a read-only provider, with no service-role credential in the browser.

`scan` fields:

- `presentationVersion: 1` (UI format only).
- `scope`: `SECTOR_INDEX`, `EQUITY_ETF` or `CROSS_ASSET`, exactly matching the request.
- `tradeDate`: valid official date `YYYY-MM-DD` supplied by the source.
- `algorithmVersion`, `universeVersion`, `coverageLabel`: nonempty strings from the independent publication.
- `levels: {strong: Point[], weak: Point[]}`: current-level results, independent of the selected change window.
- `windows`: optional entries keyed `1`, `3`, `13`, `60`. Each contains `{baselineDate, strengthening: Point[], weakening: Point[]}`. The baseline must precede the common `tradeDate`; the source, not the UI, verifies the actual official-session distance.
- `Point`: `{themeKey, label, radius}`. `themeKey` is a stable market Theme Group, never a Pool permanent ID. `radius` is a source-supplied display normalization in `[0,1]`; 0 is the center, 1 the outer ring. The browser does not derive it from a score. Each panel accepts up to eight unique themes; larger publications need an explicit reviewed display-selection policy in the source.

An absent window means **history unavailable**, not a shorter-window substitute. An empty point array means **no qualifying theme**. A theme may legitimately occur in multiple panels. Theme-key angle is stable across windows; angle has no economic meaning. Version mismatch, wrong scope, malformed dates, duplicates and nonfinite/out-of-range values fail validation rather than producing misleading charts. String fields are bounded and escaped on rendering.

`regime` is independent A-share context even when an ETF scope is selected:

```js
{
  presentationVersion: 1,
  tradeDate: 'YYYY-MM-DD',
  algorithmVersion: 'approved independent version',
  coverageLabel: 'source-owned coverage summary',
  value: 0, // finite 0..100, supplied by the independent algorithm
  label: 'source-owned state label',
  explanation: 'source-owned current drivers and limitations'
}
```

No value or state is generated by the browser. Each result exposes its own date; scan mode hides the old Top 5 date so asynchronous updates cannot mislabel it. Test values in `tests/fixtures/market-insights.js` are synthetic and are not fallback application data.

## Semantics and interactions

- UI density revision (2026-09-29): the A-share strip remains in the centered header slot for every scope, never the footer. Ready copy/value/date and scale interpretation move into help; unavailable/stale states remain explicit. Ranking / Radar and all four panel headings are English. Desktop ≥1330px uses one row of four compact charts with 160px window controls; narrower desktop uses two columns and phones one. Shared button geometry/pressed/focus states are owned by `components.css`; original Ranking/Memory layout is unchanged. No algorithm, source, snapshot or database contract changed.
- 榜单 retains actual Top 5 and Yesterday/3/13/60 Leadership Memory.
- Radar uses those four window labels as selectors. Yesterday means latest official close versus the preceding official session, not a historical page.
- Strong/weak levels stay fixed during window changes. Only strengthening/weakening points move; no looping sweep, blinking or fabricated animation data.
- Shared help explains each panel, data limitations, dates and version provenance. Formula/basket explanations must be extended with the reviewed algorithm before live data is enabled.
- Scope/view/window controls remain usable by keyboard and touch. The new help uses the existing modal, closes with Escape, traps Tab and returns focus to its trigger.

## Live data approval · 2026-09-29

The following original approval checklist is now implemented by Insights v1; see `MARKET_INSIGHTS_GUIDE.md` and `DEPLOY_MARKET_INSIGHTS.md`. The source reads `market_insights_snapshot` and validates the complete bundle. No mock or trial report is bundled as production fallback. Online migration/first publication still requires the user's deployment steps. Missing history remains excluded.

## Original approval checklist (historical)

1. Approve and version the independent strength/change algorithm and A-share regime basket, weights and thresholds. Do not mechanically classify technology as bullish or banks/CSI300 as bearish; verify microcap availability and avoid conflating CNI2000 with CSI2000.
2. Decide server-side full-universe calculation/publication, point selection and coverage policy using the available official close/return history. Current Top 5 and two retained Pulse member calculations are insufficient to reconstruct a 60-session all-universe history.
3. Specify bounded storage and an additive idempotent migration plus regression tests if new persisted snapshots are needed. Verify Supabase headroom before expanding storage; do not delete existing history to make room.
4. Connect the reviewed read-only adapter and enrich help with exact formulas/current drivers. Test failure isolation, version filtering and real official-session alignment before deployment.

## Local configuration repair

The ZIP omitted `.env.local.example` while its launcher and tests require it, and its `.gitignore` lacked environment/cache protection. This output adds a placeholder-only example and ignore rules; no secrets were copied. The baseline's already tracked `.pyc`/diagnostic CSV files are preserved for comparison, not removed automatically. Ignore rules do not untrack historical entries. Review that inherited packaging issue separately before release.
