-- Additive Market Insights v1. No old algorithm, table or retention is changed.
begin;
create table if not exists public.market_insights_snapshot (
  provider text not null default 'baostock' check (provider = 'baostock'),
  trade_date date not null,
  algorithm_version text not null check (algorithm_version = 'insights-v1'),
  universe_version integer not null check (universe_version = 2),
  presentation_version integer not null check (presentation_version = 1),
  calculation_id text not null,
  scans jsonb not null check (jsonb_typeof(scans) = 'object' and scans ?& array['SECTOR_INDEX','EQUITY_ETF','CROSS_ASSET']),
  regime jsonb check (regime is null or jsonb_typeof(regime) = 'object'),
  theme_scores jsonb not null check (jsonb_typeof(theme_scores) = 'object'),
  coverage jsonb not null check (jsonb_typeof(coverage) = 'object'),
  source_checkpoints jsonb not null check (jsonb_typeof(source_checkpoints) = 'object'),
  pulse_calculation_id text not null,
  computed_at timestamptz not null default now(),
  primary key (provider, trade_date)
);
alter table public.market_insights_snapshot enable row level security;
revoke all on public.market_insights_snapshot from public, anon, authenticated;
grant select on public.market_insights_snapshot to authenticated;
grant select, insert, update, delete on public.market_insights_snapshot to service_role;
drop policy if exists market_insights_read_authenticated on public.market_insights_snapshot;
create policy market_insights_read_authenticated on public.market_insights_snapshot
  for select to authenticated using (true);

-- One atomic publication of every scope + regime, followed by this table's own
-- bounded retention. A failure rolls both back; source tables are only read.
create or replace function public.publish_market_insights(p_snapshot jsonb, p_headroom_mb numeric)
returns text language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  day date := (p_snapshot->>'trade_date')::date;
  scope_name text;
  checkpoint public.market_sync_checkpoint%rowtype;
begin
  if p_headroom_mb is null or not (p_headroom_mb >= 75 and p_headroom_mb < 1000000000) then
    raise exception 'Dashboard headroom must be verified and at least 75 MB';
  end if;
  if day is null or p_snapshot->>'provider' is distinct from 'baostock'
    or p_snapshot->>'algorithm_version' is distinct from 'insights-v1'
    or p_snapshot->>'universe_version' is distinct from '2'
    or p_snapshot->>'presentation_version' is distinct from '1'
    or coalesce(p_snapshot->>'calculation_id','') = '' then
    raise exception 'Invalid Insights snapshot identity/version';
  end if;
  perform pg_advisory_xact_lock(hashtext('market_insights_snapshot'));
  foreach scope_name in array array['CN_A','CN_INDEX','CN_PULSE','CN_ETF'] loop
    select * into checkpoint from public.market_sync_checkpoint
      where provider = 'baostock' and scope = scope_name for share;
    if not found or checkpoint.last_status is distinct from 'ok'
      or checkpoint.latest_trade_date is distinct from day
      or (p_snapshot->'source_checkpoints'->scope_name->>'latest_trade_date')::date is distinct from day
      or p_snapshot->'source_checkpoints'->scope_name->>'last_status' is distinct from 'ok'
      or (p_snapshot->'source_checkpoints'->scope_name->>'synced_at')::timestamptz is distinct from checkpoint.synced_at then
      raise exception 'Source checkpoint changed or incomplete: %', scope_name;
    end if;
  end loop;
  perform 1 from public.market_pulse_snapshot where provider='baostock'
    and trade_date=day and algorithm_version=1
    and calculation_id=p_snapshot->>'pulse_calculation_id' for share;
  if not found then raise exception 'Matching Pulse calculation unavailable'; end if;
  foreach scope_name in array array['SECTOR_INDEX','EQUITY_ETF','CROSS_ASSET'] loop
    if p_snapshot->'scans'->scope_name->>'scope' is distinct from scope_name
      or p_snapshot->'scans'->scope_name->>'tradeDate' is distinct from day::text
      or p_snapshot->'scans'->scope_name->>'algorithmVersion' is distinct from 'insights-v1'
      or coalesce(jsonb_array_length(p_snapshot->'scans'->scope_name->'levels'->'strong'),0) = 0 then
      raise exception 'Incomplete or mixed-date scope: %', scope_name;
    end if;
  end loop;
  if p_snapshot->'regime' <> 'null'::jsonb and
    (p_snapshot->'regime'->>'tradeDate' is distinct from day::text
     or p_snapshot->'regime'->>'algorithmVersion' is distinct from 'insights-v1') then
    raise exception 'Mixed-date or incompatible regime';
  end if;
  insert into public.market_insights_snapshot
    (provider,trade_date,algorithm_version,universe_version,presentation_version,calculation_id,
     scans,regime,theme_scores,coverage,source_checkpoints,pulse_calculation_id,computed_at)
  values ('baostock',day,'insights-v1',2,1,p_snapshot->>'calculation_id',
    p_snapshot->'scans',nullif(p_snapshot->'regime','null'::jsonb),p_snapshot->'theme_scores',
    p_snapshot->'coverage',p_snapshot->'source_checkpoints',p_snapshot->>'pulse_calculation_id',now())
  on conflict (provider,trade_date) do update set
    algorithm_version=excluded.algorithm_version,universe_version=excluded.universe_version,
    presentation_version=excluded.presentation_version,calculation_id=excluded.calculation_id,
    scans=excluded.scans,regime=excluded.regime,theme_scores=excluded.theme_scores,
    coverage=excluded.coverage,source_checkpoints=excluded.source_checkpoints,
    pulse_calculation_id=excluded.pulse_calculation_id,computed_at=excluded.computed_at;
  delete from public.market_insights_snapshot where provider='baostock' and trade_date not in
    (select trade_date from public.market_insights_snapshot where provider='baostock' order by trade_date desc limit 60);
  return p_snapshot->>'calculation_id';
end;
$$;
revoke all on function public.publish_market_insights(jsonb,numeric) from public, anon, authenticated;
grant execute on function public.publish_market_insights(jsonb,numeric) to service_role;
comment on table public.market_insights_snapshot is 'Independent Insights v1, max 60 published sessions. Not old Top5/Memory.';
commit;
