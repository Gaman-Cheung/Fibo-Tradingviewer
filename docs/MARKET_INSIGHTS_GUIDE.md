# Market Insights · Algorithm insights-v1 / Universe v2

Approved 2026-09-29 after real-data trial. Independent of existing Index/ETF
Radar v1, Pulse v1, Leadership Memory and every personal trading algorithm.
Missing history remains excluded; no raw history expansion or missing-price fill.

## Four radars

Latest means latest published official close, not intraday. Strong/weak sort
current theme strength; strengthening/weakening sort positive/negative changes
over 1, 3, 13 or 60 official sessions. Changing the window does not change current
strong/weak. Each panel displays at most eight themes, with deterministic theme
key tie-breaking. This is not the old Top5 score or its inverse.

Require 62 valid closes on the CSI300 official-date calendar. Index prices use
raw closes; ETFs reconstruct returns backward using official pct_chg, anchored
to the endpoint's close. Missing returns do not fall back to raw gaps. Suspended,
missing, nonfinite and nonpositive prices do not satisfy eligibility.

Sigma = population standard deviation of the last 20 daily log returns, floored
at 0.005. The four signed factors are:

| Factor | Definition | Weight |
|---|---|---:|
| momentum5 | tanh(log(C/C[-5]) / (sigma × sqrt(5))) | 25% |
| momentum20 | tanh(log(C/C[-20]) / (sigma × sqrt(20))) | 35% |
| position60 | tanh(log(C/MA60) / (sigma × sqrt(60))) | 25% |
| slope20 | tanh(log(MA20/previousMA20) / (sigma / sqrt(20))) | 15% |

`S = 50 + 50 × sum(weight × factor)` maps to 0–100. An unchanged series is 50.
No cross-sectional percentile is involved: unrelated membership changes do not
move another theme's underlying score. All-falling markets still have a relative
first place; retained absolute returns and MA distances explain this limitation.

- Index themes equally average their current reviewed, enabled sector/theme
  members. All members must have aligned history; incomplete themes are excluded.
- ETF themes choose their current highest 20-session mean exchange amount,
  with RMB20m minimum and Market+Code ties. Every enabled member must have valid
  amount coverage; no fallback to another member. Amount is not fund flow.
- Historical comparison uses the SAME current theme membership and ETF
  representative at both endpoints. It is current-universe retrospective analysis,
  not a historical investable strategy or full-market-cycle backtest.
- Change = S(t) − S(t−w). Only positive/negative values enter the corresponding
  change panel (floating-point tolerance 1e-9). Constant trend is not acceleration.
- Latest 60-session change requires 122 aligned closes; latest 60 full historical
  snapshots would require 181. Existing ETF retention stays 144. New snapshots
  accumulate daily; this release does not backfill invented historical results.
- A partially covered change window is omitted, not shortened or filled with
  zero. Diagnostic metadata identifies missing themes. Current strong/weak can
  remain available. Excluded themes are not treated as the weakest.
- Level radius maps strength into 0.12–0.92. Change radius is relative to the
  largest magnitude in that panel. Distances are not comparable across panels.
  Theme angle is stable and has no correlation meaning.
- Cross Asset uses the same volatility-scaled trend strength without the old
  Top5 category quota. Comparability of bonds and equities remains approximate:
  there is no NAV premium, currency hedge, yield or fund-flow input.

## A-share regime

Reviewed code memberships are frozen in `scripts/market_insights_basket.py`,
validated against the existing Universe v2 manifest. Never classify by live name.

- Small-cap = mean(CSI1000 ETF, CSI2000 ETF). These proxy small-cap appetite, not
  a true microcap index.
- Growth = mean(ChiNext ETF, STAR50 ETF).
- Offensive = mean(Small-cap, Growth).
- Defensive = mean(Dividend ETF, Dividend-low-volatility ETF).
- Nonbank/securities/insurance are excluded from this basket, not from radars.
- Style = 50 + (Offensive − Defensive)/2.
- Change = 50 + (Style(t) − Style(t−13))/2.
- Regime = 60% matching original Pulse v1 + 30% Style + 10% Change.
- Boundaries: <20 明显防御, 20–<40 偏防御, 40–<60 中性分化,
  60–<80 偏进攻, >=80 明显进攻.

All six proxy themes need current and 13-session baseline history; Pulse must
match the date and v1. Otherwise the regime is unavailable, never neutral by
default. It describes A-share environment, including when displayed under Cross
Asset; it does not predict a bull/bear market, probability or trade instruction.
Bank leadership alone is not bearish, nor is technology leadership alone bullish.

## Publication / read boundary

`market_insights.py` is the pure engine. The GET-only trial runner shares that
engine; the separate publisher runs only after the old daily/all job succeeds.
All four old checkpoints must be ok on the same date. The RPC rechecks their
timestamps and the matching Pulse calculation, writes one complete bundle and
prunes only this new table to 60 dates in a transaction. Any wholly empty scope
prevents publication. An unavailable regime is explicitly null with a reason.

No old checkpoint or old table is overwritten. Original Top5/Memory continue
using their original snapshots. If storage is ever unified later, that does not
authorize replacing original Top5 semantics with the new first five.

Authenticated users read only the latest new bundle. The browser validates all
scope dates and versions, uses the existing five-minute/day-boundary cache,
retains the last valid result on refresh failure, and never recomputes from bars.
If a later bundle lacks a previously available regime, the controller retains its
previous complete result with a failed-refresh notice rather than silently mixing
dates. A fresh page displays the missing regime honestly.

See `DEPLOY_MARKET_INSIGHTS.md` for the required migration and release switches.
