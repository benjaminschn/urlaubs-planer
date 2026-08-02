-- Sicherheits-Härtung für die Schnitte 1 und 2. Diese Migration liegt bewusst
-- zwischen Reise- und TravelItem-Schema, damit bereits der Reisekopf nur mit
-- einer durch TOTP auf AAL2 angehobenen Sitzung erreichbar ist.

create or replace function private.is_active_trip_member(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
    and (select auth.uid()) is not null
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
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_version bigint;
begin
  if actor_id is null
    or coalesce((select auth.jwt()) ->> 'aal', 'aal1') <> 'aal2'
    or p_expected_version is null then
    return;
  end if;

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

drop policy if exists users_require_aal2 on public.users;
create policy users_require_aal2
on public.users
as restrictive
for all
to authenticated
using (coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2')
with check (coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2');

drop policy if exists trips_require_aal2 on public.trips;
create policy trips_require_aal2
on public.trips
as restrictive
for all
to authenticated
using (coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2')
with check (coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2');

drop policy if exists trip_members_require_aal2 on public.trip_members;
create policy trip_members_require_aal2
on public.trip_members
as restrictive
for all
to authenticated
using (coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2')
with check (coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2');

create index if not exists trips_created_by_user_idx
  on public.trips (created_by_user_id);
create index if not exists trips_updated_by_user_idx
  on public.trips (updated_by_user_id);
create index if not exists trip_members_created_by_user_idx
  on public.trip_members (created_by_user_id);
