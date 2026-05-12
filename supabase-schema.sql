create extension if not exists pgcrypto;

create table if not exists public.users (
  username text primary key,
  password text not null,
  name text,
  role text not null default 'user',
  balance numeric not null default 0,
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
  pnl numeric not null default 0,
  placed_at timestamptz not null default now(),
  settled_at timestamptz,
  status_at_selection text,
  verified_at timestamptz
);

alter table public.users replica identity full;
alter table public.bets replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.bets;
exception
  when duplicate_object then null;
end $$;

alter table public.users enable row level security;
alter table public.bets enable row level security;

drop policy if exists "allow anon realtime bets" on public.bets;

create policy "allow anon realtime bets"
on public.bets
for select
to anon
using (true);
