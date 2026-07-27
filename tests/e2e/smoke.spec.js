import { test, expect } from '@playwright/test';

const supabaseMock = `
window.supabase={createClient(){
 const marketRows=Array.from({length:130},(_,index)=>{
   const date=new Date(Date.UTC(2026,0,2+index));
   const close=index===20?80:index===70?160:100+index*.2;
   const previous=index===0?close:index-1===20?80:index-1===70?160:100+(index-1)*.2;
   return {trade_date:date.toISOString().slice(0,10),close,pct_chg:index?(close/previous-1)*100:0,trade_status:1,synced_at:'2026-07-27T11:00:00Z'};
 }).reverse();
 function builder(table){
   const filters={};
   return {
     select(){return this},eq(column,value){filters[column]=value;return this},limit(){return this},
     order(){if(table==='market_daily_bar')window.__marketDailyBarOrders=(window.__marketDailyBarOrders||0)+1;return Promise.resolve({data:table==='market_daily_bar'&&filters.code==='300657'?marketRows:[],error:null})},
     single(){return Promise.resolve({data:null,error:{code:'PGRST116'}})},
     maybeSingle(){return Promise.resolve({data:table==='market_sync_checkpoint'?{last_status:'success'}:null,error:null})},
     upsert(){return Promise.resolve({data:null,error:null})}
   };
 }
 return {auth:{getSession:async()=>({data:{session:{user:{id:'test'}}},error:null}),getUser:async()=>({data:{user:{id:'test'}},error:null}),signOut:async()=>({error:null}),signInWithPassword:async()=>({data:{user:{id:'test'}},error:null}),signUp:async()=>({data:{user:{id:'test'}},error:null})},from(table){return builder(table)}};
}};`;

test.beforeEach(async ({ page }) => {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status:200, contentType:'application/javascript', body:supabaseMock }));
  await page.addInitScript(() => {
    if (!localStorage.getItem('tv_instrument_pool_v1')) localStorage.setItem('tv_instrument_pool_v1', JSON.stringify({ version:1, items:[
      { id:'e2e-a', ticker:'E2E', code:'300657', market:'SZ', order:0, status:'active' },
      { id:'e2e-b', ticker:'E2E', code:'', market:'OTHER', order:1, status:'active' },
      { id:'e2e-c', ticker:'E2E COPY', code:'300657', market:'SZ', order:2, status:'active' }
    ], tombstones:[] }));
    if (!localStorage.getItem('tv_lookfirst_data_v3')) localStorage.setItem('tv_lookfirst_data_v3', JSON.stringify([
      { id:'e2e-a', n:'E2E', h:'100', l:'50', c:'70', e:'65', p:'68', b:'current' },
      { id:'e2e-b', n:'E2E', h:'80', l:'40', c:'60', e:'', p:'59', b:'current' },
      { id:'e2e-c', n:'E2E COPY', h:'90', l:'45', c:'69', e:'', p:'67', b:'current' }
    ]));
    if (!localStorage.getItem('tv_thenleap_data_v3')) localStorage.setItem('tv_thenleap_data_v3', JSON.stringify([
      { id:'e2e-a', n:'E2E', t:'sideways', r:'50', m:'neutral', s:'60', g:'100', g1:'75', v:'1' },
      { id:'e2e-b', n:'E2E', t:'sideways', r:'', m:'neutral', s:'', g:'', g1:'', v:'' },
      { id:'e2e-c', n:'E2E COPY', t:'sideways', r:'', m:'neutral', s:'', g:'', g1:'', v:'' }
    ]));
  });
});

test('authentication is a unified workspace with usable fields', async ({ page }, testInfo) => {
  await page.goto('/TradingViewer.html');

  await expect(page.locator('.system-selector')).toHaveCount(0);
  await expect(page.locator('#card-badge')).toContainText('Unified Workspace');
  await expect(page.locator('#auth-form')).toHaveCount(1);

  const email = page.locator('#email');
  const password = page.locator('#password');
  await email.fill('user@example.com');
  await password.fill('secret-value');

  for (const field of ['email','password']) {
    const labelBox = await page.locator(`label[for="${field}"]`).boundingBox();
    const shellBox = await page.locator(`#${field}`).locator('..').boundingBox();
    expect(labelBox, `${field} label is visible`).not.toBeNull();
    expect(shellBox, `${field} shell is visible`).not.toBeNull();
    expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(shellBox.y + 1);
  }

  await expect(password).toHaveAttribute('type', 'password');
  await page.locator('#togglePassword').click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(page.locator('#togglePassword')).toHaveAttribute('aria-pressed', 'true');

  await email.fill('');
  await password.fill('');
  await page.locator('#auth-form button[type="submit"]').click();
  await expect(page.locator('#auth-message')).toContainText('Please enter both');

  const layout = await page.evaluate(() => {
    const card = document.querySelector('.login-card').getBoundingClientRect();
    const hero = document.querySelector('.hero-animation');
    return {
      cardLeft:card.left, cardRight:card.right,
      viewportWidth:window.innerWidth,
      documentWidth:document.documentElement.scrollWidth,
      heroDisplay:getComputedStyle(hero).display
    };
  });
  expect(layout.cardLeft).toBeGreaterThanOrEqual(0);
  expect(layout.cardRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  if (testInfo.project.name === 'iphone') expect(layout.heroDisplay).toBe('none');
});

for (const [pageName,selector] of [
  ['TradingViewer.html','.login-card'],
  ['Terminal.html?tab=v6','.header'],
  ['WaveAnalysis.html','#chart']
  ,['TrendTracker.html','.fibo-header']
]) {
  test(`${pageName} loads its modular entry`, async ({ page }) => {
    const errors=[];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/${pageName}`);
    await expect(page.locator(selector)).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('terminal controller switches tabs and persists shared Pro Tips', async ({ page }, testInfo) => {
  await page.goto('/Terminal.html?tab=v6');
  await expect(page.locator('#tableBodyV6 tr[data-instrument-id="e2e-a"] .instrument-meta-button')).toHaveClass(/is-ready/);
  await expect(page.locator('#tableBodyV6 tr[data-instrument-id="e2e-a"] .instrument-meta-button')).toHaveAttribute('title',/300657 · SZ/);
  if (testInfo.project.name === 'iphone') await expect(page.locator('.mobile-header-tools .material-icons').first()).toHaveText('menu_book');
  else {
    const alignment=await page.evaluate(()=>{
      const row=document.querySelector('#tableBodyV6 tr[data-instrument-id="e2e-a"]');
      const ticker=row.querySelector('.name').getBoundingClientRect(), high=row.querySelector('.high').getBoundingClientRect();
      return {tickerCenter:ticker.y+ticker.height/2,highCenter:high.y+high.height/2,rowHeight:row.getBoundingClientRect().height};
    });
    expect(Math.abs(alignment.tickerCenter-alignment.highCenter)).toBeLessThanOrEqual(1);
    expect(alignment.rowHeight).toBeLessThanOrEqual(68);
    await expect(page.locator('#tableBodyV6 .ticker-market-code')).toHaveCount(0);
    const editButton=page.locator('#tableBodyV6 tr[data-instrument-id="e2e-b"] .instrument-meta-button');
    await expect(editButton).not.toHaveClass(/is-ready/);
    await editButton.click();
    await expect(page.locator('#instrumentEditId')).toHaveValue('e2e-b');
    await page.locator('#instrumentCode').fill('000001');
    await page.locator('#instrumentMarket').selectOption('SZ');
    await page.locator('[data-fibo-click="saveInstrumentDialog()"]' ).click();
    await expect(page.locator('tr[data-instrument-id="e2e-b"] .instrument-meta-button')).toHaveCount(2);
    await expect(page.locator('tr[data-instrument-id="e2e-b"] .instrument-meta-button').first()).toHaveClass(/is-ready/);
  }
  await page.locator('#btn-v7').click();
  await expect(page.locator('#tab-v7')).toHaveClass(/active/);
  if (testInfo.project.name === 'iphone') await page.locator('.mobile-header-tools [data-fibo-click="openNoteEditor(\'tips\')"]').click();
  else await page.locator('[data-fibo-click="openNoteEditor(\'tips\')"]:visible').click();
  await expect(page.locator('#noteModalBackdrop')).toHaveClass(/open/);
  await page.locator('#noteEditorText').fill('E2E discipline');
  await page.locator('[data-fibo-click="saveNoteEditor()"]' ).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('tv_header_tips_v1'))).toBe('E2E discipline');
});

test('terminal Auto Prev Close is deduplicated by symbol and remains overridable per permanent ID', async ({ page }) => {
  await page.goto('/Terminal.html?tab=v6');
  const rowA=page.locator('#tableBodyV6 tr[data-instrument-id="e2e-a"]');
  const rowB=page.locator('#tableBodyV6 tr[data-instrument-id="e2e-b"]');
  const rowC=page.locator('#tableBodyV6 tr[data-instrument-id="e2e-c"]');
  const previousA=rowA.locator('.previous');
  await expect(previousA).toHaveValue('125.8');
  await expect(rowC.locator('.previous')).toHaveValue('125.8');
  await expect(previousA).toHaveJSProperty('readOnly',true);
  await expect(rowA.locator('.previous-mode-button')).toHaveClass(/state-success/);
  await expect(rowA.locator('.previous-mode-button')).toHaveAttribute('title',/2026-05-11/);
  await expect(rowB.locator('.previous')).toHaveJSProperty('readOnly',false);
  expect(await page.evaluate(()=>window.__marketDailyBarOrders)).toBe(1);
  await expect(page.locator('#tableBodyV7 tr[data-instrument-id="e2e-a"] .market-summary')).toContainText('vs Prev -44.36%');

  await rowA.locator('.previous-mode-button').click();
  await expect(previousA).toHaveJSProperty('readOnly',false);
  await previousA.fill('88');
  await expect(page.locator('#tableBodyV7 tr[data-instrument-id="e2e-a"] .market-summary')).toContainText('vs Prev -20.45%');
  await expect.poll(()=>page.evaluate(()=>{
    const row=JSON.parse(localStorage.getItem('tv_lookfirst_data_v3')).find(item=>item.id==='e2e-a');
    return [row.p,row.pm,row.pd];
  })).toEqual(['88','manual','']);

  await page.reload();
  const reloaded=page.locator('#tableBodyV6 tr[data-instrument-id="e2e-a"]');
  await expect(reloaded.locator('.previous')).toHaveValue('88');
  await expect(reloaded.locator('.previous')).toHaveJSProperty('readOnly',false);
  await reloaded.locator('.previous-mode-button').click();
  await expect(reloaded.locator('.previous')).toHaveValue('125.8');
  await expect(reloaded.locator('.previous')).toHaveJSProperty('readOnly',true);
  await expect.poll(()=>page.evaluate(()=>{
    const row=JSON.parse(localStorage.getItem('tv_lookfirst_data_v3')).find(item=>item.id==='e2e-a');
    return [row.p,row.pm,row.pd];
  })).toEqual(['125.8','auto','2026-05-11']);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('terminal Auto Prev Close preserves a cached value when no market row is available', async ({ page }) => {
  await page.goto('/Terminal.html?tab=v6');
  await page.evaluate(()=>{
    const pool=JSON.parse(localStorage.getItem('tv_instrument_pool_v1'));
    Object.assign(pool.items.find(item=>item.id==='e2e-b'),{code:'600001',market:'SH'});
    localStorage.setItem('tv_instrument_pool_v1',JSON.stringify(pool));
    const rows=JSON.parse(localStorage.getItem('tv_lookfirst_data_v3'));
    Object.assign(rows.find(item=>item.id==='e2e-b'),{pm:'auto',pd:''});
    localStorage.setItem('tv_lookfirst_data_v3',JSON.stringify(rows));
    localStorage.setItem('tv_active_instrument_id','e2e-b');
  });
  await page.reload();
  const row=page.locator('#tableBodyV6 tr[data-instrument-id="e2e-b"]');
  await expect(row.locator('.previous')).toHaveValue('59');
  await expect(row.locator('.previous')).toHaveJSProperty('readOnly',true);
  await expect(row.locator('.previous-mode-button')).toHaveClass(/state-cached/);
  await expect(row.locator('.previous-mode-button')).toHaveAttribute('title',/cached value/i);
  await row.locator('.previous-mode-button').click();
  await expect(row.locator('.previous')).toHaveJSProperty('readOnly',false);
});

test('all systems share the established header geometry', async ({ page }, testInfo) => {
  const results=[];
  for (const name of ['Terminal.html?tab=v6','WaveAnalysis.html','TrendTracker.html']) {
    await page.goto(`/${name}`);
    const geometry=await page.evaluate(()=>{
      const header=document.querySelector('.fibo-header');
      const logo=document.querySelector('.fibo-header__logo').getBoundingClientRect();
      const reminder=document.querySelector('.fibo-header__reminder').getBoundingClientRect();
      const action=document.querySelector('.fibo-header__actions > button, .fibo-header__actions > a');
      const mobileTool=document.querySelector('.fibo-header__mobile button');
      const systemAction=document.querySelector('.fibo-header__actions > .fibo-button--system, .fibo-header__actions > .btn-switch-system, .fibo-header__actions > .btn-pro-tips');
      const pullAction=document.querySelector('.fibo-header__actions > .fibo-button--cloud-down');
      const pushAction=document.querySelector('.fibo-header__actions > .fibo-button--cloud-up');
      const headerStyle=getComputedStyle(header);
      const actionStyle=action?getComputedStyle(action):null;
      const systemStyle=systemAction?getComputedStyle(systemAction):null;
      return {
        logo:logo.width, reminder:reminder.height, headerDisplay:headerStyle.display, headerAlign:headerStyle.alignItems,
        actionRadius:actionStyle?.borderRadius, actionHeight:action?.getBoundingClientRect().height,
        actionFontSize:actionStyle?.fontSize, systemBorder:systemStyle?.borderColor,
        systemBackground:systemStyle?.backgroundColor,
        pullColor:pullAction?getComputedStyle(pullAction).color:null,
        pullBackground:pullAction?getComputedStyle(pullAction).backgroundColor:null,
        pushColor:pushAction?getComputedStyle(pushAction).color:null,
        pushBackground:pushAction?getComputedStyle(pushAction).backgroundColor:null,
        mobileToolHeight:mobileTool?.getBoundingClientRect().height
      };
    });
    expect(geometry.logo).toBe(testInfo.project.name==='iphone'?34:36);
    expect(geometry.reminder).toBe(testInfo.project.name==='iphone'?38:44);
    expect(geometry.actionRadius).toBe('6px');
    expect(geometry.actionFontSize).toBe('13px');
    if(testInfo.project.name==='desktop-chromium') {
      expect(geometry.headerDisplay).toBe('flex');
      expect(geometry.headerAlign).toBe('center');
      expect(geometry.systemBorder).toBe('rgb(60, 64, 67)');
      expect(geometry.systemBackground).toBe('rgb(248, 249, 250)');
      expect(geometry.pullColor).toBe('rgb(66, 133, 244)');
      expect(geometry.pullBackground).toBe('rgb(232, 240, 254)');
      expect(geometry.pushColor).toBe('rgb(24, 128, 56)');
      expect(geometry.pushBackground).toBe('rgb(230, 244, 234)');
    }
    if(testInfo.project.name==='iphone') expect(geometry.mobileToolHeight).toBe(40);
    results.push(geometry);
  }
  if(testInfo.project.name==='desktop-chromium') for(const geometry of results) expect(Math.abs(geometry.actionHeight-results[0].actionHeight)).toBeLessThanOrEqual(1);
});

test('tracker uses Pool code and mobile Pro Tips without a cloud shortcut', async ({ page }, testInfo) => {
  await page.goto('/TrendTracker.html');
  await expect(page.locator('#trackerCode')).toContainText('300657 · SZ');
  await expect(page.locator('.setup-warning')).toBeHidden();
  const widths=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:window.innerWidth}));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);
  if (testInfo.project.name === 'desktop-chromium') {
    const layout=await page.evaluate(()=>{
      const main=document.querySelector('.tracker-main').getBoundingClientRect();
      const card=document.querySelector('.tracker-card');
      return {left:main.left,right:window.innerWidth-main.right,radius:getComputedStyle(card).borderRadius};
    });
    expect(layout.left).toBe(16); expect(layout.right).toBe(16); expect(layout.radius).toBe('8px');
  }
  if (testInfo.project.name === 'iphone') {
    await expect(page.locator('.fibo-header__mobile .material-icons').first()).toHaveText('menu_book');
    await page.locator('.fibo-header__mobile [data-fibo-click="openNote(\'tips\')"]').click();
  } else await page.locator('.fibo-header__actions [data-fibo-click="openNote(\'tips\')"]').click();
  await expect(page.locator('#trackerNoteBackdrop')).toHaveClass(/open/);
});

test('tracker chart exposes official markers, dates and separate Current preview', async ({ page }) => {
  await page.goto('/TrendTracker.html');
  const canvas=page.locator('#trackerChart');
  await expect(canvas).toHaveAttribute('aria-label',/Trend chart range 2026-01-13 to 2026-05-11\./);
  await expect(canvas).toHaveAttribute('aria-label',/High close 160\.000 on 2026-03-13\./);
  await expect(canvas).toHaveAttribute('aria-label',/Low close 80\.000 on 2026-01-22\./);
  await expect(canvas).toHaveAttribute('aria-label',/Latest close 125\.800 on 2026-05-11\./);
  await expect(canvas).toHaveAttribute('aria-label',/Current preview 70\.000\./);

  await page.locator('#trackerCurrent').fill('220');
  await expect(canvas).toHaveAttribute('aria-label',/Current preview 220\.000\./);
  await expect(canvas).toHaveAttribute('aria-label',/High close 160\.000/);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('Tracker compares all Scenario paths and resets only the active Scenario inputs', async ({ page },testInfo) => {
  await page.goto('/TrendTracker.html');
  await expect(page.locator('#scenarioMode')).toHaveCount(0);
  const rows=page.locator('#scenarioResult .scenario-result-row');
  await expect(rows).toHaveCount(3);
  await expect(page.locator('[data-scenario="flat"]')).toContainText('Flat');
  await expect(page.locator('[data-scenario="trend"]')).toContainText('Trend continuation');
  const custom=page.locator('[data-scenario="custom"]');
  const canvas=page.locator('#trackerChart');
  await expect(custom).toHaveClass(/is-disabled/);
  await expect(custom).toContainText('Set Target');
  await expect(canvas).toHaveAttribute('aria-label',/Flat forecast ends at/);
  await expect(canvas).toHaveAttribute('aria-label',/Trend continuation forecast ends at/);
  await expect(canvas).toHaveAttribute('aria-label',/Custom target is not set/);

  const legendColors=await page.evaluate(()=>Object.fromEntries(['flat','trend','custom'].map(key=>[
    key,getComputedStyle(document.querySelector(`.scenario-line--${key}`)).borderTopColor
  ])));
  expect(legendColors).toEqual({flat:'rgb(66, 133, 244)',trend:'rgb(52, 168, 83)',custom:'rgb(234, 67, 53)'});

  await page.locator('#scenarioTargetDate').fill('2026-05-12');
  await page.locator('#scenarioTargetDate').blur();
  await expect(canvas).toHaveAttribute('data-forecast-horizon','1');
  await expect(canvas).toHaveAttribute('data-forecast-ratio','0.0400');
  await page.locator('#scenarioTargetDate').fill('');
  await page.locator('#scenarioTargetDate').blur();

  await page.locator('#scenarioHorizon').fill('13');
  await page.locator('#scenarioTarget').fill('42.96');
  await expect(custom).not.toHaveClass(/is-disabled/);
  await expect(custom.locator('.scenario-result-row__numbers strong')).toContainText('Day 13: 42.960');
  await expect(canvas).toHaveAttribute('aria-label',/Forecast horizon 13 trading days/);
  await expect(canvas).toHaveAttribute('aria-label',/Custom target forecast ends at 42\.960/);
  await expect(canvas).toHaveAttribute('aria-label',/beyond the lower chart edge/);
  await expect(canvas).toHaveAttribute('data-forecast-clipped',/custom:low/);

  await page.locator('#scenarioTargetDate').fill('2026-06-01');
  await page.locator('#scenarioTargetDate').blur();
  await expect(custom.locator('.scenario-result-row__numbers strong')).toContainText('2026-06-01: 42.960');
  await expect(canvas).toHaveAttribute('aria-label',/Forecast target date 2026-06-01/);

  const geometry=await page.evaluate(()=>{
    const date=document.getElementById('scenarioTargetDate').getBoundingClientRect();
    const reset=document.querySelector('.scenario-reset-button').getBoundingClientRect();
    return {dateRight:date.right,dateBottom:date.bottom,resetLeft:reset.left,resetBottom:reset.bottom,resetHeight:reset.height};
  });
  expect(geometry.resetLeft).toBeGreaterThanOrEqual(geometry.dateRight-1);
  expect(Math.abs(geometry.resetBottom-geometry.dateBottom)).toBeLessThanOrEqual(1);
  expect(geometry.resetHeight).toBeGreaterThanOrEqual(testInfo.project.name==='iphone'?44:36);

  await page.evaluate(()=>{
    const state=JSON.parse(localStorage.getItem('tv_trend_tracker_state_v1'));
    state.instruments['e2e-a'].scenarioMode='custom';
    localStorage.setItem('tv_trend_tracker_state_v1',JSON.stringify(state));
  });
  await page.reload();
  await expect(page.locator('#scenarioMode')).toHaveCount(0);
  await expect(page.locator('[data-scenario="flat"]')).toBeVisible();
  await expect(page.locator('[data-scenario="trend"]')).toBeVisible();
  await expect(page.locator('[data-scenario="custom"]')).not.toHaveClass(/is-disabled/);
  await page.locator('.scenario-reset-button').click();
  await expect(page.locator('#scenarioHorizon')).toHaveValue('20');
  await expect(page.locator('#scenarioTarget')).toHaveValue('');
  await expect(page.locator('#scenarioTargetDate')).toHaveValue('');
  await expect(custom).toHaveClass(/is-disabled/);
  const saved=await page.evaluate(()=>({
    tracker:JSON.parse(localStorage.getItem('tv_trend_tracker_state_v1')),
    current:JSON.parse(localStorage.getItem('tv_lookfirst_data_v3')).find(row=>row.id==='e2e-a')?.c,
    vr:JSON.parse(localStorage.getItem('tv_thenleap_data_v3')).find(row=>row.id==='e2e-a')?.v
  }));
  expect(saved.tracker.instruments['e2e-a']).toEqual({horizon:20,target:'',targetDate:''});
  expect(saved.current).toBe('70');
  expect(saved.vr).toBe('1');
  expect(saved.tracker.visibleMas.length).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator('#scenarioHorizon')).toHaveValue('20');
  await expect(page.locator('#scenarioTarget')).toHaveValue('');
  await expect(page.locator('#scenarioTargetDate')).toHaveValue('');
  await expect(page.locator('#scenarioResult .scenario-result-row')).toHaveCount(3);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('Terminal and Tracker share Current and VR by permanent ID across tabs', async ({ page,context }) => {
  await page.goto('/Terminal.html?tab=v6');
  const tracker=await context.newPage();
  await tracker.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:supabaseMock}));
  await tracker.goto('/TrendTracker.html');
  const terminalA=page.locator('#tableBodyV6 tr[data-instrument-id="e2e-a"]');
  await terminalA.locator('.current').fill('77.5');
  await expect(tracker.locator('#trackerCurrent')).toHaveValue('77.5');

  await tracker.locator('#trackerVr').fill('1.8');
  await expect(page.locator('#tableBodyV7 tr[data-instrument-id="e2e-a"] .volume-ratio')).toHaveValue('1.8');
  const distinct=await page.evaluate(()=>({
    current:JSON.parse(localStorage.getItem('tv_lookfirst_data_v3')).find(row=>row.id==='e2e-b')?.c,
    vr:JSON.parse(localStorage.getItem('tv_thenleap_data_v3')).find(row=>row.id==='e2e-b')?.v
  }));
  expect(distinct).toEqual({current:'60',vr:''});
  await tracker.close();
});

test('Then Leap MACD suggestion is on-demand and divergence remains manual', async ({ page },testInfo) => {
  await page.goto('/Terminal.html?tab=v7');
  const row=page.locator('#tableBodyV7 tr[data-instrument-id="e2e-a"]');
  if(testInfo.project.name==='iphone')await row.locator('.mobile-detail-toggle').click();
  const select=row.locator('.macd');
  await expect(select).toHaveValue('neutral');
  await row.locator('.macd-suggest-button').click();
  await expect(page.locator('#macdSuggestionBackdrop')).toHaveClass(/open/);
  await expect(page.locator('#macdSuggestionContent')).toContainText('Close/DIF divergence candidates');
  await expect(page.locator('#macdSuggestionContent')).toContainText('CURRENT PREVIEW');
  await expect(select).toHaveValue('neutral');
  await expect(page.locator('#applyMacdSuggestionButton')).toBeEnabled();
  const suggested=await page.locator('.macd-suggestion-summary > strong').textContent();
  await page.locator('#applyMacdSuggestionButton').click();
  const expected=suggested.includes('Bullish')?'bullish':suggested.includes('Bearish')?'bearish':'neutral';
  await expect(select).toHaveValue(expected);
  await expect(select.locator('option[value="divergence"]')).toHaveText(/Bullish Divergence/);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('all Push actions use inline Saved to Cloud feedback', async ({ page },testInfo) => {
  const systems=[
    {url:'Terminal.html?tab=v6',open:'openMobileActions()',sheet:'#mobileActionsBackdrop'},
    {url:'WaveAnalysis.html',open:'openWaveMobileActions()',sheet:'#waveMobileActionsBackdrop'},
    {url:'TrendTracker.html',open:'openActions()',sheet:'#trackerActionsBackdrop'}
  ];
  for(const system of systems){
    await page.goto(`/${system.url}`);
    let push;
    if(testInfo.project.name==='iphone'){
      await page.locator(`[data-fibo-click="${system.open}"]`).click();
      push=page.locator(`${system.sheet} .fibo-button--cloud-up`);
    }else push=page.locator('.fibo-header__actions .fibo-button--cloud-up');
    await push.click();
    await expect(push).toContainText('Saved to Cloud');
    if(testInfo.project.name==='iphone'){
      await expect(page.locator(system.sheet)).toHaveClass(/open/);
      await expect(page.locator(system.sheet)).not.toHaveClass(/open/,{timeout:3500});
    }else await expect(push).toContainText('Push to Cloud',{timeout:3500});
  }
});

test('tracker MA Status and Scenario Lab share the read-only help modal', async ({ page }) => {
  await page.goto('/TrendTracker.html');
  const helpButtons=page.locator('.fibo-help-button');
  await expect(helpButtons).toHaveCount(2);

  await helpButtons.nth(0).click();
  await expect(page.locator('#trackerHelpBackdrop')).toHaveClass(/open/);
  await expect(page.locator('#trackerHelpTitle')).toContainText('MA Status');
  await expect(page.locator('#trackerHelpContent')).toContainText('ΔMA');
  await expect(page.locator('#trackerHelpContent')).toContainText('Up Confirmed');
  await expect(page.locator('#trackerHelpContent')).toContainText('Down Confirmed');
  await expect(page.locator('#trackerHelpContent')).toContainText('insufficient');
  await expect(page.locator('#trackerHelpContent')).toContainText('golden cross');
  await expect(page.locator('#trackerHelpContent')).toContainText('below zero axis');
  await expect(page.locator('#trackerHelpContent')).toContainText('strengthening');
  await expect(page.locator('#trackerHelpContent')).toContainText('(preview)');
  await page.locator('#trackerHelpBackdrop [data-fibo-click="closeTrackerHelp()"]' ).last().click();
  await expect(page.locator('#trackerHelpBackdrop')).not.toHaveClass(/open/);

  await helpButtons.nth(1).click();
  await expect(page.locator('#trackerHelpTitle')).toContainText('Scenario Lab');
  await expect(page.locator('#trackerHelpContent')).toContainText('Trend continuation');
  for (const state of ['Long Bull','Long Bear','Transition','Uptrend','Downtrend','Range','趋势延续','反转确认','下跌反抽','调整探底','反转观察','震荡等待']) {
    await expect(page.locator('#trackerHelpContent')).toContainText(state);
  }
  await expect(page.locator('#trackerHelpContent')).toContainText('Composite Signal');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.locator('#trackerHelpBackdrop').click({position:{x:2,y:2}});
  await expect(page.locator('#trackerHelpBackdrop')).not.toHaveClass(/open/);
});

test('terminal keeps its established help control', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium','Terminal table help controls are desktop-only.');
  await page.goto('/Terminal.html?tab=v6');
  const help=page.locator('.help-icon').first();
  await expect(help).toBeVisible();
  const geometry=await help.evaluate(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height,borderRadius:getComputedStyle(node).borderRadius}));
  expect(geometry).toEqual({width:18,height:18,borderRadius:'50%'});
});

test('wave controller loads the shared Pool instrument and opens Pro Tips', async ({ page }, testInfo) => {
  await page.goto('/WaveAnalysis.html');
  await expect(page.locator('#tabs .tab').first()).toContainText('E2E');
  const tips = page.locator('[data-fibo-click="openWaveNoteEditor(\'tips\')"]:visible');
  await (testInfo.project.name === 'iphone' ? tips.last() : tips.first()).click();
  await expect(page.locator('#waveNoteModalBackdrop')).toHaveClass(/open/);
});
