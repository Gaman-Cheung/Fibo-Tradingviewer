/**
 * Owns the persisted Trend Tracker state contract shared by migration and UI adapters.
 * Allowed dependencies: none. Forbidden: DOM, network and trading calculations.
 * Covered by: tests/unit/tracker.test.js.
 */

export const TRACKER_MA_PROJECTION_SCENARIOS = Object.freeze(['flat','trend','custom']);
export const DEFAULT_TRACKER_MA_PROJECTION_SCENARIO = 'trend';
export const DEFAULT_TRACKER_SCENARIO_VISIBILITY = Object.freeze({ flat:true,trend:true,custom:true });

export function normalizeTrackerMaProjectionScenario(value) {
  const normalized=String(value || '').trim().toLowerCase();
  return TRACKER_MA_PROJECTION_SCENARIOS.includes(normalized)
    ? normalized
    : DEFAULT_TRACKER_MA_PROJECTION_SCENARIO;
}

export function normalizeTrackerScenarioVisibility(value) {
  const source=value && typeof value==='object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(TRACKER_MA_PROJECTION_SCENARIOS.map(key=>[
    key,typeof source[key]==='boolean' ? source[key] : DEFAULT_TRACKER_SCENARIO_VISIBILITY[key]
  ]));
}

export function migrateTrackerMaProjectionState(value) {
  const source=value && typeof value==='object' && !Array.isArray(value) ? value : {};
  const sourceInstruments=source.instruments && typeof source.instruments==='object' && !Array.isArray(source.instruments)
    ? source.instruments
    : {};
  let changed=sourceInstruments!==source.instruments;
  const instruments=Object.fromEntries(Object.entries(sourceInstruments).map(([id,value])=>{
    const instrument=value && typeof value==='object' && !Array.isArray(value) ? value : {};
    const maProjectionScenario=normalizeTrackerMaProjectionScenario(instrument.maProjectionScenario);
    if(instrument.maProjectionScenario!==maProjectionScenario)changed=true;
    return [id,{...instrument,maProjectionScenario}];
  }));
  return { state:{...source,instruments},changed };
}

export function migrateTrackerScenarioVisibilityState(value) {
  const source=value && typeof value==='object' && !Array.isArray(value) ? value : {};
  const sourceInstruments=source.instruments && typeof source.instruments==='object' && !Array.isArray(source.instruments)
    ? source.instruments
    : {};
  let changed=sourceInstruments!==source.instruments;
  const instruments=Object.fromEntries(Object.entries(sourceInstruments).map(([id,value])=>{
    const instrument=value && typeof value==='object' && !Array.isArray(value) ? value : {};
    const scenarioVisibility=normalizeTrackerScenarioVisibility(instrument.scenarioVisibility);
    if(!instrument.scenarioVisibility || TRACKER_MA_PROJECTION_SCENARIOS.some(key=>instrument.scenarioVisibility[key]!==scenarioVisibility[key]))changed=true;
    return [id,{...instrument,scenarioVisibility}];
  }));
  return { state:{...source,instruments},changed };
}
