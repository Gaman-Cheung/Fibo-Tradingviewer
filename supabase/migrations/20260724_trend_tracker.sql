-- Additive Trend Tracker schema. Existing fibo_data rows and columns are untouched.
create table if not exists public.market_instrument_bindings (
  user_id uuid not null references auth.users(id) on delete cascade,
  instrument_id text not null,
  market text not null check (market in ('SH','SZ','BJ','HK','US','OTHER')),
  code text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, instrument_id)
);

create index if not exists market_instrument_bindings_symbol_idx
  on public.market_instrument_bindings (market, code) where active;

create table if not exists public.market_daily_close (
  provider text not null default 'baostock',
  market text not null,
  code text not null,
  trade_date date not null,
  close numeric not null check (close > 0),
  adjust_mode text not null default 'front',
  synced_at timestamptz not null default now(),
  primary key (provider, market, code, trade_date)
);

create table if not exists public.market_sync_state (
  provider text not null default 'baostock',
  market text not null,
  code text not null,
  last_trade_date date,
  factor_signature text,
  last_status text not null default 'pending',
  last_error text,
  synced_at timestamptz,
  primary key (provider, market, code)
);

create table if not exists public.trend_tracker_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.market_instrument_bindings enable row level security;
alter table public.market_daily_close enable row level security;
alter table public.market_sync_state enable row level security;
alter table public.trend_tracker_state enable row level security;

drop policy if exists "bindings_select_own" on public.market_instrument_bindings;
create policy "bindings_select_own" on public.market_instrument_bindings for select using (auth.uid() = user_id);
drop policy if exists "bindings_insert_own" on public.market_instrument_bindings;
create policy "bindings_insert_own" on public.market_instrument_bindings for insert with check (auth.uid() = user_id);
drop policy if exists "bindings_update_own" on public.market_instrument_bindings;
create policy "bindings_update_own" on public.market_instrument_bindings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "bindings_delete_own" on public.market_instrument_bindings;
create policy "bindings_delete_own" on public.market_instrument_bindings for delete using (auth.uid() = user_id);

drop policy if exists "daily_close_read_authenticated" on public.market_daily_close;
create policy "daily_close_read_authenticated" on public.market_daily_close for select to authenticated using (true);
drop policy if exists "sync_state_read_authenticated" on public.market_sync_state;
create policy "sync_state_read_authenticated" on public.market_sync_state for select to authenticated using (true);

drop policy if exists "tracker_state_select_own" on public.trend_tracker_state;
create policy "tracker_state_select_own" on public.trend_tracker_state for select using (auth.uid() = user_id);
drop policy if exists "tracker_state_insert_own" on public.trend_tracker_state;
create policy "tracker_state_insert_own" on public.trend_tracker_state for insert with check (auth.uid() = user_id);
drop policy if exists "tracker_state_update_own" on public.trend_tracker_state;
create policy "tracker_state_update_own" on public.trend_tracker_state for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
