/** Versioned, idempotent migration registry. */
import { STORAGE_KEYS } from './config.js';
import { readArray } from './storage.js';
import { loadInstrumentPool, migrateTerminalIdentity, saveInstrumentPool } from './instrument-identity.js';
import { migrateLegacyMarket, normalizeSecurityCode } from './market-code.js';
import { reconcileLegacyTrackerInputs } from './shared-live-inputs.js';
import { migrateTrackerMaProjectionState, migrateTrackerScenarioVisibilityState } from './tracker-state.js';

export const CURRENT_SCHEMA_VERSION = 6;

export function runMigrations(storage = globalThis.localStorage) {
  const current = Number(storage.getItem(STORAGE_KEYS.migrationVersion) || 0);
  if (current < 1) {
    const migrated = migrateTerminalIdentity(
      readArray(storage, STORAGE_KEYS.lookFirst),
      readArray(storage, STORAGE_KEYS.thenLeap),
      loadInstrumentPool(storage)
    );
    storage.setItem(STORAGE_KEYS.lookFirst, JSON.stringify(migrated.v6Data));
    storage.setItem(STORAGE_KEYS.thenLeap, JSON.stringify(migrated.v7Data));
    saveInstrumentPool(migrated.pool, storage);
  }
  if (current < 2) {
    const pool = loadInstrumentPool(storage);
    pool.items = pool.items.map(item => ({
      ...item,
      code: normalizeSecurityCode(item.code),
      market: migrateLegacyMarket(item.market, item.code)
    }));
    saveInstrumentPool(pool, storage);
  }
  if (current < 3) {
    const pool = loadInstrumentPool(storage);
    const instruments = new Map(pool.items.map(item => [String(item.id || ''), item]));
    const rows = readArray(storage, STORAGE_KEYS.lookFirst).map(row => {
      const instrument = instruments.get(String(row?.id || ''));
      const eligible = ['SH','SZ'].includes(String(instrument?.market || '').toUpperCase()) && /^\d{6}$/.test(String(instrument?.code || ''));
      const mode = ['auto','manual'].includes(row?.pm) ? row.pm : (eligible ? 'auto' : 'manual');
      return { ...row, pm:mode, pd:mode === 'auto' && /^\d{4}-\d{2}-\d{2}$/.test(String(row?.pd || '')) ? row.pd : '' };
    });
    storage.setItem(STORAGE_KEYS.lookFirst, JSON.stringify(rows));
  }
  if (current < 4) reconcileLegacyTrackerInputs(storage,loadInstrumentPool(storage));
  if (current < 5 && storage.getItem(STORAGE_KEYS.trackerState)!==null) {
    let state={};
    try { state=JSON.parse(storage.getItem(STORAGE_KEYS.trackerState)) || {}; } catch { state={}; }
    const migrated=migrateTrackerMaProjectionState(state);
    storage.setItem(STORAGE_KEYS.trackerState,JSON.stringify(migrated.state));
  }
  if (current < 6 && storage.getItem(STORAGE_KEYS.trackerState)!==null) {
    let state={};
    try { state=JSON.parse(storage.getItem(STORAGE_KEYS.trackerState)) || {}; } catch { state={}; }
    const migrated=migrateTrackerScenarioVisibilityState(state);
    storage.setItem(STORAGE_KEYS.trackerState,JSON.stringify(migrated.state));
  }
  storage.setItem(STORAGE_KEYS.migrationVersion, String(CURRENT_SCHEMA_VERSION));
  return CURRENT_SCHEMA_VERSION;
}
