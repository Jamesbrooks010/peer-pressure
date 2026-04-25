create extension if not exists pgcrypto;

create table if not exists public.markets (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  deadline timestamptz not null,
  cutoff timestamptz not null,
  umpire text not null,
  min_stake numeric not null default 5 check (min_stake > 0),
  platform_fee numeric not null default 2 check (platform_fee >= 0),
  odds_rake numeric not null default 3 check (odds_rake >= 0),
  terms text not null default '',
  status text not null default 'OPEN' check (status in ('OPEN', 'SETTLED')),
  outcome text not null default '' check (outcome in ('', 'YES', 'NO', 'VOID')),
  created_at timestamptz not null default now()
);

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  person text not null,
  side text not null check (side in ('YES', 'NO')),
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);

alter table public.markets enable row level security;
alter table public.entries enable row level security;

drop policy if exists "Prototype markets are public read" on public.markets;
drop policy if exists "Prototype markets can be created" on public.markets;
drop policy if exists "Prototype markets can be resolved" on public.markets;
drop policy if exists "Prototype entries are public read" on public.entries;
drop policy if exists "Prototype entries can be created" on public.entries;

create policy "Prototype markets are public read"
  on public.markets for select
  using (true);

create policy "Prototype markets can be created"
  on public.markets for insert
  with check (true);

create policy "Prototype markets can be resolved"
  on public.markets for update
  using (true)
  with check (true);

create policy "Prototype entries are public read"
  on public.entries for select
  using (true);

create policy "Prototype entries can be created"
  on public.entries for insert
  with check (true);

alter publication supabase_realtime add table public.markets;
alter publication supabase_realtime add table public.entries;
