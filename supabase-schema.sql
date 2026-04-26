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

alter table public.markets
  add column if not exists archived_at timestamptz;

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

alter table public.entries
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.entries
  alter column user_id set default auth.uid();

alter table public.entries
  add column if not exists locked_profit numeric not null default 0 check (locked_profit >= 0);

alter table public.entries
  add column if not exists locked_payout numeric not null default 0 check (locked_payout >= 0);

create or replace function public.is_market_participant(check_market_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.market_participants participant
    where participant.market_id = check_market_id
      and participant.user_id = auth.uid()
  );
$$;

create or replace function public.is_market_owner(check_market_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.markets market
    where market.id = check_market_id
      and market.owner_id = auth.uid()
  );
$$;

create or replace function public.prepare_entry_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_side text;
  same_pool numeric := 0;
  opposite_pool numeric := 0;
  fee_rate numeric := 0;
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;

  if new.user_id is not null then
    select entry.side into existing_side
    from public.entries entry
    where entry.market_id = new.market_id
      and entry.user_id = new.user_id
    limit 1;

    if existing_side is not null and existing_side <> new.side then
      raise exception 'You are already on %. You can add more there, but you cannot switch sides.', existing_side;
    end if;
  end if;

  select coalesce((market.platform_fee + market.odds_rake) / 100, 0)
  into fee_rate
  from public.markets market
  where market.id = new.market_id;

  select
    coalesce(sum(case when entry.side = new.side then entry.amount else 0 end), 0),
    coalesce(sum(case when entry.side <> new.side then entry.amount else 0 end), 0)
  into same_pool, opposite_pool
  from public.entries entry
  where entry.market_id = new.market_id;

  new.locked_profit := case
    when opposite_pool > 0 then (new.amount / (same_pool + new.amount)) * opposite_pool * (1 - fee_rate)
    else 0
  end;

  new.locked_payout := new.amount + new.locked_profit;

  return new;
end;
$$;

drop trigger if exists prevent_entry_side_switch_trigger on public.entries;
drop trigger if exists prepare_entry_before_insert_trigger on public.entries;

create trigger prepare_entry_before_insert_trigger
before insert on public.entries
for each row
execute function public.prepare_entry_before_insert();

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
    archived_at is null
    and (
      visibility = 'PUBLIC'
      or owner_id = auth.uid()
      or public.is_market_participant(id)
    )
  );

create policy "Signed in users can create markets"
  on public.markets for insert
  with check (
    auth.uid() is not null
    and owner_id = auth.uid()
  );

create policy "Market owners can update markets"
  on public.markets for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "Market participants can be read by members"
  on public.market_participants for select
  using (
    user_id = auth.uid()
    or public.is_market_owner(market_id)
  );

create policy "Entries can be read with visible markets"
  on public.entries for select
  using (
    exists (
      select 1
      from public.markets market
      where market.id = entries.market_id
        and market.archived_at is null
        and (
          market.visibility = 'PUBLIC'
          or market.owner_id = auth.uid()
          or public.is_market_participant(market.id)
        )
    )
  );

create policy "Signed in users can create visible entries"
  on public.entries for insert
  with check (
    auth.uid() is not null
    and user_id = auth.uid()
    and exists (
      select 1
      from public.markets market
      where market.id = entries.market_id
        and market.status = 'OPEN'
        and market.archived_at is null
        and (
          market.visibility = 'PUBLIC'
          or market.owner_id = auth.uid()
          or public.is_market_participant(market.id)
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
    and archived_at is null
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

create or replace function public.archive_market(target_market_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.markets
  set archived_at = now()
  where id = target_market_id
    and owner_id = auth.uid()
    and status = 'SETTLED'
    and archived_at is null;

  if not found then
    raise exception 'Only the owner can archive a settled bet.';
  end if;
end;
$$;

grant execute on function public.join_market_by_invite(text) to authenticated;
grant execute on function public.archive_market(uuid) to authenticated;

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

notify pgrst, 'reload schema';
