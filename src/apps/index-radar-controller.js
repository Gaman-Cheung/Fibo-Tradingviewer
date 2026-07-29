/**
 * Look First Index Radar DOM controller.
 * Allowed: DOM and shared Radar repository/view model. Forbidden: calculating
 * market rankings, reading Pool identity or writing Terminal/Tracker state.
 */
import { loadLatestIndexRadar } from '../core/index-radar-repository.js';
import { INDEX_RADAR_GUIDE_HTML } from '../radar/radar-help.js';
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
  loading:false,
  bound:false,
  returnFocus:null,
  resizeTimer:null,
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

function cardMarkup(leader,index,{ clone=false } = {}) {
  const tag = clone ? 'div' : 'button';
  const attributes = clone
    ? 'aria-hidden="true"'
    : `type="button" data-index-radar-leader="${index}" aria-label="Open details for rank ${leader.rank} ${escapeRadarHtml(leader.name)}"`;
  return `<${tag} class="fibo-card fibo-card--brand-ring index-radar-card" ${attributes}>
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
    <span class="index-radar-history">Consecutive ${leader.appearances.consecutive}D · 15D ${leader.appearances.days15}× · 30D ${leader.appearances.days30}×</span>
    ${riskBadges(leader)}
  </${tag}>`;
}

function setStatus(content,className='') {
  const node = byId('indexRadarStatus');
  if (!node) return;
  node.className = `index-radar-status ${className}`.trim();
  node.innerHTML = content;
}

function renderMessage(title,message,{retry=false,error=false}={}) {
  const viewport = byId('indexRadarViewport');
  if (!viewport) return;
  viewport.innerHTML = `<div class="index-radar-message${error ? ' is-error' : ''}">
    <span class="material-icons" aria-hidden="true">${error ? 'cloud_off' : 'radar'}</span>
    <span><strong>${escapeRadarHtml(title)}</strong><small>${escapeRadarHtml(message)}</small></span>
    ${retry ? '<button type="button" class="fibo-button fibo-button--control" data-index-radar-retry>Retry</button>' : ''}
  </div>`;
}

function configureMotion() {
  const viewport = byId('indexRadarViewport');
  const track = byId('indexRadarTrack');
  const group = track?.querySelector('.index-radar-group:not(.index-radar-group--clone)');
  if (!viewport || !track || !group) return;
  track.classList.remove('is-animated');
  track.style.removeProperty('--index-radar-duration');
  requestAnimationFrame(() => {
    const mobile = window.matchMedia('(max-width: 768px)').matches;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (mobile || reduced || group.scrollWidth <= viewport.clientWidth) return;
    track.style.setProperty('--index-radar-duration',`${Math.max(60,group.scrollWidth / 10).toFixed(1)}s`);
    track.classList.add('is-animated');
  });
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
    renderMessage('No qualified sector leader','No sector or theme crossed the 60-point quality gate for this official session.');
    return;
  }
  setStatus(`<span class="fibo-analysis-source fibo-analysis-source--official">Official Close · ${escapeRadarHtml(snapshot.tradeDate)}</span>${warning}`);
  const original = snapshot.leaders.map((leader,index) => cardMarkup(leader,index)).join('');
  const clone = snapshot.leaders.map((leader,index) => cardMarkup(leader,index,{clone:true})).join('');
  viewport.innerHTML = `<div class="index-radar-track" id="indexRadarTrack">
    <div class="index-radar-group">${original}</div>
    <div class="index-radar-group index-radar-group--clone" aria-hidden="true">${clone}</div>
  </div>`;
  configureMotion();
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
      <section><h3>Leaderboard history</h3><p>Consecutive <strong>${leader.appearances.consecutive}D</strong> · 15D <strong>${leader.appearances.days15}×</strong> · 30D <strong>${leader.appearances.days30}×</strong>. Counts start only after final Theme Group deduplication.</p></section>
      <p class="index-radar-disclaimer">Context only. This ranking is not a probability, target price or buy signal and never changes Terminal Composite Signal.</p>
    </div>`;
  }
  openModal(byId('indexRadarDetailBackdrop'),trigger);
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
      setStatus('Waiting for first Index Backfill');
      renderMessage('Index Radar is not ready','Run the Index BaoStock smoke and backfill after applying the Radar migration.',{retry:true});
      return;
    }
    state.snapshot = snapshot;
    renderSnapshot(snapshot,result.checkpoint);
  } catch (error) {
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
    const card = event.target.closest('[data-index-radar-leader]');
    if (card) openDetails(card.dataset.indexRadarLeader,card);
  });
  for (const [backdropId,closeId] of [
    ['indexRadarHelpBackdrop','indexRadarHelpClose'],
    ['indexRadarDetailBackdrop','indexRadarDetailClose'],
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
  window.addEventListener('resize',() => {
    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(configureMotion,120);
  });
}

export function initializeIndexRadar({ client }) {
  if (!byId('indexRadar')) return;
  state.client = client;
  bindEvents();
  load();
}
