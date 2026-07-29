/**
 * Index Radar indicator vocabulary and in-product guide.
 * Allowed dependencies: none. Forbidden: DOM, storage, network and trading scores.
 * Covered by: contract and Radar view-model tests.
 */
export const INDEX_RADAR_ALGORITHM_VERSION = 1;
export const INDEX_RADAR_UNIVERSE_VERSION = 1;

export const RADAR_EVENT_GUIDE = Object.freeze([
  ['MA60 Reclaim Confirmed', '+9', 'A reclaim is followed by two consecutive official closes above the contemporaneous MA60.'],
  ['MA60 Breakout', '+8', 'The previous official close was not above MA60 and the latest official close moves above it.'],
  ['20D High Breakout', '+7', 'The latest official close exceeds every official close in the preceding 20 sessions.'],
  ['Relative Strength New High', '+6', 'The index-to-CSI300 relative-strength ratio reaches a 20-session high.'],
  ['MA60 Turn Up', '+6', 'The daily MA60 change moves from flat/down to more than +0.01%.'],
  ['3D Acceleration', '+5', 'The three-session cumulative close return is at least +5%.'],
  ['Persistent Advance', '+4', 'At least seven of the latest ten sessions closed higher.'],
  ['3-Day Streak', '+3', 'The latest three official sessions all closed higher.'],
  ['1D Surge', '+2', 'The latest official one-session return is at least +5%; it is an attention badge, not a complete trend.'],
  ['MA60 Retest', '0', 'The session High/Low crosses MA60. High/Low is used transiently by the sync job and is not stored.'],
  ['Healthy Retest', '0', 'A previously strong index touches MA60, closes back above it and retains a rising MA60.'],
  ['Near MA60', '0', 'Close is within ±0.8% of MA60 while MA60 rises, RS20 is positive and at least 10 of 15 closes stayed above MA60.'],
]);

export const RADAR_RISK_GUIDE = Object.freeze([
  ['Extended', '−10', 'Close is more than 12% above MA60. Strength remains visible, but extension risk is deducted.'],
  ['MA60 Breakdown', 'Excluded', 'The index closes below MA60 after previously closing at or above it, so it cannot enter the leader rail.'],
]);

const eventRows = RADAR_EVENT_GUIDE.map(([name, score, meaning]) => `
  <tr><th>${name}</th><td><code>${score}</code></td><td>${meaning}</td></tr>`).join('');
const riskRows = RADAR_RISK_GUIDE.map(([name, score, meaning]) => `
  <tr><th>${name}</th><td><code>${score}</code></td><td>${meaning}</td></tr>`).join('');

export const INDEX_RADAR_GUIDE_HTML = `
  <div class="fibo-help-content index-radar-guide" data-radar-guide-version="${INDEX_RADAR_ALGORITHM_VERSION}">
    <h3>Purpose and official data</h3>
    <p>Index Radar reads BaoStock official daily index closes. It stores a rolling 400-session history, ranks only explicitly classified sector and theme indices, and uses <code>SH.000300</code> CSI300 only as the relative-strength benchmark. Broad, style, fund and bond indices cannot occupy the leader rail.</p>
    <p><span class="fibo-analysis-source fibo-analysis-source--official">Official Close</span> means a completed exchange session. Manual Current, Pool, Ticker and permanent IDs never enter this module.</p>

    <h3>Score</h3>
    <p class="formula"><code>Score = 25 × PctRank(RS5) + 30 × PctRank(RS20) + Trend(0–30) + min(Event, 15) − Risk</code></p>
    <ul>
      <li>The positive budget is 55 points of relative strength, 30 points of trend structure and at most 15 event points; Risk is deducted afterward.</li>
      <li><code>RS5 / RS20</code> = the index 5/20-session return minus CSI300's return over the same official sessions.</li>
      <li>Close above MA60 contributes 5; a rising MA60 contributes 10.</li>
      <li><code>Close &gt; MA20 &gt; MA60</code> with both averages rising contributes 15.</li>
      <li>A leader needs Score ≥ 60, Close above MA60, positive RS5 or RS20, at least 62 official sessions and no MA60 Breakdown.</li>
      <li>The rail shows at most five qualified leaders and is allowed to show fewer; weak indices are never added just to fill space.</li>
      <li>MA slope uses the daily percentage change of the moving average; values within ±0.01% are treated as flat.</li>
    </ul>

    <h3>Events</h3>
    <div class="index-radar-guide__table"><table><thead><tr><th>Indicator</th><th>Score</th><th>Actual condition</th></tr></thead><tbody>${eventRows}</tbody></table></div>
    <p>Event points are capped at 15 in total. Retest and Near MA60 are context only, so transient High/Low cannot make a historical ranking inconsistent after a resumed backfill.</p>

    <h3>Risks</h3>
    <div class="index-radar-guide__table"><table><thead><tr><th>State</th><th>Effect</th><th>Meaning</th></tr></thead><tbody>${riskRows}</tbody></table></div>

    <h3>Theme deduplication and persistence</h3>
    <ul>
      <li>Normally one representative is shown per Theme Group. A second is allowed only when both are in the raw Top 5 and their scores differ by no more than five points.</li>
      <li>A previous leader may survive the cutoff only when it remains in the raw Top 8, still scores at least 60 and stays within five points of today's fifth leader.</li>
      <li><code>Consecutive</code>, <code>15D</code> and <code>30D</code> count appearances after final theme deduplication. Recent final appearances break an exact score tie and support the one-day stability buffer, but never add score.</li>
    </ul>

    <h3>How to read one card</h3>
    <p><code>#1 AI &amp; Computing · MA60 Reclaim · RS5 +4.6% · Consecutive 4D · 15D 7× · 30D 12×</code> means this theme currently ranks first, has an official reclaim event, outperformed CSI300 over five sessions and has repeatedly survived the final deduplicated board. It does not say that a constituent stock should be bought.</p>

    <h3>Boundary</h3>
    <p>Index Radar is a context and attention tool—not a probability, price target, buy signal or promise. It never changes Terminal Composite Signal, Fibonacci, Stop, R:R, MACD, Trend Tracker or Wave calculations.</p>
  </div>`;
