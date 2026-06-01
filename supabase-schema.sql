create extension if not exists pgcrypto;

create table if not exists public.users (
  username text primary key,
  password text not null,
  name text,
  role text not null default 'user',
  balance numeric not null default 0,
  exposure numeric not null default 0,
  last_login_at timestamptz,
  last_seen_at timestamptz,
  is_online boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.bets (
  id uuid primary key default gen_random_uuid(),
  username text not null references public.users(username),
  event_id text,
  event_name text,
  market_key text,
  market_name text,
  market_type text,
  side text,
  odds numeric,
  run numeric,
  target numeric,
  rate numeric,
  stake numeric not null,
  liability numeric not null,
  estimated_profit numeric not null default 0,
  status text not null default 'PENDING',
  result text,
  result_run numeric,
  pnl numeric not null default 0,
  placed_at timestamptz not null default now(),
  settled_at timestamptz,
  status_at_selection text,
  odds_source text,
  verified_at timestamptz
);

create table if not exists public.manual_odds_overrides (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  market_key text not null,
  market_name text,
  market_type text,
  back_price numeric,
  lay_price numeric,
  back_size numeric,
  lay_size numeric,
  status text,
  enabled boolean not null default true,
  updated_by text,
  updated_at timestamptz not null default now(),
  unique(event_id, market_key)
);

create table if not exists public.app_messages (
  id text primary key default 'global',
  message text,
  enabled boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.fund_ledger (
  id uuid primary key default gen_random_uuid(),
  username text not null references public.users(username),
  mode text not null,
  amount numeric not null,
  balance_before numeric not null,
  balance_after numeric not null,
  created_by text,
  created_at timestamptz not null default now()
);

alter table public.users replica identity full;
alter table public.bets replica identity full;
alter table public.manual_odds_overrides replica identity full;
alter table public.app_messages replica identity full;
alter table public.fund_ledger replica identity full;

alter table public.bets
add column if not exists result_run numeric,
add column if not exists odds_source text;

alter table public.users
add column if not exists exposure numeric not null default 0,
add column if not exists last_login_at timestamptz,
add column if not exists last_seen_at timestamptz,
add column if not exists is_online boolean not null default false;

do $$
begin
  alter publication supabase_realtime add table public.users;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.bets;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.manual_odds_overrides;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.app_messages;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.fund_ledger;
exception
  when duplicate_object then null;
end $$;

alter table public.users enable row level security;
alter table public.bets enable row level security;
alter table public.manual_odds_overrides enable row level security;
alter table public.app_messages enable row level security;
alter table public.fund_ledger enable row level security;

drop policy if exists "allow anon realtime bets" on public.bets;
drop policy if exists "allow anon realtime users" on public.users;
drop policy if exists "allow anon realtime manual odds" on public.manual_odds_overrides;
drop policy if exists "allow anon realtime app messages" on public.app_messages;
drop policy if exists "allow anon realtime fund ledger" on public.fund_ledger;

create policy "allow anon realtime users"
on public.users
for select
to anon
using (true);

create policy "allow anon realtime bets"
on public.bets
for select
to anon
using (true);

create policy "allow anon realtime manual odds"
on public.manual_odds_overrides
for select
to anon
using (true);

create policy "allow anon realtime app messages"
on public.app_messages
for select
to anon
using (true);

create policy "allow anon realtime fund ledger"
on public.fund_ledger
for select
to anon
using (true);
