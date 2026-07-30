/** Shared Supabase read boundary for precomputed Index Radar snapshots. */

const SNAPSHOT_COLUMNS='provider,trade_date,algorithm_version,universe_version,benchmark_market,benchmark_code,universe_count,eligible_count,coverage,leaders,computed_at';
const HISTORY_LIMIT=60;

const safely = request => Promise.resolve(request).catch(error=>({ data:null,error }));

export async function loadLatestIndexRadar(client) {
  const snapshotRequest = client.from('market_index_radar_snapshot')
    .select(SNAPSHOT_COLUMNS)
    .eq('provider','baostock').limit(1).order('trade_date',{ ascending:false });
  const historyRequest = client.from('market_index_radar_snapshot')
    .select(SNAPSHOT_COLUMNS)
    .eq('provider','baostock').limit(HISTORY_LIMIT).order('trade_date',{ ascending:false });
  const checkpointRequest = client.from('market_sync_checkpoint').select('*')
    .eq('provider','baostock').eq('scope','CN_INDEX').maybeSingle();
  const [snapshotResponse,historyResponse,checkpointResponse] = await Promise.all([
    safely(snapshotRequest),
    safely(historyRequest),
    safely(checkpointRequest),
  ]);
  const snapshot = Array.isArray(snapshotResponse?.data) ? snapshotResponse.data[0] || null : snapshotResponse?.data || null;
  return {
    snapshot,
    snapshots:Array.isArray(historyResponse?.data)?historyResponse.data:[],
    checkpoint:checkpointResponse?.data || null,
    error:snapshotResponse?.error || null,
    historyError:historyResponse?.error || null,
    checkpointError:checkpointResponse?.error || null,
  };
}
