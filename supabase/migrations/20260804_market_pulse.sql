-- Additive official-close FIBO Market Pulse snapshots and two-session members.
-- Existing full-market bars, Radar snapshots, Pool identity and user data are untouched.

alter table public.market_sync_checkpoint
  drop constraint if exists market_sync_checkpoint_retention_sessions_check;

alter table public.market_sync_checkpoint
  add constraint market_sync_checkpoint_retention_sessions_check
  check (retention_sessions between 60 and 400);

create table if not exists public.market_pulse_snapshot (
  provider text not null default 'baostock',
  trade_date date not null,
  algorithm_version integer not null check (algorithm_version > 0),
  index_universe_version integer not null check (index_universe_version > 0),
  calculation_id text not null,
  pulse_score numeric not null check (pulse_score between 0 and 100),
  pulse_state text not null check (pulse_state in (
    'Broad Strength','Healthy Strength','Mixed','Weakening','Risk-Off'
  )),
  stock_eligible_count integer not null check (stock_eligible_count >= 0),
  index_eligible_count integer not null check (index_eligible_count >= 0),
  stock_coverage numeric not null check (stock_coverage between 0 and 1),
  index_coverage numeric not null check (index_coverage between 0 and 1),
  participation jsonb not null check (jsonb_typeof(participation) = 'object'),
  trend_breadth jsonb not null check (jsonb_typeof(trend_breadth) = 'object'),
  expansion jsonb not null check (jsonb_typeof(expansion) = 'object'),
  leadership jsonb not null check (jsonb_typeof(leadership) = 'object'),
  computed_at timestamptz not null default now(),
  primary key (provider, trade_date)
);

create index if not exists market_pulse_snapshot_latest_idx
  on public.market_pulse_snapshot (provider, trade_date desc);

create table if not exists public.market_pulse_member_snapshot (
  provider text not null default 'baostock',
  trade_date date not null,
  calculation_id text not null,
  member_type text not null check (member_type in ('stock','sector_index','broad_index')),
  market text not null check (market in ('SH','SZ')),
  code text not null check (code ~ '^[0-9]{6}$'),
  name text not null,
  theme_group text not null default '',
  close numeric not null check (close > 0),
  return_1d numeric not null,
  return_5d numeric not null,
  direction_1d smallint not null check (direction_1d between -1 and 1),
  direction_5d smallint not null check (direction_5d between -1 and 1),
  strong_up boolean not null,
  strong_down boolean not null,
  above_ma20 boolean not null,
  above_ma60 boolean not null,
  ma20_rising boolean not null,
  ma60_rising boolean not null,
  new_high_20 boolean not null,
  new_low_20 boolean not null,
  ma60_breakout boolean not null,
  ma60_breakdown boolean not null,
  distance_ma20_pct numeric not null,
  distance_ma60_pct numeric not null,
  ma20_slope_pct numeric not null,
  ma60_slope_pct numeric not null,
  computed_at timestamptz not null default now(),
  primary key (provider, trade_date, calculation_id, member_type, market, code)
);

create index if not exists market_pulse_member_page_idx
  on public.market_pulse_member_snapshot
  (provider, trade_date desc, calculation_id, member_type, market, code);

alter table public.market_pulse_snapshot enable row level security;
alter table public.market_pulse_member_snapshot enable row level security;

drop policy if exists "market_pulse_snapshot_read_authenticated" on public.market_pulse_snapshot;
create policy "market_pulse_snapshot_read_authenticated"
  on public.market_pulse_snapshot for select to authenticated using (true);

drop policy if exists "market_pulse_member_read_authenticated" on public.market_pulse_member_snapshot;
create policy "market_pulse_member_read_authenticated"
  on public.market_pulse_member_snapshot for select to authenticated using (true);

comment on table public.market_pulse_snapshot is
  'Precomputed official-close FIBO Market Pulse v1 aggregates; independent from Radar and Terminal scoring.';
comment on table public.market_pulse_member_snapshot is
  'Latest two official-session stock/index members used only for paginated Market Pulse explanations.';
