/** Pure normalization and formatting for Index Radar snapshots. No DOM/network/storage. */

export function escapeRadarHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
  })[character]);
}

export function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function formatRadarNumber(value, digits = 2, fallback = '—') {
  const number = finiteNumber(value);
  return number === null ? fallback : number.toFixed(digits);
}

export function formatRadarSigned(value, digits = 2, suffix = '%') {
  const number = finiteNumber(value);
  if (number === null) return '—';
  return `${number > 0 ? '+' : ''}${number.toFixed(digits)}${suffix}`;
}

export function normalizeRadarSnapshot(row) {
  if (!row || typeof row !== 'object') return null;
  const tradeDate = String(row.trade_date || row.tradeDate || '').slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return null;
  const leaders = Array.isArray(row.leaders) ? row.leaders.map((leader,index) => {
    const metrics = leader?.metrics && typeof leader.metrics === 'object' ? leader.metrics : {};
    const appearances = leader?.appearances && typeof leader.appearances === 'object' ? leader.appearances : {};
    return {
      ...leader,
      rank:finiteNumber(leader?.rank,index+1),
      score:finiteNumber(leader?.score,0),
      market:String(leader?.market || '').toUpperCase(),
      code:String(leader?.code || ''),
      name:String(leader?.name || `${leader?.market || ''}.${leader?.code || ''}`),
      themeGroup:String(leader?.themeGroup || ''),
      themeLabel:String(leader?.themeLabel || ''),
      events:Array.isArray(leader?.events) ? leader.events : [],
      risks:Array.isArray(leader?.risks) ? leader.risks : [],
      metrics,
      appearances:{
        consecutive:Math.max(1,finiteNumber(appearances.consecutive,1)),
        days15:Math.max(1,finiteNumber(appearances.days15,1)),
        days30:Math.max(1,finiteNumber(appearances.days30,1)),
      },
      scoreBreakdown:leader?.scoreBreakdown && typeof leader.scoreBreakdown === 'object' ? leader.scoreBreakdown : {},
      trendBreakdown:leader?.trendBreakdown && typeof leader.trendBreakdown === 'object' ? leader.trendBreakdown : {},
    };
  }).slice(0,5) : [];
  return {
    provider:String(row.provider || 'baostock'),
    tradeDate,
    algorithmVersion:finiteNumber(row.algorithm_version ?? row.algorithmVersion,0),
    universeVersion:finiteNumber(row.universe_version ?? row.universeVersion,0),
    benchmarkMarket:String(row.benchmark_market || row.benchmarkMarket || 'SH'),
    benchmarkCode:String(row.benchmark_code || row.benchmarkCode || '000300'),
    universeCount:finiteNumber(row.universe_count ?? row.universeCount,0),
    eligibleCount:finiteNumber(row.eligible_count ?? row.eligibleCount,0),
    coverage:finiteNumber(row.coverage,0),
    leaders,
  };
}

export function primaryRadarEvents(leader, limit = 2) {
  return [...(leader?.events || [])]
    .sort((a,b) => Number(b?.points || 0)-Number(a?.points || 0) || String(a?.label || '').localeCompare(String(b?.label || '')))
    .slice(0,limit);
}
