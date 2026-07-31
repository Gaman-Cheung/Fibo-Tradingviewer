/**
 * Index Radar indicator vocabulary and in-product guide.
 * Allowed dependencies: pure Leadership Memory constants. Forbidden: DOM, storage, network and trading scores.
 * Covered by: contract and Radar view-model tests.
 */
import { LEADERSHIP_MEMORY_VERSION } from './radar-memory.js';

export const INDEX_RADAR_ALGORITHM_VERSION = 1;
export const INDEX_RADAR_UNIVERSE_VERSION = 1;
export const ETF_RADAR_ALGORITHM_VERSION = 1;
export const ETF_RADAR_UNIVERSE_VERSION = 1;

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
const etfEventRows = RADAR_EVENT_GUIDE.map(([name, score, meaning]) => `
  <tr><th>${name}</th><td><code>${score}</code></td><td>${meaning
    .replace('index-to-CSI300','ETF-to-CSI300')
    .replace('strong index','strong ETF')}</td></tr>`).join('');
const etfRiskRows = RADAR_RISK_GUIDE.map(([name, score, meaning]) => `
  <tr><th>${name}</th><td><code>${score}</code></td><td>${meaning.replace('The index','The ETF')}</td></tr>`).join('');

export const INDEX_RADAR_GUIDE_HTML = `
  <div class="fibo-help-content index-radar-guide" data-radar-guide-version="${INDEX_RADAR_ALGORITHM_VERSION}" data-leadership-memory-version="${LEADERSHIP_MEMORY_VERSION}">
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
      <li>The main card displays Theme Group <code>Consecutive</code>, <code>13D</code> and <code>60D</code> appearances derived from compatible final snapshots.</li>
      <li>The snapshot's legacy 30-session appearance count still breaks an exact Score tie and supports the one-day stability buffer. It never adds recurring points to the Radar Score.</li>
    </ul>

    <h3>Leadership Memory v${LEADERSHIP_MEMORY_VERSION}</h3>
    <p>Leadership Memory reads only the latest 60 final Top 5 snapshots. It does not download 507 index histories and is not the discarded raw ranking of every eligible candidate.</p>
    <ul>
      <li><code>Yesterday</code> is the exact final Top 5 from the previous official trading session and compares each Theme Group with today's final list.</li>
      <li><code>3D Fast</code>, <code>13D Swing</code> and <code>60D Regime</code> include the latest official session and the preceding compatible sessions.</li>
      <li>Each day awards 5 / 4 / 3 / 2 / 1 points to ranks 1–5. If two representatives from one Theme Group appear, only the better daily rank is counted.</li>
      <li><code>Leadership Score = accumulated rank points ÷ (5 × available sessions) × 100</code>. Ties use appearances, average rank, recency and then the stable theme name.</li>
      <li>A 60D leader remains visible for the full window even after leaving the current list; <code>Last Seen</code> states how many official sessions ago it last appeared.</li>
      <li><code>History N/60 · Building</code> means only N compatible snapshots are available. Algorithm or Universe version mismatches are never mixed.</li>
      <li>Mini cards show three themes. Details contain every theme that appeared in the selected window: at most 5 for Yesterday, 15 for 3D and the currently classified 28 Theme Groups for 13D/60D.</li>
    </ul>

    <h3>How to read one card</h3>
    <p><code>#1 AI &amp; Computing · MA60 Reclaim · RS5 +4.6% · Consecutive 4D · 13D 7× · 60D 12×</code> means this theme currently ranks first, has an official reclaim event, outperformed CSI300 over five sessions and has repeatedly survived compatible final boards. It does not say that a constituent stock should be bought.</p>

    <h3>Boundary</h3>
    <p>Index Radar is a context and attention tool—not a probability, price target, buy signal or promise. It never changes Terminal Composite Signal, Fibonacci, Stop, R:R, MACD, Trend Tracker or Wave calculations.</p>
  </div>`;

function etfScopeGuide(scope) {
  const cross=scope==='CROSS_ASSET';
  const scopeName=cross?'Cross Asset':'Equity ETF';
  const universe=cross
    ? 'overseas equity, commodity, bond and money-market ETFs'
    : 'domestic broad-market, sector, theme and strategy ETFs';
  const categoryRule=cross
    ? '<li>After strict Theme Group deduplication, overseas, commodity, bond and money categories can supply at most two final cards each. The stability buffer cannot break this cap.</li>'
    : '<li>Equity ETF has no category quota after strict Theme Group deduplication.</li>';
  return `
    <div class="fibo-help-content index-radar-guide" data-radar-guide-version="${ETF_RADAR_ALGORITHM_VERSION}" data-radar-scope="${scope}" data-leadership-memory-version="${LEADERSHIP_MEMORY_VERSION}">
      <h3>${scopeName} scope and official data</h3>
      <p>This scope ranks explicitly reviewed ${universe}. BaoStock official Close, pctChg, Trade Status and Amount are retained for 144 official sessions. High/Low is used only during synchronization for Retest context and is then discarded.</p>
      <p>Price history is made continuous from official <code>pctChg</code> and anchored to the latest official Close so distributions or splits do not create false MA events. Amount remains unadjusted and is used only as a liquidity measure.</p>

      <h3>Score and entry gate</h3>
      <p class="formula"><code>Score = 25 × PctRank(RS5) + 30 × PctRank(RS20) + Trend(0–30) + min(Event, 15) − Risk</code></p>
      <ul>
        <li><code>RS5 / RS20</code> = ETF 5/20-session continuous return minus CSI300 over the same official sessions. Percentile ranks are calculated only among eligible Theme representatives in this scope.</li>
        <li>Trend uses Close above MA60 (+5), rising MA60 (+10), and <code>Close &gt; MA20 &gt; MA60</code> with both averages rising (+15).</li>
        <li>A candidate needs at least 62 official sessions, Score ≥ 60, Close above MA60, positive RS5 or RS20 and no MA60 Breakdown.</li>
        <li>At most five qualified leaders are shown. The board is allowed to contain fewer.</li>
      </ul>

      <h3>Liquidity and Theme representative</h3>
      <ul>
        <li>Within each Theme Group, only the ETF with the highest 20-session average official Amount can enter scoring.</li>
        <li>If that representative averages less than RMB 20 million, the entire Theme Group is excluded. The model never substitutes a less-liquid second ETF.</li>
        <li>A representative may change over time as liquidity changes. Leadership Memory continues by Theme Group, not by ETF code.</li>
        <li>Amount is transaction value, not fund flow, subscription/redemption flow, capital inflow or fund size.</li>
        ${categoryRule}
      </ul>

      <h3>Events</h3>
      <div class="index-radar-guide__table"><table><thead><tr><th>Indicator</th><th>Score</th><th>Actual condition</th></tr></thead><tbody>${etfEventRows}</tbody></table></div>
      <p>Event points are capped at 15. Retest, Healthy Retest and Near MA60 are context-only indicators and add no points.</p>

      <h3>Risks</h3>
      <div class="index-radar-guide__table"><table><thead><tr><th>State</th><th>Effect</th><th>Meaning</th></tr></thead><tbody>${etfRiskRows}</tbody></table></div>

      <h3>Leadership Memory v${LEADERSHIP_MEMORY_VERSION}</h3>
      <p>Yesterday, 3D Fast, 13D Swing and 60D Regime reuse the same final-Top-5 history rules as Sector Index. Ranks earn 5 / 4 / 3 / 2 / 1 points, mini cards show the first three themes, partial history is labelled Building, and incompatible Algorithm/Universe/Scope versions are never mixed.</p>

      <h3>How to read the detail</h3>
      <p>The detail separates score, returns, MA structure, official events, risk and the current representative's 20D average Amount. For Cross Asset, the quiet category label identifies overseas, commodity, bond or money without implying that unlike assets share the same economics.</p>

      <h3>Boundary</h3>
      <p>ETF Radar studies exchange prices, returns and liquidity only. It does not know NAV premium/discount, ETF flows, bond yield, commodity spot price or currency hedge exposure. It is not a probability, recommendation or buy signal and never changes Terminal Composite Signal.</p>
    </div>`;
}

export const ETF_RADAR_GUIDE_HTML = Object.freeze({
  EQUITY_ETF:etfScopeGuide('EQUITY_ETF'),
  CROSS_ASSET:etfScopeGuide('CROSS_ASSET'),
});
