/** Authenticated browser read boundary for precomputed Market Pulse data. */

const SNAPSHOT_COLUMNS='provider,trade_date,algorithm_version,index_universe_version,calculation_id,pulse_score,pulse_state,stock_eligible_count,index_eligible_count,stock_coverage,index_coverage,participation,trend_breadth,expansion,leadership,computed_at';
const MEMBER_COLUMNS='provider,trade_date,calculation_id,member_type,market,code,name,theme_group,close,return_1d,return_5d,direction_1d,direction_5d,strong_up,strong_down,above_ma20,above_ma60,ma20_rising,ma60_rising,new_high_20,new_low_20,ma60_breakout,ma60_breakdown,distance_ma20_pct,distance_ma60_pct,ma20_slope_pct,ma60_slope_pct';
const HISTORY_LIMIT=60;

export const PULSE_MEMBER_FILTERS=Object.freeze({
  up1d:{ label:'1D Up',memberType:'stock',field:'direction_1d',op:'gt',value:0,order:'return_1d',ascending:false },
  down1d:{ label:'1D Down',memberType:'stock',field:'direction_1d',op:'lt',value:0,order:'return_1d',ascending:true },
  up5d:{ label:'5D Up',memberType:'stock',field:'direction_5d',op:'gt',value:0,order:'return_5d',ascending:false },
  down5d:{ label:'5D Down',memberType:'stock',field:'direction_5d',op:'lt',value:0,order:'return_5d',ascending:true },
  strongUp:{ label:'Strong Up',memberType:'stock',field:'strong_up',op:'eq',value:true,order:'return_1d',ascending:false },
  strongDown:{ label:'Strong Down',memberType:'stock',field:'strong_down',op:'eq',value:true,order:'return_1d',ascending:true },
  aboveMA20:{ label:'Above MA20',memberType:'stock',field:'above_ma20',op:'eq',value:true,order:'distance_ma20_pct',ascending:false },
  belowMA20:{ label:'Below MA20',memberType:'stock',field:'above_ma20',op:'eq',value:false,order:'distance_ma20_pct',ascending:true },
  aboveMA60:{ label:'Above MA60',memberType:'stock',field:'above_ma60',op:'eq',value:true,order:'distance_ma60_pct',ascending:false },
  belowMA60:{ label:'Below MA60',memberType:'stock',field:'above_ma60',op:'eq',value:false,order:'distance_ma60_pct',ascending:true },
  ma20Rising:{ label:'MA20 Rising',memberType:'stock',field:'ma20_rising',op:'eq',value:true,order:'ma20_slope_pct',ascending:false },
  ma20NotRising:{ label:'MA20 Not Rising',memberType:'stock',field:'ma20_rising',op:'eq',value:false,order:'ma20_slope_pct',ascending:true },
  ma60Rising:{ label:'MA60 Rising',memberType:'stock',field:'ma60_rising',op:'eq',value:true,order:'ma60_slope_pct',ascending:false },
  ma60NotRising:{ label:'MA60 Not Rising',memberType:'stock',field:'ma60_rising',op:'eq',value:false,order:'ma60_slope_pct',ascending:true },
  newHigh20:{ label:'20D New High',memberType:'stock',field:'new_high_20',op:'eq',value:true,order:'return_5d',ascending:false },
  newLow20:{ label:'20D New Low',memberType:'stock',field:'new_low_20',op:'eq',value:true,order:'return_5d',ascending:true },
  ma60Breakout:{ label:'MA60 BO',memberType:'stock',field:'ma60_breakout',op:'eq',value:true,order:'distance_ma60_pct',ascending:false },
  ma60Breakdown:{ label:'MA60 BD',memberType:'stock',field:'ma60_breakdown',op:'eq',value:true,order:'distance_ma60_pct',ascending:true },
  sectorAboveMA60:{ label:'Sector Above MA60',memberType:'sector_index',field:'above_ma60',op:'eq',value:true,order:'distance_ma60_pct',ascending:false },
  sectorBelowMA60:{ label:'Sector Below MA60',memberType:'sector_index',field:'above_ma60',op:'eq',value:false,order:'distance_ma60_pct',ascending:true },
  sectorMA60Rising:{ label:'Sector MA60 Rising',memberType:'sector_index',field:'ma60_rising',op:'eq',value:true,order:'ma60_slope_pct',ascending:false },
  sectorMA60NotRising:{ label:'Sector MA60 Not Rising',memberType:'sector_index',field:'ma60_rising',op:'eq',value:false,order:'ma60_slope_pct',ascending:true },
  sectorNewHigh20:{ label:'Sector 20D High',memberType:'sector_index',field:'new_high_20',op:'eq',value:true,order:'return_5d',ascending:false },
  sectorNewLow20:{ label:'Sector 20D Low',memberType:'sector_index',field:'new_low_20',op:'eq',value:true,order:'return_5d',ascending:true },
  broad:{ label:'Broad Indices',memberType:'broad_index',field:null,op:null,value:null,order:'code',ascending:true },
});

const safely=request=>Promise.resolve(request).catch(error=>({ data:null,error }));

export async function loadMarketPulse(client) {
  const base=()=>client.from('market_pulse_snapshot').select(SNAPSHOT_COLUMNS).eq('provider','baostock');
  const [latestResponse,historyResponse,checkpointResponse]=await Promise.all([
    safely(base().limit(1).order('trade_date',{ ascending:false })),
    safely(base().limit(HISTORY_LIMIT).order('trade_date',{ ascending:false })),
    safely(client.from('market_sync_checkpoint').select('*').eq('provider','baostock').eq('scope','CN_PULSE').maybeSingle()),
  ]);
  const latest=Array.isArray(latestResponse?.data)?latestResponse.data[0]||null:latestResponse?.data||null;
  return {
    snapshot:latest,
    snapshots:Array.isArray(historyResponse?.data)?historyResponse.data:[],
    checkpoint:checkpointResponse?.data||null,
    error:latestResponse?.error||null,
    historyError:historyResponse?.error||null,
    checkpointError:checkpointResponse?.error||null,
  };
}

function cleanedSearch(value) {
  return String(value||'').replace(/[,%()]/g,' ').replace(/\s+/g,' ').trim().slice(0,60);
}

export async function loadMarketPulseMembers(client,{ tradeDate,calculationId,signal,page=0,pageSize=50,search='' }) {
  const filter=PULSE_MEMBER_FILTERS[signal];
  if (!filter) throw new TypeError('Unsupported Market Pulse member filter: '+signal);
  const safeSize=Math.min(50,Math.max(1,Number(pageSize)||50));
  const safePage=Math.max(0,Number(page)||0);
  let request=client.from('market_pulse_member_snapshot')
    .select(MEMBER_COLUMNS,{ count:'exact' })
    .eq('provider','baostock')
    .eq('trade_date',String(tradeDate||'').slice(0,10))
    .eq('calculation_id',String(calculationId||''))
    .eq('member_type',filter.memberType);
  if (filter.field && typeof request[filter.op]==='function') request=request[filter.op](filter.field,filter.value);
  const term=cleanedSearch(search);
  if (term) request=request.or(`name.ilike.%${term}%,code.ilike.%${term}%`);
  request=request.order(filter.order,{ ascending:filter.ascending }).order('market',{ ascending:true }).order('code',{ ascending:true });
  const from=safePage*safeSize;
  const response=await request.range(from,from+safeSize-1);
  return {
    rows:Array.isArray(response?.data)?response.data:[],
    count:Number(response?.count)||0,
    error:response?.error||null,
    page:safePage,
    pageSize:safeSize,
    filter,
  };
}

