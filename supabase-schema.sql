create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists email text;

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

alter table public.markets
  add column if not exists owner_id uuid references auth.users(id) on delete set null;

alter table public.markets
  alter column owner_id set default auth.uid();

create table if not exists public.market_participants (
  market_id uuid not null references public.markets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'MEMBER' check (role in ('OWNER', 'MEMBER')),
  created_at timestamptz not null default now(),
  primary key (market_id, user_id)
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
alter table public.market_participants enable row level security;
alter table public.entries enable row level security;

drop policy if exists "Prototype markets are public read" on public.markets;
drop policy if exists "Prototype markets can be created" on public.markets;
drop policy if exists "Prototype markets can be resolved" on public.markets;
drop policy if exists "Markets can be read by allowed users" on public.markets;
drop policy if exists "Signed in users can create markets" on public.markets;
drop policy if exists "Market owners can update markets" on public.markets;

drop policy if exists "Market participants can be read by members" on public.market_participants;
drop policy if exists "Market participants can be added by owners" on public.market_participants;
drop policy if exists "Users can join market participants through functions" on public.market_participants;

drop policy if exists "Prototype entries are public read" on public.entries;
drop policy if exists "Prototype entries can be created" on public.entries;
drop policy if exists "Entries can be read with visible markets" on public.entries;
drop policy if exists "Signed in users can create visible entries" on public.entries;

create policy "Markets can be read by allowed users"
  on public.markets for select
  using (
    visibility = 'PUBLIC'
    or owner_id = auth.uid()
    or exists (
      select 1
      from public.market_participants participant
      where participant.market_id = markets.id
        and participant.user_id = auth.uid()
    )
  );

create policy "Signed in users can create markets"
  on public.markets for insert
  with check (
    auth.uid() is not null
    and coalesce(owner_id, auth.uid()) = auth.uid()
  );

create policy "Market owners can update markets"
  on public.markets for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "Market participants can be read by members"
  on public.market_participants for select
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.markets market
      where market.id = market_participants.market_id
        and market.owner_id = auth.uid()
    )
  );

create policy "Users can join market participants through functions"
  on public.market_participants for insert
  with check (user_id = auth.uid());

create policy "Entries can be read with visible markets"
  on public.entries for select
  using (
    exists (
      select 1
      from public.markets market
      where market.id = entries.market_id
        and (
          market.visibility = 'PUBLIC'
          or market.owner_id = auth.uid()
          or exists (
            select 1
            from public.market_participants participant
            where participant.market_id = market.id
              and participant.user_id = auth.uid()
          )
        )
    )
  );

create policy "Signed in users can create visible entries"
  on public.entries for insert
  with check (
    auth.uid() is not null
    and exists (
      select 1
      from public.markets market
      where market.id = entries.market_id
        and market.status = 'OPEN'
        and (
          market.visibility = 'PUBLIC'
          or market.owner_id = auth.uid()
          or exists (
            select 1
            from public.market_participants participant
            where participant.market_id = market.id
              and participant.user_id = auth.uid()
          )
        )
    )
  );

create or replace function public.add_market_owner_participant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is not null then
    insert into public.market_participants (market_id, user_id, role)
    values (new.id, new.owner_id, 'OWNER')
    on conflict (market_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists add_market_owner_participant_trigger on public.markets;

create trigger add_market_owner_participant_trigger
after insert on public.markets
for each row
execute function public.add_market_owner_participant();

create or replace function public.join_market_by_invite(invite text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_market_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Please sign in before opening an invite.';
  end if;

  select id into target_market_id
  from public.markets
  where visibility = 'INVITE_ONLY'
    and invite_code = upper(trim(invite))
  limit 1;

  if target_market_id is null then
    raise exception 'Invite code not found.';
  end if;

  insert into public.market_participants (market_id, user_id, role)
  values (target_market_id, auth.uid(), 'MEMBER')
  on conflict (market_id, user_id) do nothing;

  return target_market_id;
end;
$$;

grant execute on function public.join_market_by_invite(text) to authenticated;

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

do $$
begin
  alter publication supabase_realtime add table public.market_participants;
exception
  when duplicate_object then null;
end $$;
