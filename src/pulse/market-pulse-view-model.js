/** Pure Market Pulse v1 normalization and fixed 0..100 chart geometry. */

export const PULSE_ALGORITHM_VERSION = 1;
export const PULSE_INDEX_UNIVERSE_VERSION = 2;
export const PULSE_HISTORY_LIMIT = 60;

export function escapePulseHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
  })[character]);
}

export function pulseNumber(value,fallback=null) {
  const number=Number(value);
  return Number.isFinite(number)?number:fallback;
}

export function formatPulseNumber(value,digits=1,fallback='—') {
  const number=pulseNumber(value);
  return number===null?fallback:number.toFixed(digits);
}

export function formatPulseSigned(value,digits=1,suffix='%') {
  const number=pulseNumber(value);
  return number===null?'—':`${number>0?'+':''}${number.toFixed(digits)}${suffix}`;
}

function metricObject(value) {
  return value && typeof value==='object' && !Array.isArray(value)?{...value}:{};
}

export function normalizePulseSnapshot(row) {
  if (!row || typeof row!=='object') return null;
  const tradeDate=String(row.trade_date||row.tradeDate||'').slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return null;
  const score=pulseNumber(row.pulse_score??row.pulseScore??row.score);
  if (score===null || score<0 || score>100) return null;
  return {
    provider:String(row.provider||'baostock'),
    tradeDate,
    algorithmVersion:pulseNumber(row.algorithm_version??row.algorithmVersion,0),
    indexUniverseVersion:pulseNumber(row.index_universe_version??row.indexUniverseVersion,0),
    calculationId:String(row.calculation_id||row.calculationId||''),
    score,
    state:String(row.pulse_state||row.pulseState||row.state||'Mixed'),
    stockEligibleCount:pulseNumber(row.stock_eligible_count??row.stockEligibleCount,0),
    indexEligibleCount:pulseNumber(row.index_eligible_count??row.indexEligibleCount,0),
    stockCoverage:pulseNumber(row.stock_coverage??row.stockCoverage,0),
    indexCoverage:pulseNumber(row.index_coverage??row.indexCoverage,0),
    participation:metricObject(row.participation),
    trendBreadth:metricObject(row.trend_breadth??row.trendBreadth),
    expansion:metricObject(row.expansion),
    leadership:metricObject(row.leadership),
  };
}

export function compatiblePulseHistory(rows,latestRow=null) {
  const latest=normalizePulseSnapshot(latestRow)||normalizePulseSnapshot(rows?.[0]);
  if (!latest) return [];
  const byDate=new Map();
  for (const source of rows||[]) {
    const snapshot=normalizePulseSnapshot(source);
    if (!snapshot || snapshot.algorithmVersion!==latest.algorithmVersion
      || snapshot.indexUniverseVersion!==latest.indexUniverseVersion) continue;
    byDate.set(snapshot.tradeDate,snapshot);
  }
  byDate.set(latest.tradeDate,latest);
  return [...byDate.values()].sort((a,b)=>a.tradeDate.localeCompare(b.tradeDate)).slice(-PULSE_HISTORY_LIMIT);
}

export function pulseStateClass(value) {
  const score=Number(value);
  if (score>=80) return 'is-broad';
  if (score>=60) return 'is-healthy';
  if (score>=40) return 'is-mixed';
  if (score>=20) return 'is-weakening';
  return 'is-risk-off';
}

export function buildPulseChartModel(history,{ width=640,height=236,padding={ left:38,right:14,top:18,bottom:28 } }={}) {
  const snapshots=(history||[]).map(normalizePulseSnapshot).filter(Boolean)
    .sort((a,b)=>a.tradeDate.localeCompare(b.tradeDate)).slice(-PULSE_HISTORY_LIMIT);
  const plotWidth=Math.max(1,width-padding.left-padding.right);
  const plotHeight=Math.max(1,height-padding.top-padding.bottom);
  const points=snapshots.map((snapshot,index)=>({
    ...snapshot,
    x:padding.left+(snapshots.length<=1?plotWidth:plotWidth*index/(snapshots.length-1)),
    y:padding.top+plotHeight*(1-snapshot.score/100),
  }));
  return {
    width,height,padding,plotWidth,plotHeight,points,
    thresholds:[20,40,60,80].map(value=>({ value,y:padding.top+plotHeight*(1-value/100) })),
    firstDate:points[0]?.tradeDate||'',
    lastDate:points.at(-1)?.tradeDate||'',
  };
}
