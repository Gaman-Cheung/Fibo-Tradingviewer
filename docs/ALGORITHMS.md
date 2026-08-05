# Algorithm Contract

This document records current behavior; it is not investment advice. Changes require explicit authorization and golden-test updates.

## Look First / Fibonacci

- Retracements: 23.6%, 38.2%, 50%, 61.8%, 78.6%, 88.6% from the entered High–Low range.
- Extensions: 1.272, 1.618 and 2.618.
- Display percentage baseline may be Current, Entry or Previous Close; it does not move the price levels.
- Previous Close defaults to the latest official Supabase close for the instrument's explicit Market/Code and can be overridden in Manual mode. Source selection does not change daily-move, VR or Composite Signal formulas.
- Structural stop uses the nearest support below Entry minus 0.5%; if risk is below 3%, the next support is used. Above 7% is marked too wide.
- Fixed reference stops remain Entry −5% and Entry −7%.

## Composite Signal

`Total = F + T + M + V + S`.

- F: Breakout 0, Pullback 0, Correction +1, Golden Dip +4, Danger Zone +3, Harmonic +2, Structure Broken −5.
- T: Uptrend +2, Sideways 0, Downtrend −3.
- RSI: ≤30 +2, 30–45 +1, ≥70 −2. MACD: Bullish Divergence +2, Bullish +1, Wait/Flat 0, Bearish -1. The compatible stored values remain `divergence` for Bullish Divergence and `neutral` for Wait/Flat. Combined Momentum is capped at +3.
- VR uses the existing five-day thresholds: ≤0.8 contraction, 1.2–1.5 mild expansion, ≥1.5 clear expansion, ≥2.5 abnormal-volume classification.
- Good Setup requires valid Entry/Stop/targets, T1 ≥1R and T2 ≥2R. Sniper Buy additionally requires total ≥6, non-downtrend, structural stop alignment and no tight first barrier.
- Missing Entry cannot be promoted by a preview R:R.

### Terminal MACD manual interpretation

Suggestion classification contract: `Algorithm Guide v2.2 · 2026-08`.

- MACD uses 12/26/9. DIF is the fast line, DEA is its smoothed signal line, and the current implementation uses `Histogram = 2 × (DIF − DEA)`. A Golden Cross（金叉）means DIF crosses above DEA; a Death Cross（死叉）means it crosses below. The zero axis distinguishes positive and negative medium-term momentum.
- Broker software may reverse red/green histogram colors. Read the Histogram sign, direction and expansion/contraction instead of relying on color.
- Manual Bullish requires at least two aligned conditions（至少两项一致）: DIF above DEA, both lines rising, positive Histogram expanding, or a Golden Cross that remains confirmed. A price breakout is secondary evidence only.
- Manual Bearish likewise requires at least two aligned conditions（至少两项一致）: DIF below DEA, both lines falling, negative Histogram expanding, or a Death Cross that remains confirmed. A price breakdown is secondary evidence only.
- Choose Wait/Flat for 双线缠绕或走平, 反复交叉, 柱体接近零轴, a 刚交叉 one-bar signal, 负柱缩短但 DIF 仍低于 DEA, 正柱缩短但 DIF 仍高于 DEA, 疑似但未确认的背离, or 数据不足或无法判断. A fresh cross with short bars and attached lines is not confirmed.
- Decision order: first check for a manually confirmed bottom divergence; otherwise choose Bullish or Bearish only when at least two conditions align; everything else remains Wait/Flat.
- The automatic suggestion keeps a fresh Golden Cross as Bullish and a fresh Death Cross as Bearish. Without a fresh cross, DIF above DEA at/above zero remains Bullish and DIF below DEA below zero remains Bearish. Below zero（零轴下方）, a Bullish continuation additionally requires DIF above DEA, both DIF and DEA rising（双线上行）from the immediately preceding point, and a positive Histogram that continues expanding（正柱继续扩张）. Above zero（零轴上方）, Bearish continuation uses the exact mirror: DIF below DEA, both lines falling（双线下行）, and an increasingly negative Histogram（负柱继续扩张）. Conflicting, shrinking or incomplete states remain Wait/Flat. This is a candidate only. Only Apply Suggestion writes the dropdown, and stricter manual review may keep Wait/Flat.
- Official Close compares with the preceding official session. Current Preview compares with the latest official close. Current percentage change is not a separate MACD input and cannot force a Bullish or Bearish label by itself.
- Official Close is the confirmed objective basis. Current Preview appends the entered Current as a provisional condition only; switching the basis does not itself change the dropdown or Composite Signal.
- Bullish Divergence is reserved for a manually confirmed bottom divergence where price forms a 更低低点 and DIF forms a 更高低点. The scanner examines the latest 60 official sessions with five-point pivots（五点拐点）and excludes Current Preview. A 顶背离 must never use the +2 option: choose Bearish when weakness is confirmed, otherwise Wait/Flat.

## Elliott Wave

- P2 may not touch/cross P0 in a normal impulse.
- P4 may not enter the Wave 1 price region in a normal impulse.
- Wave 3 cannot be the shortest of Waves 1, 3 and 5.
- Filled points are validated directionally; incomplete points remain scenario projections.
- Retracement/extension matrices, ABC projections, sub-wave targets and cluster tolerance retain the values in the legacy source.

## Trend Tracker

- Always calculate MA5/10/13/20/30/60/120/144/240 from BaoStock front-adjusted closes. The full-market source reconstructs that series backwards from official raw Close and `pctChg`, anchored to the latest official raw Close; live smoke validation against `adjustflag=2` must remain within `1e-4` relative error.
- Exact slope recurrence: `ΔMA_N = (C_t - C_{t-N}) / N`; near-flat means `|ΔMA / MA_prev| <= 0.01%`.
- MA Status Reverse Price is a display-only inversion of that same Direction rule. From the latest official history, the next Current/close is `up` only above `C_leave + N × MA_previous × 0.01%`, `down` only below `C_leave − N × MA_previous × 0.01%`, and `flat` between the inclusive boundaries. An up row displays only its down boundary, a down row only its up boundary, while flat displays both.
- Reverse Price uses full precision internally and three decimals in the UI. It can describe one Direction change and a possible Turn Alert, but it never substitutes for the three consecutive calculation points required by Up Confirmed or Down Confirmed.
- First slope sign change is Turn Alert; three consecutive up slopes display Up Confirmed and three consecutive down slopes display Down Confirmed. These labels confirm direction continuity and do not imply that a new turn just occurred.
- First official close crossing a critical MA is Watch; two official closes on the same side are Confirmed.
- Manual Current appends a provisional close for preview only. Primary conclusions remain based on official closes.
- Long background uses MA240 price side and slope. Current structure uses ordered MA5/10/20 plus short slopes.
- MACD uses 12/26/9 EMA, DIF/DEA, histogram strength, crosses and zero axis. Tracker displays the official-close result beside an explicitly provisional Current Preview; Tracker itself has no weighted score or automatic divergence.
- Then Leap may request a non-persistent suggestion from the same close series: Golden Cross, or DIF above DEA at/above zero, suggests Bullish; Death Cross, or DIF below DEA below zero, suggests Bearish; mixed/insufficient states suggest Wait/Flat. The modal calculates Official Close and Current Preview once, defaults to Preview when Current exists, and applies only the currently selected basis after explicit confirmation.
- Close/DIF divergence scanning examines the latest 60 official sessions using confirmed five-point close pivots (two sessions on each side). A lower close low with a higher DIF low is a potential bullish candidate; a higher close high with a lower DIF high is a potential bearish candidate. Current Preview is excluded, candidates never change the dropdown, and only manually confirmed bullish divergence may use Terminal's +2 `divergence` value.
- Flat scenarios repeat Current/last close. Trend scenarios use bounded log-return drift. Custom targets use log-linear interpolation. Tracker evaluates the three unchanged formulas together with one shared horizon; Custom is omitted when Target is not a positive number, while Flat and Trend remain available.
- Conditional MA projection appends each close from one user-selected Scenario path and recalculates every checked period with the same SMA formula. Historical MAs stay unchanged, all three price paths are calculated together, and only the selected visible path extends MAs. Per-permanent-ID Scenario visibility eye controls may mark any price path and its selected projected MA as hidden without changing a Scenario result; closing all three eyes collapses the display-only Forecast tail. Current Preview participates when present; the projected MAs are conditional visualization, not another forecast, probability claim or trading signal.
- Volatility bounds use 20-session log-return sigma and `±σ√d`; they are scenario ranges, not probability claims.
- Tracker calculations never feed Terminal Composite Signal automatically; only an explicit Apply action writes Bullish/Bearish/Neutral, while divergence always remains manual.
- Then Leap retains an instrument with a valid High/Low structure when Current is blank, but pauses every Current-dependent derived calculation and displays an input-required state. Missing Current never reuses a stale Composite Signal.

## Look First Index Radar · Algorithm v1 / Universe v2

Index Radar is independent market context computed from BaoStock official index closes. Only explicitly seeded `sector` and `theme` indices with at least 62 formal closes are candidates; `SH.000300` is the benchmark and can never rank.

Universe v2 classifies all 507 reviewed codes from a versioned evidence manifest and generates a permanent Market+Code seed. This changes candidate membership only; the Algorithm v1 score, events, risks and gates below are unchanged.

```text
RS5  = index 5-session return  − CSI300 5-session return
RS20 = index 20-session return − CSI300 20-session return

Score = 25 × PctRank(RS5)
      + 30 × PctRank(RS20)
      + Trend(0–30)
      + min(Event points, 15)
      − Risk
```

Trend contributes `+5` for Close above MA60, `+10` when MA60 daily percentage change is greater than `+0.01%`, and `+15` when `Close > MA20 > MA60` with both MA20 and MA60 rising by more than `+0.01%`. A candidate qualifies only at Score ≥ 60, Close above MA60, positive RS5 or RS20, and no MA60 Breakdown.

Scored events are MA60 Reclaim Confirmed `+9`, MA60 Breakout `+8`, 20D High Breakout `+7`, Relative Strength New High `+6`, MA60 Turn Up `+6`, 3D Acceleration `+5`, Persistent Advance `+4`, 3-Day Streak `+3`, and 1D Surge `+2`. MA60 Retest, Healthy Retest and qualified Near MA60 `±0.8%` are context-only. Extended above MA60 by more than 12% deducts 10; a fresh MA60 Breakdown excludes the candidate.

Theme Group normally contributes one final leader. A second representative is allowed only when both are in the raw Top 5 and within five points. A prior final leader can receive the stability buffer only while raw Top 8, still at least 60 points and within five points of the fifth selected leader. Recent 30-session final-list appearances break an exactly equal score before RS20/RS5; Consecutive/15D/30D appearances count only final, deduplicated lists and never add recurring score.

Coverage below 95%, missing benchmark history or an incomplete index run produces no new snapshot. Full event definitions, UI reading guidance and boundaries are normative in `docs/INDEX_RADAR_GUIDE.md`; its version must match the Python algorithm and in-product help.

### Leadership Memory v1

Leadership Memory is a browser-side persistence view over final Top 5 snapshots; it does not change Radar Algorithm v1 or reconstruct the discarded raw ranking of all eligible indices.

- Yesterday is the previous official session's exact Top 5. Rolling 3D, 13D and 60D windows include the latest compatible official session.
- For each session and Theme Group, only the highest-ranked representative counts. Ranks 1–5 receive 5/4/3/2/1 points.
- `Leadership Score = accumulated rank points / (5 × available compatible sessions) × 100`.
- Ties resolve by more appearances, lower average rank, more recent appearance, then stable theme name.
- A 60D theme remains ranked for the complete window after leaving the current list and displays `Last Seen N sessions ago`; no recency decay or recent-appearance gate is applied.
- Main cards derive Theme Group `Consecutive`, `13D` and `60D` counts from the same snapshots. Python's legacy 30-session exact-score tie-break and stability buffer remain intact and do not receive Leadership Memory points.
- Different Algorithm/Universe versions never mix. Partial history uses only available sessions and must display `N / target · Building`.

## ETF Radar · Algorithm v1 / Universe v2

ETF Radar reuses the unchanged Index Radar v1 candidate, event, risk, score and 60-point gate. Sector Index remains RS5/RS20 with 400 sessions and is not revised by this addition. ETF uses 144 official sessions and two independent scopes: `EQUITY_ETF` and `CROSS_ASSET`.

Universe v2 reviews all 1,615 catalog records. A fund with partial retained history is classified but deferred from ranking until a later Universe review; this is a classification publication rule and does not alter the 62-session Algorithm gate.

```text
RS5  = ETF 5-session continuous return  − CSI300 5-session return
RS20 = ETF 20-session continuous return − CSI300 20-session return

Score = 25 × PctRank_scope(RS5)
      + 30 × PctRank_scope(RS20)
      + Trend(0–30)
      + min(Event points, 15)
      − Risk
```

- Official Close plus pctChg reconstruct a continuous ETF price series anchored to the latest raw Close. Official unadjusted Amount is never part of price adjustment.
- A candidate still needs 62 valid sessions, Score ≥ 60, Close above MA60, positive RS5 or RS20 and no MA60 Breakdown.
- Before percentile scoring, each Theme Group contributes only its ETF with the highest valid 20-session average Amount. If that winner is below RMB 20 million, the Theme contributes no candidate; a second ETF is never substituted.
- Equity ETF contains reviewed domestic broad, sector, theme and strategy ETFs without a category quota.
- Cross Asset contains reviewed overseas, commodity, bond and money ETFs. After strict Theme deduplication, each category may occupy at most two final cards. The previous-leader stability buffer cannot violate the cap.
- The final board has at most five cards and is never padded with weak candidates.
- Stability uses prior final Theme Groups, not ETF codes. A more-liquid ETF can replace yesterday's representative without resetting Theme Group Consecutive or Memory counts.
- Coverage below 95%, missing CSI300, abnormal ETF rows, incomplete upload or either-scope build failure prevents checkpoint completion and retention cleanup.
- BaoStock's bulk ETF endpoint may begin later than the requested 144-session window. Backfill may skip only a completely empty contiguous prefix before the first valid provider session, records that real session as the coverage start and keeps 144 as the retention target. After coverage begins, an empty or partial date remains a hard sequence failure. The synchronizer never fabricates rows and does not issue thousands of per-code requests merely to fill an unavailable prefix.
- ETF Leadership Memory uses the same Yesterday/3D/13D/60D, 5/4/3/2/1 and partial-version rules, while additionally requiring equal Scope.
- Amount means exchange transaction value only. The model has no fund-flow, NAV premium/discount, yield, spot-price or currency-hedge input.

The complete definitions and reading boundary are normative in `docs/ETF_RADAR_GUIDE.md`; Algorithm and Universe versions must match `scripts/etf_radar.py` and the in-product help.

## FIBO Market Pulse · Algorithm v1 / Index Universe v2

Market Pulse is independent official-close breadth context. Eligible stocks are traded SH/SZ A-shares with at least 62 valid closes, including ST/*ST. Stocks use the existing pctChg-reconstructed continuous sequence; indices use raw official Close. ETF, Pool, Current Preview and Radar Leader scores are excluded.

```text
Balance(P,N,E) = clamp(50 + 50 × (P-N) / max(P+N, 5% × E), 0, 100)

Participation = mean(1D Up %, 5D Up %, Strong Up/Down Balance)
Trend Breadth = mean(Above MA20 %, Above MA60 %, MA20 Rising %, MA60 Rising %)
Expansion = mean(20D High/Low Balance, MA60 BO/BD Balance)
Leadership = mean(Theme Above MA60, Theme MA60 Rising,
                  Theme High/Low Balance, Broad Confirmation)
Pulse = mean(Participation, Trend Breadth, Expansion, Leadership)
```

- Up requires a strictly positive return. Strong Up is `>= +5%`; Strong Down is `<= -5%`. Median Return is display-only and Strong is not a limit-up statistic.
- MA Rising requires a strict one-session MA rate above `+0.01%`.
- 20D High/Low compares current Close with the prior 20 closes. MA60 BO is previous `Close <= previous MA60` and current `Close > current MA60`; BD is the mirror.
- Active sector/theme indices are weighted so each Theme Group totals 1. Broad Confirmation averages CSI 300, CSI 500, CSI 1000 and CNI 2000; each receives 50 for Close above MA60 and 50 for MA60 Rising.
- State intervals are `[80,100] Broad Strength`, `[60,80) Healthy Strength`, `[40,60) Mixed`, `[20,40) Weakening` and `[0,20) Risk-Off`.
- The chart names the unchanged 60 boundary `Strength Gate` and the unchanged 20 boundary `Risk Gate`. Their blue/red dashed presentation is display-only and is not another score, probability, overbought/oversold rule or trading trigger.
- The browser reads at most 60 compatible aggregates and 50 requested latest members. Exact definitions, coverage gates, publication ordering and limitations are normative in `docs/MARKET_PULSE_GUIDE.md` and the v1 in-product help.
