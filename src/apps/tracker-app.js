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

const client = getSupabaseClient('tracker');
runMigrations(localStorage);
const COLORS = ['#4285f4','#ea4335','#fbbc05','#34a853','#ab47bc','#ff6d00','#00acc1','#795548','#5f6368'];
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
  drawChart(previewValues,state.current !== '',projection);
}

function format(value) { return Number.isFinite(value) ? value.toFixed(4) : '--'; }

function businessDaysUntil(startValue,targetValue) {
  const start=startValue ? new Date(`${startValue}T00:00:00`) : new Date();
  const target=new Date(`${targetValue}T00:00:00`);
  if (!Number.isFinite(target.getTime()) || target<=start) return 1;
  let days=0,cursor=new Date(start); while(cursor<target&&days<240){cursor.setDate(cursor.getDate()+1);if(cursor.getDay()!==0&&cursor.getDay()!==6)days+=1;}
  return Math.max(1,days);
}

function drawChart(values,hasPreview,projection) {
  const canvas=document.getElementById('trackerChart'), rect=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
  canvas.width=Math.max(1,Math.round(rect.width*dpr)); canvas.height=Math.max(1,Math.round(rect.height*dpr));
  const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr); const width=rect.width,height=rect.height,pad=30;
  const startIndex=Math.max(0,values.length-120), visibleValues=values.slice(startIndex); const series=[{values:visibleValues,color:'#202124',width:2}];
  trackerState.visibleMas.forEach(period=>series.push({values:visibleValues.map((_,i)=>sma(values.slice(0,startIndex+i+1),period)),color:COLORS[MA_PERIODS.indexOf(period)],width:1.25}));
  const numbers=series.flatMap(item=>item.values).filter(Number.isFinite); if(!numbers.length)return;
  let min=Math.min(...numbers),max=Math.max(...numbers); const margin=(max-min||max*.02||1)*.08; min-=margin;max+=margin;
  ctx.strokeStyle='#e8eaed';ctx.lineWidth=1; for(let i=0;i<5;i++){const y=pad+(height-pad*2)*i/4;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(width-pad,y);ctx.stroke();}
  series.forEach((item,seriesIndex)=>{ctx.strokeStyle=item.color;ctx.lineWidth=item.width;ctx.beginPath();let started=false;item.values.forEach((value,index)=>{if(!Number.isFinite(value))return;const x=pad+(width-pad*2)*index/Math.max(1,item.values.length-1),y=pad+(max-value)/(max-min)*(height-pad*2);if(!started){ctx.moveTo(x,y);started=true}else ctx.lineTo(x,y);});ctx.stroke();if(seriesIndex===0&&hasPreview){ctx.setLineDash([4,4]);ctx.strokeStyle='#202124';ctx.stroke();ctx.setLineDash([]);}});
  if(projection?.path?.length){const start=visibleValues.at(-1),step=(width-pad*2)/Math.max(1,visibleValues.length-1);ctx.strokeStyle='#9aa0a6';ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(width-pad,pad+(max-start)/(max-min)*(height-pad*2));projection.path.slice(0,20).forEach((value,index)=>ctx.lineTo(width-pad+step*(index+1)/4,pad+(max-value)/(max-min)*(height-pad*2)));ctx.stroke();ctx.setLineDash([]);}
}

function openNote(mode) { noteMode=mode==='marquee'?'marquee':'tips'; document.getElementById('trackerNoteTitle').textContent=noteMode==='tips'?'Pro Tips':'编辑滚动提醒'; document.getElementById('trackerNoteText').value=localStorage.getItem(noteMode==='tips'?STORAGE_KEYS.tips:STORAGE_KEYS.marquee)||''; document.getElementById('trackerNoteBackdrop').classList.add('open'); }
function closeNote(){document.getElementById('trackerNoteBackdrop').classList.remove('open');}
function saveNote(){localStorage.setItem(noteMode==='tips'?STORAGE_KEYS.tips:STORAGE_KEYS.marquee,document.getElementById('trackerNoteText').value);renderMarquee();closeNote();}
function handleNoteBackdrop(event){if(event.target.id==='trackerNoteBackdrop')closeNote();}
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
bindDeclarativeEvents({selectInstrument,updateTrackerInputs,toggleMa,renderTracker,openNote,closeNote,saveNote,handleNoteBackdrop,openActions,closeActions,handleActionsBackdrop,pushTrackerCloud,pullTrackerCloud,logout});
