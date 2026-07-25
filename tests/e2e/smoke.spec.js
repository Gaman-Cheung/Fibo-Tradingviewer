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
      { id:'e2e-a', ticker:'E2E', code:'300657', market:'SZ', order:0, status:'active' }
    ], tombstones:[] }));
    localStorage.setItem('tv_lookfirst_data_v3', JSON.stringify([
      { id:'e2e-a', n:'E2E', h:'100', l:'50', c:'70', e:'65', p:'68', b:'current' }
    ]));
    localStorage.setItem('tv_thenleap_data_v3', JSON.stringify([
      { id:'e2e-a', n:'E2E', t:'sideways', r:'50', m:'neutral', s:'60', g:'100', g1:'75', v:'1' }
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
  ,['TrendTracker.html','.tracker-header']
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
  await expect(page.locator('#tableBodyV6 .ticker-market-code')).toContainText('300657 · SZ');
  if (testInfo.project.name === 'iphone') await expect(page.locator('.mobile-header-tools .material-icons').first()).toHaveText('menu_book');
  await page.locator('#btn-v7').click();
  await expect(page.locator('#tab-v7')).toHaveClass(/active/);
  if (testInfo.project.name === 'iphone') await page.locator('.mobile-header-tools [data-fibo-click="openNoteEditor(\'tips\')"]').click();
  else await page.locator('[data-fibo-click="openNoteEditor(\'tips\')"]:visible').click();
  await expect(page.locator('#noteModalBackdrop')).toHaveClass(/open/);
  await page.locator('#noteEditorText').fill('E2E discipline');
  await page.locator('[data-fibo-click="saveNoteEditor()"]' ).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('tv_header_tips_v1'))).toBe('E2E discipline');
});

test('tracker uses Pool code and mobile Pro Tips without a cloud shortcut', async ({ page }, testInfo) => {
  await page.goto('/TrendTracker.html');
  await expect(page.locator('#trackerCode')).toContainText('300657 · SZ');
  await expect(page.locator('.setup-warning')).toBeHidden();
  const widths=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:window.innerWidth}));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);
  if (testInfo.project.name === 'iphone') {
    await expect(page.locator('.mobile-tools .material-icons').first()).toHaveText('menu_book');
    await page.locator('.mobile-tools [data-fibo-click="openNote(\'tips\')"]').click();
  } else await page.locator('.desktop-tools [data-fibo-click="openNote(\'tips\')"]').click();
  await expect(page.locator('#trackerNoteBackdrop')).toHaveClass(/open/);
});

test('wave controller loads the shared Pool instrument and opens Pro Tips', async ({ page }, testInfo) => {
  await page.goto('/WaveAnalysis.html');
  await expect(page.locator('#tabs .tab')).toContainText('E2E');
  const tips = page.locator('[data-fibo-click="openWaveNoteEditor(\'tips\')"]:visible');
  await (testInfo.project.name === 'iphone' ? tips.last() : tips.first()).click();
  await expect(page.locator('#waveNoteModalBackdrop')).toHaveClass(/open/);
});
