/** Look First Market Pulse rendering adapter. No market-wide calculation occurs here. */
import { loadMarketPulse,loadMarketPulseMembers,PULSE_MEMBER_FILTERS } from '../core/market-pulse-repository.js';
import {
  buildPulseChartModel,
  compatiblePulseHistory,
  escapePulseHtml,
  formatPulseNumber,
  formatPulseSigned,
  normalizePulseSnapshot,
  pulseStateClass,
} from '../pulse/market-pulse-view-model.js';

const GROUPS=Object.freeze({
  participation:{
    title:'Participation',eyebrow:'WHO IS PARTICIPATING',defaultSignal:'strongUp',
    formula:'mean(1D Up Ratio, 5D Up Ratio, Strong Balance)',
    signals:['up1d','down1d','up5d','down5d','strongUp','strongDown'],
  },
  trend:{
    title:'Trend Breadth',eyebrow:'WHERE PRICE AND MA AGREE',defaultSignal:'aboveMA60',
    formula:'mean(Above MA20, Above MA60, MA20 Rising, MA60 Rising)',
    signals:['aboveMA20','belowMA20','aboveMA60','belowMA60','ma20Rising','ma20NotRising','ma60Rising','ma60NotRising'],
  },
  expansion:{
    title:'Expansion',eyebrow:'NEW EXTREMES AND MA60 CROSSES',defaultSignal:'newHigh20',
    formula:'mean(20D High/Low Balance, MA60 BO/BD Balance)',
    signals:['newHigh20','newLow20','ma60Breakout','ma60Breakdown'],
  },
  leadership:{
    title:'Leadership',eyebrow:'THEME AND BROAD-INDEX CONFIRMATION',defaultSignal:'sectorAboveMA60',
    formula:'mean(Theme Above MA60, Theme MA60 Rising, Theme High/Low Balance, Broad Confirmation)',
    signals:['sectorAboveMA60','sectorBelowMA60','sectorMA60Rising','sectorMA60NotRising','sectorNewHigh20','sectorNewLow20','broad'],
  },
});

const byId=id=>document.getElementById(id);

function metric(label,value) {
  return `<span><small>${escapePulseHtml(label)}</small><b>${escapePulseHtml(value)}</b></span>`;
}

function scoreLabel(group) {
  return formatPulseNumber(group?.score,1);
}

function cardMarkup(id,snapshot) {
  const config=GROUPS[id];
  const group=id==='trend'?snapshot.trendBreadth:snapshot[id];
  let cells='';
  if (id==='participation') cells=[
    metric('1D Up',`${formatPulseNumber(group.up_1d_pct,1)}%`),
    metric('5D Up',`${formatPulseNumber(group.up_5d_pct,1)}%`),
    metric('Median',formatPulseSigned(group.median_return_1d_pct,1)),
    metric('Strong U / D',`${group.strong_up_count??0} / ${group.strong_down_count??0}`),
  ].join('');
  if (id==='trend') cells=[
    metric('Above MA20',`${formatPulseNumber(group.above_ma20_pct,1)}%`),
    metric('Above MA60',`${formatPulseNumber(group.above_ma60_pct,1)}%`),
    metric('MA20 Rising',`${formatPulseNumber(group.ma20_rising_pct,1)}%`),
    metric('MA60 Rising',`${formatPulseNumber(group.ma60_rising_pct,1)}%`),
  ].join('');
  if (id==='expansion') cells=[
    metric('20D High',group.new_high_20_count??0),
    metric('20D Low',group.new_low_20_count??0),
    metric('MA60 BO',group.ma60_breakout_count??0),
    metric('MA60 BD',group.ma60_breakdown_count??0),
  ].join('');
  if (id==='leadership') cells=[
    metric('Theme > MA60',`${formatPulseNumber(group.theme_above_ma60_pct,1)}%`),
    metric('Theme MA60 ↑',`${formatPulseNumber(group.theme_ma60_rising_pct,1)}%`),
    metric('20D H / L',`${formatPulseNumber(group.theme_new_high_weight,1)} / ${formatPulseNumber(group.theme_new_low_weight,1)}`),
    metric('Broad Confirm',`${formatPulseNumber(group.broad_confirmation_pct,0)}%`),
  ].join('');
  return `<button type="button" class="fibo-card market-pulse-card" data-market-pulse-group="${id}" aria-label="Open ${escapePulseHtml(config.title)} official member details">
    <span class="market-pulse-card__header"><span><small>${escapePulseHtml(config.eyebrow)}</small><strong>${escapePulseHtml(config.title)}</strong></span><b class="market-pulse-score ${pulseStateClass(group?.score)}">${scoreLabel(group)}</b></span>
    <span class="market-pulse-card__metrics">${cells}</span>
  </button>`;
}

function messageMarkup(title,message,{ retry=false,error=false }={}) {
  return `<div class="index-radar-message${error?' is-error':''}">
    <span class="material-icons" aria-hidden="true">${error?'cloud_off':'monitor_heart'}</span>
    <span><strong>${escapePulseHtml(title)}</strong><small>${escapePulseHtml(message)}</small></span>
    ${retry?'<button type="button" class="fibo-button fibo-button--control" data-market-pulse-retry>Retry</button>':''}
  </div>`;
}

function statusWarning(checkpoint) {
  if (checkpoint?.last_status==='error') return `<span class="index-radar-sync-warning" title="${escapePulseHtml(checkpoint.last_error||'Latest Pulse publication failed.')}"><span class="material-icons" aria-hidden="true">error_outline</span>Last sync failed</span>`;
  if (checkpoint?.last_status==='running') return '<span class="index-radar-sync-running"><span class="material-icons" aria-hidden="true">sync</span>Syncing</span>';
  return '';
}

function chartSummary(history) {
  if (!history.length) return 'No compatible Market Pulse history.';
  const scores=history.map(item=>item.score);
  const latest=history.at(-1);
  return `${history.length} official sessions. Latest ${latest.tradeDate}: ${latest.score.toFixed(1)}, ${latest.state}. Range ${Math.min(...scores).toFixed(1)} to ${Math.max(...scores).toFixed(1)}. Strength Gate is 60. Risk Gate is 20.`;
}

function dashboardMarkup(snapshot,history) {
  const coverage=history.length===60?'History 60/60':`History ${history.length}/60 · Building`;
  const firstDate=history[0]?.tradeDate||snapshot.tradeDate;
  const lastDate=history.at(-1)?.tradeDate||snapshot.tradeDate;
  return `<div class="market-pulse-dashboard">
    <div class="market-pulse-cards-viewport" aria-label="Market Pulse component scores"><div class="market-pulse-card-grid">
      ${Object.keys(GROUPS).map(id=>cardMarkup(id,snapshot)).join('')}
    </div></div>
    <section class="fibo-card market-pulse-chart-card" aria-labelledby="marketPulseChartTitle">
      <div class="market-pulse-chart__header"><span><small>60 OFFICIAL SESSIONS</small><strong id="marketPulseChartTitle">FIBO MARKET PULSE</strong><span class="market-pulse-chart__coverage">${escapePulseHtml(coverage)}</span></span><span class="market-pulse-chart__current"><b>${formatPulseNumber(snapshot.score,1)}</b><small>${escapePulseHtml(snapshot.state)}</small></span></div>
      <div class="market-pulse-chart__plot"><canvas id="marketPulseChart" tabindex="0" role="img" aria-label="${escapePulseHtml(chartSummary(history))}"></canvas><div class="market-pulse-chart__tooltip" id="marketPulseChartTooltip" role="status" aria-live="polite" hidden></div></div>
      <div class="market-pulse-chart__footer"><span class="market-pulse-chart__date market-pulse-chart__date--start">${escapePulseHtml(firstDate)}</span><span class="market-pulse-chart__gates" aria-label="Strength Gate 60; Risk Gate 20"><span class="market-pulse-chart__gate market-pulse-chart__gate--strength"><i></i><span class="market-pulse-chart__gate-full">60 · Strength Gate</span><span class="market-pulse-chart__gate-short">S60</span></span><span class="market-pulse-chart__gate market-pulse-chart__gate--risk"><i></i><span class="market-pulse-chart__gate-full">20 · Risk Gate</span><span class="market-pulse-chart__gate-short">R20</span></span></span><span class="market-pulse-chart__date market-pulse-chart__date--end">${escapePulseHtml(lastDate)}</span></div>
    </section>
  </div>`;
}

function css(name,fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()||fallback;
}

function flagSummary(row) {
  const flags=[];
  if (row.strong_up) flags.push('Strong Up');
  if (row.strong_down) flags.push('Strong Down');
  if (row.new_high_20) flags.push('20D High');
  if (row.new_low_20) flags.push('20D Low');
  if (row.ma60_breakout) flags.push('MA60 BO');
  if (row.ma60_breakdown) flags.push('MA60 BD');
  return flags.join(' · ')||`${row.above_ma60?'Above':'Below'} MA60`;
}

export function createMarketPulseController({ client,setStatus,openModal }) {
  const state={
    cache:null,loading:false,active:false,snapshot:null,history:[],checkpoint:null,
    resizeObserver:null,chartModel:null,chartIndex:null,
    group:null,signal:null,page:0,search:'',memberResult:null,requestToken:0,
  };

  function disconnectChart() {
    state.resizeObserver?.disconnect();
    state.resizeObserver=null;
    state.chartModel=null;
  }

  function drawChart() {
    const canvas=byId('marketPulseChart');
    if (!canvas) return;
    const rect=canvas.getBoundingClientRect();
    const width=Math.max(280,Math.round(rect.width));
    const height=Math.max(180,Math.round(rect.height));
    const ratio=Math.max(1,window.devicePixelRatio||1);
    canvas.width=Math.round(width*ratio);
    canvas.height=Math.round(height*ratio);
    const context=canvas.getContext('2d');
    context.setTransform(ratio,0,0,ratio,0,0);
    context.clearRect(0,0,width,height);
    const model=buildPulseChartModel(state.history,{ width,height });
    state.chartModel=model;
    context.font=`10px ${css('--font-family-sans','Arial')}`;
    context.textBaseline='middle';
    for (const threshold of model.thresholds) {
      context.setLineDash([3,4]);
      context.strokeStyle=css(threshold.colorToken,threshold.fallback);
      context.beginPath();context.moveTo(model.padding.left,threshold.y);context.lineTo(width-model.padding.right,threshold.y);context.stroke();
      context.fillStyle=threshold.label?css(threshold.colorToken,threshold.fallback):css('--color-text-tertiary','#80868b');
      context.fillText(String(threshold.value),8,threshold.y);
    }
    context.setLineDash([]);
    if (model.points.length) {
      const gradient=context.createLinearGradient(0,model.padding.top,0,height-model.padding.bottom);
      gradient.addColorStop(0,'rgba(66,133,244,.16)');gradient.addColorStop(1,'rgba(66,133,244,0)');
      context.beginPath();context.moveTo(model.points[0].x,height-model.padding.bottom);
      for (const point of model.points) context.lineTo(point.x,point.y);
      context.lineTo(model.points.at(-1).x,height-model.padding.bottom);context.closePath();context.fillStyle=gradient;context.fill();
      context.beginPath();
      model.points.forEach((point,index)=>index?context.lineTo(point.x,point.y):context.moveTo(point.x,point.y));
      context.strokeStyle=css('--color-primary','#4285f4');context.lineWidth=2;context.stroke();
      const latest=model.points.at(-1);
      context.beginPath();context.arc(latest.x,latest.y,4,0,Math.PI*2);context.fillStyle=css('--color-primary','#4285f4');context.fill();
    }
  }

  function showChartPoint(index,{ focus=false }={}) {
    const tooltip=byId('marketPulseChartTooltip');
    const canvas=byId('marketPulseChart');
    const points=state.chartModel?.points||[];
    if (!tooltip || !canvas || !points.length) return;
    const safe=Math.max(0,Math.min(points.length-1,index));
    const point=points[safe];state.chartIndex=safe;
    tooltip.hidden=false;
    tooltip.innerHTML=`<strong>${escapePulseHtml(point.tradeDate)} · ${formatPulseNumber(point.score,1)}</strong><span>${escapePulseHtml(point.state)}</span><small>P ${formatPulseNumber(point.participation.score,1)} · T ${formatPulseNumber(point.trendBreadth.score,1)} · E ${formatPulseNumber(point.expansion.score,1)} · L ${formatPulseNumber(point.leadership.score,1)}</small>`;
    const left=Math.max(4,Math.min(canvas.clientWidth-tooltip.offsetWidth-4,point.x-tooltip.offsetWidth/2));
    tooltip.style.left=`${left}px`;tooltip.style.top=`${Math.max(2,point.y-tooltip.offsetHeight-8)}px`;
    if (focus) canvas.setAttribute('aria-label',`${point.tradeDate}: Pulse ${point.score.toFixed(1)}, ${point.state}. Participation ${Number(point.participation.score).toFixed(1)}, Trend ${Number(point.trendBreadth.score).toFixed(1)}, Expansion ${Number(point.expansion.score).toFixed(1)}, Leadership ${Number(point.leadership.score).toFixed(1)}. Strength Gate is 60. Risk Gate is 20.`);
  }

  function bindChart() {
    disconnectChart();drawChart();
    const canvas=byId('marketPulseChart');
    if (!canvas) return;
    state.resizeObserver=new ResizeObserver(drawChart);state.resizeObserver.observe(canvas);
    canvas.addEventListener('pointermove',event=>{
      const points=state.chartModel?.points||[];if (!points.length) return;
      const x=event.clientX-canvas.getBoundingClientRect().left;
      let nearest=0;for (let index=1;index<points.length;index++) if (Math.abs(points[index].x-x)<Math.abs(points[nearest].x-x)) nearest=index;
      showChartPoint(nearest);
    });
    canvas.addEventListener('pointerleave',()=>{ const tip=byId('marketPulseChartTooltip');if(tip)tip.hidden=true; });
    canvas.addEventListener('click',event=>{
      const points=state.chartModel?.points||[];if (!points.length) return;
      const x=event.clientX-canvas.getBoundingClientRect().left;
      let nearest=0;for (let index=1;index<points.length;index++) if (Math.abs(points[index].x-x)<Math.abs(points[nearest].x-x)) nearest=index;
      showChartPoint(nearest,{ focus:true });
    });
    canvas.addEventListener('keydown',event=>{
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();const last=(state.chartModel?.points.length||1)-1;
      const next=event.key==='Home'?0:event.key==='End'?last:Math.max(0,Math.min(last,(state.chartIndex??last)+(event.key==='ArrowRight'?1:-1)));
      showChartPoint(next,{ focus:true });
    });
  }

  function render() {
    const viewport=byId('indexRadarViewport');
    if (!viewport || !state.snapshot) return;
    setStatus(`<span class="fibo-analysis-source fibo-analysis-source--official">Official Close · ${escapePulseHtml(state.snapshot.tradeDate)}</span>${statusWarning(state.checkpoint)}`);
    viewport.innerHTML=dashboardMarkup(state.snapshot,state.history);
    bindChart();
  }

  async function activate({ force=false }={}) {
    state.active=true;
    if (!force && state.cache) {
      ({ snapshot:state.snapshot,history:state.history,checkpoint:state.checkpoint }=state.cache);render();return;
    }
    if (state.loading) return;
    state.loading=true;
    disconnectChart();
    setStatus('<span class="index-radar-loading-label"><span class="material-icons" aria-hidden="true">sync</span>Loading official Pulse…</span>');
    const viewport=byId('indexRadarViewport');
    if (viewport) viewport.innerHTML=messageMarkup('Loading Market Pulse','Reading the latest precomputed official-close breadth snapshot.');
    try {
      const result=await loadMarketPulse(client);
      if (result.error) throw result.error;
      const snapshot=normalizePulseSnapshot(result.snapshot);
      if (!snapshot) {
        setStatus('Waiting for first Market Pulse Backfill');
        if (viewport) viewport.innerHTML=messageMarkup('Market Pulse is not ready','Apply the Pulse migration, then run smoke / pulse and backfill / pulse.',{ retry:true });
        return;
      }
      const history=compatiblePulseHistory(result.historyError?[]:result.snapshots,result.snapshot);
      state.cache={ snapshot,history,checkpoint:result.checkpoint,historyError:result.historyError||null };
      state.snapshot=snapshot;state.history=history;state.checkpoint=result.checkpoint;
      if (state.active) render();
    } catch (error) {
      setStatus('<span class="index-radar-sync-warning"><span class="material-icons" aria-hidden="true">error_outline</span>Pulse unavailable</span>','is-error');
      if (viewport) viewport.innerHTML=messageMarkup('Could not load Market Pulse',error?.message||'The Supabase snapshot request failed.',{ retry:true,error:true });
    } finally { state.loading=false; }
  }

  function deactivate() { state.active=false;disconnectChart(); }

  function detailShell() {
    const config=GROUPS[state.group];
    const filters=config.signals.map(id=>`<button type="button" class="market-pulse-filter${state.signal===id?' is-active':''}" data-pulse-filter="${id}" aria-pressed="${state.signal===id}">${escapePulseHtml(PULSE_MEMBER_FILTERS[id].label)}</button>`).join('');
    return `<div class="market-pulse-detail" data-pulse-detail>
      <div class="market-pulse-detail__source"><span class="fibo-analysis-source fibo-analysis-source--official">Official Close · ${escapePulseHtml(state.snapshot.tradeDate)}</span><span>${state.snapshot.stockEligibleCount.toLocaleString()} stocks · ${state.snapshot.indexEligibleCount.toLocaleString()} indices</span></div>
      <p class="market-pulse-detail__formula"><code>${escapePulseHtml(config.formula)}</code></p>
      <div class="market-pulse-filter-track" role="group" aria-label="${escapePulseHtml(config.title)} member filter">${filters}</div>
      <form class="market-pulse-search" data-pulse-search-form><label for="marketPulseMemberSearch">Search name or code</label><span><input id="marketPulseMemberSearch" type="search" value="${escapePulseHtml(state.search)}" maxlength="60" autocomplete="off"><button type="submit" class="fibo-button fibo-button--control">Search</button></span></form>
      <div class="market-pulse-member-status" id="marketPulseMemberStatus" aria-live="polite">Loading official members…</div>
      <div class="market-pulse-member-list" id="marketPulseMemberList"></div>
      <div class="market-pulse-pagination" id="marketPulsePagination"></div>
      <p class="index-radar-disclaimer">Official-close breadth context only. Membership is not a recommendation and never changes Composite Signal.</p>
    </div>`;
  }

  function renderMemberResult(result) {
    const status=byId('marketPulseMemberStatus');const list=byId('marketPulseMemberList');const pagination=byId('marketPulsePagination');
    if (!status || !list || !pagination) return;
    if (result.error) { status.textContent='Could not load this member list.';list.innerHTML='';pagination.innerHTML='';return; }
    const total=result.count;const start=total?result.page*result.pageSize+1:0;const end=Math.min(total,(result.page+1)*result.pageSize);
    status.textContent=`${result.filter.label} · ${total.toLocaleString()} members · ${start}–${end}`;
    list.innerHTML=result.rows.length?result.rows.map(row=>`<div class="market-pulse-member-row">
      <span class="market-pulse-member-name"><strong>${escapePulseHtml(row.name)}</strong><small>${escapePulseHtml(row.market)} · ${escapePulseHtml(row.code)}${row.theme_group?` · ${escapePulseHtml(row.theme_group)}`:''}</small></span>
      <span><small>1D</small><b>${formatPulseSigned(row.return_1d,2)}</b></span>
      <span><small>5D</small><b>${formatPulseSigned(row.return_5d,2)}</b></span>
      <span><small>vs MA60</small><b>${formatPulseSigned(row.distance_ma60_pct,2)}</b></span>
      <span class="market-pulse-member-flags">${escapePulseHtml(flagSummary(row))}</span>
    </div>`).join(''):'<div class="market-pulse-member-empty">No official member matches this filter and search.</div>';
    const pages=Math.max(1,Math.ceil(total/result.pageSize));
    pagination.innerHTML=`<button type="button" class="fibo-button fibo-button--control" data-pulse-page="${result.page-1}" ${result.page<=0?'disabled':''}>Previous</button><span>Page ${result.page+1} / ${pages}</span><button type="button" class="fibo-button fibo-button--control" data-pulse-page="${result.page+1}" ${result.page+1>=pages?'disabled':''}>Next</button>`;
  }

  async function loadMembers() {
    const token=++state.requestToken;
    const status=byId('marketPulseMemberStatus');if(status)status.textContent='Loading official members…';
    try {
      const result=await loadMarketPulseMembers(client,{
        tradeDate:state.snapshot.tradeDate,calculationId:state.snapshot.calculationId,
        signal:state.signal,page:state.page,pageSize:50,search:state.search,
      });
      if (token!==state.requestToken) return;
      state.memberResult=result;renderMemberResult(result);
    } catch (error) {
      if (token!==state.requestToken) return;
      renderMemberResult({ rows:[],count:0,page:state.page,pageSize:50,filter:PULSE_MEMBER_FILTERS[state.signal],error });
    }
  }

  function openGroup(group,trigger) {
    if (!GROUPS[group] || !state.snapshot) return;
    state.group=group;state.signal=GROUPS[group].defaultSignal;state.page=0;state.search='';
    const title=byId('indexRadarDetailTitle');const content=byId('indexRadarDetailContent');
    if (title) title.textContent=`${GROUPS[group].title} · Market Pulse`;
    if (content) content.innerHTML=detailShell();
    openModal(byId('indexRadarDetailBackdrop'),trigger);loadMembers();
  }

  function handleViewportClick(event) {
    const retry=event.target.closest('[data-market-pulse-retry]');
    if (retry) { activate({ force:true });return true; }
    const card=event.target.closest('[data-market-pulse-group]');
    if (card) { openGroup(card.dataset.marketPulseGroup,card);return true; }
    return false;
  }

  function handleDetailClick(event) {
    if (!event.target.closest('[data-pulse-detail]')) return false;
    const filter=event.target.closest('[data-pulse-filter]');
    if (filter && PULSE_MEMBER_FILTERS[filter.dataset.pulseFilter]) {
      state.signal=filter.dataset.pulseFilter;state.page=0;
      byId('indexRadarDetailContent').innerHTML=detailShell();loadMembers();return true;
    }
    const page=event.target.closest('[data-pulse-page]');
    if (page && !page.disabled) { state.page=Math.max(0,Number(page.dataset.pulsePage)||0);loadMembers();return true; }
    return false;
  }

  function handleDetailSubmit(event) {
    if (!event.target.matches('[data-pulse-search-form]')) return false;
    event.preventDefault();state.search=String(byId('marketPulseMemberSearch')?.value||'').trim();state.page=0;loadMembers();return true;
  }

  return { activate,deactivate,handleViewportClick,handleDetailClick,handleDetailSubmit };
}
