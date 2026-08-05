# FIBO Market Pulse Indicator Guide

Version: **Pulse Algorithm v1 · 2026-08**

## Purpose and source

Market Pulse is a 0–100 official-close breadth reading for Look First. It measures whether strength is broadly shared by SH/SZ A-shares and reviewed sector/theme indices. It never reads Pool, permanent IDs, Current Preview or user state and never contributes to Terminal Composite Signal.

- Stocks use BaoStock official Close and pctChg to reconstruct a continuous front-adjusted sequence anchored to the latest raw Close.
- Indices use official raw Close.
- A stock or index must trade on the snapshot date and have at least 62 valid official closes.
- ST and *ST stocks remain included.
- ETF, Amount, intraday price, futures basis and order-flow data are excluded.

## Complete formula

```text
Pulse = 25% × Participation
      + 25% × Trend Breadth
      + 25% × Expansion
      + 25% × Leadership
```

All calculations retain full precision. Product values are rounded only for display.

### Shared positive/negative balance

```text
Balance(P,N,E)
= clamp(50 + 50 × (P − N) ÷ max(P + N, 5% × E), 0, 100)
```

`P` is positive count or Theme-equal positive weight, `N` is its negative mirror and `E` is the eligible universe. The `5% × E` denominator floor prevents a rare `1 versus 0` event from reading 100. No event or an exact tie reads 50.

## 1 · Participation

```text
Participation = mean(1D Up Ratio, 5D Up Ratio, Strong Balance)
```

- 1D Up requires the latest one-session return to be strictly greater than zero.
- 5D Up requires the latest five-session return to be strictly greater than zero.
- An unchanged return is neutral, not Up or Down.
- Strong Up is official 1D return `≥ +5%`; Strong Down is `≤ −5%`.
- Median Return is displayed as the typical stock's 1D move but does not receive a second score weight.

Strong Up/Down is deliberately not described as limit-up/limit-down. Every board and ST stock uses the same ±5% return threshold even though exchange price-limit rules differ.

## 2 · Trend Breadth

```text
Trend Breadth
= mean(Above MA20 %, Above MA60 %, MA20 Rising %, MA60 Rising %)
```

- Above uses the strict relationship `Close > MA`.
- `MA Rising = MA_today / MA_yesterday − 1 > 0.01%`.
- A price can be above a falling MA; price-side breadth and slope breadth therefore remain separate.

## 3 · Expansion

```text
Expansion
= mean(20D High/Low Balance, MA60 BO/BD Balance)
```

- 20D New High: current Close is strictly above the maximum of the prior 20 closes.
- 20D New Low: current Close is strictly below the minimum of the prior 20 closes.
- MA60 BO / Breakout: previous `Close ≤ previous MA60` and current `Close > current MA60`.
- MA60 BD / Breakdown: previous `Close ≥ previous MA60` and current `Close < current MA60`.

BO and BD are one-session crossing events. They are not the Tracker's multi-session confirmation states.

## 4 · Leadership

```text
Leadership
= mean(Theme Above MA60,
       Theme MA60 Rising,
       Theme 20D High/Low Balance,
       Broad Confirmation)
```

Only active Universe v2 `sector` and `theme` indices participate. Each Theme Group has total weight 1. If a Theme contains `N` eligible indices, every index receives weight `1/N`, preventing banking or another Theme with several official index families from dominating breadth.

Broad Confirmation uses:

- CSI 300 — `SH.000300`
- CSI 500 — `SH.000905`
- CSI 1000 — `SH.000852`
- CNI 2000 — `SZ.399303`

Each broad index receives 50 points when Close is above MA60 and another 50 when MA60 is rising. The four index scores are averaged. Index Radar Score, current Leader count and Leadership Memory do not enter Pulse.

## State boundaries

| Pulse | State | Meaning |
|---:|---|---|
| 80–100 | Broad Strength | Strength is widely shared; this is not automatically overbought. |
| 60–<80 | Healthy Strength | Participation and trend breadth are constructive. |
| 40–<60 | Mixed | Positive and negative evidence conflict. |
| 20–<40 | Weakening | Breadth is narrowing or downside expansion dominates. |
| 0–<20 | Risk-Off | Weakness is broad; this is still not a timing guarantee. |

### Strength Gate and Risk Gate

The chart keeps the same fixed state boundaries. Its dashed `Strength Gate` at 60 uses Google blue because crossing 60 enters Healthy Strength. Its dashed `Risk Gate` at 20 uses Google red because falling below 20 enters Risk-Off. The 40 and 80 reference lines remain neutral gray.

Moving closer to either Gate only means the current breadth score is closer to that existing boundary. A Gate is not a probability, reconciliation rate, overbought/oversold oscillator, buy/sell trigger or additional Pulse input.

## Member lists and history

Each group card opens the latest official members behind its numerators:

- Participation: 1D/5D Up and Down, Strong Up and Strong Down stocks.
- Trend: Above/Below MA20/MA60 and Rising/Not Rising stocks.
- Expansion: 20D New High/Low and MA60 BO/BD stocks.
- Leadership: sector/theme index conditions and the four broad indices.

Lists support name or Market+Code search and are paginated at 50 rows. Only the latest two official member calculations are retained for safe publication. The chart keeps 60 aggregate snapshots; it does not preserve 60 sessions of constituent membership.

History must match the latest Pulse Algorithm and Index Universe versions. Partial history is labeled `History N/60 · Building` and is never padded or interpolated.

## Coverage and publication

A snapshot publishes only when:

- CN_A and CN_INDEX are both successful and point to the same official date;
- current A-share row coverage is at least 95% of the prior five-session median and passes the existing full-market minimum-row validation;
- at least 95% of active sector/theme indices are eligible;
- all four broad indices have 62 valid closes;
- staged latest-member row counts match the intended payload.

Members are uploaded under a new `calculation_id`; the aggregate snapshot points to that ID only after verification. A failed request therefore leaves the last visible Pulse and member set intact.

## Limits

Market Pulse is breadth context, not a probability, position size, target price or buy/sell signal. It does not observe intraday reversals, volume/Amount, fund flows, ETF NAV premium, futures basis, active order flow, news, policy changes or security-specific fundamentals.
