import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateTerminalIdentity, mergeInstrumentPools } from '../../src/core/instrument-identity.js';

test('same Ticker with distinct IDs stays independent', () => {
  const v6 = [
    { id:'id-a', n:'同名标的', h:'10', l:'5', c:'8' },
    { id:'id-b', n:'同名标的', h:'', l:'', c:'' }
  ];
  const pool = { version:1, items:[
    { id:'id-a', ticker:'同名标的', order:0, status:'active' },
    { id:'id-b', ticker:'同名标的', order:1, status:'active' }
  ], tombstones:[] };
  const result = migrateTerminalIdentity(v6, [], pool, { idFactory:() => 'unused', now:'2026-07-24T00:00:00.000Z' });
  assert.deepEqual(result.v6Data.map(row => row.id), ['id-a','id-b']);
  assert.equal(result.pool.items.length, 2);
});

test('duplicate ID is retained by richest row and repaired for every other row', () => {
  let sequence = 0;
  const v6 = [
    { id:'same-id', n:'弘信电子', h:'58.55', l:'27.59', c:'33.22' },
    { id:'same-id', n:'弘信电子', h:'', l:'', c:'' }
  ];
  const v7 = [{ id:'same-id', n:'弘信电子' }, { id:'same-id', n:'弘信电子' }];
  const pool = { version:1, items:[{ id:'same-id', ticker:'弘信电子', order:0, status:'active' }], tombstones:[] };
  const result = migrateTerminalIdentity(v6, v7, pool, { idFactory:() => `fresh-${++sequence}`, now:'2026-07-24T00:00:00.000Z' });
  assert.deepEqual(result.v6Data.map(row => row.id), ['same-id','fresh-1']);
  assert.deepEqual(result.v7Data.map(row => row.id), ['same-id','fresh-1']);
  assert.equal(result.v6Data.filter(row => row.id !== 'fresh-1')[0].c, '33.22');
});

test('pool merge uses ID and tombstone timestamps, never Ticker', () => {
  const result = mergeInstrumentPools(
    { items:[{ id:'a', ticker:'X', updatedAt:'2026-01-01' }, { id:'b', ticker:'X', updatedAt:'2026-01-01' }], tombstones:[] },
    { items:[], tombstones:[{ id:'b', deletedAt:'2026-02-01' }] }
  );
  assert.deepEqual(result.items.map(item => item.id), ['a']);
});

