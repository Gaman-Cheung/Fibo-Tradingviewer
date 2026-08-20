import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCloudPayload } from '../../src/core/cloud-payload.js';
import { STORAGE_KEYS } from '../../src/core/config.js';
import { pullWorkspaceFromCloud, pushWorkspaceToCloud } from '../../src/core/workspace-cloud-sync.js';

class MemoryStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); this.failKey = null; this.failCount = 0; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key,value) {
    if (this.failKey === key && this.failCount > 0) { this.failCount -= 1; throw new Error(`write failed: ${key}`); }
    this.values.set(key,String(value));
  }
  removeItem(key) { this.values.delete(key); }
}

function json(value) { return JSON.stringify(value); }

function makeClient({ fibo = null, tracker = null, failReads = [], failWrites = [] } = {}) {
  const state = { fibo,tracker,bindings:[] };
  const readFailures = new Set(failReads);
  const writeFailures = new Set(failWrites);
  const resultError = table => new Error(`${table} unavailable`);
  const client = {
    state,
    auth:{ getUser:async()=>({data:{user:{id:'user-1'}},error:null}) },
    from(table) {
      const query = {
        select(){ return query; },
        eq(){ return query; },
        single(){
          if (readFailures.has(table)) return Promise.resolve({data:null,error:resultError(table)});
          if (table === 'fibo_data') return state.fibo ? Promise.resolve({data:structuredClone(state.fibo),error:null}) : Promise.resolve({data:null,error:{code:'PGRST116',message:'not found'}});
          if (table === 'trend_tracker_state') return state.tracker ? Promise.resolve({data:structuredClone(state.tracker),error:null}) : Promise.resolve({data:null,error:{code:'PGRST116',message:'not found'}});
          return Promise.resolve({data:null,error:{code:'PGRST116',message:'not found'}});
        },
        then(resolve,reject){
          if (readFailures.has(table)) return Promise.resolve({data:null,error:resultError(table)}).then(resolve,reject);
          if (table === 'market_instrument_bindings') return Promise.resolve({data:structuredClone(state.bindings),error:null}).then(resolve,reject);
          return Promise.resolve({data:[],error:null}).then(resolve,reject);
        },
        upsert(payload){
          if (writeFailures.has(table)) return Promise.resolve({data:null,error:resultError(table)});
          if (table === 'fibo_data') state.fibo=structuredClone(payload);
          if (table === 'trend_tracker_state') state.tracker=structuredClone(payload);
          if (table === 'market_instrument_bindings') {
            const byId=new Map(state.bindings.map(row=>[row.instrument_id,row]));
            for (const row of payload) byId.set(row.instrument_id,structuredClone(row));
            state.bindings=[...byId.values()];
          }
          return Promise.resolve({data:payload,error:null});
        }
      };
      return query;
    }
  };
  return client;
}

function initialStorage() {
  return new MemoryStorage({
    [STORAGE_KEYS.lookFirst]:json([{id:'local-a',n:'SAME',c:'11',h:'20',l:'5'}]),
    [STORAGE_KEYS.thenLeap]:json([{id:'local-a',n:'SAME',v:'1.1'}]),
    [STORAGE_KEYS.waveState]:json({activeTabId:'tab-local',tabs:[{id:'tab-local',instrumentId:'local-a'}]}),
    [STORAGE_KEYS.instrumentPool]:json({version:1,items:[{id:'local-a',ticker:'SAME',code:'000001',market:'SH',updatedAt:'2026-08-01'}],tombstones:[]}),
    [STORAGE_KEYS.marquee]:'local marquee',
    [STORAGE_KEYS.tips]:'local tips',
    [STORAGE_KEYS.trackerState]:json({version:1,activeInstrumentId:'local-a',instruments:{'local-a':{horizon:20,maProjectionScenario:'trend',scenarioVisibility:{flat:true,trend:true,custom:true}}}})
  });
}

test('Push sends the complete workspace, bindings and tracker state, and is idempotent', async () => {
  const storage=initialStorage();
  const client=makeClient();
  const first=await pushWorkspaceToCloud({client,storage});
  assert.equal(first.ok,true);
  assert.deepEqual(client.state.fibo.v6_data.filter(row=>row.id).map(row=>row.id),['local-a']);
  assert.equal(client.state.fibo.v7_data[0].v,'1.1');
  assert.equal(client.state.fibo.wp_data.tabs[0].instrumentId,'local-a');
  assert.equal(client.state.tracker.state.instruments['local-a'].maProjectionScenario,'trend');
  assert.deepEqual(client.state.bindings.map(row=>row.instrument_id),['local-a']);
  const second=await pushWorkspaceToCloud({client,storage});
  assert.equal(second.ok,true);
  assert.equal(client.state.bindings.length,1);
});

test('Push reports the failed workspace component instead of claiming success', async () => {
  const result=await pushWorkspaceToCloud({client:makeClient({failWrites:['trend_tracker_state']}),storage:initialStorage()});
  assert.equal(result.ok,false);
  assert.deepEqual(result.failures.map(item=>item.scope),['trend_tracker_state']);
});

test('Pull restores every workspace section and reconciles legacy Current/VR by permanent ID', async () => {
  const cloudPayload=buildCloudPayload({
    userId:'user-1',
    lookFirst:[{id:'cloud-a',n:'SAME',c:'',h:'30',l:'10'}],
    thenLeap:[{id:'cloud-a',n:'SAME',v:''}],
    waveState:{activeTabId:'tab-cloud',tabs:[{id:'tab-cloud',instrumentId:'cloud-a'}]},
    instrumentPool:{version:1,items:[{id:'cloud-a',ticker:'SAME',code:'000002',market:'SZ',updatedAt:'2026-08-02'}],tombstones:[]},
    uiNotes:{marquee:'cloud marquee',tips:'cloud tips'}
  });
  const client=makeClient({fibo:cloudPayload,tracker:{user_id:'user-1',state:{version:1,instruments:{'cloud-a':{current:'88',vr:'2.2',scenarioMode:'flat'}}}}});
  const storage=initialStorage();
  const result=await pullWorkspaceFromCloud({client,storage});
  assert.equal(result.ok,true);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEYS.lookFirst))[0].c,'88');
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEYS.thenLeap))[0].v,'2.2');
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEYS.waveState)).tabs[0].instrumentId,'cloud-a');
  assert.equal(storage.getItem(STORAGE_KEYS.marquee),'cloud marquee');
  const pool=JSON.parse(storage.getItem(STORAGE_KEYS.instrumentPool));
  assert.deepEqual(pool.items.map(item=>item.id).sort(),['cloud-a','local-a']);
  const tracker=JSON.parse(storage.getItem(STORAGE_KEYS.trackerState));
  assert.equal('current' in tracker.instruments['cloud-a'],false);
  assert.equal('vr' in tracker.instruments['cloud-a'],false);
  assert.equal('scenarioMode' in tracker.instruments['cloud-a'],false);
});

test('Missing Tracker row is backward compatible and retains the local Tracker state', async () => {
  const storage=initialStorage();
  const before=storage.getItem(STORAGE_KEYS.trackerState);
  const cloud=buildCloudPayload({userId:'user-1',lookFirst:[],thenLeap:[],waveState:{tabs:[]},instrumentPool:{items:[],tombstones:[]},uiNotes:{marquee:'',tips:''}});
  const result=await pullWorkspaceFromCloud({client:makeClient({fibo:cloud}),storage});
  assert.equal(result.ok,true);
  assert.equal(result.trackerMissing,true);
  assert.equal(storage.getItem(STORAGE_KEYS.trackerState),before);
});

test('Pull network failure does not apply any local section', async () => {
  const storage=initialStorage();
  const before=[...storage.values.entries()];
  const cloud=buildCloudPayload({userId:'user-1',lookFirst:[],thenLeap:[],waveState:{tabs:[]},instrumentPool:{items:[],tombstones:[]},uiNotes:{marquee:'cloud',tips:'cloud'}});
  const result=await pullWorkspaceFromCloud({client:makeClient({fibo:cloud,tracker:{state:{}},failReads:['trend_tracker_state']}),storage});
  assert.equal(result.ok,false);
  assert.deepEqual([...storage.values.entries()],before);
});

test('Pull rolls back already-written keys when local storage rejects a write', async () => {
  const storage=initialStorage();
  const before=[...storage.values.entries()];
  const cloud=buildCloudPayload({userId:'user-1',lookFirst:[{id:'cloud-a',n:'CLOUD',c:'1'}],thenLeap:[],waveState:{tabs:[]},instrumentPool:{items:[],tombstones:[]},uiNotes:{marquee:'cloud',tips:'cloud'}});
  const client=makeClient({fibo:cloud,tracker:{state:{}}});
  storage.failKey=STORAGE_KEYS.thenLeap; storage.failCount=1;
  const result=await pullWorkspaceFromCloud({client,storage});
  assert.equal(result.ok,false);
  assert.deepEqual([...storage.values.entries()],before);
});

test('No cloud workspace leaves local data untouched', async () => {
  const storage=initialStorage();
  const before=[...storage.values.entries()];
  const result=await pullWorkspaceFromCloud({client:makeClient(),storage});
  assert.equal(result.empty,true);
  assert.deepEqual([...storage.values.entries()],before);
});

test('Malformed cloud workspace is rejected before any local write', async () => {
  const storage=initialStorage();
  const before=[...storage.values.entries()];
  const result=await pullWorkspaceFromCloud({client:makeClient({fibo:{v6_data:'not-an-array'},tracker:{state:{}}}),storage});
  assert.equal(result.ok,false);
  assert.equal(result.failures[0].scope,'fibo_data');
  assert.deepEqual([...storage.values.entries()],before);
});
