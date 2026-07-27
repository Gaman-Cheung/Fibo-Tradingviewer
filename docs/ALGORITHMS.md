# Algorithm Contract

This document records current behavior; it is not investment advice. Changes require explicit authorization and golden-test updates.

## Look First / Fibonacci

- Retracements: 23.6%, 38.2%, 50%, 61.8%, 78.6%, 88.6% from the entered High–Low range.
- Extensions: 1.272, 1.618 and 2.618.
- Display percentage baseline may be Current, Entry or Previous Close; it does not move the price levels.
- Structural stop uses the nearest support below Entry minus 0.5%; if risk is below 3%, the next support is used. Above 7% is marked too wide.
- Fixed reference stops remain Entry −5% and Entry −7%.

## Composite Signal

`Total = F + T + M + V + S`.

- F: Breakout 0, Pullback 0, Correction +1, Golden Dip +4, Danger Zone +3, Harmonic +2, Structure Broken −5.
- T: Uptrend +2, Sideways 0, Downtrend −3.
- RSI: ≤30 +2, 30–45 +1, ≥70 −2. MACD: Divergence +2, Bullish +1, Neutral 0, Bearish −1. Combined M is capped at +3.
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
- MACD uses 12/26/9 EMA, DIF/DEA, histogram strength, crosses and zero axis. It confirms MA structure and has no weighted score or automatic divergence in v1.
- Flat scenarios repeat Current/last close. Trend scenarios use bounded log-return drift. Custom targets use log-linear interpolation.
- Volatility bounds use 20-session log-return sigma and `±σ√d`; they are scenario ranges, not probability claims.
- Tracker rules never feed Terminal Composite Signal.
