/** Authenticated, read-only access to the independent atomic v1 snapshot. */
import { getSupabaseClient } from './supabase-client.js';
import { normalizeScan,normalizeRegime,officialDate } from '../radar/market-insights-view-model.js';

export const INSIGHTS_ALGORITHM_VERSION='insights-v1';
const scopes=['SECTOR_INDEX','EQUITY_ETF','CROSS_ASSET'];
const unavailable=(status,scope)=>({status,scope,scan:null,regime:null});

export async function readMarketInsights({ scope, client } = {}) {
  if(![...scopes,'MARKET_PULSE'].includes(scope)) throw new TypeError('Unsupported Insights scope');
  client ||= getSupabaseClient('terminal');
  const {data,error}=await client.from('market_insights_snapshot')
    .select('provider,trade_date,algorithm_version,universe_version,presentation_version,calculation_id,scans,regime')
    .eq('provider','baostock').limit(1).order('trade_date',{ascending:false});
  if(error) {
    if(['42P01','PGRST205'].includes(error.code)) return unavailable('not_configured',scope);
    throw new Error('Independent snapshot read failed');
  }
  const row=data?.[0];
  if(!row) return unavailable('empty',scope);
  if(row.provider!=='baostock'||!officialDate(row.trade_date)||row.algorithm_version!==INSIGHTS_ALGORITHM_VERSION
    ||row.universe_version!==2||row.presentation_version!==1||typeof row.calculation_id!=='string'||!row.calculation_id) throw new Error('Incompatible Insights publication');
  const scans={};
  for(const name of scopes) {
    const value=row.scans?.[name];
    scans[name]=normalizeScan(value,name);
    if(!scans[name]||value.tradeDate!==row.trade_date||value.algorithmVersion!==INSIGHTS_ALGORITHM_VERSION
      ||value.universeVersion!=='live-reviewed-catalog-v2') throw new Error('Incomplete or mixed-date Insights bundle');
  }
  const regime=normalizeRegime(row.regime);
  if(row.regime!=null&&(!regime||regime.tradeDate!==row.trade_date||regime.algorithmVersion!==INSIGHTS_ALGORITHM_VERSION)) throw new Error('Incompatible regime publication');
  const scan=scans[scope]||null;
  return {status:scan||regime?'ready':'empty',scope,scan,regime};
}
