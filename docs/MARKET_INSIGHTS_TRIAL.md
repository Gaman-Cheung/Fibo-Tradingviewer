# Market Insights · unpublished v1 trial

Historical record: **draft.1 trial before approval** (2026-09-29). The user subsequently approved these rules, including exclusion of missing history. The current normative specification is `MARKET_INSIGHTS_GUIDE.md`; deployment is `DEPLOY_MARKET_INSIGHTS.md`. The trial runner now shares the approved engine and remains GET-only. Statements below describe the earlier trial stage, not current deployment status.

The user approved local trials using read-only access to existing market data,
with a further review before online calculation/publication. No migration,
scheduled job, production source adapter or retention change is enabled here.
Old Index/ETF Radar v1, Pulse v1, Leadership Memory, Pool identity and Composite
Signal remain unchanged. The current UI intentionally still says pending.

## Files and execution

- `scripts/market_insights_trial.py`: independent calculation plus GET-only trial loader.
- `tests/python/test_market_insights_trial.py`: deterministic synthetic regression cases.
- Input: reviewed live v2 catalogs, existing index/ETF bars and matching Pulse v1 aggregate.
- The loader reuses existing REST read methods, but rejects every non-GET request.
- `--env-file` reads an existing server-only configuration without copying it.
- `--output` creates a new local report and refuses to overwrite an existing file.
- No new market download, raw history expansion, database write or deletion.

```powershell
.\.venv\Scripts\python.exe scripts/market_insights_trial.py --live --env-file 'PATH_TO_EXISTING/.env.local' --output '../NEW_TRIAL_REPORT.json'
.\.venv\Scripts\python.exe scripts/market_insights_trial.py --input 'market-only-fixture.json'
```

## Strength candidate, not the old leader score

This candidate measures absolute volatility-scaled technical trend strength.
Within each scope it sorts that strength; it is **not** the old CSI300 RS score,
not a probability and not a new trading recommendation. No old score, bullish
entry gate, event bonus, overextension penalty or Cross Asset final-list quota
is copied into this symmetric trial.

Require 62 valid closes on the same official CSI300 date calendar. Index closes
are raw; ETFs reconstruct the continuous sequence from official pct_chg inside
each window. Missing returns never fall back to raw ETF price gaps. Missing,
suspended, nonfinite or nonpositive closes fail eligibility; no padding.

Let sigma be population standard deviation of the latest 20 daily log returns,
floored at 0.005 (0.5% per session). This floor is a **draft calibration choice**,
especially important when comparing bonds/money ETFs with equities.

| Factor | Signed bounded value | Draft weight |
|---|---|---:|
| momentum5 | tanh(log(C/C[-5]) / (sigma × sqrt(5))) | 25% |
| momentum20 | tanh(log(C/C[-20]) / (sigma × sqrt(20))) | 35% |
| position60 | tanh(log(C/MA60) / (sigma × sqrt(60))) | 25% |
| slope20 | tanh(log(MA20/previousMA20) / (sigma / sqrt(20))) | 15% |

`S = 50 + 50 × weighted signed factors`, bounded 0–100. No cross-sectional
percentile normalization means adding unrelated themes does not change a
theme's underlying score. All-flat data yields 50. All-down markets still have
a relative first place; returns and MA position remain in the report.

Index themes equally average the current enabled member indices. All those
members must have aligned history at each compared endpoint. ETF themes choose
the highest current 20-session average transaction amount, with a RMB20m floor
and deterministic Market+Code ties; incomplete member amount histories exclude
the theme rather than allowing fallback. Amount never means fund flow.

Changes are `S(t)-S(t-w)`, w=1/3/13/60. Compare the **same current ETF** at both
endpoints, even if it was not the liquidity representative back then. Index
themes likewise use the same current membership. This is current-universe
retrospective comparison, **not** an investable historical backtest. Future
prices do not enter either endpoint's features. Historical membership and
survivorship limitations must remain disclosed.

Only positive changes enter strengthening and negative changes weakening.
Ties resolve by theme key. Display at most eight themes per panel; retain all
eligible current theme scores and member diagnostics in the candidate payload.
For level panels radius maps the actual 0–100 score into 0.12–0.92; for change
panels it maps magnitude relative to the largest change in that panel. Thus
radius is not comparable between levels and change panels. Flat changes produce
empty lists, not fabricated movers.

Latest 60-session change needs 122 aligned closes. Full 60-date historical
rebuild with that window needs 181. Existing ETF retention stays 144. A partial
change window is omitted until the presentation contract supports per-window
coverage labels; diagnostics name missing themes. No shorter window is silently
substituted. This conservative all-current-theme rule is subject to review.

## Independent A-share regime candidate

Current reviewed CSV codes provide explicit proxy membership; live names and
the existing banking/financial classification never decide the basket.

- Small-cap block: equally average CSI1000 and CSI2000 ETF theme strengths.
- Growth block: equally average ChiNext and STAR50 ETF theme strengths.
- Offensive side: equally average small-cap and growth blocks.
- Defensive side: equally average dividend and dividend-low-volatility themes.
- Nonbank/securities/insurance are excluded from this style basket, but remain
  eligible for their ordinary radar scopes. Their omission does not relabel the
  original catalog. CSI1000/2000 are small-cap proxies, not actual microcap data.

`Style = 50 + (Offensive - Defensive)/2`.
`Change = 50 + (Style(t)-Style(t-13))/2`.
Draft composite: `60% matching Pulse v1 score + 30% Style + 10% Change`.

Pulse itself is not recalculated or changed. All six reviewed proxies must be
available now and at the 13-session baseline, and Pulse must match the official
date and v1. Otherwise the regime is unavailable, not zero or neutral.
Draft labels use 20/40/60/80 boundaries: 明显防御 / 偏防御 / 中性分化 /
偏进攻 / 明显进攻. Neither bank leadership nor small-cap leadership alone
determines a bull/bear conclusion. These weights/labels need user review.

## Storage and release gate

The report measures the UTF-8 uncompressed candidate JSON size, then projects
60 equal-size snapshots. This is **not** a PostgreSQL size measurement: row and
index overhead, TOAST/compression and variable future theme counts are excluded.
Supabase Dashboard database size remains useful operational information. Publication
does not require a separate headroom Variable: if the database cannot accept the
new row, the atomic RPC fails and no existing history is shortened to fit.

Prefer independent snapshots if small. If storage is later unified, preserve
the old algorithm's separately computed Top5 and compatible Memory history.
The new strength's first five are not a replacement for old Top5 semantics.

Before release: inspect live dates/coverage/checkpoints and actual database size;
review trial ranking and regime results; approve weights, memberships, missing
coverage behavior and history policy; then implement additive idempotent schema,
independent publication/failure tests and authenticated read adapter. Publication
must be coherent and must never disturb old checkpoints or valid snapshots.
