begin;

select plan(24);

select has_table('public', 'users', 'User-Tabelle ist vorhanden');
select has_table('public', 'trips', 'Trip-Tabelle ist vorhanden');
select has_table('public', 'trip_members', 'TripMember-Tabelle ist vorhanden');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.users'::regclass),
  'RLS ist für User aktiviert'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.trips'::regclass),
  'RLS ist für Trip aktiviert'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.trip_members'::regclass),
  'RLS ist für TripMember aktiviert'
);

create temporary table test_ids (
  user_a uuid,
  user_b uuid,
  outsider uuid,
  trip_id uuid
) on commit drop;

insert into test_ids values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
);

set local role postgres;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
select user_id, 'authenticated', 'authenticated', email, 'test-only', timezone('utc', now())
from (
  select user_a as user_id, 'slice2-a@example.test' as email from test_ids
  union all
  select user_b, 'slice2-b@example.test' from test_ids
  union all
  select outsider, 'slice2-outsider@example.test' from test_ids
) as fixture
on conflict (id) do nothing;

insert into public.users (id, display_name)
select user_a, 'Person A' from test_ids
union all
select user_b, 'Person B' from test_ids
union all
select outsider, 'Nichtmitglied' from test_ids;

insert into public.trips (
  id,
  title,
  start_date,
  end_date,
  created_by_user_id,
  updated_by_user_id
)
select trip_id, 'Testreise', date '2026-09-01', date '2026-09-07', user_a, user_a
from test_ids;

insert into public.trip_members (trip_id, user_id, created_by_user_id)
select trip_id, user_a, user_a from test_ids
union all
select trip_id, user_b, user_a from test_ids;

grant select on table test_ids to authenticated;

select is(
  (select count(*)::int from public.trip_members where trip_id = (select trip_id from test_ids) and membership_status = 'active'),
  2,
  'Der administrative Seed besitzt genau zwei aktive Mitglieder'
);

select throws_ok(
  $$
    insert into public.trips (title, start_date, end_date, lifecycle_status, created_by_user_id, updated_by_user_id)
    select 'Ungültig', date '2026-09-02', date '2026-09-01', 'closed', user_a, user_a from test_ids
  $$,
  '23514',
  'new row for relation "trips" violates check constraint "trips_date_order"',
  'end_date < start_date wird serverseitig abgelehnt'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select user_a::text from test_ids), 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*)::int from public.trips where id = (select trip_id from test_ids)),
  0,
  'Eine AAL1-Sitzung erhält vor Abschluss der MFA keine Reisezeile'
);
select is(
  (select count(*)::int from public.update_trip(
    (select trip_id from test_ids), 1, 'AAL1', date '2026-09-01', date '2026-09-07'
  )),
  0,
  'Eine AAL1-Sitzung kann die privilegierte Reise-RPC nicht verwenden'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select user_a::text from test_ids), 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);

select is(
  (select count(*)::int from public.trips where id = (select trip_id from test_ids)),
  1,
  'Mitglied kann die gemeinsame Reise lesen'
);
select is(
  (select count(*)::int from public.trip_members where trip_id = (select trip_id from test_ids)),
  2,
  'Mitglied kann die Mitgliedschaft derselben Reise lesen'
);
select is(
  (select count(*)::int from public.users where id in ((select user_a from test_ids), (select user_b from test_ids))),
  2,
  'Mitglied kann nur die Minimalprofile derselben Reise lesen'
);

select * from public.update_trip(
  (select trip_id from test_ids),
  1,
  'Änderung A',
  date '2026-09-01',
  date '2026-09-07'
);

select is(
  (select version::int from public.trips where id = (select trip_id from test_ids)),
  2,
  'Eine bestätigte Änderung erhöht die Version genau einmal'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select user_b::text from test_ids), 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);

select * from public.update_trip(
  (select trip_id from test_ids),
  1,
  'Veraltete Änderung',
  date '2026-09-01',
  date '2026-09-07'
);

select is(
  (select title from public.trips where id = (select trip_id from test_ids)),
  'Änderung A',
  'Ein Update auf eine gelesene veraltete Version überschreibt den kanonischen Stand nicht'
);
select is(
  (select version::int from public.trips where id = (select trip_id from test_ids)),
  2,
  'Ein abgelehnter Versionskonflikt erhöht die Version nicht'
);

select * from public.update_trip(
  (select trip_id from test_ids),
  2,
  'Änderung B',
  date '2026-09-01',
  date '2026-09-07'
);

select is(
  (select version::int from public.trips where id = (select trip_id from test_ids)),
  3,
  'Das nächste gültige Update baut monoton auf Version 2 auf'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select outsider::text from test_ids), 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);

select is(
  (select count(*)::int from public.trips where id = (select trip_id from test_ids)),
  0,
  'Ein authentifizierter Nichtmitglied erhält keine Reisezeile'
);
select is(
  (select count(*)::int from public.trip_members where trip_id = (select trip_id from test_ids)),
  0,
  'Ein authentifizierter Nichtmitglied erhält keine Mitgliedschaftszeile'
);
select throws_ok(
  $$
    insert into public.trip_members (trip_id, user_id)
    select trip_id, outsider from test_ids
  $$,
  '42501',
  'permission denied for table trip_members',
  'Ein Nichtmitglied kann keine Mitgliedschaft anlegen'
);
select throws_ok(
  $$
    update public.users set display_name = 'Fremd' where id = (select user_a from test_ids)
  $$,
  '42501',
  'permission denied for table users',
  'Ein Nichtmitglied kann kein fremdes Profil ändern'
);

set local role anon;
select set_config('request.jwt.claims', '{}', true);
select throws_ok(
  $$select 1 from public.trips$$,
  '42501',
  'permission denied for table trips',
  'anon erhält keine Reisezeilen'
);
select throws_ok(
  $$
    select * from public.update_trip(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
      3,
      'anon',
      date '2026-09-01',
      date '2026-09-07'
    )
  $$,
  '42501',
  'permission denied for function update_trip',
  'anon kann die kontrollierte Reise-Mutation nicht aufrufen'
);

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'trips' and policyname = 'trips_update_member' and with_check like '%is_active_trip_member%'),
  1,
  'Trip-UPDATE besitzt einen WITH-CHECK-Mitgliedschaftspfad'
);

select * from finish();
rollback;
