import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeScan,normalizeRegime,scanPanelPoints,scanGeometry,themeAngle,themeDisplay,officialDate} from '../../src/radar/market-insights-view-model.js';
import {readMarketInsights} from '../../src/core/market-insights-source.js';
import {insightsFixture} from '../fixtures/market-insights.js';

const wireRow=()=>{
  const scopes=['SECTOR_INDEX','EQUITY_ETF','CROSS_ASSET'];
  const scans=Object.fromEntries(scopes.map(scope=>[scope,{...insightsFixture(scope).scan,algorithmVersion:'insights-v1',universeVersion:'live-reviewed-catalog-v2'}]));
  return {provider:'baostock',trade_date:'2026-09-28',algorithm_version:'insights-v1',universe_version:2,presentation_version:1,calculation_id:'test-only',scans,regime:{...insightsFixture().regime,algorithmVersion:'insights-v1'}};
};
function mockClient(response,calls=[]) {
  const builder={select(value){calls.push(['select',value]);return this},eq(){return this},limit(n){assert.equal(n,1);return this},order(){return Promise.resolve(response)}};
  return {from(table){calls.push(['table',table]);return builder}};
}
test('insights source only reads its own latest bundle, not raw data or Top5',async()=>{
  const calls=[];
  const ready=await readMarketInsights({scope:'SECTOR_INDEX',client:mockClient({data:[wireRow()]},calls)});
  assert.equal(ready.status,'ready');assert.equal(ready.scan.scope,'SECTOR_INDEX');
  assert.equal(calls[0][1],'market_insights_snapshot');
  assert.doesNotMatch(calls[1][1],/theme_scores|source_checkpoints/);
  for(const file of ['src/core/market-insights-source.js','src/radar/market-insights-view-model.js']) {
    const source=fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
    assert.doesNotMatch(source,/localStorage|fetch\(|instrument_id|instrument-identity|\.upsert\(|\.delete\(/);
  }
});
test('insights source distinguishes migration, empty, permission and version errors',async()=>{
  for(const code of ['42P01','PGRST205']) assert.equal((await readMarketInsights({scope:'MARKET_PULSE',client:mockClient({error:{code}})})).status,'not_configured');
  assert.equal((await readMarketInsights({scope:'CROSS_ASSET',client:mockClient({data:[]})})).status,'empty');
  await assert.rejects(readMarketInsights({scope:'CROSS_ASSET',client:mockClient({error:{code:'42501'}})}));
  for(const mutate of [r=>r.algorithm_version='draft',r=>r.scans.EQUITY_ETF.tradeDate='2026-09-25',r=>delete r.scans.CROSS_ASSET,r=>r.regime.value=NaN,r=>r.universe_version=3]) {
    const row=wireRow();mutate(row);
    await assert.rejects(readMarketInsights({scope:'SECTOR_INDEX',client:mockClient({data:[row]})}));
  }
  const row=wireRow();row.regime=null;
  assert.equal((await readMarketInsights({scope:'MARKET_PULSE',client:mockClient({data:[row]})})).status,'empty');
  assert.equal((await readMarketInsights({scope:'EQUITY_ETF',client:mockClient({data:[row]})})).status,'ready');
});
test('presentation validation isolates scopes, versions, dates and finite values',()=>{
  const original=insightsFixture().scan,before=JSON.stringify(original);
  assert.ok(normalizeScan(original,'SECTOR_INDEX'));
  assert.equal(normalizeScan(original,'CROSS_ASSET'),null);
  for(const change of [{presentationVersion:2},{tradeDate:'2026-02-30'},{algorithmVersion:''},{universeVersion:null}]) assert.equal(normalizeScan({...original,...change},'SECTOR_INDEX'),null);
  for(const radius of [null,'0.2',NaN,Infinity,-.1,1.1]) {
    const copy=structuredClone(original);copy.levels.strong[0].radius=radius;
    assert.equal(normalizeScan(copy,'SECTOR_INDEX'),null);
  }
  const copy=structuredClone(original);copy.levels.strong.push(copy.levels.strong[0]);
  assert.equal(normalizeScan(copy,'SECTOR_INDEX'),null);
  copy.levels.strong=[];copy.windows['1'].baselineDate=copy.tradeDate;
  assert.equal(normalizeScan(copy,'SECTOR_INDEX'),null);
  assert.equal(JSON.stringify(original),before);
  assert.equal(officialDate('2026-09-28'),true);
});
test('window changes leave current level unchanged; missing is not empty or padded',()=>{
  const scan=normalizeScan(insightsFixture().scan,'SECTOR_INDEX');
  assert.equal(scanPanelPoints(scan,'strong','1'),scanPanelPoints(scan,'strong','60'));
  assert.notDeepEqual(scanPanelPoints(scan,'strengthening','1'),scanPanelPoints(scan,'strengthening','3'));
  assert.deepEqual(scanPanelPoints(scan,'strengthening','13'),[]);
  assert.equal(scanPanelPoints(scan,'strengthening','60'),null);
  assert.equal(scanPanelPoints(null,'weak','1'),null);
});
test('regime needs its own official result, never defaults missing score to neutral',()=>{
  const regime=insightsFixture().regime;
  assert.equal(normalizeRegime(regime).value,62);
  for(const value of [undefined,null,'50',NaN,-1,101]) assert.equal(normalizeRegime({...regime,value}),null);
  assert.equal(normalizeRegime({pulse_score:62}),null);
});
test('theme angles stay stable and labels fit both phone and desktop geometry',()=>{
  const points=Array.from({length:8},(_,i)=>({themeKey:'theme-'+i,label:'主题'+i,radius:i/8}));
  assert.equal(themeAngle('theme-0'),themeAngle('theme-0'));
  for(const width of [250,320,600]) {
    const model=scanGeometry(points,width,240);
    for(const p of model.nodes) {assert.ok(p.x>=0&&p.x<=width);assert.ok(p.y>=0&&p.y<=240);assert.ok(p.labelY>=16&&p.labelY<=224);}
    for(const side of ['left','right']) {
      const labels=model.nodes.filter(p=>p.side===side).sort((a,b)=>a.labelY-b.labelY);
      for(let i=1;i<labels.length;i++) assert.ok(labels[i].labelY-labels[i-1].labelY>=22-1e-9);
    }
  }
});
test('theme display pairs reviewed English labels with Chinese names',()=>{
  assert.deepEqual(themeDisplay({themeKey:'ai_computing',label:'AI & Computing'}),{chinese:'人工智能与算力',english:'AI & Computing'});
  assert.deepEqual(themeDisplay({themeKey:'exposure_demo',label:'中证海外互联网'}),{chinese:'中证海外互联网',english:'Theme Exposure'});
  assert.deepEqual(themeDisplay({themeKey:'ai_computing',label:'人工智能与算力'}),{chinese:'人工智能与算力',english:'AI & Computing'});
  assert.deepEqual(themeDisplay({themeKey:'technology',label:'Technology'}),{chinese:'科技',english:'Technology'});
});
