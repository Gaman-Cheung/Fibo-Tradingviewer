/** Product help contract for FIBO Market Pulse Algorithm v1 · 2026-08. */

export const MARKET_PULSE_GUIDE_VERSION='Pulse Algorithm v1 · 2026-08';

export const MARKET_PULSE_GUIDE_HTML=`<div class="fibo-help-content market-pulse-guide">
  <h3>What Market Pulse measures</h3>
  <p>FIBO Market Pulse is a 0–100 official-close breadth reading. It asks whether strength is broadly shared by SH/SZ A-shares and reviewed sector/theme indices. It does not use Pool instruments, Current Preview, ETFs, transaction Amount or intraday data, and it never changes Terminal Composite Signal.</p>
  <p><strong>Official universe:</strong> a stock must trade on the snapshot date and have at least 62 valid official closes. ST/*ST remains included. Stock returns and moving averages use the same continuous front-adjusted sequence reconstructed from official Close and pctChg; indices use official raw Close.</p>

  <h3>Complete score</h3>
  <p class="formula"><code>Pulse = 25% × Participation + 25% × Trend Breadth + 25% × Expansion + 25% × Leadership</code></p>
  <p>All calculations keep full precision. Cards and the chart round only for display.</p>

  <h3>Confidence-dampened balance</h3>
  <p class="formula"><code>Balance(P,N,E) = clamp(50 + 50 × (P − N) ÷ max(P + N, 5% × E), 0, 100)</code></p>
  <p><code>P</code> is a positive count, <code>N</code> a negative count and <code>E</code> the eligible universe. The 5% floor prevents a tiny 1-versus-0 event from appearing as maximum breadth. A balanced or event-free market reads 50.</p>

  <h3>1 · Participation</h3>
  <p class="formula"><code>mean(1D Up Ratio, 5D Up Ratio, Strong Balance)</code></p>
  <ul>
    <li><strong>1D / 5D Up:</strong> return must be strictly above zero; unchanged stocks are neutral.</li>
    <li><strong>Strong Up / Down:</strong> official 1D return ≥ +5% or ≤ −5%.</li>
    <li><strong>Median Return:</strong> shows the typical 1D stock but is not scored again.</li>
  </ul>
  <p>Strong Up/Down is not a limit-up/limit-down count. The same ±5% threshold is applied to every eligible board and to ST stocks, regardless of their exchange price-limit rules.</p>

  <h3>2 · Trend Breadth</h3>
  <p class="formula"><code>mean(Above MA20 %, Above MA60 %, MA20 Rising %, MA60 Rising %)</code></p>
  <p>A moving average is Rising only when its one-session rate of change is strictly above +0.01%. Price-side and slope breadth are kept separate so a market above a still-falling MA is not treated as fully confirmed.</p>

  <h3>3 · Expansion</h3>
  <p class="formula"><code>mean(20D High/Low Balance, MA60 BO/BD Balance)</code></p>
  <ul>
    <li><strong>20D New High / Low:</strong> latest close strictly exceeds the prior 20 closes' maximum, or falls below their minimum.</li>
    <li><strong>MA60 BO:</strong> yesterday Close ≤ yesterday MA60 and today Close &gt; today MA60.</li>
    <li><strong>MA60 BD:</strong> yesterday Close ≥ yesterday MA60 and today Close &lt; today MA60.</li>
  </ul>
  <p>BO means Breakout and BD means Breakdown. They are one-session crossing events, not three-session confirmation states.</p>

  <h3>4 · Leadership</h3>
  <p class="formula"><code>mean(Theme Above MA60, Theme MA60 Rising, Theme High/Low Balance, Broad Confirmation)</code></p>
  <ul>
    <li>Only active Universe v2 sector/theme indices participate.</li>
    <li>Every Theme Group has total weight 1. If a Theme has several official indices, each receives <code>1 ÷ eligible indices in that Theme</code>, preventing duplicated index families from dominating.</li>
    <li>Broad Confirmation uses CSI 300, CSI 500, CSI 1000 and CNI 2000. Each earns 50 points above MA60 and 50 points for rising MA60; the four are averaged.</li>
    <li>Index Radar Score, current Leader count and Leadership Memory never enter Pulse.</li>
  </ul>

  <h3>How to read the state</h3>
  <div class="index-radar-guide__table"><table><thead><tr><th>Pulse</th><th>State</th><th>Reading</th></tr></thead><tbody>
    <tr><td>80–100</td><td>Broad Strength</td><td>Strength is widely shared; this is not automatically overbought.</td></tr>
    <tr><td>60–&lt;80</td><td>Healthy Strength</td><td>Participation and trend breadth are constructive.</td></tr>
    <tr><td>40–&lt;60</td><td>Mixed</td><td>Positive and negative evidence conflict.</td></tr>
    <tr><td>20–&lt;40</td><td>Weakening</td><td>Breadth is narrowing or downside expansion is dominant.</td></tr>
    <tr><td>0–&lt;20</td><td>Risk-Off</td><td>Weakness is broad; it is still not a timing guarantee.</td></tr>
  </tbody></table></div>

  <h3>Cards, member lists and 60D history</h3>
  <p>Click a group card to inspect the exact latest official stocks or indices behind each numerator. Search matches security name or permanent Market + Code and results are paginated at 50 rows. Only the latest two official member sets are retained for safe publication; the chart stores 60 aggregate snapshots, not 60 days of security-level membership.</p>
  <p>History with a different Pulse Algorithm or Index Universe version is excluded. Partial history is labeled <code>History N/60 · Building</code> and is never padded or interpolated.</p>

  <h3>Publication and limitations</h3>
  <p>CN_A and CN_INDEX must both be successful and share the same official date. A-share row coverage and sector/theme coverage must each be at least 95%, and all four broad indices must be available. A failed run keeps the last valid Pulse and member set.</p>
  <p>Pulse is breadth context, not a probability, position size, target price or buy/sell signal. It does not observe futures basis, active order flow, fund flows, ETF NAV premiums, news or intraday reversals.</p>
</div>`;

