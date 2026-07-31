# Market Radar · ETF Indicator Guide

- ETF Radar Algorithm version: **1**
- ETF Universe version: **2**
- Leadership Memory version: **1**
- Retention: **144 official trading sessions**
- Scopes: **EQUITY_ETF / CROSS_ASSET**

ETF Radar is market context in Look First. It does not read Pool, Ticker, user identity or permanent instrument IDs, and it never changes Composite Signal.

## Scope

- **Equity ETF**: reviewed domestic broad-market, sector, theme and strategy ETFs.
- **Cross Asset**: reviewed overseas equity, commodity, bond and money-market ETFs.
- Classification is keyed only by permanent `Market + Code` in the generated `scripts/etf_catalog_seed_v2.py`. Runtime names never guess a category.
- Universe v2 reviews all 1,615 catalog records in `scripts/universe/etf_universe_v2.csv`: 1,229 Equity ETF, 382 Cross Asset and four inactive raw-only records whose official names are unavailable. The manifest records official-source evidence, review status and every exclusion reason.
- The first v2 publication enables 1,381 funds with complete retained provider history. Another 230 products keep their category, Scope and Theme but are deferred because they began part-way through the current 144-session window; this preserves at least 60 compatible Leadership Memory snapshots during the version rebuild.
- A newly discovered unknown ETF is still synchronized for 144 sessions, but remains `other`, has no Radar scope and cannot rank until a reviewed Universe update.

Sector Index remains a separate Radar v1 universe with RS5/RS20 and 400 sessions. ETF support does not alter its candidates, scores or snapshots.

## Official fields and continuous prices

ETF synchronization stores Provider, Market, Code, trade date, official Close, pctChg, Trade Status, Amount and synchronization time. High/Low exists only in memory while evaluating a same-run MA60 Retest.

The price series is reconstructed backward from the latest official Close using official pctChg. This produces a continuous-return series so distributions or splits do not manufacture MA events. Amount stays unadjusted.

Amount is exchange transaction value. It is **not fund flow**, subscription/redemption flow, capital inflow, ETF size or NAV premium/discount.

## Retention and provider coverage

The ETF retention target is 144 official trading sessions. BaoStock's bulk daily ETF endpoint can have a later historical start than the exchange calendar. On the first chronological Backfill, the synchronizer may pass over only a completely empty contiguous prefix before the first valid bulk ETF session. It records the first date that actually uploaded rows as the real coverage start and never manufactures missing prices.

After the first valid ETF session, an empty, partial, malformed or low-coverage date is treated as a true gap: publication stops, the failed date does not advance the checkpoint and retention cleanup does not run. A provider-limited initial history is reported with its actual coverage and grows toward 144 through later Daily updates; the system does not launch thousands of per-code fallback requests merely to fill the unavailable prefix.

Universe review is separate from daily synchronization. `python scripts/radar_universe_v2.py validate` checks the committed manifests and generated seeds without network access. `python scripts/radar_universe_v2.py dry-run` reads existing histories, rebuilds all three Radar scopes in memory, reports gate failures and v1/v2 snapshot differences, and never invokes a write method.

At the v2 review baseline, `market_daily_bar` contains 2,474,005 rows, including 206,184 ETF rows. ETF storage is estimated at 35.1–57.7MB with a 65MB planning ceiling. Universe v2 adds no market rows and is expected to add less than 2MB through Catalog/snapshot replacement; the Supabase dashboard remains the authoritative physical-size measurement.

## Theme representative and liquidity

For every official date:

1. Group active reviewed ETFs by Theme Group.
2. Require at least 20 valid Amount observations and 62 official price sessions.
3. Select exactly one representative: the ETF with the highest 20-session average Amount.
4. If that winner averages less than RMB 20 million, exclude the entire Theme Group. Do not substitute the second ETF.
5. Score the remaining representatives inside their own Scope.

A representative may change when liquidity leadership changes. Historical persistence remains attached to the Theme Group, so the code change does not reset Consecutive, 13D or 60D memory.

## Relative strength and Score

CSI300 (`SH.000300`) is the common benchmark for both ETF scopes.

```text
RS5  = ETF 5-session continuous return  − CSI300 5-session return
RS20 = ETF 20-session continuous return − CSI300 20-session return

Score = 25 × PctRank_scope(RS5)
      + 30 × PctRank_scope(RS20)
      + Trend(0–30)
      + min(Event points, 15)
      − Risk
```

The positive budget is 55 relative-strength points, 30 trend points and at most 15 event points.

- Close above MA60: +5.
- MA60 daily change above +0.01%: +10.
- `Close > MA20 > MA60`, with both averages rising above +0.01%: +15.
- Entry requires at least 62 sessions, Score ≥ 60, Close above MA60, positive RS5 or RS20 and no MA60 Breakdown.
- At most five final leaders are shown. A weak candidate is never added to fill space.

## Events

| Event | Points | Actual official-close condition |
|---|---:|---|
| MA60 Reclaim Confirmed | +9 | A breakout is followed by two consecutive official closes above contemporaneous MA60. |
| MA60 Breakout | +8 | Previous Close was not above MA60 and latest Close moves above it. |
| 20D High Breakout | +7 | Latest Close exceeds every Close in the preceding 20 sessions. |
| Relative Strength New High | +6 | ETF/CSI300 relative-strength ratio reaches a 20-session high. |
| MA60 Turn Up | +6 | MA60 daily change moves from flat/down to above +0.01%. |
| 3D Acceleration | +5 | Three-session cumulative return is at least +5%. |
| Persistent Advance | +4 | At least seven of the latest ten sessions closed higher. |
| 3-Day Streak | +3 | The latest three official sessions all closed higher. |
| 1D Surge | +2 | Latest one-session return is at least +5%. |
| MA60 Retest | 0 | Same-run High/Low crosses MA60. |
| Healthy Retest | 0 | A prior strong ETF touches MA60, closes above it and retains rising MA60. |
| Near MA60 | 0 | Close is within ±0.8%, MA60 rises, RS20 is positive and 10 of 15 closes stayed above. |

Event points are capped at 15. Retest and Near MA60 are context, not score.

## Risks

- **Extended −10**: Close is more than 12% above MA60.
- **MA60 Breakdown · Excluded**: Close moves below MA60 after the prior Close was at or above it.

## Cross Asset quota

After strict Theme Group deduplication, Cross Asset permits at most two final cards from any one category: overseas, commodity, bond or money. A previous leader may receive the normal stability buffer only if the resulting list still respects this quota. Equity ETF has no category quota.

## Leadership Memory

Each Scope has independent final Top 5 snapshots and Memory:

- Yesterday is the exact prior official final list.
- 3D Fast, 13D Swing and 60D Regime include the latest official session.
- Daily ranks 1–5 earn 5/4/3/2/1 points.
- `Leadership Score = points / (5 × available compatible sessions) × 100`.
- Ties use appearances, average rank, recency and stable Theme name.
- A 60D historical leader remains visible with `Last Seen N sessions ago`.
- Algorithm, Universe and Scope must all match. Partial history is explicitly shown as `N / target · Building`.

Mini cards show three Themes; detail shows every Theme that appeared within the selected available window. Memory reads final snapshots only, not the discarded raw ranking of every ETF.

## Reading a card

`#1 Semiconductor · MA60 Breakout · RS5 +3.2% · RS20 +8.1% · Score 86.4` means the most-liquid reviewed Semiconductor ETF represents that Theme, outperformed CSI300 over both horizons and passed the official trend gate. Detail shows its category, Theme Group and 20D average Amount.

This does not mean the ETF or a constituent should be bought.

## Limits

ETF Radar sees exchange price, official return and transaction Amount. It does not know NAV premium/discount, creations/redemptions, bond yield, commodity spot price, futures roll, currency hedge, tax or tracking error. Cross-asset RS versus CSI300 is a common attention scale, not proof that unlike assets have identical risk.

ETF Radar is not a probability, price target, recommendation, trade signal or promise. It never changes Terminal Composite Signal, Fibonacci, Stop, R:R, MACD, Trend Tracker or Wave.
