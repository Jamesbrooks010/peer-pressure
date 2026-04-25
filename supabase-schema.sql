create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can read profiles" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;

create policy "Users can read profiles"
  on public.profiles for select
  using (true);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create table if not exists public.markets (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  deadline timestamptz not null,
  cutoff timestamptz not null,
  umpire text not null,
  min_stake numeric not null default 5 check (min_stake > 0),
  platform_fee numeric not null default 2 check (platform_fee >= 0),
  odds_rake numeric not null default 3 check (odds_rake >= 0),
  visibility text not null default 'PUBLIC' check (visibility in ('PUBLIC', 'INVITE_ONLY')),
  invite_code text not null default '',
  terms text not null default '',
  status text not null default 'OPEN' check (status in ('OPEN', 'SETTLED')),
  outcome text not null default '' check (outcome in ('', 'YES', 'NO', 'VOID')),
  created_at timestamptz not null default now()
);

alter table public.markets
  add column if not exists visibility text not null default 'PUBLIC';

alter table public.markets
  add column if not exists invite_code text not null default '';

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

do $$
begin
  alter publication supabase_realtime add table public.markets;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.entries;
exception
  when duplicate_object then null;
end $$;
