/** Shared Supabase boundary for Tracker data. No DOM or trading calculations. */
import { MARKET_OPTIONS, toBaoStockCode } from './market-code.js';
import { buildFrontAdjustedSeries } from './front-adjusted-series.js';

export async function syncMarketBindings(client, userId, pool) {
  const items = Array.isArray(pool?.items) ? pool.items : [];
  const rows = items.filter(item => item?.id && item?.code && MARKET_OPTIONS.includes(String(item.market || '').toUpperCase())).map(item => ({
    user_id:userId, instrument_id:item.id, market:String(item.market || 'OTHER').toUpperCase(),
    code:String(item.code).trim(), active:item.status !== 'archived', updated_at:new Date().toISOString()
  }));
  const existingResult = await client.from('market_instrument_bindings').select('instrument_id').eq('user_id',userId);
  if (existingResult?.error) return existingResult;
  const represented = new Set(rows.map(row => row.instrument_id));
  for (const existing of existingResult?.data || []) {
    if (!represented.has(existing.instrument_id)) rows.push({ user_id:userId, instrument_id:existing.instrument_id, market:'OTHER', code:'-', active:false, updated_at:new Date().toISOString() });
  }
  if (!rows.length) return { data:[], error:null };
  return client.from('market_instrument_bindings').upsert(rows, { onConflict:'user_id,instrument_id' });
}

export async function loadDailyCloses(client, instrument) {
  const symbol = toBaoStockCode(instrument?.market, instrument?.code);
  if (!symbol.ok) return { data:[], error:{ message:symbol.error }, symbol:null };
  const marketResponse = await client.from('market_daily_bar')
    .select('trade_date,close,pct_chg,trade_status,synced_at')
    .eq('provider','baostock').eq('market',symbol.market).eq('code',symbol.code)
    .limit(400).order('trade_date',{ ascending:false });
  if (!marketResponse?.error && marketResponse?.data?.length) {
    return { ...marketResponse, data:buildFrontAdjustedSeries(marketResponse.data), symbol:symbol.value, source:'full-market' };
  }
  const legacyResponse = await client.from('market_daily_close').select('trade_date,close,synced_at')
    .eq('provider','baostock').eq('market',symbol.market).eq('code',symbol.code)
    .order('trade_date',{ ascending:true });
  return { ...legacyResponse, symbol:symbol.value, source:'legacy', marketError:marketResponse?.error || null };
}

export async function loadMarketSyncState(client, instrument) {
  const symbol = toBaoStockCode(instrument?.market, instrument?.code);
  if (!symbol.ok) return { data:null, error:{ message:symbol.error } };
  const globalResponse = await client.from('market_sync_checkpoint').select('*')
    .eq('provider','baostock').eq('scope','CN_A').maybeSingle();
  if (!globalResponse?.error && globalResponse?.data) return globalResponse;
  return client.from('market_sync_state').select('*').eq('provider','baostock')
    .eq('market',symbol.market).eq('code',symbol.code).single();
}

export function loadTrackerState(client, userId) {
  return client.from('trend_tracker_state').select('state,updated_at').eq('user_id',userId).single();
}

export function saveTrackerState(client, userId, state) {
  return client.from('trend_tracker_state').upsert({ user_id:userId, state, updated_at:new Date().toISOString() }, { onConflict:'user_id' });
}
