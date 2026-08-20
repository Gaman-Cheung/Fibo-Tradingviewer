/**
 * Shared full-workspace cloud synchronization boundary.
 * Allowed: core storage/identity/cloud repositories. Forbidden: DOM and trading calculations.
 */
import { STORAGE_KEYS } from './config.js';
import { buildCloudPayload, unpackCloudPayload } from './cloud-payload.js';
import { getAuthenticatedUser, loadCloudRow, upsertCloudRow } from './cloud-repository.js';
import { loadInstrumentPool, mergeInstrumentPools } from './instrument-identity.js';
import { loadTrackerState, saveTrackerState, syncMarketBindings } from './market-repository.js';
import { reconcileLegacyTrackerInputs } from './shared-live-inputs.js';
import { readArray, readJson } from './storage.js';
import { migrateTrackerMaProjectionState, migrateTrackerScenarioVisibilityState } from './tracker-state.js';

const NOT_FOUND_CODE = 'PGRST116';
const WORKSPACE_KEYS = Object.freeze([
  STORAGE_KEYS.lookFirst,
  STORAGE_KEYS.thenLeap,
  STORAGE_KEYS.waveState,
  STORAGE_KEYS.instrumentPool,
  STORAGE_KEYS.marquee,
  STORAGE_KEYS.tips,
  STORAGE_KEYS.trackerState
]);

const SCOPE_LABELS = Object.freeze({
  auth:'authentication',
  existing_workspace:'existing wp_data',
  fibo_data:'fibo_data',
  trend_tracker_state:'trend_tracker_state',
  market_instrument_bindings:'market_instrument_bindings',
  local_workspace:'local workspace'
});

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNotFound(error) {
  return error?.code === NOT_FOUND_CODE;
}

function failure(scope,error) {
  const normalized = error instanceof Error ? error : new Error(error?.message || String(error || 'Unknown error'));
  if (error?.code) normalized.code = error.code;
  return { scope,error:normalized };
}

function operationFailure(scope,result) {
  if (result.status === 'rejected') return failure(scope,result.reason);
  if (result.value?.error) return failure(scope,result.value.error);
  return null;
}

function normalizePulledTrackerState(value) {
  const source = isObject(value) ? value : {};
  const projection = migrateTrackerMaProjectionState(source).state;
  const visibility = migrateTrackerScenarioVisibilityState(projection).state;
  const instruments = Object.fromEntries(Object.entries(visibility.instruments || {}).map(([id,value]) => {
    const instrument = isObject(value) ? value : {};
    const { scenarioMode:_legacyScenarioMode, ...current } = instrument;
    return [id,current];
  }));
  return { ...visibility,version:1,instruments };
}

function captureStorage(storage) {
  return new Map(WORKSPACE_KEYS.map(key => [key,storage.getItem(key)]));
}

function restoreStorage(storage,backup) {
  for (const [key,value] of backup) {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key,value);
  }
}

function writeJson(storage,key,value) {
  storage.setItem(key,JSON.stringify(value));
}

function cloudPoolSources(data) {
  const rows = Array.isArray(data?.v6_data) ? data.v6_data : [];
  const carrier = rows.find(item => isObject(item?.__instrument_pool_v1));
  return [carrier?.__instrument_pool_v1,data?.wp_data?.instrumentPool].filter(isObject);
}

function validateCloudWorkspaceData(data) {
  if (!isObject(data)) return new Error('Cloud fibo_data is not an object');
  for (const key of ['v6_data','v7_data']) {
    if (Object.prototype.hasOwnProperty.call(data,key) && !Array.isArray(data[key])) return new Error(`Cloud ${key} is not an array`);
  }
  if (Object.prototype.hasOwnProperty.call(data,'wp_data') && data.wp_data !== null && !isObject(data.wp_data)) return new Error('Cloud wp_data is not an object');
  if (Object.prototype.hasOwnProperty.call(data.wp_data || {},'instrumentPool') && data.wp_data.instrumentPool !== null && !isObject(data.wp_data.instrumentPool)) return new Error('Cloud instrumentPool is not an object');
  if (isObject(data.wp_data?.instrumentPool) && Array.isArray(data.wp_data.instrumentPool.items) === false && Object.prototype.hasOwnProperty.call(data.wp_data.instrumentPool,'items')) return new Error('Cloud instrumentPool.items is not an array');
  return null;
}

export function readWorkspaceSnapshot(storage = globalThis.localStorage) {
  return {
    lookFirst:readArray(storage,STORAGE_KEYS.lookFirst),
    thenLeap:readArray(storage,STORAGE_KEYS.thenLeap),
    waveState:readJson(storage,STORAGE_KEYS.waveState,null),
    instrumentPool:loadInstrumentPool(storage),
    uiNotes:{
      marquee:storage.getItem(STORAGE_KEYS.marquee) || '',
      tips:storage.getItem(STORAGE_KEYS.tips) || ''
    },
    trackerState:normalizePulledTrackerState(readJson(storage,STORAGE_KEYS.trackerState,{}))
  };
}

export function formatWorkspaceSyncFailure(result,prefix = 'Cloud Sync Failed') {
  const details = (result?.failures || []).map(item => {
    const label = SCOPE_LABELS[item.scope] || item.scope || 'workspace';
    return `${label}: ${item.error?.message || 'Unknown error'}`;
  });
  return details.length ? `${prefix} — ${details.join('; ')}` : prefix;
}

export async function pushWorkspaceToCloud({ client,storage = globalThis.localStorage } = {}) {
  let auth;
  try {
    auth = await getAuthenticatedUser(client);
  } catch (error) {
    return { ok:false,failures:[failure('auth',error)] };
  }
  if (auth?.error || !auth?.user) {
    return { ok:false,failures:[failure('auth',auth?.error || new Error('No authenticated user'))] };
  }

  let existing;
  try {
    existing = await loadCloudRow(client,auth.user.id,'wp_data');
  } catch (error) {
    return { ok:false,failures:[failure('existing_workspace',error)] };
  }
  if (existing?.error && !isNotFound(existing.error)) {
    return { ok:false,failures:[failure('existing_workspace',existing.error)] };
  }
  if (existing?.data?.wp_data !== undefined && existing.data.wp_data !== null && !isObject(existing.data.wp_data)) {
    return { ok:false,failures:[failure('existing_workspace',new Error('Existing wp_data is not an object'))] };
  }

  const snapshot = readWorkspaceSnapshot(storage);
  const payload = buildCloudPayload({
    userId:auth.user.id,
    lookFirst:snapshot.lookFirst,
    thenLeap:snapshot.thenLeap,
    waveState:snapshot.waveState,
    instrumentPool:snapshot.instrumentPool,
    uiNotes:snapshot.uiNotes,
    existingWaveData:existing?.data?.wp_data || {}
  });
  const results = await Promise.allSettled([
    upsertCloudRow(client,payload),
    saveTrackerState(client,auth.user.id,snapshot.trackerState),
    syncMarketBindings(client,auth.user.id,snapshot.instrumentPool)
  ]);
  const scopes = ['fibo_data','trend_tracker_state','market_instrument_bindings'];
  const failures = results.map((result,index) => operationFailure(scopes[index],result)).filter(Boolean);
  return { ok:failures.length === 0,failures,userId:auth.user.id,snapshot };
}

export async function pullWorkspaceFromCloud({ client,storage = globalThis.localStorage } = {}) {
  let auth;
  try {
    auth = await getAuthenticatedUser(client);
  } catch (error) {
    return { ok:false,failures:[failure('auth',error)] };
  }
  if (auth?.error || !auth?.user) {
    return { ok:false,failures:[failure('auth',auth?.error || new Error('No authenticated user'))] };
  }

  const requests = await Promise.allSettled([
    loadCloudRow(client,auth.user.id,'*'),
    loadTrackerState(client,auth.user.id)
  ]);
  const requestScopes = ['fibo_data','trend_tracker_state'];
  const rejected = requests.map((result,index) => result.status === 'rejected' ? failure(requestScopes[index],result.reason) : null).filter(Boolean);
  if (rejected.length) return { ok:false,failures:rejected };

  const cloud = requests[0].value;
  const tracker = requests[1].value;
  const failures = [];
  if (cloud?.error && !isNotFound(cloud.error)) failures.push(failure('fibo_data',cloud.error));
  if (tracker?.error && !isNotFound(tracker.error)) failures.push(failure('trend_tracker_state',tracker.error));
  if (failures.length) return { ok:false,failures };
  if (!cloud?.data || isNotFound(cloud?.error)) return { ok:false,empty:true,failures:[] };

  const shapeError = validateCloudWorkspaceData(cloud.data);
  if (shapeError) return { ok:false,failures:[failure('fibo_data',shapeError)] };
  let unpacked;
  try {
    unpacked = unpackCloudPayload(cloud.data);
  } catch (error) {
    return { ok:false,failures:[failure('fibo_data',error)] };
  }
  const localPool = loadInstrumentPool(storage);
  const poolSources = cloudPoolSources(cloud.data);
  const mergedPool = poolSources.length ? mergeInstrumentPools(localPool,...poolSources) : localPool;
  const trackerMissing = !tracker?.data || isNotFound(tracker?.error);
  if (!trackerMissing && !isObject(tracker.data.state)) {
    return { ok:false,failures:[failure('trend_tracker_state',new Error('Cloud Tracker state is not a valid object'))] };
  }

  const backup = captureStorage(storage);
  try {
    if (Array.isArray(cloud.data.v6_data)) writeJson(storage,STORAGE_KEYS.lookFirst,unpacked.lookFirst);
    if (Array.isArray(cloud.data.v7_data)) writeJson(storage,STORAGE_KEYS.thenLeap,unpacked.thenLeap);
    if (poolSources.length) writeJson(storage,STORAGE_KEYS.instrumentPool,mergedPool);

    if (isObject(unpacked.uiNotes)) {
      if (Object.prototype.hasOwnProperty.call(unpacked.uiNotes,'marquee')) storage.setItem(STORAGE_KEYS.marquee,String(unpacked.uiNotes.marquee || ''));
      if (Object.prototype.hasOwnProperty.call(unpacked.uiNotes,'tips')) storage.setItem(STORAGE_KEYS.tips,String(unpacked.uiNotes.tips || ''));
    }

    if (isObject(cloud.data.wp_data) && Array.isArray(cloud.data.wp_data.tabs)) {
      writeJson(storage,STORAGE_KEYS.waveState,{
        ...cloud.data.wp_data,
        instrumentPool:mergedPool,
        uiNotes:isObject(unpacked.uiNotes) ? unpacked.uiNotes : cloud.data.wp_data.uiNotes
      });
    }
    if (!trackerMissing) writeJson(storage,STORAGE_KEYS.trackerState,normalizePulledTrackerState(tracker.data.state));
    reconcileLegacyTrackerInputs(storage,mergedPool);
  } catch (error) {
    try { restoreStorage(storage,backup); } catch {}
    return { ok:false,failures:[failure('local_workspace',error)] };
  }

  return {
    ok:true,
    empty:false,
    trackerMissing,
    userId:auth.user.id,
    snapshot:readWorkspaceSnapshot(storage),
    failures:[]
  };
}
