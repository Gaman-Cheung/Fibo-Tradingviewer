import { test, expect } from '@playwright/test';

const supabaseMock = `
window.supabase={createClient(){
 const marketRows=Array.from({length:130},(_,index)=>{
   const date=new Date(Date.UTC(2026,0,2+index));
   const close=index===20?80:index===70?160:100+index*.2;
   const previous=index===0?close:index-1===20?80:index-1===70?160:100+(index-1)*.2;
   return {trade_date:date.toISOString().slice(0,10),close,pct_chg:index?(close/previous-1)*100:0,trade_status:1,synced_at:'2026-07-27T11:00:00Z'};
 }).reverse();
 const radarLeaders=[
   ['国证算力基础设施','SZ','399363','ai_computing','AI & Computing',92.4,4.8,10.2,'MA60 Breakout',8],
   ['中证新能源','SZ','399808','new_energy','New Energy',88.1,3.9,8.4,'Relative Strength New High',6],
   ['上证环保产业','SH','000158','environmental','Environmental',82.7,3.1,7.2,'20D High Breakout',7],
   ['上证公用事业','SH','000007','utilities','Utilities',78.3,2.6,5.9,'Persistent Advance',4],
   ['中证煤炭','SZ','399998','coal','Coal',74.5,1.8,4.7,'3-Day Streak',3]
 ].map((item,index)=>({
   rank:index+1,name:item[0],market:item[1],code:item[2],category:'theme',themeGroup:item[3],themeLabel:item[4],score:item[5],
   events:[{key:'event_'+index,label:item[8],points:item[9],kind:'signal'}],risks:index===1?[{key:'extended',label:'Extended',penalty:10}]:[],
   metrics:{close:100+index,return1D:1.2+index/10,return3D:3.4+index/10,return5D:5.2+index/10,return20D:12.4+index/10,benchmarkReturn5D:.4,benchmarkReturn20D:2.2,rs5:item[6],rs20:item[7],ma20:96+index,ma60:90+index,ma60SlopePct:.08,distanceMA60Pct:8.2+index},
   scoreBreakdown:{rs5:22-index,rs20:28-index,trend:30,event:Math.min(item[9],15),risk:index===1?10:0},
   trendBreakdown:{aboveMA60:5,ma60Rising:10,alignment:15},appearances:{consecutive:index+1,days15:8-index,days30:14-index}
 }));
 const radarSnapshots=Array.from({length:60},(_,offset)=>{
   const date=new Date(Date.UTC(2026,6,28-offset)).toISOString().slice(0,10);
   const leaders=radarLeaders.map((leader,index)=>({...leader,rank:(index+offset)%5+1})).sort((a,b)=>a.rank-b.rank);
   return {provider:'baostock',trade_date:date,algorithm_version:1,universe_version:2,benchmark_market:'SH',benchmark_code:'000300',universe_count:507,eligible_count:171,coverage:.9825,leaders,computed_at:date+'T11:30:00Z'};
 });
 const radarSnapshot=radarSnapshots[0];
 const etfRadarSnapshots={};
 for(const scope of ['EQUITY_ETF','CROSS_ASSET']){
   etfRadarSnapshots[scope]=radarSnapshots.map(snapshot=>({
     ...snapshot,scope,universe_count:1385,eligible_count:scope==='EQUITY_ETF'?34:18,
     leaders:snapshot.leaders.map((leader,index)=>({
       ...leader,
       name:scope==='EQUITY_ETF'?['CSI 300 ETF','Semiconductor ETF','New Energy ETF','Bank ETF','Dividend ETF'][index]:['NASDAQ 100 ETF','Gold ETF','Treasury Bond ETF','Money Market ETF','Hang Seng Tech ETF'][index],
       category:scope==='EQUITY_ETF'?['equity_broad','equity_theme','equity_theme','equity_sector','equity_strategy'][index]:['overseas','commodity','bond','money','overseas'][index],
       assetCategory:scope==='EQUITY_ETF'?['equity_broad','equity_theme','equity_theme','equity_sector','equity_strategy'][index]:['overseas','commodity','bond','money','overseas'][index],
       themeGroup:scope==='EQUITY_ETF'?['csi300','semiconductor','new_energy','banking','dividend'][index]:['nasdaq100','gold','treasury_bond','money_market','hang_seng_tech'][index],
       themeLabel:scope==='EQUITY_ETF'?['CSI 300','Semiconductor','New Energy','Banking','Dividend'][index]:['NASDAQ 100','Gold','Treasury Bond','Money Market','Hang Seng Tech'][index],
       radarScope:scope,averageAmount20D:25000000+index*10000000,
     })),
   }));
 }
 const pulseSnapshots=Array.from({length:60},(_,offset)=>{
   const date=new Date(Date.UTC(2026,6,28-offset)).toISOString().slice(0,10);
   const score=68+Math.sin(offset/5)*8;
   return {
     provider:'baostock',trade_date:date,algorithm_version:1,index_universe_version:2,
     calculation_id:'pulse-calc-'+date,pulse_score:score,pulse_state:score>=80?'Broad Strength':score>=60?'Healthy Strength':'Mixed',
     stock_eligible_count:4288,index_eligible_count:171,stock_coverage:.991,index_coverage:.982,
     participation:{score:72,eligible:4288,up_1d_count:2670,up_1d_pct:62.3,up_5d_count:2810,up_5d_pct:65.5,median_return_1d_pct:.62,strong_up_count:75,strong_down_count:19,strong_balance:63.1},
     trend_breadth:{score:66,eligible:4288,above_ma20_count:2780,above_ma20_pct:64.8,above_ma60_count:2640,above_ma60_pct:61.6,ma20_rising_count:2910,ma20_rising_pct:67.9,ma60_rising_count:2990,ma60_rising_pct:69.7},
     expansion:{score:59,eligible:4288,new_high_20_count:328,new_low_20_count:94,high_low_balance:77.7,ma60_breakout_count:183,ma60_breakdown_count:112,bo_bd_balance:62},
     leadership:{score:75,eligible_index_count:171,expected_index_count:174,theme_count:28,theme_above_ma60_pct:71.2,theme_ma60_rising_pct:74.6,theme_new_high_weight:8.5,theme_new_low_weight:2.5,theme_high_low_balance:71.4,broad_confirmation_pct:82.5,broad_confirmed_count:3},
     computed_at:date+'T11:45:00Z',
   };
 });
  const pulseMembers=[
   ...Array.from({length:120},(_,index)=>({
     provider:'baostock',trade_date:'2026-07-28',calculation_id:'pulse-calc-2026-07-28',member_type:'stock',
     market:index%2?'SZ':'SH',code:String(600000+index).slice(-6),name:'Market Stock '+String(index+1).padStart(3,'0'),theme_group:'',close:10+index/10,
     return_1d:index<75?5.2+index/100:index<95?1.1:-(index-94)/10,return_5d:index<90?3.2:-2.1,
     direction_1d:index<95?1:-1,direction_5d:index<90?1:-1,strong_up:index<75,strong_down:index>=115,
     above_ma20:index<82,above_ma60:index<78,ma20_rising:index<88,ma60_rising:index<84,
     new_high_20:index<55,new_low_20:index>=110,ma60_breakout:index<40,ma60_breakdown:index>=112,
     distance_ma20_pct:4-index/30,distance_ma60_pct:6-index/25,ma20_slope_pct:.12-index/2000,ma60_slope_pct:.08-index/2500,
   })),
   ...Array.from({length:10},(_,index)=>({
     provider:'baostock',trade_date:'2026-07-28',calculation_id:'pulse-calc-2026-07-28',member_type:'sector_index',
     market:index%2?'SZ':'SH',code:String(399000+index).slice(-6),name:'Sector Index '+String(index+1).padStart(2,'0'),theme_group:'theme_'+index,close:1000+index,
     return_1d:1+index/10,return_5d:4+index/10,direction_1d:1,direction_5d:1,strong_up:false,strong_down:false,
     above_ma20:true,above_ma60:index<8,ma20_rising:true,ma60_rising:index<7,new_high_20:index<6,new_low_20:index===9,
     ma60_breakout:false,ma60_breakdown:false,distance_ma20_pct:2,distance_ma60_pct:3-index/4,ma20_slope_pct:.12,ma60_slope_pct:.08,
   })),
   ...['CSI 300','CSI 500','CSI 1000','CNI 2000'].map((name,index)=>({
     provider:'baostock',trade_date:'2026-07-28',calculation_id:'pulse-calc-2026-07-28',member_type:'broad_index',
     market:index===3?'SZ':'SH',code:['000300','000905','000852','399303'][index],name,theme_group:'',close:3000+index,
     return_1d:.5,return_5d:2,direction_1d:1,direction_5d:1,strong_up:false,strong_down:false,
     above_ma20:true,above_ma60:index<3,ma20_rising:true,ma60_rising:index!==2,new_high_20:false,new_low_20:false,
     ma60_breakout:false,ma60_breakdown:false,distance_ma20_pct:1,distance_ma60_pct:2,ma20_slope_pct:.05,ma60_slope_pct:.03,
    })),
  ];
  const marketContextMock={
    date:'2026-07-28',
    fail:new Set(),
    requests:{MARKET_PULSE:0,SECTOR_INDEX:0,EQUITY_ETF:0,CROSS_ASSET:0},
  };
  window.__marketContextMock=marketContextMock;
  const datedRows=(rows,scope)=>rows.map((row,index)=>index===0?{
    ...row,
    trade_date:marketContextMock.date,
    ...(scope==='MARKET_PULSE'?{calculation_id:'pulse-calc-'+marketContextMock.date}:{}),
  }:row);
  function builder(table){
   const filters={};
   let requestedLimit=0;
   let searchTerm='';
   return {
     select(){return this},eq(column,value){filters[column]=value;return this},gt(column,value){filters[column]={op:'gt',value};return this},lt(column,value){filters[column]={op:'lt',value};return this},
     or(value){searchTerm=String(value).match(/name\.ilike\.%(.*?)%/)?.[1]||'';return this},limit(value){requestedLimit=value;return this},
      order(){
        if(table==='market_daily_bar')window.__marketDailyBarOrders=(window.__marketDailyBarOrders||0)+1;
        if(table==='market_pulse_member_snapshot')return this;
        if(table==='market_pulse_snapshot'){
          marketContextMock.requests.MARKET_PULSE+=1;
          if(marketContextMock.fail.has('MARKET_PULSE'))return Promise.resolve({data:null,error:{message:'Mock Pulse refresh failure'}});
          const rows=datedRows(pulseSnapshots,'MARKET_PULSE');
          return Promise.resolve({data:requestedLimit===1?[rows[0]]:rows,error:null});
        }
        if(table==='market_etf_radar_snapshot'){
          window.__etfRadarOrders=window.__etfRadarOrders||{};
          window.__etfRadarOrders[filters.scope]=(window.__etfRadarOrders[filters.scope]||0)+1;
          marketContextMock.requests[filters.scope]+=1;
          if(marketContextMock.fail.has(filters.scope))return Promise.resolve({data:null,error:{message:'Mock '+filters.scope+' refresh failure'}});
          const rows=datedRows(etfRadarSnapshots[filters.scope]||[],filters.scope);
          return Promise.resolve({data:requestedLimit===1?[rows[0]]:rows,error:null});
        }
        if(table==='market_index_radar_snapshot'){
          marketContextMock.requests.SECTOR_INDEX+=1;
          if(marketContextMock.fail.has('SECTOR_INDEX'))return Promise.resolve({data:null,error:{message:'Mock Sector refresh failure'}});
          const rows=datedRows(radarSnapshots,'SECTOR_INDEX');
          return Promise.resolve({data:requestedLimit===1?[rows[0]]:rows,error:null});
        }
        return Promise.resolve({data:table==='market_daily_bar'&&filters.code==='300657'?marketRows:[],error:null});
     },
     range(from,to){
       let rows=pulseMembers.filter(row=>Object.entries(filters).every(([column,expected])=>{
         if(column==='provider')return row.provider===expected;
         if(expected&&typeof expected==='object')return expected.op==='gt'?Number(row[column])>expected.value:Number(row[column])<expected.value;
         return row[column]===expected;
       }));
       if(searchTerm){const term=searchTerm.toLowerCase();rows=rows.filter(row=>row.name.toLowerCase().includes(term)||row.code.includes(term));}
       return Promise.resolve({data:rows.slice(from,to+1),count:rows.length,error:null});
     },
      single(){
        window.__workspaceCloudReads=window.__workspaceCloudReads||{};
        window.__workspaceCloudReads[table]=(window.__workspaceCloudReads[table]||0)+1;
        const seeded=window.__workspaceCloudSeed&&Object.prototype.hasOwnProperty.call(window.__workspaceCloudSeed,table)
          ? window.__workspaceCloudSeed[table] : null;
        const forcedError=window.__workspaceCloudFailures&&window.__workspaceCloudFailures[table];
        if(forcedError)return Promise.resolve({data:null,error:{message:String(forcedError)}});
        return seeded?Promise.resolve({data:seeded,error:null}):Promise.resolve({data:null,error:{code:'PGRST116'}});
      },
      maybeSingle(){return Promise.resolve({data:table==='market_sync_checkpoint'?{last_status:'ok',latest_trade_date:'2026-07-28'}:null,error:null})},
      upsert(payload){
        window.__workspaceCloudUpserts=window.__workspaceCloudUpserts||{};
        window.__workspaceCloudUpserts[table]=payload;
        const forcedError=window.__workspaceCloudFailures&&window.__workspaceCloudFailures[table];
        return Promise.resolve(forcedError?{data:null,error:{message:String(forcedError)}}:{data:null,error:null});
      }
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

test('Market Pulse is the default official-close context with chart, guide and paged members', async ({ page }, testInfo) => {
  await page.goto('/Terminal.html?tab=v6');
  const context=page.locator('#indexRadar');
  const mode=context.locator('[data-market-radar-scope="MARKET_PULSE"]');
  await expect(mode).toHaveAttribute('aria-selected','true');
  await expect(context.locator('#indexRadarTitle')).toHaveText('FIBO MARKET PULSE · MARKET BREADTH');
  await expect(context.locator('#indexRadarStatus')).toContainText('Official Close');
  await expect(context.locator('#indexRadarStatus')).toContainText('2026-07-28');
  const cards=context.locator('[data-market-pulse-group]');
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(0)).toContainText('Participation');
  await expect(cards.nth(1)).toContainText('Trend Breadth');
  await expect(cards.nth(2)).toContainText('MA60 BO');
  await expect(cards.nth(3)).toContainText('Broad Confirm');
  await expect(context.locator('#marketPulseChart')).toBeVisible();
  await expect(context.locator('#marketPulseChart')).toHaveAttribute('aria-label',/60 official sessions/);
  await expect(context.locator('#marketPulseChart')).toHaveAttribute('aria-label',/Hot is 60.*Wind is 40.*Cold is 20/);
  await expect(context.locator('.market-pulse-chart__meta')).toHaveCount(0);
  await expect(context.locator('.market-pulse-chart__coverage')).toHaveText('History 60/60');
  const pulseFooter=context.locator('.market-pulse-chart__footer');
  await expect(pulseFooter).toContainText('2026-07-28');
  await expect(pulseFooter.locator('.market-pulse-chart__gates')).toHaveAttribute('aria-label','Hot 60; Wind 40; Cold 20');
  await expect(pulseFooter).toContainText('60 · Hot');
  await expect(pulseFooter).toContainText('40 · Wind');
  await expect(pulseFooter).toContainText('20 · Cold');
  const gatePresentation=await context.evaluate(node=>Object.fromEntries(['hot','wind','cold'].map(key=>{
    const gate=node.querySelector(`.market-pulse-chart__gate--${key}`);
    const full=gate.querySelector('.market-pulse-chart__gate-full');
    const short=gate.querySelector('.market-pulse-chart__gate-short');
    return [key,{color:getComputedStyle(gate).color,full:getComputedStyle(full).display,short:getComputedStyle(short).display}];
  })));
  expect(gatePresentation.hot.color).toBe('rgb(52, 168, 83)');
  expect(gatePresentation.wind.color).toBe('rgb(251, 188, 5)');
  expect(gatePresentation.cold.color).toBe('rgb(234, 67, 53)');
  for(const presentation of Object.values(gatePresentation)){
    expect(presentation.full==='none').toBe(testInfo.project.name==='iphone');
    expect(presentation.short==='none').toBe(testInfo.project.name!=='iphone');
  }
  const pulseChart=context.locator('#marketPulseChart');
  await pulseChart.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(pulseChart).toHaveAttribute('aria-label',/Participation 72\.0.*Leadership 75\.0/);
  if(testInfo.project.name==='iphone'){
    await pulseChart.tap({position:{x:120,y:80}});
    await expect(pulseChart).toHaveAttribute('aria-label',/Pulse .*Participation 72\.0/);
  }else{
    const chartBox=await pulseChart.boundingBox();
    await page.mouse.move(chartBox.x+chartBox.width/2,chartBox.y+chartBox.height/2);
    await expect(context.locator('#marketPulseChartTooltip')).toBeVisible();
    await expect(context.locator('#marketPulseChartTooltip')).toContainText('P 72.0');
    await expect(context.locator('#marketPulseChartTooltip')).toContainText('L 75.0');
  }

  const pulseGeometry=await context.evaluate(node=>{
    const viewport=node.querySelector('.market-pulse-cards-viewport');
    const grid=node.querySelector('.market-pulse-card-grid');
    const chart=node.querySelector('.market-pulse-chart-card');
    const cardRects=[...node.querySelectorAll('[data-market-pulse-group]')].map(card=>card.getBoundingClientRect());
    return {
      snap:getComputedStyle(viewport).scrollSnapType,
      overflow:viewport.scrollWidth-viewport.clientWidth,
      rows:new Set(cardRects.map(rect=>Math.round(rect.top))).size,
      gridHeight:grid.getBoundingClientRect().height,
      chartHeight:chart.getBoundingClientRect().height,
      chartOverflow:chart.scrollHeight-chart.clientHeight,
      dashboardHeight:node.querySelector('.market-pulse-dashboard').getBoundingClientRect().height,
      pageOverflow:document.documentElement.scrollWidth-window.innerWidth,
    };
  });
  if(testInfo.project.name==='iphone'){
    expect(pulseGeometry.snap).toContain('x');
    expect(pulseGeometry.overflow).toBeGreaterThan(0);
    expect(pulseGeometry.rows).toBe(1);
    expect(Math.abs(pulseGeometry.gridHeight-148)).toBeLessThanOrEqual(1);
    expect(Math.abs(pulseGeometry.dashboardHeight-425)).toBeLessThanOrEqual(1);
  }else{
    expect(pulseGeometry.overflow).toBeLessThanOrEqual(1);
    expect(pulseGeometry.rows).toBe(1);
    expect(Math.abs(pulseGeometry.gridHeight-112)).toBeLessThanOrEqual(1);
    expect(Math.abs(pulseGeometry.dashboardHeight-516)).toBeLessThanOrEqual(1);
    expect(pulseGeometry.chartOverflow).toBeLessThanOrEqual(1);
  }
  expect(pulseGeometry.pageOverflow).toBeLessThanOrEqual(1);

  const help=context.locator('#indexRadarHelpButton');
  await help.click();
  await expect(page.locator('#indexRadarHelpTitle')).toContainText('FIBO MARKET PULSE');
  await expect(page.locator('#indexRadarHelpContent')).toContainText('Balance(P,N,E)');
  await expect(page.locator('#indexRadarHelpContent')).toContainText('Theme Group');
  await expect(page.locator('#indexRadarHelpContent')).toContainText('Hot');
  await expect(page.locator('#indexRadarHelpContent')).toContainText('Wind');
  await expect(page.locator('#indexRadarHelpContent')).toContainText('Cold');
  await expect(page.locator('#indexRadarHelpContent')).toContainText('not a probability');
  if(testInfo.project.name==='iphone'){
    const helpOverflow=await page.locator('#indexRadarHelpBackdrop .fibo-modal').evaluate(modal=>({
      modal:modal.scrollWidth-modal.clientWidth,page:document.documentElement.scrollWidth-window.innerWidth,
    }));
    expect(helpOverflow.modal).toBeLessThanOrEqual(1);
    expect(helpOverflow.page).toBeLessThanOrEqual(1);
  }
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();

  const participation=cards.first();
  await participation.click();
  await expect(page.locator('#indexRadarDetailTitle')).toContainText('Participation');
  await expect(page.locator('#marketPulseMemberStatus')).toContainText('75 members');
  await expect(page.locator('#marketPulseMemberList .market-pulse-member-row')).toHaveCount(50);
  await expect(page.locator('#marketPulsePagination')).toContainText('Page 1 / 2');
  if(testInfo.project.name==='iphone'){
    const detailGeometry=await page.locator('#indexRadarDetailBackdrop .fibo-modal').evaluate(modal=>({
      modalOverflow:modal.scrollWidth-modal.clientWidth,
      pageOverflow:document.documentElement.scrollWidth-window.innerWidth,
      filterHeights:[...modal.querySelectorAll('[data-pulse-filter]')].map(button=>button.getBoundingClientRect().height),
    }));
    expect(detailGeometry.modalOverflow).toBeLessThanOrEqual(1);
    expect(detailGeometry.pageOverflow).toBeLessThanOrEqual(1);
    expect(Math.min(...detailGeometry.filterHeights)).toBeGreaterThanOrEqual(44);
  }
  await page.locator('[data-pulse-page="1"]').click();
  await expect(page.locator('#marketPulseMemberList .market-pulse-member-row')).toHaveCount(25);
  await page.locator('#marketPulseMemberSearch').fill('Stock 075');
  await page.locator('[data-pulse-search-form]').evaluate(form=>form.requestSubmit());
  await expect(page.locator('#marketPulseMemberStatus')).toContainText('1 members');
  await expect(page.locator('#marketPulseMemberList')).toContainText('Market Stock 075');
  await page.keyboard.press('Escape');
  await expect(participation).toBeFocused();

  const leadership=cards.nth(3);
  await leadership.click();
  await page.locator('[data-pulse-filter="broad"]').click();
  await expect(page.locator('#marketPulseMemberStatus')).toContainText('4 members');
  await expect(page.locator('#marketPulseMemberList')).toContainText('CSI 300');
  await expect(page.locator('#marketPulseMemberList')).toContainText('CNI 2000');
  await page.locator('#indexRadarDetailClose').click();
});

test('Market Context keeps one responsive frame while Pulse reflows its cards and chart', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name==='iphone','Desktop-only Pulse composition');
  await page.setViewportSize({width:1024,height:900});
  await page.goto('/Terminal.html?tab=v6');
  const context=page.locator('#indexRadar');
  const pulseMode=context.locator('[data-market-radar-scope="MARKET_PULSE"]');
  const sectorMode=context.locator('[data-market-radar-scope="SECTOR_INDEX"]');
  for(const width of [1024,1280,2094]){
    await page.setViewportSize({width,height:900});
    await pulseMode.click();
    await expect(context.locator('[data-market-pulse-group]')).toHaveCount(4);
    const geometry=await context.evaluate(node=>{
      const frame=node.querySelector('#indexRadarViewport').getBoundingClientRect();
      const dashboard=node.querySelector('.market-pulse-dashboard').getBoundingClientRect();
      const grid=node.querySelector('.market-pulse-card-grid').getBoundingClientRect();
      const chart=node.querySelector('.market-pulse-chart-card');
      const chartRect=chart.getBoundingClientRect();
      const plotRect=chart.querySelector('.market-pulse-chart__plot').getBoundingClientRect();
      const footerRect=chart.querySelector('.market-pulse-chart__footer').getBoundingClientRect();
      const gateRect=chart.querySelector('.market-pulse-chart__gates').getBoundingClientRect();
      const startRect=chart.querySelector('.market-pulse-chart__date--start').getBoundingClientRect();
      const endRect=chart.querySelector('.market-pulse-chart__date--end').getBoundingClientRect();
      const cards=[...node.querySelectorAll('[data-market-pulse-group]')].map(card=>card.getBoundingClientRect());
      return {
        frameHeight:frame.height,dashboardHeight:dashboard.height,
        dashboardOverflow:node.querySelector('.market-pulse-dashboard').scrollWidth-dashboard.width,
        rows:new Set(cards.map(rect=>Math.round(rect.top))).size,
        cardOverflow:Math.max(...[...node.querySelectorAll('[data-market-pulse-group]')].map(card=>card.scrollHeight-card.clientHeight)),
        gridHeight:grid.height,gridRight:grid.right,gridBottom:grid.bottom,
        chartLeft:chartRect.left,chartTop:chartRect.top,chartHeight:chartRect.height,
        footerBelowPlot:footerRect.top>=plotRect.bottom-1,
        footerAlignment:Math.max(Math.abs(gateRect.top+gateRect.height/2-(startRect.top+startRect.height/2)),Math.abs(gateRect.top+gateRect.height/2-(endRect.top+endRect.height/2))),
        chartOverflow:chart.scrollHeight-chart.clientHeight,
        pageOverflow:document.documentElement.scrollWidth-window.innerWidth,
      };
    });
    expect(geometry.dashboardOverflow).toBeLessThanOrEqual(1);
    expect(geometry.cardOverflow).toBeLessThanOrEqual(1);
    expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
    expect(geometry.chartOverflow).toBeLessThanOrEqual(1);
    expect(geometry.footerBelowPlot).toBe(true);
    expect(geometry.footerAlignment).toBeLessThanOrEqual(2);
    if(width===1024){
      expect(geometry.rows).toBe(2);
      expect(Math.abs(geometry.dashboardHeight-616)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.gridHeight-236)).toBeLessThanOrEqual(1);
      expect(geometry.chartTop).toBeGreaterThanOrEqual(geometry.gridBottom);
    }else if(width===1280){
      expect(geometry.rows).toBe(1);
      expect(Math.abs(geometry.dashboardHeight-516)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.gridHeight-112)).toBeLessThanOrEqual(1);
      expect(geometry.chartTop).toBeGreaterThanOrEqual(geometry.gridBottom);
    }else{
      expect(geometry.rows).toBe(2);
      expect(Math.abs(geometry.dashboardHeight-236)).toBeLessThanOrEqual(1);
      expect(geometry.chartLeft).toBeGreaterThanOrEqual(geometry.gridRight);
      expect(Math.abs(geometry.chartHeight-236)).toBeLessThanOrEqual(1);
    }
    await sectorMode.click();
    await expect(context.locator('[data-index-radar-leader]')).toHaveCount(5);
    const radarFrameHeight=await context.locator('#indexRadarViewport').evaluate(node=>node.getBoundingClientRect().height);
    expect(Math.abs(radarFrameHeight-geometry.frameHeight)).toBeLessThanOrEqual(1);
  }
});

test('Look First Index Radar renders current leaders and Leadership Memory', async ({ page }, testInfo) => {
  await page.goto('/Terminal.html?tab=v6');
  const radar=page.locator('#indexRadar');
  await radar.locator('[data-market-radar-scope="SECTOR_INDEX"]').click();
  await expect(radar).toBeVisible();
  await expect(radar.locator('#indexRadarHelpButton')).toHaveCount(1);
  await expect(radar.locator('#indexRadarStatus')).toContainText('Official Close');
  await expect(radar.locator('#indexRadarStatus')).toContainText('2026-07-28');
  const cards=radar.locator('[data-index-radar-leader]');
  await expect(cards).toHaveCount(5);
  await expect(cards.first()).toContainText('国证算力基础设施');
  await expect(cards.first()).toContainText('MA60 Breakout');
  await expect(cards.first()).toContainText('13D 13×');
  await expect(cards.first()).toContainText('60D 60×');
  const memoryCards=radar.locator('[data-index-radar-memory]');
  await expect(memoryCards).toHaveCount(4);
  await expect(radar.locator('[data-index-radar-memory="yesterday"]')).toContainText('1/1 session');
  await expect(radar.locator('[data-index-radar-memory="regime60"]')).toContainText('60/60 sessions');
  const surface=await cards.first().evaluate(node=>({
    border:getComputedStyle(node).borderTopWidth,
    background:getComputedStyle(node).backgroundImage
  }));
  expect(surface.border).toBe('1px');
  expect(surface.background).not.toContain('conic-gradient');
  await expect(cards.first()).not.toHaveClass(/fibo-card--brand-ring/);

  await radar.locator('#indexRadarHelpButton').click();
  await expect(page.locator('#indexRadarHelpBackdrop')).toHaveClass(/open/);
  const guide=page.locator('#indexRadarHelpContent');
  await expect(guide).toContainText('Score = 25 × PctRank(RS5) + 30 × PctRank(RS20)');
  await expect(guide).toContainText('MA60 Reclaim Confirmed');
  await expect(guide).toContainText('Theme Group');
  await expect(guide).toContainText('Leadership Memory v1');
  await expect(guide).toContainText('5 / 4 / 3 / 2 / 1');
  await expect(guide).toContainText('Composite Signal');
  await page.keyboard.press('Escape');
  await expect(page.locator('#indexRadarHelpBackdrop')).not.toHaveClass(/open/);

  await cards.first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#indexRadarDetailBackdrop')).toHaveClass(/open/);
  await expect(page.locator('#indexRadarDetailTitle')).toContainText('#1 国证算力基础设施');
  await expect(page.locator('#indexRadarDetailContent')).toContainText('RS5 rank points');
  await expect(page.locator('#indexRadarDetailContent')).toContainText('Leadership Memory');
  await page.locator('#indexRadarDetailClose').click();

  const fastCard=radar.locator('[data-index-radar-memory="fast3"]');
  await fastCard.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#indexRadarMemoryBackdrop')).toHaveClass(/open/);
  await expect(page.locator('#indexRadarMemoryTitle')).toContainText('3D Fast');
  await expect(page.locator('#indexRadarMemoryContent')).toContainText('Complete ranking');
  await page.locator('#indexRadarMemoryClose').click();

  await radar.locator('[data-index-radar-memory="regime60"]').click();
  await expect(page.locator('#indexRadarMemoryTitle')).toContainText('60D Regime');
  await expect(page.locator('#indexRadarMemoryContent .index-radar-memory-daily-row')).toHaveCount(13);
  const expandHistory=page.locator('[data-index-radar-memory-expand]');
  await expect(expandHistory).toContainText('Show earlier 47 sessions');
  await expandHistory.click();
  await expect(page.locator('#indexRadarMemoryContent .index-radar-memory-daily-row')).toHaveCount(60);
  await page.keyboard.press('Escape');

  const geometry=await radar.evaluate(node=>{
    const leaders=node.querySelector('.index-radar-leaders-viewport');
    const memory=node.querySelector('.index-radar-memory');
    const memoryCard=node.querySelector('.index-radar-memory-card');
    return {
      leaderScrollWidth:leaders.scrollWidth,leaderClientWidth:leaders.clientWidth,leaderSnap:getComputedStyle(leaders).scrollSnapType,
      memoryScrollWidth:memory.scrollWidth,memoryClientWidth:memory.clientWidth,memorySnap:getComputedStyle(memory).scrollSnapType,
      memoryCardHeight:memoryCard.getBoundingClientRect().height,
      dashboardHeight:node.querySelector('.index-radar-dashboard').getBoundingClientRect().height,
      animated:Boolean(node.querySelector('.is-animated')),
    };
  });
  expect(geometry.animated).toBe(false);
  if(testInfo.project.name==='iphone'){
    expect(geometry.leaderScrollWidth).toBeGreaterThan(geometry.leaderClientWidth);
    expect(geometry.memoryScrollWidth).toBeGreaterThan(geometry.memoryClientWidth);
    expect(geometry.leaderSnap).toContain('x');
    expect(geometry.memorySnap).toContain('x');
    expect(geometry.memoryCardHeight).toBeGreaterThanOrEqual(44);
    expect(Math.abs(geometry.dashboardHeight-425)).toBeLessThanOrEqual(1);
  }else{
    expect(geometry.leaderScrollWidth-geometry.leaderClientWidth).toBeLessThanOrEqual(1);
    expect(geometry.memoryScrollWidth-geometry.memoryClientWidth).toBeLessThanOrEqual(1);
  }
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('Market Radar switches lazy ETF scopes without mixing cards or Memory', async ({ page }, testInfo) => {
  await page.goto('/Terminal.html?tab=v6');
  const radar=page.locator('#indexRadar');
  const modes=radar.locator('#indexRadarMode');
  const sector=modes.getByRole('tab',{name:'Sector Index'});
  const equity=modes.getByRole('tab',{name:'Equity ETF'});
  const cross=modes.getByRole('tab',{name:'Cross Asset'});
  const frameHeight=()=>radar.locator('#indexRadarViewport').evaluate(node=>node.getBoundingClientRect().height);
  await expect(modes.getByRole('tab',{name:'Market Pulse'})).toHaveAttribute('aria-selected','true');
  const sharedFrameHeight=await frameHeight();
  await expect(radar.locator('#indexRadarTitle')).toHaveText('FIBO MARKET PULSE · MARKET BREADTH');
  await sector.click();
  await expect(sector).toHaveAttribute('aria-selected','true');
  await expect(radar.locator('[data-index-radar-leader]')).toHaveCount(5);
  await expect(radar.locator('[data-index-radar-leader]').first()).not.toHaveClass(/fibo-card--brand-ring/);
  const sectorCardGeometry=await radar.locator('[data-index-radar-leader]').first().evaluate(card=>({
    height:card.getBoundingClientRect().height,minHeight:getComputedStyle(card).minHeight,
  }));
  expect(Math.abs(await frameHeight()-sharedFrameHeight)).toBeLessThanOrEqual(1);
  await expect(radar.locator('#indexRadarTitle')).toHaveText('INDEX RADAR · SECTOR LEADERS');

  await equity.click();
  await expect(equity).toHaveAttribute('aria-selected','true');
  await expect(radar.locator('#indexRadarTitle')).toHaveText('ETF RADAR · EQUITY LEADERS');
  await expect(radar.locator('[data-index-radar-leader]')).toHaveCount(5);
  await expect(radar.locator('[data-index-radar-leader]').first()).not.toHaveClass(/fibo-card--brand-ring/);
  await expect(radar.locator('[data-index-radar-leader]').first()).toContainText('CSI 300 ETF');
  await expect(radar.locator('[data-index-radar-leader]').first()).toContainText('RS5');
  await expect(radar.locator('[data-index-radar-leader]').first()).toContainText('RS20');
  await expect(radar.locator('[data-index-radar-memory]')).toHaveCount(4);
  expect(Math.abs(await frameHeight()-sharedFrameHeight)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(()=>window.__etfRadarOrders?.EQUITY_ETF)).toBe(2);

  await radar.locator('#indexRadarHelpButton').click();
  await expect(page.locator('#indexRadarHelpTitle')).toContainText('EQUITY ETF');
  await expect(page.locator('#indexRadarHelpContent')).toContainText('RMB 20 million');
  await expect(page.locator('#indexRadarHelpContent')).toContainText('not fund flow');
  await page.locator('#indexRadarHelpClose').click();
  await radar.locator('[data-index-radar-leader]').first().click();
  await expect(page.locator('#indexRadarDetailContent')).toContainText('ETF representative');
  await expect(page.locator('#indexRadarDetailContent')).toContainText('20D avg amount');
  await page.locator('#indexRadarDetailClose').click();

  await equity.focus();
  await page.keyboard.press('ArrowRight');
  await expect(cross).toHaveAttribute('aria-selected','true');
  await expect(radar.locator('#indexRadarTitle')).toHaveText('ETF RADAR · CROSS-ASSET LEADERS');
  await expect(radar.locator('.index-radar-category')).toHaveCount(5);
  await expect(radar.locator('[data-index-radar-leader]').first()).not.toHaveClass(/fibo-card--brand-ring/);
  expect(Math.abs(await frameHeight()-sharedFrameHeight)).toBeLessThanOrEqual(1);
  await expect(radar.locator('.index-radar-category').first()).toContainText('Overseas');
  expect(await page.evaluate(()=>window.__etfRadarOrders?.CROSS_ASSET)).toBe(2);

  await equity.click();
  await expect(radar.locator('[data-index-radar-leader]').first()).toContainText('CSI 300 ETF');
  expect(await page.evaluate(()=>window.__etfRadarOrders?.EQUITY_ETF)).toBe(2);
  await sector.click();
  await expect(radar.locator('[data-index-radar-leader]')).toHaveCount(5);
  const restoredSectorGeometry=await radar.locator('[data-index-radar-leader]').first().evaluate(card=>({
    height:card.getBoundingClientRect().height,minHeight:getComputedStyle(card).minHeight,
  }));
  expect(Math.abs(restoredSectorGeometry.height-sectorCardGeometry.height)).toBeLessThanOrEqual(1);
  expect(restoredSectorGeometry.minHeight).toBe(sectorCardGeometry.minHeight);
  await expect(radar.locator('.market-pulse-dashboard')).toHaveCount(0);
  const geometry=await modes.evaluate(node=>({
    height:[...node.querySelectorAll('button')].map(button=>button.getBoundingClientRect().height),
    pageOverflow:document.documentElement.scrollWidth-window.innerWidth,
  }));
  if(testInfo.project.name==='iphone') expect(Math.min(...geometry.height)).toBeGreaterThanOrEqual(44);
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
});

test('Market Context refreshes stale active caches and retains cards after a background failure', async ({ page }) => {
  await page.goto('/Terminal.html?tab=v6');
  const context=page.locator('#indexRadar');
  await expect(context.locator('#indexRadarStatus')).toContainText('2026-07-28');
  const initialNow=await page.evaluate(()=>Date.now());
  const initialRequests=await page.evaluate(()=>({...window.__marketContextMock.requests}));
  expect(initialRequests.MARKET_PULSE).toBe(2);
  expect(initialRequests.SECTOR_INDEX).toBe(0);

  await page.evaluate(({now})=>{
    window.__marketContextMock.date='2026-07-29';
    Date.now=()=>now;
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  },{now:initialNow+24*60*60*1000});
  await expect(context.locator('#indexRadarStatus')).toContainText('2026-07-29');
  await expect.poll(()=>page.evaluate(()=>window.__marketContextMock.requests.MARKET_PULSE)).toBe(4);
  expect(await page.evaluate(()=>window.__marketContextMock.requests.SECTOR_INDEX)).toBe(0);

  await context.locator('[data-market-radar-scope="SECTOR_INDEX"]').click();
  await expect(context.locator('#indexRadarStatus')).toContainText('2026-07-29');
  await expect(context.locator('[data-index-radar-leader]')).toHaveCount(5);
  await expect.poll(()=>page.evaluate(()=>window.__marketContextMock.requests.SECTOR_INDEX)).toBe(2);

  await page.evaluate(({now})=>{
    window.__marketContextMock.date='2026-07-30';
    window.__marketContextMock.fail.add('SECTOR_INDEX');
    Date.now=()=>now;
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  },{now:initialNow+24*60*60*1000+5*60*1000});
  await expect(context.locator('#indexRadarStatus')).toContainText('Refresh failed · cached close retained');
  await expect(context.locator('#indexRadarStatus')).toContainText('2026-07-29');
  await expect(context.locator('[data-index-radar-leader]')).toHaveCount(5);
  await expect.poll(()=>page.evaluate(()=>window.__marketContextMock.requests.SECTOR_INDEX)).toBe(4);

  await page.evaluate(()=>{
    window.__marketContextMock.fail.delete('SECTOR_INDEX');
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(context.locator('#indexRadarStatus')).toContainText('2026-07-30');
  await expect(context.locator('#indexRadarStatus')).not.toContainText('Refresh failed');
  await expect.poll(()=>page.evaluate(()=>window.__marketContextMock.requests.SECTOR_INDEX)).toBe(6);

  await context.locator('[data-market-radar-scope="MARKET_PULSE"]').click();
  await expect(context.locator('#indexRadarStatus')).toContainText('2026-07-30');
  await expect.poll(()=>page.evaluate(()=>window.__marketContextMock.requests.MARKET_PULSE)).toBe(6);
  const untouched=await page.evaluate(()=>({
    equity:window.__marketContextMock.requests.EQUITY_ETF,
    cross:window.__marketContextMock.requests.CROSS_ASSET,
    overflow:document.documentElement.scrollWidth-window.innerWidth,
  }));
  expect(untouched).toEqual({equity:0,cross:0,overflow:0});
});

test('Radar desktop breakpoints never require horizontal navigation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name==='iphone','Desktop-only responsive geometry');
  await page.setViewportSize({width:1024,height:900});
  await page.goto('/Terminal.html?tab=v6');
  const radar=page.locator('#indexRadar');
  await radar.locator('[data-market-radar-scope="SECTOR_INDEX"]').click();
  await expect(radar.locator('[data-index-radar-leader]')).toHaveCount(5);
  for(const width of [1024,1280,2048]){
    await page.setViewportSize({width,height:900});
    const geometry=await radar.evaluate(node=>{
      const dashboard=node.querySelector('.index-radar-dashboard').getBoundingClientRect();
      const leaders=node.querySelector('.index-radar-leaders-viewport');
      const memory=node.querySelector('.index-radar-memory');
      const leaderCards=[...node.querySelectorAll('[data-index-radar-leader]')].map(card=>card.getBoundingClientRect());
      const memoryRect=memory.getBoundingClientRect();
      return {
        dashboardWidth:dashboard.width,dashboardHeight:dashboard.height,
        dashboardScrollWidth:node.querySelector('.index-radar-dashboard').scrollWidth,
        leaderOverflow:leaders.scrollWidth-leaders.clientWidth,
        memoryOverflow:memory.scrollWidth-memory.clientWidth,
        leaderRows:new Set(leaderCards.map(rect=>Math.round(rect.top))).size,
        leaderRight:Math.max(...leaderCards.map(rect=>rect.right)),
        memoryLeft:memoryRect.left,
        memoryTop:memoryRect.top,
        leaderTop:leaderCards[0].top,
      };
    });
    expect(geometry.dashboardScrollWidth-geometry.dashboardWidth).toBeLessThanOrEqual(1);
    expect(geometry.leaderOverflow).toBeLessThanOrEqual(1);
    expect(geometry.memoryOverflow).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.dashboardHeight-(width===1024?616:width===1280?516:236))).toBeLessThanOrEqual(1);
    if(width===2048){
      expect(geometry.leaderRows).toBe(1);
      expect(geometry.memoryLeft).toBeGreaterThanOrEqual(geometry.leaderRight);
      expect(Math.abs(geometry.memoryTop-geometry.leaderTop)).toBeLessThanOrEqual(2);
    }else{
      expect(geometry.memoryTop).toBeGreaterThan(geometry.leaderTop);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
  }
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

test('Look First keeps compact desktop columns and full-size mobile Prev Close controls', async ({ page },testInfo) => {
  await page.goto('/Terminal.html?tab=v6');
  const row=page.locator('#tableBodyV6 tr[data-instrument-id="e2e-a"]');
  const previous=row.locator('.previous');
  const mode=row.locator('.previous-mode-button');
  const baseline=row.locator('.baseline');
  await expect(page.locator('#tab-v6 thead .col-baseline')).toContainText('% Base');
  await mode.click();
  await expect(previous).toHaveJSProperty('readOnly',false);
  await previous.fill('3809.66');
  await baseline.selectOption('previous');
  await expect(baseline.locator('option:checked')).toHaveText('Prev');
  await expect.poll(()=>page.evaluate(()=>{
    const saved=JSON.parse(localStorage.getItem('tv_lookfirst_data_v3')).find(item=>item.id==='e2e-a');
    return [saved.p,saved.b];
  })).toEqual(['3809.66','previous']);

  const geometry=await row.evaluate(node=>{
    const shell=node.querySelector('.previous-shell');
    const input=node.querySelector('.previous');
    const button=node.querySelector('.previous-mode-button');
    const select=node.querySelector('.baseline');
    const shellBox=shell.getBoundingClientRect(),inputBox=input.getBoundingClientRect(),buttonBox=button.getBoundingClientRect(),selectBox=select.getBoundingClientRect();
    const inputStyle=getComputedStyle(input);
    const canvas=document.createElement('canvas');
    const context=canvas.getContext('2d');
    context.font=`${inputStyle.fontWeight} ${inputStyle.fontSize} ${inputStyle.fontFamily}`;
    const horizontalPadding=parseFloat(inputStyle.paddingLeft)+parseFloat(inputStyle.paddingRight);
    return {
      shellWidth:shellBox.width,inputWidth:inputBox.width,buttonWidth:buttonBox.width,buttonHeight:buttonBox.height,
      baselineWidth:selectBox.width,gap:buttonBox.left-inputBox.right,noOverlap:inputBox.right<=buttonBox.left,
      textWidth:context.measureText('3809.66').width,availableTextWidth:input.clientWidth-horizontalPadding,
      pageOverflow:document.documentElement.scrollWidth-window.innerWidth
    };
  });
  expect(geometry.noOverlap).toBe(true);
  expect(geometry.textWidth).toBeLessThanOrEqual(geometry.availableTextWidth);
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
  if(testInfo.project.name==='desktop-chromium'){
    expect(geometry.shellWidth).toBeCloseTo(100,0);
    expect(geometry.inputWidth).toBeCloseTo(72,0);
    expect(geometry.buttonWidth).toBeCloseTo(25,0);
    expect(geometry.gap).toBeCloseTo(3,0);
    expect(geometry.baselineWidth).toBeCloseTo(82,0);
  }else{
    expect(geometry.shellWidth).toBeGreaterThan(100);
    expect(geometry.inputWidth).toBeGreaterThan(72);
    expect(geometry.buttonWidth).toBeGreaterThanOrEqual(44);
    expect(geometry.buttonHeight).toBeGreaterThanOrEqual(44);
  }
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

test('Then Leap retains an instrument and its manual fields when Current is cleared', async ({ page },testInfo) => {
  await page.goto('/Terminal.html?tab=v6');
  const lookFirst=page.locator('#tableBodyV6 tr[data-instrument-id="e2e-a"]');
  await lookFirst.locator('.current').fill('');
  await page.locator('#btn-v7').click();

  let row=page.locator('#tableBodyV7 tr[data-instrument-id="e2e-a"]');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveClass(/is-current-missing/);
  await expect(row.locator('.current-proxy')).toHaveValue('');
  await expect(row.locator('.current-proxy')).toHaveAttribute('aria-invalid','true');
  await expect(row.locator('.market-summary')).toContainText('Current required');
  await expect(row.locator('.support-cell')).toHaveText('-');
  await expect(row.locator('.pressure-cell')).toHaveText('-');
  await expect(row.locator('.rr-cell')).toHaveText('-');
  await expect(row.locator('.ai-cell')).toContainText('Current Required');
  await expect(row.locator('.rsi')).toHaveValue('50');
  await expect(row.locator('.volume-ratio')).toHaveValue('1');
  await expect(row.locator('.stop')).toHaveValue('60');
  await expect(row.locator('.target1')).toHaveValue('75');
  await expect(row.locator('.target')).toHaveValue('100');
  if(testInfo.project.name==='iphone')await expect(row.locator('.mobile-signal-summary')).toContainText('Current Required');

  const sameTicker=page.locator('#tableBodyV7 tr[data-instrument-id="e2e-b"]');
  await expect(sameTicker).not.toHaveClass(/is-current-missing/);
  await expect(sameTicker.locator('.current-proxy')).toHaveValue('60');

  await page.reload();
  row=page.locator('#tableBodyV7 tr[data-instrument-id="e2e-a"]');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveClass(/is-current-missing/);
  await expect(row.locator('.rsi')).toHaveValue('50');
  await expect(row.locator('.volume-ratio')).toHaveValue('1');
  await page.locator('#tableBodyV6 tr[data-instrument-id="e2e-a"] .current').fill('72');
  await page.locator('#btn-v7').click();
  row=page.locator('#tableBodyV7 tr[data-instrument-id="e2e-a"]');
  await expect(row).not.toHaveClass(/is-current-missing/);
  await expect(row.locator('.current-proxy')).not.toHaveAttribute('aria-invalid','true');
  await expect(row.locator('.market-summary')).not.toContainText('Current required');
  await expect(row.locator('.support-cell')).not.toHaveText('-');
});

test('Then Leap balances desktop columns without a duplicate top scrollbar', async ({ page },testInfo) => {
  await page.goto('/Terminal.html?tab=v7');
  await expect(page.locator('#v7TopScroll')).toHaveCount(0);
  if(testInfo.project.name==='iphone'){
    await page.locator('#tableBodyV7 tr.mobile-current .mobile-detail-toggle').click();
    await expect(page.locator('#tableBodyV7 tr.mobile-current .rsi')).toBeVisible();
    const mobile=await page.evaluate(()=>({
      pageOverflow:document.documentElement.scrollWidth-window.innerWidth,
      rsiHeight:document.querySelector('#tableBodyV7 tr.mobile-current .rsi')?.getBoundingClientRect().height||0,
      macdHeight:document.querySelector('#tableBodyV7 tr.mobile-current .macd')?.getBoundingClientRect().height||0,
      suggestSize:(()=>{const rect=document.querySelector('#tableBodyV7 tr.mobile-current .macd-suggest-button')?.getBoundingClientRect();return {width:rect?.width||0,height:rect?.height||0};})(),
    }));
    expect(mobile.pageOverflow).toBeLessThanOrEqual(1);
    expect(mobile.rsiHeight).toBeGreaterThanOrEqual(44);
    expect(mobile.macdHeight).toBeGreaterThanOrEqual(44);
    expect(mobile.suggestSize.width).toBeGreaterThanOrEqual(44);
    expect(mobile.suggestSize.height).toBeGreaterThanOrEqual(44);
    return;
  }

  await page.setViewportSize({width:2048,height:900});
  const row=page.locator('#tableBodyV7 tr[data-instrument-id="e2e-a"]');
  await row.locator('.rsi').fill('100');
  await row.locator('.macd').selectOption('divergence');
  const wide=await page.evaluate(()=>{
    const table=document.getElementById('v7Table');
    const card=document.getElementById('v7TableCard');
    const row=document.querySelector('#tableBodyV7 tr[data-instrument-id="e2e-a"]');
    const widths=[...row.querySelectorAll('.auto-level')].map(cell=>cell.getBoundingClientRect().width);
    return {
      pageOverflow:document.documentElement.scrollWidth-window.innerWidth,
      tableOverflow:table.scrollWidth-card.clientWidth,
      levelMax:Math.max(...widths),
      rsiCell:row.children[12].getBoundingClientRect().width,
      trendCell:row.children[11].getBoundingClientRect().width,
      macdCell:row.children[13].getBoundingClientRect().width,
      signalCell:row.children[14].getBoundingClientRect().width,
      rsiClient:row.querySelector('.rsi').clientWidth,
      macdClient:row.querySelector('.macd').getBoundingClientRect().width,
      signalOverflow:row.children[14].scrollWidth-row.children[14].clientWidth,
    };
  });
  expect(wide.pageOverflow).toBeLessThanOrEqual(1);
  expect(wide.tableOverflow).toBeLessThanOrEqual(1);
  expect(wide.levelMax).toBeLessThanOrEqual(110);
  expect(wide.rsiCell).toBeGreaterThanOrEqual(72);
  expect(wide.trendCell).toBeGreaterThanOrEqual(118);
  expect(wide.macdCell).toBeGreaterThan(wide.signalCell);
  expect(wide.macdClient).toBeGreaterThanOrEqual(149);
  expect(wide.signalCell).toBeLessThanOrEqual(200);
  expect(wide.signalOverflow).toBeLessThanOrEqual(1);
  expect(wide.rsiClient).toBeGreaterThanOrEqual(60);

  for(const width of [1331,1280]){
    await page.setViewportSize({width,height:900});
    const narrow=await page.evaluate(()=>{
      const row=document.querySelector('#tableBodyV7 tr[data-instrument-id="e2e-a"]');
      return {
        pageOverflow:document.documentElement.scrollWidth-window.innerWidth,
        tableOverflow:document.getElementById('v7Table').scrollWidth-document.getElementById('v7TableCard').clientWidth,
        cardOverflow:getComputedStyle(document.getElementById('v7TableCard')).overflowX,
        macdCell:row.children[13].getBoundingClientRect().width,
        signalCell:row.children[14].getBoundingClientRect().width,
        macdClient:row.querySelector('.macd').getBoundingClientRect().width,
        signalOverflow:row.children[14].scrollWidth-row.children[14].clientWidth,
      };
    });
    expect(narrow.pageOverflow).toBeLessThanOrEqual(1);
    expect(narrow.tableOverflow).toBeGreaterThan(0);
    expect(['auto','scroll']).toContain(narrow.cardOverflow);
    expect(narrow.macdCell).toBeGreaterThan(narrow.signalCell);
    expect(narrow.macdClient).toBeGreaterThanOrEqual(149);
    expect(narrow.signalOverflow).toBeLessThanOrEqual(1);
  }
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
  const officialMacd=page.locator('#macdSummary [data-macd-basis="official"]');
  const previewMacd=page.locator('#macdSummary [data-macd-basis="preview"]');
  await expect(officialMacd.locator('.fibo-analysis-source')).toContainText('Official Close');
  await expect(officialMacd.locator('.fibo-analysis-source')).toContainText('2026-05-11');
  await expect(previewMacd.locator('.fibo-analysis-source')).toContainText('Current Preview');
  await expect(previewMacd.locator('.fibo-analysis-source')).toContainText('70.000');
  const officialBefore=await officialMacd.textContent();
  await expect(canvas).toHaveAttribute('aria-label',/Trend chart range 2026-01-13 to 2026-05-11\./);
  await expect(canvas).toHaveAttribute('aria-label',/High close 160\.000 on 2026-03-13\./);
  await expect(canvas).toHaveAttribute('aria-label',/Low close 80\.000 on 2026-01-22\./);
  await expect(canvas).toHaveAttribute('aria-label',/Latest close 125\.800 on 2026-05-11\./);
  await expect(canvas).toHaveAttribute('aria-label',/Current preview 70\.000\./);

  await page.locator('#trackerCurrent').fill('220');
  await expect(canvas).toHaveAttribute('aria-label',/Current preview 220\.000\./);
  await expect(canvas).toHaveAttribute('aria-label',/High close 160\.000/);
  await expect(previewMacd.locator('.fibo-analysis-source')).toContainText('220.000');
  expect(await officialMacd.textContent()).toBe(officialBefore);
  await page.locator('#trackerCurrent').fill('');
  await expect(officialMacd.locator('.fibo-analysis-source')).toContainText('Official Close');
  expect(await officialMacd.textContent()).toBe(officialBefore);
  await expect(previewMacd).toHaveClass(/is-placeholder/);
  await expect(previewMacd).toContainText('Set Current to preview');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('Tracker MA Status shows official-history Reverse Price thresholds', async ({ page },testInfo) => {
  await page.goto('/TrendTracker.html');
  const rows=page.locator('#maTableBody tr');
  await expect(rows).toHaveCount(9);
  const ma5=page.locator('#maTableBody tr[data-ma-period="5"]');
  const direction=ma5.locator('[data-ma-direction]');
  const reverse=ma5.locator('[data-reverse-price]');
  await expect(direction).toHaveText('down');
  await expect(reverse).toContainText('Up >');
  const upperTitle=await reverse.locator('.status-up').getAttribute('title');
  const upper=Number(upperTitle.match(/above ([\d.]+)/)?.[1]);
  expect(Number.isFinite(upper)).toBe(true);

  await page.locator('#trackerCurrent').fill(String(upper+1));
  await expect(direction).toHaveText('up');
  await expect(reverse).toContainText('Down <');
  const lowerTitle=await reverse.locator('.status-down').getAttribute('title');
  const lower=Number(lowerTitle.match(/below ([\d.]+)/)?.[1]);
  expect(Number.isFinite(lower)).toBe(true);

  await page.locator('#trackerCurrent').fill(String((upper+lower)/2));
  await expect(direction).toHaveText('flat');
  await expect(reverse.locator('.reverse-price-value')).toHaveCount(2);
  await expect(reverse).toContainText('Up >');
  await expect(reverse).toContainText('Down <');
  await expect(reverse.locator('.status-up')).toHaveAttribute('title',upperTitle);
  await expect(page.locator('#maTableBody tr[data-ma-period="120"] [data-reverse-price]')).not.toHaveText('—');
  await expect(page.locator('#maTableBody tr[data-ma-period="144"] [data-reverse-price]')).toHaveText('—');
  await expect(page.locator('#maTableBody tr[data-ma-period="240"] [data-reverse-price]')).toHaveText('—');

  const overflow=await page.evaluate(()=>({
    page:document.documentElement.scrollWidth-window.innerWidth,
    table:document.querySelector('#maTableBody').closest('.table-wrap').scrollWidth-document.querySelector('#maTableBody').closest('.table-wrap').clientWidth,
    overflowX:getComputedStyle(document.querySelector('#maTableBody').closest('.table-wrap')).overflowX
  }));
  expect(overflow.page).toBeLessThanOrEqual(1);
  if(testInfo.project.name==='iphone'){
    expect(overflow.table).toBeGreaterThan(0);
    expect(['auto','scroll']).toContain(overflow.overflowX);
  }
});

test('Tracker compares all Scenario paths and extends MAs for one persisted Scenario', async ({ page },testInfo) => {
  await page.goto('/TrendTracker.html');
  await expect(page.locator('#scenarioMode')).toHaveCount(0);
  const rows=page.locator('#scenarioResult .scenario-result-row');
  await expect(rows).toHaveCount(3);
  const flat=page.locator('[data-scenario="flat"]');
  const trend=page.locator('[data-scenario="trend"]');
  const custom=page.locator('[data-scenario="custom"]');
  const flatEye=page.locator('[data-scenario-visibility="flat"]');
  const trendEye=page.locator('[data-scenario-visibility="trend"]');
  const customEye=page.locator('[data-scenario-visibility="custom"]');
  const canvas=page.locator('#trackerChart');
  await expect(flat).toContainText('Flat');
  await expect(trend).toContainText('Trend continuation');
  await expect(trend).toHaveAttribute('aria-pressed','true');
  await expect(flat).toHaveAttribute('aria-pressed','false');
  await expect(custom).toHaveClass(/is-disabled/);
  await expect(custom).toBeDisabled();
  await expect(customEye).toBeDisabled();
  await expect(flatEye).toHaveAttribute('aria-pressed','true');
  await expect(trendEye).toHaveAttribute('aria-pressed','true');
  await expect(custom).toContainText('Set Target');
  await expect(page.locator('#maProjectionLegendLabel')).toHaveText('Projected MA · Trend continuation');
  await expect(canvas).toHaveAttribute('data-ma-projection-scenario','trend');
  await expect(canvas).toHaveAttribute('aria-label',/Projected moving averages use Trend continuation\./);
  await expect(canvas).toHaveAttribute('aria-label',/MA5 ends at/);
  await expect(canvas).toHaveAttribute('aria-label',/Flat forecast ends at/);
  await expect(canvas).toHaveAttribute('aria-label',/Trend continuation forecast ends at/);
  await expect(canvas).toHaveAttribute('aria-label',/Custom target is not set/);
  await expect(canvas).toHaveAttribute('data-visible-scenarios','flat,trend');

  await flat.focus();
  await page.keyboard.press('Enter');
  await expect(flat).toHaveAttribute('aria-pressed','true');
  await expect(canvas).toHaveAttribute('data-ma-projection-scenario','flat');
  await expect(page.locator('#maProjectionLegendLabel')).toHaveText('Projected MA · Flat');
  const flatSaved=await page.evaluate(()=>JSON.parse(localStorage.getItem('tv_trend_tracker_state_v1')).instruments['e2e-a'].maProjectionScenario);
  expect(flatSaved).toBe('flat');

  await flatEye.click();
  await expect(flatEye).toHaveAttribute('aria-pressed','false');
  await expect(flat).toBeDisabled();
  await expect(page.locator('#scenarioLegendFlat')).toBeHidden();
  await expect(page.locator('#maProjectionLegend')).toBeHidden();
  await expect(canvas).toHaveAttribute('data-visible-scenarios','trend');
  await expect(canvas).toHaveAttribute('data-ma-projection-periods','');
  await expect(canvas).toHaveAttribute('aria-label',/Flat forecast is hidden/);
  await expect(canvas).toHaveAttribute('aria-label',/Projected moving averages are hidden/);
  await flatEye.click();
  await expect(flat).toBeEnabled();
  await expect(flat).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#maProjectionLegend')).toBeVisible();
  await expect(canvas).toHaveAttribute('data-visible-scenarios','flat,trend');
  await expect(canvas).toHaveAttribute('data-ma-projection-periods','5,10,20,30,60,120');

  const legendPresentation=await page.evaluate(()=>({
    scenarios:Object.fromEntries(['flat','trend','custom'].map(key=>{
      const style=getComputedStyle(document.querySelector(`.scenario-line--${key}`));
      return [key,{color:style.borderTopColor,lineStyle:style.borderTopStyle}];
    })),
    projectedMa:getComputedStyle(document.querySelector('.projected-ma-line')).borderTopStyle
  }));
  expect(legendPresentation).toEqual({
    scenarios:{
      flat:{color:'rgb(66, 133, 244)',lineStyle:'solid'},
      trend:{color:'rgb(52, 168, 83)',lineStyle:'solid'},
      custom:{color:'rgb(234, 67, 53)',lineStyle:'solid'}
    },
    projectedMa:'dashed'
  });

  await page.locator('#scenarioTargetDate').fill('2026-05-12');
  await page.locator('#scenarioTargetDate').blur();
  await expect(canvas).toHaveAttribute('data-forecast-horizon','1');
  await expect(canvas).toHaveAttribute('data-forecast-ratio','0.0028');
  await page.locator('#scenarioTargetDate').fill('');
  await page.locator('#scenarioTargetDate').blur();
  await expect(canvas).toHaveAttribute('data-forecast-horizon','20');
  await expect(canvas).toHaveAttribute('data-forecast-ratio','0.0531');

  await page.locator('#scenarioHorizon').fill('13');
  await page.locator('#scenarioTarget').fill('42.96');
  await expect(custom).not.toHaveClass(/is-disabled/);
  await expect(custom).toBeEnabled();
  await expect(customEye).toBeEnabled();
  await expect(custom.locator('.scenario-result-row__numbers strong')).toContainText('Day 13: 42.960');
  await custom.click();
  await expect(custom).toHaveAttribute('aria-pressed','true');
  await expect(canvas).toHaveAttribute('data-ma-projection-scenario','custom');
  await expect(page.locator('#maProjectionLegendLabel')).toHaveText('Projected MA · Custom target');
  await expect(canvas).toHaveAttribute('aria-label',/Projected moving averages use Custom target\./);
  await expect(canvas).toHaveAttribute('aria-label',/Forecast horizon 13 trading days/);
  await expect(canvas).toHaveAttribute('aria-label',/Custom target forecast ends at 42\.960/);
  await expect(canvas).toHaveAttribute('aria-label',/beyond the lower chart edge/);
  await expect(canvas).toHaveAttribute('data-forecast-clipped',/custom:low/);
  await expect(canvas).toHaveAttribute('data-ma-projection-periods','5,10,20,30,60,120');

  await flatEye.click();
  await trendEye.click();
  await customEye.click();
  await expect(canvas).toHaveAttribute('data-visible-scenarios','');
  await expect(canvas).toHaveAttribute('data-forecast-horizon','0');
  await expect(canvas).toHaveAttribute('data-forecast-ratio','0.0000');
  await expect(canvas).toHaveAttribute('data-ma-projection-periods','');
  await expect(canvas).toHaveAttribute('aria-label',/All Scenario paths are hidden/);
  await expect(page.locator('#maProjectionLegend')).toBeHidden();
  await expect(page.locator('#scenarioLegendFlat')).toBeHidden();
  await expect(page.locator('#scenarioLegendTrend')).toBeHidden();
  await expect(page.locator('#scenarioLegendCustom')).toBeHidden();
  await customEye.click();
  await expect(custom).toBeEnabled();
  await expect(custom).toHaveAttribute('aria-pressed','true');
  await expect(canvas).toHaveAttribute('data-visible-scenarios','custom');
  await expect(canvas).toHaveAttribute('data-ma-projection-periods','5,10,20,30,60,120');
  await flatEye.click();
  await trendEye.click();
  await expect(canvas).toHaveAttribute('data-visible-scenarios','flat,trend,custom');

  const ma10=page.locator('#maToggles input[value="10"]');
  await ma10.uncheck();
  await expect(canvas).toHaveAttribute('data-ma-projection-periods','5,20,30,60,120');
  await ma10.check();
  const restoredPeriods=(await canvas.getAttribute('data-ma-projection-periods')).split(',').map(Number).sort((a,b)=>a-b);
  expect(restoredPeriods).toEqual([5,10,20,30,60,120]);

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
    state.instruments['e2e-a'].scenarioMode='flat';
    localStorage.setItem('tv_trend_tracker_state_v1',JSON.stringify(state));
  });
  await page.reload();
  await expect(page.locator('#scenarioMode')).toHaveCount(0);
  await expect(page.locator('[data-scenario="flat"]')).toBeVisible();
  await expect(page.locator('[data-scenario="trend"]')).toBeVisible();
  await expect(page.locator('[data-scenario="custom"]')).not.toHaveClass(/is-disabled/);
  await expect(page.locator('[data-scenario="custom"]')).toHaveAttribute('aria-pressed','true');
  await expect(canvas).toHaveAttribute('data-ma-projection-scenario','custom');
  await page.locator('.scenario-reset-button').click();
  await expect(page.locator('#scenarioHorizon')).toHaveValue('20');
  await expect(page.locator('#scenarioTarget')).toHaveValue('');
  await expect(page.locator('#scenarioTargetDate')).toHaveValue('');
  await expect(custom).toHaveClass(/is-disabled/);
  await expect(customEye).toBeDisabled();
  await expect(trend).toHaveAttribute('aria-pressed','true');
  await expect(canvas).toHaveAttribute('data-ma-projection-scenario','trend');
  await expect(page.locator('#maProjectionLegendLabel')).toHaveText('Projected MA · Trend continuation');
  const saved=await page.evaluate(()=>({
    tracker:JSON.parse(localStorage.getItem('tv_trend_tracker_state_v1')),
    current:JSON.parse(localStorage.getItem('tv_lookfirst_data_v3')).find(row=>row.id==='e2e-a')?.c,
    vr:JSON.parse(localStorage.getItem('tv_thenleap_data_v3')).find(row=>row.id==='e2e-a')?.v
  }));
  expect(saved.tracker.instruments['e2e-a']).toEqual({horizon:20,target:'',targetDate:'',maProjectionScenario:'trend',scenarioVisibility:{flat:true,trend:true,custom:true}});
  expect(saved.current).toBe('70');
  expect(saved.vr).toBe('1');
  expect(saved.tracker.visibleMas.length).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator('#scenarioHorizon')).toHaveValue('20');
  await expect(page.locator('#scenarioTarget')).toHaveValue('');
  await expect(page.locator('#scenarioTargetDate')).toHaveValue('');
  await expect(page.locator('#scenarioResult .scenario-result-row')).toHaveCount(3);
  await expect(page.locator('[data-scenario="trend"]')).toHaveAttribute('aria-pressed','true');
  const rowHeight=await page.locator('[data-scenario="trend"]').evaluate(node=>node.getBoundingClientRect().height);
  expect(rowHeight).toBeGreaterThanOrEqual(44);
  const eyeSize=await page.locator('[data-scenario-visibility="trend"]').evaluate(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}));
  if(testInfo.project.name==='iphone'){
    expect(eyeSize.width).toBeGreaterThanOrEqual(44);
    expect(eyeSize.height).toBeGreaterThanOrEqual(44);
  }
  await page.locator('[data-fibo-click="openTrackerHelp(\'scenario\')"]').click();
  await expect(page.locator('#trackerHelpContent')).toContainText('Scenario visibility');
  await expect(page.locator('#trackerHelpContent')).toContainText('all three eyes are closed');
  await page.locator('#trackerHelpBackdrop .fibo-modal__close').click();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('Terminal and Tracker share Current and VR by permanent ID across tabs', async ({ page,context },testInfo) => {
  await page.goto('/Terminal.html?tab=v6');
  const tracker=await context.newPage();
  await tracker.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:supabaseMock}));
  await tracker.goto('/TrendTracker.html');
  const terminalA=page.locator('#tableBodyV6 tr[data-instrument-id="e2e-a"]');
  await terminalA.locator('.current').fill('77.5');
  await expect(tracker.locator('#trackerCurrent')).toHaveValue('77.5');

  await expect(tracker.locator('#trackerVr')).toHaveValue('1');
  await page.locator('#btn-v7').click();
  const terminalThenLeap=page.locator('#tableBodyV7 tr[data-instrument-id="e2e-a"]');
  if(testInfo.project.name==='iphone')await terminalThenLeap.locator('.mobile-detail-toggle').click();
  await terminalThenLeap.locator('.volume-ratio').fill('1.4');
  await expect(tracker.locator('#trackerVr')).toHaveValue('1.4');

  await tracker.locator('#trackerVr').fill('1.8');
  await expect(terminalThenLeap.locator('.volume-ratio')).toHaveValue('1.8');
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
  const content=page.locator('#macdSuggestionContent');
  await expect(content).toContainText('Close/DIF divergence candidates');
  await expect(content).toHaveAttribute('data-macd-basis','preview');
  await expect(content.locator('.fibo-analysis-source')).toContainText('Current Preview');
  await expect(content.locator('.fibo-analysis-source')).toContainText('70.000');
  await expect(select).toHaveValue('neutral');
  await expect(page.locator('#applyMacdSuggestionButton')).toBeEnabled();
  const divergenceBefore=await content.locator('.macd-divergence-section').textContent();
  await content.getByRole('button',{name:'Official',exact:true}).click();
  await expect(content).toHaveAttribute('data-macd-basis','official');
  await expect(content.locator('.fibo-analysis-source')).toContainText('Official Close');
  await expect(content.locator('.fibo-analysis-source')).toContainText('2026-05-11');
  expect(await content.locator('.macd-divergence-section').textContent()).toBe(divergenceBefore);
  await expect(select).toHaveValue('neutral');
  const suggested=await page.locator('.macd-suggestion-summary > strong').textContent();
  await page.locator('#applyMacdSuggestionButton').click();
  const expected=suggested.includes('Bullish')?'bullish':suggested.includes('Bearish')?'bearish':'neutral';
  await expect(select).toHaveValue(expected);
  await expect(select.locator('option[value="divergence"]')).toHaveText(/Bullish Divergence/);

  await row.locator('.current-proxy').fill('');
  await row.locator('.macd-suggest-button').click();
  await expect(content).toHaveAttribute('data-macd-basis','official');
  await expect(content.getByRole('button',{name:'Preview',exact:true})).toBeDisabled();
  await expect(content.locator('.fibo-analysis-source')).toContainText('Official Close');
  await page.locator('[data-fibo-click="closeMacdSuggestion()"]:visible').first().click();
  await expect(select).toHaveValue(expected);
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
    const uploaded=await page.evaluate(()=>Object.keys(window.__workspaceCloudUpserts||{}));
    expect(uploaded).toEqual(expect.arrayContaining(['fibo_data','trend_tracker_state','market_instrument_bindings']));
    if(testInfo.project.name==='iphone'){
      await expect(page.locator(system.sheet)).toHaveClass(/open/);
      await expect(page.locator(system.sheet)).not.toHaveClass(/open/,{timeout:3500});
    }else await expect(push).toContainText('Push to Cloud',{timeout:3500});
  }
});

test('manual Pull restores the full workspace and Wave startup stays local-only', async ({ page },testInfo) => {
  await page.goto('/WaveAnalysis.html');
  expect(await page.evaluate(()=>window.__workspaceCloudReads?.fibo_data||0)).toBe(0);

  const seed={
    fibo_data:{
      user_id:'test',
      v6_data:[{id:'e2e-a',n:'CLOUD',h:'100',l:'50',c:'88',p:'87'}],
      v7_data:[{id:'e2e-a',n:'CLOUD',t:'uptrend',r:'60',m:'bullish',v:'2.2'}],
      wp_data:{activeTabId:'tab-cloud',tabs:[{id:'tab-cloud',instrumentId:'e2e-a',name:'Cloud',form:{symbolName:'Cloud'}}],instrumentPool:{version:1,items:[{id:'e2e-a',ticker:'CLOUD',code:'300657',market:'SZ'}],tombstones:[]},uiNotes:{marquee:'cloud reminder',tips:'cloud tips'}}
    },
    trend_tracker_state:{user_id:'test',state:{version:1,activeInstrumentId:'e2e-a',visibleMas:[20],instruments:{'e2e-a':{horizon:15,target:'',targetDate:'',maProjectionScenario:'trend',scenarioVisibility:{flat:true,trend:true,custom:true}}}}}
  };
  const systems=[
    {url:'Terminal.html?tab=v6',open:'openMobileActions()',sheet:'#mobileActionsBackdrop'},
    {url:'WaveAnalysis.html',open:'openWaveMobileActions()',sheet:'#waveMobileActionsBackdrop'},
    {url:'TrendTracker.html',open:'openActions()',sheet:'#trackerActionsBackdrop'}
  ];
  for(const system of systems){
    await page.goto(`/${system.url}`);
    await page.evaluate(({seed})=>{
      window.__workspaceCloudSeed=seed;
      const look=JSON.parse(localStorage.getItem('tv_lookfirst_data_v3')||'[]');
      if(look[0]){look[0].c='1';localStorage.setItem('tv_lookfirst_data_v3',JSON.stringify(look));}
    },{seed});
    let pull;
    if(testInfo.project.name==='iphone'){
      await page.locator(`[data-fibo-click="${system.open}"]`).click();
      pull=page.locator(`${system.sheet} .fibo-button--cloud-down`);
    }else pull=page.locator('.fibo-header__actions .fibo-button--cloud-down');
    await pull.click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('tv_lookfirst_data_v3')||'[]')[0]?.c==='88');
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('tv_thenleap_data_v3')||'[]')[0]?.v)).toBe('2.2');
    expect(await page.evaluate(()=>localStorage.getItem('tv_header_marquee_v1')||'')).toBe('cloud reminder');
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
  await expect(page.locator('#trackerHelpContent')).toContainText('Official Close');
  await expect(page.locator('#trackerHelpContent')).toContainText('Current Preview');
  await expect(page.locator('#trackerHelpContent')).toContainText('Reverse Price');
  await expect(page.locator('#trackerHelpContent')).toContainText('C_leave');
  await expect(page.locator('#trackerHelpContent')).toContainText('Up above');
  await expect(page.locator('#trackerHelpContent')).toContainText('Down below');
  await expect(page.locator('#trackerHelpContent')).toContainText('连续三个计算点');
  await page.locator('#trackerHelpBackdrop [data-fibo-click="closeTrackerHelp()"]' ).last().click();
  await expect(page.locator('#trackerHelpBackdrop')).not.toHaveClass(/open/);

  await helpButtons.nth(1).click();
  await expect(page.locator('#trackerHelpTitle')).toContainText('Scenario Lab');
  await expect(page.locator('#trackerHelpContent')).toContainText('Trend continuation');
  await expect(page.locator('#trackerHelpContent')).toContainText('Projected moving averages');
  await expect(page.locator('#trackerHelpContent')).toContainText('现有 SMA 公式');
  await expect(page.locator('#trackerHelpContent')).toContainText('不是独立价格预测');
  for (const state of ['Long Bull','Long Bear','Transition','Uptrend','Downtrend','Range','趋势延续','反转确认','下跌反抽','调整探底','反转观察','震荡等待']) {
    await expect(page.locator('#trackerHelpContent')).toContainText(state);
  }
  await expect(page.locator('#trackerHelpContent')).toContainText('Composite Signal');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.locator('#trackerHelpBackdrop').click({position:{x:2,y:2}});
  await expect(page.locator('#trackerHelpBackdrop')).not.toHaveClass(/open/);
});

test('Terminal MACD help explains manual confirmation and remains accessible', async ({ page }, testInfo) => {
  await page.goto('/Terminal.html?tab=v7');
  const help=page.locator(`[data-fibo-click="openHelp('macd')"]`);
  await expect(help).toHaveCount(1);
  if(testInfo.project.name==='desktop-chromium'){
    await expect(help).toBeVisible();
    const geometry=await help.evaluate(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height,borderRadius:getComputedStyle(node).borderRadius}));
    expect(geometry).toEqual({width:18,height:18,borderRadius:'50%'});
    await help.click();
  }else await help.evaluate(node=>node.click());

  const backdrop=page.locator('#helpModalBackdrop');
  const body=backdrop.locator('.note-modal-body');
  const content=page.locator('#helpModalContent');
  await expect(backdrop).toHaveClass(/open/);
  await expect(page.locator('#helpModalTitle')).toHaveText('MACD Trend · 动量状态');
  for(const text of [
    'DIF','DEA','Histogram','Bullish Divergence +2','Bullish +1','Wait/Flat 0','Bearish -1',
    '至少两项一致','双线缠绕或走平','反复交叉','负柱缩短','正柱缩短',
    'Apply Suggestion','Official Close','Current Preview','零轴下方','双线上行','正柱继续扩张','零轴上方','双线下行','负柱继续扩张','五点拐点','顶背离'
  ])await expect(content).toContainText(text);
  await expect(backdrop.locator('.note-modal-footer')).toContainText('Algorithm Guide v2.2 · 2026-08');
  const scroll=await body.evaluate(node=>({clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth}));
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
  expect(scroll.scrollWidth-scroll.clientWidth).toBeLessThanOrEqual(1);
  await body.evaluate(node=>{node.scrollTop=node.scrollHeight;});
  await expect.poll(()=>body.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await expect(backdrop).not.toHaveClass(/open/);
  if(testInfo.project.name==='desktop-chromium')await expect(help).toBeFocused();

  if(testInfo.project.name==='desktop-chromium')await help.click();
  else await help.evaluate(node=>node.click());
  await expect(backdrop).toHaveClass(/open/);
  await backdrop.locator('.note-modal-close').click();
  await expect(backdrop).not.toHaveClass(/open/);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('wave controller loads the shared Pool instrument and opens Pro Tips', async ({ page }, testInfo) => {
  await page.goto('/WaveAnalysis.html');
  await expect(page.locator('#tabs .tab').first()).toContainText('E2E');
  const tips = page.locator('[data-fibo-click="openWaveNoteEditor(\'tips\')"]:visible');
  await (testInfo.project.name === 'iphone' ? tips.last() : tips.first()).click();
  await expect(page.locator('#waveNoteModalBackdrop')).toHaveClass(/open/);
});
