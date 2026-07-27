import test from 'node:test';
import assert from 'node:assert/strict';
import { inferMainlandMarket, migrateLegacyMarket, toBaoStockCode } from '../../src/core/market-code.js';
import { buildFrontAdjustedSeries } from '../../src/core/front-adjusted-series.js';
import { runMigrations, CURRENT_SCHEMA_VERSION } from '../../src/core/migrations.js';
import { analyzeTrend, appendProvisionalCurrent, maSnapshot, macd, projectScenario, turnState } from '../../src/tracker/trend-engine.js';
import { buildTrackerChartModel, buildTrackerChartXModel, buildTrackerChartYModel, trackerChartEdge, trackerForecastRatio, TRACKER_CHART_WINDOW, TRACKER_FORECAST_MIN_RATIO, TRACKER_FORECAST_MAX_RATIO } from '../../src/tracker/chart-model.js';
import { buildScenarioComparison } from '../../src/tracker/scenario-comparison.js';
import { formatTurnLabel } from '../../src/tracker/status-presenter.js';
import { loadLatestOfficialClose } from '../../src/core/market-repository.js';

class MemoryStorage {
  constructor(entries={}) { this.values=new Map(Object.entries(entries)); }
  getItem(key){return this.values.has(key)?this.values.get(key):null;}
  setItem(key,value){this.values.set(key,String(value));}
}

test('market code contract is explicit and never guesses an index', () => {
  assert.equal(inferMainlandMarket('600000'),'SH');
  assert.equal(inferMainlandMarket('300657'),'SZ');
  assert.equal(migrateLegacyMarket('INDEX','000001'),'INDEX');
  assert.deepEqual(toBaoStockCode('SZ','300657'),{ok:true,value:'sz.300657',market:'SZ',code:'300657'});
  assert.equal(toBaoStockCode('OTHER','000001').ok,false);
});

test('market migration is idempotent and preserves permanent IDs', () => {
  const storage=new MemoryStorage({
    fibo_schema_migration_version:'1',
    tv_instrument_pool_v1:JSON.stringify({version:1,items:[{id:'a',ticker:'X',code:'600000',market:'CN-A'},{id:'b',ticker:'X',code:'300657',market:'CN-A'},{id:'c',ticker:'Index',code:'000001',market:'INDEX'}],tombstones:[]})
  });
  runMigrations(storage); runMigrations(storage);
  const pool=JSON.parse(storage.getItem('tv_instrument_pool_v1'));
  assert.equal(Number(storage.getItem('fibo_schema_migration_version')),CURRENT_SCHEMA_VERSION);
  assert.deepEqual(pool.items.map(item=>[item.id,item.market]),[['a','SH'],['b','SZ'],['c','INDEX']]);
});

test('Prev Close migration defaults eligible instruments to Auto and preserves cached values', () => {
  const storage=new MemoryStorage({
    fibo_schema_migration_version:'2',
    tv_instrument_pool_v1:JSON.stringify({version:1,items:[
      {id:'a',ticker:'A',code:'600000',market:'SH'},
      {id:'b',ticker:'B',code:'',market:'OTHER'},
      {id:'c',ticker:'C',code:'000001',market:'SZ'}
    ],tombstones:[]}),
    tv_lookfirst_data_v3:JSON.stringify([
      {id:'a',n:'A',p:'10.25'},
      {id:'b',n:'B',p:'20'},
      {id:'c',n:'C',p:'30',pm:'manual',pd:'2026-01-01'}
    ])
  });
  runMigrations(storage); runMigrations(storage);
  const rows=JSON.parse(storage.getItem('tv_lookfirst_data_v3'));
  assert.deepEqual(rows.map(row=>[row.id,row.p,row.pm,row.pd]),[
    ['a','10.25','auto',''],
    ['b','20','manual',''],
    ['c','30','manual','']
  ]);
});

function marketClient(rowsByTable={}, errorsByTable={}, calls=[]) {
  return { from(table) { return {
    select(){return this;}, eq(column,value){calls.push([table,column,value]);return this;}, limit(){return this;},
    order(){return Promise.resolve({data:rowsByTable[table] || [],error:errorsByTable[table] || null});}
  }; } };
}

test('latest official close prefers full-market data and falls back to the legacy table', async () => {
  const calls=[];
  const full=await loadLatestOfficialClose(marketClient({market_daily_bar:[{trade_date:'2026-07-24',close:'12.34',trade_status:true}]},{},calls),{market:'SH',code:'600000'});
  assert.equal(full.source,'full-market');
  assert.deepEqual({date:full.data.trade_date,close:full.data.close},{date:'2026-07-24',close:12.34});
  assert.ok(calls.some(call=>call[0]==='market_daily_bar'&&call[1]==='trade_status'&&call[2]===true));

  const fallback=await loadLatestOfficialClose(marketClient({market_daily_close:[{trade_date:'2026-07-23',close:'9.87'}]}),{market:'SZ',code:'000001'});
  assert.equal(fallback.source,'legacy');
  assert.equal(fallback.data.close,9.87);

  const invalid=await loadLatestOfficialClose(marketClient(),{market:'OTHER',code:'000001'});
  assert.equal(invalid.data,null);
  assert.match(invalid.error.message,/supports/i);

  const empty=await loadLatestOfficialClose(marketClient(),{market:'SH',code:'600001'});
  assert.equal(empty.data,null);
  assert.equal(empty.error,null);

  const failed=await loadLatestOfficialClose(marketClient({}, {
    market_daily_bar:{message:'full market offline'},
    market_daily_close:{message:'legacy offline'}
  }),{market:'SH',code:'600002'});
  assert.equal(failed.data,null);
  assert.equal(failed.error.message,'legacy offline');
});

test('MA recurrence, MACD and scenario outputs are deterministic', () => {
  const closes=Array.from({length:300},(_,index)=>100+index*.2+Math.sin(index/7));
  const snapshot=maSnapshot(closes,[60]);
  const expected=(closes.at(-1)-closes.at(-61))/60;
  assert.ok(Math.abs(snapshot[60].delta-expected)<1e-12);
  assert.equal(turnState(closes,20).direction,'up');
  const analysis=analyzeTrend(closes);
  assert.equal(analysis.background,'Long Bull');
  assert.equal(analysis.structure,'Uptrend');
  assert.equal(macd(closes).zeroAxis,'above');
  const scenario=projectScenario(closes,{mode:'custom',horizon:20,target:200});
  assert.equal(scenario.path.length,20);
  assert.ok(Math.abs(scenario.path.at(-1)-200)<1e-9);
  assert.equal(scenario.analyses.at(-1).background,'Long Bull');
  assert.equal(scenario.analyses.at(-1).structure,'Uptrend');
  assert.equal(scenario.analyses.at(-1).event,'趋势延续');
  assert.equal(scenario.probabilityClaim,false);
});

test('Scenario comparison preserves all three formulas and ignores the legacy selected mode', () => {
  const closes=Array.from({length:300},(_,index)=>80+index*.15+Math.sin(index/11));
  const options={horizon:13,target:'142.5',scenarioMode:'flat'};
  const comparison=buildScenarioComparison(closes,options);
  assert.deepEqual(comparison.map(item=>item.key),['flat','trend','custom']);
  for(const item of comparison){
    assert.equal(item.enabled,true);
    assert.deepEqual(item.projection,projectScenario(closes,{mode:item.key,horizon:13,...(item.key==='custom'?{target:142.5}:{})}));
    assert.equal(item.projection.path.length,13);
  }
  assert.ok(Math.abs(comparison.at(-1).projection.path.at(-1)-142.5)<1e-9);
});

test('Scenario comparison keeps Flat and Trend when Custom target is unavailable', () => {
  const closes=Array.from({length:80},(_,index)=>50+index*.1);
  for(const target of ['',0,-1,'invalid']){
    const comparison=buildScenarioComparison(closes,{horizon:20,target});
    assert.equal(comparison[0].projection.path.length,20);
    assert.equal(comparison[1].projection.path.length,20);
    assert.equal(comparison[2].enabled,false);
    assert.equal(comparison[2].projection,null);
  }
  const equalTarget=closes.at(-1);
  const enabled=buildScenarioComparison(closes,{horizon:20,target:equalTarget}).at(-1);
  assert.equal(enabled.enabled,true);
  assert.ok(enabled.projection.path.every(value=>Math.abs(value-equalTarget)<1e-9));
});

test('Current is appended as a provisional value without mutating official closes', () => {
  const official=[10,11,12];
  const preview=appendProvisionalCurrent(official,13);
  assert.deepEqual(official,[10,11,12]);
  assert.deepEqual(preview,[10,11,12,13]);
});

test('Turn presentation distinguishes alerts from directional confirmation', () => {
  assert.equal(formatTurnLabel({alert:true,confirmed:false},'up'),'Turn Alert');
  assert.equal(formatTurnLabel({alert:false,confirmed:true},'up'),'Up Confirmed');
  assert.equal(formatTurnLabel({alert:false,confirmed:true},'down'),'Down Confirmed');
  assert.equal(formatTurnLabel({alert:false,confirmed:false},'flat'),'—');
  assert.equal(formatTurnLabel(null,'insufficient'),'—');
  assert.equal(formatTurnLabel({alert:false,confirmed:true},'down',true),'Down Confirmed (preview)');
  assert.equal(formatTurnLabel({alert:true,confirmed:false},'up',true),'Turn Alert (preview)');
});

test('raw close and pctChg reconstruct a stable front-adjusted series', () => {
  const raw=[
    {trade_date:'2026-01-02',close:10,pct_chg:0},
    {trade_date:'2026-01-05',close:5.5,pct_chg:10},
    {trade_date:'2026-01-06',close:6.05,pct_chg:10}
  ];
  const adjusted=buildFrontAdjustedSeries([...raw].reverse());
  assert.deepEqual(adjusted.map(row=>row.trade_date),['2026-01-02','2026-01-05','2026-01-06']);
  assert.ok(Math.abs(adjusted[0].close-5)<1e-12);
  assert.ok(Math.abs(adjusted[1].close-5.5)<1e-12);
  assert.equal(adjusted[2].close,6.05);
  assert.equal(adjusted[0].raw_close,10);
});

test('chart model keeps 120 points and excludes Current preview from official extrema', () => {
  const official=Array.from({length:125},(_,index)=>50+index/10);
  official[10]=20; official[80]=100;
  const dates=official.map((_,index)=>`D${String(index).padStart(3,'0')}`);
  const model=buildTrackerChartModel([...official,200],dates,{hasPreview:true});
  assert.equal(model.points.length,TRACKER_CHART_WINDOW);
  assert.equal(model.official.length,119);
  assert.equal(model.startDate,'D006');
  assert.equal(model.endDate,'D124');
  assert.equal(model.high.value,100);
  assert.equal(model.low.value,20);
  assert.equal(model.latest.value,62.4);
  assert.equal(model.preview.value,200);
  assert.doesNotMatch(model.ariaLabel,/High close 200/);
  assert.match(model.ariaLabel,/Current preview 200\.000/);
});

test('chart model aligns dates and combines coincident high low latest markers', () => {
  const model=buildTrackerChartModel([10,10,10],['2026-01-02','2026-01-05','2026-01-06']);
  assert.equal(model.markers.length,1);
  assert.deepEqual(model.markers[0].kinds,['high','low','latest']);
  assert.equal(model.markers[0].label,'High / Low / Latest Close');
  assert.equal(model.markers[0].date,'2026-01-06');
  assert.match(model.ariaLabel,/2026-01-02 to 2026-01-06/);
});

test('chart x model gives short horizons a compact tail and caps long forecasts', () => {
  const plot={left:32,right:968};
  assert.equal(trackerForecastRatio(120,1),TRACKER_FORECAST_MIN_RATIO);
  assert.ok(Math.abs(trackerForecastRatio(120,20)-20/139)<1e-12);
  assert.equal(trackerForecastRatio(120,60),TRACKER_FORECAST_MAX_RATIO);
  assert.equal(trackerForecastRatio(120,240),TRACKER_FORECAST_MAX_RATIO);
  for(const horizon of [1,20,60,240]){
    const model=buildTrackerChartXModel(120,horizon,plot);
    assert.equal(model.history[0],plot.left);
    assert.equal(model.history.at(-1),model.historyRight);
    assert.ok(model.historyRight>=plot.left+(plot.right-plot.left)*.75);
    assert.ok(model.forecast[0]>model.historyRight);
    assert.equal(model.forecast.length,horizon);
    assert.equal(model.forecast.at(-1),plot.right);
    assert.ok(model.forecast.every(value=>value>model.historyRight&&value<=plot.right));
  }
});

test('chart y model preserves history readability and flags forecasts beyond 15 percent', () => {
  const normal=buildTrackerChartYModel([40,100],[50,105]);
  assert.equal(normal.historySpan,60);
  assert.equal(normal.min,35.2);
  assert.equal(normal.max,105);
  assert.equal(normal.clippedLow,false);
  assert.equal(normal.clippedHigh,false);
  assert.equal(trackerChartEdge(105,normal),'');

  const extreme=buildTrackerChartYModel([40,100],[0,200]);
  assert.equal(extreme.min,31);
  assert.equal(extreme.max,109);
  assert.equal(extreme.clippedLow,true);
  assert.equal(extreme.clippedHigh,true);
  assert.equal(trackerChartEdge(0,extreme),'low');
  assert.equal(trackerChartEdge(200,extreme),'high');
  assert.equal(trackerChartEdge(70,extreme),'');
});
