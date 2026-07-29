/**
 * Terminal DOM controller for Pool, Look First and Then Leap.
 * Allowed: DOM plus core/terminal modules. Forbidden: redefining identity or algorithm rules.
 * Covered by: contract, algorithm and desktop/iPhone Playwright tests.
 */
import { bindDeclarativeEvents } from '../core/declarative-events.js';
import { getSupabaseClient } from '../core/supabase-client.js';
import { buildCloudPayload } from '../core/cloud-payload.js';
import { getAuthenticatedUser, loadCloudRow, upsertCloudRow } from '../core/cloud-repository.js';
import { runMigrations } from '../core/migrations.js';
import { getAutoPlan as calculateAutoPlan, movePct as calculateMovePct, getStopCandidates as calculateStopCandidates } from '../terminal/fibonacci.js';
import { calculateTechnicalScore, classifyCompositeSignal } from '../terminal/composite-signal.js';
import { normalizeTicker, createPermanentId, loadInstrumentPool as loadPoolCore, saveInstrumentPool as savePoolCore, mergeInstrumentPools as mergePoolsCore, migrateTerminalIdentity } from '../core/instrument-identity.js';
import { MARKET_OPTIONS, normalizeSecurityCode } from '../core/market-code.js';
import { loadDailyCloses, loadLatestOfficialClose, syncMarketBindings } from '../core/market-repository.js';
import { readJson } from '../core/storage.js';
import { readSharedLiveInputs, reconcileLegacyTrackerInputs } from '../core/shared-live-inputs.js';
import { runCloudPushFeedback } from './cloud-action-feedback.js';
import { appendProvisionalCurrent } from '../tracker/trend-engine.js';
import { buildTerminalMacdSuggestion, detectCloseMacdDivergence } from '../tracker/macd-suggestion.js';
import { initializeIndexRadar } from './index-radar-controller.js';

// ================= Supabase 配置区域 =================
            // ⚠️ 请在这里填入你的真实数据
            const supabaseClient = getSupabaseClient('terminal');
            runMigrations(localStorage);
            reconcileLegacyTrackerInputs(localStorage);

            // ================= 🆕 新增：路由守卫 (禁止单独访问) =================
            async function checkAuth() {
                // 复用上面的 supabaseClient 获取当前登录状态
                const { data: { session } } = await supabaseClient.auth.getSession();
    
                // 如果没有 session (未登录)，立刻踢回登录页
                if (!session) {
                    alert('未授权访问！请先登录。');
                    window.location.replace('https://gaman-cheung.github.io/Fibo-Tradingviewer/TradingViewer.html');
                }
            }
            // 页面一加载就执行检查
            checkAuth();
            // ===============================================================
        
            function showLoader(text) {
                const loader = document.getElementById('loader');
                loader.innerText = text;
                loader.style.display = 'block';
            }
            function hideLoader() { document.getElementById('loader').style.display = 'none'; }

            // ================= 全新多用户云端同步逻辑 =================
            async function performTerminalCloudPush() {
                showLoader('Pushing to Cloud...');
                const v6Data = JSON.parse(localStorage.getItem('tv_lookfirst_data_v3') || '[]');
                const v7Data = JSON.parse(localStorage.getItem('tv_thenleap_data_v3') || '[]');
                const headerNotes = {
                    marquee: localStorage.getItem('tv_header_marquee_v1') || '',
                    tips: localStorage.getItem('tv_header_tips_v1') || ''
                };
                const instrumentPool = loadInstrumentPool();

                // 1. 动态获取当前正在操作的“打碟宇航员”是谁
                const { user } = await getAuthenticatedUser(supabaseClient);
            
                if (!user) {
                    hideLoader();
                    return alert("未检测到登录状态，请刷新页面或重新登录！");
                }

                const { data: existingCloudRow } = await loadCloudRow(supabaseClient, user.id, 'wp_data');
                let localWaveState = null;
                try {
                    const parsedWaveState = JSON.parse(localStorage.getItem('wave_matrix_tabs_v3') || 'null');
                    if (parsedWaveState?.tabs && Array.isArray(parsedWaveState.tabs)) localWaveState = parsedWaveState;
                } catch (e) {}
                const mergedWpData = { ...(existingCloudRow?.wp_data || {}), ...(localWaveState || {}), instrumentPool, uiNotes:headerNotes };
                if (Array.isArray(mergedWpData.tabs)) {
                    const validInstrumentIds = new Set(instrumentPool.items.map(item => item.id));
                    const deletedInstrumentIds = new Set((instrumentPool.tombstones || []).map(item => item.id));
                    mergedWpData.tabs = mergedWpData.tabs.filter(tab => !tab.instrumentId || (validInstrumentIds.has(tab.instrumentId) && !deletedInstrumentIds.has(tab.instrumentId)));
                }

                // 2. 将数据连同他的专属 user_id 一起推上云端
                // (因为去掉了 id:1，现在直接根据 user_id 自动匹配他的专属行)
                const cloudPayload = buildCloudPayload({
                    userId:user.id, lookFirst:v6Data, thenLeap:v7Data, waveState:localWaveState,
                    instrumentPool, uiNotes:headerNotes, existingWaveData:existingCloudRow?.wp_data || {}
                });
                cloudPayload.wp_data = mergedWpData;
                const { data, error } = await upsertCloudRow(supabaseClient, cloudPayload);

                hideLoader();
                if (error) {
                    alert("❌ Cloud Sync Failed: " + error.message);
                } else {
                    const bindingResult = await syncMarketBindings(supabaseClient, user.id, instrumentPool).catch(bindingError => ({ error:bindingError }));
                    if (bindingResult?.error) console.warn('Tracker bindings were not synced. Apply the Trend Tracker Supabase migration.', bindingResult.error);
                    return true;
                }
                return !error;
            }

            async function saveToCloud(trigger) {
                const button = trigger || document.getElementById('btn-push');
                const mobileAction = !!button?.closest('#mobileActionsBackdrop');
                return runCloudPushFeedback(button,async () => (await performTerminalCloudPush()) === true,{
                    onSuccessSettled:() => { if (mobileAction) closeMobileActions(); },
                    onUnexpectedError:error => { hideLoader(); alert('Cloud Sync Failed: ' + (error?.message || error)); }
                });
            }

            async function loadFromCloud() {
                showLoader('Pulling from Cloud...');

                const { user } = await getAuthenticatedUser(supabaseClient);
                if (!user) {
                    hideLoader();
                    return alert("未检测到登录状态，请刷新页面或重新登录！");
                }
            
                // 3. 直接请求！有了 RLS 的保护，这句代码在云端会自动被过滤，
                // 保证只返回当前登录用户自己的那一行数据，绝对拿不到别人的。
                const { data, error } = await loadCloudRow(supabaseClient, user.id, '*'); 

                hideLoader();
                // PGRST116 是 Supabase 的一个特定状态码，意思是"找不到数据"
                // 这对新注册、还没点过 push 的用户是正常现象，我们予以放行
                if (error && error.code !== 'PGRST116') { 
                    alert("❌ Load Failed: " + error.message);
                    return;
                }

                if (data) {
                    if (data.v6_data) {
                        const cloudV6Data = Array.isArray(data.v6_data) ? data.v6_data : [];
                        const noteCarrier = cloudV6Data.find(item => item && typeof item === 'object' && item.__header_notes_v1);
                        const cloudNotes = data.wp_data?.uiNotes || noteCarrier?.__header_notes_v1;
                        const poolCarrier = cloudV6Data.find(item => item && typeof item === 'object' && item.__instrument_pool_v1);
                        const mergedCloudPool = mergeInstrumentPools(loadInstrumentPool(), poolCarrier?.__instrument_pool_v1, data.wp_data?.instrumentPool);
                        if (mergedCloudPool.items.length) saveInstrumentPool(mergedCloudPool);
                        if (cloudNotes && Object.prototype.hasOwnProperty.call(cloudNotes, 'marquee')) localStorage.setItem('tv_header_marquee_v1', cloudNotes.marquee || '');
                        if (cloudNotes && Object.prototype.hasOwnProperty.call(cloudNotes, 'tips')) localStorage.setItem('tv_header_tips_v1', cloudNotes.tips || '');
                        const cleanV6Data = cloudV6Data
                            .filter(item => item && typeof item === 'object')
                            .map(item => {
                                const cleanRow = { ...item };
                                delete cleanRow.__header_notes_v1;
                                delete cleanRow.__instrument_pool_v1;
                                return cleanRow;
                            })
                            .filter(item => ['n','h','l','c'].some(key => Object.prototype.hasOwnProperty.call(item, key)));
                        localStorage.setItem('tv_lookfirst_data_v3', JSON.stringify(cleanV6Data));
                    }
                    if (!data.v6_data && data.wp_data?.uiNotes) {
                        localStorage.setItem('tv_header_marquee_v1', data.wp_data.uiNotes.marquee || '');
                        localStorage.setItem('tv_header_tips_v1', data.wp_data.uiNotes.tips || '');
                    }
                    if (!data.v6_data && data.wp_data?.instrumentPool?.items) saveInstrumentPool(mergeInstrumentPools(loadInstrumentPool(), data.wp_data.instrumentPool));
                    if (data.v7_data) localStorage.setItem('tv_thenleap_data_v3', JSON.stringify(data.v7_data));
                    if (data.wp_data?.tabs && Array.isArray(data.wp_data.tabs)) {
                        const waveState = { ...data.wp_data, instrumentPool:loadInstrumentPool(), uiNotes:data.wp_data.uiNotes || {} };
                        localStorage.setItem('wave_matrix_tabs_v3', JSON.stringify(waveState));
                    }
                    reconcileLegacyTrackerInputs(localStorage,loadInstrumentPool());
                
                    const btn = document.getElementById('btn-pull');
                    const orig = btn.innerHTML;
                    btn.innerHTML = '<span class="material-icons" style="font-size:16px;">check</span> Up to Date';
                    setTimeout(() => { btn.innerHTML = orig; location.reload(); }, 1000);
                } else {
                    alert("云端还没有你的数据记录哦！请先在页面上添加几行 K 线数据，然后点击 Push to Cloud ☁️。");
                }
            }

        // ================= Instrument Pool / Permanent IDs =================
        const INSTRUMENT_POOL_KEY = 'tv_instrument_pool_v1';
        const ACTIVE_INSTRUMENT_KEY = 'tv_active_instrument_id';

        function normalizeInstrumentName(value) { return normalizeTicker(value); }

        function createInstrumentId() { return createPermanentId(); }

        function loadInstrumentPool() { return loadPoolCore(localStorage); }

        function mergeInstrumentPools(...pools) { return mergePoolsCore(...pools); }

        function saveInstrumentPool(pool) { return savePoolCore(pool, localStorage); }

        function getInstrumentById(id) { return loadInstrumentPool().items.find(item => item.id === id) || null; }

        function instrumentMetaButtonHtml(instrumentId) {
            const instrument = getInstrumentById(instrumentId);
            const ready = /^(?:SH|SZ)$/.test(String(instrument?.market || '')) && /^\d{6}$/.test(String(instrument?.code || ''));
            const summary = [instrument?.code, instrument?.market].filter(Boolean).join(' · ');
            const title = ready ? `${summary} — Edit instrument` : `Code / Market incomplete${summary ? ` (${summary})` : ''} — Edit instrument`;
            return `<button type="button" class="instrument-meta-button desktop-only ${ready ? 'is-ready' : ''}" data-fibo-click="openInstrumentDialog('${escapePoolHtml(instrumentId)}')" title="${escapePoolHtml(title)}" aria-label="${escapePoolHtml(title)}"><span class="material-icons">tune</span></button>`;
        }

        function refreshInstrumentMetaButtons(instrumentId) {
            document.querySelectorAll(`tr[data-instrument-id="${instrumentId}"] .instrument-meta-button`).forEach(button => {
                const wrapper = document.createElement('span');
                wrapper.innerHTML = instrumentMetaButtonHtml(instrumentId);
                button.replaceWith(wrapper.firstElementChild);
            });
        }

        function isInstrumentActive(id) { const item = getInstrumentById(id); return !item || item.status !== 'archived'; }

        function migrateInstrumentIdentity(v6Data, v7Data) {
            const migrated = migrateTerminalIdentity(v6Data, v7Data, loadInstrumentPool());
            saveInstrumentPool(migrated.pool);
            localStorage.setItem('tv_lookfirst_data_v3', JSON.stringify(migrated.v6Data));
            localStorage.setItem('tv_thenleap_data_v3', JSON.stringify(migrated.v7Data));
            return migrated;
        }

        function escapePoolHtml(value) {
            return String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[char]));
        }

        function readStoredRows(key) {
            try { const rows = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(rows) ? rows : []; }
            catch (e) { return []; }
        }

        function mergeRowsWithHiddenInstruments(key, liveRows) {
            const poolIds = new Set(loadInstrumentPool().items.map(item => item.id));
            const liveIds = new Set(liveRows.map(row => row.id).filter(Boolean));
            const retained = readStoredRows(key).filter(row => row?.id && poolIds.has(row.id) && !liveIds.has(row.id));
            return [...liveRows, ...retained];
        }

        function renderInstrumentPool() {
            const grid = document.getElementById('instrumentPoolGrid');
            if (!grid) return;
            const pool = loadInstrumentPool();
            const query = normalizeInstrumentName(document.getElementById('poolSearch')?.value);
            const v6Map = new Map(readStoredRows('tv_lookfirst_data_v3').map(row => [row.id, row]));
            const v7Map = new Map(readStoredRows('tv_thenleap_data_v3').map(row => [row.id, row]));
            const active = pool.items.filter(item => item.status !== 'archived').sort((a,b) => Number(a.order) - Number(b.order));
            const visible = active.filter(item => !query || normalizeInstrumentName(`${item.ticker} ${item.code}`).includes(query));
            document.getElementById('poolCount').textContent = `${active.length} instrument${active.length === 1 ? '' : 's'}`;

            grid.innerHTML = visible.length ? visible.map(item => {
                const lf = v6Map.get(item.id) || {};
                const tl = v7Map.get(item.id) || {};
                const lfReady = Number.isFinite(parseFloat(lf.h)) && Number.isFinite(parseFloat(lf.l)) && Number.isFinite(parseFloat(lf.c));
                const tlReady = !!(tl.r || tl.s || tl.p || tl.v || (tl.t && tl.t !== 'sideways') || (tl.m && tl.m !== 'neutral'));
                return `<article class="instrument-card" draggable="${query ? 'false' : 'true'}" data-instrument-id="${escapePoolHtml(item.id)}">
                    <div class="instrument-head"><div><div class="instrument-name">${escapePoolHtml(item.ticker || 'Untitled Instrument')}</div><div class="instrument-code">${escapePoolHtml([item.code,item.market].filter(Boolean).join(' · '))}</div></div><span class="material-icons pool-drag" title="Drag to reorder">drag_indicator</span></div>
                    <div class="instrument-meta"><div>Current<strong>${lf.c || '--'}</strong></div><div>Look First<strong>${lfReady ? 'Ready' : 'Pending'}</strong></div><div>Then Leap<strong>${tlReady ? 'Ready' : 'Pending'}</strong></div></div>
                    <div class="instrument-actions"><button class="pool-action" data-fibo-click="openInstrument('${item.id}')">Look First</button><button class="pool-action" data-fibo-click="openInstrumentWave('${item.id}')">Wave</button><button class="pool-action" data-fibo-click="openInstrumentDialog('${item.id}')">Edit</button><button class="pool-action danger" data-fibo-click="archiveInstrument('${item.id}')">Remove</button></div>
                </article>`;
            }).join('') : '<div class="pool-empty">No instruments found. Add your first instrument to begin.</div>';

            const archived = pool.items.filter(item => item.status === 'archived').sort((a,b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
            document.getElementById('trashCount').textContent = archived.length ? `(${archived.length})` : '';
            document.getElementById('instrumentTrashList').innerHTML = archived.length ? archived.map(item => `<div class="trash-item"><span><strong>${escapePoolHtml(item.ticker)}</strong><small style="display:block;color:var(--text-secondary);">Removed ${escapePoolHtml(item.deletedAt?.slice(0,10) || '')}</small></span><span><button class="pool-action" data-fibo-click="restoreInstrument('${item.id}')">Restore</button> <button class="pool-action danger" data-fibo-click="permanentlyDeleteInstrument('${item.id}')">Delete forever</button></span></div>`).join('') : '<div style="color:var(--text-secondary);font-size:12px;">Trash is empty.</div>';
            initPoolDrag();
        }

        function initPoolDrag() {
            const grid = document.getElementById('instrumentPoolGrid');
            if (!grid || normalizeInstrumentName(document.getElementById('poolSearch')?.value)) return;
            let dragged = null;
            let touchDragged = null;
            let touchHandle = null;
            let touchPointerId = null;

            const finishTouchDrag = () => {
                if (!touchDragged) return;
                touchDragged.classList.remove('touch-dragging');
                if (touchHandle && touchPointerId !== null && touchHandle.hasPointerCapture?.(touchPointerId)) touchHandle.releasePointerCapture(touchPointerId);
                touchDragged = null; touchHandle = null; touchPointerId = null;
                savePoolDomOrder();
            };
            grid.querySelectorAll('.instrument-card').forEach(card => {
                card.addEventListener('dragstart', () => { dragged = card; card.classList.add('dragging'); });
                card.addEventListener('dragend', () => { card.classList.remove('dragging'); dragged = null; savePoolDomOrder(); });
                card.addEventListener('dragover', event => {
                    event.preventDefault();
                    if (!dragged || dragged === card) return;
                    const box = card.getBoundingClientRect();
                    grid.insertBefore(dragged, event.clientY < box.top + box.height / 2 ? card : card.nextSibling);
                });
                const handle = card.querySelector('.pool-drag');
                if (!handle) return;
                handle.addEventListener('pointerdown', event => {
                    if (event.pointerType === 'mouse') return;
                    event.preventDefault();
                    touchDragged = card; touchHandle = handle; touchPointerId = event.pointerId;
                    card.classList.add('touch-dragging');
                    handle.setPointerCapture?.(event.pointerId);
                });
                handle.addEventListener('pointermove', event => {
                    if (!touchDragged || event.pointerId !== touchPointerId) return;
                    event.preventDefault();
                    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.instrument-card');
                    if (!target || target === touchDragged || target.parentElement !== grid) return;
                    const box = target.getBoundingClientRect();
                    grid.insertBefore(touchDragged, event.clientY < box.top + box.height / 2 ? target : target.nextSibling);
                });
                handle.addEventListener('pointerup', finishTouchDrag);
                handle.addEventListener('pointercancel', finishTouchDrag);
            });
        }

        function savePoolDomOrder() {
            const ids = [...document.querySelectorAll('#instrumentPoolGrid .instrument-card')].map(card => card.dataset.instrumentId);
            const pool = loadInstrumentPool();
            const now = new Date().toISOString();
            ids.forEach((id, order) => { const item = pool.items.find(entry => entry.id === id); if (item) { item.order = order; item.updatedAt = now; } });
            saveInstrumentPool(pool);
            reorderStoredRowsByPool();
        }

        function reorderStoredRowsByPool() {
            const order = new Map(loadInstrumentPool().items.map(item => [item.id, Number(item.order)]));
            for (const key of ['tv_lookfirst_data_v3','tv_thenleap_data_v3']) {
                const rows = readStoredRows(key);
                rows.sort((a,b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
                localStorage.setItem(key, JSON.stringify(rows));
            }
            try {
                const waveState = JSON.parse(localStorage.getItem('wave_matrix_tabs_v3') || 'null');
                if (waveState?.tabs && Array.isArray(waveState.tabs)) {
                    waveState.tabs.sort((a,b) => (order.get(a.instrumentId) ?? 1e9) - (order.get(b.instrumentId) ?? 1e9));
                    waveState.instrumentPool = loadInstrumentPool();
                    localStorage.setItem('wave_matrix_tabs_v3', JSON.stringify(waveState));
                }
            } catch (e) {}
        }

        function createDesktopInstrumentRow() {
            const pool = loadInstrumentPool();
            const id = createInstrumentId();
            const now = new Date().toISOString();
            pool.items.push({ id, ticker:'', code:'', market:'OTHER', order:pool.items.filter(item => item.status !== 'archived').length, status:'active', createdAt:now, updatedAt:now, deletedAt:null });
            saveInstrumentPool(pool);
            addV6Row('', '', '', '', id);
            saveLocalV6();
            const input = document.querySelector(`#tableBodyV6 tr[data-instrument-id="${id}"] .name`);
            input?.focus();
        }

        function handleDesktopTickerInput(input) {
            const row = input.closest('tr');
            const id = row?.dataset.instrumentId || '';
            const ticker = input.value.trim();
            const pool = loadInstrumentPool();
            const item = pool.items.find(entry => entry.id === id);
            if (item) { item.ticker = ticker; item.updatedAt = new Date().toISOString(); saveInstrumentPool(pool); }
            const v7Rows = readStoredRows('tv_thenleap_data_v3');
            v7Rows.forEach(entry => { if (entry.id === id) entry.n = ticker; });
            localStorage.setItem('tv_thenleap_data_v3', JSON.stringify(v7Rows));
            const v7Name = document.querySelector(`#tableBodyV7 tr[data-instrument-id="${id}"] .name`);
            if (v7Name) v7Name.value = ticker;
            saveLocalV6();
        }

        function openInstrumentDialog(id = '') {
            const item = id ? getInstrumentById(id) : null;
            document.getElementById('instrumentModalTitle').textContent = item ? 'Edit Instrument' : 'Add Instrument';
            document.getElementById('instrumentEditId').value = item?.id || '';
            document.getElementById('instrumentTicker').value = item?.ticker || '';
            document.getElementById('instrumentCode').value = item?.code || '';
            document.getElementById('instrumentMarket').value = MARKET_OPTIONS.includes(item?.market) ? item.market : 'OTHER';
            const backdrop = document.getElementById('instrumentModalBackdrop');
            backdrop.classList.add('open'); backdrop.setAttribute('aria-hidden','false');
            setTimeout(() => document.getElementById('instrumentTicker').focus(), 0);
        }

        function closeInstrumentDialog() {
            const backdrop = document.getElementById('instrumentModalBackdrop');
            backdrop.classList.remove('open'); backdrop.setAttribute('aria-hidden','true');
        }

        function handleInstrumentBackdrop(event) { if (event.target.id === 'instrumentModalBackdrop') closeInstrumentDialog(); }

        function saveInstrumentDialog() {
            const id = document.getElementById('instrumentEditId').value;
            const ticker = document.getElementById('instrumentTicker').value.trim();
            const code = normalizeSecurityCode(document.getElementById('instrumentCode').value);
            const market = document.getElementById('instrumentMarket').value;
            if (!ticker) return alert('Ticker / Name is required.');
            const pool = loadInstrumentPool();
            const now = new Date().toISOString();
            let affectedId = id;
            if (id) {
                const item = pool.items.find(entry => entry.id === id);
                if (!item) return;
                item.ticker = ticker; item.code = code; item.market = market; item.updatedAt = now;
                for (const key of ['tv_lookfirst_data_v3','tv_thenleap_data_v3']) {
                    const rows = readStoredRows(key); rows.forEach(row => { if (row.id === id) row.n = ticker; }); localStorage.setItem(key, JSON.stringify(rows));
                }
                document.querySelectorAll(`[data-instrument-id="${id}"] .name`).forEach(input => { input.value = ticker; });
            } else {
                const newId = createInstrumentId();
                affectedId = newId;
                const activeCount = pool.items.filter(item => item.status !== 'archived').length;
                pool.items.push({ id:newId, ticker, code, market, order:activeCount, status:'active', createdAt:now, updatedAt:now, deletedAt:null });
                const previousMode = ['SH','SZ'].includes(market) && /^\d{6}$/.test(code) ? 'auto' : 'manual';
                const rows = readStoredRows('tv_lookfirst_data_v3'); rows.push({ id:newId, n:ticker, h:'', l:'', c:'', p:'', pm:previousMode, pd:'' }); localStorage.setItem('tv_lookfirst_data_v3', JSON.stringify(rows));
                localStorage.setItem(ACTIVE_INSTRUMENT_KEY, newId);
                addV6Row(ticker, '', '', '', newId, '', '', 'current', previousMode, '');
            }
            saveInstrumentPool(pool); refreshInstrumentMetaButtons(affectedId); closeInstrumentDialog(); renderInstrumentPool();
            const affectedRow = document.querySelector(`#tableBodyV6 tr[data-instrument-id="${affectedId}"]`);
            if (affectedRow?.dataset.previousMode === 'auto') refreshPreviousCloseRow(affectedRow,{ force:true });
        }

        function openInstrument(id) {
            localStorage.setItem(ACTIVE_INSTRUMENT_KEY, id);
            switchTab('v6');
            const row = document.querySelector(`#tableBodyV6 tr[data-instrument-id="${id}"]`);
            row?.scrollIntoView({ behavior:'smooth', block:'center' });
        }

        function openInstrumentWave(id) {
            localStorage.setItem(ACTIVE_INSTRUMENT_KEY, id);
            window.location.href = 'https://gaman-cheung.github.io/Fibo-Tradingviewer/WaveAnalysis.html';
        }

        function archiveInstrument(id) {
            const item = getInstrumentById(id); if (!item || !confirm(`Remove “${item.ticker}” from the active pool? Its data can be restored from Recently Removed.`)) return;
            saveLocalV6(); saveLocalV7();
            const pool = loadInstrumentPool(); const target = pool.items.find(entry => entry.id === id);
            target.status = 'archived'; target.deletedAt = new Date().toISOString(); target.updatedAt = target.deletedAt;
            saveInstrumentPool(pool); localStorage.setItem('tv_active_tab','pool'); location.reload();
        }

        function removeInstrumentFromCurrentLayout(id) {
            if (window.matchMedia('(max-width: 768px)').matches) archiveInstrument(id);
            else permanentlyDeleteInstrument(id);
        }

        function restoreInstrument(id) {
            const pool = loadInstrumentPool(); const target = pool.items.find(entry => entry.id === id); if (!target) return;
            target.status = 'active'; target.deletedAt = null; target.updatedAt = new Date().toISOString();
            target.order = pool.items.filter(item => item.status !== 'archived').length;
            saveInstrumentPool(pool); reorderStoredRowsByPool(); localStorage.setItem('tv_active_tab','pool'); location.reload();
        }

        function permanentlyDeleteInstrument(id) {
            const item = getInstrumentById(id); if (!item || !confirm(`Permanently delete “${item.ticker}” and all linked Look First / Then Leap data? This cannot be undone.`)) return;
            const pool = loadInstrumentPool();
            pool.items = pool.items.filter(entry => entry.id !== id);
            pool.tombstones = [...(pool.tombstones || []).filter(entry => entry.id !== id), { id, deletedAt:new Date().toISOString() }];
            saveInstrumentPool(pool);
            for (const key of ['tv_lookfirst_data_v3','tv_thenleap_data_v3']) localStorage.setItem(key, JSON.stringify(readStoredRows(key).filter(row => row.id !== id)));
            try {
                const waveState = JSON.parse(localStorage.getItem('wave_matrix_tabs_v3') || 'null');
                if (waveState?.tabs && Array.isArray(waveState.tabs)) {
                    waveState.tabs = waveState.tabs.filter(tab => tab.instrumentId !== id);
                    if (!waveState.tabs.some(tab => tab.id === waveState.activeTabId)) waveState.activeTabId = waveState.tabs[0]?.id || null;
                    waveState.instrumentPool = pool;
                    localStorage.setItem('wave_matrix_tabs_v3', JSON.stringify(waveState));
                }
            } catch (e) {}
            if (window.matchMedia('(max-width: 768px)').matches) renderInstrumentPool();
            else { localStorage.setItem('tv_active_tab','v6'); location.reload(); }
        }

        // ================= Tab & UI Logic =================
        function switchTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
            document.getElementById('tab-' + tabId).classList.add('active');
            document.getElementById('btn-' + tabId).classList.add('active');
            localStorage.setItem('tv_active_tab', tabId);
            document.body.classList.toggle('view-pool', tabId === 'pool');
            document.body.classList.toggle('view-terminal', tabId === 'v6' || tabId === 'v7');
            if (tabId === 'v6' || tabId === 'v7') localStorage.setItem('tv_last_terminal_tab', tabId);
            if (tabId === 'pool') renderInstrumentPool();
            if (tabId === 'v7') {
                syncV7withV6(true);
                requestAnimationFrame(syncV7ScrollWidth);
            }
            applyMobileActiveInstrument();
            updateMobileNavigation(tabId);
        }

        function switchMobileTerminal() {
            const last = localStorage.getItem('tv_last_terminal_tab');
            switchTab(last === 'v7' ? 'v7' : 'v6');
        }

        function updateMobileNavigation(tabId) {
            document.getElementById('mobileNavPool')?.classList.toggle('active', tabId === 'pool');
            document.getElementById('mobileNavTerminal')?.classList.toggle('active', tabId === 'v6' || tabId === 'v7');
        }

        function ensureMobileCardControls(row) {
            const firstCell = row.querySelector('td:first-child');
            if (!firstCell) return null;
            let controls = firstCell.querySelector('.mobile-card-controls');
            if (!controls) {
                controls = document.createElement('div');
                controls.className = 'mobile-card-controls mobile-only';
                firstCell.appendChild(controls);
            }
            return controls;
        }

        function syncMobileCompositeSignal(row) {
            if (!window.matchMedia('(max-width: 768px)').matches || !row?.closest('#tableBodyV7')) return;
            const controls = ensureMobileCardControls(row);
            const source = row.querySelector('.ai-cell');
            if (!controls || !source) return;
            let summary = controls.querySelector('.mobile-signal-summary');
            if (!summary) {
                summary = document.createElement('div');
                summary.className = 'mobile-signal-summary';
                controls.prepend(summary);
            }
            summary.dataset.explanation = source.dataset.explanation || '';
            summary.innerHTML = `<small>Composite Signal</small>${source.innerHTML || '<span>-</span>'}`;
        }

        function applyMobileActiveInstrument() {
            if (!window.matchMedia('(max-width: 768px)').matches) return;
            const pool = loadInstrumentPool();
            let activeId = localStorage.getItem(ACTIVE_INSTRUMENT_KEY);
            if (!pool.items.some(item => item.id === activeId && item.status !== 'archived')) {
                activeId = pool.items.filter(item => item.status !== 'archived').sort((a,b) => Number(a.order)-Number(b.order))[0]?.id || '';
                if (activeId) localStorage.setItem(ACTIVE_INSTRUMENT_KEY, activeId);
            }
            document.querySelectorAll('#tableBodyV6 tr, #tableBodyV7 tr').forEach(row => {
                const isCurrent = !!activeId && row.dataset.instrumentId === activeId;
                row.classList.toggle('mobile-current', isCurrent);
                if (isCurrent && !row.querySelector('.mobile-detail-toggle')) {
                    const controls = ensureMobileCardControls(row);
                    const button = document.createElement('button');
                    button.type = 'button'; button.className = 'mobile-detail-toggle mobile-only'; button.textContent = 'Show Details';
                    button.addEventListener('click', () => {
                        row.classList.toggle('mobile-expanded');
                        button.textContent = row.classList.contains('mobile-expanded') ? 'Collapse' : 'Show Details';
                    });
                    controls?.appendChild(button);
                }
                if (isCurrent) syncMobileCompositeSignal(row);
            });
        }

        function openMobileActions() {
            const backdrop = document.getElementById('mobileActionsBackdrop');
            backdrop.classList.add('open'); backdrop.setAttribute('aria-hidden','false');
        }
        function closeMobileActions() {
            const backdrop = document.getElementById('mobileActionsBackdrop');
            backdrop.classList.remove('open'); backdrop.setAttribute('aria-hidden','true');
        }
        function handleMobileActionsBackdrop(event) { if (event.target.id === 'mobileActionsBackdrop') closeMobileActions(); }

        function syncV7ScrollWidth() {
            const table = document.getElementById('v7Table');
            const inner = document.getElementById('v7TopScrollInner');
            const topScroll = document.getElementById('v7TopScroll');
            const tableCard = document.getElementById('v7TableCard');
            if (table && inner) inner.style.width = table.scrollWidth + 'px';
            if (table && topScroll && tableCard && tableCard.clientWidth > 0) {
                topScroll.style.display = table.scrollWidth > tableCard.clientWidth + 1 ? 'block' : 'none';
            }
        }

        function initV7TableUX() {
            const topScroll = document.getElementById('v7TopScroll');
            const tableCard = document.getElementById('v7TableCard');
            if (!topScroll || !tableCard) return;

            let syncing = false;
            topScroll.addEventListener('scroll', () => {
                if (syncing) return;
                syncing = true;
                tableCard.scrollLeft = topScroll.scrollLeft;
                syncing = false;
            });
            tableCard.addEventListener('scroll', () => {
                if (syncing) return;
                syncing = true;
                topScroll.scrollLeft = tableCard.scrollLeft;
                syncing = false;
            });

            syncV7ScrollWidth();
            if (window.ResizeObserver) new ResizeObserver(syncV7ScrollWidth).observe(document.getElementById('v7Table'));
            window.addEventListener('resize', syncV7ScrollWidth);
        }

        function applyAutoHighlight(row, currentPrice, levelsDict) {
            row.querySelectorAll('td.calc-result').forEach(td => {
                td.classList.remove('highlight-cell');
                const tags = td.querySelectorAll('.sr-tag');
                tags.forEach(t => t.remove());
            });

            if (isNaN(currentPrice)) return;
            let minDiff = Infinity; let closestKey = null; let closestValue = 0;

            for (const [key, value] of Object.entries(levelsDict)) {
                let diff = Math.abs(currentPrice - value);
                if (diff < minDiff) { minDiff = diff; closestKey = key; closestValue = value; }
            }

            const diffPct = Math.abs(currentPrice) > 0 ? minDiff / Math.abs(currentPrice) : Infinity;
            if (closestKey && diffPct <= 0.02) {
                const targetCell = row.querySelector('.res-' + closestKey);
                if(targetCell) {
                    targetCell.classList.add('highlight-cell');
                    const isSupport = currentPrice >= closestValue;
                    const srHtml = isSupport ? '<div class="sr-tag sup">🛡️ Support</div>' : '<div class="sr-tag res">🧱 Resist</div>';
                    targetCell.innerHTML = closestValue.toFixed(2) + srHtml;
                }
            }
        }

        // ================= Look first Core =================
        const tBodyV6 = document.getElementById('tableBodyV6');
        const previousCloseRequestCache = new Map();
        const macdHistoryRequestCache = new Map();

        function previousCloseModeFor(instrumentId, requestedMode) {
            if (['auto','manual'].includes(requestedMode)) return requestedMode;
            const instrument = getInstrumentById(instrumentId);
            return ['SH','SZ'].includes(String(instrument?.market || '')) && /^\d{6}$/.test(String(instrument?.code || '')) ? 'auto' : 'manual';
        }

        function renderPreviousCloseControl(row, state = 'idle', detail = '') {
            const input = row.querySelector('.previous');
            const button = row.querySelector('.previous-mode-button');
            if (!input || !button) return;
            const mode = row.dataset.previousMode === 'auto' ? 'auto' : 'manual';
            const date = row.dataset.previousDate || '';
            const cached = Number.isFinite(parseFloat(input.value)) && parseFloat(input.value) > 0;
            input.readOnly = mode === 'auto';
            button.className = `previous-mode-button is-${mode} state-${state}`;
            let icon = mode === 'manual' ? 'edit' : 'cloud_sync';
            let summary = mode === 'manual' ? 'Manual Prev Close · click to switch to Auto' : `Auto Prev Close${date ? ` · ${date}` : ''}`;
            if (mode === 'auto' && state === 'loading') { icon = 'sync'; summary = `Loading latest official close${cached ? ' · cached value retained' : ''}`; }
            if (mode === 'auto' && state === 'success') { icon = 'cloud_done'; summary = `Auto · latest official close${date ? ` · ${date}` : ''}`; }
            if (mode === 'auto' && state === 'cached') { icon = 'cloud_off'; summary = `Auto unavailable · cached value${date ? ` · ${date}` : ''}`; }
            if (mode === 'auto' && state === 'error') { icon = 'error_outline'; summary = detail || 'Auto unavailable · switch to Manual to enter a value'; }
            button.innerHTML = `<span class="material-icons">${icon}</span>`;
            button.title = `${summary}. ${mode === 'auto' ? 'Click for Manual override.' : 'Click to restore Auto.'}`;
            button.setAttribute('aria-label',button.title);
            button.dataset.state = state;
            input.title = mode === 'auto' ? summary : 'Manual Prev Close';
        }

        function recalculateThenLeapForInstrument(instrumentId, persist = true) {
            const row = document.querySelector(`#tableBodyV7 tr[data-instrument-id="${instrumentId}"]`);
            const control = row?.querySelector('input,select');
            if (control) calcV7(control,persist);
        }

        function latestCloseRequest(instrument, force = false) {
            const key = `${String(instrument?.market || '').toUpperCase()}:${String(instrument?.code || '').trim()}`;
            if (force) previousCloseRequestCache.delete(key);
            if (!previousCloseRequestCache.has(key)) previousCloseRequestCache.set(key,loadLatestOfficialClose(supabaseClient,instrument));
            return { key, promise:previousCloseRequestCache.get(key) };
        }

        async function refreshPreviousCloseRow(row, { force=false } = {}) {
            if (!row?.isConnected || row.dataset.previousMode !== 'auto') return;
            const instrumentId = row.dataset.instrumentId || '';
            const instrument = getInstrumentById(instrumentId);
            const input = row.querySelector('.previous');
            if (!instrument || !['SH','SZ'].includes(String(instrument.market || '')) || !/^\d{6}$/.test(String(instrument.code || ''))) {
                renderPreviousCloseControl(row,Number.isFinite(parseFloat(input?.value)) ? 'cached' : 'error','Auto requires a six-digit SH/SZ Code');
                return;
            }
            renderPreviousCloseControl(row,'loading');
            const request = latestCloseRequest(instrument,force);
            row.dataset.previousRequestKey = request.key;
            let result;
            try { result = await request.promise; }
            catch (error) { result = { data:null,error }; }
            if (!row.isConnected || row.dataset.previousMode !== 'auto' || row.dataset.previousRequestKey !== request.key) return;
            if (result?.data && Number(result.data.close) > 0) {
                input.value = String(Number(result.data.close));
                row.dataset.previousDate = String(result.data.trade_date || '');
                renderPreviousCloseControl(row,'success');
                calcV6(input);
                recalculateThenLeapForInstrument(instrumentId);
                return;
            }
            const hasCached = Number.isFinite(parseFloat(input.value)) && parseFloat(input.value) > 0;
            renderPreviousCloseControl(row,hasCached ? 'cached' : 'error',result?.error?.message || 'No official close is available');
            saveLocalV6();
        }

        function refreshAllAutoPreviousCloses() {
            const rows = [...document.querySelectorAll('#tableBodyV6 tr')].filter(row => row.dataset.previousMode === 'auto');
            return Promise.allSettled(rows.map(row => refreshPreviousCloseRow(row)));
        }

        async function togglePreviousCloseMode(button) {
            const row = button.closest('tr');
            if (!row) return;
            const input = row.querySelector('.previous');
            if (row.dataset.previousMode === 'auto') {
                row.dataset.previousMode = 'manual';
                row.dataset.previousDate = '';
                renderPreviousCloseControl(row,'idle');
                calcV6(input);
                recalculateThenLeapForInstrument(row.dataset.instrumentId || '');
                input.focus(); input.select();
                return;
            }
            row.dataset.previousMode = 'auto';
            row.dataset.previousDate = '';
            renderPreviousCloseControl(row,'loading');
            saveLocalV6();
            await refreshPreviousCloseRow(row,{ force:true });
        }

        function handlePreviousCloseInput(input) {
            const row = input.closest('tr');
            calcV6(input);
            if (row) recalculateThenLeapForInstrument(row.dataset.instrumentId || '');
        }

        function handleCurrentInput(input) {
            const row = input.closest('tr');
            calcV6(input);
            if (row) recalculateThenLeapForInstrument(row.dataset.instrumentId || '');
        }

        function updateV6Medals() {
            const pctColumns = ['pct-1272', 'pct-1618', 'pct-2618'];
            pctColumns.forEach(colClass => {
                const cells = Array.from(document.querySelectorAll('#tableBodyV6 .' + colClass));
                const data = cells.map(cell => {
                    const val = parseFloat(cell.getAttribute('data-val'));
                    return { cell, val: isNaN(val) ? -Infinity : val };
                }).filter(item => item.val !== -Infinity);

                data.sort((a, b) => b.val - a.val);

                cells.forEach(cell => {
                    if (cell.getAttribute('data-val')) {
                        const value = parseFloat(cell.getAttribute('data-val'));
                        cell.innerHTML = `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
                    } else cell.innerHTML = '-';
                });

                if (data[0]) data[0].cell.innerHTML = `🥇 +${data[0].val.toFixed(2)}%`;
                if (data[1]) data[1].cell.innerHTML = `🥈 +${data[1].val.toFixed(2)}%`;
                if (data[2]) data[2].cell.innerHTML = `🥉 +${data[2].val.toFixed(2)}%`;
            });
        }

        function calcV6(el, persist = true) {
            const row = el.closest('tr');
            const h = parseFloat(row.querySelector('.high').value);
            const l = parseFloat(row.querySelector('.low').value);
            const c = parseFloat(row.querySelector('.current').value);
            const entry = parseFloat(row.querySelector('.entry').value);
            const previous = parseFloat(row.querySelector('.previous').value);
            const baselineMode = row.querySelector('.baseline').value;

            if (!h || !l || h <= l) {
                row.querySelectorAll('.calc-result').forEach(td => td.innerText = '-');
                row.querySelectorAll('.profit-pct').forEach(td => { td.innerText = '-'; td.removeAttribute('data-val'); });
                row.querySelector('.status-cell').innerHTML = '-';
                updateV6Medals(); if (persist) saveLocalV6(); return;
            }

            const diff = h - l;
            const levels = { '236': h - diff * 0.236, '382': h - diff * 0.382, '500': h - diff * 0.5, '618': h - diff * 0.618, '786': h - diff * 0.786, '886': h - diff * 0.886 };
            for (const key in levels) { row.querySelector('.res-' + key).innerText = levels[key].toFixed(2); }

            const e1272 = l + diff * 1.272; const e1618 = l + diff * 1.618; const e2618 = l + diff * 2.618;
            let base = c, baseName = 'Current';
            if (baselineMode === 'entry' && Number.isFinite(entry) && entry > 0) { base = entry; baseName = 'Entry'; }
            else if (baselineMode === 'previous' && Number.isFinite(previous) && previous > 0) { base = previous; baseName = 'Prev Close'; }
            const renderTarget = (selector, price, label, pctClass = '') => {
                const pct = Number.isFinite(base) && base > 0 ? movePct(price, base) : null;
                const pctText = pct === null ? '--' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
                row.querySelector(selector).innerHTML = `<span class="target-price">${price.toFixed(2)}</span><span class="target-pct ${pctClass}" ${pctClass && pct !== null ? `data-val="${pct}"` : ''}>${pctText}</span><small>vs ${baseName} · ${label}</small>`;
            };
            renderTarget('.target-high', h, 'Previous High');
            renderTarget('.ext-1272', e1272, '1.272', 'pct-1272');
            renderTarget('.ext-1618', e1618, '1.618', 'pct-1618');
            renderTarget('.ext-2618', e2618, '2.618', 'pct-2618');

            if (!isNaN(c) && c > 0) {
                applyAutoHighlight(row, c, levels);

                let status = '-';
                if (c >= h) status = '<span class="status-badge" style="background:#cce5ff;color:#004085;">📈 Breakout</span>';
                else if (c >= levels['382']) status = '<span class="status-badge">⏳ Pullback</span>';
                else if (c >= levels['618']) status = '<span class="status-badge">⚖️ Correction</span>';
                else if (c >= levels['786']) status = '<span class="status-badge" style="background:#fff3cd;color:#856404;">💎 Golden Dip</span>';
                else if (c >= levels['886']) status = '<span class="status-badge" style="background:#f8d7da;color:#721c24;">🚨 Danger Zone</span>';
                else if (c >= l) status = '<span class="status-badge" style="background:#e2d9f3;color:#4a148c;">🧛 Harmonic</span>';
                else status = '<span class="status-badge" style="background:#343a40;color:#fff;">💀 Dead</span>';
                row.querySelector('.status-cell').innerHTML = status;
            } else {
                row.querySelectorAll('.profit-pct').forEach(td => td.removeAttribute('data-val'));
            }
            updateV6Medals(); if (persist) saveLocalV6();
        }

        function addV6Row(n='', h='', l='', c='', instrumentId='', entry='', previous='', baseline='current', previousMode='', previousDate='') {
            const tr = document.createElement('tr');
            tr.dataset.instrumentId = instrumentId;
            tr.dataset.previousMode = previousCloseModeFor(instrumentId,previousMode);
            tr.dataset.previousDate = tr.dataset.previousMode === 'auto' ? String(previousDate || '') : '';
            tr.innerHTML = `
                <td><div class="ticker-input-shell"><input type="text" class="input-name name" value="${escapePoolHtml(n)}" placeholder="TICKER" data-fibo-input="handleDesktopTickerInput(this)">${instrumentMetaButtonHtml(instrumentId)}</div></td>
                <td><input type="number" class="high" value="${h}" data-fibo-input="calcV6(this)"></td>
                <td><input type="number" class="low" value="${l}" data-fibo-input="calcV6(this)"></td>
                <td><input type="number" class="current" value="${c}" data-fibo-input="handleCurrentInput(this)"></td>
                <td><input type="number" class="entry" value="${entry}" placeholder="Entry" data-fibo-input="calcV6(this)"></td>
                <td><div class="previous-shell"><input type="number" class="previous" value="${previous}" placeholder="Prev" data-fibo-input="handlePreviousCloseInput(this)"><button type="button" class="previous-mode-button" data-fibo-click="togglePreviousCloseMode(this)"><span class="material-icons">cloud_sync</span></button></div></td>
                <td><select class="baseline" data-fibo-change="calcV6(this)"><option value="current" ${baseline==='current'?'selected':''}>Current</option><option value="entry" ${baseline==='entry'?'selected':''}>Entry</option><option value="previous" ${baseline==='previous'?'selected':''}>Prev Close</option></select></td>
                <td class="calc-result res-236">-</td><td class="calc-result res-382">-</td><td class="calc-result res-500">-</td>
                <td class="calc-result res-618">-</td><td class="calc-result res-786">-</td><td class="calc-result res-886">-</td>
                <td class="calc-result compact-target target-high">-</td>
                <td class="calc-result compact-target ext-1272">-</td>
                <td class="calc-result compact-target ext-1618">-</td>
                <td class="calc-result compact-target ext-2618">-</td>
                <td class="status-cell">-</td>
                <td class="action-cell">
                    <span class="material-icons btn-icon btn-delete" data-fibo-click="removeInstrumentFromCurrentLayout('${instrumentId}')" title="Delete instrument">delete</span>
                    <span class="material-icons btn-icon drag-handle">drag_indicator</span>
                </td>
            `;
            tBodyV6.appendChild(tr); makeRowDraggable(tr, saveLocalV6);
            renderPreviousCloseControl(tr,tr.dataset.previousMode === 'auto' && previous ? 'cached' : 'idle');
            if(h && l) calcV6(tr.querySelector('.high'));
        }

        // ================= Then leap Core =================
        const tBodyV7 = document.getElementById('tableBodyV7');

        function mergeLookFirstRecords(items) {
            const map = new Map();
            items.forEach(item => {
                const ticker = String(item?.n || '').trim().toUpperCase();
                if (!ticker) return;
                const id = String(item?.id || '').trim();
                if (id && !isInstrumentActive(id)) return;
                const key = id ? `id:${id}` : `ticker:${ticker}`;
                if (!map.has(key)) map.set(key, { id, n:ticker, h:'', l:'', c:'', e:'', p:'', pm:'manual', pd:'', b:'current' });
                const record = map.get(key);
                const h = parseFloat(item?.h), l = parseFloat(item?.l), c = parseFloat(item?.c);
                if (Number.isFinite(h) && Number.isFinite(l) && h > l) {
                    record.h = item.h;
                    record.l = item.l;
                }
                if (Number.isFinite(c)) record.c = item.c;
                const entry = parseFloat(item?.e), previous = parseFloat(item?.p);
                if (Number.isFinite(entry)) record.e = item.e;
                if (Number.isFinite(previous)) record.p = item.p;
                if (['auto','manual'].includes(item?.pm)) record.pm = item.pm;
                if (record.pm === 'auto' && /^\d{4}-\d{2}-\d{2}$/.test(String(item?.pd || ''))) record.pd = item.pd;
                if (record.pm === 'manual') record.pd = '';
                if (['current','entry','previous'].includes(item?.b)) record.b = item.b;
            });
            return [...map.values()].filter(item => {
                const h = parseFloat(item.h), l = parseFloat(item.l);
                return Number.isFinite(h) && Number.isFinite(l) && h > l;
            });
        }

        function collectLookFirstRecords() {
            const domItems = [...document.querySelectorAll('#tableBodyV6 tr')].map(row => ({
                id:row.dataset.instrumentId || '',
                n:row.querySelector('.name')?.value || '',
                h:row.querySelector('.high')?.value || '',
                l:row.querySelector('.low')?.value || '',
                c:row.querySelector('.current')?.value || '',
                e:row.querySelector('.entry')?.value || '',
                p:row.querySelector('.previous')?.value || '',
                pm:row.dataset.previousMode === 'auto' ? 'auto' : 'manual',
                pd:row.dataset.previousMode === 'auto' ? (row.dataset.previousDate || '') : '',
                b:row.querySelector('.baseline')?.value || 'current'
            }));
            let savedItems = [];
            try {
                savedItems = JSON.parse(localStorage.getItem('tv_lookfirst_data_v3') || '[]');
            } catch (e) {
                savedItems = [];
            }
            // 先读已保存值，再用当前DOM覆盖，兼容某个来源暂时缺少Current的情况。
            savedItems = savedItems.filter(item => !item?.id || isInstrumentActive(item.id));
            return mergeLookFirstRecords([...savedItems, ...domItems]);
        }

        function updateLookFirstCurrent(instrumentId, ticker, value) {
            let updated = false;
            document.querySelectorAll('#tableBodyV6 tr').forEach(row => {
                const sourceTicker = (row.querySelector('.name')?.value || '').trim().toUpperCase();
                const currentInput = row.querySelector('.current');
                const idMatches = instrumentId && row.dataset.instrumentId === instrumentId;
                if ((idMatches || (!instrumentId && sourceTicker === ticker)) && currentInput) {
                    currentInput.value = value;
                    calcV6(currentInput);
                    updated = true;
                }
            });
            return updated;
        }

        function syncV7withV6(silent = false, seedData = null) {
            const v7Cache = {};
            if (Array.isArray(seedData)) {
                seedData.forEach(item => {
                    const ticker = String(item?.n || '').trim().toUpperCase();
                    const cacheKey = item?.id ? `id:${item.id}` : `ticker:${ticker}`;
                    if (ticker) v7Cache[cacheKey] = {
                        t:item.t || 'sideways', r:item.r || '', m:item.m || 'neutral',
                        s:item.s || '', g:item.g || '', g1:item.g1 || '', v:item.v || ''
                    };
                });
            } else {
                document.querySelectorAll('#tableBodyV7 tr').forEach(tr => {
                    const read = (selector, fallback = '') => tr.querySelector(selector)?.value ?? fallback;
                    const ticker = read('.name').trim().toUpperCase();
                    const instrumentId = tr.dataset.instrumentId || '';
                    const cacheKey = instrumentId ? `id:${instrumentId}` : `ticker:${ticker}`;
                    if(ticker) v7Cache[cacheKey] = {
                        t: read('.trend', 'sideways'), r: read('.rsi'), m: read('.macd', 'neutral'),
                        s: read('.stop'), g: read('.target'), g1: read('.target1'), v: read('.volume-ratio')
                    };
                });
            }

            tBodyV7.innerHTML = '';
            collectLookFirstRecords().forEach(source => {
                const ticker = source.n;
                const cacheKey = source.id ? `id:${source.id}` : `ticker:${ticker}`;
                const cached = v7Cache[cacheKey] || { t:'sideways', r:'', m:'neutral', s:'', g:'', g1:'', v:'' };
                addV7Row(ticker, cached.t, cached.r, cached.m, cached.s, cached.g, cached.v, cached.g1, source.id);
            });

            saveLocalV7();
            requestAnimationFrame(syncV7ScrollWidth);
            if (!silent) {
                const syncBtn = document.querySelector('#tab-v7 .btn-sync');
                if (!syncBtn) return;
                const originalHtml = syncBtn.innerHTML;
                syncBtn.innerHTML = '<span class="material-icons">check_circle</span> 已自动引用 Look first';
                setTimeout(() => { syncBtn.innerHTML = originalHtml; }, 1600);
            }
        }

        function getAutoPlan(h, l, c) { return calculateAutoPlan(h, l, c); }

        function movePct(price, base) { return calculateMovePct(price, base); }

        function levelHtml(level, base, fallback = '暂无') {
            if (!level || !Number.isFinite(level.price)) return `<span style="color:var(--text-secondary);">${fallback}</span>`;
            const pct = movePct(level.price, base);
            const cls = pct !== null && pct < 0 ? 'down' : 'up';
            const pctText = pct === null ? '--' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
            return `<div class="price">${level.price.toFixed(2)}</div><div class="${cls}">${pctText}</div><small>${level.label}</small>`;
        }

        function getStopCandidates(plan, entry, low) { return calculateStopCandidates(plan, entry, low); }

        function useStopCandidate(button, price) {
            const row = button.closest('tr');
            const input = row?.querySelector('.stop');
            if (!input || !Number.isFinite(price)) return;
            input.value = Number(price).toFixed(2);
            calcV7(input);
        }

        function calcV7(el, persist = true) {
            const row = el?.closest?.('tr');
            if (!row) return;
            const requiredCells = ['.market-cell','.market-summary','.support-cell','.pressure-cell','.t1-cell','.t2-cell','.rr-cell','.ai-cell'];
            if (requiredCells.some(selector => !row.querySelector(selector))) {
                syncV7withV6(true);
                return;
            }
            const read = (selector, fallback = '') => row.querySelector(selector)?.value ?? fallback;
            // 计算时直接读取 Look first 唯一数据源，不保留价格副本。
            const ticker = read('.name').trim().toUpperCase();
            const instrumentId = row.dataset.instrumentId || '';
            if (el?.classList?.contains('current-proxy')) {
                updateLookFirstCurrent(instrumentId, ticker, el.value);
            }
            const sourceRecords = collectLookFirstRecords();
            const liveSource = (instrumentId ? sourceRecords.find(item => item.id === instrumentId) : null)
                || sourceRecords.find(item => item.n === ticker) || null;
            const h = parseFloat(liveSource?.h);
            const l = parseFloat(liveSource?.l);
            const c = parseFloat(liveSource?.c);
            const entry = parseFloat(liveSource?.e);
            const previous = parseFloat(liveSource?.p);
            const volumeRatio = parseFloat(read('.volume-ratio'));
            const stop = parseFloat(read('.stop'));
            const override1 = parseFloat(read('.target1'));
            const override2 = parseFloat(read('.target'));
            const baselineMode = liveSource?.b || 'current';
            const trend = read('.trend', 'sideways');
            const rsi = parseFloat(read('.rsi'));
            const macd = read('.macd', 'neutral');
            const currentInput = row.querySelector('.current-proxy');
            const missingStructure = !Number.isFinite(h) || !Number.isFinite(l) || h <= l;
            const missingCurrent = !Number.isFinite(c) || c <= 0;
            row.classList.toggle('is-current-missing',!missingStructure&&missingCurrent);
            if(currentInput){
                currentInput.classList.toggle('is-required',!missingStructure&&missingCurrent);
                if(!missingStructure&&missingCurrent)currentInput.setAttribute('aria-invalid','true');
                else currentInput.removeAttribute('aria-invalid');
            }

            if(!missingStructure&&missingCurrent){
                row.querySelector('.market-summary').innerHTML='<span class="current-required-warning" role="status"><span class="material-icons">error_outline</span>Current required</span><br><small>Derived calculations paused</small>';
                ['support-cell','pressure-cell','t1-cell','t2-cell','rr-cell'].forEach(cls=>row.querySelector('.'+cls).innerHTML='-');
                const aiCell=row.querySelector('.ai-cell');
                aiCell.dataset.explanation='';
                aiCell.innerHTML='<span class="input-required-badge"><span class="material-icons">error_outline</span>Current Required</span>';
                syncMobileCompositeSignal(row);
                if(persist)saveLocalV7();
                return;
            }

            if (missingStructure) {
                row.querySelector('.market-summary').innerHTML = `<span class="risk-bad">Look first 数据不完整</span><br><small>H:${Number.isFinite(h)?h:'--'} L:${Number.isFinite(l)?l:'--'} C:${Number.isFinite(c)?c:'--'}</small>`;
                ['support-cell','pressure-cell','t1-cell','t2-cell','rr-cell','ai-cell'].forEach(cls => row.querySelector('.' + cls).innerHTML = '-');
                return;
            }

            const plan = getAutoPlan(h, l, c);
            const invalidOverride1 = Number.isFinite(override1) && override1 <= c;
            const invalidOverride2 = Number.isFinite(override2) && override2 <= c;
            const effectiveT1 = Number.isFinite(override1) && !invalidOverride1 ? { label:'人工覆盖 T1', price:override1 } : plan.t1;
            const effectiveT2 = Number.isFinite(override2) && !invalidOverride2 ? { label:'人工覆盖 T2', price:override2 } : plan.t2;
            let base = c, baseName = 'Current';
            if (baselineMode === 'entry' && Number.isFinite(entry) && entry > 0) { base = entry; baseName = 'Entry'; }
            else if (baselineMode === 'previous' && Number.isFinite(previous) && previous > 0) { base = previous; baseName = 'Prev Close'; }

            let zone, fiboScore;
            const levels = Object.fromEntries(plan.fibs.map(x => [x.label, x.price]));
            if (c >= h) { zone = '📈 Breakout'; fiboScore = 0; }
            else if (c >= levels['38.2%']) { zone = '⏳ Pullback'; fiboScore = 0; }
            else if (c >= levels['61.8%']) { zone = '⚖️ Correction'; fiboScore = 1; }
            else if (c >= levels['78.6%']) { zone = '💎 Golden Dip'; fiboScore = 4; }
            else if (c >= levels['88.6%']) { zone = '🚨 Danger Zone'; fiboScore = 3; }
            else if (c >= l) { zone = '🧛 Harmonic'; fiboScore = 2; }
            else { zone = '💀 Structure Broken'; fiboScore = -5; }

            const dayMove = Number.isFinite(previous) && previous > 0 ? movePct(c, previous) : null;
            const currentProxy = row.querySelector('.current-proxy');
            if (currentProxy && document.activeElement !== currentProxy) currentProxy.value = c;
            const entryMove = Number.isFinite(entry) && entry > 0 ? movePct(c, entry) : null;
            row.querySelector('.market-summary').innerHTML = `<small>${zone}</small>${dayMove === null ? '' : `<br><span class="${dayMove < 0 ? 'risk-bad' : 'risk-ok'}">vs Prev ${dayMove >= 0 ? '+' : ''}${dayMove.toFixed(2)}%</span>`}${entryMove === null ? '<br><small>Entry 未填</small>' : `<br><span class="${entryMove < 0 ? 'risk-bad' : 'risk-ok'}">vs Entry ${entryMove >= 0 ? '+' : ''}${entryMove.toFixed(2)}%</span>`}`;
            row.querySelector('.support-cell').innerHTML = levelHtml(plan.support, base);
            row.querySelector('.pressure-cell').innerHTML = levelHtml(plan.pressure, base);
            row.querySelector('.t1-cell').innerHTML = invalidOverride1
                ? `<span class="risk-bad">覆盖值须高于 Current</span><small>暂用自动 T1</small>${levelHtml(plan.t1, base)}`
                : levelHtml(effectiveT1, base);
            row.querySelector('.t2-cell').innerHTML = invalidOverride2
                ? `<span class="risk-bad">覆盖值须高于 Current</span><small>暂用自动 T2</small>${levelHtml(plan.t2, base)}`
                : levelHtml(effectiveT2, base);
            [row.querySelector('.support-cell'), row.querySelector('.pressure-cell'), row.querySelector('.t1-cell'), row.querySelector('.t2-cell')]
                .forEach(cell => cell.title = `娑ㄨ穼骞呭熀鍑嗭細${baseName}`);

            const { trendScore, momentumScore, volumeScore, volumeText, strengthBonus, totalScore } = calculateTechnicalScore({
                trend, rsi, macd, previous, volumeRatio, current:c, high:h, levels, fiboScore
            });

            const hasEntry = Number.isFinite(entry) && entry > 0;
            const rrEntry = hasEntry ? entry : c;
            const isPreview = !hasEntry;
            const stopPlan = hasEntry ? getStopCandidates(plan, entry, l) : null;
            const stopRiskPct = Number.isFinite(stop) && stop < rrEntry ? (rrEntry - stop) / rrEntry * 100 : null;
            const stopTooTight = stopRiskPct !== null && stopRiskPct < 1;
            const stopTooWide = stopRiskPct !== null && stopRiskPct > 10;
            const stopBasicValid = Number.isFinite(stop) && stop < rrEntry && !stopTooTight && !stopTooWide;
            let rr1 = null, rr2 = null;
            if (stopBasicValid) {
                if (effectiveT1 && effectiveT1.price > rrEntry) rr1 = (effectiveT1.price - rrEntry) / (rrEntry - stop);
                if (effectiveT2 && effectiveT2.price > rrEntry) rr2 = (effectiveT2.price - rrEntry) / (rrEntry - stop);
            }
            const targetPlanValid = Number.isFinite(rr2);
            const riskValid = hasEntry && stopBasicValid && targetPlanValid;
            const structureAligned = !!(stopPlan && Number.isFinite(stop) && stop <= stopPlan.structure.price * 1.003);
            const lowDrawdown = hasEntry && l < entry ? (entry - l) / entry * 100 : null;
            let rrTopHtml = '';
            if (!hasEntry) {
                rrTopHtml = `<div class="rr-message"><span class="risk-warn">Entry 未填</span><br><small>Current 仅作 R:R 预览${Number.isFinite(rr2) ? ` · T2 ${rr2.toFixed(2)}R` : ''}</small></div>`;
            } else if (!Number.isFinite(stop)) {
                rrTopHtml = '<div class="rr-message"><span class="risk-warn">待设 Manual Stop</span><br><small>可从下方选择一个基于 Entry 的方案</small></div>';
            } else if (stop >= entry) {
                rrTopHtml = '<div class="rr-message"><span class="risk-bad">Stop 必须低于 Entry</span></div>';
            } else if (stopTooTight) {
                rrTopHtml = `<div class="rr-message"><span class="risk-bad">Stop 过紧 (${stopRiskPct.toFixed(1)}%)</span><br><small>低于 Entry 的 1% 会虚增 R:R</small></div>`;
            } else if (stopTooWide) {
                rrTopHtml = `<div class="rr-message"><span class="risk-bad">Stop 过宽 (${stopRiskPct.toFixed(1)}%)</span><br><small>超过 Entry 的 10% 执行上限</small></div>`;
            } else if (!targetPlanValid) {
                rrTopHtml = '<div class="rr-message"><span class="risk-bad">目标价不高于 Entry</span></div>';
            } else {
                rrTopHtml = `<div class="rr-values"><div class="rr-value"><small>T1 R:R</small><strong class="${rr1 >= 1 ? 'risk-ok' : 'risk-bad'}">${Number.isFinite(rr1) ? `${rr1.toFixed(2)}R` : '--'}</strong></div><div class="rr-value"><small>T2 R:R</small><strong class="${rr2 >= 2 ? 'risk-ok' : 'risk-bad'}">${rr2.toFixed(2)}R</strong></div></div>`;
            }
            let riskDetails = '';
            if (hasEntry && stopRiskPct !== null) riskDetails += `<span>Manual Stop · Entry ${entry.toFixed(2)} → ${stop.toFixed(2)} · -${stopRiskPct.toFixed(1)}%</span>`;
            if (lowDrawdown !== null) riskDetails += `<span>Extreme Reference · Entry → Low · -${lowDrawdown.toFixed(1)}%</span>`;
            let stopPlanHtml = '';
            if (stopPlan) {
                const structure = stopPlan.structure;
                stopPlanHtml = `<div class="stop-plan">
                    <div class="stop-plan-title">Recommended Stops <span>All based on Entry ${entry.toFixed(2)}</span></div>
                    <div class="stop-choice structure-choice"><div><span class="stop-choice-title">Structure Stop</span><strong class="${structure.tooWide ? 'risk-warn' : ''}">${structure.price.toFixed(2)}</strong></div><small>${structure.label} · Entry risk -${structure.riskPct.toFixed(1)}%${structure.tooWide ? ' · Too Wide' : ''}</small><button class="stop-use" data-fibo-click="useStopCandidate(this,${structure.price})">Use</button></div>
                    <div class="stop-choice"><div><span class="stop-choice-title">Entry -5%</span><strong>${stopPlan.fixed5.price.toFixed(2)}</strong></div><small>Fixed stop based on Entry</small><button class="stop-use" data-fibo-click="useStopCandidate(this,${stopPlan.fixed5.price})">Use</button></div>
                    <div class="stop-choice"><div><span class="stop-choice-title">Entry -7%</span><strong>${stopPlan.fixed7.price.toFixed(2)}</strong></div><small>Fixed stop based on Entry</small><button class="stop-use" data-fibo-click="useStopCandidate(this,${stopPlan.fixed7.price})">Use</button></div>
                </div>`;
            }
            row.querySelector('.rr-cell').innerHTML = `<div class="rr-panel">${rrTopHtml}${riskDetails ? `<div class="risk-lines">${riskDetails}</div>` : ''}${stopPlanHtml}</div>`;

            const structureBroken = c < l;
            const firstBarrierTight = Number.isFinite(rr1) && rr1 < 1;
            const goodRR = riskValid && rr1 >= 1 && rr2 >= 2;
            const sniperAllowed = goodRR && trend !== 'downtrend' && structureAligned && !firstBarrierTight;
            const technicalLabel = totalScore >= 6 ? 'Strong Setup' : (totalScore >= 3 ? 'Good Structure' : (totalScore >= 1 ? 'Watch Structure' : 'Weak Structure'));
            let entryLabel = !hasEntry ? 'Entry Pending' : (!Number.isFinite(stop) ? 'Risk Plan Pending' : (!riskValid ? 'Invalid Stop / Target' : (goodRR ? 'Executable Entry' : 'R:R Pending')));

            let aiHtml = '';
            const signalName = classifyCompositeSignal({
                structureBroken, totalScore, hasEntry, hasStop:Number.isFinite(stop), riskValid, sniperAllowed, firstBarrierTight, goodRR
            });
            const signalBadges = {
                'Structure Invalid': '<span class="ai-badge" style="background:#e0e0e0;color:#757575;">🛑 Structure Invalid</span>',
                'Avoid': '<span class="ai-badge" style="background:#e0e0e0;color:#757575;">🛑 Avoid</span>',
                'Watch': '<span class="ai-badge" style="background:#ffd600;color:#333;">👀 Watch</span>',
                'Wait Better Entry': '<span class="ai-badge" style="background:#ffb300;color:#333;">⏳ Wait Better Entry</span>',
                'Risk Plan Pending': '<span class="ai-badge" style="background:#ffb300;color:#333;">🛡️ Risk Plan Pending</span>',
                'Invalid Stop': '<span class="ai-badge" style="background:#e0e0e0;color:#c5221f;">⚠️ Invalid Stop</span>',
                'Sniper Buy': '<span class="ai-badge" style="background:#d50000;color:white;">🔥 Sniper Buy</span>',
                'Wait Reclaim': '<span class="ai-badge" style="background:#ffb300;color:#333;">⏳ Wait Reclaim</span>',
                'Good Setup': '<span class="ai-badge" style="background:#00c853;color:white;">🟢 Good Setup</span>',
                'Wait Better Entry': '<span class="ai-badge" style="background:#ffb300;color:#333;">⏳ Wait Better Entry</span>'
            };
            aiHtml = signalBadges[signalName];
            aiHtml += `<div style="font-size:10px;margin-top:4px;color:#5f6368;">${technicalLabel} / ${entryLabel}</div>`;
            aiHtml += `<div style="font-size:10px;color:#5f6368;">F${fiboScore}+T${trendScore}+M${momentumScore}+V${volumeScore}+S${strengthBonus}=${totalScore}</div>`;
            aiHtml += `<div style="font-size:10px;color:${volumeScore < 0 ? '#c5221f' : '#5f6368'};">${firstBarrierTight ? '第一压力过近；' : ''}${volumeText}</div>`;
            aiHtml += '<button class="signal-why" data-fibo-click="openSignalExplanation(this)">Why this signal?</button>';
            const aiCell = row.querySelector('.ai-cell');
            aiCell.dataset.explanation = JSON.stringify({ signalName, totalScore, fiboScore, trendScore, momentumScore, volumeScore, strengthBonus, entry:hasEntry?entry:null, stop:Number.isFinite(stop)?stop:null, stopRiskPct, rr1, rr2, structureAligned, firstBarrierTight, volumeText });
            aiCell.innerHTML = aiHtml;
            syncMobileCompositeSignal(row);
            if (persist) saveLocalV7();
        }

        function addV7Row(n='', t='sideways', r='', m='neutral', s='', g='', v='', g1='', instrumentId='') {
            const tr = document.createElement('tr');
            tr.dataset.instrumentId = instrumentId;
            tr.innerHTML = `
                <td>
                    <div class="ticker-input-shell"><input type="text" class="input-name name" value="${escapePoolHtml(n)}" readonly title="标的来自 Instrument Pool">${instrumentMetaButtonHtml(instrumentId)}</div>
                </td>
                <td class="market-cell"><input type="number" class="current-proxy" placeholder="Current"><div class="market-summary">-</div></td>
                <td class="support-cell auto-level">-</td>
                <td class="pressure-cell auto-level">-</td>
                <td class="t1-cell auto-level">-</td>
                <td class="t2-cell auto-level">-</td>
                <td class="rr-cell">-</td>
                <td class="detail-col"><input type="number" step="0.01" class="input-risk volume-ratio" value="${v}" placeholder="VR" data-fibo-input="calcV7(this)"></td>
                <td class="detail-col"><input type="number" class="input-risk stop" value="${s}" placeholder="止损" data-fibo-input="calcV7(this)"></td>
                <td class="detail-col"><input type="number" class="input-risk target1" value="${g1}" placeholder="自动"></td>
                <td class="detail-col"><input type="number" class="input-risk target" value="${g}" placeholder="自动"></td>
                <td class="detail-col"><select class="trend" data-fibo-change="calcV7(this)"><option value="uptrend" ${t==='uptrend'?'selected':''}>📈 Uptrend</option><option value="sideways" ${t==='sideways'?'selected':''}>➖ Sideways</option><option value="downtrend" ${t==='downtrend'?'selected':''}>📉 Downtrend</option></select></td>
                <td class="detail-col"><input type="number" class="input-rsi rsi" value="${r}" placeholder="RSI" data-fibo-input="calcV7(this)"></td>
                <td class="detail-col"><div class="macd-input-shell"><select class="macd" data-fibo-change="calcV7(this)"><option value="neutral" ${m==='neutral'?'selected':''}>Wait/Flat</option><option value="bullish" ${m==='bullish'?'selected':''}>📈 Bullish</option><option value="bearish" ${m==='bearish'?'selected':''}>📉 Bearish</option><option value="divergence" ${m==='divergence'?'selected':''}>⭐ Bullish Divergence</option></select><button type="button" class="macd-suggest-button" data-fibo-click="openMacdSuggestion(this)" title="Suggest from Tracker close history" aria-label="Suggest MACD from Tracker close history"><span class="material-icons">auto_graph</span></button></div></td>
                <td class="ai-cell" style="background:#fff3e0;">-</td>
            `;
            tBodyV7.appendChild(tr);
            const recalcTarget = event => calcV7(event.target);
            tr.querySelectorAll('.target1, .target, .current-proxy').forEach(input => {
                input.addEventListener('input', recalcTarget);
                input.addEventListener('change', recalcTarget);
            });
            calcV7(tr.querySelector('.name'));
        }

        let pendingMacdSuggestion = null;
        let macdSuggestionRequest = 0;

        function formatMacdValue(value) { return Number.isFinite(Number(value)) ? Number(value).toFixed(4) : '--'; }

        function macdHistoryRequest(instrument) {
            const key = `${String(instrument?.market || '').toUpperCase()}:${String(instrument?.code || '').trim()}`;
            if (!macdHistoryRequestCache.has(key)) macdHistoryRequestCache.set(key,loadDailyCloses(supabaseClient,instrument));
            return macdHistoryRequestCache.get(key);
        }

        function openMacdSuggestionModal(title = 'MACD Suggestion') {
            const modal = document.getElementById('macdSuggestionBackdrop');
            document.getElementById('macdSuggestionTitle').textContent = title;
            modal.classList.add('open');
            modal.setAttribute('aria-hidden','false');
        }

        function closeMacdSuggestion() {
            macdSuggestionRequest += 1;
            pendingMacdSuggestion = null;
            const modal = document.getElementById('macdSuggestionBackdrop');
            modal.classList.remove('open');
            modal.setAttribute('aria-hidden','true');
        }

        function handleMacdSuggestionBackdrop(event) {
            if (event.target.id === 'macdSuggestionBackdrop') closeMacdSuggestion();
        }

        function divergenceCandidateHtml(candidate,label,className) {
            if (!candidate) return '';
            const first = candidate.first, second = candidate.second;
            return `<div class="macd-divergence-candidate ${className}"><strong>${label}</strong><span>${escapePoolHtml(first.date || 'Earlier pivot')} · Close ${first.close.toFixed(3)} · DIF ${formatMacdValue(first.dif)}</span><span>${escapePoolHtml(second.date || 'Later pivot')} · Close ${second.close.toFixed(3)} · DIF ${formatMacdValue(second.dif)}</span></div>`;
        }

        function renderMacdSuggestionContent() {
            const pending=pendingMacdSuggestion;
            if(!pending)return;
            const content=document.getElementById('macdSuggestionContent');
            const applyButton=document.getElementById('applyMacdSuggestionButton');
            const selected=pending.results[pending.selectedBasis]||pending.results.official;
            const hasPreview=!!pending.results.preview;
            const sourceLabel=pending.selectedBasis==='preview'
                ? `Current Preview · ${Number(pending.current).toFixed(3)}`
                : `Official Close · ${pending.officialDate||'--'}`;
            const candidateHtml=divergenceCandidateHtml(pending.divergence.bullish,'Potential Bullish Close/DIF Divergence','is-bullish')
                +divergenceCandidateHtml(pending.divergence.bearish,'Potential Bearish Close/DIF Divergence','is-bearish');
            content.dataset.macdBasis=pending.selectedBasis;
            content.innerHTML=`
                <div class="macd-suggestion-summary">
                    <div class="macd-suggestion-summary__top">
                        <span class="fibo-analysis-source fibo-analysis-source--${pending.selectedBasis}">${escapePoolHtml(sourceLabel)}</span>
                        <div class="macd-basis-toggle" role="group" aria-label="MACD analysis basis">
                            <button type="button" class="${pending.selectedBasis==='official'?'is-active':''}" data-fibo-click="selectMacdSuggestionBasis('official')" aria-pressed="${pending.selectedBasis==='official'}">Official</button>
                            <button type="button" class="${pending.selectedBasis==='preview'?'is-active':''}" data-fibo-click="selectMacdSuggestionBasis('preview')" aria-pressed="${pending.selectedBasis==='preview'}" ${hasPreview?'':'disabled'}>Preview</button>
                        </div>
                    </div>
                    <strong>${escapePoolHtml(selected.suggestion.label)}</strong>
                    <p>${escapePoolHtml(selected.suggestion.reason)}</p>
                </div>
                <div class="macd-suggestion-metrics">
                    <span><small>DIF</small><strong>${formatMacdValue(selected.snapshot.dif)}</strong></span>
                    <span><small>DEA</small><strong>${formatMacdValue(selected.snapshot.dea)}</strong></span>
                    <span><small>Histogram</small><strong>${formatMacdValue(selected.snapshot.histogram)}</strong></span>
                    <span><small>State</small><strong>${escapePoolHtml(selected.snapshot.cross)} cross · ${escapePoolHtml(selected.snapshot.zeroAxis)} zero</strong></span>
                </div>
                <div class="macd-divergence-section"><h3>Close/DIF divergence candidates</h3>${candidateHtml||'<p>No confirmed five-point candidate in the latest 60 official sessions.</p>'}<small>Candidate only. Current Preview is excluded. Verify the full K-line before manually choosing Bullish Divergence (+2).</small></div>`;
            applyButton.disabled=!selected;
        }

        function selectMacdSuggestionBasis(basis) {
            if(!pendingMacdSuggestion||!['official','preview'].includes(basis))return;
            if(basis==='preview'&&!pendingMacdSuggestion.results.preview)return;
            pendingMacdSuggestion.selectedBasis=basis;
            renderMacdSuggestionContent();
        }

        async function openMacdSuggestion(button) {
            const row = button?.closest('tr');
            const instrumentId = row?.dataset.instrumentId || '';
            const instrument = getInstrumentById(instrumentId);
            const ticker = row?.querySelector('.name')?.value || instrument?.ticker || 'Instrument';
            const applyButton = document.getElementById('applyMacdSuggestionButton');
            const content = document.getElementById('macdSuggestionContent');
            pendingMacdSuggestion = null;
            applyButton.disabled = true;
            content.innerHTML = '<div class="macd-suggestion-loading"><span class="material-icons">sync</span> Loading official close history…</div>';
            openMacdSuggestionModal(`${ticker} · MACD Suggestion`);
            const requestId = ++macdSuggestionRequest;
            if (!instrument || !['SH','SZ'].includes(String(instrument.market || '')) || !/^\d{6}$/.test(String(instrument.code || ''))) {
                content.innerHTML = '<div class="macd-suggestion-error">A six-digit SH/SZ Code is required in Instrument Pool.</div>';
                return;
            }

            button.disabled = true;
            button.classList.add('is-loading');
            try {
                const response = await macdHistoryRequest(instrument);
                if (requestId !== macdSuggestionRequest) return;
                if (response?.error) {
                    content.innerHTML = `<div class="macd-suggestion-error">History unavailable: ${escapePoolHtml(response.error.message || 'unknown error')}</div>`;
                    return;
                }
                const rows = (response?.data || []).filter(item => Number.isFinite(Number(item?.close)));
                const officialCloses = rows.map(item => Number(item.close));
                const dates = rows.map(item => String(item.trade_date || ''));
                const live = readSharedLiveInputs(localStorage,instrumentId);
                const hasPreview = Number.isFinite(Number(live.current)) && Number(live.current) > 0;
                const officialResult = buildTerminalMacdSuggestion(officialCloses);
                const previewResult = hasPreview ? buildTerminalMacdSuggestion(appendProvisionalCurrent(officialCloses,live.current)) : null;
                const divergence = detectCloseMacdDivergence(officialCloses,dates,{lookback:60,pivotRadius:2});
                pendingMacdSuggestion = { instrumentId, selectedBasis:hasPreview?'preview':'official', current:hasPreview?Number(live.current):null, officialDate:dates.at(-1)||'', results:{official:officialResult,preview:previewResult}, divergence };
                renderMacdSuggestionContent();
            } catch (error) {
                if (requestId === macdSuggestionRequest) content.innerHTML = `<div class="macd-suggestion-error">History unavailable: ${escapePoolHtml(error?.message || error)}</div>`;
            } finally {
                button.disabled = false;
                button.classList.remove('is-loading');
            }
        }

        function applyMacdSuggestion() {
            const pending = pendingMacdSuggestion;
            const value=pending?.results?.[pending.selectedBasis]?.suggestion?.value;
            if (!pending || !['neutral','bullish','bearish'].includes(value)) return;
            const row = document.querySelector(`#tableBodyV7 tr[data-instrument-id="${pending.instrumentId}"]`);
            const select = row?.querySelector('.macd');
            if (!select) return;
            select.value = value;
            calcV7(select);
            closeMacdSuggestion();
        }

        // ================= Drag & Drop / Data Save =================
        let draggedRow = null;
        function makeRowDraggable(tr, saveCallback) {
            const handle = tr.querySelector('.drag-handle');
            handle.addEventListener('mousedown', () => tr.setAttribute('draggable', 'true'));
            handle.addEventListener('mouseup', () => tr.removeAttribute('draggable'));
            tr.addEventListener('dragstart', () => { draggedRow = tr; setTimeout(() => tr.classList.add('dragging'), 0); });
            tr.addEventListener('dragend', () => { tr.classList.remove('dragging'); tr.removeAttribute('draggable'); draggedRow = null; saveCallback(); });
            tr.addEventListener('dragover', (e) => {
                e.preventDefault(); const tbody = tr.closest('tbody');
                const afterEl = getDragAfterElement(tbody, e.clientY);
                if (afterEl == null) tbody.appendChild(draggedRow); else tbody.insertBefore(draggedRow, afterEl);
            });
        }
        function getDragAfterElement(container, y) {
            const draggableEls = [...container.querySelectorAll('tr:not(.dragging)')];
            return draggableEls.reduce((closest, child) => {
                const box = child.getBoundingClientRect(); const offset = y - box.top - box.height / 2;
                if (offset < 0 && offset > closest.offset) return { offset: offset, element: child }; else return closest;
            }, { offset: Number.NEGATIVE_INFINITY }).element;
        }

        function saveLocalV6() {
            const data = [];
            document.querySelectorAll('#tableBodyV6 tr').forEach(tr => {
                data.push({
                    id:tr.dataset.instrumentId || '', n:tr.querySelector('.name').value,
                    h:tr.querySelector('.high').value, l:tr.querySelector('.low').value, c:tr.querySelector('.current').value,
                    e:tr.querySelector('.entry').value, p:tr.querySelector('.previous').value,
                    pm:tr.dataset.previousMode === 'auto' ? 'auto' : 'manual',
                    pd:tr.dataset.previousMode === 'auto' ? (tr.dataset.previousDate || '') : '',
                    b:tr.querySelector('.baseline').value
                });
            });
            const merged = mergeRowsWithHiddenInstruments('tv_lookfirst_data_v3', data);
            localStorage.setItem('tv_lookfirst_data_v3', JSON.stringify(merged));
            const pool = loadInstrumentPool();
            data.forEach((row, order) => { const item = pool.items.find(entry => entry.id === row.id); if (item) item.order = order; });
            saveInstrumentPool(pool);
            reorderStoredRowsByPool();
        }
        function saveLocalV7() {
            const data = [];
            document.querySelectorAll('#tableBodyV7 tr').forEach(tr => {
                const read = (selector, fallback = '') => tr.querySelector(selector)?.value ?? fallback;
                data.push({
                    id: tr.dataset.instrumentId || '',
                    n: read('.name'),
                    t: read('.trend', 'sideways'),
                    r: read('.rsi'),
                    m: read('.macd', 'neutral'),
                    s: read('.stop'),
                    g: read('.target'),
                    g1: read('.target1'),
                    v: read('.volume-ratio')
                });
            });
            localStorage.setItem('tv_thenleap_data_v3', JSON.stringify(mergeRowsWithHiddenInstruments('tv_thenleap_data_v3', data)));
        }

        function applySharedLiveStorageChange(storageKey) {
            if (storageKey === 'tv_lookfirst_data_v3') {
                const byId = new Map(readStoredRows(storageKey).map(row => [String(row?.id || ''),row]));
                document.querySelectorAll('#tableBodyV6 tr[data-instrument-id]').forEach(row => {
                    const id = row.dataset.instrumentId || '';
                    const input = row.querySelector('.current');
                    const stored = byId.get(id);
                    if (!input || !stored || input.value === String(stored.c ?? '')) return;
                    input.value = String(stored.c ?? '');
                    calcV6(input,false);
                    recalculateThenLeapForInstrument(id,false);
                });
            }
            if (storageKey === 'tv_thenleap_data_v3') {
                const byId = new Map(readStoredRows(storageKey).map(row => [String(row?.id || ''),row]));
                document.querySelectorAll('#tableBodyV7 tr[data-instrument-id]').forEach(row => {
                    const id = row.dataset.instrumentId || '';
                    const input = row.querySelector('.volume-ratio');
                    const stored = byId.get(id);
                    if (!input || !stored || input.value === String(stored.v ?? '')) return;
                    input.value = String(stored.v ?? '');
                    calcV7(input,false);
                });
            }
        }

        const HELP_TOPICS = {
            entry: { title:'Entry · 实际/计划买入价', html:`<h3>这是什么</h3><p>Entry 是实际持仓平均成本，或尚未成交时的计划买入价。它是执行层的唯一成本基准。</p><h3>如何计算</h3><div class="formula"><code>R:R = (Target − Entry) ÷ (Entry − Stop)</code><br><code>当前盈亏 = (Current − Entry) ÷ Entry</code></div><h3>对信号的影响</h3><p>Entry 为空时，系统可用 Current 做 R:R 预览，但预览不能把 Composite Signal 升级为 Good Setup 或 Sniper Buy。</p><h3>常见误区</h3><p>Current 是市场现价，不等于你的成本；Stop 也不是买入价。</p>` },
            previous: { title:'Prev Close · 前收盘价', html:`<h3>用途</h3><p>Prev Close用于计算Current的涨跌幅，并结合VR (5D)判断放量上涨、放量下跌或价格走平；选择Prev Close作为% Baseline时，也用于目标位涨跌幅展示。</p><h3>Auto模式</h3><p>默认根据该永久ID在Pool中的Market + Code读取Supabase行情库里<strong>最新一条正式收盘价</strong>。蓝色云按钮表示Auto；悬停可查看行情日期。相同Code可以共用一次行情请求，但每行的模式、缓存与计算仍严格按永久ID保存。</p><h3>Manual模式</h3><p>点击模式按钮可切换Manual，输入框随即解锁并保留当前数值。再次点击会恢复Auto，并用最新正式收盘覆盖。Code/Market无效、行情缺失或除权参考价需要人工校正时可使用Manual。</p><h3>缓存与日期口径</h3><p>Auto失败不会清空已有值，黄色状态表示正在使用缓存。系统始终取数据库最新正式收盘，不自动判断当天是否应改取倒数第二日；晚间复盘若Current也是当日收盘，请切换Manual核对。</p><h3>边界</h3><p>Prev Close不参与R:R。自动或手动值都会进入原有日涨跌幅和VR量价算法，但不会改变任何评分权重或阈值。</p>` },
            baseline: { title:'% Baseline · 展示基准', html:`<h3>用途</h3><p>决定支撑、压力和目标价下方涨跌幅相对于哪个价格显示：Current、Entry 或 Prev Close。</p><h3>边界</h3><p>Baseline 只改变百分比展示，不改变斐波那契价位、技术评分或 R:R；R:R 始终使用 Entry。</p>` },
            fibonacci: { title:'Fibonacci · 回撤区域', html:`<h3>计算</h3><p>以 Look First 的 High 与 Low 为区间：<code>回撤价 = High − (High − Low) × 比例</code>。23.6%、38.2%、50%、61.8%、78.6%、88.6% 用于描述价格所处区域，而不是保证支撑有效。</p><h3>F 分值</h3><p>Breakout 0；Pullback 0；Correction +1；Golden Dip +4；Danger Zone +3；Harmonic +2；Structure Broken −5。分数反映系统的左侧赔率偏好，不等于趋势已经反转。</p>` },
            targets: { title:'Targets · 目标位', html:`<h3>Look First</h3><p>Previous High 是第一档历史压力；1.272、1.618、2.618 是基于 High/Low 区间计算的延伸目标。每格同时显示目标价及相对 Baseline 的涨跌幅。</p><h3>Then Leap</h3><p>T1/T2 会根据 Current 所处阶段自动选择：修复阶段先看最近压力与前高，接近前高时看突破与第一延伸，突破后再顺延。Override 只在明确要改变自动计划时填写。</p>` },
            rr: { title:'R:R · 风险收益比', html:`<h3>公式</h3><div class="formula"><code>T1 R:R = (T1 − Entry) ÷ (Entry − Stop)</code><br><code>T2 R:R = (T2 − Entry) ÷ (Entry − Stop)</code></div><h3>执行门槛</h3><p>Good Setup 至少需要 T1 ≥ 1R、T2 ≥ 2R，并且 Entry 与有效 Stop 都已填写。Stop 风险低于 1% 视为过紧，高于 10% 视为过宽，避免人为虚增赔率。</p><h3>风险</h3><p>R:R 是计划比例，不包含跳空、滑点、流动性和成交失败风险。</p>` },
            stop: { title:'Stop · 止损与结构止损', html:`<h3>手动 Stop</h3><p>手动 Stop 永远由用户决定，系统不会自动覆盖。必须低于 Entry；计划风险应处于 1%–10%。</p><h3>结构止损</h3><p>系统寻找 Entry 下方最近的有效斐波那契支撑，并放在支撑下约 0.5%。若风险不足 3%，改用下一档支撑，避免止损贴得太紧；结构风险超过 7% 会提示 Too Wide。</p><h3>其他候选</h3><p>同时提供 Entry −5% 与 Entry −7% 作为执行参考。结构止损、固定止损各有取舍，不保证阻止跳空损失。</p>` },
            volume: { title:'VR (5D) · 五日量比', html:`<h3>定义</h3><p>直接填写券商软件基于过去五个交易日的量比。≤0.8 为缩量，0.8–1.2 正常，1.2–1.5 温和放量，≥1.5 明显放量，≥2.5 触发异常放量提示。</p><h3>评分</h3><p>系统结合 Current 相对 Prev Close 的方向判断量价关系。异常巨量不会无限加分，仍受原有 V 分值与总分门控约束。</p>` },
            trend: { title:'Trend (13d) · 趋势', html:`<h3>填写方式</h3><p>依据约 13 个交易日的价格结构手动选择 Uptrend、Sideways 或 Downtrend，而不是系统自动读取盘口。</p><h3>T 分值</h3><p>Uptrend +2，Sideways 0，Downtrend −3。Sniper Buy 禁止出现在 Downtrend，但低位技术分仍可能显示 Watch，代表观察而非确认买入。</p>` },
            rsi: { title:'RSI (14) · 相对强弱', html:`<h3>M 分值的一部分</h3><p>RSI ≤30 得 +2；30–45 得 +1；45–70 得 0；≥70 得 −2。RSI 与 MACD 合并为 Momentum，合计上限为 +3。</p><h3>误区</h3><p>超卖不代表立刻反转，超买也不代表立刻下跌；必须结合趋势、结构和风险计划。</p>` },
            macd: { title:'MACD Trend · 动量状态', html:`<h3>M 分值的一部分</h3><p>Bullish Divergence +2，Bullish +1，Neutral 0，Bearish −1；再与 RSI 分值合并，Momentum 最高 +3。</p><h3>按需建议</h3><p>行内图表按钮会读取 Tracker 的正式收盘历史，并以 12/26/9 MACD 建议 Bullish、Bearish 或 Wait/Flat。建议只在点击 Apply 后写入；Current 存在时结果会标记为 Preview。</p><h3>背离口径</h3><p>系统只提示最近60个正式交易日的收盘价/DIF背离候选，Current Preview不参与。候选不会自动选择 Bullish Divergence；必须查看完整K线并人工确认。看空背离不得使用加2分的 Bullish Divergence。</p>` },
            composite: { title:'Composite Signal · 综合信号', html:`<h3>技术分</h3><div class="formula"><code>Total = F + T + M + V + S</code></div><p>F 为斐波那契区域，T 为趋势，M 为 RSI/MACD 动量，V 为五日量价，S 为趋势强度奖励。原有权重未因 Entry/R:R 改造而改变。</p><h3>执行层</h3><p>技术分 1–2 始终只是 Watch，不能仅凭漂亮的 R:R 升级。技术分 ≥3 后，仍需 Entry、有效 Stop、T1 ≥1R、T2 ≥2R 才能成为 Good Setup。Sniper Buy 还要求总分 ≥6、非 Downtrend、止损与结构支撑对齐且第一压力不过近。</p><h3>标签</h3><p>Entry 缺失显示 Wait Better Entry；有 Entry 但无 Stop 显示 Risk Plan Pending；止损无效显示 Invalid Stop；结构跌破则优先显示 Structure Invalid/Avoid。</p>` }
        };

        function openHelp(topic, custom = null) {
            const data = custom || HELP_TOPICS[topic] || HELP_TOPICS.composite;
            document.getElementById('helpModalTitle').textContent = data.title;
            document.getElementById('helpModalContent').innerHTML = data.html;
            const modal = document.getElementById('helpModalBackdrop');
            modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
        }
        function closeHelp() {
            const modal = document.getElementById('helpModalBackdrop');
            modal.classList.remove('open'); modal.setAttribute('aria-hidden','true');
        }
        function handleHelpBackdrop(event) { if (event.target.id === 'helpModalBackdrop') closeHelp(); }
        function openSignalExplanation(button) {
            const raw = button.closest('.ai-cell, .mobile-signal-summary')?.dataset.explanation;
            if (!raw) return openHelp('composite');
            const x = JSON.parse(raw);
            const fmt = value => Number.isFinite(value) ? value.toFixed(2) : '--';
            const html = `<h3>当前结论：${x.signalName}</h3><div class="formula">F${x.fiboScore} + T${x.trendScore} + M${x.momentumScore} + V${x.volumeScore} + S${x.strengthBonus} = <strong>${x.totalScore}</strong></div><h3>执行数据</h3><p>Entry：${fmt(x.entry)}<br>Stop：${fmt(x.stop)}${Number.isFinite(x.stopRiskPct) ? `（计划风险 ${x.stopRiskPct.toFixed(1)}%）` : ''}<br>T1：${fmt(x.rr1)}R<br>T2：${fmt(x.rr2)}R<br>结构止损对齐：${x.structureAligned ? '是' : '否'}<br>第一压力过近：${x.firstBarrierTight ? '是' : '否'}</p><h3>量价说明</h3><p>${x.volumeText}</p><p style="color:var(--text-secondary);">该结论只解释系统规则，不构成收益保证或投资建议。</p>`;
            openHelp('composite', { title:`Why · ${x.signalName}`, html });
        }

        const HEADER_NOTE_KEYS = {
            marquee: 'tv_header_marquee_v1',
            tips: 'tv_header_tips_v1'
        };
        let noteEditorMode = 'tips';

        function renderHeaderMarquee() {
            const track = document.getElementById('reminderMarqueeText');
            if (!track) return;
            const savedText = localStorage.getItem(HEADER_NOTE_KEYS.marquee) || '';
            const displayText = savedText.trim() || '点击右侧铅笔，添加你的交易纪律或盘前提醒';
            track.textContent = displayText;
            const duration = Math.max(30, Math.min(120, 26 + displayText.length * 0.42));
            track.style.setProperty('--marquee-duration', `${duration}s`);
            track.style.animation = 'none';
            void track.offsetWidth;
            track.style.animation = '';
        }

        function openNoteEditor(mode) {
            noteEditorMode = mode === 'marquee' ? 'marquee' : 'tips';
            const backdrop = document.getElementById('noteModalBackdrop');
            const editor = document.getElementById('noteEditorText');
            const title = document.getElementById('noteModalTitle');
            const hint = document.getElementById('noteModalHint');
            const isMarquee = noteEditorMode === 'marquee';
            title.textContent = isMarquee ? '编辑滚动提醒' : 'Pro Tips';
            editor.value = localStorage.getItem(HEADER_NOTE_KEYS[noteEditorMode]) || '';
            editor.placeholder = isMarquee ? '例如：不追高，不重仓猜底；先看指数，再看板块，最后看个股。' : '在这里记录交易原则、操作说明、复盘提示或名言警句……';
            editor.style.minHeight = isMarquee ? '140px' : '340px';
            hint.textContent = isMarquee
                ? '保存后会在顶部慢速滚动；鼠标悬停可以暂停。Local Backup 与 Push to Cloud 均会保存。'
                : '支持长文字和换行；Local Backup 与 Push to Cloud 均会保存。';
            backdrop.classList.add('open');
            backdrop.setAttribute('aria-hidden', 'false');
            setTimeout(() => editor.focus(), 0);
        }

        function closeNoteEditor() {
            const backdrop = document.getElementById('noteModalBackdrop');
            backdrop.classList.remove('open');
            backdrop.setAttribute('aria-hidden', 'true');
        }

        function saveNoteEditor() {
            const editor = document.getElementById('noteEditorText');
            localStorage.setItem(HEADER_NOTE_KEYS[noteEditorMode], editor.value);
            if (noteEditorMode === 'marquee') renderHeaderMarquee();
            closeNoteEditor();
        }

        function handleNoteBackdrop(event) {
            if (event.target.id === 'noteModalBackdrop') closeNoteEditor();
        }

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && document.getElementById('noteModalBackdrop')?.classList.contains('open')) closeNoteEditor();
            if (event.key === 'Escape' && document.getElementById('helpModalBackdrop')?.classList.contains('open')) closeHelp();
            if (event.key === 'Escape' && document.getElementById('macdSuggestionBackdrop')?.classList.contains('open')) closeMacdSuggestion();
        });

        function exportData() {
            const combinedData = {
                v6: JSON.parse(localStorage.getItem('tv_lookfirst_data_v3') || '[]'),
                v7: JSON.parse(localStorage.getItem('tv_thenleap_data_v3') || '[]'),
                headerNotes: {
                    marquee: localStorage.getItem(HEADER_NOTE_KEYS.marquee) || '',
                    tips: localStorage.getItem(HEADER_NOTE_KEYS.tips) || ''
                },
                instrumentPool: loadInstrumentPool(),
                trendTracker: readJson(localStorage, 'tv_trend_tracker_state_v1', null)
            };
            const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(combinedData, null, 2)], { type: "application/json" }));
            a.download = `Fibo_System_Backup_${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }

        function importData(event) {
            const file = event.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = JSON.parse(e.target.result);
                    if (data.v6) localStorage.setItem('tv_lookfirst_data_v3', JSON.stringify(data.v6));
                    if (data.v7) localStorage.setItem('tv_thenleap_data_v3', JSON.stringify(data.v7));
                    if (data.headerNotes && Object.prototype.hasOwnProperty.call(data.headerNotes, 'marquee')) localStorage.setItem(HEADER_NOTE_KEYS.marquee, data.headerNotes.marquee || '');
                    if (data.headerNotes && Object.prototype.hasOwnProperty.call(data.headerNotes, 'tips')) localStorage.setItem(HEADER_NOTE_KEYS.tips, data.headerNotes.tips || '');
                    if (data.instrumentPool?.items && Array.isArray(data.instrumentPool.items)) saveInstrumentPool(data.instrumentPool);
                    if (data.trendTracker && typeof data.trendTracker === 'object') localStorage.setItem('tv_trend_tracker_state_v1', JSON.stringify(data.trendTracker));
                    reconcileLegacyTrackerInputs(localStorage,loadInstrumentPool());
                    location.reload();
                } catch (err) { alert("❌ Invalid backup file."); }
            };
            reader.readAsText(file);
        }

        function migrateExecutionFields(v6Data, v7Data) {
            const byId = new Map(), tickerGroups = new Map();
            const instruments = new Map(loadInstrumentPool().items.map(item => [String(item.id || ''),item]));
            (v7Data || []).forEach(row => {
                if (row?.id) byId.set(String(row.id), row);
                const ticker = String(row?.n || '').trim().toUpperCase();
                if (ticker) {
                    if (!tickerGroups.has(ticker)) tickerGroups.set(ticker, []);
                    tickerGroups.get(ticker).push(row);
                }
            });
            return (v6Data || []).map(row => {
                const tickerMatches = tickerGroups.get(String(row?.n || '').trim().toUpperCase()) || [];
                const legacy = (row?.id ? byId.get(String(row.id)) : null) || (tickerMatches.length === 1 ? tickerMatches[0] : null) || {};
                const instrument = instruments.get(String(row?.id || ''));
                const autoEligible = ['SH','SZ'].includes(String(instrument?.market || '')) && /^\d{6}$/.test(String(instrument?.code || ''));
                const previousMode = ['auto','manual'].includes(row?.pm) ? row.pm : (autoEligible ? 'auto' : 'manual');
                return {
                    ...row,
                    e: row?.e ?? '',
                    p: row?.p ?? legacy.p ?? '',
                    pm: previousMode,
                    pd: previousMode === 'auto' && /^\d{4}-\d{2}-\d{2}$/.test(String(row?.pd || '')) ? row.pd : '',
                    b: ['current','entry','previous'].includes(row?.b) ? row.b : (legacy.b === 'previous' ? 'previous' : 'current')
                };
            });
        }

        window.addEventListener('storage',event => {
            if (['tv_lookfirst_data_v3','tv_thenleap_data_v3'].includes(event.key)) applySharedLiveStorageChange(event.key);
        });

        window.onload = () => {
            renderHeaderMarquee();
            initializeIndexRadar({ client:supabaseClient });
            let savedV6Data = readStoredRows('tv_lookfirst_data_v3');
            let savedV7Data = readStoredRows('tv_thenleap_data_v3');
            const migrated = migrateInstrumentIdentity(savedV6Data, savedV7Data);
            savedV6Data = migrateExecutionFields(migrated.v6Data, migrated.v7Data);
            savedV7Data = migrated.v7Data;
            const existingV6Ids = new Set(savedV6Data.map(row => row.id));
            migrated.pool.items.filter(item => item.status !== 'archived' && !existingV6Ids.has(item.id)).forEach(item => savedV6Data.push({
                id:item.id, n:item.ticker, h:'', l:'', c:'', e:'', p:'',
                pm:['SH','SZ'].includes(String(item.market || '')) && /^\d{6}$/.test(String(item.code || '')) ? 'auto' : 'manual',
                pd:'', b:'current'
            }));
            localStorage.setItem('tv_lookfirst_data_v3', JSON.stringify(savedV6Data));
            const orderMap = new Map(migrated.pool.items.map(item => [item.id, Number(item.order)]));
            savedV6Data.filter(d => isInstrumentActive(d.id)).sort((a,b) => (orderMap.get(a.id) ?? 1e9) - (orderMap.get(b.id) ?? 1e9)).forEach(d => addV6Row(d.n, d.h, d.l, d.c, d.id, d.e, d.p, d.b, d.pm, d.pd));
            // 直接用 Look first 价格与 V7 附加字段合并建表，避免先生成空价格行。
            syncV7withV6(true, savedV7Data);
            refreshAllAutoPreviousCloses();
            initV7TableUX();
            renderInstrumentPool();
            const savedTab = localStorage.getItem('tv_active_tab');
            const requestedTab = new URLSearchParams(window.location.search).get('tab');
            const navigationEntry = window.performance?.getEntriesByType?.('navigation')?.[0];
            const isReload = navigationEntry?.type === 'reload';
            const cameFromLogin = document.referrer.includes('TradingViewer.html');
            const isMobileLayout = window.matchMedia('(max-width: 768px)').matches;
            // Pool是移动端入口；桌面端保持原来的 Look First / Then Leap 工作流。
            const allowedTabs = isMobileLayout ? ['pool','v6','v7'] : ['v6','v7'];
            const fallbackTab = isMobileLayout ? 'pool' : 'v6';
            const validSavedTab = allowedTabs.includes(requestedTab) ? requestedTab : (allowedTabs.includes(savedTab) ? savedTab : fallbackTab);
            const initialTab = cameFromLogin && !isReload ? fallbackTab : validSavedTab;
            switchTab(initialTab);
        };
        // ================= 🆕 新增：登出逻辑 =================
        document.getElementById('logoutBtn').addEventListener('click', async () => {
            // 同样复用已经声明好的 supabaseClient
            const { error } = await supabaseClient.auth.signOut();
    
            if (error) {
                alert('登出失败: ' + error.message);
            } else {
                alert('已安全登出！');
                localStorage.setItem('tv_active_tab', 'v6');
                // 踢回登录页
                window.location.replace('https://gaman-cheung.github.io/Fibo-Tradingviewer/TradingViewer.html');
            }
        });
    

// Central event registry; handlers stay module-scoped and are not globals.
bindDeclarativeEvents({ checkAuth, showLoader, hideLoader, saveToCloud, loadFromCloud, normalizeInstrumentName, createInstrumentId, loadInstrumentPool, mergeInstrumentPools, saveInstrumentPool, getInstrumentById, isInstrumentActive, migrateInstrumentIdentity, escapePoolHtml, readStoredRows, mergeRowsWithHiddenInstruments, renderInstrumentPool, initPoolDrag, savePoolDomOrder, reorderStoredRowsByPool, createDesktopInstrumentRow, handleDesktopTickerInput, openInstrumentDialog, closeInstrumentDialog, handleInstrumentBackdrop, saveInstrumentDialog, openInstrument, openInstrumentWave, archiveInstrument, removeInstrumentFromCurrentLayout, restoreInstrument, permanentlyDeleteInstrument, switchTab, switchMobileTerminal, updateMobileNavigation, ensureMobileCardControls, syncMobileCompositeSignal, applyMobileActiveInstrument, openMobileActions, closeMobileActions, handleMobileActionsBackdrop, syncV7ScrollWidth, initV7TableUX, applyAutoHighlight, updateV6Medals, calcV6, addV6Row, refreshPreviousCloseRow, refreshAllAutoPreviousCloses, togglePreviousCloseMode, handlePreviousCloseInput, handleCurrentInput, mergeLookFirstRecords, collectLookFirstRecords, updateLookFirstCurrent, syncV7withV6, getAutoPlan, movePct, levelHtml, getStopCandidates, useStopCandidate, calcV7, addV7Row, openMacdSuggestion, closeMacdSuggestion, handleMacdSuggestionBackdrop, selectMacdSuggestionBasis, applyMacdSuggestion, makeRowDraggable, getDragAfterElement, saveLocalV6, saveLocalV7, openHelp, closeHelp, handleHelpBackdrop, openSignalExplanation, renderHeaderMarquee, openNoteEditor, closeNoteEditor, saveNoteEditor, handleNoteBackdrop, exportData, importData, migrateExecutionFields });
