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
    userId:'u1', lookFirst:[{ id:'i1', n:'X', h:'10', l:'5', c:'8' }], thenLeap:[{ id:'i1', n:'X' }],
    waveState:{ tabs:[] }, instrumentPool:{ version:1, items:[{ id:'i1', ticker:'X' }], tombstones:[] },
    uiNotes:{ marquee:'m', tips:'t' }
  });
  assert.deepEqual(Object.keys(payload), ['user_id','v6_data','v7_data','wp_data']);
  const restored = unpackCloudPayload(payload);
  assert.equal(restored.lookFirst[0].id, 'i1');
  assert.equal(restored.instrumentPool.items[0].id, 'i1');
  assert.equal(restored.uiNotes.tips, 't');
});

test('pure algorithm modules cannot depend on DOM, storage or Supabase', () => {
  const dirs = ['src/terminal','src/wave'];
  for (const dir of dirs) {
    for (const name of fs.readdirSync(path.join(root,dir))) {
      if (!name.endsWith('.js')) continue;
      const source = fs.readFileSync(path.join(root,dir,name),'utf8');
      assert.doesNotMatch(source, /\b(document|localStorage|supabase)\b/, `${dir}/${name}`);
    }
  }
});

test('entry HTML and templates contain no executable inline event attributes', () => {
  const files = ['TradingViewer.html','Terminal.html','WaveAnalysis.html','src/apps/terminal-app.js','src/apps/wave-app.js'];
  for (const name of files) {
    const source = fs.readFileSync(path.join(root,name),'utf8');
    assert.doesNotMatch(source, /\s(?:onclick|oninput|onchange)=/i, name);
  }
});

test('shared token extraction preserves legacy body markup and page CSS', () => {
  const cases = [
    ['Terminal.html','terminal.css','TradingViewerOnline.html'],
    ['WaveAnalysis.html','wave.css','wavecalfullfinal.html']
  ];
  const bodyShape = source => source
    .slice(source.indexOf('<body'), source.lastIndexOf('</body>') + 7)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/Terminal\.html/g, 'TradingViewerOnline.html')
    .replace(/WaveAnalysis\.html/g, 'wavecalfullfinal.html')
    .replace(/TradingViewer\.html/g, 'TradingViewerDoubleSys.html')
    .replace(/data-fibo-click=/g, 'onclick=')
    .replace(/data-fibo-input=/g, 'oninput=')
    .replace(/data-fibo-change=/g, 'onchange=')
    .replace(/\s+/g, ' ')
    .trim();
  const withoutSharedRoots = source => source
    .replace(/^\uFEFF?\s*:root\s*\{[\s\S]*?\}\s*/, '')
    .replace(/\s*:root\s*\{\s*--mobile-glass\s*:\s*rgba\(248,249,250,\.76\);\s*\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [htmlName,cssName,legacyHtmlName] of cases) {
    const legacy = fs.readFileSync(path.join(root,'legacy/2026-07-24',legacyHtmlName),'utf8');
    const current = fs.readFileSync(path.join(root,htmlName),'utf8');
    const legacyStyle = legacy.match(/<style>([\s\S]*?)<\/style>/i)?.[1].trimStart();
    const css = fs.readFileSync(path.join(root,'assets/css',cssName),'utf8');
    assert.equal(withoutSharedRoots(css), withoutSharedRoots(legacyStyle), `${cssName} changed outside shared token declarations`);
    assert.equal(bodyShape(current), bodyShape(legacy), `${htmlName} body structure changed`);
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
    ['WaveAnalysis.html','wave.css']
  ]) {
    const html = fs.readFileSync(path.join(root,htmlName),'utf8');
    assert.ok(html.indexOf('assets/css/tokens.css') < html.indexOf(`assets/css/${pageCss}`), htmlName);
  }

  for (const pageCss of ['auth.css','terminal.css','wave.css']) {
    const css = fs.readFileSync(path.join(root,'assets/css',pageCss),'utf8');
    assert.doesNotMatch(css, /(^|\})\s*:root\s*\{/m, pageCss);
  }
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

  const routedFiles = [
    'TradingViewer.html', 'Terminal.html', 'WaveAnalysis.html',
    'src/apps/auth-app.js', 'src/apps/terminal-app.js', 'src/apps/wave-app.js', 'src/core/config.js'
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
