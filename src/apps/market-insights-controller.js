/** New presentation only. Top 5/Pulse and their repositories remain independent. */
import { readMarketInsights } from '../core/market-insights-source.js';
import { normalizeScan,normalizeRegime,SCAN_WINDOWS,SCAN_PANELS,scanPanelPoints,scanGeometry } from '../radar/market-insights-view-model.js';
import { escapeRadarHtml as esc } from '../radar/radar-view-model.js';
import { animateContext,transitionContext } from './market-context-motion.js';
import { isMarketContextCacheStale,marketContextCacheStamp } from './market-context-cache.js';

const pulse='MARKET_PULSE';
const help={
  regime:['A股综合状态','Insights v1：60% 原 Pulse 市场广度 + 30% 进攻／防御风格 + 10% 风格13日变化。进攻侧为中证1000／2000小盘代理和创业板／科创50，防御侧为红利／红利低波。小盘代理不是微盘指数；非银、券商、保险不进入这个篮子。风格=50+(进攻强度−防御强度)/2；变化=50+(当前风格−13日前风格)/2。20／40／60／80分依次区分明显防御、偏防御、中性分化、偏进攻、明显进攻。缺少篮子历史不计算。只描述A股环境，不预测牛熊、概率或交易信号。'],
  strong:['当下最强','距离中心越近，当前强度越高。和“快速变强”不同，已经很强的板块也可能正在转弱。当前强度口径不随右侧变化窗口改变。'],
  strengthening:['快速变强','距离中心越近，强度提升越快。Yesterday 表示最新收盘相对前一交易日；3／13／60 日均截至同一最新收盘，不是自定义历史日期。弱板块的反弹也可能出现在这里。'],
  weak:['当下最弱','距离中心越近，当前强度越低。未进入原 Top 5 不代表最弱，必须使用独立的完整候选计算结果。当前强度口径不随右侧变化窗口改变。'],
  weakening:['快速变弱','距离中心越近，强度下降越快。已经很强的板块也可能正在转弱，所以同一主题可以同时出现在不同雷达。只用正式交易日，不插入缺失数据。'],
};
const waiting={not_configured:'待接入独立计算',loading:'正在读取独立快照…',error:'独立快照读取失败',invalid:'快照格式不兼容',empty:'尚无独立快照',ready:'尚无此窗口数据'};

function meterMarkup() {
  return `<section class="market-regime" aria-label="A股综合状态">
    <div class="market-regime__heading"><strong>A股综合状态</strong><span data-regime-label>待计算</span><button type="button" class="fibo-help-button" data-insights-help="regime" aria-label="A股综合状态说明">?</button></div>
    <div class="market-regime__scale" role="img" aria-label="偏熊至偏牛色带；尚未计算，无指针"><span></span><span></span><span></span><span></span><span></span><i class="market-regime__pointer" hidden></i></div>
    <div class="market-regime__labels"><span>偏防御</span><span>中性 / 分化</span><span>偏进攻</span></div><small class="market-regime__source" data-regime-source>独立快照待发布 · 非 Pulse 分数</small>
  </section>`;
}
function scanMarkup() {
  return `<div class="market-scan-dashboard">
    <div class="market-scan-main"><div class="market-scan-grid">${SCAN_PANELS.map(p=>`<article class="fibo-card market-scan-card" data-scan-panel="${p.id}" aria-label="${p.title}">
      <header><h3>${p.title}</h3><button type="button" class="fibo-help-button" data-insights-help="${p.id}" aria-label="${p.title}说明">?</button></header>
      <div class="market-scan-plot"></div><footer>${p.center}</footer></article>`).join('')}</div>
      <p class="market-scan-status" aria-live="polite"></p></div>
    <aside class="market-scan-windows" aria-label="Radar 变化窗口"><span class="market-scan-eyebrow">RADAR · 变化窗口</span>
      <div class="index-radar-memory-track">${SCAN_WINDOWS.map(w=>`<button type="button" class="fibo-card index-radar-memory-card" data-scan-window="${w.id}" aria-pressed="false"><span class="index-radar-memory-card__top"><strong>${w.label}</strong><small>${w.description}</small></span><span class="index-radar-memory-card__leaders" data-window-availability>待接入</span><span class="material-icons index-radar-memory-card__arrow" aria-hidden="true">chevron_right</span></button>`).join('')}</div>
      <p>均截至最新收盘。窗口只改变“快速变强／变弱”；当下强弱口径保持一致。</p>
      <button type="button" class="fibo-button fibo-button--control" data-insights-retry hidden>重试读取</button>
    </aside></div>`;
}

export function createMarketInsightsController({root,openHelp,source=readMarketInsights}) {
  const viewButtons=root.querySelector('#marketInsightsView');
  const oldViewport=root.querySelector('#indexRadarViewport');
  const scanViewport=root.querySelector('#marketScanViewport');
  const frame=root.querySelector('.market-context-content');
  const headerSlot=root.querySelector('.market-regime-header-slot'),footerSlot=root.querySelector('.market-regime-footer-slot');
  const state={scope:pulse,view:'leaders',periods:new Map(),cache:new Map(),loading:new Set()};
  let destroyed=false,positions=new Map();
  scanViewport.innerHTML=scanMarkup();headerSlot.innerHTML=meterMarkup();
  const meter=headerSlot.firstElementChild;
  const period=()=>state.periods.get(state.scope)||'3';
  const entry=()=>state.cache.get(state.scope)||{status:'not_configured',scan:null,regime:null};

  function draw({move=false}={}) {
    if(scanViewport.hidden) return;
    const current=entry(),nextPositions=new Map();
    for(const panel of SCAN_PANELS) {
      const plot=scanViewport.querySelector(`[data-scan-panel="${panel.id}"] .market-scan-plot`);
      const width=plot.clientWidth,height=plot.clientHeight;
      if(!width||!height) continue;
      const items=scanPanelPoints(current.scan,panel.id,period());
      const {cx,cy,r,nodes}=scanGeometry(items||[],width,height);
      const empty=items===null?(waiting[current.status]||waiting.empty):!items.length?'没有符合条件的主题':'';
      let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${panel.title}：${esc(empty||nodes.map(p=>p.label).join('、'))}">`;
      for(const ring of [.25,.5,.75,1]) svg+=`<circle cx="${cx}" cy="${cy}" r="${r*ring}" class="market-scan-ring"/>`;
      svg+=`<path d="M ${cx-r} ${cy} H ${cx+r} M ${cx} ${cy-r} V ${cy+r}" class="market-scan-ring"/>`;
      if(empty) svg+=`<text x="${cx}" y="${cy}" text-anchor="middle" class="market-scan-empty">${esc(empty)}</text>`;
      nodes.forEach((p,i)=>{
        const labelX=p.side==='right'?width-8:8;
        svg+=`<path d="M ${p.x} ${p.y} L ${p.side==='right'?labelX-8:labelX+8} ${p.labelY}" class="market-scan-leader-line"/><g data-scan-dot="${i}" transform="translate(${p.x} ${p.y})"><circle r="4" class="market-scan-dot"/><title>${esc(p.label)}</title></g><text x="${labelX}" y="${p.labelY-4}" text-anchor="${p.side==='right'?'end':'start'}"><title>${esc(p.label)}</title>${esc([...p.label].length>10?[...p.label].slice(0,9).join('')+'…':p.label)}</text>`;
        nextPositions.set(`${state.scope}:${panel.id}:${p.themeKey}`,{x:p.x,y:p.y,width,height});
      });
      const markup=svg+'</svg>';
      if(plot.dataset.rendered===markup) continue;
      plot.dataset.rendered=markup;
      plot.innerHTML=markup;
      if(move) nodes.forEach((p,i)=>{
        const key=`${state.scope}:${panel.id}:${p.themeKey}`,old=positions.get(key);
        if(old&&old.width===width&&old.height===height&&(Math.abs(old.x-p.x)>0.1||Math.abs(old.y-p.y)>0.1)) {
          animateContext(plot.querySelector(`[data-scan-dot="${i}"]`),[{transform:`translate(${old.x}px,${old.y}px)`},{transform:`translate(${p.x}px,${p.y}px)`}],{slow:true});
        }
      });
    }
    positions=nextPositions;
  }
  function updateMeter(data,status) {
    const pointer=meter.querySelector('.market-regime__pointer'),scale=meter.querySelector('.market-regime__scale');
    const old=pointer.hidden?null:Number(pointer.dataset.value);
    pointer.hidden=!data;
    meter.querySelector('[data-regime-label]').textContent=data?data.label:status==='loading'?'读取中…':status==='error'?'暂不可用':'待计算';
    meter.querySelector('[data-regime-source]').textContent=data?`${data.tradeDate} · ${data.coverageLabel}${entry().refreshError?' · 刷新失败，保留上次有效快照':''}`:'独立快照尚不可用 · 缺表、未发布或篮子历史不足';
    scale.setAttribute('aria-label',data?`${data.tradeDate} A股综合状态：${data.label}，${data.value}/100`:'偏熊至偏牛色带；尚未计算，无指针');
    if(data) {
      pointer.style.left=data.value+'%';pointer.dataset.value=data.value;
      if(old!==null&&old!==data.value) animateContext(pointer,[{left:old+'%'},{left:data.value+'%'}],{slow:true});
    }
  }
  function render({move=false}={}) {
    const isPulse=state.scope===pulse,showScan=!isPulse&&state.view==='radar',current=entry();
    root.dataset.contextView=showScan?'radar':'leaders';
    viewButtons.hidden=isPulse;oldViewport.hidden=showScan;scanViewport.hidden=!showScan;
    root.querySelector('#indexRadarStatus').hidden=showScan; // Scan owns its own date; never borrow the Top 5 date.
    root.querySelector('#indexRadarHelpButton').hidden=showScan; // Each scan panel owns its guide; the old guide describes Top 5.
    viewButtons.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.insightsView===state.view)));
    const slot=isPulse?headerSlot:footerSlot;
    if(meter.parentElement!==slot) slot.append(meter);
    headerSlot.hidden=!isPulse;footerSlot.hidden=isPulse;
    updateMeter(current.regime,current.status);
    const scan=current.scan,win=scan?.windows[period()];
    scanViewport.querySelectorAll('[data-scan-window]').forEach(b=>{
      b.setAttribute('aria-pressed',String(b.dataset.scanWindow===period()));
      const value=scan?.windows[b.dataset.scanWindow];
      b.querySelector('[data-window-availability]').textContent=value?`${value.baselineDate} → ${scan.tradeDate}`:scan?'历史不足':waiting[current.status]||'待接入';
    });
    scanViewport.querySelector('[data-insights-retry]').hidden=!current.refreshError&&!['error','invalid'].includes(current.status);
    scanViewport.querySelector('.market-scan-status').textContent=scan
      ?`Official Close · ${scan.tradeDate} · ${scan.coverageLabel} · ${win?SCAN_WINDOWS.find(w=>w.id===period()).label:'变化窗口历史不足'}${current.refreshError?' · 刷新失败，保留上次有效快照':''}`
      :`${waiting[current.status]||waiting.empty}。当前无真实点位；原有榜单与 Pulse 仍可使用。`;
    draw({move});
  }
  async function load({force=false}={}) {
    const scope=state.scope,retained=state.cache.get(scope);
    if(state.loading.has(scope)||(!force&&retained&&!isMarketContextCacheStale(retained))) return;
    state.loading.add(scope);
    if(!retained) {state.cache.set(scope,{status:'loading',scan:null,regime:null});render();}
    try {
      const result=await source({scope});
      if(destroyed) return;
      if(!result||!['ready','not_configured','empty'].includes(result.status)) throw new Error('Invalid insights response');
      if(result.status!=='ready'&&(result.scan||result.regime)) throw new Error('Unexpected data in an unavailable response');
      const scan=normalizeScan(result.scan,scope),regime=normalizeRegime(result.regime);
      if((result.scan&&!scan)||(result.regime&&!regime)) {
        if(retained?.scan||retained?.regime) throw new Error('Incompatible insights snapshot');
        state.cache.set(scope,{status:'invalid',scan:null,regime:null,...marketContextCacheStamp()});
      } else {
        if(result.status==='ready'&&!scan&&!regime) throw new Error('Empty ready snapshot');
        if((retained?.scan&&!scan)||(retained?.regime&&!regime)) throw new Error('Previously valid snapshot missing');
        state.cache.set(scope,{status:result.status,scan,regime,...marketContextCacheStamp()});
      }
    } catch {
      if(destroyed) return;
      state.cache.set(scope,retained&&(retained.scan||retained.regime)?{...retained,refreshError:true}:{status:'error',scan:null,regime:null});
    } finally {
      state.loading.delete(scope);
      if(!destroyed&&state.scope===scope) render({move:true});
    }
  }
  function onClick(event) {
    const button=event.target.closest('button');
    if(!button) return;
    if(button.dataset.insightsView) {
      if(state.view===button.dataset.insightsView) return;
      transitionContext(frame,()=>{state.view=button.dataset.insightsView;render();});
    } else if(button.dataset.scanWindow) {
      state.periods.set(state.scope,button.dataset.scanWindow);render({move:true});
    } else if(button.hasAttribute('data-insights-retry')) load({force:true});
    else if(button.dataset.insightsHelp) {
      const key=button.dataset.insightsHelp,[title,explanation]=help[key];
      const data=key==='regime'?entry().regime:entry().scan;
      const provenance=data?`<p>数据日期：${esc(data.tradeDate)} · 算法版本：${esc(data.algorithmVersion)} · ${esc(data.coverageLabel)}</p>`:'<p>尚无可用独立快照：可能尚未部署新表／发布任务，或所需历史不足。不会用旧Top5或Pulse分数冒充新结果。</p>';
      const formula=key==='regime'?'':'<p>Insights v1：5日动量25% + 20日动量35% + MA60位置25% + MA20斜率15%，经20日波动率归一化（下限0.5%）和tanh映射为0–100强度；50为中性参照，不是原榜单入选分。最强仅为有效候选内相对较强，下跌市场也有第一名。</p><p>至少62个对齐收盘；60日变化需122日。指数主题全部成员有效才纳入；ETF取20日均成交额最高且达2,000万元的主题代表，变化始终比较同一当前代表。缺失不填补，不足窗口不缩短。变强／变弱只收正／负变化。水平图半径映射强度，变化图按本图最大变化归一化，不可跨图比较距离。</p>';
      openHelp(title,`<div class="index-radar-detail"><p>${esc(explanation)}</p>${provenance}${formula}${key==='regime'&&data?`<p>${esc(data.explanation)}</p>`:''}<p>主题角度固定，只有径向位置表达该图指标；角度没有行业相关性含义。不改变原有榜单、Pulse 或 Composite Signal。</p></div>`,button);
    }
  }
  function onKeydown(event) {
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
    const button=event.target.closest('[data-insights-view],[data-scan-window]');
    if(!button) return;
    event.preventDefault();
    const selector=button.dataset.insightsView?'[data-insights-view]':'[data-scan-window]';
    const buttons=[...root.querySelectorAll(selector)],index=buttons.indexOf(button);
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+buttons.length)%buttons.length;
    buttons[next].focus();buttons[next].click();
  }
  root.addEventListener('click',onClick);root.addEventListener('keydown',onKeydown);
  const resize=new ResizeObserver(()=>draw());resize.observe(scanViewport);
  render();
  return {
    selectScope(scope) {state.scope=scope;positions=new Map();render();load();},
    refreshIfStale() {load();},
    destroy() {destroyed=true;resize.disconnect();root.removeEventListener('click',onClick);root.removeEventListener('keydown',onKeydown);},
  };
}
