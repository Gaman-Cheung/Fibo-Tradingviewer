/**
 * Owns the persisted Trend Tracker state contract shared by migration and UI adapters.
 * Allowed dependencies: none. Forbidden: DOM, network and trading calculations.
 * Covered by: tests/unit/tracker.test.js.
 */

export const TRACKER_MA_PROJECTION_SCENARIOS = Object.freeze(['flat','trend','custom']);
export const DEFAULT_TRACKER_MA_PROJECTION_SCENARIO = 'trend';

export function normalizeTrackerMaProjectionScenario(value) {
  const normalized=String(value || '').trim().toLowerCase();
  return TRACKER_MA_PROJECTION_SCENARIOS.includes(normalized)
    ? normalized
    : DEFAULT_TRACKER_MA_PROJECTION_SCENARIO;
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
