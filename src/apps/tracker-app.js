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
import { DEFAULT_TRACKER_MA_PROJECTION_SCENARIO, normalizeTrackerMaProjectionScenario } from '../core/tracker-state.js';
import { MA_PERIODS, DEFAULT_VISIBLE_MAS, analyzeTrend, appendProvisionalCurrent, sma } from '../tracker/trend-engine.js';
import { buildTrackerChartModel, buildTrackerChartXModel, buildTrackerChartYModel, trackerChartEdge } from '../tracker/chart-model.js';
import { buildScenarioComparison } from '../tracker/scenario-comparison.js';
import { projectMovingAverageSeries } from '../tracker/ma-projection.js';
import { formatTurnLabel } from '../tracker/status-presenter.js';
import { runCloudPushFeedback } from './cloud-action-feedback.js';
import { readSharedLiveInputs, reconcileLegacyTrackerInputs, updateSharedLiveInput } from '../core/shared-live-inputs.js';

const client = getSupabaseClient('tracker');
runMigrations(localStorage);
reconcileLegacyTrackerInputs(localStorage);
const COLORS = ['#4285f4','#ea4335','#fbbc05','#34a853','#ab47bc','#ff6d00','#00acc1','#795548','#5f6368'];
const SCENARIO_CANVAS_STYLES = Object.freeze({
  flat:Object.freeze({ token:'--brand-blue', fallback:'#4285f4' }),
  trend:Object.freeze({ token:'--brand-green', fallback:'#34a853' }),
  custom:Object.freeze({ token:'--brand-red', fallback:'#ea4335' })
});
const TRACKER_HELP_TOPICS = {
  'ma-status': {
    title:'MA Status · 均线状态与确认',
    html:`<h3>Value 与 ΔMA</h3><p><strong>Value</strong> 是最近 N 个收盘价的简单平均值。均线每日变化使用精确递推：</p><div class="formula"><code>ΔMA_N = (C_t − C_{t−N}) ÷ N</code></div><p>Direction 按 ΔMA 相对前一日均线的比例判断：</p><ul><li><strong>up</strong>：比例高于 +0.01%，均线向上。</li><li><strong>down</strong>：比例低于 −0.01%，均线向下。</li><li><strong>flat</strong>：绝对比例不超过 0.01%，视为近似走平。</li><li><strong>insufficient</strong>：历史长度不足以计算该周期及其变化。</li></ul><h3>Turn 列</h3><ul><li><strong>Turn Alert</strong>：当前方向为 up 或 down，且刚与上一计算点的方向不同；只是首次切换提醒。</li><li><strong>Up Confirmed</strong>：最近三个计算点连续为 up，确认的是向上方向持续，不代表刚刚才发生拐头。</li><li><strong>Down Confirmed</strong>：最近三个计算点连续为 down，确认的是向下方向持续，不代表刚刚才发生拐头。</li><li><strong>—</strong>：没有新切换、尚未形成连续确认，或该周期数据不足。</li></ul><h3>Current Preview</h3><p>手动 Current 会作为临时收盘价追加，整张 MA/MACD 表用于盘中预演。带有 <code>(preview)</code> 的 Turn Alert、Up Confirmed 或 Down Confirmed 都不是正式收盘确认，也不会改写 BaoStock 历史。</p><h3>MACD 数值</h3><p><strong>DIF</strong> 是 12 日与 26 日 EMA 的差；<strong>DEA</strong> 是 DIF 的 9 日 EMA；<strong>Histogram</strong> = 2 × (DIF − DEA)，正负代表多空侧，绝对值代表动能距离。</p><h3>MACD 状态</h3><ul><li><strong>golden cross</strong>：DIF 最新由下向上穿过 DEA；<strong>death cross</strong>：由上向下穿过；<strong>none cross</strong>：最新计算点没有新交叉。</li><li><strong>above zero axis</strong>：DIF ≥ 0；<strong>below zero axis</strong>：DIF &lt; 0；<strong>unknown</strong>：数据不足。</li><li><strong>strengthening</strong>：Histogram 绝对值扩大；<strong>weakening</strong>：绝对值未扩大；<strong>insufficient</strong>：没有足够的前一计算点可比较。</li></ul><p>Strengthening/weakening 必须结合 Histogram 正负理解：正柱扩大是多头增强，负柱扩大是空头增强；正柱收窄是多头减弱，负柱收窄是空头减弱。MACD只确认MA结构，不建立额外评分。</p>`
  },
  scenario: {
    title:'Scenario Lab · 情景路径说明',
    html:`<h3>三种情景同时对照</h3><p><strong>Flat</strong>：未来价格保持在起点。<br><strong>Trend continuation</strong>：延续近期对数收益率方向，并用近期波动率限制斜率，避免无限外推。<br><strong>Custom target</strong>：从起点以对数线性路径推演到手动 Target。三种情景共用同一个期限并同时展示，不再通过 Mode 单选。</p><h3>起点与输入优先级</h3><p>填写 Current 时，三种情景均以 <strong>Current Preview</strong> 为起点；未填写时以 BaoStock 最新正式收盘价为起点。<strong>Trading days</strong> 设置 1–240 个交易日；填写 <strong>Target date</strong> 后，系统按起止日期估算工作日并优先使用该结果。Target 只影响 Custom target；Target 为空、非法或不大于零时，Custom 显示 <strong>Set Target</strong> 且不绘制路径，Flat 与 Trend 仍正常运行。</p><h3>主图显示</h3><p>为保证历史走势始终是主视觉，未来每个交易日在横轴上按历史交易日间距的<strong>三分之一</strong>绘制，不设置最小宽度，并将整个预测尾部限制在主图宽度的 15% 以内。这只是显示压缩：系统仍会完整计算并展示全部未来交易日。三条 Scenario 价格路径为同色实线，条件预测 MA 保持同色短虚线。纵轴以可见 Close 与 MA 为主，Scenario 最多向历史价格范围外扩展 15%；更远的路径会在边缘截断并显示同色方向箭头，精确终点仍以下方结果行为准。</p><h3>Reset</h3><p>Reset 只把当前标的的 Trading days 恢复为 20，并清空 Target 与 Target date。它不会清除 Current、VR、MA 显示开关或其他标的数据。</p><h3>如何读三行结果</h3><p>蓝色 Flat、绿色 Trend 和红色 Custom 每一行，都是把对应假设路径加入历史后，在<strong>情景最后一天</strong>重新计算出的“长期背景 · 当前结构 · 事件结论”。它们不是页面左侧的当前正式状态。</p><h3>长期背景</h3><ul><li><strong>Long Bull</strong>：终点价格不低于 MA240，且 MA240 方向为 up。</li><li><strong>Long Bear</strong>：终点价格低于 MA240，且 MA240 方向为 down。</li><li><strong>Transition</strong>：不满足上述两组完整条件，包括 MA240 数据不足、价格侧与斜率方向不一致等过渡状态。</li></ul><h3>当前结构</h3><ul><li><strong>Uptrend</strong>：MA5 &gt; MA10 &gt; MA20，同时 MA5、MA10 均为 up。</li><li><strong>Downtrend</strong>：MA5 &lt; MA10 &lt; MA20，同时 MA5、MA10 均为 down。</li><li><strong>Range</strong>：不满足完整 Uptrend 或 Downtrend 条件；它表示均线结构未形成单边排列，不是波动区间数值。</li></ul><h3>事件结论</h3><ul><li><strong>反转确认</strong>：Long Bear + Uptrend，并且 MA20 方向连续确认、最近两个计算收盘位于 MA60 上方。</li><li><strong>下跌反抽</strong>：Long Bear + Uptrend，但尚未同时满足上述 MA20 与 MA60 确认条件。</li><li><strong>调整探底</strong>：Long Bull + Downtrend。</li><li><strong>反转观察</strong>：Transition，且出现 MA20 Turn Alert 或价格首次切换到 MA60 另一侧。</li><li><strong>震荡等待</strong>：前述优先条件均未触发，且结构为 Range。</li><li><strong>趋势延续</strong>：前述特殊组合均未触发，系统保留默认结论；它是分类结果，不等于趋势强度评分。</li></ul><h3>波动范围</h3><div class="formula"><code>情景上下界 = 路径价格 × exp(±σ√d)</code></div><p>σ 来自近 20 个交易日的对数收益率。上下界保留在结果行中，不额外画成六条线。它只是波动情景范围，不是置信区间、概率预测或止盈目标。</p><h3>边界</h3><p>Scenario终点状态是条件推演，不是发生概率、目标价承诺或交易信号。Scenario Lab不改变MA、MACD、Terminal Composite Signal或任何交易评分。</p>`
  }
};
TRACKER_HELP_TOPICS.scenario.html += `<h3>Projected moving averages</h3><p>点击 Flat、Trend continuation 或 Custom target 结果行，会选择该情景用于未来均线预演；三条价格路径仍会同时保留。系统把所选情景的逐日收盘价依次追加到历史序列，并用现有 SMA 公式延长当前勾选的 MA。填写 Current 时，Current Preview 也会进入这组条件计算。</p><p>历史均线为实线，未来均线为同色短虚线。它们表示“如果该价格路径成立，均线可能如何演化”，不是独立价格预测、发生概率或交易信号。Custom Target 被清空或 Reset 时，均线预演会自动回到 Trend continuation。</p>`;
let pool = loadInstrumentPool();
let history = [];
let historyDates = [];
let syncState = null;
let noteMode = 'tips';
let trackerState = normalizeTrackerState(readJson(localStorage, STORAGE_KEYS.trackerState, {}));

function normalizeTrackerState(value) {
  const state = value && typeof value === 'object' ? value : {};
  const instruments=state.instruments && typeof state.instruments === 'object'
    ? Object.fromEntries(Object.entries(state.instruments).map(([id,value])=>{
      const source=value && typeof value==='object' ? value : {};
      const { scenarioMode:_legacyScenarioMode, ...current }=source;
      return [id,{...current,maProjectionScenario:normalizeTrackerMaProjectionScenario(current.maProjectionScenario)}];
    }))
    : {};
  return { version:1, activeInstrumentId:String(state.activeInstrumentId || localStorage.getItem(STORAGE_KEYS.activeInstrument) || ''), visibleMas:Array.isArray(state.visibleMas) ? state.visibleMas.map(Number).filter(period => MA_PERIODS.includes(period)) : [...DEFAULT_VISIBLE_MAS], instruments };
}

function persistState() {
  writeJson(localStorage, STORAGE_KEYS.trackerState, trackerState);
  if (trackerState.activeInstrumentId) localStorage.setItem(STORAGE_KEYS.activeInstrument, trackerState.activeInstrumentId);
}

function currentInstrument() { return pool.items.find(item => item.id === trackerState.activeInstrumentId && item.status !== 'archived') || null; }
function instrumentState() { return trackerState.instruments[trackerState.activeInstrumentId] ||= { horizon:20, target:'', targetDate:'', maProjectionScenario:DEFAULT_TRACKER_MA_PROJECTION_SCENARIO }; }
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

function updateTrackerInput(input) {
  const instrument=currentInstrument();
  const field=input?.id==='trackerCurrent'?'current':input?.id==='trackerVr'?'vr':'';
  if(!instrument||!field)return;
  updateSharedLiveInput(localStorage,{instrumentId:instrument.id,instrument,field,value:input.value});
  renderTracker();
}

function renderMaToggles() {
  document.getElementById('maToggles').innerHTML=MA_PERIODS.map((period,index)=>`<label class="ma-toggle" style="--ma-color:${COLORS[index]}"><input type="checkbox" value="${period}" ${trackerState.visibleMas.includes(period)?'checked':''} data-fibo-change="toggleMa(this)">MA${period}</label>`).join('');
}

function toggleMa(input) {
  const period=Number(input.value); trackerState.visibleMas=input.checked ? [...new Set([...trackerState.visibleMas,period])] : trackerState.visibleMas.filter(value=>value!==period); persistState(); renderTracker();
}

function resetScenario() {
  const state=instrumentState();
  document.getElementById('scenarioHorizon').value='20';
  document.getElementById('scenarioTarget').value='';
  document.getElementById('scenarioTargetDate').value='';
  Object.assign(state,{ horizon:20, target:'', targetDate:'' });
  if(state.maProjectionScenario==='custom')state.maProjectionScenario=DEFAULT_TRACKER_MA_PROJECTION_SCENARIO;
  persistState();
  renderTracker();
}

function selectMaProjectionScenario(key) {
  const selected=normalizeTrackerMaProjectionScenario(key);
  const target=Number(document.getElementById('scenarioTarget').value);
  if(selected==='custom'&&!(Number.isFinite(target)&&target>0))return;
  instrumentState().maProjectionScenario=selected;
  persistState();
  renderTracker();
}

function renderTracker(forceLiveInputs=false) {
  if (document.getElementById('trackerContent').hidden) return;
  const state=instrumentState();
  const live=readSharedLiveInputs(localStorage,trackerState.activeInstrumentId);
  const currentInput=document.getElementById('trackerCurrent'), vrInput=document.getElementById('trackerVr');
  if (forceLiveInputs || document.activeElement !== currentInput) currentInput.value=live.current;
  if (forceLiveInputs || document.activeElement !== vrInput) vrInput.value=live.vr;
  const official=analyzeTrend(history);
  const previewValues=appendProvisionalCurrent(history,live.current);
  const preview=analyzeTrend(previewValues);
  document.getElementById('backgroundValue').textContent=official.background;
  document.getElementById('structureValue').textContent=official.structure;
  document.getElementById('eventValue').textContent=official.event;
  document.getElementById('profileValue').textContent=`Focus MA ${preview.profile.focus.join(' / ')}`;
  document.getElementById('vrInterpretation').textContent=vrText(live.vr);
  const freshness=document.getElementById('trackerFreshness');
  if (syncState?.last_status === 'error') {
    freshness.className='freshness error';
    freshness.textContent=`数据截至 ${historyDates.at(-1) || '--'}；最近同步失败：${syncState.last_error || 'unknown error'}`;
  } else if (!freshness.classList.contains('error')) freshness.textContent=history.length ? `Official close: ${historyDates.at(-1)} · ${history.length} sessions · Sync: ${syncState?.last_status || 'unknown'}${live.current ? ' · Current preview active':''}` : '暂无行情历史；请运行 BaoStock Sync。';
  renderMaToggles();
  document.getElementById('maTableBody').innerHTML=MA_PERIODS.map(period=>{
    const item=preview.ma[period], turn=preview.turns[`ma${period}`];
    const turnText=formatTurnLabel(turn,item.direction,live.current !== '');
    return `<tr><td>MA${period}</td><td>${Number.isFinite(item.value)?item.value.toFixed(3):'--'}</td><td>${Number.isFinite(item.delta)?item.delta.toFixed(4):'--'}</td><td class="status-${item.direction}">${item.direction}</td><td>${turnText}</td></tr>`;
  }).join('');
  document.getElementById('macdSummary').innerHTML=`<strong>MACD 12/26/9</strong><br>DIF ${format(preview.macd.dif)} · DEA ${format(preview.macd.dea)} · Histogram ${format(preview.macd.histogram)}<br>${preview.macd.cross} cross · ${preview.macd.zeroAxis} zero axis · ${preview.macd.direction}`;
  const target=document.getElementById('scenarioTarget').value, targetDate=document.getElementById('scenarioTargetDate').value;
  const manualHorizon=Number(document.getElementById('scenarioHorizon').value)||20;
  const horizon=targetDate ? businessDaysUntil(historyDates.at(-1),targetDate) : manualHorizon;
  const scenarios=buildScenarioComparison(previewValues,{horizon,target});
  let selectedKey=normalizeTrackerMaProjectionScenario(state.maProjectionScenario);
  if(!scenarios.find(item=>item.key===selectedKey&&item.enabled))selectedKey=DEFAULT_TRACKER_MA_PROJECTION_SCENARIO;
  Object.assign(state,{horizon:manualHorizon,target,targetDate,maProjectionScenario:selectedKey});
  persistState();
  const selectedScenario=scenarios.find(item=>item.key===selectedKey&&item.enabled);
  const maProjectionSeries=projectMovingAverageSeries(previewValues,selectedScenario?.projection?.path || [],trackerState.visibleMas);
  renderScenarioResults(scenarios,targetDate,selectedKey);
  drawChart(previewValues,historyDates,live.current !== '',scenarios,{
    horizon,targetDate,maProjectionScenario:selectedKey,maProjectionLabel:selectedScenario?.label || 'Trend continuation',maProjectionSeries
  });
}

function renderScenarioResults(scenarios,targetDate,selectedKey) {
  document.getElementById('scenarioLegendCustom').classList.toggle('is-disabled',!scenarios.find(item=>item.key==='custom')?.enabled);
  const selected=scenarios.find(item=>item.key===selectedKey);
  const projectionLegend=document.getElementById('maProjectionLegend');
  projectionLegend.dataset.maProjectionScenario=selectedKey;
  document.getElementById('maProjectionLegendLabel').textContent=`Projected MA · ${selected?.label || 'Trend continuation'}`;
  document.getElementById('scenarioResult').innerHTML=scenarios.map(scenario=>{
    const isSelected=scenario.enabled&&scenario.key===selectedKey;
    const baseClass=`scenario-result-row scenario-result-row--${scenario.key}${isSelected?' is-selected':''}${scenario.enabled?'':' is-disabled'}`;
    const identity=`<span class="scenario-result-row__identity"><span class="scenario-result-row__swatch"></span><strong>${escapeHtml(scenario.label)}</strong></span>`;
    const attributes=`type="button" class="${baseClass}" data-scenario="${scenario.key}" data-fibo-click="selectMaProjectionScenario('${scenario.key}')" aria-pressed="${isSelected}" title="Use ${escapeHtml(scenario.label)} for projected moving averages"`;
    if(!scenario.enabled) return `<button ${attributes} disabled aria-disabled="true">${identity}<span class="scenario-result-row__empty">Set Target</span></button>`;
    const projection=scenario.projection;
    const end=projection?.path?.at(-1), lower=projection?.lower?.at(-1), upper=projection?.upper?.at(-1), endAnalysis=projection?.analyses?.at(-1);
    if(!Number.isFinite(end)||!Number.isFinite(lower)||!Number.isFinite(upper)||!endAnalysis) return `<button ${attributes}>${identity}<span class="scenario-result-row__empty">Insufficient history</span></button>`;
    const endLabel=targetDate || `Day ${projection.path.length}`;
    return `<button ${attributes}>${identity}<span class="scenario-result-row__numbers"><strong>${escapeHtml(endLabel)}: ${end.toFixed(3)}</strong><span>Volatility range ${lower.toFixed(3)} – ${upper.toFixed(3)}</span></span><span class="scenario-result-row__status">${escapeHtml(endAnalysis.background)} · ${escapeHtml(endAnalysis.structure)} · ${escapeHtml(endAnalysis.event)}</span></button>`;
  }).join('');
}

function format(value) { return Number.isFinite(value) ? value.toFixed(4) : '--'; }

function businessDaysUntil(startValue,targetValue) {
  const start=startValue ? new Date(`${startValue}T00:00:00`) : new Date();
  const target=new Date(`${targetValue}T00:00:00`);
  if (!Number.isFinite(target.getTime()) || target<=start) return 1;
  let days=0,cursor=new Date(start); while(cursor<target&&days<240){cursor.setDate(cursor.getDate()+1);if(cursor.getDay()!==0&&cursor.getDay()!==6)days+=1;}
  return Math.max(1,days);
}

function cssTokenColor(token,fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback;
}

function scenarioCanvasColor(key) {
  const style=SCENARIO_CANVAS_STYLES[key] || SCENARIO_CANVAS_STYLES.flat;
  return cssTokenColor(style.token,style.fallback);
}

function scenarioChartAriaLabel(chart,scenarios,meta,edges={}) {
  const active=scenarios.find(item=>item.enabled&&item.projection?.path?.length);
  const horizon=active?.projection.path.length || Math.max(1,Math.min(240,Number(meta?.horizon)||20));
  const horizonText=meta?.targetDate ? `Forecast target date ${meta.targetDate}.` : `Forecast horizon ${horizon} trading days.`;
  const summaries=scenarios.map(scenario=>{
    if(!scenario.enabled) return 'Custom target is not set.';
    const end=scenario.projection?.path?.at(-1);
    if(!Number.isFinite(end))return `${scenario.label} forecast is unavailable.`;
    const edge=edges[scenario.key];
    return `${scenario.label} forecast ends at ${end.toFixed(3)}.${edge?` It continues beyond the ${edge==='high'?'upper':'lower'} chart edge.`:''}`;
  });
  const projectedMas=(meta?.maProjectionSeries || []).map(item=>{
    const end=item.values?.at(-1);
    return Number.isFinite(end)?`MA${item.period} ends at ${end.toFixed(3)}.`:`MA${item.period} remains unavailable.`;
  });
  const maProjectionText=`Projected moving averages use ${meta?.maProjectionLabel || 'Trend continuation'}.${projectedMas.length?` ${projectedMas.join(' ')}`:''}`;
  return `${chart.ariaLabel} ${horizonText} ${summaries.join(' ')} ${maProjectionText}`;
}

function drawChart(values,dates,hasPreview,scenarios,meta={}) {
  const canvas=document.getElementById('trackerChart'), rect=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
  canvas.width=Math.max(1,Math.round(rect.width*dpr)); canvas.height=Math.max(1,Math.round(rect.height*dpr));
  const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr); const width=rect.width,height=rect.height;
  const chart=buildTrackerChartModel(values,dates,{hasPreview});
  canvas.setAttribute('aria-label',scenarioChartAriaLabel(chart,scenarios,meta));
  if (!chart.points.length) return;
  const plot={left:32,right:width-32,top:34,bottom:height-44};
  const closeValues=chart.points.map(point=>point.value);
  const maSeries=trackerState.visibleMas.map(period=>({
    values:chart.points.map(point=>sma(values.slice(0,point.sourceIndex+1),period)),
    color:COLORS[MA_PERIODS.indexOf(period)], width:1.25
  }));
  const activeScenarios=scenarios.filter(item=>item.enabled&&item.projection?.path?.length);
  const projectionValues=activeScenarios.flatMap(item=>item.projection.path);
  const historyNumbers=[...closeValues,...maSeries.flatMap(item=>item.values)].filter(Number.isFinite);
  const yModel=buildTrackerChartYModel(historyNumbers,projectionValues); if(!yModel)return;
  const {min,max}=yModel;
  const horizon=activeScenarios[0]?.projection.path.length || Math.max(1,Math.min(240,Number(meta.horizon)||20));
  const xModel=buildTrackerChartXModel(chart.points.length,horizon,plot);
  const x=index=>xModel.history[index] ?? xModel.historyRight;
  const y=value=>plot.top+(max-value)/(max-min)*(plot.bottom-plot.top);
  canvas.dataset.forecastRatio=xModel.forecastRatio.toFixed(4);
  canvas.dataset.forecastHorizon=String(horizon);
  canvas.dataset.maProjectionScenario=meta.maProjectionScenario || DEFAULT_TRACKER_MA_PROJECTION_SCENARIO;
  canvas.dataset.maProjectionPeriods=(meta.maProjectionSeries || []).filter(item=>Number.isFinite(item.values?.at(-1))).map(item=>item.period).join(',');

  ctx.strokeStyle=cssTokenColor('--color-border-subtle','#e8eaed');ctx.lineWidth=1;
  for(let i=0;i<5;i++){const gridY=plot.top+(plot.bottom-plot.top)*i/4;ctx.beginPath();ctx.moveTo(plot.left,gridY);ctx.lineTo(plot.right,gridY);ctx.stroke();}

  const officialPoints=chart.points.filter(point=>!point.isPreview);
  ctx.strokeStyle=cssTokenColor('--color-text','#202124');ctx.lineWidth=2;ctx.beginPath();
  officialPoints.forEach((point,index)=>{const px=x(point.index),py=y(point.value);if(index===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);});ctx.stroke();
  if(chart.preview&&officialPoints.length){const latest=officialPoints.at(-1);ctx.save();ctx.strokeStyle=cssTokenColor('--color-text-secondary','#5f6368');ctx.lineWidth=2;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(x(latest.index),y(latest.value));ctx.lineTo(x(chart.preview.index),y(chart.preview.value));ctx.stroke();ctx.restore();}

  maSeries.forEach(item=>{ctx.strokeStyle=item.color;ctx.lineWidth=item.width;ctx.beginPath();let started=false;item.values.forEach((value,index)=>{if(!Number.isFinite(value))return;const px=x(index),py=y(value);if(!started){ctx.moveTo(px,py);started=true}else ctx.lineTo(px,py);});ctx.stroke();});

  const start=closeValues.at(-1), endpointEdges={};
  activeScenarios.forEach(scenario=>{
    const color=scenarioCanvasColor(scenario.key), path=scenario.projection.path;
    ctx.save();ctx.beginPath();ctx.rect(plot.left,plot.top,plot.right-plot.left,plot.bottom-plot.top);ctx.clip();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(xModel.historyRight,y(start));path.forEach((value,index)=>ctx.lineTo(xModel.forecast[index],y(value)));ctx.stroke();ctx.restore();
    const edge=trackerChartEdge(path.at(-1),yModel); endpointEdges[scenario.key]=edge;
    if(edge)drawScenarioEdgeMarker(ctx,{x:xModel.forecast[path.length-1],edge,color,plot});
    else {ctx.save();ctx.fillStyle=color;ctx.beginPath();ctx.arc(xModel.forecast[path.length-1],y(path.at(-1)),3,0,Math.PI*2);ctx.fill();ctx.restore();}
  });
  drawProjectedMaSeries(ctx,meta.maProjectionSeries || [],xModel,y,plot);
  canvas.dataset.forecastClipped=Object.entries(endpointEdges).filter(([,edge])=>edge).map(([key,edge])=>`${key}:${edge}`).join(',');
  canvas.setAttribute('aria-label',scenarioChartAriaLabel(chart,scenarios,meta,endpointEdges));

  const placed=[];
  const historyPlot={...plot,right:xModel.historyRight};
  chart.markers.forEach(marker=>drawChartCallout(ctx,{...marker,x:x(marker.index),y:y(marker.value)},historyPlot,placed));
  if(chart.preview)drawChartCallout(ctx,{...chart.preview,label:'Preview',kinds:['preview'],x:x(chart.preview.index),y:y(chart.preview.value)},historyPlot,placed);

  ctx.fillStyle=cssTokenColor('--color-text-secondary','#5f6368');ctx.font='10px Arial, sans-serif';ctx.textBaseline='bottom';
  const startLabel=chart.startDate||'--', latestLabel=chart.endDate||'--', forecastLabel=meta.targetDate || `Day ${horizon}`;
  const latestRight=xModel.historyRight-4, forecastLeft=plot.right-ctx.measureText(forecastLabel).width;
  const compactForecast=xModel.forecastRatio<.06;
  const latestBaseline=compactForecast||latestRight>forecastLeft-8?height-20:height-8;
  ctx.textAlign='left';ctx.fillText(startLabel,plot.left,height-8);
  ctx.textAlign='right';ctx.fillText(latestLabel,latestRight,latestBaseline);
  ctx.fillText(forecastLabel,plot.right,height-8);
}

function drawProjectedMaSeries(ctx,series,xModel,y,plot) {
  ctx.save();
  ctx.beginPath();ctx.rect(plot.left,plot.top,plot.right-plot.left,plot.bottom-plot.top);ctx.clip();
  ctx.lineWidth=1.25;ctx.setLineDash([3,3]);ctx.globalAlpha=.72;
  series.forEach(item=>{
    const color=COLORS[MA_PERIODS.indexOf(item.period)] || cssTokenColor('--color-text-secondary','#5f6368');
    const points=[];
    if(Number.isFinite(item.start))points.push({x:xModel.historyRight,y:y(item.start)});
    (item.values || []).forEach((value,index)=>{if(Number.isFinite(value)&&Number.isFinite(xModel.forecast[index]))points.push({x:xModel.forecast[index],y:y(value)});});
    if(!points.length)return;
    ctx.strokeStyle=color;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);
    points.slice(1).forEach(point=>ctx.lineTo(point.x,point.y));
    if(points.length>1)ctx.stroke();
    else {ctx.beginPath();ctx.arc(points[0].x,points[0].y,1.75,0,Math.PI*2);ctx.fill();}
  });
  ctx.restore();
}

function drawScenarioEdgeMarker(ctx,{x,edge,color,plot}) {
  const markerX=Math.max(plot.left+5,Math.min(plot.right-5,x));
  ctx.save();ctx.fillStyle=color;ctx.beginPath();
  if(edge==='high'){ctx.moveTo(markerX,plot.top+1);ctx.lineTo(markerX-5,plot.top+9);ctx.lineTo(markerX+5,plot.top+9);}
  else {ctx.moveTo(markerX,plot.bottom-1);ctx.lineTo(markerX-5,plot.bottom-9);ctx.lineTo(markerX+5,plot.bottom-9);}
  ctx.closePath();ctx.fill();ctx.restore();
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

async function pushTrackerCloud(trigger){
  const button=trigger||document.querySelector('.fibo-header__actions .fibo-button--cloud-up');
  const mobileAction=!!button?.closest('#trackerActionsBackdrop');
  return runCloudPushFeedback(button,async()=>{
    setLoading(true); const {user}=await getAuthenticatedUser(client); if(!user){setLoading(false);return false;}
    const existing=(await loadCloudRow(client,user.id,'wp_data')).data?.wp_data||{};
    const notes={marquee:localStorage.getItem(STORAGE_KEYS.marquee)||'',tips:localStorage.getItem(STORAGE_KEYS.tips)||''};
    const payload=buildCloudPayload({userId:user.id,lookFirst:readArray(localStorage,STORAGE_KEYS.lookFirst),thenLeap:readArray(localStorage,STORAGE_KEYS.thenLeap),waveState:readJson(localStorage,STORAGE_KEYS.waveState,null),instrumentPool:pool,uiNotes:notes,existingWaveData:existing});
    const results=await Promise.all([upsertCloudRow(client,payload),syncMarketBindings(client,user.id,pool),saveTrackerState(client,user.id,trackerState)]); setLoading(false);
    const error=results.find(result=>result?.error)?.error;
    if(error){alert(`Push failed: ${error.message}`);return false;}
    return true;
  },{
    onSuccessSettled:()=>{if(mobileAction)closeActions();},
    onUnexpectedError:error=>{setLoading(false);alert(`Push failed: ${error?.message||error}`);}
  });
}

async function pullTrackerCloud(){
  setLoading(true); const {user}=await getAuthenticatedUser(client); if(!user){setLoading(false);return;}
  const [cloud,tracker]=await Promise.all([loadCloudRow(client,user.id),loadTrackerState(client,user.id)]);
  if(cloud.data){
    const unpacked=unpackCloudPayload(cloud.data);
    if(Array.isArray(cloud.data.v6_data))writeJson(localStorage,STORAGE_KEYS.lookFirst,unpacked.lookFirst);
    if(Array.isArray(cloud.data.v7_data))writeJson(localStorage,STORAGE_KEYS.thenLeap,unpacked.thenLeap);
    if(unpacked.instrumentPool?.items){pool=unpacked.instrumentPool;saveInstrumentPool(pool);}
    if(unpacked.uiNotes){localStorage.setItem(STORAGE_KEYS.marquee,unpacked.uiNotes.marquee||'');localStorage.setItem(STORAGE_KEYS.tips,unpacked.uiNotes.tips||'');}
  }
  if(tracker.data?.state)writeJson(localStorage,STORAGE_KEYS.trackerState,normalizeTrackerState(tracker.data.state));
  reconcileLegacyTrackerInputs(localStorage,pool);
  trackerState=normalizeTrackerState(readJson(localStorage,STORAGE_KEYS.trackerState,{}));
  persistState();renderMarquee();renderInstrumentPicker();await loadInstrumentHistory();setLoading(false);
}

async function logout(){await client.auth.signOut();window.location.href=ROUTES.auth;}

window.addEventListener('resize',()=>requestAnimationFrame(renderTracker));
window.addEventListener('storage',event=>{
  if([STORAGE_KEYS.lookFirst,STORAGE_KEYS.thenLeap].includes(event.key))renderTracker(true);
});
document.addEventListener('DOMContentLoaded',async()=>{const {data}=await client.auth.getSession();if(!data?.session){window.location.href=ROUTES.auth;return;}renderMarquee();renderInstrumentPicker();await loadInstrumentHistory();});
bindDeclarativeEvents({selectInstrument,updateTrackerInput,toggleMa,resetScenario,selectMaProjectionScenario,renderTracker,openNote,closeNote,saveNote,handleNoteBackdrop,openTrackerHelp,closeTrackerHelp,handleTrackerHelpBackdrop,openActions,closeActions,handleActionsBackdrop,pushTrackerCloud,pullTrackerCloud,logout});
