/**
 * Sole owner of permanent instrument identity and pool reconciliation.
 * Ticker is a mutable label and MUST NEVER be treated as a unique key.
 * Allowed dependencies: storage adapter. Forbidden: DOM, Supabase and calculations.
 */
import { STORAGE_KEYS } from './config.js';
import { readJson, writeJson } from './storage.js';

export function normalizeTicker(value) {
  return String(value || '').trim().toUpperCase();
}

export function createPermanentId(cryptoProvider = globalThis.crypto) {
  if (cryptoProvider?.randomUUID) return cryptoProvider.randomUUID();
  return `inst_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function normalizeInstrumentPool(value) {
  const pool = value && typeof value === 'object' ? value : {};
  return {
    version: 1,
    items: Array.isArray(pool.items) ? pool.items : [],
    tombstones: Array.isArray(pool.tombstones) ? pool.tombstones : []
  };
}

export function loadInstrumentPool(storage = globalThis.localStorage) {
  return normalizeInstrumentPool(readJson(storage, STORAGE_KEYS.instrumentPool, {}));
}

export function saveInstrumentPool(pool, storage = globalThis.localStorage) {
  return writeJson(storage, STORAGE_KEYS.instrumentPool, normalizeInstrumentPool(pool));
}

export function mergeInstrumentPools(...pools) {
  const byId = new Map();
  const tombstones = new Map();
  pools.map(normalizeInstrumentPool).forEach(pool => pool.tombstones.forEach(entry => {
    if (!entry?.id) return;
    const existing = tombstones.get(entry.id);
    if (!existing || Date.parse(entry.deletedAt || 0) >= Date.parse(existing.deletedAt || 0)) tombstones.set(entry.id, entry);
  }));
  pools.map(normalizeInstrumentPool).forEach(pool => pool.items.forEach(item => {
    if (!item?.id) return;
    const existing = byId.get(item.id);
    const existingTime = Date.parse(existing?.updatedAt || existing?.createdAt || 0) || 0;
    const itemTime = Date.parse(item.updatedAt || item.createdAt || 0) || 0;
    if (!existing || itemTime >= existingTime) byId.set(item.id, { ...existing, ...item });
  }));
  tombstones.forEach((entry, id) => {
    const item = byId.get(id);
    if (!item || (Date.parse(entry.deletedAt || 0) || 0) >= (Date.parse(item.updatedAt || item.createdAt || 0) || 0)) byId.delete(id);
  });
  return { version: 1, items: [...byId.values()], tombstones: [...tombstones.values()] };
}

export function migrateTerminalIdentity(v6Data, v7Data, sourcePool, options = {}) {
  const pool = normalizeInstrumentPool(sourcePool);
  const now = options.now || new Date().toISOString();
  const idFactory = options.idFactory || (() => createPermanentId());
  const tombstonedIds = new Set(pool.tombstones.map(entry => entry?.id).filter(Boolean));
  const uniquePoolItems = [];
  const byId = new Map();
  pool.items.forEach(item => {
    if (item?.id && !byId.has(item.id)) { byId.set(item.id, item); uniquePoolItems.push(item); }
  });
  pool.items = uniquePoolItems;
  const newUniqueId = () => {
    let id = idFactory();
    while (byId.has(id) || tombstonedIds.has(id)) id = idFactory();
    return id;
  };
  const createItem = (id, row, order) => {
    const item = { id, ticker:String(row?.n || '').trim() || `Instrument ${order + 1}`, code:'', market:'CN-A', order, status:'active', createdAt:now, updatedAt:now, deletedAt:null };
    pool.items.push(item); byId.set(id, item); return item;
  };
  const score = row => ['h','l','c','e','p'].reduce((total,key) => total + (String(row?.[key] ?? '').trim() ? 1 : 0), 0);
  const groups = new Map();
  v6Data.forEach((row,index) => {
    if (!row?.id) return;
    if (!groups.has(row.id)) groups.set(row.id, []);
    groups.get(row.id).push(index);
  });
  const keepers = new Map();
  groups.forEach((indices,id) => keepers.set(id, [...indices].sort((a,b) => score(v6Data[b]) - score(v6Data[a]) || a - b)[0]));
  const usedV6 = new Set();
  v6Data.forEach((row,index) => {
    const original = row.id;
    const duplicate = original && groups.get(original)?.length > 1;
    let id = original && (!duplicate || keepers.get(original) === index) && !usedV6.has(original) ? original : '';
    if (!id && !original) {
      const ticker = normalizeTicker(row.n);
      const candidates = pool.items.filter(item => !tombstonedIds.has(item.id) && !usedV6.has(item.id) && normalizeTicker(item.ticker) === ticker);
      if (ticker && candidates.length === 1) id = candidates[0].id;
    }
    if (!id) id = newUniqueId();
    row.id = id; usedV6.add(id);
    const item = byId.get(id) || createItem(id, row, index);
    if (String(row.n || '').trim()) item.ticker = String(row.n).trim();
    Object.assign(item, { status:'active', deletedAt:null, order:index, updatedAt:now });
  });
  pool.tombstones = pool.tombstones.filter(entry => !usedV6.has(entry.id));
  const byTicker = new Map();
  v6Data.forEach(row => {
    const key = normalizeTicker(row.n);
    if (!byTicker.has(key)) byTicker.set(key, []);
    byTicker.get(key).push(row.id);
  });
  const usedV7 = new Set();
  v7Data.forEach((row,index) => {
    let id = row.id && usedV6.has(row.id) && !usedV7.has(row.id) ? row.id : '';
    const ticker = normalizeTicker(row.n);
    const candidates = (byTicker.get(ticker) || []).filter(candidate => !usedV7.has(candidate));
    if (!id && v6Data[index] && !usedV7.has(v6Data[index].id) && normalizeTicker(v6Data[index].n) === ticker) id = v6Data[index].id;
    if (!id && ticker && candidates.length === 1) id = candidates[0];
    if (!id) { id = newUniqueId(); createItem(id, row, pool.items.length); }
    row.id = id; usedV7.add(id);
  });
  pool.items.forEach((item,index) => {
    if (!Number.isFinite(Number(item.order))) item.order = index;
    if (!item.status) item.status = 'active';
  });
  return { v6Data, v7Data, pool };
}

