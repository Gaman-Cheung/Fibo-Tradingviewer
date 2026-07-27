/**
 * Builds the display-only model for the Trend Tracker canvas.
 * Allowed dependencies: none. Forbidden: DOM, storage, network and trading algorithms.
 * Covered by: tests/unit/tracker.test.js.
 */

export const TRACKER_CHART_WINDOW = 120;
export const TRACKER_FORECAST_MIN_RATIO = 0.04;
export const TRACKER_FORECAST_MAX_RATIO = 0.25;
export const TRACKER_HISTORY_Y_PADDING_RATIO = 0.08;
export const TRACKER_FORECAST_Y_LIMIT_RATIO = 0.15;

export function trackerForecastRatio(pointCount, horizon) {
  const historyIntervals=Math.max(1,Math.floor(Number(pointCount)||0)-1);
  const forecastCount=Math.max(1,Math.floor(Number(horizon)||1));
  const naturalRatio=forecastCount/(historyIntervals+forecastCount);
  return Math.max(TRACKER_FORECAST_MIN_RATIO,Math.min(TRACKER_FORECAST_MAX_RATIO,naturalRatio));
}

export function buildTrackerChartXModel(pointCount, horizon, plot) {
  const left=Number(plot?.left)||0;
  const right=Number(plot?.right)||left;
  const ratio=trackerForecastRatio(pointCount,horizon);
  const historyRight=left+(right-left)*(1-ratio);
  const historyCount=Math.max(0,Math.floor(Number(pointCount)||0));
  const forecastCount=Math.max(1,Math.floor(Number(horizon)||1));
  const history=Array.from({length:historyCount},(_,index)=>historyCount===1
    ? historyRight
    : left+(historyRight-left)*index/(historyCount-1));
  const forecast=Array.from({length:forecastCount},(_,index)=>historyRight+(right-historyRight)*(index+1)/forecastCount);
  return { left, right, historyRight, history, forecast, forecastRatio:ratio };
}

function finitePrices(values) {
  return (Array.isArray(values)?values:[]).map(Number).filter(value=>Number.isFinite(value));
}

export function buildTrackerChartYModel(historyValues, forecastValues, options={}) {
  const history=finitePrices(historyValues);
  if(!history.length)return null;
  const forecast=finitePrices(forecastValues);
  const historyMin=Math.min(...history),historyMax=Math.max(...history);
  const historySpan=historyMax-historyMin || Math.abs(historyMax)*.02 || 1;
  const paddingRatio=Number.isFinite(Number(options.paddingRatio))?Math.max(0,Number(options.paddingRatio)):TRACKER_HISTORY_Y_PADDING_RATIO;
  const limitRatio=Number.isFinite(Number(options.limitRatio))?Math.max(paddingRatio,Number(options.limitRatio)):TRACKER_FORECAST_Y_LIMIT_RATIO;
  const forecastMin=forecast.length?Math.min(...forecast):historyMin;
  const forecastMax=forecast.length?Math.max(...forecast):historyMax;
  const paddedMin=historyMin-historySpan*paddingRatio;
  const paddedMax=historyMax+historySpan*paddingRatio;
  const allowedMin=historyMin-historySpan*limitRatio;
  const allowedMax=historyMax+historySpan*limitRatio;
  const min=Math.min(paddedMin,Math.max(allowedMin,forecastMin));
  const max=Math.max(paddedMax,Math.min(allowedMax,forecastMax));
  return { min,max,historyMin,historyMax,historySpan,forecastMin,forecastMax,clippedLow:forecastMin<min,clippedHigh:forecastMax>max,paddingRatio,limitRatio };
}

export function trackerChartEdge(value, yModel) {
  const number=Number(value);
  if(!Number.isFinite(number)||!yModel)return '';
  if(number>yModel.max)return 'high';
  if(number<yModel.min)return 'low';
  return '';
}

function validPrice(value) {
  const number=Number(value);
  return Number.isFinite(number) && number>0 ? number : null;
}

function markerLabel(kinds) {
  if (kinds.length===3) return 'High / Low / Latest Close';
  if (kinds.includes('high') && kinds.includes('latest')) return 'High / Latest Close';
  if (kinds.includes('low') && kinds.includes('latest')) return 'Low / Latest Close';
  if (kinds.includes('high') && kinds.includes('low')) return 'High / Low Close';
  if (kinds.includes('high')) return 'High Close';
  if (kinds.includes('low')) return 'Low Close';
  return 'Latest Close';
}

export function buildTrackerChartModel(values, dates, options={}) {
  const raw=Array.isArray(values)?values:[];
  const source=raw.map((value,index)=>({ value:validPrice(value), sourceIndex:index, date:String(dates?.[index]||'') })).filter(point=>point.value!==null);
  const hasPreview=Boolean(options.hasPreview) && source.length>0;
  if (hasPreview) source.at(-1).isPreview=true;
  const windowSize=Math.max(1,Number(options.windowSize)||TRACKER_CHART_WINDOW);
  const startIndex=Math.max(0,source.length-windowSize);
  const points=source.slice(startIndex).map((point,index)=>({ ...point, index, isPreview:Boolean(point.isPreview), date:point.isPreview?'':point.date }));
  const official=points.filter(point=>!point.isPreview);
  if (!official.length) {
    return { points, official, startIndex, startDate:'', endDate:'', markers:[], preview:points.find(point=>point.isPreview)||null, ariaLabel:'Trend chart has no official close data.' };
  }

  let high=official[0], low=official[0];
  for (const point of official) {
    if (point.value>=high.value) high=point;
    if (point.value<=low.value) low=point;
  }
  const latest=official.at(-1);
  const grouped=new Map();
  for (const [kind,point] of [['high',high],['low',low],['latest',latest]]) {
    const group=grouped.get(point.index)||{ index:point.index, value:point.value, date:point.date, kinds:[] };
    group.kinds.push(kind); grouped.set(point.index,group);
  }
  const markers=[...grouped.values()].map(group=>({ ...group, label:markerLabel(group.kinds) })).sort((a,b)=>a.index-b.index);
  const preview=points.find(point=>point.isPreview)||null;
  const startDate=official[0].date, endDate=latest.date;
  const ariaParts=[
    `Trend chart range ${startDate||'unknown'} to ${endDate||'unknown'}.`,
    `High close ${high.value.toFixed(3)} on ${high.date||'unknown'}.`,
    `Low close ${low.value.toFixed(3)} on ${low.date||'unknown'}.`,
    `Latest close ${latest.value.toFixed(3)} on ${latest.date||'unknown'}.`
  ];
  if (preview) ariaParts.push(`Current preview ${preview.value.toFixed(3)}.`);
  return { points, official, startIndex, startDate, endDate, markers, preview, high, low, latest, ariaLabel:ariaParts.join(' ') };
}
