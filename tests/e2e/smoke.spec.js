import { test, expect } from '@playwright/test';

const supabaseMock = `
window.supabase={createClient(){
 const chain={select(){return this},eq(){return this},order(){return Promise.resolve({data:[],error:null})},single(){return Promise.resolve({data:null,error:{code:'PGRST116'}})},upsert(){return Promise.resolve({data:null,error:null})}};
 return {auth:{getSession:async()=>({data:{session:{user:{id:'test'}}},error:null}),getUser:async()=>({data:{user:{id:'test'}},error:null}),signOut:async()=>({error:null}),signInWithPassword:async()=>({data:{user:{id:'test'}},error:null}),signUp:async()=>({data:{user:{id:'test'}},error:null})},from(){return Object.create(chain)}};
}};`;

test.beforeEach(async ({ page }) => {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status:200, contentType:'application/javascript', body:supabaseMock }));
  await page.addInitScript(() => {
    localStorage.setItem('tv_instrument_pool_v1', JSON.stringify({ version:1, items:[
      { id:'e2e-a', ticker:'E2E', code:'300657', market:'SZ', order:0, status:'active' },
      { id:'e2e-b', ticker:'E2E', code:'', market:'OTHER', order:1, status:'active' }
    ], tombstones:[] }));
    localStorage.setItem('tv_lookfirst_data_v3', JSON.stringify([
      { id:'e2e-a', n:'E2E', h:'100', l:'50', c:'70', e:'65', p:'68', b:'current' },
      { id:'e2e-b', n:'E2E', h:'80', l:'40', c:'60', e:'', p:'59', b:'current' }
    ]));
    localStorage.setItem('tv_thenleap_data_v3', JSON.stringify([
      { id:'e2e-a', n:'E2E', t:'sideways', r:'50', m:'neutral', s:'60', g:'100', g1:'75', v:'1' },
      { id:'e2e-b', n:'E2E', t:'sideways', r:'', m:'neutral', s:'', g:'', g1:'', v:'' }
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

test('wave controller loads the shared Pool instrument and opens Pro Tips', async ({ page }, testInfo) => {
  await page.goto('/WaveAnalysis.html');
  await expect(page.locator('#tabs .tab').first()).toContainText('E2E');
  const tips = page.locator('[data-fibo-click="openWaveNoteEditor(\'tips\')"]:visible');
  await (testInfo.project.name === 'iphone' ? tips.last() : tips.first()).click();
  await expect(page.locator('#waveNoteModalBackdrop')).toHaveClass(/open/);
});
