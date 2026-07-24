/**
 * Wave page DOM/controller adapter for tabs, forms, tables and canvas.
 * Allowed: DOM plus core/wave modules. Forbidden: redefining permanent identity rules.
 * Covered by: Wave model tests and desktop/iPhone Playwright tests.
 */
import { bindDeclarativeEvents } from '../core/declarative-events.js';
import { getSupabaseClient } from '../core/supabase-client.js';
import { getAuthenticatedUser, loadCloudRow, upsertCloudRow } from '../core/cloud-repository.js';
import { runMigrations } from '../core/migrations.js';
import { rangeOf as calculateRange, directionSign as calculateDirection, addByDir as calculateAddByDir, subByDir as calculateSubByDir, calcSubTargets as calculateSubTargets, findClusters as calculateClusters } from '../wave/wave-math.js';
import { validateWaveStructure as validateWaveStructurePure } from '../wave/wave-validation.js';
import { buildWaveModel } from '../wave/wave-model.js';
import { normalizeTicker, createPermanentId, loadInstrumentPool as loadPoolCore, saveInstrumentPool as savePoolCore, mergeInstrumentPools as mergePoolsCore } from '../core/instrument-identity.js';

// 1. 初始化 Supabase 配置（请替换为您的实际凭证）
const supabaseClient = getSupabaseClient('wave');
runMigrations(localStorage);

// 🆕 核心配置 3：页面加载时“自动拦截登录态”并“自动拉取云端数据”
    // ========================================================
    // ========================================================
    // 🛠️ 2. 页面加载：安全拦截登录态
    // ========================================================
    document.addEventListener('DOMContentLoaded', async () => {
        // 使用更安全的防崩溃写法
        const { data, error } = await supabaseClient.auth.getSession();
        const session = data?.session; // 如果 data 是空，这里的 ? 符号能防止代码崩溃

        if (error || !session) {
            alert("⚠️ 检测到未登录或网络受限！\n1. 请先通过主入口登录。\n2. 如果你是在本地双击打开的，必须上传到 GitHub 线上环境测试！");
            window.location.href = 'https://gaman-cheung.github.io/Fibo-Tradingviewer/TradingViewer.html';
            return;
        }

        console.log("👋 欢迎回来，已确认用户:", session.user.email);
        await pullFromCloud();
    });

    // ========================================================
    // 🆕 补充与融合：云端数据【推送】与【拉取】函数 (已全部升级为 getUser 写法)
    // ========================================================

const STORAGE_KEY = "wave_matrix_tabs_v3";
const SHARED_INSTRUMENT_POOL_KEY = "tv_instrument_pool_v1";
const SHARED_ACTIVE_INSTRUMENT_KEY = "tv_active_instrument_id";
const SHARED_MARQUEE_KEY = "tv_header_marquee_v1";
const SHARED_TIPS_KEY = "tv_header_tips_v1";

const DEFAULT_ACTIVE_RETRACE = ["0.236", "0.382", "0.5", "0.618", "0.786", "0.886"];
const DEFAULT_ACTIVE_EXTEND = ["1", "1.272", "1.382", "1.618", "2", "2.618", "4.236"];

const W4_RETRACE = [0.236, 0.382, 0.5, 0.618];
const W5_BY_W1 = [0.618, 1, 1.272, 1.618];
const W5_BY_W3 = [0.382, 0.5, 0.618, 1];
const W5_BY_03 = [0.382, 0.618, 1];

const ABC_A = [0.236, 0.382, 0.5, 0.618];
const ABC_B = [0.382, 0.5, 0.618, 0.786, 0.886];
const ABC_C = [0.618, 1, 1.272, 1.618];

let subIdSeed = 0;
let isRestoring = false;

let appState = {
    activeTabId: null,
    tabs: [],
    uiNotes: { marquee: "", tips: "" },
    instrumentPool: { version:1, items:[], tombstones:[] }
};

function createEmptyTab(name = "新标的") {
    return {
        id: "tab_" + Date.now() + "_" + Math.random().toString(16).slice(2),
        name,
        form: {
            symbolName: name,
            p0: "",
            p1: "",
            p2: "",
            p3: "",
            p4: "",
            p5: "",
            aPoint: "",
            bPoint: "",
            customRetrace: "",
            customExtend: "",
            subToggle: false,
            showBandW3: true,
            showBandW4: true,
            showBandW5: true,
            showBandABC: true,
            activeRetraceRatios: [...DEFAULT_ACTIVE_RETRACE],
            activeExtendRatios: [...DEFAULT_ACTIVE_EXTEND],
            subWaves: []
        }
    };
}

function normalizeSharedTicker(value) { return normalizeTicker(value); }

function createSharedInstrumentId() { return createPermanentId(); }

function loadSharedInstrumentPool() {
    const localPool = loadPoolCore(localStorage);
    return mergePoolsCore(appState?.instrumentPool, localPool);
}

function saveSharedInstrumentPool(pool) {
    const saved = savePoolCore(pool, localStorage);
    appState.instrumentPool = saved;
}

function readTerminalInstrumentRows(extraRows = []) {
    let localRows = [];
    try {
        const parsed = JSON.parse(localStorage.getItem('tv_lookfirst_data_v3') || '[]');
        if (Array.isArray(parsed)) localRows = parsed;
    } catch (e) {}
    return [...localRows, ...(Array.isArray(extraRows) ? extraRows : [])]
        .filter(row => row && row.id && normalizeSharedTicker(row.n));
}

function waveTabDataScore(tab) {
    const form = tab?.form || {};
    const anchors = ['p0','p1','p2','p3','p4','p5','aPoint','bPoint','customRetrace','customExtend'];
    let score = anchors.reduce((sum,key) => sum + (String(form[key] ?? '').trim() ? 10 : 0), 0);
    if (Array.isArray(form.subWaves)) score += form.subWaves.reduce((sum,wave) => sum + ['name','high','low','current'].filter(key => String(wave?.[key] ?? '').trim()).length * 2, 0);
    return score;
}

function ensureWaveInstrumentLinks(extraTerminalRows = []) {
    const pool = loadSharedInstrumentPool();
    const now = new Date().toISOString();
    const terminalRows = readTerminalInstrumentRows(extraTerminalRows);

    terminalRows.forEach((row,index) => {
        if (pool.items.some(item => item.id === row.id)) return;
        pool.items.push({ id:row.id, ticker:String(row.n).trim(), code:'', market:'CN-A', order:index, status:'active', createdAt:now, updatedAt:now, deletedAt:null });
    });
    const terminalIds = new Set(terminalRows.map(row => row.id));
    pool.tombstones = (pool.tombstones || []).filter(entry => !terminalIds.has(entry.id));

    const hasRealInstrument = pool.items.some(item => item.status !== 'archived' && normalizeSharedTicker(item.ticker) !== normalizeSharedTicker('新标的'));
    if (hasRealInstrument) {
        const emptyPlaceholderIds = new Set(appState.tabs.filter(tab => normalizeSharedTicker(tab.name || tab.form?.symbolName) === normalizeSharedTicker('新标的') && waveTabDataScore(tab) === 0).map(tab => tab.instrumentId).filter(Boolean));
        const richPlaceholderIds = new Set(appState.tabs.filter(tab => normalizeSharedTicker(tab.name || tab.form?.symbolName) === normalizeSharedTicker('新标的') && waveTabDataScore(tab) > 0).map(tab => tab.instrumentId).filter(Boolean));
        appState.tabs = appState.tabs.filter(tab => !(normalizeSharedTicker(tab.name || tab.form?.symbolName) === normalizeSharedTicker('新标的') && waveTabDataScore(tab) === 0));
        pool.items = pool.items.filter(item => !(normalizeSharedTicker(item.ticker) === normalizeSharedTicker('新标的') && !terminalIds.has(item.id) && !richPlaceholderIds.has(item.id)) && !(emptyPlaceholderIds.has(item.id) && !terminalIds.has(item.id)));
    }

    const deletedIds = new Set((pool.tombstones || []).map(entry => entry.id));
    appState.tabs = appState.tabs.filter(tab => !tab.instrumentId || !deletedIds.has(tab.instrumentId));
    const byId = new Map(pool.items.map(item => [item.id, item]));
    const activeByTicker = new Map();
    pool.items.filter(item => item.status !== 'archived').forEach(item => {
        const ticker = normalizeSharedTicker(item.ticker);
        if (!activeByTicker.has(ticker)) activeByTicker.set(ticker, []);
        activeByTicker.get(ticker).push(item);
    });

    // Repair duplicate tab IDs without merging their data. The richer tab keeps
    // the old ID; the other tab must be linked independently.
    const tabGroups = new Map();
    const repairedDuplicateTabs = new WeakSet();
    appState.tabs.forEach(tab => {
        if (!tab.instrumentId) return;
        if (!tabGroups.has(tab.instrumentId)) tabGroups.set(tab.instrumentId, []);
        tabGroups.get(tab.instrumentId).push(tab);
    });
    tabGroups.forEach(tabs => {
        if (tabs.length < 2) return;
        const keeper = [...tabs].sort((a,b) => waveTabDataScore(b) - waveTabDataScore(a))[0];
        tabs.forEach(tab => {
            if (tab !== keeper) {
                tab.instrumentId = '';
                repairedDuplicateTabs.add(tab);
            }
        });
    });

    const usedTabIds = new Set(appState.tabs.map(tab => tab.instrumentId).filter(Boolean));
    appState.tabs.forEach((tab, index) => {
        let item = tab.instrumentId ? byId.get(tab.instrumentId) : null;
        const tickerKey = normalizeSharedTicker(tab.name || tab.form?.symbolName);
        if (!item) {
            const candidates = (activeByTicker.get(tickerKey) || []).filter(candidate => !usedTabIds.has(candidate.id));
            // Ticker fallback is allowed only when it is unambiguous. A duplicate
            // tab-ID repair may also claim the sole remaining matching pool row.
            const totalMatches = activeByTicker.get(tickerKey) || [];
            if (totalMatches.length === 1 || (repairedDuplicateTabs.has(tab) && candidates.length === 1)) item = candidates[0] || totalMatches[0];
        }
        if (!item) {
            const ticker = String(tab.name || tab.form?.symbolName || `Instrument ${index + 1}`).trim();
            item = { id:createSharedInstrumentId(), ticker, code:"", market:"OTHER", order:pool.items.length, status:"active", createdAt:now, updatedAt:now, deletedAt:null };
            pool.items.push(item);
            byId.set(item.id,item);
            if (!activeByTicker.has(normalizeSharedTicker(item.ticker))) activeByTicker.set(normalizeSharedTicker(item.ticker), []);
            activeByTicker.get(normalizeSharedTicker(item.ticker)).push(item);
        }
        tab.instrumentId = item.id;
        usedTabIds.add(item.id);
        tab.name = item.ticker;
        if (tab.form) tab.form.symbolName = item.ticker;
    });
    pool.items.filter(item => item.status !== "archived").forEach(item => {
        if (appState.tabs.some(tab => tab.instrumentId === item.id)) return;
        const tab = createEmptyTab(item.ticker);
        tab.instrumentId = item.id;
        appState.tabs.push(tab);
    });

    const order = new Map(pool.items.map(item => [item.id, Number(item.order)]));
    appState.tabs.sort((a,b) => (order.get(a.instrumentId) ?? 1e9) - (order.get(b.instrumentId) ?? 1e9));
    const activeIds = new Set(pool.items.filter(item => item.status !== "archived").map(item => item.id));
    const requestedInstrumentId = localStorage.getItem(SHARED_ACTIVE_INSTRUMENT_KEY);
    let active = appState.tabs.find(tab => tab.instrumentId === requestedInstrumentId && activeIds.has(tab.instrumentId));
    if (!active) active = appState.tabs.find(tab => tab.id === appState.activeTabId && activeIds.has(tab.instrumentId));
    if (!active) active = appState.tabs.find(tab => activeIds.has(tab.instrumentId));
    if (active) {
        appState.activeTabId = active.id;
        localStorage.setItem(SHARED_ACTIVE_INSTRUMENT_KEY, active.instrumentId);
    }
    saveSharedInstrumentPool(pool);
}

function openSharedInstrumentPool() {
    window.location.href = 'https://gaman-cheung.github.io/Fibo-Tradingviewer/Terminal.html?tab=pool';
}

function updateMobileWaveSelector() {
    const label = document.getElementById('mobileWaveSelectorName');
    const tab = activeTab();
    if (label) label.textContent = tab?.name || 'Select Instrument';
}

function openWaveInstrumentPicker() {
    renderWaveInstrumentPicker();
    const backdrop = document.getElementById('waveInstrumentPickerBackdrop');
    backdrop.classList.add('open'); backdrop.setAttribute('aria-hidden','false');
}

function closeWaveInstrumentPicker() {
    const backdrop = document.getElementById('waveInstrumentPickerBackdrop');
    backdrop.classList.remove('open'); backdrop.setAttribute('aria-hidden','true');
}

function handleWaveInstrumentPickerBackdrop(event) {
    if (event.target.id === 'waveInstrumentPickerBackdrop') closeWaveInstrumentPicker();
}

function renderWaveInstrumentPicker() {
    const list = document.getElementById('waveInstrumentPickerList');
    if (!list) return;
    const query = normalizeSharedTicker(document.getElementById('waveInstrumentSearch')?.value);
    const pool = loadSharedInstrumentPool();
    const currentId = activeTab()?.instrumentId;
    const items = pool.items.filter(item => item.status !== 'archived' && (!query || normalizeSharedTicker(`${item.ticker} ${item.code}`).includes(query))).sort((a,b) => Number(a.order)-Number(b.order));
    list.innerHTML = items.length ? items.map(item => `<button type="button" class="wave-picker-item ${item.id === currentId ? 'active' : ''}" data-fibo-click="selectWaveInstrument('${item.id}')"><span class="material-icons">${item.id === currentId ? 'check_circle' : 'radio_button_unchecked'}</span><span class="picker-main"><strong>${escapeHtml(item.ticker || 'Untitled Instrument')}</strong><small>${escapeHtml([item.code,item.market].filter(Boolean).join(' · '))}</small></span></button>`).join('') : '<div class="empty">No instruments found.</div>';
}

function selectWaveInstrument(instrumentId) {
    saveCurrentTab();
    const pool = loadSharedInstrumentPool();
    const item = pool.items.find(entry => entry.id === instrumentId && entry.status !== 'archived');
    if (!item) return;
    let tab = appState.tabs.find(entry => entry.instrumentId === instrumentId);
    if (!tab) {
        tab = createEmptyTab(item.ticker);
        tab.instrumentId = instrumentId;
        appState.tabs.push(tab);
    }
    appState.activeTabId = tab.id;
    localStorage.setItem(SHARED_ACTIVE_INSTRUMENT_KEY, instrumentId);
    persistTabs(); renderTabs(); loadTabToForm(tab); calculateAll(); updateMobileWaveSelector(); closeWaveInstrumentPicker(); initWaveMobileAccordions();
}

function persistTabs() {
    ensureWaveUiNotes();
    appState.instrumentPool = loadSharedInstrumentPool();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
}

function ensureWaveUiNotes() {
    if (!appState.uiNotes || typeof appState.uiNotes !== "object") appState.uiNotes = {};
    if (typeof appState.uiNotes.marquee !== "string") appState.uiNotes.marquee = "";
    if (typeof appState.uiNotes.tips !== "string") appState.uiNotes.tips = "";
    const sharedMarquee = localStorage.getItem(SHARED_MARQUEE_KEY);
    const sharedTips = localStorage.getItem(SHARED_TIPS_KEY);
    if (sharedMarquee !== null) appState.uiNotes.marquee = sharedMarquee;
    else localStorage.setItem(SHARED_MARQUEE_KEY, appState.uiNotes.marquee);
    if (sharedTips !== null) appState.uiNotes.tips = sharedTips;
    else localStorage.setItem(SHARED_TIPS_KEY, appState.uiNotes.tips);
    return appState.uiNotes;
}

function loadTabs() {
    const rawData = localStorage.getItem(STORAGE_KEY);

    if (!rawData) {
        const first = createEmptyTab("新标的");
        appState.tabs = [first];
        appState.activeTabId = first.id;
        persistTabs();
        return;
    }

    try {
        appState = JSON.parse(rawData);
        if (!appState.tabs || !appState.tabs.length) {
            const first = createEmptyTab("新标的");
            appState.tabs = [first];
            appState.activeTabId = first.id;
        }

        if (!appState.activeTabId || !appState.tabs.find(t => t.id === appState.activeTabId)) {
            appState.activeTabId = appState.tabs[0].id;
        }
    } catch (e) {
        const first = createEmptyTab("新标的");
        appState.tabs = [first];
        appState.activeTabId = first.id;
    }
    ensureWaveUiNotes();
}

let waveNoteEditorMode = "tips";

function renderWaveHeaderMarquee() {
    const track = document.getElementById("waveReminderMarqueeText");
    if (!track) return;
    const notes = ensureWaveUiNotes();
    const displayText = notes.marquee.trim() || "点击右侧铅笔，添加你的交易纪律或盘前提醒";
    track.textContent = displayText;
    const duration = Math.max(30, Math.min(120, 26 + displayText.length * 0.42));
    track.style.setProperty("--marquee-duration", `${duration}s`);
    track.style.animation = "none";
    void track.offsetWidth;
    track.style.animation = "";
}

function openWaveNoteEditor(mode) {
    waveNoteEditorMode = mode === "marquee" ? "marquee" : "tips";
    const notes = ensureWaveUiNotes();
    const backdrop = document.getElementById("waveNoteModalBackdrop");
    const editor = document.getElementById("waveNoteEditorText");
    const title = document.getElementById("waveNoteModalTitle");
    const hint = document.getElementById("waveNoteModalHint");
    const isMarquee = waveNoteEditorMode === "marquee";
    title.textContent = isMarquee ? "编辑滚动提醒" : "Pro Tips";
    editor.value = notes[waveNoteEditorMode] || "";
    editor.placeholder = isMarquee
        ? "例如：先确认浪级，再确认结构；不因主观预期强行数浪。"
        : "在这里记录波浪划分原则、推演说明、复盘提示或名言警句……";
    editor.style.minHeight = isMarquee ? "140px" : "340px";
    hint.textContent = isMarquee
        ? "保存后会在顶部慢速滚动；鼠标悬停可以暂停。Local Backup 与 Push to Cloud 均会保存。"
        : "支持长文字和换行；Local Backup 与 Push to Cloud 均会保存。";
    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
    setTimeout(() => editor.focus(), 0);
}

function closeWaveNoteEditor() {
    const backdrop = document.getElementById("waveNoteModalBackdrop");
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
}

function saveWaveNoteEditor() {
    const notes = ensureWaveUiNotes();
    notes[waveNoteEditorMode] = document.getElementById("waveNoteEditorText").value;
    localStorage.setItem(waveNoteEditorMode === "marquee" ? SHARED_MARQUEE_KEY : SHARED_TIPS_KEY, notes[waveNoteEditorMode]);
    persistTabs();
    if (waveNoteEditorMode === "marquee") renderWaveHeaderMarquee();
    closeWaveNoteEditor();
}

function handleWaveNoteBackdrop(event) {
    if (event.target.id === "waveNoteModalBackdrop") closeWaveNoteEditor();
}

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && document.getElementById("waveNoteModalBackdrop")?.classList.contains("open")) closeWaveNoteEditor();
});

function openWaveMobileActions() {
    const backdrop = document.getElementById("waveMobileActionsBackdrop");
    backdrop.classList.add("open"); backdrop.setAttribute("aria-hidden", "false");
}
function closeWaveMobileActions() {
    const backdrop = document.getElementById("waveMobileActionsBackdrop");
    backdrop.classList.remove("open"); backdrop.setAttribute("aria-hidden", "true");
}
function handleWaveMobileActionsBackdrop(event) {
    if (event.target.id === "waveMobileActionsBackdrop") closeWaveMobileActions();
}

function initWaveMobileAccordions() {
    if (!window.matchMedia?.('(max-width: 768px)').matches) return;
    document.querySelectorAll('aside > .card').forEach((card,index) => {
        card.classList.add('mobile-collapsible');
        if (index === 0) card.classList.add('expanded');
        const trigger = card.querySelector(':scope > .card-title, :scope > .switch-line');
        if (!trigger || trigger.dataset.mobileAccordionReady) return;
        trigger.dataset.mobileAccordionReady = '1';
        trigger.addEventListener('click', event => {
            if (event.target.closest('input,select,button,label')) return;
            card.classList.toggle('expanded');
        });
    });
    document.querySelectorAll('main .section').forEach((section,index) => {
        const trigger = section.querySelector(':scope > h3');
        if (!trigger) return;
        section.classList.add('mobile-section-collapsible');
        if (index === 0) section.classList.add('expanded');
        if (trigger.dataset.mobileAccordionReady) return;
        trigger.dataset.mobileAccordionReady = '1';
        trigger.addEventListener('click', () => section.classList.toggle('expanded'));
    });
}

function activeTab() {
    return appState.tabs.find(t => t.id === appState.activeTabId);
}

function renderTabs() {
    const box = document.getElementById("tabs");
    const activeIds = new Set(loadSharedInstrumentPool().items.filter(item => item.status !== "archived").map(item => item.id));
    box.innerHTML = appState.tabs.filter(tab => activeIds.has(tab.instrumentId)).map(tab => `
        <div class="tab ${tab.id === appState.activeTabId ? "active" : ""}" draggable="true" data-tab-id="${tab.id}" data-fibo-click="switchTab('${tab.id}')">
            <span>${escapeHtml(tab.name || "未命名标的")}</span>
            <span class="close" data-fibo-click="event.stopPropagation(); closeTab('${tab.id}')">×</span>
        </div>
    `).join("");
    initWaveTabDrag();
    updateMobileWaveSelector();
}

function initWaveTabDrag() {
    if (window.matchMedia?.('(max-width: 768px)').matches) return;
    const box = document.getElementById('tabs');
    if (!box) return;
    let dragged = null;
    box.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('dragstart', event => {
            dragged = tab;
            tab.classList.add('dragging');
            if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', tab.dataset.tabId || ''); }
        });
        tab.addEventListener('dragover', event => {
            event.preventDefault();
            if (!dragged || dragged === tab) return;
            const boxRect = tab.getBoundingClientRect();
            box.insertBefore(dragged, event.clientX < boxRect.left + boxRect.width / 2 ? tab : tab.nextSibling);
        });
        tab.addEventListener('drop', event => event.preventDefault());
        tab.addEventListener('dragend', () => {
            tab.classList.remove('dragging');
            dragged = null;
            saveWaveTabDomOrder();
        });
    });
}

function saveWaveTabDomOrder() {
    saveCurrentTab();
    const ids = [...document.querySelectorAll('#tabs .tab')].map(tab => tab.dataset.tabId);
    const byTabId = new Map(appState.tabs.map(tab => [tab.id, tab]));
    const ordered = ids.map(id => byTabId.get(id)).filter(Boolean);
    const orderedIds = new Set(ids);
    appState.tabs = [...ordered, ...appState.tabs.filter(tab => !orderedIds.has(tab.id))];

    const pool = loadSharedInstrumentPool();
    const now = new Date().toISOString();
    ordered.forEach((tab,order) => {
        const item = pool.items.find(entry => entry.id === tab.instrumentId);
        if (item) { item.order = order; item.updatedAt = now; }
    });
    saveSharedInstrumentPool(pool);
    const poolOrder = new Map(pool.items.map(item => [item.id, Number(item.order)]));
    for (const key of ['tv_lookfirst_data_v3','tv_thenleap_data_v3']) {
        let rows = [];
        try { rows = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
        if (!Array.isArray(rows)) continue;
        rows.sort((a,b) => (poolOrder.get(a.id) ?? 1e9) - (poolOrder.get(b.id) ?? 1e9));
        localStorage.setItem(key, JSON.stringify(rows));
    }
    persistTabs();
}

function createNewTab() {
    saveCurrentTab();

    const tab = createEmptyTab("新标的");
    const pool = loadSharedInstrumentPool();
    const now = new Date().toISOString();
    const instrumentId = createSharedInstrumentId();
    pool.items.push({ id:instrumentId, ticker:"新标的", code:"", market:"OTHER", order:pool.items.filter(item => item.status !== "archived").length, status:"active", createdAt:now, updatedAt:now, deletedAt:null });
    tab.instrumentId = instrumentId;
    saveSharedInstrumentPool(pool);
    appState.tabs.push(tab);
    appState.activeTabId = tab.id;
    localStorage.setItem(SHARED_ACTIVE_INSTRUMENT_KEY, instrumentId);

    persistTabs();
    renderTabs();
    loadTabToForm(tab);
    calculateAll();
}

function switchTab(id) {
    if (id === appState.activeTabId) return;

    saveCurrentTab();
    appState.activeTabId = id;

    const tab = activeTab();
    if (tab?.instrumentId) localStorage.setItem(SHARED_ACTIVE_INSTRUMENT_KEY, tab.instrumentId);
    loadTabToForm(tab);

    persistTabs();
    renderTabs();
    calculateAll();
}

function closeTab(id) {
    const idx = appState.tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const closingTab = appState.tabs[idx];
    if (closingTab.instrumentId) {
        const pool = loadSharedInstrumentPool();
        const item = pool.items.find(entry => entry.id === closingTab.instrumentId);
        if (item && !confirm(`Remove “${item.ticker}” from the shared Instrument Pool? Wave data will be retained and can be restored from Pool.`)) return;
        if (item) {
            item.status = 'archived';
            item.deletedAt = new Date().toISOString();
            item.updatedAt = item.deletedAt;
            saveSharedInstrumentPool(pool);
        }
        const nextActive = appState.tabs.find(tab => tab.id !== id && pool.items.some(entry => entry.id === tab.instrumentId && entry.status !== 'archived'));
        appState.activeTabId = nextActive?.id || null;
        if (nextActive?.instrumentId) localStorage.setItem(SHARED_ACTIVE_INSTRUMENT_KEY, nextActive.instrumentId);
        persistTabs(); renderTabs();
        if (nextActive) { loadTabToForm(nextActive); calculateAll(); }
        updateMobileWaveSelector();
        return;
    }

    if (appState.tabs.length <= 1) { alert("至少保留一个标的。"); return; }

    appState.tabs.splice(idx, 1);

    if (appState.activeTabId === id) {
        appState.activeTabId = appState.tabs[Math.max(0, idx - 1)].id;
    }
    const nextActive = activeTab();
    if (nextActive?.instrumentId) localStorage.setItem(SHARED_ACTIVE_INSTRUMENT_KEY, nextActive.instrumentId);

    persistTabs();
    renderTabs();
    loadTabToForm(activeTab());
    calculateAll();
}

function renameActiveTab(name) {
    const tab = activeTab();
    if (!tab) return;

    tab.name = name.trim() || "未命名标的";
    if (tab.form) tab.form.symbolName = name;
    const pool = loadSharedInstrumentPool();
    const item = pool.items.find(entry => entry.id === tab.instrumentId);
    if (item) { item.ticker = tab.name; item.updatedAt = new Date().toISOString(); saveSharedInstrumentPool(pool); }

    renderTabs();
    persistTabs();
}

function escapeHtml(str) {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function getInputValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : "";
}

function getCheckboxValue(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
}

function getActiveRatioValues(type) {
    return [...document.querySelectorAll(`.chip[data-type="${type}"].active`)]
        .map(el => el.dataset.val);
}

function collectSubWaveForm() {
    return [...document.querySelectorAll(".subwave-card")].map(card => {
        const id = card.dataset.id;
        return {
            type: document.getElementById(`sub_${id}_type`)?.value || "up",
            name: document.getElementById(`sub_${id}_name`)?.value || "",
            high: document.getElementById(`sub_${id}_high`)?.value || "",
            low: document.getElementById(`sub_${id}_low`)?.value || "",
            current: document.getElementById(`sub_${id}_current`)?.value || ""
        };
    });
}

function saveCurrentTab() {
    if (isRestoring) return;

    const tab = activeTab();
    if (!tab) return;

    tab.form = {
        symbolName: getInputValue("symbolName"),
        p0: getInputValue("p0"),
        p1: getInputValue("p1"),
        p2: getInputValue("p2"),
        p3: getInputValue("p3"),
        p4: getInputValue("p4"),
        p5: getInputValue("p5"),
        aPoint: getInputValue("aPoint"),
        bPoint: getInputValue("bPoint"),
        customRetrace: getInputValue("customRetrace"),
        customExtend: getInputValue("customExtend"),
        subToggle: getCheckboxValue("subToggle"),
        showBandW3: getCheckboxValue("showBandW3"),
        showBandW4: getCheckboxValue("showBandW4"),
        showBandW5: getCheckboxValue("showBandW5"),
        showBandABC: getCheckboxValue("showBandABC"),
        activeRetraceRatios: getActiveRatioValues("retrace"),
        activeExtendRatios: getActiveRatioValues("extend"),
        subWaves: collectSubWaveForm()
    };

    tab.name = tab.form.symbolName.trim() || tab.name || "未命名标的";

    persistTabs();
    renderTabs();
}

function setInputValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value ?? "";
}

function setCheckboxValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.checked = !!value;
}

function restoreRatioChips(type, activeValues) {
    const activeSet = new Set((activeValues || []).map(String));

    document.querySelectorAll(`.chip[data-type="${type}"]`).forEach(chip => {
        if (activeSet.has(String(chip.dataset.val))) {
            chip.classList.add("active");
        } else {
            chip.classList.remove("active");
        }
    });
}

function loadTabToForm(tab) {
    if (!tab) return;

    isRestoring = true;

    const f = tab.form || {};

    setInputValue("symbolName", f.symbolName || tab.name || "");
    setInputValue("p0", f.p0 || "");
    setInputValue("p1", f.p1 || "");
    setInputValue("p2", f.p2 || "");
    setInputValue("p3", f.p3 || "");
    setInputValue("p4", f.p4 || "");
    setInputValue("p5", f.p5 || "");
    setInputValue("aPoint", f.aPoint || "");
    setInputValue("bPoint", f.bPoint || "");
    setInputValue("customRetrace", f.customRetrace || "");
    setInputValue("customExtend", f.customExtend || "");

    setCheckboxValue("subToggle", !!f.subToggle);
    setCheckboxValue("showBandW3", f.showBandW3 !== false);
    setCheckboxValue("showBandW4", f.showBandW4 !== false);
    setCheckboxValue("showBandW5", f.showBandW5 !== false);
    setCheckboxValue("showBandABC", f.showBandABC !== false);

    restoreRatioChips("retrace", f.activeRetraceRatios || DEFAULT_ACTIVE_RETRACE);
    restoreRatioChips("extend", f.activeExtendRatios || DEFAULT_ACTIVE_EXTEND);

    document.getElementById("subPanel").style.display = f.subToggle ? "block" : "none";
    document.getElementById("subResultSection").style.display = f.subToggle ? "block" : "none";

    restoreSubWaves(f.subWaves || []);

    isRestoring = false;
}

function restoreSubWaves(list) {
    const box = document.getElementById("subList");
    if (!box) return;

    box.innerHTML = "";
    subIdSeed = 0;

    list.forEach(sw => {
        const legacyHigh = sw.p1 || "";
        const legacyLow = sw.p0 || "";
        const legacyCurrent = sw.p2 || "";

        addSubWave(sw.type || "up", {
            name: sw.name || "",
            high: sw.high ?? legacyHigh,
            low: sw.low ?? legacyLow,
            current: sw.current ?? legacyCurrent
        }, true);

        const last = document.querySelector(".subwave-card:last-child");
        if (!last) return;

        const id = last.dataset.id;

        document.getElementById(`sub_${id}_type`).value = sw.type || "up";
        document.getElementById(`sub_${id}_name`).value = sw.name || "";
        document.getElementById(`sub_${id}_high`).value = sw.high ?? legacyHigh;
        document.getElementById(`sub_${id}_low`).value = sw.low ?? legacyLow;
        document.getElementById(`sub_${id}_current`).value = sw.current ?? legacyCurrent;
    });
}

// 假设您已经完成了 supabase 客户端初始化，并完成了用户登录

// ☁️ 上传数据：将当前整个 appState 推送到云端对应的 wp_data 字段中
// 🛠️ 3. 云端推送
// ========================================================
async function pushToCloud() {
    if (typeof saveCurrentTab === 'function') saveCurrentTab();
    ensureWaveInstrumentLinks();
    appState.instrumentPool = loadSharedInstrumentPool();

    // 使用更安全的防崩溃写法
    const { user, error:userError } = await getAuthenticatedUser(supabaseClient);

    if (userError || !user) {
        alert("未找到有效的用户信息，请重新登录！(请确保在线上环境运行)");
        return;
    }

    const { error } = await upsertCloudRow(supabaseClient, { user_id:user.id, wp_data:appState });

    if (error) {
        alert("同步至云端失败：" + error.message);
    } else {
        alert("☁️ 矩阵数据已成功同步至云端！");
    }
}

// ========================================================
// 🛠️ 4. 云端拉取
// ========================================================
async function pullFromCloud() {
    // 使用更安全的防崩溃写法
    const { user, error:userError } = await getAuthenticatedUser(supabaseClient);

    if (userError || !user) return;

    const { data, error } = await loadCloudRow(supabaseClient, user.id, 'wp_data, v6_data');

    if (error && error.code !== 'PGRST116') {
        alert("从云端拉取失败：" + error.message);
        return;
    }

    if (data && data.wp_data) {
        appState = data.wp_data;
        const v6PoolCarrier = Array.isArray(data.v6_data) ? data.v6_data.find(item => item?.__instrument_pool_v1?.items) : null;
        const v6NoteCarrier = Array.isArray(data.v6_data) ? data.v6_data.find(item => item?.__header_notes_v1) : null;
        const pulledNotes = appState.uiNotes || v6NoteCarrier?.__header_notes_v1;
        if (pulledNotes && Object.prototype.hasOwnProperty.call(pulledNotes, 'marquee')) localStorage.setItem(SHARED_MARQUEE_KEY, pulledNotes.marquee || '');
        if (pulledNotes && Object.prototype.hasOwnProperty.call(pulledNotes, 'tips')) localStorage.setItem(SHARED_TIPS_KEY, pulledNotes.tips || '');
        if (v6PoolCarrier?.__instrument_pool_v1?.items) {
            const embeddedItems = Array.isArray(appState.instrumentPool?.items) ? appState.instrumentPool.items : [];
            const embeddedTombstones = Array.isArray(appState.instrumentPool?.tombstones) ? appState.instrumentPool.tombstones : [];
            const cloudTombstones = Array.isArray(v6PoolCarrier.__instrument_pool_v1.tombstones) ? v6PoolCarrier.__instrument_pool_v1.tombstones : [];
            appState.instrumentPool = { version:1, items:[...embeddedItems, ...v6PoolCarrier.__instrument_pool_v1.items], tombstones:[...embeddedTombstones, ...cloudTombstones] };
        }
        if (appState.instrumentPool?.items && Array.isArray(appState.instrumentPool.items)) saveSharedInstrumentPool(appState.instrumentPool);
        ensureWaveInstrumentLinks(Array.isArray(data.v6_data) ? data.v6_data : []);
        ensureWaveUiNotes();

        if (typeof persistTabs === 'function') {
            persistTabs();
            renderTabs();
            renderWaveHeaderMarquee();
            loadTabToForm(activeTab());
            calculateAll();
        }
        console.log("☁️ 成功从云端恢复推演矩阵数据！");
    }
}

// ========================================================
// 🛠️ 5. 登出
// ========================================================
async function logOutCloud() {
    // 1. 如果有自定义逻辑，保留调用
    if (typeof window.customLogOutCloud === "function") {
        window.customLogOutCloud();
    }

    try {
        // 2. 调用 Supabase 的标准登出方法
        // 注意：这里需要用到你在脚本开头定义的 supabaseClient
        const { error } = await supabaseClient.auth.signOut();

        if (error) {
            console.error("登出时出错:", error.message);
            alert("登出失败，请稍后再试。");
        } else {
            console.log("已成功清除登录状态。");
            alert('已安全登出！');

            // 3. 核心：重定向回登录页
            // 确保 TradingViewer.html 在根目录下
            window.location.href = 'https://gaman-cheung.github.io/Fibo-Tradingviewer/TradingViewer.html';
        }
    } catch (e) {
        console.error("登出逻辑异常:", e);
        // 异常情况下也强制跳转
        window.location.href = 'https://gaman-cheung.github.io/Fibo-Tradingviewer/TradingViewer.html';
    }
}

function downloadLocalBackup() {
    saveCurrentTab();

    const blob = new Blob([JSON.stringify(appState, null, 2)], {
        type: "application/json"
    });

    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);

    a.href = URL.createObjectURL(blob);
    a.download = `wave_matrix_backup_${date}.json`;
    a.click();

    URL.revokeObjectURL(a.href);
}

function importLocalBackup(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);

            if (!data.tabs || !Array.isArray(data.tabs)) {
                alert("备份文件格式不正确。");
                return;
            }

            appState = data;
            if (appState.instrumentPool?.items && Array.isArray(appState.instrumentPool.items)) saveSharedInstrumentPool(appState.instrumentPool);
            ensureWaveInstrumentLinks();
            ensureWaveUiNotes();

            if (!appState.activeTabId || !appState.tabs.find(t => t.id === appState.activeTabId)) {
                appState.activeTabId = appState.tabs[0]?.id || null;
            }

            persistTabs();
            renderTabs();
            renderWaveHeaderMarquee();
            loadTabToForm(activeTab());
            calculateAll();

            alert("本地备份已导入。");
        } catch (err) {
            alert("导入失败：JSON 文件无法解析。");
        } finally {
            event.target.value = "";
        }
    };

    reader.readAsText(file);
}

function raw(id) {
    return document.getElementById(id)?.value.trim() || "";
}

function numOrNull(id) {
    const v = raw(id);
    if (v === "") return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
}

function num(id, fallback = 0) {
    const n = numOrNull(id);
    return n === null ? fallback : n;
}

function fmt(v, d = 2) {
    if (v === null || v === undefined || !Number.isFinite(v)) return "--";
    return Number(v).toFixed(d);
}

function fmt0(v) {
    if (v === null || v === undefined || !Number.isFinite(v)) return "--";
    return Number(v).toFixed(0);
}

function pct(r) {
    return `${(r * 100).toFixed(1)}%`;
}

function parseRatios(id) {
    return raw(id)
        .split(/[,，\s]+/)
        .map(v => parseFloat(v))
        .filter(v => Number.isFinite(v) && v > 0);
}

function uniqueSorted(arr) {
    return [...new Set(arr.map(v => Number(v.toFixed(6))))].sort((a, b) => a - b);
}

function selectedChipRatios(type) {
    return [...document.querySelectorAll(`.chip[data-type="${type}"].active`)]
        .map(el => parseFloat(el.dataset.val))
        .filter(v => Number.isFinite(v) && v > 0);
}

function retraceRatios() {
    return uniqueSorted([
        ...selectedChipRatios("retrace"),
        ...parseRatios("customRetrace")
    ]);
}

function extendRatios() {
    return uniqueSorted([
        ...selectedChipRatios("extend"),
        ...parseRatios("customExtend")
    ]);
}

function rangeOf(arr) { return calculateRange(arr); }

function rangeText(r) {
    if (!r) return "--";
    if (Math.abs(r.max - r.min) < 1e-7) return fmt(r.min);
    return `${fmt(r.min)} - ${fmt(r.max)}`;
}

function makeRow(cells, cls = "") {
    return `<tr class="${cls}">${cells.map(c => `<td>${c}</td>`).join("")}</tr>`;
}

function badge(text, type = "retrace") {
    return `<span class="badge ${type}">${text}</span>`;
}

function getMain() {
    return {
        p0: numOrNull("p0"),
        p1: numOrNull("p1"),
        p2: numOrNull("p2"),
        p3: numOrNull("p3"),
        p4: numOrNull("p4"),
        p5: numOrNull("p5"),
        a: numOrNull("aPoint"),
        b: numOrNull("bPoint")
    };
}

function directionSign(p0, p1) { return calculateDirection(p0, p1); }

function addByDir(base, len, ratio, dir) { return calculateAddByDir(base, len, ratio, dir); }

function subByDir(base, len, ratio, dir) { return calculateSubByDir(base, len, ratio, dir); }

function currentStage(m) {
    if (m.p5 !== null && m.a !== null && m.b !== null) return "C浪推演";
    if (m.p5 !== null && m.a !== null) return "B/C浪推演";
    if (m.p5 !== null) return "ABC调整";
    if (m.p4 !== null) return "大5浪";
    if (m.p3 !== null) return "大4浪";
    if (m.p2 !== null) return "大3浪";
    if (m.p0 !== null && m.p1 !== null) return "大2浪";
    return "等待输入";
}

function validateWaveStructure(m, dir) {
    return validateWaveStructurePure(m, dir, fmt);
}

function buildModel() {
    return buildWaveModel({
        main:getMain(), retrace:retraceRatios(), extend:extendRatios(), subWaves:readSubWaves(), format:fmt,
        ratios:{ W4_RETRACE, W5_BY_W1, W5_BY_W3, W5_BY_03, ABC_A, ABC_B, ABC_C }
    });
}

function calculateAll() {
    const model = buildModel();

    renderStructureValidation(model);
    renderSummary(model);
    renderWave2(model);
    renderWave3(model);
    renderWave4(model);
    renderWave5(model);
    renderABC(model);
    renderSubResults(model);
    drawChart(model);
}

function renderStructureValidation(model) {
    const box = document.getElementById("structureValidation");
    if (!box) return;

    const { errors, warnings } = model.validation;
    if (!errors.length && !warnings.length) {
        box.className = "validation-box ok";
        box.innerHTML = "✅ 当前已输入节点未触发普通推动浪硬规则冲突。未填写的后续节点仍属于情景推演。";
        return;
    }

    box.className = `validation-box ${errors.length ? "error" : "warn"}`;
    const errorHtml = errors.length
        ? `<strong>⛔ 结构错误（${errors.length}）</strong><ul>${errors.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
        : "";
    const warningHtml = warnings.length
        ? `<strong>⚠ 例外/待确认（${warnings.length}）</strong><ul>${warnings.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
        : "";
    box.innerHTML = `${errorHtml}${warningHtml}<div style="margin-top:6px;">目标矩阵仍保留作重标浪级参考；存在红色错误时，不应把投影视为正式交易目标。</div>`;
}

function renderSummary(model) {
    const m = model.main;

    document.getElementById("sumW1").innerText = model.w1Len !== null ? fmt(model.w1Len) : "--";
    document.getElementById("sumStage").innerText = model.validation.errors.length ? "⚠ 结构待重标" : currentStage(m);

    const w3Range = rangeOf(model.wave3.flatMap(x => x.prices || []));
    document.getElementById("sumW3").innerText = w3Range ? `${fmt0(w3Range.min)}-${fmt0(w3Range.max)}` : "--";

    const w5Range = rangeOf(model.wave5.flatMap(x => x.prices || []));
    document.getElementById("sumW5").innerText = w5Range ? `${fmt0(w5Range.min)}-${fmt0(w5Range.max)}` : "--";

    const tbody = document.querySelector("#summaryTable tbody");
    const nodes = [
        ["P0", m.p0, "大浪起点"],
        ["P1", m.p1, "大1浪高点"],
        ["P2", m.p2, "大2浪低点"],
        ["P3", m.p3, "大3浪高点"],
        ["P4", m.p4, "大4浪低点"],
        ["P5", m.p5, "大5浪高点"],
        ["A", m.a, "A浪低点"],
        ["B", m.b, "B浪反弹高点"]
    ];

    tbody.innerHTML = nodes.map(n => makeRow([
        n[0],
        n[1] === null ? "--" : `<strong>${fmt(n[1])}</strong>`,
        n[1] === null ? `<span style="color:var(--muted);">未确认，用区间推演</span>` : `${badge("已确认", "extend")} ${n[2]}`
    ])).join("");
}

function renderWave2(model) {
    const tbody = document.querySelector("#wave2Table tbody");
    const m = model.main;

    if (!model.wave2.length) {
        tbody.innerHTML = makeRow(["--", "--", "请先填写 P0 和 P1，并至少启用一个回撤参数"]);
        return;
    }

    tbody.innerHTML = model.wave2.map(x => {
        const cls = m.p2 !== null && model.w1Len && Math.abs(x.price - m.p2) <= model.w1Len * 0.02 ? "highlight" : "";
        return makeRow([
            badge(pct(x.ratio), "retrace"),
            `<strong>${fmt(x.price)}</strong>`,
            `大1浪回撤 ${pct(x.ratio)} 的潜在防守位`
        ], cls);
    }).join("");
}

function renderWave3(model) {
    const tbody = document.querySelector("#wave3Table tbody");
    const alertBox = document.getElementById("wave3AlertBox");

    if (!model.wave3.length) {
        tbody.innerHTML = makeRow(["--", "--", "需要 P0、P1，并至少有 P2 或大2浪候选区间，同时启用延伸参数"]);
        alertBox.innerHTML = "";
        return;
    }

    tbody.innerHTML = model.wave3.map(x => makeRow([
        badge(pct(x.ratio), "extend"),
        `<strong>${rangeText(x.range)}</strong>`,
        model.main.p2 !== null
            ? `以已确认 P2=${fmt(model.main.p2)} 为起点，按浪1幅度外推`
            : `P2 未确认，基于大2浪候选区间做宽幅推演`
    ])).join("");

    const alert = getWave3ExtensionAlert(model);
    alertBox.innerHTML = alert ? renderWave3ExtensionAlert(alert, model) : "";
}

function getWave3ExtensionAlert(model) {
    const m = model.main;

    if (
        m.p0 === null ||
        m.p1 === null ||
        m.p2 === null ||
        m.p3 === null ||
        !model.w1Len ||
        !model.extend.length
    ) {
        return null;
    }

    const actualW3Len = Math.abs(m.p3 - m.p2);
    const actualRatio = actualW3Len / model.w1Len;
    const maxEnabled = Math.max(...model.extend);

    if (!Number.isFinite(actualRatio) || !Number.isFinite(maxEnabled)) return null;

    if (actualRatio <= maxEnabled) return null;

    return {
        actualW3Len,
        actualRatio,
        maxEnabled
    };
}

function renderWave3ExtensionAlert(alert, model) {
    const m = model.main;
    const highRatios = [5, 5.236, 6.18, 6.854, 8, 10];

    const rows = highRatios.map(r => {
        const target = addByDir(m.p2, model.w1Len, r, model.dir);
        const diffPct = Math.abs(m.p3 - target) / Math.abs(target || 1);

        const mark = diffPct <= 0.015
            ? badge("P3接近该级别", "warn")
            : `<span style="color:var(--muted);">距离 ${(diffPct * 100).toFixed(2)}%</span>`;

        return [
            badge(pct(r), "extend"),
            `<strong>${fmt(target)}</strong>`,
            mark
        ];
    });

    return `
        <div class="notice">
            <strong>⚠ 大3浪异常延伸监测</strong><br>
            当前大3实际幅度：${fmt(alert.actualW3Len)}，
            约为浪1的 <strong>${pct(alert.actualRatio)}</strong>。<br>
            已超过当前启用延伸矩阵上限 ${pct(alert.maxEnabled)}。<br>
            这可能意味着：三浪强延伸、P1/P2浪级偏小、或当前P3仍只是更大级别三浪内部子浪高点。<br>
            后续大4、大5推演仍会以已确认 P3 为基础继续计算。
        </div>

        <h4 style="margin-top:14px;">大3高阶延伸参考，不自动纳入默认计算</h4>
        ${tableHTML(["高阶比例", "参考价", "与P3关系"], rows)}

        <div class="hint" style="margin-top:8px;">
            如果你认为该标的长期处于极强趋势，可手动把某个高阶比例，例如 5.236 或 6.18，
            填入“自定义延伸参数”，系统才会把它纳入正式矩阵。
        </div>
    `;
}

function renderWave4(model) {
    const tbody = document.querySelector("#wave4Table tbody");
    const m = model.main;

    if (!model.wave4.length) {
        tbody.innerHTML = makeRow(["--", "--", "需要 P2，并至少有 P3 或大3浪候选区间"]);
        return;
    }

    tbody.innerHTML = model.wave4.map(x => {
        const r = x.range;
        let rule = "结构正常观察区";

        if (r && m.p1 !== null) {
            if (model.dir === 1 && r.min < m.p1) {
                rule = badge("可能跌破P1，一四浪重叠风险", "danger");
            } else if (model.dir === -1 && r.max > m.p1) {
                rule = badge("可能上破P1，一四浪重叠风险", "danger");
            } else {
                rule = badge("未触发一四浪重叠", "extend");
            }
        }

        return makeRow([
            badge(pct(x.ratio), "retrace"),
            `<strong>${rangeText(r)}</strong>`,
            rule
        ]);
    }).join("");
}

function renderWave5(model) {
    const box = document.getElementById("wave5Box");

    if (!model.wave5.length) {
        box.innerHTML = `<div class="empty">需要 P4，或需要 P2/P3 推导出大4浪候选区间后，才能推演大5浪。</div>`;
        return;
    }

    const groups = {};
    model.wave5.forEach(x => {
        if (!groups[x.method]) groups[x.method] = [];
        groups[x.method].push(x);
    });

    let html = "";

    Object.keys(groups).forEach(method => {
        html += `<h4>${method}</h4>`;
        html += tableHTML(
            ["比例", "目标价 / 区间", "说明"],
            groups[method].map(x => [
                badge(pct(x.ratio), "extend"),
                `<strong>${rangeText(x.range)}</strong>`,
                `${method}测算大5浪潜在目标`
            ])
        );
    });

    const clusters = findClusters(model.wave5.flatMap(x => x.prices || []), 0.015);

    if (clusters.length) {
        html += `<div class="notice"><strong>大5浪共振区：</strong><br>`;
        html += clusters.map(c => `• ${fmt(c.min)} - ${fmt(c.max)}，聚合点数量 ${c.count}`).join("<br>");
        html += `</div>`;
    }

    box.innerHTML = html;
}

function renderABC(model) {
    const box = document.getElementById("abcBox");
    const m = model.main;

    if (m.p5 === null) {
        box.innerHTML = `<div class="empty">P5 尚未确认。ABC 调整浪预测需要先确认或假设大5浪高点。</div>`;
        return;
    }

    let html = "";

    html += `<h4>A浪潜在下跌目标</h4>`;
    html += tableHTML(["回撤比例", "A浪目标", "说明"], model.abc.aTargets.map(x => [
        badge(pct(x.ratio), "retrace"),
        `<strong>${fmt(x.price)}</strong>`,
        `以 P5 到 P0 的整体涨幅回撤 ${pct(x.ratio)}`
    ]));

    html += `<h4>B浪反弹目标</h4>`;
    if (model.abc.bTargets.length) {
        html += tableHTML(["反弹比例", "B浪目标 / 区间", "提示"], model.abc.bTargets.map(x => {
            let warn = "A浪未确认时，以A候选区间推导";
            if (m.a !== null) warn = `以 A=${fmt(m.a)} 为起点反弹`;

            if (x.range && m.p5 !== null) {
                if (model.dir === 1 && x.range.max > m.p5) {
                    warn = badge("可能为扩大型平台或P5划分需重估", "warn");
                }
                if (model.dir === -1 && x.range.min < m.p5) {
                    warn = badge("可能为扩大型平台或P5划分需重估", "warn");
                }
            }

            return [
                badge(pct(x.ratio), "retrace"),
                `<strong>${rangeText(x.range)}</strong>`,
                warn
            ];
        }));
    } else {
        html += `<div class="empty">需要 P5，并至少有 A浪候选或 A浪确认值。</div>`;
    }

    html += `<h4>C浪下跌目标</h4>`;
    if (model.abc.cTargets.length) {
        html += tableHTML(["C浪比例", "C浪目标 / 区间", "说明"], model.abc.cTargets.map(x => [
            badge(pct(x.ratio), "extend"),
            `<strong>${rangeText(x.range)}</strong>`,
            x.ratio === 1
                ? "C=A 等长位置，常见调整目标"
                : `C浪按A浪长度的 ${pct(x.ratio)} 测算`
        ]));
    } else {
        html += `<div class="empty">C浪推演需要 A浪确认；B浪可手动填写，未填写时使用B浪候选区间。</div>`;
    }

    box.innerHTML = html;
}

function tableHTML(headers, rows) {
    if (!rows.length) {
        return `<div class="empty">当前参数下暂无可计算结果。</div>`;
    }

    return `
        <table>
            <thead>
                <tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr>
            </thead>
            <tbody>
                ${rows.map(r => makeRow(r)).join("")}
            </tbody>
        </table>
    `;
}

/**
 * 子浪波段
 */
function toggleSubPanel() {
    const checked = document.getElementById("subToggle").checked;
    document.getElementById("subPanel").style.display = checked ? "block" : "none";
    document.getElementById("subResultSection").style.display = checked ? "block" : "none";

    if (checked && document.querySelectorAll(".subwave-card").length === 0) {
        addSubWave("up");
    }

    calculateAll();
}

function addSubWave(type = "up", defaults = null, restoring = false) {
    const id = ++subIdSeed;
    const m = getMain();

    let baseLow = m.p2 ?? m.p0 ?? "";
    let baseHigh = m.p3 ?? m.p1 ?? "";

    let name = defaults?.name ?? "";
    let high = defaults?.high ?? baseHigh;
    let low = defaults?.low ?? baseLow;
    let current = defaults?.current ?? "";

    if (high === "" && low !== "") {
        high = Number(low) + 100;
    }

    if (low === "" && high !== "") {
        low = Number(high) - 100;
    }

    const div = document.createElement("div");
    div.className = "subwave-card";
    div.dataset.id = id;

    div.innerHTML = `
        <div class="subwave-header">
            <strong>子浪波段 #${id}</strong>
            <button class="btn-danger" data-fibo-click="removeSubWave(${id}); saveCurrentTab();">删除</button>
        </div>

        <div class="input-group">
            <input type="text" id="sub_${id}_name" value="${name}" placeholder=" " data-fibo-input="calculateAll(); saveCurrentTab();">
            <label>波段名称，如 子浪1、3浪-1、4浪A</label>
        </div>

        <div class="input-group">
            <select id="sub_${id}_type" data-fibo-change="calculateAll(); saveCurrentTab();">
                <option value="up" ${type === "up" ? "selected" : ""}>上涨波段</option>
                <option value="down" ${type === "down" ? "selected" : ""}>下跌波段</option>
            </select>
            <label>波段方向</label>
        </div>

        <div class="grid-3">
            <div class="input-group">
                <input type="number" id="sub_${id}_high" value="${high}" placeholder=" " data-fibo-input="calculateAll(); saveCurrentTab();">
                <label>High 波段高点</label>
            </div>

            <div class="input-group">
                <input type="number" id="sub_${id}_low" value="${low}" placeholder=" " data-fibo-input="calculateAll(); saveCurrentTab();">
                <label>Low 波段低点</label>
            </div>

            <div class="input-group">
                <input type="number" id="sub_${id}_current" value="${current}" placeholder=" " data-fibo-input="calculateAll(); saveCurrentTab();">
                <label>Current 当前价，可空</label>
            </div>
        </div>

        <p class="hint">
            上涨波段：以 Low → High 作为一个完整波段，计算回撤支撑和向上延伸。<br>
            下跌波段：以 High → Low 作为一个完整波段，计算反弹压力和向下延伸。
        </p>
    `;

    document.getElementById("subList").appendChild(div);

    if (!restoring) calculateAll();
}

function removeSubWave(id) {
    const el = document.querySelector(`.subwave-card[data-id="${id}"]`);
    if (el) el.remove();
    calculateAll();
}

function readSubWaves() {
    if (!document.getElementById("subToggle").checked) return [];

    return [...document.querySelectorAll(".subwave-card")].map(card => {
        const id = card.dataset.id;
        const type = document.getElementById(`sub_${id}_type`).value;
        const name = document.getElementById(`sub_${id}_name`)?.value.trim() || `子浪波段 #${id}`;

        const highRaw = document.getElementById(`sub_${id}_high`)?.value.trim() || "";
        const lowRaw = document.getElementById(`sub_${id}_low`)?.value.trim() || "";
        const currentRaw = document.getElementById(`sub_${id}_current`)?.value.trim() || "";

        const high = highRaw === "" ? null : parseFloat(highRaw);
        const low = lowRaw === "" ? null : parseFloat(lowRaw);
        const current = currentRaw === "" ? null : parseFloat(currentRaw);

        const valid = Number.isFinite(high) && Number.isFinite(low) && high !== low;
        const len = valid ? Math.abs(high - low) : null;

        return {
            id,
            type,
            name,
            high,
            low,
            current,
            len,
            valid
        };
    });
}

function autoContinueSubWave() {
    const waves = readSubWaves().filter(w => w.valid);

    if (!waves.length) {
        addSubWave("up");
        return;
    }

    const last = waves[waves.length - 1];
    // 本功能是同方向数学扩展，而不是自动判断下一浪方向。
    const type = last.type;

    let high, low, current;

    if (type === "up") {
        low = last.current ?? last.low;
        high = low + last.len * 1.272;
        current = "";
    } else {
        high = last.current ?? last.high;
        low = high - last.len * 1.272;
        current = "";
    }

    addSubWave(type, {
        name: "",
        high,
        low,
        current
    });
}

function calcSubTargets(sw, rts, exts) { return calculateSubTargets(sw, rts, exts); }

function renderSubResults(model) {
    const section = document.getElementById("subResultSection");
    const box = document.getElementById("subResults");

    const active = document.getElementById("subToggle").checked;
    section.style.display = active ? "block" : "none";

    if (!active) {
        box.innerHTML = "";
        return;
    }

    if (!model.subWaves.length) {
        box.innerHTML = `<div class="empty">尚未添加子浪波段。</div>`;
        return;
    }

    let html = "";

    const macroTargets = [
        ...model.wave3.flatMap(x => x.prices || []),
        ...model.wave5.flatMap(x => x.prices || [])
    ];

    model.subWaves.forEach(sw => {
        if (!sw.valid) {
            html += `
                <h4>${escapeHtml(sw.name)} ｜数据不完整</h4>
                <div class="empty">请填写有效的 High 和 Low，且 High 不能等于 Low。</div>
            `;
            return;
        }

        const t = calcSubTargets(sw, model.retrace, model.extend);
        const name = sw.type === "up" ? "上涨波段" : "下跌波段";
        const currentInfo = getSubCurrentStatus(sw, t);

        html += `
            <h4>
                ${escapeHtml(sw.name)} ｜${name}
                ｜High=${fmt(sw.high)}，Low=${fmt(sw.low)}
                ${sw.current !== null ? `，Current=${fmt(sw.current)}` : ""}
            </h4>
        `;

        if (currentInfo) {
            html += `<div class="notice">${currentInfo}</div>`;
        }

        html += tableHTML(
            [sw.type === "up" ? "回撤比例" : "反弹比例", "预测价", "说明"],
            t.retraces.map(x => [
                badge(pct(x.ratio), "retrace"),
                `<strong>${fmt(x.price)}</strong>`,
                sw.type === "up"
                    ? `该波段上涨后的潜在回撤支撑`
                    : `该波段下跌后的潜在反弹压力`
            ])
        );

        html += tableHTML(
            ["延伸比例", "预测价", "共振检测"],
            t.extensionTargets.map(x => {
                const near = macroTargets.find(mt => Math.abs(x.price - mt) / Math.abs(mt || 1) <= 0.012);

                return [
                    badge(pct(x.ratio), "extend"),
                    `<strong>${fmt(x.price)}</strong>`,
                    near
                        ? badge(`与大浪目标 ${fmt(near)} 共振`, "warn")
                        : `<span style="color:var(--muted);">暂无明显共振</span>`
                ];
            })
        );
    });

    box.innerHTML = html;
}

function getSubCurrentStatus(sw, targets) {
    if (sw.current === null || !Number.isFinite(sw.current)) return "";

    const allLevels = [
        ...targets.retraces.map(x => ({
            type: sw.type === "up" ? "回撤支撑" : "反弹压力",
            ratio: x.ratio,
            price: x.price
        })),
        ...targets.extensionTargets.map(x => ({
            type: sw.type === "up" ? "上涨延伸" : "下跌延伸",
            ratio: x.ratio,
            price: x.price
        }))
    ];

    if (!allLevels.length) return "";

    const nearest = allLevels
        .map(x => ({
            ...x,
            diff: Math.abs(sw.current - x.price),
            diffPct: Math.abs(sw.current - x.price) / Math.abs(x.price || 1)
        }))
        .sort((a, b) => a.diff - b.diff)[0];

    if (!nearest) return "";

    const nearText = nearest.diffPct <= 0.01
        ? badge("当前价接近关键位", "warn")
        : `<span style="color:var(--muted);">当前价距离最近关键位 ${(nearest.diffPct * 100).toFixed(2)}%</span>`;

    return `
        ${nearText}
        最近位置：${nearest.type} ${pct(nearest.ratio)}
        ｜价格 ${fmt(nearest.price)}
    `;
}

function findClusters(prices, tolerance = 0.015) { return calculateClusters(prices, tolerance); }

/**
 * Canvas 绘图
 */
function isChecked(id) {
    const el = document.getElementById(id);
    return el ? el.checked : true;
}

function drawChart(model) {
    const canvas = document.getElementById("chart");
    const ctx = canvas.getContext("2d");

    canvas.width = canvas.parentElement.clientWidth;

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const m = model.main;

    let prices = [];

    ["p0","p1","p2","p3","p4","p5","a","b"].forEach(k => {
        if (m[k] !== null) prices.push(m[k]);
    });

    model.wave2.forEach(x => prices.push(x.price));
    model.wave3.forEach(x => prices.push(...x.prices));
    model.wave4.forEach(x => prices.push(...x.prices));
    model.wave5.forEach(x => prices.push(...x.prices));
    model.abc.aTargets.forEach(x => prices.push(x.price));
    model.abc.bTargets.forEach(x => prices.push(...x.prices));
    model.abc.cTargets.forEach(x => prices.push(...x.prices));

    model.subWaves.forEach(sw => {
        if (sw.high !== null) prices.push(sw.high);
        if (sw.low !== null) prices.push(sw.low);
        if (sw.current !== null) prices.push(sw.current);
    });

    if (!prices.length) {
        drawEmptyChart(ctx, w, h);
        return;
    }

    const minP = Math.min(...prices) * 0.96;
    const maxP = Math.max(...prices) * 1.04;
    const range = maxP - minP || 1;

    const y = p => h - ((p - minP) / range) * (h - 70) - 35;
    const x = ratio => ratio * w;

    drawGrid(ctx, w, h);

    const w3Range = rangeOf(model.wave3.flatMap(a => a.prices || []));
    const w4Range = rangeOf(model.wave4.flatMap(a => a.prices || []));
    const w5Range = rangeOf(model.wave5.flatMap(a => a.prices || []));
    const cRange = rangeOf(model.abc.cTargets.flatMap(a => a.prices || []));

    if (isChecked("showBandW3")) {
        drawFullWidthBand(ctx, w3Range, y, w, "rgba(66,133,244,.10)", "#4285F4", "大3核心区");
    }

    if (isChecked("showBandW4")) {
        drawFullWidthBand(ctx, w4Range, y, w, "rgba(52,168,83,.13)", "#188038", "大4防守区");
    }

    if (isChecked("showBandW5")) {
        drawFullWidthBand(ctx, w5Range, y, w, "rgba(251,188,5,.14)", "#b06000", "大5核心区");
    }

    if (isChecked("showBandABC")) {
        drawFullWidthBand(ctx, cRange, y, w, "rgba(176,0,32,.10)", "#b00020", "C浪目标区");
    }

    const mainPoints = [
        ["0", m.p0, .06],
        ["①", m.p1, .18],
        ["②", m.p2, .30],
        ["③", m.p3, .44],
        ["④", m.p4, .58],
        ["⑤", m.p5, .72],
        ["A", m.a, .82],
        ["B", m.b, .90]
    ].filter(p => p[1] !== null);

    if (mainPoints.length >= 2) {
        ctx.save();
        ctx.strokeStyle = "#4285F4";
        ctx.lineWidth = 3;
        ctx.setLineDash([]);
        ctx.beginPath();

        mainPoints.forEach((p, i) => {
            const px = x(p[2]);
            const py = y(p[1]);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        });

        ctx.stroke();
        ctx.restore();
    }

    mainPoints.forEach(p => drawPoint(ctx, p[0], x(p[2]), y(p[1]), "#4285F4"));

    /**
     * 修正点：
     * 子浪不再单独从画布中间开始，而是从主浪最后一个已确认点连续接上。
     */
    const validSubs = model.subWaves.filter(sw => sw.valid);

    if (validSubs.length) {
        const anchor = mainPoints.length ? mainPoints[mainPoints.length - 1] : null;
        const points = [];

        if (anchor) {
            points.push({
                label: anchor[0],
                price: anchor[1],
                ratio: anchor[2],
                isAnchor: true
            });
        }

        validSubs.forEach(sw => {
            let segmentPoints;

            if (sw.type === "up") {
                segmentPoints = [
                    { label: `s${sw.id}-L`, price: sw.low },
                    { label: `s${sw.id}-H`, price: sw.high }
                ];
            } else {
                segmentPoints = [
                    { label: `s${sw.id}-H`, price: sw.high },
                    { label: `s${sw.id}-L`, price: sw.low }
                ];
            }

            if (sw.current !== null && Number.isFinite(sw.current)) {
                segmentPoints.push({
                    label: `s${sw.id}-C`,
                    price: sw.current
                });
            }

            segmentPoints.forEach(p => {
                const last = points[points.length - 1];

                if (last && Math.abs(last.price - p.price) < 1e-7) {
                    return;
                }

                points.push(p);
            });
        });

        if (points.length >= 2) {
            const startRatio = anchor ? Math.min(anchor[2] + 0.04, 0.74) : 0.36;
            const endRatio = 0.92;
            const movableCount = anchor ? points.length - 1 : points.length;
            const step = movableCount > 0 ? (endRatio - startRatio) / movableCount : 0;

            points.forEach((p, i) => {
                if (p.isAnchor) {
                    p.x = x(p.ratio);
                } else {
                    const movableIndex = anchor ? i - 1 : i;
                    p.x = x(startRatio + step * movableIndex);
                }

                p.y = y(p.price);
            });

            ctx.save();
            ctx.strokeStyle = "#009688";
            ctx.lineWidth = 2.4;
            ctx.beginPath();

            points.forEach((p, i) => {
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            });

            ctx.stroke();
            ctx.restore();

            points.forEach(p => {
                if (!p.isAnchor) {
                    drawPoint(ctx, p.label, p.x, p.y, "#188038", 10);
                }
            });
        }
    }
}

function drawEmptyChart(ctx, w, h) {
    drawGrid(ctx, w, h);

    ctx.save();
    ctx.fillStyle = "#999";
    ctx.font = "14px Roboto";
    ctx.textAlign = "center";
    ctx.fillText("请输入 P0 和 P1 开始推演", w / 2, h / 2);
    ctx.restore();
}

function drawGrid(ctx, w, h) {
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,.05)";
    ctx.lineWidth = 1;

    for (let i = 1; i < 6; i++) {
        const yy = h / 6 * i;
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(w, yy);
        ctx.stroke();
    }

    ctx.restore();
}

function drawFullWidthBand(ctx, r, yFn, w, fill, stroke, label) {
    if (!r) return;

    const yTop = yFn(r.max);
    const yBottom = yFn(r.min);

    const top = Math.min(yTop, yBottom);
    const height = Math.max(Math.abs(yBottom - yTop), 4);

    const left = 38;
    const right = w - 38;

    ctx.save();

    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;

    ctx.fillRect(left, top, right - left, height);
    ctx.strokeRect(left, top, right - left, height);

    ctx.fillStyle = stroke;
    ctx.font = "12px Roboto";
    ctx.fillText(`${label}: ${fmt0(r.min)} - ${fmt0(r.max)}`, left + 8, top + 15);

    ctx.restore();
}

function drawPoint(ctx, text, px, py, color, size = 12) {
    ctx.save();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `bold ${size}px Roboto`;
    ctx.fillText(text, px + 6, py - 8);

    ctx.restore();
}

/**
 * 斐波那契 chip 点击
 */
document.addEventListener("click", function(e) {
    const chip = e.target.closest(".selectable-ratios .chip");
    if (!chip) return;

    chip.classList.toggle("active");
    calculateAll();
    saveCurrentTab();
});

window.addEventListener("resize", calculateAll);

window.onload = function() {
    loadTabs();
    ensureWaveInstrumentLinks();
    persistTabs();
    renderTabs();
    renderWaveHeaderMarquee();
    loadTabToForm(activeTab());
    calculateAll();
    initWaveMobileAccordions();
};


// Central event registry; handlers stay module-scoped and are not globals.
bindDeclarativeEvents({ createEmptyTab, normalizeSharedTicker, createSharedInstrumentId, loadSharedInstrumentPool, saveSharedInstrumentPool, readTerminalInstrumentRows, waveTabDataScore, ensureWaveInstrumentLinks, openSharedInstrumentPool, updateMobileWaveSelector, openWaveInstrumentPicker, closeWaveInstrumentPicker, handleWaveInstrumentPickerBackdrop, renderWaveInstrumentPicker, selectWaveInstrument, persistTabs, ensureWaveUiNotes, loadTabs, renderWaveHeaderMarquee, openWaveNoteEditor, closeWaveNoteEditor, saveWaveNoteEditor, handleWaveNoteBackdrop, openWaveMobileActions, closeWaveMobileActions, handleWaveMobileActionsBackdrop, initWaveMobileAccordions, activeTab, renderTabs, initWaveTabDrag, saveWaveTabDomOrder, createNewTab, switchTab, closeTab, renameActiveTab, escapeHtml, getInputValue, getCheckboxValue, getActiveRatioValues, collectSubWaveForm, saveCurrentTab, setInputValue, setCheckboxValue, restoreRatioChips, loadTabToForm, restoreSubWaves, pushToCloud, pullFromCloud, logOutCloud, downloadLocalBackup, importLocalBackup, raw, numOrNull, num, fmt, fmt0, pct, parseRatios, uniqueSorted, selectedChipRatios, retraceRatios, extendRatios, rangeOf, rangeText, makeRow, badge, getMain, directionSign, addByDir, subByDir, currentStage, validateWaveStructure, buildModel, calculateAll, renderStructureValidation, renderSummary, renderWave2, renderWave3, getWave3ExtensionAlert, renderWave3ExtensionAlert, renderWave4, renderWave5, renderABC, tableHTML, toggleSubPanel, addSubWave, removeSubWave, readSubWaves, autoContinueSubWave, calcSubTargets, renderSubResults, getSubCurrentStatus, findClusters, isChecked, drawChart, drawEmptyChart, drawGrid, drawFullWidthBand, drawPoint });
