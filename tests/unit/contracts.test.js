import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCloudPayload, unpackCloudPayload } from '../../src/core/cloud-payload.js';
import { ROUTES, SUPABASE_PROFILES } from '../../src/core/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('cloud payload keeps legacy columns and metadata carriers round-trippable', () => {
  const payload = buildCloudPayload({
    userId:'u1', lookFirst:[{ id:'i1', n:'X', h:'10', l:'5', c:'8', p:'7.8', pm:'auto', pd:'2026-07-24' }], thenLeap:[{ id:'i1', n:'X' }],
    waveState:{ tabs:[] }, instrumentPool:{ version:1, items:[{ id:'i1', ticker:'X' }], tombstones:[] },
    uiNotes:{ marquee:'m', tips:'t' }
  });
  assert.deepEqual(Object.keys(payload), ['user_id','v6_data','v7_data','wp_data']);
  const restored = unpackCloudPayload(payload);
  assert.equal(restored.lookFirst[0].id, 'i1');
  assert.deepEqual({p:restored.lookFirst[0].p,pm:restored.lookFirst[0].pm,pd:restored.lookFirst[0].pd},{p:'7.8',pm:'auto',pd:'2026-07-24'});
  assert.equal(restored.instrumentPool.items[0].id, 'i1');
  assert.equal(restored.uiNotes.tips, 't');
});

test('pure algorithm modules cannot depend on DOM, storage or Supabase', () => {
  const dirs = ['src/terminal','src/wave','src/tracker','src/radar','src/pulse'];
  for (const dir of dirs) {
    for (const name of fs.readdirSync(path.join(root,dir))) {
      if (!name.endsWith('.js')) continue;
      const source = fs.readFileSync(path.join(root,dir,name),'utf8');
      assert.doesNotMatch(source, /\b(document|localStorage|supabase)\b/, `${dir}/${name}`);
    }
  }
});

test('entry HTML and templates contain no executable inline event attributes', () => {
  const files = ['TradingViewer.html','Terminal.html','WaveAnalysis.html','TrendTracker.html','src/apps/terminal-app.js','src/apps/wave-app.js','src/apps/tracker-app.js'];
  for (const name of files) {
    const source = fs.readFileSync(path.join(root,name),'utf8');
    assert.doesNotMatch(source, /\s(?:onclick|oninput|onchange)=/i, name);
  }
});

test('legacy baseline remains present and untouched by runtime imports', () => {
  for (const name of ['TradingViewerDoubleSys.html','TradingViewerOnline.html','wavecalfullfinal.html']) {
    const source=fs.readFileSync(path.join(root,'legacy/2026-07-24',name),'utf8');
    assert.ok(source.length>1000,name);
    assert.doesNotMatch(source,/TrendTracker\.html/,name);
  }
});

test('design tokens are centralized and loaded before page styles', () => {
  const tokens = fs.readFileSync(path.join(root,'assets/css/tokens.css'),'utf8');
  for (const token of [
    '--color-primary', '--color-surface', '--color-text', '--color-danger',
    '--font-family-sans', '--space-4', '--radius-lg', '--touch-target-min',
    '--shadow-card', '--duration-base', '--z-dialog'
  ]) assert.match(tokens, new RegExp(`${token}\\s*:`), token);

  for (const [htmlName,pageCss] of [
    ['TradingViewer.html','auth.css'],
    ['Terminal.html','terminal.css'],
    ['WaveAnalysis.html','wave.css'],
    ['TrendTracker.html','tracker.css']
  ]) {
    const html = fs.readFileSync(path.join(root,htmlName),'utf8');
    const tokensIndex = html.indexOf('assets/css/tokens.css');
    const componentsIndex = html.indexOf('assets/css/components.css');
    const pageIndex = html.indexOf(`assets/css/${pageCss}`);
    assert.ok(tokensIndex >= 0 && tokensIndex < componentsIndex, `${htmlName}: tokens must load before components`);
    assert.ok(componentsIndex < pageIndex, `${htmlName}: components must load before page CSS`);
  }

  for (const pageCss of ['auth.css','terminal.css','wave.css','tracker.css']) {
    const css = fs.readFileSync(path.join(root,'assets/css',pageCss),'utf8');
    assert.doesNotMatch(css, /(^|\})\s*:root\s*\{/m, pageCss);
  }
});

test('page styles cannot override shared header geometry', () => {
  for (const pageCss of ['auth.css','terminal.css','wave.css','tracker.css']) {
    const css = fs.readFileSync(path.join(root,'assets/css',pageCss),'utf8');
    assert.doesNotMatch(
      css,
      /(?:^|[},])\s*[^{}]*\.fibo-header(?:__|\b)[^{}]*\{/m,
      `${pageCss}: shared fibo-header selectors belong in components.css`
    );
  }
});

test('all workspace systems consume the shared header component contract', () => {
  const components=fs.readFileSync(path.join(root,'assets/css/components.css'),'utf8');
  for(const selector of ['.fibo-header','.fibo-header__logo','.fibo-header__reminder','.fibo-header__actions','.fibo-modal']) assert.match(components,new RegExp(selector.replace('.','\\.')));
  for(const name of ['Terminal.html','WaveAnalysis.html','TrendTracker.html']) {
    const source=fs.readFileSync(path.join(root,name),'utf8');
    assert.match(source,/class="[^"]*fibo-header[^"]*"/,name);
    assert.match(source,/fibo-header__logo/,name);
    assert.match(source,/fibo-header__reminder/,name);
    assert.match(source,/fibo-header__actions/,name);
  }
});

test('all cloud actions use the shared blue pull and green push variants', () => {
  for (const name of ['Terminal.html','WaveAnalysis.html','TrendTracker.html']) {
    const source=fs.readFileSync(path.join(root,name),'utf8');
    const buttons=source.match(/<button\b[\s\S]*?<\/button>/gi) || [];
    const pullButtons=buttons.filter(button=>button.includes('cloud_download'));
    const pushButtons=buttons.filter(button=>button.includes('cloud_upload'));
    assert.ok(pullButtons.length >= 1, `${name}: Pull action missing`);
    assert.ok(pushButtons.length >= 1, `${name}: Push action missing`);
    for(const button of pullButtons) assert.match(button,/fibo-button--cloud-down/,`${name}: Pull must use shared blue variant`);
    for(const button of pushButtons) assert.match(button,/fibo-button--cloud-up/,`${name}: Push must use shared green variant`);
  }
});

test('all systems use the shared inline cloud Push feedback contract', () => {
  const feedback=fs.readFileSync(path.join(root,'src/apps/cloud-action-feedback.js'),'utf8');
  const components=fs.readFileSync(path.join(root,'assets/css/components.css'),'utf8');
  for(const state of ['saving','saved'])assert.match(feedback,new RegExp(`['"]${state}['"]`));
  assert.match(feedback,/aria-busy/);
  assert.match(feedback,/aria-live/);
  assert.match(components,/\.fibo-button\.is-cloud-saving/);
  assert.match(components,/\.fibo-button\.is-cloud-saved/);
  for(const name of ['terminal-app.js','wave-app.js','tracker-app.js']){
    const source=fs.readFileSync(path.join(root,'src/apps',name),'utf8');
    assert.match(source,/runCloudPushFeedback/,name);
  }
  for(const name of ['Terminal.html','WaveAnalysis.html','TrendTracker.html']){
    const source=fs.readFileSync(path.join(root,name),'utf8');
    for(const button of source.match(/<button\b[^>]*fibo-button--cloud-up[^>]*>/gi)||[])assert.match(button,/\(this\)/,`${name}: Push must identify the clicked button`);
  }
});

test('all page controllers use one full-workspace cloud service', () => {
  for (const name of ['terminal-app.js','wave-app.js','tracker-app.js']) {
    const source=fs.readFileSync(path.join(root,'src/apps',name),'utf8');
    assert.match(source,/pushWorkspaceToCloud/,`${name}: shared Push service missing`);
    assert.match(source,/pullWorkspaceFromCloud/,`${name}: shared Pull service missing`);
    for (const privateOperation of ['buildCloudPayload','loadCloudRow','upsertCloudRow','syncMarketBindings','saveTrackerState']) {
      assert.doesNotMatch(source,new RegExp(`\\b${privateOperation}\\b`),`${name}: page must not implement ${privateOperation}`);
    }
  }
  const wave=fs.readFileSync(path.join(root,'src/apps/wave-app.js'),'utf8');
  assert.equal((wave.match(/pullFromCloud\(/g)||[]).length,1,'Wave Pull may only be the explicit button handler');
  const service=fs.readFileSync(path.join(root,'src/core/workspace-cloud-sync.js'),'utf8');
  for (const symbol of ['pushWorkspaceToCloud','pullWorkspaceFromCloud','trend_tracker_state','market_instrument_bindings']) assert.match(service,new RegExp(symbol));
});

test('official and preview MACD results use one shared source-label contract', () => {
  const components=fs.readFileSync(path.join(root,'assets/css/components.css'),'utf8');
  const terminal=fs.readFileSync(path.join(root,'src/apps/terminal-app.js'),'utf8');
  const tracker=fs.readFileSync(path.join(root,'src/apps/tracker-app.js'),'utf8');
  assert.match(components,/\.fibo-analysis-source--official/);
  assert.match(components,/\.fibo-analysis-source--preview/);
  for(const source of [terminal,tracker]){
    assert.match(source,/fibo-analysis-source--\$\{/);
    assert.match(source,/Official Close/);
    assert.match(source,/Current Preview/);
  }
});

test('Terminal MACD help and algorithm guide share the complete manual interpretation contract', () => {
  const terminal=fs.readFileSync(path.join(root,'src/apps/terminal-app.js'),'utf8');
  const algorithms=fs.readFileSync(path.join(root,'docs/ALGORITHMS.md'),'utf8');
  const html=fs.readFileSync(path.join(root,'Terminal.html'),'utf8');
  const required=[
    'Bullish Divergence +2','Bullish +1','Wait/Flat 0','Bearish -1','neutral',
    'DIF','DEA','Histogram = 2 × (DIF − DEA)','Golden Cross','Death Cross','零轴','至少两项一致',
    '双线缠绕或走平','反复交叉','柱体接近零轴','刚交叉','负柱缩短','正柱缩短',
    '数据不足','Official Close','Current Preview','Apply Suggestion','零轴下方','双线上行','正柱继续扩张','零轴上方','双线下行','负柱继续扩张',
    '更低低点','更高低点','60','五点拐点','顶背离','Bearish','Wait/Flat'
  ];
  for(const source of [terminal,algorithms]){
    for(const text of required)assert.ok(source.includes(text),`MACD contract missing ${text}`);
  }
  assert.match(html,/Algorithm Guide v2\.2 · 2026-08/);
});

test('Tracker MA Reverse Price engine, help and algorithm guide share one derived threshold contract', () => {
  const engine=fs.readFileSync(path.join(root,'src/tracker/trend-engine.js'),'utf8');
  const tracker=fs.readFileSync(path.join(root,'src/apps/tracker-app.js'),'utf8');
  const algorithms=fs.readFileSync(path.join(root,'docs/ALGORITHMS.md'),'utf8');
  const html=fs.readFileSync(path.join(root,'TrendTracker.html'),'utf8');
  assert.match(engine,/export function maDirectionThresholds/);
  assert.match(engine,/normalizedPeriod \* previousMa \* FLAT_RATIO/);
  assert.match(html,/Direction<\/th><th>Reverse Price<\/th><th>Turn/);
  for(const source of [tracker,algorithms]){
    for(const text of ['Reverse Price','C_leave','MA_previous','0.01%','Up','Down','flat','Current','official','Turn Alert','Up Confirmed','Down Confirmed']){
      assert.ok(source.includes(text),`MA Reverse Price contract missing ${text}`);
    }
  }
});

test('Tracker Scenario visibility remains per permanent ID and presentation-only', () => {
  const state=fs.readFileSync(path.join(root,'src/core/tracker-state.js'),'utf8');
  const migrations=fs.readFileSync(path.join(root,'src/core/migrations.js'),'utf8');
  const tracker=fs.readFileSync(path.join(root,'src/apps/tracker-app.js'),'utf8');
  const contracts=fs.readFileSync(path.join(root,'docs/DATA_CONTRACTS.md'),'utf8');
  const algorithms=fs.readFileSync(path.join(root,'docs/ALGORITHMS.md'),'utf8');
  assert.match(state,/DEFAULT_TRACKER_SCENARIO_VISIBILITY/);
  assert.match(state,/flat:true,trend:true,custom:true/);
  assert.match(migrations,/current < 6/);
  for(const source of [state,tracker,contracts,algorithms])assert.match(source,/scenarioVisibility|Scenario visibility/i);
  for(const source of [tracker,contracts,algorithms]){
    for(const text of ['permanent','hidden','projected MA'])assert.ok(source.toLowerCase().includes(text.toLowerCase()),`Scenario visibility contract missing ${text}`);
  }
  assert.match(tracker,/data-scenario-visibility/);
  assert.match(tracker,/All Scenario paths are hidden/);
});

test('local BaoStock launcher keeps credentials and its environment out of Git', () => {
  const ignore=fs.readFileSync(path.join(root,'.gitignore'),'utf8');
  const launcher=fs.readFileSync(path.join(root,'SyncBaoStock.cmd'),'utf8');
  const runner=fs.readFileSync(path.join(root,'scripts/run-baostock-local.ps1'),'utf8');
  const example=fs.readFileSync(path.join(root,'.env.local.example'),'utf8');
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/sync-baostock.yml'),'utf8');
  assert.match(ignore,/^\.env\.local$/m);
  assert.match(ignore,/^\.venv\/$/m);
  assert.match(launcher,/run-baostock-local\.ps1/);
  assert.match(runner,/\.env\.local/);
  assert.match(runner,/scripts[\\/]sync_baostock\.py|sync_baostock\.py/);
  assert.match(example,/PASTE_YOUR_SERVICE_ROLE_OR_SB_SECRET_KEY_HERE/);
  assert.doesNotMatch(example,/sb_secret_[A-Za-z0-9_-]{20,}/);
  assert.match(workflow,/cron:\s*'0 11 \* \* 1-5'/);
  for(const mode of ['smoke','daily','backfill','repair']) assert.match(workflow,new RegExp(`\\b${mode}\\b`));
  assert.match(workflow,/baostock-full-market-sync/);
  assert.match(ignore,/^local-market-data\/$/m);
});

test('full-market schema is additive and does not bind prices to permanent IDs', () => {
  const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260725_baostock_full_market.sql'),'utf8');
  assert.match(migration,/create table if not exists public\.market_daily_bar/i);
  assert.match(migration,/primary key \(provider, market, code, trade_date\)/i);
  assert.match(migration,/create table if not exists public\.market_sync_checkpoint/i);
  assert.doesNotMatch(migration,/instrument_id/i);
  assert.doesNotMatch(migration,/drop table/i);
});

test('Market Pulse schema is additive, independently keyed and authenticated-read-only', () => {
  const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260804_market_pulse.sql'),'utf8');
  const repository=fs.readFileSync(path.join(root,'src/core/market-pulse-repository.js'),'utf8');
  const contracts=fs.readFileSync(path.join(root,'docs/DATA_CONTRACTS.md'),'utf8');
  const readme=fs.readFileSync(path.join(root,'README.md'),'utf8');
  assert.match(migration,/create table if not exists public\.market_pulse_snapshot/i);
  assert.match(migration,/primary key \(provider, trade_date\)/i);
  assert.match(migration,/create table if not exists public\.market_pulse_member_snapshot/i);
  assert.match(migration,/primary key \(provider, trade_date, calculation_id, member_type, market, code\)/i);
  assert.match(migration,/to authenticated using \(true\)/i);
  assert.match(migration,/check \(retention_sessions between 60 and 400\)/i);
  assert.doesNotMatch(migration,/\b(?:user_id|instrument_id)\b/i);
  assert.doesNotMatch(migration,/drop table/i);
  assert.match(repository,/market_pulse_snapshot/);
  assert.match(repository,/market_pulse_member_snapshot/);
  assert.match(repository,/Math\.min\(50/);
  assert.doesNotMatch(repository,/market_daily_bar|localStorage|instrument_id|Composite Signal/);
  for(const source of [contracts,readme]){
    assert.match(source,/20MB/);
    assert.match(source,/75MB/);
  }
});

test('all four Market Context scopes share one responsive frame contract', () => {
  const html=fs.readFileSync(path.join(root,'Terminal.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'assets/css/terminal.css'),'utf8');
  const design=fs.readFileSync(path.join(root,'docs/DESIGN_SYSTEM.md'),'utf8');
  assert.match(html,/class="index-radar-viewport market-context-viewport"/);
  assert.match(css,/\.market-context-viewport\s*\{\s*height:316px/);
  for(const height of [236,425,516,616]) assert.match(css,new RegExp(`\\.market-context-viewport \\{ height:${height}px; \\}`));
  assert.match(css,/\.market-context-viewport > \.index-radar-dashboard,\.market-context-viewport > \.market-pulse-dashboard \{ height:100%; \}/);
  assert.match(design,/All four tabs occupy one shared responsive Market Context frame/);
  assert.match(design,/each active dashboard must fit it without an inner vertical scrollbar/);
});

test('authentication entry exposes one unified, accessible form', () => {
  const source = fs.readFileSync(path.join(root,'TradingViewer.html'),'utf8');
  const controller = fs.readFileSync(path.join(root,'src/apps/auth-app.js'),'utf8');
  assert.doesNotMatch(source, /class=["'][^"']*system-selector/i);
  assert.doesNotMatch(source, /data-sys=/i);
  assert.equal((source.match(/<form\b/gi) || []).length, 1);
  assert.match(source, /<label\s+for=["']email["']/i);
  assert.match(source, /<input\b[^>]*id=["']email["']/i);
  assert.match(source, /<label\s+for=["']password["']/i);
  assert.match(source, /<input\b[^>]*id=["']password["']/i);
  assert.match(source, /<button\b[^>]*type=["']submit["'][^>]*class=["'][^"']*btn-primary/i);
  assert.match(controller, /window\.location\.href\s*=\s*ROUTES\.terminal/);
  assert.doesNotMatch(controller, /ROUTES\.wave/);
});

test('public entries and cross-system routes use the renamed HTML files', () => {
  assert.ok(ROUTES.auth.endsWith('/TradingViewer.html'));
  assert.ok(ROUTES.terminal.endsWith('/Terminal.html'));
  assert.ok(ROUTES.wave.endsWith('/WaveAnalysis.html'));
  assert.ok(ROUTES.tracker.endsWith('/TrendTracker.html'));

  const routedFiles = [
    'TradingViewer.html', 'Terminal.html', 'WaveAnalysis.html', 'TrendTracker.html',
    'src/apps/auth-app.js', 'src/apps/terminal-app.js', 'src/apps/wave-app.js', 'src/apps/tracker-app.js', 'src/core/config.js'
  ];
  const publishedSource = routedFiles.map(name => fs.readFileSync(path.join(root,name),'utf8')).join('\n');
  assert.doesNotMatch(publishedSource, /TradingViewerDoubleSys\.html|TradingViewerOnline\.html|wavecalfullfinal\.html/);
});

test('all pages use the same active Supabase project profile', () => {
  const profiles = Object.values(SUPABASE_PROFILES);
  assert.equal(new Set(profiles.map(profile => profile.url)).size, 1);
  assert.equal(new Set(profiles.map(profile => profile.key)).size, 1);
  assert.match(profiles[0].key, /^sb_publishable_/);
});
