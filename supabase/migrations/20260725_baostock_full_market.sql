-- Additive full-market BaoStock storage. Legacy per-instrument tables remain intact.
create table if not exists public.market_daily_bar (
  provider text not null default 'baostock',
  market text not null check (market in ('SH','SZ')),
  code text not null check (code ~ '^[0-9]{6}$'),
  trade_date date not null,
  close numeric not null check (close > 0),
  pct_chg numeric,
  trade_status boolean not null default true,
  synced_at timestamptz not null default now(),
  primary key (provider, market, code, trade_date)
);

create index if not exists market_daily_bar_trade_date_idx
  on public.market_daily_bar (provider, trade_date);

create table if not exists public.market_sync_checkpoint (
  provider text not null default 'baostock',
  scope text not null default 'CN_A',
  backfill_cursor date,
  oldest_trade_date date,
  latest_trade_date date,
  retention_sessions integer not null default 400 check (retention_sessions between 240 and 400),
  last_status text not null default 'pending' check (last_status in ('pending','running','ok','error')),
  last_error text,
  last_mode text check (last_mode in ('smoke','daily','backfill','repair')),
  last_row_count integer,
  synced_at timestamptz,
  primary key (provider, scope)
);

alter table public.market_daily_bar enable row level security;
alter table public.market_sync_checkpoint enable row level security;

drop policy if exists "market_daily_bar_read_authenticated" on public.market_daily_bar;
create policy "market_daily_bar_read_authenticated"
  on public.market_daily_bar for select to authenticated using (true);

drop policy if exists "market_sync_checkpoint_read_authenticated" on public.market_sync_checkpoint;
create policy "market_sync_checkpoint_read_authenticated"
  on public.market_sync_checkpoint for select to authenticated using (true);

comment on table public.market_daily_bar is
  'Rolling official BaoStock SH/SZ raw closes and pctChg used to reconstruct QFQ series.';
comment on table public.market_sync_checkpoint is
  'Idempotent global full-market synchronization and backfill checkpoint.';
