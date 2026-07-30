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
- RSI: ≤30 +2, 30–45 +1, ≥70 −2. MACD: Bullish Divergence +2, Bullish +1, Neutral 0, Bearish −1. The stored compatibility value for Bullish Divergence remains `divergence`. Combined M is capped at +3.
- VR uses the existing five-day thresholds: ≤0.8 contraction, 1.2–1.5 mild expansion, ≥1.5 clear expansion, ≥2.5 abnormal-volume classification.
- Good Setup requires valid Entry/Stop/targets, T1 ≥1R and T2 ≥2R. Sniper Buy additionally requires total ≥6, non-downtrend, structural stop alignment and no tight first barrier.
- Missing Entry cannot be promoted by a preview R:R.

## Elliott Wave

- P2 may not touch/cross P0 in a normal impulse.
- P4 may not enter the Wave 1 price region in a normal impulse.
- Wave 3 cannot be the shortest of Waves 1, 3 and 5.
- Filled points are validated directionally; incomplete points remain scenario projections.
- Retracement/extension matrices, ABC projections, sub-wave targets and cluster tolerance retain the values in the legacy source.

## Trend Tracker

- Always calculate MA5/10/13/20/30/60/120/144/240 from BaoStock front-adjusted closes. The full-market source reconstructs that series backwards from official raw Close and `pctChg`, anchored to the latest official raw Close; live smoke validation against `adjustflag=2` must remain within `1e-4` relative error.
- Exact slope recurrence: `ΔMA_N = (C_t - C_{t-N}) / N`; near-flat means `|ΔMA / MA_prev| <= 0.01%`.
- First slope sign change is Turn Alert; three consecutive up slopes display Up Confirmed and three consecutive down slopes display Down Confirmed. These labels confirm direction continuity and do not imply that a new turn just occurred.
- First official close crossing a critical MA is Watch; two official closes on the same side are Confirmed.
- Manual Current appends a provisional close for preview only. Primary conclusions remain based on official closes.
- Long background uses MA240 price side and slope. Current structure uses ordered MA5/10/20 plus short slopes.
- MACD uses 12/26/9 EMA, DIF/DEA, histogram strength, crosses and zero axis. Tracker displays the official-close result beside an explicitly provisional Current Preview; Tracker itself has no weighted score or automatic divergence.
- Then Leap may request a non-persistent suggestion from the same close series: Golden Cross, or DIF above DEA at/above zero, suggests Bullish; Death Cross, or DIF below DEA below zero, suggests Bearish; mixed/insufficient states suggest Wait/Flat. The modal calculates Official Close and Current Preview once, defaults to Preview when Current exists, and applies only the currently selected basis after explicit confirmation.
- Close/DIF divergence scanning examines the latest 60 official sessions using confirmed five-point close pivots (two sessions on each side). A lower close low with a higher DIF low is a potential bullish candidate; a higher close high with a lower DIF high is a potential bearish candidate. Current Preview is excluded, candidates never change the dropdown, and only manually confirmed bullish divergence may use Terminal's +2 `divergence` value.
- Flat scenarios repeat Current/last close. Trend scenarios use bounded log-return drift. Custom targets use log-linear interpolation. Tracker evaluates the three unchanged formulas together with one shared horizon; Custom is omitted when Target is not a positive number, while Flat and Trend remain available.
- Conditional MA projection appends each close from one user-selected Scenario path and recalculates every checked period with the same SMA formula. Historical MAs stay unchanged, all three price paths remain visible, and only the selected path extends MAs. Current Preview participates when present; the projected MAs are conditional visualization, not another forecast, probability claim or trading signal.
- Volatility bounds use 20-session log-return sigma and `±σ√d`; they are scenario ranges, not probability claims.
- Tracker calculations never feed Terminal Composite Signal automatically; only an explicit Apply action writes Bullish/Bearish/Neutral, while divergence always remains manual.
- Then Leap retains an instrument with a valid High/Low structure when Current is blank, but pauses every Current-dependent derived calculation and displays an input-required state. Missing Current never reuses a stale Composite Signal.

## Look First Index Radar · Algorithm v1 / Universe v1

Index Radar is independent market context computed from BaoStock official index closes. Only explicitly seeded `sector` and `theme` indices with at least 62 formal closes are candidates; `SH.000300` is the benchmark and can never rank.

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
