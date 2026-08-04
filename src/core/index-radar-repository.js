/** Shared Supabase read boundary for precomputed Market Radar snapshots. */

export const MARKET_RADAR_SCOPES = Object.freeze({
  MARKET_PULSE:'MARKET_PULSE',
  SECTOR_INDEX:'SECTOR_INDEX',
  EQUITY_ETF:'EQUITY_ETF',
  CROSS_ASSET:'CROSS_ASSET',
});

const INDEX_COLUMNS='provider,trade_date,algorithm_version,universe_version,benchmark_market,benchmark_code,universe_count,eligible_count,coverage,leaders,computed_at';
const ETF_COLUMNS=INDEX_COLUMNS+',scope';
const HISTORY_LIMIT=60;

const safely = request => Promise.resolve(request).catch(error=>({ data:null,error }));

function scopeConfig(scope) {
  if (scope===MARKET_RADAR_SCOPES.SECTOR_INDEX) {
    return {
      table:'market_index_radar_snapshot',
      columns:INDEX_COLUMNS,
      checkpoint:'CN_INDEX',
      applyScope:request=>request,
    };
  }
  if (scope===MARKET_RADAR_SCOPES.EQUITY_ETF || scope===MARKET_RADAR_SCOPES.CROSS_ASSET) {
    return {
      table:'market_etf_radar_snapshot',
      columns:ETF_COLUMNS,
      checkpoint:'CN_ETF',
      applyScope:request=>request.eq('scope',scope),
    };
  }
  throw new TypeError('Unsupported Market Radar scope: '+scope);
}

export async function loadMarketRadar(client,scope=MARKET_RADAR_SCOPES.SECTOR_INDEX) {
  const config=scopeConfig(scope);
  const snapshotRequest=config.applyScope(client.from(config.table)
    .select(config.columns)
    .eq('provider','baostock')).limit(1).order('trade_date',{ ascending:false });
  const historyRequest=config.applyScope(client.from(config.table)
    .select(config.columns)
    .eq('provider','baostock')).limit(HISTORY_LIMIT).order('trade_date',{ ascending:false });
  const checkpointRequest=client.from('market_sync_checkpoint').select('*')
    .eq('provider','baostock').eq('scope',config.checkpoint).maybeSingle();
  const [snapshotResponse,historyResponse,checkpointResponse]=await Promise.all([
    safely(snapshotRequest),
    safely(historyRequest),
    safely(checkpointRequest),
  ]);
  const snapshot=Array.isArray(snapshotResponse?.data)
    ? snapshotResponse.data[0]||null
    : snapshotResponse?.data||null;
  return {
    scope,
    snapshot,
    snapshots:Array.isArray(historyResponse?.data)?historyResponse.data:[],
    checkpoint:checkpointResponse?.data||null,
    error:snapshotResponse?.error||null,
    historyError:historyResponse?.error||null,
    checkpointError:checkpointResponse?.error||null,
  };
}

/** Backward-compatible boundary retained for existing imports/tests. */
export function loadLatestIndexRadar(client) {
  return loadMarketRadar(client,MARKET_RADAR_SCOPES.SECTOR_INDEX);
}
