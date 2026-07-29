import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INDEX_RADAR_ALGORITHM_VERSION,
  INDEX_RADAR_UNIVERSE_VERSION,
  INDEX_RADAR_GUIDE_HTML,
  RADAR_EVENT_GUIDE,
  RADAR_RISK_GUIDE,
} from '../../src/radar/radar-help.js';
import { normalizeRadarSnapshot, primaryRadarEvents } from '../../src/radar/radar-view-model.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

test('Radar snapshot normalization is bounded to five market leaders',()=>{
  const row={
    provider:'baostock',trade_date:'2026-07-28',algorithm_version:1,universe_version:1,
    benchmark_market:'SH',benchmark_code:'000300',universe_count:507,eligible_count:171,coverage:.98,
    leaders:Array.from({length:7},(_,index)=>({
      rank:index+1,market:'sz',code:String(399300+index),name:`Leader ${index+1}`,score:90-index,
      events:[{label:'1D Surge',points:2},{label:'MA60 Breakout',points:8}],metrics:{rs5:index,rs20:index+1},
      appearances:{consecutive:index+1,days15:index+2,days30:index+3}
    }))
  };
  const snapshot=normalizeRadarSnapshot(row);
  assert.equal(snapshot.tradeDate,'2026-07-28');
  assert.equal(snapshot.leaders.length,5);
  assert.equal(snapshot.leaders[0].market,'SZ');
  assert.deepEqual(primaryRadarEvents(snapshot.leaders[0]).map(event=>event.label),['MA60 Breakout','1D Surge']);
  assert.equal(normalizeRadarSnapshot({...row,trade_date:'invalid'}),null);
});

test('Radar algorithm, in-product guide and indicator manual share one vocabulary',()=>{
  const python=fs.readFileSync(path.join(root,'scripts/index_radar.py'),'utf8');
  const manual=fs.readFileSync(path.join(root,'docs/INDEX_RADAR_GUIDE.md'),'utf8');
  const algorithms=fs.readFileSync(path.join(root,'docs/ALGORITHMS.md'),'utf8');
  const expectedEvents=[
    ['ma60_reclaim_confirmed','MA60 Reclaim Confirmed','+9',9],
    ['ma60_breakout','MA60 Breakout','+8',8],
    ['high_20d_breakout','20D High Breakout','+7',7],
    ['relative_strength_new_high','Relative Strength New High','+6',6],
    ['ma60_turn_up','MA60 Turn Up','+6',6],
    ['acceleration_3d','3D Acceleration','+5',5],
    ['persistent_advance','Persistent Advance','+4',4],
    ['streak_3d','3-Day Streak','+3',3],
    ['surge_1d','1D Surge','+2',2],
  ];
  assert.deepEqual(RADAR_EVENT_GUIDE.slice(0,9).map(([name,score])=>[name,score]),expectedEvents.map(([,name,score])=>[name,score]));
  for(const [key,label,,points] of expectedEvents){
    assert.match(python,new RegExp(`['"]${key}['"]\\s*:\\s*${points}`),`${key} points`);
    assert.ok(INDEX_RADAR_GUIDE_HTML.includes(label),`${label} in product guide`);
    assert.ok(manual.includes(label),`${label} in manual`);
    assert.ok(algorithms.includes(label),`${label} in algorithm contract`);
  }
  for(const [label,effect] of RADAR_RISK_GUIDE){
    assert.ok(manual.includes(label),`${label} risk manual`);
    assert.ok(INDEX_RADAR_GUIDE_HTML.includes(label),`${label} risk product guide`);
    if(effect==='−10')assert.match(manual,/Extended[\s\S]{0,120}(?:扣|deducts?)\s*10/i);
    if(effect==='Excluded')assert.match(manual,/MA60 Breakdown[\s\S]{0,180}(?:直接退出|excludes?)/i);
  }
  for(const source of [manual,algorithms,INDEX_RADAR_GUIDE_HTML]){
    assert.match(source,/Score\s*=\s*25\s*[×*]\s*PctRank\(RS5\)/);
    assert.match(source,/30\s*[×*]\s*PctRank\(RS20\)/);
    assert.match(source,/(Score\s*[≥>]\s*60|Score ≥ 60)/);
  }
  assert.match(python,/rs5_score\s*=\s*25\s*\*/);
  assert.match(python,/rs20_score\s*=\s*30\s*\*/);
  assert.match(python,/MIN_LEADER_SCORE\s*=\s*60/);
  assert.equal(INDEX_RADAR_ALGORITHM_VERSION,1);
  assert.equal(INDEX_RADAR_UNIVERSE_VERSION,1);
  assert.match(python,/ALGORITHM_VERSION\s*=\s*1/);
  assert.match(python,/UNIVERSE_VERSION\s*=\s*1/);
  assert.match(manual,/Algorithm version:\s*\*\*1\*\*/);
  assert.match(manual,/Universe version:\s*\*\*1\*\*/);
});

test('Radar keeps pure ranking, repository and shared brand-card boundaries',()=>{
  const algorithm=fs.readFileSync(path.join(root,'scripts/index_radar.py'),'utf8');
  const controller=fs.readFileSync(path.join(root,'src/apps/index-radar-controller.js'),'utf8');
  const repository=fs.readFileSync(path.join(root,'src/core/index-radar-repository.js'),'utf8');
  const components=fs.readFileSync(path.join(root,'assets/css/components.css'),'utf8');
  const terminalCss=fs.readFileSync(path.join(root,'assets/css/terminal.css'),'utf8');
  const terminalHtml=fs.readFileSync(path.join(root,'Terminal.html'),'utf8');
  assert.doesNotMatch(algorithm,/^\s*(?:from|import)\s+(?:requests|supabase)|localStorage\.|instrument\.id/m);
  assert.match(controller,/loadLatestIndexRadar/);
  assert.doesNotMatch(controller,/calculateTechnicalScore|classifyCompositeSignal|localStorage\.|loadInstrumentPool|tv_(?:lookfirst|thenleap)/);
  assert.match(repository,/market_index_radar_snapshot/);
  assert.match(components,/\.fibo-card--brand-ring\s*\{/);
  assert.doesNotMatch(terminalCss,/\.fibo-card--brand-ring\s*\{/);
  assert.equal((terminalHtml.match(/id="indexRadarHelpButton"/g)||[]).length,1);
  assert.equal((terminalHtml.match(/class="fibo-help-button" id="indexRadarHelpButton"/g)||[]).length,1);
});

test('Radar schema and both sync launchers preserve the independent CN_INDEX contract',()=>{
  const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260729_index_radar.sql'),'utf8');
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/sync-baostock.yml'),'utf8');
  const launcher=fs.readFileSync(path.join(root,'SyncBaoStock.cmd'),'utf8');
  const sync=fs.readFileSync(path.join(root,'scripts/sync_baostock.py'),'utf8');
  for(const table of ['market_index_catalog','market_index_radar_snapshot']){
    assert.match(migration,new RegExp(`create table if not exists public\\.${table}`,'i'));
    assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`,'i'));
  }
  assert.doesNotMatch(migration,/instrument_id|user_id/i);
  assert.match(workflow,/options:\s*\[indices, a-shares, all\]/);
  assert.match(workflow,/MODE="\$\{REQUESTED_MODE:-daily\}"/);
  assert.match(workflow,/DATASET="\$\{REQUESTED_DATASET:-all\}"/);
  assert.match(launcher,/SYNC_DATASET/);
  assert.match(sync,/INDEX_SCOPE\s*=\s*"CN_INDEX"/);
  assert.match(sync,/choices=\("a-shares", "indices", "all"\)/);
});
