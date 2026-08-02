-- Roadmap-Schnitt 2: gemeinsame Reise, administrierte Mitgliedschaft und
-- optimistische Versionierung. Die Reise wird außerhalb der PWA geseedet.

create schema if not exists private;

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null,
  account_status text not null default 'active'
    check (account_status in ('active', 'disabled')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  version bigint not null default 1 check (version > 0),
  constraint users_display_name_not_blank check (length(btrim(display_name)) between 1 and 120)
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  start_date date not null,
  end_date date not null,
  lifecycle_status text not null default 'active'
    check (lifecycle_status in ('active', 'closed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by_user_id uuid not null references public.users (id) on delete restrict,
  updated_by_user_id uuid not null references public.users (id) on delete restrict,
  version bigint not null default 1 check (version > 0),
  constraint trips_title_not_blank check (length(btrim(title)) between 1 and 200),
  constraint trips_date_order check (end_date >= start_date)
);

create table if not exists public.trip_members (
  trip_id uuid not null references public.trips (id) on delete restrict,
  user_id uuid not null references public.users (id) on delete restrict,
  membership_status text not null default 'active'
    check (membership_status in ('active', 'disabled')),
  joined_at timestamptz not null default timezone('utc', now()),
  created_by_user_id uuid references public.users (id) on delete restrict,
  primary key (trip_id, user_id)
);

create unique index if not exists trips_one_active_idx
  on public.trips (lifecycle_status)
  where lifecycle_status = 'active';

create index if not exists trip_members_user_trip_idx
  on public.trip_members (user_id, trip_id);

create index if not exists trips_status_idx
  on public.trips (lifecycle_status);

create or replace function private.is_active_trip_member(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.trip_members as membership
      join public.users as app_user on app_user.id = membership.user_id
      join public.trips as trip on trip.id = membership.trip_id
      where membership.trip_id = p_trip_id
        and membership.user_id = (select auth.uid())
        and membership.membership_status = 'active'
        and app_user.account_status = 'active'
        and trip.lifecycle_status = 'active'
    );
$$;

create or replace function private.guard_trip_member_count()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  active_member_count bigint;
begin
  if new.membership_status <> 'active' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select count(*) into active_member_count
    from public.trip_members as membership
    where membership.trip_id = new.trip_id
      and membership.membership_status = 'active';
  else
    select count(*) into active_member_count
    from public.trip_members as membership
    where membership.trip_id = new.trip_id
      and membership.membership_status = 'active'
      and membership.user_id <> old.user_id;
  end if;

  if active_member_count >= 2 then
    raise exception using
      errcode = '23514',
      message = 'Eine Reise darf höchstens zwei aktive Mitglieder besitzen';
  end if;
  return new;
end;
$$;

create trigger trip_member_count_guard
before insert or update of trip_id, user_id, membership_status on public.trip_members
for each row execute function private.guard_trip_member_count();

create or replace function private.guard_trip_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.id <> old.id
    or new.lifecycle_status <> old.lifecycle_status
    or new.created_at <> old.created_at
    or new.created_by_user_id <> old.created_by_user_id then
    raise exception using
      errcode = '42501',
      message = 'Nur Reisetitel und Reisezeitraum dürfen geändert werden';
  end if;

  new.version := old.version + 1;
  new.updated_at := timezone('utc', now());
  new.updated_by_user_id := coalesce((select auth.uid()), old.updated_by_user_id);
  return new;
end;
$$;

create trigger trips_update_guard
before update on public.trips
for each row execute function private.guard_trip_update();

create or replace function public.update_trip(
  p_trip_id uuid,
  p_expected_version bigint,
  p_title text,
  p_start_date date,
  p_end_date date
)
returns table (
  id uuid,
  title text,
  start_date date,
  end_date date,
  lifecycle_status text,
  version bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  current_version bigint;
begin
  if actor_id is null or p_expected_version is null then
    return;
  end if;

  -- The function is the only browser mutation path. Because it is
  -- SECURITY DEFINER, this membership check is explicit and uses the
  -- immutable Auth-ID instead of trusting user metadata or caller FKs.
  if not exists (
    select 1
    from public.trips as trip
    join public.trip_members as membership on membership.trip_id = trip.id
    join public.users as app_user on app_user.id = membership.user_id
    where trip.id = p_trip_id
      and trip.lifecycle_status = 'active'
      and membership.user_id = actor_id
      and membership.membership_status = 'active'
      and app_user.account_status = 'active'
  ) then
    return;
  end if;

  select trip.version into current_version
  from public.trips as trip
  where trip.id = p_trip_id
    and trip.lifecycle_status = 'active'
  for update;

  if not found or current_version <> p_expected_version then
    return;
  end if;

  return query
  update public.trips as trip
  set title = btrim(p_title),
      start_date = p_start_date,
      end_date = p_end_date
  where trip.id = p_trip_id
    and trip.version = p_expected_version
  returning trip.id, trip.title, trip.start_date, trip.end_date,
    trip.lifecycle_status, trip.version, trip.updated_at;
end;
$$;

alter table public.users enable row level security;
alter table public.users force row level security;
alter table public.trips enable row level security;
alter table public.trips force row level security;
alter table public.trip_members enable row level security;
alter table public.trip_members force row level security;

drop policy if exists users_select_shared_profiles on public.users;
create policy users_select_shared_profiles
on public.users
for select
to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.trip_members as membership
    where membership.user_id = users.id
      and membership.membership_status = 'active'
      and private.is_active_trip_member(membership.trip_id)
  )
);

drop policy if exists trips_select_member on public.trips;
create policy trips_select_member
on public.trips
for select
to authenticated
using (private.is_active_trip_member(id));

drop policy if exists trips_update_member on public.trips;
create policy trips_update_member
on public.trips
for update
to authenticated
using (private.is_active_trip_member(id))
with check (private.is_active_trip_member(id));

drop policy if exists trip_members_select_member on public.trip_members;
create policy trip_members_select_member
on public.trip_members
for select
to authenticated
using (private.is_active_trip_member(trip_id));

-- Browser roles start without table privileges. The grants intentionally expose
-- only the fields needed by Schnitt 2 and no INSERT/DELETE path for trips or
-- membership rows.
revoke all on table public.users, public.trips, public.trip_members from anon, authenticated;
grant select (id, display_name) on table public.users to authenticated;
grant select (id, title, start_date, end_date, lifecycle_status, version, updated_at)
  on table public.trips to authenticated;
grant select (trip_id, user_id, membership_status) on table public.trip_members to authenticated;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
revoke all on function private.is_active_trip_member(uuid) from public, anon, authenticated;
grant execute on function private.is_active_trip_member(uuid) to authenticated;
revoke all on function public.update_trip(uuid, bigint, text, date, date) from public, anon, authenticated;
grant execute on function public.update_trip(uuid, bigint, text, date, date) to authenticated;

alter table public.trips replica identity full;
alter publication supabase_realtime add table public.trips;
