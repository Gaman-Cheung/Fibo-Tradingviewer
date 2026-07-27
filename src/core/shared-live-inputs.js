/**
 * Canonical Current/VR storage boundary shared by Terminal and Trend Tracker.
 * Allowed dependencies: core config, storage and instrument identity.
 * Forbidden: DOM, Supabase, network and trading calculations.
 * Covered by: shared-live-input unit tests and Terminal/Tracker Playwright tests.
 */
import { STORAGE_KEYS } from './config.js';
import { loadInstrumentPool } from './instrument-identity.js';
import { readArray, readJson, writeJson } from './storage.js';

function normalizeId(value) { return String(value || '').trim(); }
function hasValue(value) { return String(value ?? '').trim() !== ''; }

function defaultLookFirstRow(instrument, current = '') {
  const autoEligible = ['SH','SZ'].includes(String(instrument?.market || '').toUpperCase())
    && /^\d{6}$/.test(String(instrument?.code || ''));
  return {
    id:normalizeId(instrument?.id), n:String(instrument?.ticker || ''),
    h:'', l:'', c:String(current ?? ''), e:'', p:'',
    pm:autoEligible ? 'auto' : 'manual', pd:'', b:'current'
  };
}

function defaultThenLeapRow(instrument, vr = '') {
  return {
    id:normalizeId(instrument?.id), n:String(instrument?.ticker || ''),
    t:'sideways', r:'', m:'neutral', s:'', g:'', g1:'', v:String(vr ?? '')
  };
}

function findExactRow(rows, instrumentId) {
  const id = normalizeId(instrumentId);
  return rows.find(row => normalizeId(row?.id) === id) || null;
}

export function readSharedLiveInputs(storage = globalThis.localStorage, instrumentId = '') {
  const id = normalizeId(instrumentId);
  if (!id) return { current:'', vr:'' };
  const lookFirst = findExactRow(readArray(storage, STORAGE_KEYS.lookFirst), id);
  const thenLeap = findExactRow(readArray(storage, STORAGE_KEYS.thenLeap), id);
  return {
    current:String(lookFirst?.c ?? ''),
    vr:String(thenLeap?.v ?? '')
  };
}

export function updateSharedLiveInput(storage = globalThis.localStorage, { instrumentId, field, value, instrument } = {}) {
  const id = normalizeId(instrumentId);
  if (!id || !['current','vr'].includes(field)) return { updated:false, current:'', vr:'' };
  const pool = loadInstrumentPool(storage);
  const poolInstrument = pool.items.find(item => normalizeId(item?.id) === id) || null;
  const source = poolInstrument || (normalizeId(instrument?.id) === id ? instrument : null);
  if (!source) return { updated:false, ...readSharedLiveInputs(storage,id) };

  const key = field === 'current' ? STORAGE_KEYS.lookFirst : STORAGE_KEYS.thenLeap;
  const property = field === 'current' ? 'c' : 'v';
  const rows = readArray(storage,key);
  let row = findExactRow(rows,id);
  if (!row) {
    row = field === 'current' ? defaultLookFirstRow(source,value) : defaultThenLeapRow(source,value);
    rows.push(row);
  } else {
    row[property] = String(value ?? '');
    if (!hasValue(row.n) && hasValue(source.ticker)) row.n = String(source.ticker);
  }
  writeJson(storage,key,rows);
  return { updated:true, ...readSharedLiveInputs(storage,id) };
}

/**
 * Promotes legacy Tracker-owned current/vr fields into Terminal's canonical rows.
 * Existing non-empty Terminal values always win. Unknown/orphan IDs remain untouched
 * so a later Pool restore can reconcile them without losing data.
 */
export function reconcileLegacyTrackerInputs(storage = globalThis.localStorage, pool = loadInstrumentPool(storage)) {
  const trackerState = readJson(storage,STORAGE_KEYS.trackerState,{});
  const instruments = trackerState?.instruments;
  if (!instruments || typeof instruments !== 'object') return { changed:false, promotedCurrent:0, promotedVr:0 };

  const known = new Map((pool?.items || []).map(item => [normalizeId(item?.id),item]).filter(([id]) => id));
  const lookFirst = readArray(storage,STORAGE_KEYS.lookFirst);
  const thenLeap = readArray(storage,STORAGE_KEYS.thenLeap);
  let lookFirstChanged = false;
  let thenLeapChanged = false;
  let trackerChanged = false;
  let promotedCurrent = 0;
  let promotedVr = 0;

  Object.entries(instruments).forEach(([rawId,legacy]) => {
    const id = normalizeId(rawId);
    const instrument = known.get(id);
    if (!instrument || !legacy || typeof legacy !== 'object') return;

    if (Object.prototype.hasOwnProperty.call(legacy,'current')) {
      let row = findExactRow(lookFirst,id);
      if (!row && hasValue(legacy.current)) {
        row = defaultLookFirstRow(instrument,legacy.current);
        lookFirst.push(row);
        lookFirstChanged = true;
        promotedCurrent += 1;
      } else if (row && !hasValue(row.c) && hasValue(legacy.current)) {
        row.c = String(legacy.current);
        lookFirstChanged = true;
        promotedCurrent += 1;
      }
      delete legacy.current;
      trackerChanged = true;
    }

    if (Object.prototype.hasOwnProperty.call(legacy,'vr')) {
      let row = findExactRow(thenLeap,id);
      if (!row && hasValue(legacy.vr)) {
        row = defaultThenLeapRow(instrument,legacy.vr);
        thenLeap.push(row);
        thenLeapChanged = true;
        promotedVr += 1;
      } else if (row && !hasValue(row.v) && hasValue(legacy.vr)) {
        row.v = String(legacy.vr);
        thenLeapChanged = true;
        promotedVr += 1;
      }
      delete legacy.vr;
      trackerChanged = true;
    }
  });

  if (lookFirstChanged) writeJson(storage,STORAGE_KEYS.lookFirst,lookFirst);
  if (thenLeapChanged) writeJson(storage,STORAGE_KEYS.thenLeap,thenLeap);
  if (trackerChanged) writeJson(storage,STORAGE_KEYS.trackerState,trackerState);
  return { changed:lookFirstChanged || thenLeapChanged || trackerChanged, promotedCurrent, promotedVr };
}
