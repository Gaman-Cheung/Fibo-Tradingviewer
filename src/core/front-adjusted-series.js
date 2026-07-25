/**
 * Reconstructs BaoStock's return-adjusted close series from raw close + pctChg.
 * Allowed dependencies: none. Forbidden: DOM, storage, network and app modules.
 * Covered by: tests/unit/tracker.test.js and the live BaoStock smoke mode.
 */

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function buildFrontAdjustedSeries(rows) {
  const byDate = new Map();
  for (const source of Array.isArray(rows) ? rows : []) {
    const tradeDate = String(source?.trade_date || '');
    const rawClose = finitePositive(source?.close);
    if (!tradeDate || rawClose === null) continue;
    byDate.set(tradeDate, { ...source, trade_date:tradeDate, raw_close:rawClose });
  }
  const ordered = [...byDate.values()].sort((a,b)=>a.trade_date.localeCompare(b.trade_date));
  if (!ordered.length) return [];

  const adjusted = new Array(ordered.length);
  adjusted[ordered.length - 1] = ordered.at(-1).raw_close;
  for (let index=ordered.length-1; index>0; index-=1) {
    const pct=Number(ordered[index].pct_chg);
    if (ordered[index].pct_chg !== null && ordered[index].pct_chg !== '' && Number.isFinite(pct) && pct > -100) {
      adjusted[index-1]=adjusted[index]/(1+pct/100);
      continue;
    }
    adjusted[index-1]=adjusted[index]*ordered[index-1].raw_close/ordered[index].raw_close;
  }
  return ordered.map((row,index)=>({ ...row, close:adjusted[index], adjust_mode:'front-reconstructed' }));
}
