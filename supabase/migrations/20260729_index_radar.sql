-- Additive BaoStock index catalog and precomputed Look First Index Radar.
-- Existing fibo_data, Pool identity and market_daily_bar contracts are untouched.

create table if not exists public.market_index_catalog (
  provider text not null default 'baostock',
  market text not null check (market in ('SH','SZ')),
  code text not null check (code ~ '^[0-9]{6}$'),
  name text not null,
  category text not null check (category in ('broad','sector','theme','style','strategy','fund','bond','other')),
  theme_group text not null default '',
  theme_label text not null default '',
  radar_enabled boolean not null default false,
  active boolean not null default true,
  universe_version integer not null default 1 check (universe_version > 0),
  history_from date,
  latest_trade_date date,
  last_status text not null default 'pending' check (last_status in ('pending','running','ok','error','insufficient')),
  last_error text,
  synced_at timestamptz,
  primary key (provider, market, code)
);

create index if not exists market_index_catalog_radar_idx
  on public.market_index_catalog (provider, radar_enabled, active);

create table if not exists public.market_index_radar_snapshot (
  provider text not null default 'baostock',
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
  primary key (provider, trade_date)
);

create index if not exists market_index_radar_latest_idx
  on public.market_index_radar_snapshot (provider, trade_date desc);

alter table public.market_index_catalog enable row level security;
alter table public.market_index_radar_snapshot enable row level security;

drop policy if exists "market_index_catalog_read_authenticated" on public.market_index_catalog;
create policy "market_index_catalog_read_authenticated"
  on public.market_index_catalog for select to authenticated using (true);

drop policy if exists "market_index_radar_read_authenticated" on public.market_index_radar_snapshot;
create policy "market_index_radar_read_authenticated"
  on public.market_index_radar_snapshot for select to authenticated using (true);

comment on table public.market_index_catalog is
  'Versioned BaoStock SH.000/SZ.399 index universe, Radar classification and per-symbol sync checkpoint.';
comment on table public.market_index_radar_snapshot is
  'Precomputed official-close sector/theme leaders consumed by Look First; never a Terminal score.';
comment on table public.market_daily_bar is
  'Rolling BaoStock SH/SZ official closes: A shares reconstruct QFQ series; indices remain official raw closes.';
