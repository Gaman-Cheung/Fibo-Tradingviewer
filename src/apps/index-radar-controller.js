/**
 * Look First Index Radar DOM controller.
 * Allowed: DOM and shared Radar repository/view model. Forbidden: calculating
 * market rankings, reading Pool identity or writing Terminal/Tracker state.
 */
import { loadLatestIndexRadar } from '../core/index-radar-repository.js';
import { INDEX_RADAR_GUIDE_HTML } from '../radar/radar-help.js';
import {
  buildLeadershipMemory,
  findLeadershipPeriod,
  radarThemeKey,
} from '../radar/radar-memory.js';
import {
  escapeRadarHtml,
  formatRadarNumber,
  formatRadarSigned,
  normalizeRadarSnapshot,
  primaryRadarEvents,
} from '../radar/radar-view-model.js';

const state = {
  client:null,
  snapshot:null,
  memory:null,
  historyError:null,
  activeMemoryPeriod:null,
  expandedMemoryPeriod:null,
  loading:false,
  bound:false,
  returnFocus:null,
};

const byId = id => document.getElementById(id);

function eventBadges(leader) {
  const events = primaryRadarEvents(leader);
  if (!events.length) return '<span class="index-radar-badge index-radar-badge--quiet">Trend Leader</span>';
  return events.map(event => `<span class="index-radar-badge${event.kind === 'context' ? ' index-radar-badge--context' : ''}">${escapeRadarHtml(event.label)}</span>`).join('');
}

function riskBadges(leader) {
  return (leader.risks || []).map(risk => `<span class="index-radar-risk"><span class="material-icons" aria-hidden="true">warning_amber</span>${escapeRadarHtml(risk.label)}</span>`).join('');
}

function appearanceStats(leader) {
  return (!state.historyError && state.memory?.currentAppearances?.[radarThemeKey(leader)]) || {
    consecutive:leader?.appearances?.consecutive || 1,
    days13:null,
    days60:null,
  };
}

function appearanceLabel(leader) {
  const stats=appearanceStats(leader);
  const days13=stats.days13===null?'—':stats.days13;
  const days60=stats.days60===null?'—':stats.days60;
  return `Consecutive ${stats.consecutive}D · 13D ${days13}× · 60D ${days60}×`;
}

function cardMarkup(leader,index) {
  const coverage=state.memory
    ? `Leadership Memory uses ${state.memory.sessionsAvailable}/${state.memory.historyTarget} compatible official sessions.`
    : 'Leadership Memory history is unavailable.';
  return `<button class="fibo-card fibo-card--brand-ring index-radar-card" type="button" data-index-radar-leader="${index}" aria-label="Open details for rank ${leader.rank} ${escapeRadarHtml(leader.name)}">
    <span class="index-radar-card__top">
      <span class="index-radar-rank">#${leader.rank}</span>
      <span class="index-radar-symbol">${escapeRadarHtml(leader.market)} · ${escapeRadarHtml(leader.code)}</span>
    </span>
    <strong class="index-radar-name">${escapeRadarHtml(leader.name)}</strong>
    <span class="index-radar-events">${eventBadges(leader)}</span>
    <span class="index-radar-rs">
      <span><small>RS5</small><b>${formatRadarSigned(leader.metrics.rs5)}</b></span>
      <span><small>RS20</small><b>${formatRadarSigned(leader.metrics.rs20)}</b></span>
      <span><small>Score</small><b>${formatRadarNumber(leader.score,1)}</b></span>
    </span>
    <span class="index-radar-history" title="${escapeRadarHtml(coverage)}">${appearanceLabel(leader)}</span>
    ${riskBadges(leader)}
  </button>`;
}

function setStatus(content,className='') {
  const node = byId('indexRadarStatus');
  if (!node) return;
  node.className = `index-radar-status ${className}`.trim();
  node.innerHTML = content;
}

function messageMarkup(title,message,{retry=false,error=false}={}) {
  return `<div class="index-radar-message${error ? ' is-error' : ''}">
    <span class="material-icons" aria-hidden="true">${error ? 'cloud_off' : 'radar'}</span>
    <span><strong>${escapeRadarHtml(title)}</strong><small>${escapeRadarHtml(message)}</small></span>
    ${retry ? '<button type="button" class="fibo-button fibo-button--control" data-index-radar-retry>Retry</button>' : ''}
  </div>`;
}

function renderMessage(title,message,options={}) {
  const viewport = byId('indexRadarViewport');
  if (viewport) viewport.innerHTML=messageMarkup(title,message,options);
}

function memoryCoverage(period) {
  if (state.historyError) return 'History unavailable';
  if (!period) return 'History unavailable';
  if (period.id==='yesterday') return period.complete?'1/1 session':'0/1 · Building';
  return `${period.sessionsUsed}/${period.target}${period.complete?' sessions':' · Building'}`;
}

function memoryLeaderChip(leader,index) {
  return `<span class="index-radar-memory-chip" title="${escapeRadarHtml(leader.representative?.name||leader.displayLabel)}"><b>#${index+1}</b><span>${escapeRadarHtml(leader.displayLabel)}</span></span>`;
}

function memoryCardMarkup(period) {
  const leaders=state.historyError?[]:(period?.leaders||[]).slice(0,3);
  const summary=leaders.length
    ? leaders.map(memoryLeaderChip).join('')
    : `<span class="index-radar-memory-empty">${state.historyError?'Unavailable':'Waiting for history'}</span>`;
  const disabled=state.historyError || !period?.sessionsUsed;
  return `<button type="button" class="fibo-card index-radar-memory-card" data-index-radar-memory="${escapeRadarHtml(period?.id||'')}" ${disabled?'disabled':''} aria-label="Open ${escapeRadarHtml(period?.label||'Leadership Memory')} ranking">
    <span class="index-radar-memory-card__top"><strong>${escapeRadarHtml(period?.label||'History')}</strong><small>${escapeRadarHtml(memoryCoverage(period))}</small></span>
    <span class="index-radar-memory-card__leaders">${summary}</span>
    <span class="material-icons index-radar-memory-card__arrow" aria-hidden="true">chevron_right</span>
  </button>`;
}

function memoryPanelMarkup() {
  const periods=state.memory?.periods||[];
  if (!periods.length) return '';
  return `<aside class="index-radar-memory" aria-label="Leadership Memory historical rankings">
    <div class="index-radar-memory-track">${periods.map(memoryCardMarkup).join('')}</div>
  </aside>`;
}

function renderSnapshot(snapshot,checkpoint) {
  const viewport = byId('indexRadarViewport');
  if (!viewport) return;
  const warning = checkpoint?.last_status === 'error'
    ? `<span class="index-radar-sync-warning" title="${escapeRadarHtml(checkpoint.last_error || 'Latest index synchronization failed.')}"><span class="material-icons" aria-hidden="true">error_outline</span>Last sync failed</span>`
    : checkpoint?.last_status === 'running'
      ? '<span class="index-radar-sync-running"><span class="material-icons" aria-hidden="true">sync</span>Syncing</span>'
      : '';
  if (!snapshot.leaders.length) {
    setStatus(`<span class="fibo-analysis-source fibo-analysis-source--official">Official Close · ${escapeRadarHtml(snapshot.tradeDate)}</span>${warning}`);
    viewport.innerHTML=`<div class="index-radar-dashboard">
      <div class="index-radar-leaders-viewport">${messageMarkup('No qualified sector leader','No sector or theme crossed the 60-point quality gate for this official session.')}</div>
      ${memoryPanelMarkup()}
    </div>`;
    return;
  }
  setStatus(`<span class="fibo-analysis-source fibo-analysis-source--official">Official Close · ${escapeRadarHtml(snapshot.tradeDate)}</span>${warning}`);
  const leaders=snapshot.leaders.map((leader,index)=>cardMarkup(leader,index)).join('');
  viewport.innerHTML = `<div class="index-radar-dashboard">
    <div class="index-radar-leaders-viewport">
      <div class="index-radar-group" data-count="${snapshot.leaders.length}">${leaders}</div>
    </div>
    ${memoryPanelMarkup()}
  </div>`;
}

function metricRow(label,value) {
  return `<div class="index-radar-detail-metric"><small>${escapeRadarHtml(label)}</small><strong>${escapeRadarHtml(value)}</strong></div>`;
}

function openModal(backdrop,trigger) {
  if (!backdrop) return;
  state.returnFocus = trigger || document.activeElement;
  backdrop.classList.add('open');
  backdrop.setAttribute('aria-hidden','false');
  byId('indexRadar')?.classList.add('is-paused');
  requestAnimationFrame(() => backdrop.querySelector('button')?.focus());
}

function closeModal(backdrop) {
  if (!backdrop) return;
  backdrop.classList.remove('open');
  backdrop.setAttribute('aria-hidden','true');
  if (!document.querySelector('.index-radar-modal-backdrop.open')) byId('indexRadar')?.classList.remove('is-paused');
  state.returnFocus?.focus?.();
  state.returnFocus = null;
}

function openGuide(trigger) {
  const content = byId('indexRadarHelpContent');
  if (content) content.innerHTML = INDEX_RADAR_GUIDE_HTML;
  openModal(byId('indexRadarHelpBackdrop'),trigger);
}

function openDetails(index,trigger) {
  const leader = state.snapshot?.leaders?.[Number(index)];
  if (!leader) return;
  const title = byId('indexRadarDetailTitle');
  const content = byId('indexRadarDetailContent');
  if (title) title.textContent = `#${leader.rank} ${leader.name}`;
  if (content) {
    const breakdown = leader.scoreBreakdown || {};
    const history=appearanceStats(leader);
    const historyCoverage=state.memory?`${state.memory.sessionsAvailable}/${state.memory.historyTarget} compatible sessions`:'history unavailable';
    const events = (leader.events || []).map(event => `<li><strong>${escapeRadarHtml(event.label)}</strong><span>${Number(event.points || 0) ? `+${Number(event.points)} points` : 'Context only'}</span></li>`).join('') || '<li><strong>No fresh event</strong><span>Qualified through relative strength and trend.</span></li>';
    const risks = (leader.risks || []).map(risk => `<li><strong>${escapeRadarHtml(risk.label)}</strong><span>−${Number(risk.penalty || 0)} points</span></li>`).join('') || '<li><strong>No active Radar risk flag</strong><span>Risk can still exist outside this model.</span></li>';
    content.innerHTML = `<div class="index-radar-detail">
      <div class="index-radar-detail__source"><span class="fibo-analysis-source fibo-analysis-source--official">Official Close · ${escapeRadarHtml(state.snapshot.tradeDate)}</span><span>${escapeRadarHtml(leader.market)} · ${escapeRadarHtml(leader.code)} · ${escapeRadarHtml(leader.themeLabel || leader.themeGroup)}</span></div>
      <section><h3>Score ${formatRadarNumber(leader.score,1)}</h3><div class="index-radar-detail-grid">
        ${metricRow('RS5 rank points',formatRadarNumber(breakdown.rs5,2))}
        ${metricRow('RS20 rank points',formatRadarNumber(breakdown.rs20,2))}
        ${metricRow('Trend',formatRadarNumber(breakdown.trend,0))}
        ${metricRow('Event cap',formatRadarNumber(breakdown.event,0))}
        ${metricRow('Risk deduction',`−${formatRadarNumber(breakdown.risk,0)}`)}
      </div></section>
      <section><h3>Market structure</h3><div class="index-radar-detail-grid">
        ${metricRow('Close',formatRadarNumber(leader.metrics.close,4))}
        ${metricRow('1D return',formatRadarSigned(leader.metrics.return1D))}
        ${metricRow('3D return',formatRadarSigned(leader.metrics.return3D))}
        ${metricRow('5D return',formatRadarSigned(leader.metrics.return5D))}
        ${metricRow('20D return',formatRadarSigned(leader.metrics.return20D))}
        ${metricRow('CSI300 5D return',formatRadarSigned(leader.metrics.benchmarkReturn5D))}
        ${metricRow('CSI300 20D return',formatRadarSigned(leader.metrics.benchmarkReturn20D))}
        ${metricRow('5D RS vs CSI300',formatRadarSigned(leader.metrics.rs5))}
        ${metricRow('20D RS vs CSI300',formatRadarSigned(leader.metrics.rs20))}
        ${metricRow('MA20',formatRadarNumber(leader.metrics.ma20,4))}
        ${metricRow('MA60',formatRadarNumber(leader.metrics.ma60,4))}
        ${metricRow('MA60 slope',formatRadarSigned(leader.metrics.ma60SlopePct,4))}
        ${metricRow('Distance to MA60',formatRadarSigned(leader.metrics.distanceMA60Pct))}
      </div></section>
      <section class="index-radar-detail-columns"><div><h3>Events</h3><ul>${events}</ul></div><div><h3>Risks</h3><ul>${risks}</ul></div></section>
      <section><h3>Leadership Memory</h3><p>Consecutive <strong>${history.consecutive}D</strong> · 13D <strong>${history.days13??'—'}×</strong> · 60D <strong>${history.days60??'—'}×</strong>. Counts aggregate final leaders by Theme Group using ${escapeRadarHtml(historyCoverage)}.</p></section>
      <p class="index-radar-disclaimer">Context only. This ranking is not a probability, target price or buy signal and never changes Terminal Composite Signal.</p>
    </div>`;
  }
  openModal(byId('indexRadarDetailBackdrop'),trigger);
}

function memoryStatus(leader,period) {
  if (period.kind==='snapshot') {
    if (leader.currentRank===null) return '<span class="index-radar-memory-status is-out">Out today</span>';
    const label=leader.movement==='up'?'Moved up':leader.movement==='down'?'Moved down':'Unchanged';
    return `<span class="index-radar-memory-status is-current">Today #${leader.currentRank} · ${label}</span>`;
  }
  return leader.isCurrent
    ? `<span class="index-radar-memory-status is-current">Current #${leader.currentRank}</span>`
    : `<span class="index-radar-memory-status">Last Seen ${leader.lastSeenSessionsAgo} sessions ago</span>`;
}

function memoryRankingRow(leader,period) {
  const representative=leader.representative||{};
  const metric=period.kind==='snapshot'
    ? `<span><small>Previous rank</small><b>#${leader.rank}</b></span><span><small>Today</small><b>${leader.currentRank===null?'Out':`#${leader.currentRank}`}</b></span>`
    : `<span><small>Appearances</small><b>${leader.appearances}/${period.sessionsUsed}</b></span><span><small>Avg rank</small><b>#${formatRadarNumber(leader.averageRank,1)}</b></span><span><small>Leadership</small><b>${formatRadarNumber(leader.leadershipScore,1)}</b></span>`;
  return `<div class="index-radar-memory-ranking-row" role="listitem">
    <span class="index-radar-memory-ranking-rank">#${leader.rank}</span>
    <span class="index-radar-memory-ranking-name"><strong>${escapeRadarHtml(leader.displayLabel)}</strong><small>${escapeRadarHtml(representative.name||'Unknown representative')} · ${escapeRadarHtml(representative.market||'')} ${escapeRadarHtml(representative.code||'')}</small></span>
    <span class="index-radar-memory-ranking-metrics">${metric}</span>
    ${memoryStatus(leader,period)}
  </div>`;
}

function dailyHistoryRow(snapshot) {
  const leaders=(snapshot.leaders||[]).map(leader=>`<span class="index-radar-memory-daily-leader" title="${escapeRadarHtml(leader.name)}"><b>#${leader.rank}</b>${escapeRadarHtml(leader.themeLabel||leader.name)}</span>`).join('') || '<span class="index-radar-memory-empty">No qualified leader</span>';
  return `<div class="index-radar-memory-daily-row"><time datetime="${escapeRadarHtml(snapshot.tradeDate)}">${escapeRadarHtml(snapshot.tradeDate)}</time><span class="index-radar-memory-daily-leaders">${leaders}</span></div>`;
}

function renderMemoryModal() {
  const period=findLeadershipPeriod(state.memory,state.activeMemoryPeriod);
  if (!period) return;
  const title=byId('indexRadarMemoryTitle');
  const content=byId('indexRadarMemoryContent');
  if (title) title.textContent=`${period.label} · Leadership Memory`;
  if (!content) return;
  const ranking=period.leaders.length
    ? period.leaders.map(leader=>memoryRankingRow(leader,period)).join('')
    : '<div class="index-radar-memory-modal-empty">No compatible historical leader is available for this window.</div>';
  const expanded=state.expandedMemoryPeriod===period.id;
  const visibleLimit=period.id==='regime60'&&!expanded?13:period.daily.length;
  const visibleDaily=period.daily.slice(0,visibleLimit);
  const remaining=Math.max(0,period.daily.length-visibleDaily.length);
  const daily=visibleDaily.length
    ? visibleDaily.map(dailyHistoryRow).join('')
    : '<div class="index-radar-memory-modal-empty">Daily history is still building.</div>';
  const formula=period.kind==='snapshot'
    ? 'Yesterday is the exact final Top 5 from the previous official trading session. Today status compares the same Theme Group with the latest list.'
    : 'Daily ranks earn 5 / 4 / 3 / 2 / 1 points. Leadership is the total divided by 5 × available sessions. One Theme Group can score only once per day.';
  content.innerHTML=`<div class="index-radar-memory-modal-content">
    <div class="index-radar-memory-modal-source"><span class="fibo-analysis-source fibo-analysis-source--official">Official sessions · ${escapeRadarHtml(memoryCoverage(period))}</span><span>Leadership Memory v${state.memory.version}</span></div>
    <p class="index-radar-memory-formula">${escapeRadarHtml(formula)}</p>
    <section><h3>Complete ranking</h3><div class="index-radar-memory-ranking" role="list">${ranking}</div></section>
    <section><h3>Daily history</h3><div class="index-radar-memory-daily">${daily}</div>
      ${remaining?`<button type="button" class="fibo-button fibo-button--control index-radar-memory-expand" data-index-radar-memory-expand>Show earlier ${remaining} sessions</button>`:''}
    </section>
    <p class="index-radar-disclaimer">This is persistence among final Top 5 snapshots, not the stored raw ranking of all eligible indices and not a trading signal.</p>
  </div>`;
}

function openMemory(periodId,trigger) {
  const period=findLeadershipPeriod(state.memory,periodId);
  if (!period || !period.sessionsUsed) return;
  state.activeMemoryPeriod=period.id;
  state.expandedMemoryPeriod=null;
  renderMemoryModal();
  openModal(byId('indexRadarMemoryBackdrop'),trigger);
}

function expandMemoryHistory() {
  if (!state.activeMemoryPeriod) return;
  state.expandedMemoryPeriod=state.activeMemoryPeriod;
  renderMemoryModal();
}

async function load() {
  if (!state.client || state.loading) return;
  state.loading = true;
  setStatus('<span class="index-radar-loading-label"><span class="material-icons" aria-hidden="true">sync</span>Loading official index snapshot…</span>');
  renderMessage('Loading Index Radar','Reading the latest precomputed official-close leaderboard.');
  try {
    const result = await loadLatestIndexRadar(state.client);
    if (result.error) throw result.error;
    const snapshot = normalizeRadarSnapshot(result.snapshot);
    if (!snapshot) {
      state.snapshot = null;
      state.memory = null;
      state.historyError = null;
      setStatus('Waiting for first Index Backfill');
      renderMessage('Index Radar is not ready','Run the Index BaoStock smoke and backfill after applying the Radar migration.',{retry:true});
      return;
    }
    state.snapshot = snapshot;
    state.historyError=result.historyError||null;
    state.memory=buildLeadershipMemory(result.historyError?[]:result.snapshots,{ latestSnapshot:result.snapshot });
    renderSnapshot(snapshot,result.checkpoint);
  } catch (error) {
    state.memory=null;
    state.historyError=null;
    setStatus('<span class="index-radar-sync-warning"><span class="material-icons" aria-hidden="true">error_outline</span>Snapshot unavailable</span>','is-error');
    renderMessage('Could not load Index Radar',error?.message || 'The Supabase snapshot request failed.',{retry:true,error:true});
  } finally {
    state.loading = false;
  }
}

function bindEvents() {
  if (state.bound) return;
  state.bound = true;
  byId('indexRadarHelpButton')?.addEventListener('click',event => openGuide(event.currentTarget));
  byId('indexRadarViewport')?.addEventListener('click',event => {
    const retry = event.target.closest('[data-index-radar-retry]');
    if (retry) { load(); return; }
    const memoryCard = event.target.closest('[data-index-radar-memory]');
    if (memoryCard) { openMemory(memoryCard.dataset.indexRadarMemory,memoryCard); return; }
    const card = event.target.closest('[data-index-radar-leader]');
    if (card) openDetails(card.dataset.indexRadarLeader,card);
  });
  byId('indexRadarMemoryContent')?.addEventListener('click',event => {
    if (event.target.closest('[data-index-radar-memory-expand]')) expandMemoryHistory();
  });
  for (const [backdropId,closeId] of [
    ['indexRadarHelpBackdrop','indexRadarHelpClose'],
    ['indexRadarDetailBackdrop','indexRadarDetailClose'],
    ['indexRadarMemoryBackdrop','indexRadarMemoryClose'],
  ]) {
    const backdrop = byId(backdropId);
    byId(closeId)?.addEventListener('click',() => closeModal(backdrop));
    backdrop?.addEventListener('click',event => { if (event.target === backdrop) closeModal(backdrop); });
  }
  document.addEventListener('keydown',event => {
    if (event.key !== 'Escape') return;
    const open = document.querySelector('.index-radar-modal-backdrop.open');
    if (open) closeModal(open);
  });
}

export function initializeIndexRadar({ client }) {
  if (!byId('indexRadar')) return;
  state.client = client;
  bindEvents();
  load();
}
