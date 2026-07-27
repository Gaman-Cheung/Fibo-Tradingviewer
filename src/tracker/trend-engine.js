/**
 * Pure Trend Tracker calculations.
 * Allowed dependencies: none. Forbidden: DOM, storage, Supabase and network.
 * Covered by: tracker golden tests.
 */
export const MA_PERIODS = Object.freeze([5, 10, 13, 20, 30, 60, 120, 144, 240]);
export const DEFAULT_VISIBLE_MAS = Object.freeze([5, 10, 20, 30, 60, 120, 240]);
const FLAT_RATIO = 0.0001; // 0.01% of previous MA

const finite = value => Number.isFinite(Number(value));
const cleanCloses = values => (Array.isArray(values) ? values : []).map(Number).filter(value => Number.isFinite(value) && value > 0);

export function sma(values, period) {
  const closes = cleanCloses(values);
  if (closes.length < period) return null;
  return closes.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

export function maSnapshot(values, periods = MA_PERIODS) {
  const closes = cleanCloses(values);
  const result = {};
  for (const period of periods) {
    const current = sma(closes, period);
    const previous = sma(closes.slice(0, -1), period);
    const delta = closes.length > period ? (closes.at(-1) - closes.at(-(period + 1))) / period : null;
    const ratio = finite(delta) && finite(previous) && previous !== 0 ? delta / previous : null;
    result[period] = { value:current, previous, delta, ratio, direction:directionOf(ratio) };
  }
  return result;
}

export function directionOf(ratio, flatRatio = FLAT_RATIO) {
  if (!finite(ratio)) return 'insufficient';
  if (Math.abs(Number(ratio)) <= flatRatio) return 'flat';
  return Number(ratio) > 0 ? 'up' : 'down';
}

export function maDirectionHistory(values, period, count = 4) {
  const closes = cleanCloses(values);
  const result = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const slice = offset ? closes.slice(0, -offset) : closes;
    result.push(maSnapshot(slice, [period])[period].direction);
  }
  return result;
}

export function turnState(values, period) {
  const history = maDirectionHistory(values, period, 4).filter(value => value !== 'insufficient');
  const current = history.at(-1) || 'insufficient';
  const previous = history.at(-2);
  const alert = ['up', 'down'].includes(current) && previous && previous !== current;
  const confirmed = history.length >= 3 && history.slice(-3).every(value => value === current) && ['up', 'down'].includes(current);
  return { direction:current, alert, confirmed };
}

function emaSeries(values, period) {
  const alpha = 2 / (period + 1);
  const output = [];
  values.forEach((value, index) => output.push(index ? value * alpha + output[index - 1] * (1 - alpha) : value));
  return output;
}

export function macdSeries(values) {
  const closes = cleanCloses(values);
  if (!closes.length) return [];
  const fast = emaSeries(closes, 12);
  const slow = emaSeries(closes, 26);
  const dif = fast.map((value, index) => value - slow[index]);
  const dea = emaSeries(dif, 9);
  const hist = dif.map((value, index) => (value - dea[index]) * 2);
  return closes.map((close,index) => ({ close, dif:dif[index], dea:dea[index], histogram:hist[index] }));
}

export function macd(values) {
  const series = macdSeries(values);
  if (!series.length) return { dif:null, dea:null, histogram:null, direction:'insufficient', cross:'none', zeroAxis:'unknown' };
  const latest = series.at(-1), previousPoint = series.at(-2);
  const last = latest.histogram, previous = previousPoint?.histogram;
  const previousDif = previousPoint?.dif, previousDea = previousPoint?.dea;
  let cross = 'none';
  if (finite(previousDif) && previousDif <= previousDea && latest.dif > latest.dea) cross = 'golden';
  if (finite(previousDif) && previousDif >= previousDea && latest.dif < latest.dea) cross = 'death';
  return {
    dif:latest.dif, dea:latest.dea, histogram:last,
    direction:!finite(previous) ? 'insufficient' : Math.abs(last) > Math.abs(previous) ? 'strengthening' : 'weakening',
    cross, zeroAxis:latest.dif >= 0 ? 'above' : 'below'
  };
}

export function sideConfirmation(values, period) {
  const closes = cleanCloses(values);
  const sides = [closes.slice(0, -1), closes].map(slice => {
    const average = sma(slice, period);
    if (!finite(average) || !slice.length) return 'insufficient';
    return slice.at(-1) >= average ? 'above' : 'below';
  });
  return { side:sides.at(-1), watch:sides.at(-1) !== sides[0] && !sides.includes('insufficient'), confirmed:sides[0] === sides[1] && ['above','below'].includes(sides[1]) };
}

export function adaptiveProfile(analysis) {
  if (analysis.background === 'Long Bear') return { focus:[120,144,240], horizon:20, thresholdDays:60, lookback:60 };
  if (analysis.structure === 'Range') return { focus:[20,30,60], horizon:20, thresholdDays:30, lookback:30 };
  if (analysis.event.includes('反转')) return { focus:[5,10,13,20,30,60], horizon:20, thresholdDays:30, lookback:30 };
  return { focus:[5,10,13], horizon:10, thresholdDays:20, lookback:10 };
}

export function analyzeTrend(values) {
  const closes = cleanCloses(values);
  const ma = maSnapshot(closes);
  const last = closes.at(-1) ?? null;
  let background = 'Transition';
  if (finite(ma[240].value)) {
    if (last >= ma[240].value && ma[240].direction === 'up') background = 'Long Bull';
    else if (last < ma[240].value && ma[240].direction === 'down') background = 'Long Bear';
  }
  let structure = 'Range';
  if (finite(ma[20].value) && ma[5].value > ma[10].value && ma[10].value > ma[20].value && ma[5].direction === 'up' && ma[10].direction === 'up') structure = 'Uptrend';
  if (finite(ma[20].value) && ma[5].value < ma[10].value && ma[10].value < ma[20].value && ma[5].direction === 'down' && ma[10].direction === 'down') structure = 'Downtrend';
  const ma20Turn = turnState(closes, 20);
  const ma60Side = sideConfirmation(closes, 60);
  let event = '趋势延续';
  if (background === 'Long Bear' && structure === 'Uptrend') event = ma20Turn.confirmed && ma60Side.side === 'above' && ma60Side.confirmed ? '反转确认' : '下跌反抽';
  else if (background === 'Long Bull' && structure === 'Downtrend') event = '调整探底';
  else if (background === 'Transition' && (ma20Turn.alert || ma60Side.watch)) event = '反转观察';
  else if (structure === 'Range') event = '震荡等待';
  const result = { close:last, background, structure, event, ma, macd:macd(closes), confirmations:{ ma20:sideConfirmation(closes,20), ma60:ma60Side }, turns:{ ma5:turnState(closes,5), ma20:ma20Turn, ma60:turnState(closes,60) } };
  result.profile = adaptiveProfile(result);
  return result;
}

export function appendProvisionalCurrent(values, current) {
  const closes = cleanCloses(values);
  return finite(current) && Number(current) > 0 ? [...closes, Number(current)] : closes;
}

function logReturns(values) {
  return values.slice(1).map((value,index) => Math.log(value / values[index]));
}

export function projectScenario(values, options = {}) {
  const closes = cleanCloses(values);
  if (!closes.length) return { path:[], lower:[], upper:[], analyses:[] };
  const horizon = Math.max(1, Math.min(240, Number(options.horizon) || 20));
  const mode = options.mode || 'flat';
  const analysis = analyzeTrend(closes);
  const lookback = Math.min(closes.length, Number(options.lookback) || analysis.profile.lookback);
  const recent = closes.slice(-lookback);
  const returns = logReturns(recent);
  const mean = returns.length ? returns.reduce((a,b)=>a+b,0)/returns.length : 0;
  const sigmaReturns = logReturns(closes.slice(-21));
  const sigma = sigmaReturns.length > 1 ? Math.sqrt(sigmaReturns.reduce((sum,value)=>sum+(value-(sigmaReturns.reduce((a,b)=>a+b,0)/sigmaReturns.length))**2,0)/(sigmaReturns.length-1)) : 0;
  const boundedSlope = Math.sign(mean) * Math.min(Math.abs(mean), sigma ? sigma * 2 : Math.abs(mean));
  const target = Number(options.target);
  const start = closes.at(-1);
  const path = [];
  for (let day=1; day<=horizon; day+=1) {
    let value = start;
    if (mode === 'trend') value = start * Math.exp(boundedSlope * day);
    if (mode === 'custom' && finite(target) && target > 0) value = start * Math.exp(Math.log(target/start) * day/horizon);
    path.push(value);
  }
  const lower = path.map((value,index) => value * Math.exp(-sigma * Math.sqrt(index + 1)));
  const upper = path.map((value,index) => value * Math.exp(sigma * Math.sqrt(index + 1)));
  const analyses = path.map((_,index) => analyzeTrend([...closes, ...path.slice(0,index + 1)]));
  return { path, lower, upper, analyses, sigma, boundedSlope, probabilityClaim:false };
}
