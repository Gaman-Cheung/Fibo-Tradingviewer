/**
 * Trend Tracker DOM, persistence and Supabase adapter.
 * Allowed: DOM plus core/tracker modules. Forbidden: redefining Terminal/Wave algorithms.
 * Covered by: tracker unit and desktop/iPhone Playwright tests.
 */
import { bindDeclarativeEvents } from '../core/declarative-events.js';
import { getSupabaseClient } from '../core/supabase-client.js';
import { STORAGE_KEYS, ROUTES } from '../core/config.js';
import { runMigrations } from '../core/migrations.js';
import { loadInstrumentPool, saveInstrumentPool } from '../core/instrument-identity.js';
import { readArray, readJson, writeJson } from '../core/storage.js';
import { getAuthenticatedUser, loadCloudRow, upsertCloudRow } from '../core/cloud-repository.js';
import { buildCloudPayload, unpackCloudPayload } from '../core/cloud-payload.js';
import { loadDailyCloses, loadMarketSyncState, loadTrackerState, saveTrackerState, syncMarketBindings } from '../core/market-repository.js';
import { MA_PERIODS, DEFAULT_VISIBLE_MAS, analyzeTrend, appendProvisionalCurrent, projectScenario, sma } from '../tracker/trend-engine.js';
import { buildTrackerChartModel } from '../tracker/chart-model.js';

const client = getSupabaseClient('tracker');
runMigrations(localStorage);
const COLORS = ['#4285f4','#ea4335','#fbbc05','#34a853','#ab47bc','#ff6d00','#00acc1','#795548','#5f6368'];
const TRACKER_HELP_TOPICS = {
  'ma-status': {
    title:'MA Status · 均线状态与确认',
    html:`<h3>Value 与 ΔMA</h3><p><strong>Value</strong> 是最近 N 个收盘价的简单平均值。均线每日变化使用精确递推：</p><div class="formula"><code>ΔMA_N = (C_t − C_{t−N}) ÷ N</code></div><p>ΔMA 为正显示 up，为负显示 down；相对前一日均线变化不超过 0.01% 时视为 flat。</p><h3>Turn</h3><p><strong>Turn Alert</strong> 表示均线斜率刚发生第一次方向切换，只是提醒；同方向连续三个交易日才显示 <strong>Turn Confirmed</strong>。破线同样先 Watch，连续两个正式收盘价位于均线同一侧才视为 Confirmed。</p><h3>Current Preview</h3><p>手动 Current 会作为临时收盘价追加，只用于盘中预演。带有 <code>(preview)</code> 的拐头或确认不是正式收盘结论，不会改写 BaoStock 历史。</p><h3>MACD 12/26/9</h3><p>DIF 是 12 日与 26 日 EMA 的差，DEA 是 DIF 的 9 日 EMA，Histogram 表示 DIF 与 DEA 的距离；cross 描述交叉，zero axis 描述零轴上下，strength/direction 描述柱体增强或减弱。MACD 只确认 MA 结构，不建立额外评分。</p>`
  },
  scenario: {
    title:'Scenario Lab · 情景路径说明',
    html:`<h3>三种模式</h3><p><strong>Flat</strong>：未来价格保持在 Current 或最新正式收盘价。<br><strong>Trend continuation</strong>：延续近期对数收益率方向，并用近期波动率限制斜率，避免无限外推。<br><strong>Custom target</strong>：从当前基准以对数线性路径推演到手动 Target。</p><h3>输入优先级</h3><p><strong>Trading days</strong> 设置 1–240 个交易日；填写 <strong>Target date</strong> 后，系统按起止日期估算交易日并优先使用该结果。Target 仅在 Custom target 模式有效。</p><h3>波动范围</h3><div class="formula"><code>情景上下界 = 路径价格 × exp(±σ√d)</code></div><p>σ 来自近 20 个交易日的对数收益率。它只是波动情景范围，不是置信区间、概率预测或止盈目标。</p><h3>边界</h3><p>Scenario Lab 不改变 MA、MACD、Terminal Composite Signal 或任何交易评分，不构成价格承诺或买卖建议。</p>`
  }
};
let pool = loadInstrumentPool();
let history = [];
let historyDates = [];
let syncState = null;
let noteMode = 'tips';
let trackerState = normalizeTrackerState(readJson(localStorage, STORAGE_KEYS.trackerState, {}));

function normalizeTrackerState(value) {
  const state = value && typeof value === 'object' ? value : {};
  return { version:1, activeInstrumentId:String(state.activeInstrumentId || localStorage.getItem(STORAGE_KEYS.activeInstrument) || ''), visibleMas:Array.isArray(state.visibleMas) ? state.visibleMas.map(Number).filter(period => MA_PERIODS.includes(period)) : [...DEFAULT_VISIBLE_MAS], instruments:state.instruments && typeof state.instruments === 'object' ? state.instruments : {} };
}

function persistState() {
  writeJson(localStorage, STORAGE_KEYS.trackerState, trackerState);
  if (trackerState.activeInstrumentId) localStorage.setItem(STORAGE_KEYS.activeInstrument, trackerState.activeInstrumentId);
}

function currentInstrument() { return pool.items.find(item => item.id === trackerState.activeInstrumentId && item.status !== 'archived') || null; }
function instrumentState() { return trackerState.instruments[trackerState.activeInstrumentId] ||= { current:'', vr:'', scenarioMode:'flat', horizon:20, target:'', targetDate:'' }; }
function escapeHtml(value) { const div=document.createElement('div'); div.textContent=String(value ?? ''); return div.innerHTML; }

function renderMarquee() {
  const text = localStorage.getItem(STORAGE_KEYS.marquee) || '先确认长期背景，再判断当前结构；Current 只作为今日预演。';
  const node = document.getElementById('trackerMarquee');
  node.textContent = text;
  node.style.setProperty('--marquee-duration', `${Math.max(30, Math.min(120, 25 + text.length * .42))}s`);
}

function renderInstrumentPicker() {
  const active = pool.items.filter(item => item.status !== 'archived').sort((a,b)=>Number(a.order)-Number(b.order));
  if (!active.some(item => item.id === trackerState.activeInstrumentId)) trackerState.activeInstrumentId = active[0]?.id || '';
  document.getElementById('trackerInstrument').innerHTML = active.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === trackerState.activeInstrumentId ? 'selected':''}>${escapeHtml(item.ticker || 'Untitled Instrument')}</option>`).join('');
  persistState();
}

async function selectInstrument(id) {
  trackerState.activeInstrumentId = id;
  persistState();
  await loadInstrumentHistory();
}

async function loadInstrumentHistory() {
  const instrument = currentInstrument();
  history = []; historyDates = []; syncState = null;
  const setup = document.getElementById('trackerSetup');
  const content = document.getElementById('trackerContent');
  const freshnessNode = document.getElementById('trackerFreshness');
  freshnessNode.className = 'freshness'; freshnessNode.textContent = '';
  document.getElementById('trackerCode').textContent = instrument ? [instrument.code, instrument.market].filter(Boolean).join(' · ') : '';
  if (!instrument) {
    setup.hidden=false; setup.textContent='Instrument Pool 为空，请先在 Terminal 的 Pool 添加标的。'; content.hidden=true; return;
  }
  if (!['SH','SZ'].includes(instrument.market) || !/^\d{6}$/.test(String(instrument.code || ''))) {
    setup.hidden=false; setup.textContent='Trend Tracker 需要六位 Code，并在 Pool 中明确选择 Shanghai 或 Shenzhen。指数不会自动猜测交易所。'; content.hidden=true; return;
  }
  setup.hidden=true; content.hidden=false; setLoading(true);
  const saved=instrumentState();
  document.getElementById('scenarioMode').value=saved.scenarioMode || 'flat';
  document.getElementById('scenarioHorizon').value=saved.horizon || 20;
  document.getElementById('scenarioTarget').value=saved.target || '';
  document.getElementById('scenarioTargetDate').value=saved.targetDate || '';
  const [closesResponse,stateResponse] = await Promise.all([loadDailyCloses(client,instrument),loadMarketSyncState(client,instrument)]);
  setLoading(false);
  if (closesResponse.error) {
    document.getElementById('trackerFreshness').className='freshness error';
    document.getElementById('trackerFreshness').textContent=`行情读取失败：${closesResponse.error.message || '请先应用 Supabase migration 并运行 BaoStock sync'}`;
  } else {
    history=(closesResponse.data || []).map(row=>Number(row.close)).filter(Number.isFinite);
    historyDates=(closesResponse.data || []).map(row=>row.trade_date);
  }
  syncState=stateResponse.data || null;
  renderTracker();
}

function setLoading(open) { document.getElementById('trackerLoader').classList.toggle('open',open); }

function vrText(value) {
  const vr=Number(value); if (!Number.isFinite(vr)) return 'VR 未填：MA/MACD 结构仍可计算，量能确认暂缺。';
  if (vr <= .8) return '缩量：趋势确认度偏低。';
  if (vr < 1.2) return '正常量能。';
  if (vr < 1.5) return '温和放量：结合价格方向确认。';
  if (vr < 2.5) return '明显放量：趋势可能加速，也可能出现分歧。';
  return '异常放量：上涨关注加速/强分歧；下跌关注恐慌/出货风险。';
}

function updateTrackerInputs() {
  const state=instrumentState(); state.current=document.getElementById('trackerCurrent').value; state.vr=document.getElementById('trackerVr').value; persistState(); renderTracker();
}

function renderMaToggles() {
  document.getElementById('maToggles').innerHTML=MA_PERIODS.map((period,index)=>`<label class="ma-toggle" style="--ma-color:${COLORS[index]}"><input type="checkbox" value="${period}" ${trackerState.visibleMas.includes(period)?'checked':''} data-fibo-change="toggleMa(this)">MA${period}</label>`).join('');
}

function toggleMa(input) {
  const period=Number(input.value); trackerState.visibleMas=input.checked ? [...new Set([...trackerState.visibleMas,period])] : trackerState.visibleMas.filter(value=>value!==period); persistState(); renderTracker();
}

function renderTracker() {
  if (document.getElementById('trackerContent').hidden) return;
  const state=instrumentState();
  const currentInput=document.getElementById('trackerCurrent'), vrInput=document.getElementById('trackerVr');
  if (document.activeElement !== currentInput) currentInput.value=state.current ?? '';
  if (document.activeElement !== vrInput) vrInput.value=state.vr ?? '';
  const official=analyzeTrend(history);
  const previewValues=appendProvisionalCurrent(history,state.current);
  const preview=analyzeTrend(previewValues);
  document.getElementById('backgroundValue').textContent=official.background;
  document.getElementById('structureValue').textContent=official.structure;
  document.getElementById('eventValue').textContent=official.event;
  document.getElementById('profileValue').textContent=`Focus MA ${preview.profile.focus.join(' / ')}`;
  document.getElementById('vrInterpretation').textContent=vrText(state.vr);
  const freshness=document.getElementById('trackerFreshness');
  if (syncState?.last_status === 'error') {
    freshness.className='freshness error';
    freshness.textContent=`数据截至 ${historyDates.at(-1) || '--'}；最近同步失败：${syncState.last_error || 'unknown error'}`;
  } else if (!freshness.classList.contains('error')) freshness.textContent=history.length ? `Official close: ${historyDates.at(-1)} · ${history.length} sessions · Sync: ${syncState?.last_status || 'unknown'}${state.current ? ' · Current preview active':''}` : '暂无行情历史；请运行 BaoStock Sync。';
  renderMaToggles();
  document.getElementById('maTableBody').innerHTML=MA_PERIODS.map(period=>{
    const item=preview.ma[period], turn=preview.turns[`ma${period}`];
    const turnText=turn ? (turn.confirmed?'Turn Confirmed':turn.alert?'Turn Alert':'—') : '—';
    return `<tr><td>MA${period}</td><td>${Number.isFinite(item.value)?item.value.toFixed(3):'--'}</td><td>${Number.isFinite(item.delta)?item.delta.toFixed(4):'--'}</td><td class="status-${item.direction}">${item.direction}</td><td>${turnText}${state.current && (turn?.alert||turn?.confirmed)?' (preview)':''}</td></tr>`;
  }).join('');
  document.getElementById('macdSummary').innerHTML=`<strong>MACD 12/26/9</strong><br>DIF ${format(preview.macd.dif)} · DEA ${format(preview.macd.dea)} · Histogram ${format(preview.macd.histogram)}<br>${preview.macd.cross} cross · ${preview.macd.zeroAxis} zero axis · ${preview.macd.direction}`;
  const mode=document.getElementById('scenarioMode').value, target=document.getElementById('scenarioTarget').value, targetDate=document.getElementById('scenarioTargetDate').value;
  const manualHorizon=Number(document.getElementById('scenarioHorizon').value)||20;
  const horizon=targetDate ? businessDaysUntil(historyDates.at(-1),targetDate) : manualHorizon;
  Object.assign(state,{scenarioMode:mode,horizon:manualHorizon,target,targetDate}); persistState();
  const projection=projectScenario(previewValues,{mode,horizon,target});
  const end=projection.path.at(-1), lower=projection.lower.at(-1), upper=projection.upper.at(-1), endAnalysis=projection.analyses.at(-1);
  document.getElementById('scenarioResult').innerHTML=end ? `<strong>${targetDate || `Day ${projection.path.length}`}: ${end.toFixed(3)}</strong><br>Volatility range ${lower.toFixed(3)} – ${upper.toFixed(3)}<br>${endAnalysis.background} · ${endAnalysis.structure} · ${endAnalysis.event}` : '历史数据不足。';
  drawChart(previewValues,historyDates,state.current !== '',projection);
}

function format(value) { return Number.isFinite(value) ? value.toFixed(4) : '--'; }

function businessDaysUntil(startValue,targetValue) {
  const start=startValue ? new Date(`${startValue}T00:00:00`) : new Date();
  const target=new Date(`${targetValue}T00:00:00`);
  if (!Number.isFinite(target.getTime()) || target<=start) return 1;
  let days=0,cursor=new Date(start); while(cursor<target&&days<240){cursor.setDate(cursor.getDate()+1);if(cursor.getDay()!==0&&cursor.getDay()!==6)days+=1;}
  return Math.max(1,days);
}

function drawChart(values,dates,hasPreview,projection) {
  const canvas=document.getElementById('trackerChart'), rect=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
  canvas.width=Math.max(1,Math.round(rect.width*dpr)); canvas.height=Math.max(1,Math.round(rect.height*dpr));
  const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr); const width=rect.width,height=rect.height;
  const chart=buildTrackerChartModel(values,dates,{hasPreview});
  canvas.setAttribute('aria-label',chart.ariaLabel);
  if (!chart.points.length) return;
  const plot={left:32,right:width-32,top:34,bottom:height-44};
  const closeValues=chart.points.map(point=>point.value);
  const maSeries=trackerState.visibleMas.map(period=>({
    values:chart.points.map(point=>sma(values.slice(0,point.sourceIndex+1),period)),
    color:COLORS[MA_PERIODS.indexOf(period)], width:1.25
  }));
  const numbers=[...closeValues,...maSeries.flatMap(item=>item.values)].filter(Number.isFinite); if(!numbers.length)return;
  let min=Math.min(...numbers),max=Math.max(...numbers); const margin=(max-min||max*.02||1)*.08; min-=margin;max+=margin;
  const x=index=>plot.left+(plot.right-plot.left)*index/Math.max(1,chart.points.length-1);
  const y=value=>plot.top+(max-value)/(max-min)*(plot.bottom-plot.top);

  ctx.strokeStyle='#e8eaed';ctx.lineWidth=1;
  for(let i=0;i<5;i++){const gridY=plot.top+(plot.bottom-plot.top)*i/4;ctx.beginPath();ctx.moveTo(plot.left,gridY);ctx.lineTo(plot.right,gridY);ctx.stroke();}

  const officialPoints=chart.points.filter(point=>!point.isPreview);
  ctx.strokeStyle='#202124';ctx.lineWidth=2;ctx.beginPath();
  officialPoints.forEach((point,index)=>{const px=x(point.index),py=y(point.value);if(index===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);});ctx.stroke();
  if(chart.preview&&officialPoints.length){const latest=officialPoints.at(-1);ctx.save();ctx.strokeStyle='#5f6368';ctx.lineWidth=2;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(x(latest.index),y(latest.value));ctx.lineTo(x(chart.preview.index),y(chart.preview.value));ctx.stroke();ctx.restore();}

  maSeries.forEach(item=>{ctx.strokeStyle=item.color;ctx.lineWidth=item.width;ctx.beginPath();let started=false;item.values.forEach((value,index)=>{if(!Number.isFinite(value))return;const px=x(index),py=y(value);if(!started){ctx.moveTo(px,py);started=true}else ctx.lineTo(px,py);});ctx.stroke();});

  if(projection?.path?.length){const start=closeValues.at(-1),step=(plot.right-plot.left)/Math.max(1,chart.points.length-1);ctx.strokeStyle='#9aa0a6';ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(plot.right,y(start));projection.path.slice(0,20).forEach((value,index)=>ctx.lineTo(plot.right+step*(index+1)/4,y(value)));ctx.stroke();ctx.setLineDash([]);}

  const placed=[];
  chart.markers.forEach(marker=>drawChartCallout(ctx,{...marker,x:x(marker.index),y:y(marker.value)},plot,placed));
  if(chart.preview)drawChartCallout(ctx,{...chart.preview,label:'Preview',kinds:['preview'],x:x(chart.preview.index),y:y(chart.preview.value)},plot,placed);

  ctx.fillStyle='#5f6368';ctx.font='10px Arial, sans-serif';ctx.textBaseline='bottom';
  ctx.textAlign='left';ctx.fillText(chart.startDate||'--',plot.left,height-8);
  ctx.textAlign='right';ctx.fillText(chart.endDate||'--',plot.right,height-8);
}

function drawChartCallout(ctx,marker,plot,placed) {
  const color=marker.kinds.includes('preview')?'#5f6368':marker.kinds.includes('low')?'#d93025':marker.kinds.includes('high')?'#188038':'#202124';
  const title=`${marker.label} · ${Number(marker.value).toFixed(3)}`, subtitle=marker.date||'';
  ctx.save();ctx.font='700 10px Arial, sans-serif';
  const width=Math.min(176,Math.max(88,ctx.measureText(title).width+14,subtitle?ctx.measureText(subtitle).width+14:0));
  const height=subtitle?36:24;
  let left=marker.x>=(plot.left+plot.right)/2?marker.x-width-8:marker.x+8;
  let top=marker.kinds.includes('low')||marker.kinds.includes('preview')?marker.y+8:marker.y-height-8;
  left=Math.max(plot.left,Math.min(plot.right-width,left)); top=Math.max(4,Math.min(plot.bottom-height,top));
  const overlaps=rect=>placed.some(item=>!(rect.left+rect.width+3<item.left||item.left+item.width+3<rect.left||rect.top+rect.height+3<item.top||item.top+item.height+3<rect.top));
  let rect={left,top,width,height};
  if(overlaps(rect)) {
    const candidates=[marker.y+8,marker.y-height-8];
    for(let lane=4;lane+height<=plot.bottom;lane+=height+4)candidates.push(lane);
    const available=candidates.map(value=>Math.max(4,Math.min(plot.bottom-height,value))).find(value=>!overlaps({...rect,top:value}));
    if(Number.isFinite(available))rect.top=available;
  }
  placed.push(rect);
  ctx.strokeStyle=color;ctx.fillStyle='rgba(255,255,255,.94)';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(marker.x,marker.y);ctx.lineTo(Math.max(rect.left,Math.min(rect.left+rect.width,marker.x)),Math.max(rect.top,Math.min(rect.top+rect.height,marker.y)));ctx.stroke();
  ctx.fillRect(rect.left,rect.top,rect.width,rect.height);ctx.strokeRect(rect.left,rect.top,rect.width,rect.height);
  ctx.fillStyle=color;ctx.beginPath();ctx.arc(marker.x,marker.y,3.5,0,Math.PI*2);ctx.fill();
  ctx.textAlign='left';ctx.textBaseline='top';ctx.font='700 10px Arial, sans-serif';ctx.fillText(title,rect.left+7,rect.top+5,rect.width-14);
  if(subtitle){ctx.fillStyle='#5f6368';ctx.font='10px Arial, sans-serif';ctx.fillText(subtitle,rect.left+7,rect.top+19,rect.width-14);}
  ctx.restore();
}

function openNote(mode) { noteMode=mode==='marquee'?'marquee':'tips'; document.getElementById('trackerNoteTitle').textContent=noteMode==='tips'?'Pro Tips':'编辑滚动提醒'; document.getElementById('trackerNoteText').value=localStorage.getItem(noteMode==='tips'?STORAGE_KEYS.tips:STORAGE_KEYS.marquee)||''; document.getElementById('trackerNoteBackdrop').classList.add('open'); }
function closeNote(){document.getElementById('trackerNoteBackdrop').classList.remove('open');}
function saveNote(){localStorage.setItem(noteMode==='tips'?STORAGE_KEYS.tips:STORAGE_KEYS.marquee,document.getElementById('trackerNoteText').value);renderMarquee();closeNote();}
function handleNoteBackdrop(event){if(event.target.id==='trackerNoteBackdrop')closeNote();}
function openTrackerHelp(topic){const data=TRACKER_HELP_TOPICS[topic]||TRACKER_HELP_TOPICS['ma-status'];document.getElementById('trackerHelpTitle').textContent=data.title;document.getElementById('trackerHelpContent').innerHTML=data.html;const modal=document.getElementById('trackerHelpBackdrop');modal.classList.add('open');modal.setAttribute('aria-hidden','false');}
function closeTrackerHelp(){const modal=document.getElementById('trackerHelpBackdrop');modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
function handleTrackerHelpBackdrop(event){if(event.target.id==='trackerHelpBackdrop')closeTrackerHelp();}
function openActions(){document.getElementById('trackerActionsBackdrop').classList.add('open');}
function closeActions(){document.getElementById('trackerActionsBackdrop').classList.remove('open');}
function handleActionsBackdrop(event){if(event.target.id==='trackerActionsBackdrop')closeActions();}

async function pushTrackerCloud(){
  setLoading(true); const {user}=await getAuthenticatedUser(client); if(!user){setLoading(false);return;}
  const existing=(await loadCloudRow(client,user.id,'wp_data')).data?.wp_data||{};
  const notes={marquee:localStorage.getItem(STORAGE_KEYS.marquee)||'',tips:localStorage.getItem(STORAGE_KEYS.tips)||''};
  const payload=buildCloudPayload({userId:user.id,lookFirst:readArray(localStorage,STORAGE_KEYS.lookFirst),thenLeap:readArray(localStorage,STORAGE_KEYS.thenLeap),waveState:readJson(localStorage,STORAGE_KEYS.waveState,null),instrumentPool:pool,uiNotes:notes,existingWaveData:existing});
  const results=await Promise.all([upsertCloudRow(client,payload),syncMarketBindings(client,user.id,pool),saveTrackerState(client,user.id,trackerState)]); setLoading(false);
  const error=results.find(result=>result?.error)?.error; alert(error?`Push failed: ${error.message}`:'Tracker data pushed to Cloud.');
}

async function pullTrackerCloud(){
  setLoading(true); const {user}=await getAuthenticatedUser(client); if(!user){setLoading(false);return;}
  const [cloud,tracker]=await Promise.all([loadCloudRow(client,user.id),loadTrackerState(client,user.id)]);
  if(cloud.data){const unpacked=unpackCloudPayload(cloud.data); if(unpacked.instrumentPool?.items){pool=unpacked.instrumentPool;saveInstrumentPool(pool);} if(unpacked.uiNotes){localStorage.setItem(STORAGE_KEYS.marquee,unpacked.uiNotes.marquee||'');localStorage.setItem(STORAGE_KEYS.tips,unpacked.uiNotes.tips||'');}}
  if(tracker.data?.state)trackerState=normalizeTrackerState(tracker.data.state); persistState();renderMarquee();renderInstrumentPicker();await loadInstrumentHistory();setLoading(false);
}

async function logout(){await client.auth.signOut();window.location.href=ROUTES.auth;}

window.addEventListener('resize',()=>requestAnimationFrame(renderTracker));
document.addEventListener('DOMContentLoaded',async()=>{const {data}=await client.auth.getSession();if(!data?.session){window.location.href=ROUTES.auth;return;}renderMarquee();renderInstrumentPicker();await loadInstrumentHistory();});
bindDeclarativeEvents({selectInstrument,updateTrackerInputs,toggleMa,renderTracker,openNote,closeNote,saveNote,handleNoteBackdrop,openTrackerHelp,closeTrackerHelp,handleTrackerHelpBackdrop,openActions,closeActions,handleActionsBackdrop,pushTrackerCloud,pullTrackerCloud,logout});
