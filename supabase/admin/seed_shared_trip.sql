-- Administrativer Seed für die eine produktive Reise.
-- Mit psql ausführen und alle Variablen als -v übergeben:
--
-- psql "$DATABASE_URL" \
--   -v trip_id='...' -v member_a_id='...' -v member_b_id='...' \
--   -v trip_title='...' -v start_date='YYYY-MM-DD' -v end_date='YYYY-MM-DD' \
--   -f supabase/admin/seed_shared_trip.sql
--
-- Die Auth-IDs müssen bereits als bestätigte Konten in auth.users existieren.
-- Dieses Skript wird nie aus der PWA und nie mit einem Browser-Schlüssel ausgeführt.

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_trip_id uuid := :'trip_id'::uuid;
  v_member_a_id uuid := :'member_a_id'::uuid;
  v_member_b_id uuid := :'member_b_id'::uuid;
  v_active_trip_count bigint;
  v_user_count bigint;
begin
  if v_member_a_id = v_member_b_id then
    raise exception 'Die beiden Seed-Mitglieder müssen unterschiedliche Auth-IDs besitzen';
  end if;

  select count(*) into v_user_count
  from auth.users
  where id in (v_member_a_id, v_member_b_id)
    and email_confirmed_at is not null;
  if v_user_count <> 2 then
    raise exception 'Genau zwei bestätigte Auth-Konten müssen vor dem Seed vorhanden sein';
  end if;

  select count(*) into v_active_trip_count
  from public.trips
  where lifecycle_status = 'active';
  if v_active_trip_count <> 0 then
    raise exception 'Eine aktive Reise ist bereits vorhanden';
  end if;

  insert into public.users (id, display_name)
  select id, coalesce(nullif(raw_user_meta_data ->> 'display_name', ''), email)
  from auth.users
  where id in (v_member_a_id, v_member_b_id)
  on conflict (id) do update
    set account_status = 'active',
        updated_at = timezone('utc', now()),
        version = public.users.version + 1;

  insert into public.trips (
    id,
    title,
    start_date,
    end_date,
    created_by_user_id,
    updated_by_user_id
  ) values (
    v_trip_id,
    :'trip_title',
    :'start_date'::date,
    :'end_date'::date,
    v_member_a_id,
    v_member_a_id
  );

  insert into public.trip_members (trip_id, user_id, created_by_user_id)
  values
    (v_trip_id, v_member_a_id, v_member_a_id),
    (v_trip_id, v_member_b_id, v_member_a_id);

  if (select count(*) from public.trip_members where trip_id = v_trip_id and membership_status = 'active') <> 2 then
    raise exception 'Seed muss genau zwei aktive Mitglieder erzeugen';
  end if;
end;
$$;

commit;
