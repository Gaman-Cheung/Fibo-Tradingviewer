import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_SCHEMA_VERSION, runMigrations } from '../../src/core/migrations.js';
import { readSharedLiveInputs, reconcileLegacyTrackerInputs, updateSharedLiveInput } from '../../src/core/shared-live-inputs.js';

class MemoryStorage {
  constructor(values={}) { this.values=new Map(Object.entries(values)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key,value) { this.values.set(key,String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const pool = { version:1, items:[
  { id:'same-a', ticker:'SAME', code:'300001', market:'SZ', order:0, status:'active' },
  { id:'same-b', ticker:'SAME', code:'300002', market:'SZ', order:1, status:'active' }
], tombstones:[] };

test('shared Current and VR read and update only the exact permanent ID', () => {
  const storage=new MemoryStorage({
    tv_instrument_pool_v1:JSON.stringify(pool),
    tv_lookfirst_data_v3:JSON.stringify([{id:'same-a',n:'SAME',c:'10'}]),
    tv_thenleap_data_v3:JSON.stringify([{id:'same-a',n:'SAME',v:'1.1'}])
  });
  updateSharedLiveInput(storage,{instrumentId:'same-b',field:'current',value:'20'});
  updateSharedLiveInput(storage,{instrumentId:'same-b',field:'vr',value:'2.2'});
  assert.deepEqual(readSharedLiveInputs(storage,'same-a'),{current:'10',vr:'1.1'});
  assert.deepEqual(readSharedLiveInputs(storage,'same-b'),{current:'20',vr:'2.2'});
  assert.equal(JSON.parse(storage.getItem('tv_lookfirst_data_v3')).find(row=>row.id==='same-b').pm,'auto');
});

test('legacy Tracker values fill blanks while non-empty Terminal values win', () => {
  const storage=new MemoryStorage({
    tv_instrument_pool_v1:JSON.stringify(pool),
    tv_lookfirst_data_v3:JSON.stringify([{id:'same-a',n:'SAME',c:'11'},{id:'same-b',n:'SAME',c:''}]),
    tv_thenleap_data_v3:JSON.stringify([{id:'same-a',n:'SAME',v:'1.2'},{id:'same-b',n:'SAME',v:''}]),
    tv_trend_tracker_state_v1:JSON.stringify({version:1,instruments:{
      'same-a':{current:'99',vr:'9.9',scenarioMode:'flat'},
      'same-b':{current:'22',vr:'2.2',scenarioMode:'trend'},
      orphan:{current:'33',vr:'3.3'}
    }})
  });
  const first=reconcileLegacyTrackerInputs(storage,pool);
  const snapshot=storage.getItem('tv_lookfirst_data_v3')+storage.getItem('tv_thenleap_data_v3')+storage.getItem('tv_trend_tracker_state_v1');
  const second=reconcileLegacyTrackerInputs(storage,pool);
  assert.deepEqual(readSharedLiveInputs(storage,'same-a'),{current:'11',vr:'1.2'});
  assert.deepEqual(readSharedLiveInputs(storage,'same-b'),{current:'22',vr:'2.2'});
  const tracker=JSON.parse(storage.getItem('tv_trend_tracker_state_v1'));
  assert.equal('current' in tracker.instruments['same-a'],false);
  assert.equal('vr' in tracker.instruments['same-b'],false);
  assert.deepEqual(tracker.instruments.orphan,{current:'33',vr:'3.3'});
  assert.equal(first.changed,true);
  assert.equal(second.changed,false);
  assert.equal(storage.getItem('tv_lookfirst_data_v3')+storage.getItem('tv_thenleap_data_v3')+storage.getItem('tv_trend_tracker_state_v1'),snapshot);
});

test('schema migration promotes legacy live inputs once and remains idempotent', () => {
  const storage=new MemoryStorage({
    tv_instrument_pool_v1:JSON.stringify(pool),
    tv_lookfirst_data_v3:'[]', tv_thenleap_data_v3:'[]',
    tv_trend_tracker_state_v1:JSON.stringify({version:1,instruments:{'same-a':{current:'18',vr:'1.8'}}})
  });
  runMigrations(storage);
  const snapshot=storage.getItem('tv_lookfirst_data_v3')+storage.getItem('tv_thenleap_data_v3')+storage.getItem('tv_trend_tracker_state_v1');
  runMigrations(storage);
  assert.equal(Number(storage.getItem('fibo_schema_migration_version')),CURRENT_SCHEMA_VERSION);
  assert.deepEqual(readSharedLiveInputs(storage,'same-a'),{current:'18',vr:'1.8'});
  assert.equal(storage.getItem('tv_lookfirst_data_v3')+storage.getItem('tv_thenleap_data_v3')+storage.getItem('tv_trend_tracker_state_v1'),snapshot);
});
