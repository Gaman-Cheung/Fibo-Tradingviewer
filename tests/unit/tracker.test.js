import test from 'node:test';
import assert from 'node:assert/strict';
import { inferMainlandMarket, migrateLegacyMarket, toBaoStockCode } from '../../src/core/market-code.js';
import { buildFrontAdjustedSeries } from '../../src/core/front-adjusted-series.js';
import { runMigrations, CURRENT_SCHEMA_VERSION } from '../../src/core/migrations.js';
import { MA_PERIODS, analyzeTrend, appendProvisionalCurrent, directionOf, maDirectionThresholds, maSnapshot, macd, projectScenario, sma, turnState } from '../../src/tracker/trend-engine.js';
import { buildTrackerChartModel, buildTrackerChartXModel, buildTrackerChartYModel, trackerChartEdge, trackerForecastRatio, TRACKER_CHART_WINDOW, TRACKER_FORECAST_DAY_SCALE, TRACKER_FORECAST_MAX_RATIO } from '../../src/tracker/chart-model.js';
import { buildScenarioComparison } from '../../src/tracker/scenario-comparison.js';
import { projectMovingAverageSeries } from '../../src/tracker/ma-projection.js';
import { formatTurnLabel } from '../../src/tracker/status-presenter.js';
import { loadLatestOfficialClose } from '../../src/core/market-repository.js';
import { normalizeTrackerMaProjectionScenario } from '../../src/core/tracker-state.js';

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

test('Tracker MA projection selection migration is idempotent and stays keyed by permanent ID', () => {
  const storage=new MemoryStorage({
    fibo_schema_migration_version:'4',
    tv_instrument_pool_v1:JSON.stringify({version:1,items:[
      {id:'same-a',ticker:'SAME'},{id:'same-b',ticker:'SAME'},{id:'same-c',ticker:'SAME'}
    ],tombstones:[]}),
    tv_trend_tracker_state_v1:JSON.stringify({version:1,instruments:{
      'same-a':{horizon:20},
      'same-b':{horizon:30,maProjectionScenario:'custom'},
      'same-c':{horizon:40,maProjectionScenario:'invalid'}
    }})
  });
  runMigrations(storage);
  const snapshot=storage.getItem('tv_trend_tracker_state_v1');
  runMigrations(storage);
  const state=JSON.parse(storage.getItem('tv_trend_tracker_state_v1'));
  assert.equal(storage.getItem('tv_trend_tracker_state_v1'),snapshot);
  assert.deepEqual(Object.fromEntries(Object.entries(state.instruments).map(([id,value])=>[id,value.maProjectionScenario])),{
    'same-a':'trend','same-b':'custom','same-c':'trend'
  });
  assert.equal(normalizeTrackerMaProjectionScenario('FLAT'),'flat');
  assert.equal(normalizeTrackerMaProjectionScenario('unknown'),'trend');
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

test('MA reverse prices reuse the existing flat band for every supported period', () => {
  const closes=Array.from({length:300},(_,index)=>80+index*.17+Math.sin(index/9));
  const original=[...closes];
  for(const period of MA_PERIODS){
    const thresholds=maDirectionThresholds(closes,period);
    assert.ok(thresholds,`MA${period} thresholds`);
    const previousMa=sma(closes,period);
    const leavingClose=closes.at(-period);
    assert.ok(Math.abs(thresholds.upAbove-(leavingClose+period*previousMa*.0001))<1e-12);
    assert.ok(Math.abs(thresholds.downBelow-(leavingClose-period*previousMa*.0001))<1e-12);
    const epsilon=Math.max(1,Math.abs(thresholds.upAbove))*1e-8;
    assert.equal(maSnapshot([...closes,thresholds.upAbove+epsilon],[period])[period].direction,'up');
    assert.equal(maSnapshot([...closes,thresholds.downBelow-epsilon],[period])[period].direction,'down');
    assert.equal(maSnapshot([...closes,(thresholds.upAbove+thresholds.downBelow)/2],[period])[period].direction,'flat');
    assert.equal(directionOf(.0001),'flat');
    assert.equal(directionOf(-.0001),'flat');
  }
  assert.equal(maDirectionThresholds(closes.slice(0,4),5),null);
  assert.equal(maDirectionThresholds(closes,0),null);
  assert.equal(maDirectionThresholds(closes,5.5),null);
  assert.deepEqual(closes,original);
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

test('conditional MA projections exactly reuse SMA for every Scenario path and horizon', () => {
  const base=Array.from({length:260},(_,index)=>70+index*.08+Math.sin(index/9));
  const original=[...base];
  for(const horizon of [1,20,60,240]){
    const scenarios=buildScenarioComparison(base,{horizon,target:135});
    for(const scenario of scenarios){
      const path=scenario.projection.path;
      const projected=projectMovingAverageSeries(base,path,[5,20,60,240]);
      for(const item of projected){
        assert.equal(item.start,sma(base,item.period));
        assert.deepEqual(item.values,path.map((_,index)=>sma([...base,...path.slice(0,index+1)],item.period)));
      }
    }
  }
  assert.deepEqual(base,original);
});

test('conditional MA projection includes Current Preview and waits for enough history', () => {
  const official=[1,2,3,4,5,6,7,8,9,10];
  const withPreview=appendProvisionalCurrent(official,20);
  const previewProjection=projectMovingAverageSeries(withPreview,[21,22],[5]);
  assert.equal(previewProjection[0].start,sma(withPreview,5));
  assert.equal(previewProjection[0].values[0],sma([...withPreview,21],5));
  assert.notEqual(previewProjection[0].start,sma(official,5));

  const insufficient=projectMovingAverageSeries([1,2,3],[4,5,6],[5,10]);
  assert.deepEqual(insufficient[0],{period:5,start:null,values:[null,3,4]});
  assert.deepEqual(insufficient[1],{period:10,start:null,values:[null,null,null]});
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

test('chart x model renders forecast days at one-third scale without a minimum and caps long forecasts', () => {
  const plot={left:32,right:968};
  const expectedRatio=(points,horizon)=>Math.min(
    TRACKER_FORECAST_MAX_RATIO,
    horizon*TRACKER_FORECAST_DAY_SCALE/(points-1+horizon*TRACKER_FORECAST_DAY_SCALE)
  );
  assert.ok(Math.abs(trackerForecastRatio(120,1)-expectedRatio(120,1))<1e-12);
  assert.ok(trackerForecastRatio(120,1)<.01);
  assert.ok(Math.abs(trackerForecastRatio(120,20)-expectedRatio(120,20))<1e-12);
  assert.ok(Math.abs(trackerForecastRatio(120,60)-expectedRatio(120,60))<1e-12);
  assert.equal(trackerForecastRatio(120,240),TRACKER_FORECAST_MAX_RATIO);
  assert.ok(Math.abs(trackerForecastRatio(80,20)-expectedRatio(80,20))<1e-12);
  for(const horizon of [1,20,60,240]){
    const model=buildTrackerChartXModel(120,horizon,plot);
    assert.equal(model.history[0],plot.left);
    assert.ok(Math.abs(model.history.at(-1)-model.historyRight)<1e-9);
    assert.ok(model.historyRight>=plot.left+(plot.right-plot.left)*.85);
    assert.ok(model.forecast[0]>model.historyRight);
    assert.equal(model.forecast.length,horizon);
    assert.ok(Math.abs(model.forecast.at(-1)-plot.right)<1e-9);
    assert.ok(model.forecast.every(value=>value>model.historyRight&&value<=plot.right));
    assert.ok(model.forecast.every((value,index)=>index===0||value>model.forecast[index-1]));
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
