/**
 * Pure Terminal MACD suggestion and close/DIF divergence candidate helpers.
 * Allowed dependencies: pure Tracker trend engine.
 * Forbidden: DOM, storage, Supabase, network and Composite Signal scoring.
 * Covered by: MACD suggestion unit tests and Terminal Playwright tests.
 */
import { macd, macdSeries } from './trend-engine.js';

function finite(value) { return value !== null && value !== '' && Number.isFinite(Number(value)); }

export function classifyTerminalMacd(snapshot = {}) {
  if (!finite(snapshot.dif) || !finite(snapshot.dea)) {
    return { value:'neutral', label:'Wait / Flat', reason:'Insufficient MACD history' };
  }
  if (snapshot.cross === 'golden') {
    return { value:'bullish', label:'Bullish', reason:'Latest DIF crossed above DEA' };
  }
  if (snapshot.cross === 'death') {
    return { value:'bearish', label:'Bearish', reason:'Latest DIF crossed below DEA' };
  }
  if (Number(snapshot.dif) > Number(snapshot.dea) && snapshot.zeroAxis === 'above') {
    return { value:'bullish', label:'Bullish', reason:'DIF is above DEA and at/above the zero axis' };
  }
  if (Number(snapshot.dif) < Number(snapshot.dea) && snapshot.zeroAxis === 'below') {
    return { value:'bearish', label:'Bearish', reason:'DIF is below DEA and below the zero axis' };
  }
  return { value:'neutral', label:'Wait / Flat', reason:'MACD is in a mixed or transitional state' };
}

export function macdDifSeries(values) {
  return macdSeries(values).map(point => point.dif);
}

function pivotIndexes(values,start,radius,type) {
  const result = [];
  for (let index=Math.max(radius,start); index<values.length-radius; index+=1) {
    const center = values[index];
    const neighbors = values.slice(index-radius,index).concat(values.slice(index+1,index+radius+1));
    const bounded = type === 'low' ? neighbors.every(value => center <= value) : neighbors.every(value => center >= value);
    const strict = type === 'low' ? neighbors.some(value => center < value) : neighbors.some(value => center > value);
    if (bounded && strict) result.push(index);
  }
  return result;
}

function point(index,closes,dif,dates) {
  return { index, date:String(dates[index] || ''), close:closes[index], dif:dif[index] };
}

export function detectCloseMacdDivergence(values,dates = [], { lookback=60, pivotRadius=2 } = {}) {
  const paired = (Array.isArray(values) ? values : []).map((value,index) => ({ value:Number(value), date:dates[index] }))
    .filter(item => Number.isFinite(item.value));
  const closes = paired.map(item => item.value);
  const alignedDates = paired.map(item => item.date);
  const dif = macdDifSeries(closes);
  const start = Math.max(0,closes.length-Math.max(5,Number(lookback) || 60));
  const lows = pivotIndexes(closes,start,pivotRadius,'low').slice(-2);
  const highs = pivotIndexes(closes,start,pivotRadius,'high').slice(-2);
  let bullish = null;
  let bearish = null;
  if (lows.length === 2) {
    const first = point(lows[0],closes,dif,alignedDates), second = point(lows[1],closes,dif,alignedDates);
    if (second.close < first.close && second.dif > first.dif) bullish = { kind:'bullish', first, second };
  }
  if (highs.length === 2) {
    const first = point(highs[0],closes,dif,alignedDates), second = point(highs[1],closes,dif,alignedDates);
    if (second.close > first.close && second.dif < first.dif) bearish = { kind:'bearish', first, second };
  }
  return { bullish, bearish, lookback:Math.min(closes.length,Math.max(5,Number(lookback) || 60)), pivotRadius };
}

export function buildTerminalMacdSuggestion(values) {
  const closes = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
  const snapshot = macd(closes);
  const suggestion = closes.length < 35
    ? { value:'neutral', label:'Wait / Flat', reason:'At least 35 closes are required for a stable suggestion' }
    : classifyTerminalMacd(snapshot);
  return { snapshot, suggestion };
}
