/**
 * Shared immutable runtime configuration.
 * Allowed dependencies: none. Forbidden: DOM, storage and business algorithms.
 */
export const ROUTES = Object.freeze({
  auth: 'https://gaman-cheung.github.io/Fibo-Tradingviewer/TradingViewer.html',
  terminal: 'https://gaman-cheung.github.io/Fibo-Tradingviewer/Terminal.html',
  wave: 'https://gaman-cheung.github.io/Fibo-Tradingviewer/WaveAnalysis.html',
  tracker: 'https://gaman-cheung.github.io/Fibo-Tradingviewer/TrendTracker.html'
});

export const SUPABASE_PROFILES = Object.freeze({
  auth: Object.freeze({
    url: 'https://azquoojnwadtekkhxhui.supabase.co',
    key: 'sb_publishable_uj_ViNAQS0Bv6Oy6qGzUmA_n7WAFsZc'
  }),
  terminal: Object.freeze({
    url: 'https://azquoojnwadtekkhxhui.supabase.co',
    key: 'sb_publishable_uj_ViNAQS0Bv6Oy6qGzUmA_n7WAFsZc'
  }),
  wave: Object.freeze({
    url: 'https://azquoojnwadtekkhxhui.supabase.co',
    key: 'sb_publishable_uj_ViNAQS0Bv6Oy6qGzUmA_n7WAFsZc'
  }),
  tracker: Object.freeze({
    url: 'https://azquoojnwadtekkhxhui.supabase.co',
    key: 'sb_publishable_uj_ViNAQS0Bv6Oy6qGzUmA_n7WAFsZc'
  })
});

export const STORAGE_KEYS = Object.freeze({
  lookFirst: 'tv_lookfirst_data_v3',
  thenLeap: 'tv_thenleap_data_v3',
  instrumentPool: 'tv_instrument_pool_v1',
  activeInstrument: 'tv_active_instrument_id',
  activeTerminalTab: 'tv_active_tab',
  lastTerminalTab: 'tv_last_terminal_tab',
  waveState: 'wave_matrix_tabs_v3',
  marquee: 'tv_header_marquee_v1',
  tips: 'tv_header_tips_v1',
  trackerState: 'tv_trend_tracker_state_v1',
  migrationVersion: 'fibo_schema_migration_version'
});

export const CLOUD_TABLE = 'fibo_data';
