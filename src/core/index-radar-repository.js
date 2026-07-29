/** Shared Supabase read boundary for precomputed Index Radar snapshots. */

export async function loadLatestIndexRadar(client) {
  const snapshotRequest = client.from('market_index_radar_snapshot')
    .select('provider,trade_date,algorithm_version,universe_version,benchmark_market,benchmark_code,universe_count,eligible_count,coverage,leaders,computed_at')
    .eq('provider','baostock').limit(1).order('trade_date',{ ascending:false });
  const checkpointRequest = client.from('market_sync_checkpoint').select('*')
    .eq('provider','baostock').eq('scope','CN_INDEX').maybeSingle();
  const [snapshotResponse,checkpointResponse] = await Promise.all([snapshotRequest,checkpointRequest]);
  const snapshot = Array.isArray(snapshotResponse?.data) ? snapshotResponse.data[0] || null : snapshotResponse?.data || null;
  return {
    snapshot,
    checkpoint:checkpointResponse?.data || null,
    error:snapshotResponse?.error || null,
    checkpointError:checkpointResponse?.error || null,
  };
}
