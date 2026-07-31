-- Additive ETF market data and precomputed Radar scopes.
-- Sector Index remains on its existing 400-session tables and algorithm.

alter table public.market_daily_bar
  add column if not exists amount numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.market_daily_bar'::regclass
      and conname = 'market_daily_bar_amount_nonnegative'
  ) then
    alter table public.market_daily_bar
      add constraint market_daily_bar_amount_nonnegative
      check (amount is null or amount >= 0);
  end if;
end $$;

-- ETF uses 144 sessions. Dropping and recreating only the validation
-- constraint leaves all existing CN_A / CN_INDEX checkpoint values intact.
alter table public.market_sync_checkpoint
  drop constraint if exists market_sync_checkpoint_retention_sessions_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.market_sync_checkpoint'::regclass
      and conname = 'market_sync_checkpoint_retention_sessions_check'
  ) then
    alter table public.market_sync_checkpoint
      add constraint market_sync_checkpoint_retention_sessions_check
      check (retention_sessions between 120 and 400);
  end if;
end $$;

create table if not exists public.market_etf_catalog (
  provider text not null default 'baostock',
  market text not null check (market in ('SH','SZ')),
  code text not null check (code ~ '^[0-9]{6}$'),
  name text not null,
  category text not null check (category in (
    'equity_broad','equity_sector','equity_theme','equity_strategy',
    'overseas','commodity','bond','money','other'
  )),
  radar_scope text check (radar_scope in ('EQUITY_ETF','CROSS_ASSET')),
  theme_group text not null default '',
  theme_label text not null default '',
  radar_enabled boolean not null default false,
  active boolean not null default true,
  universe_version integer not null default 1 check (universe_version > 0),
  history_from date,
  latest_trade_date date,
  last_status text not null default 'pending'
    check (last_status in ('pending','running','ok','error','insufficient')),
  last_error text,
  synced_at timestamptz,
  primary key (provider, market, code),
  check (radar_enabled = false or radar_scope is not null),
  check (radar_enabled = false or theme_group <> '')
);

create index if not exists market_etf_catalog_radar_idx
  on public.market_etf_catalog (provider, radar_scope, radar_enabled, active);

create table if not exists public.market_etf_radar_snapshot (
  provider text not null default 'baostock',
  scope text not null check (scope in ('EQUITY_ETF','CROSS_ASSET')),
  trade_date date not null,
  algorithm_version integer not null check (algorithm_version > 0),
  universe_version integer not null check (universe_version > 0),
  benchmark_market text not null check (benchmark_market in ('SH','SZ')),
  benchmark_code text not null check (benchmark_code ~ '^[0-9]{6}$'),
  universe_count integer not null check (universe_count >= 0),
  eligible_count integer not null check (eligible_count >= 0),
  coverage numeric not null check (coverage >= 0 and coverage <= 1),
  leaders jsonb not null default '[]'::jsonb check (jsonb_typeof(leaders) = 'array'),
  computed_at timestamptz not null default now(),
  primary key (provider, scope, trade_date)
);

create index if not exists market_etf_radar_latest_idx
  on public.market_etf_radar_snapshot (provider, scope, trade_date desc);

alter table public.market_etf_catalog enable row level security;
alter table public.market_etf_radar_snapshot enable row level security;

drop policy if exists "market_etf_catalog_read_authenticated" on public.market_etf_catalog;
create policy "market_etf_catalog_read_authenticated"
  on public.market_etf_catalog for select to authenticated using (true);

drop policy if exists "market_etf_radar_read_authenticated" on public.market_etf_radar_snapshot;
create policy "market_etf_radar_read_authenticated"
  on public.market_etf_radar_snapshot for select to authenticated using (true);

comment on column public.market_daily_bar.amount is
  'Official unadjusted transaction amount. Populated for ETF rows only; never interpreted as fund flow.';
comment on table public.market_etf_catalog is
  'Reviewed BaoStock ETF universe, Radar scope and per-symbol synchronization progress.';
comment on table public.market_etf_radar_snapshot is
  'Precomputed ETF Equity and Cross Asset official-close leaders; independent from Index Radar and Terminal scores.';
