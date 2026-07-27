/**
 * Calculates conditional moving-average paths from an existing Scenario close path.
 * Allowed dependencies: pure Tracker calculations. Forbidden: DOM, storage and network.
 * Covered by: tests/unit/tracker.test.js.
 */
import { sma } from './trend-engine.js';

function validPeriods(periods) {
  return [...new Set((Array.isArray(periods)?periods:[])
    .map(Number)
    .filter(period=>Number.isInteger(period)&&period>0))];
}

export function projectMovingAverageSeries(baseValues, scenarioPath, periods) {
  const combined=Array.isArray(baseValues)?[...baseValues]:[];
  const path=Array.isArray(scenarioPath)?[...scenarioPath]:[];
  const series=validPeriods(periods).map(period=>({period,start:sma(combined,period),values:[]}));
  for(const value of path){
    combined.push(value);
    series.forEach(item=>item.values.push(sma(combined,item.period)));
  }
  return series;
}
