/**
 * Builds the simultaneous Scenario Lab comparison from the unchanged scenario engine.
 * Allowed dependencies: pure tracker calculations. Forbidden: browser state, storage and network.
 * Covered by: tests/unit/tracker.test.js and Tracker desktop/iPhone Playwright tests.
 */
import { projectScenario } from './trend-engine.js';

export const SCENARIO_DEFINITIONS = Object.freeze([
  Object.freeze({ key:'flat', label:'Flat' }),
  Object.freeze({ key:'trend', label:'Trend continuation' }),
  Object.freeze({ key:'custom', label:'Custom target' })
]);

function positiveTarget(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number=Number(value);
  return Number.isFinite(number) && number>0 ? number : null;
}

export function buildScenarioComparison(values, options={}) {
  const target=positiveTarget(options.target);
  return SCENARIO_DEFINITIONS.map(definition=>{
    const enabled=definition.key!=='custom' || target!==null;
    const projection=enabled ? projectScenario(values,{
      mode:definition.key,
      horizon:options.horizon,
      lookback:options.lookback,
      ...(definition.key==='custom' ? { target } : {})
    }) : null;
    return { ...definition, enabled, projection };
  });
}
