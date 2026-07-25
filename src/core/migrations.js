/** Versioned, idempotent migration registry. */
import { STORAGE_KEYS } from './config.js';
import { readArray } from './storage.js';
import { loadInstrumentPool, migrateTerminalIdentity, saveInstrumentPool } from './instrument-identity.js';
import { migrateLegacyMarket, normalizeSecurityCode } from './market-code.js';

export const CURRENT_SCHEMA_VERSION = 2;

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
  storage.setItem(STORAGE_KEYS.migrationVersion, String(CURRENT_SCHEMA_VERSION));
  return CURRENT_SCHEMA_VERSION;
}
