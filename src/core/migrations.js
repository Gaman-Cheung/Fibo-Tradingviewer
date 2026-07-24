/** Versioned, idempotent migration registry. */
import { STORAGE_KEYS } from './config.js';
import { readArray } from './storage.js';
import { loadInstrumentPool, migrateTerminalIdentity, saveInstrumentPool } from './instrument-identity.js';

export const CURRENT_SCHEMA_VERSION = 1;

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
  storage.setItem(STORAGE_KEYS.migrationVersion, String(CURRENT_SCHEMA_VERSION));
  return CURRENT_SCHEMA_VERSION;
}

