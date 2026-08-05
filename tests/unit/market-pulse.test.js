import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadMarketPulse,loadMarketPulseMembers,PULSE_MEMBER_FILTERS } from '../../src/core/market-pulse-repository.js';
import { MARKET_PULSE_GUIDE_HTML,MARKET_PULSE_GUIDE_VERSION } from '../../src/pulse/market-pulse-help.js';
import { buildPulseChartModel,compatiblePulseHistory,normalizePulseSnapshot,pulseStateClass } from '../../src/pulse/market-pulse-view-model.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

function snapshot(date,score=65,{algorithm=1,universe=2}={}) {
  const group={score:score};
  return {
    provider:'baostock',trade_date:date,algorithm_version:algorithm,index_universe_version:universe,
    calculation_id:`calc-${date}`,pulse_score:score,pulse_state:score>=60?'Healthy Strength':'Mixed',
    stock_eligible_count:4200,index_eligible_count:220,stock_coverage:0.99,index_coverage:0.98,
    participation:group,trend_breadth:group,expansion:group,leadership:group,
  };
}

test('Market Pulse normalization and 60-session version filtering are deterministic',()=>{
  const latest=snapshot('2026-08-03',70);
  const rows=[latest,snapshot('2026-08-02',60),snapshot('2026-08-01',55,{algorithm:2}),snapshot('2026-07-31',50,{universe:1}),snapshot('2026-08-02',62)];
  const normalized=normalizePulseSnapshot(latest);
  assert.equal(normalized.score,70);
  assert.equal(normalized.calculationId,'calc-2026-08-03');
  assert.deepEqual(normalizePulseSnapshot(normalized),normalized);
  const history=compatiblePulseHistory(rows,latest);
  assert.deepEqual(history.map(item=>[item.tradeDate,item.score]),[['2026-08-02',62],['2026-08-03',70]]);
  assert.equal(pulseStateClass(80),'is-broad');
  assert.equal(pulseStateClass(20),'is-weakening');
});

test('Pulse chart model fixes Y to 0..100 and keeps all ordered points in bounds',()=>{
  const history=[snapshot('2026-08-01',0),snapshot('2026-08-02',50),snapshot('2026-08-03',100)].map(normalizePulseSnapshot);
  const model=buildPulseChartModel(history,{width:600,height:236});
  assert.equal(model.points.length,3);
  assert.ok(model.points[0].x<model.points[1].x && model.points[1].x<model.points[2].x);
  assert.equal(model.points[0].y,236-28);
  assert.equal(model.points[2].y,18);
  assert.deepEqual(model.thresholds.map(({value,label,shortLabel,colorToken})=>({value,label,shortLabel,colorToken})),[
    {value:20,label:'Risk Gate',shortLabel:'R20',colorToken:'--brand-red'},
    {value:40,label:'',shortLabel:'40',colorToken:'--color-border-subtle'},
    {value:60,label:'Strength Gate',shortLabel:'S60',colorToken:'--brand-blue'},
    {value:80,label:'',shortLabel:'80',colorToken:'--color-border-subtle'}
  ]);
});

test('Pulse latest snapshot survives an isolated history read failure',async()=>{
  let snapshotRequest=0;
  const latest=snapshot('2026-08-03',70);
  const client={from(table){
    const requestNumber=table==='market_pulse_snapshot'?++snapshotRequest:0;
    return {
      select(){return this;},eq(){return this;},limit(){return this;},
      order(){return requestNumber===2?Promise.reject(new Error('history unavailable')):Promise.resolve({data:[latest],error:null});},
      maybeSingle(){return Promise.resolve({data:{last_status:'ok'},error:null});},
    };
  }};
  const result=await loadMarketPulse(client);
  assert.equal(result.snapshot.trade_date,'2026-08-03');
  assert.equal(result.snapshots.length,0);
  assert.match(result.historyError.message,/history unavailable/);
});

test('Pulse member repository applies a safe signal, search and exact 50-row page',async()=>{
  const calls={ filters:[],orders:[],range:null,or:null };
  const chain={
    select(){return this;},
    eq(field,value){calls.filters.push(['eq',field,value]);return this;},
    gt(field,value){calls.filters.push(['gt',field,value]);return this;},
    lt(field,value){calls.filters.push(['lt',field,value]);return this;},
    or(value){calls.or=value;return this;},
    order(field,options){calls.orders.push([field,options]);return this;},
    range(from,to){calls.range=[from,to];return Promise.resolve({data:[{code:'600000'}],count:101,error:null});},
  };
  const client={from(table){assert.equal(table,'market_pulse_member_snapshot');return chain;}};
  const result=await loadMarketPulseMembers(client,{
    tradeDate:'2026-08-03',calculationId:'calc',signal:'strongUp',page:1,pageSize:100,search:'bank,(test)',
  });
  assert.equal(result.pageSize,50);
  assert.deepEqual(calls.range,[50,99]);
  assert.ok(calls.filters.some(value=>value[1]==='strong_up'&&value[2]===true));
  assert.ok(calls.filters.some(value=>value[1]==='calculation_id'&&value[2]==='calc'));
  assert.equal(calls.or,'name.ilike.%bank test%,code.ilike.%bank test%');
  assert.equal(result.count,101);
  await assert.rejects(()=>loadMarketPulseMembers(client,{signal:'unknown'}),/Unsupported/);
  assert.equal(PULSE_MEMBER_FILTERS.broad.memberType,'broad_index');
});

test('Pulse algorithm, product help and manual keep the same v1 contract',()=>{
  const python=fs.readFileSync(path.join(root,'scripts/market_pulse.py'),'utf8');
  const manual=fs.readFileSync(path.join(root,'docs/MARKET_PULSE_GUIDE.md'),'utf8');
  const algorithms=fs.readFileSync(path.join(root,'docs/ALGORITHMS.md'),'utf8');
  for(const source of [python,manual,algorithms,MARKET_PULSE_GUIDE_HTML]){
    assert.match(source,/Participation/i);
    assert.match(source,/Trend Breadth/i);
    assert.match(source,/Expansion/i);
    assert.match(source,/Leadership/i);
    assert.match(source,/(5%|0\.05)/);
    assert.match(source,/Strong Up/i);
    assert.match(source,/MA60 (?:BO|Breakout)/i);
    assert.match(source,/(CNI 2000|国证2000)/i);
  }
  for(const source of [manual,MARKET_PULSE_GUIDE_HTML]){
    for(const text of ['Official','62','ST','25%','Theme Group','Broad Strength','Healthy Strength','Mixed','Weakening','Risk-Off','Strength Gate','Risk Gate','95%','Composite Signal']){
      assert.ok(source.toLowerCase().includes(text.toLowerCase()),`Pulse guide contract missing ${text}`);
    }
    assert.match(source,/not (?:a )?probability/i);
    assert.match(source,/50 (?:rows|row)/i);
  }
  assert.match(python,/ALGORITHM_VERSION\s*=\s*1/);
  assert.match(python,/INDEX_UNIVERSE_VERSION\s*=\s*2/);
  assert.match(python,/MIN_VALID_CLOSES\s*=\s*62/);
  assert.match(MARKET_PULSE_GUIDE_VERSION,/v1.*2026-08/);
});
