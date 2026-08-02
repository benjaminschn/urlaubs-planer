begin;

select plan(42);

select has_table('public', 'event_type_definitions', 'Ereignistyp-Katalog ist vorhanden');
select has_table('public', 'locations', 'Location-Tabelle ist vorhanden');
select has_table('public', 'travel_items', 'TravelItem-Tabelle ist vorhanden');
select has_table('public', 'travel_item_revisions', 'TravelItemRevision-Tabelle ist vorhanden');
select has_table('public', 'accommodation_details', 'Unterkunftsdetails sind vorhanden');
select has_table('public', 'flight_details', 'Flugdetails sind vorhanden');
select has_table('public', 'rail_details', 'Bahndetails sind vorhanden');
select has_table('public', 'bus_details', 'Busdetails sind vorhanden');
select has_table('public', 'activity_details', 'Aktivitätsdetails sind vorhanden');
select has_table('public', 'flight_segments', 'Flugteilstrecken sind vorhanden');
select has_table('public', 'rail_segments', 'Bahnteilstrecken sind vorhanden');
select has_table('public', 'bus_segments', 'Bustteilstrecken sind vorhanden');

select is(
  (select count(*)::int from pg_class where oid in (
    'public.event_type_definitions'::regclass,
    'public.locations'::regclass,
    'public.travel_items'::regclass,
    'public.travel_item_revisions'::regclass,
    'public.accommodation_details'::regclass,
    'public.flight_details'::regclass,
    'public.rail_details'::regclass,
    'public.bus_details'::regclass,
    'public.activity_details'::regclass,
    'public.flight_segments'::regclass,
    'public.rail_segments'::regclass,
    'public.bus_segments'::regclass
  ) and relrowsecurity),
  12,
  'Alle Slice-3-Tabellen erzwingen RLS'
);

select is((select count(*)::int from public.event_type_definitions where is_active), 5, 'Genau fünf aktive Ereignisarten sind katalogisiert');

create temporary table test_ids (
  user_a uuid,
  user_b uuid,
  outsider uuid,
  trip_id uuid
) on commit drop;

insert into test_ids values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  '99999999-9999-4999-8999-999999999999',
  '88888888-8888-4888-8888-888888888888'
);

set local role postgres;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
select user_id, 'authenticated', 'authenticated', email, 'test-only', timezone('utc', now())
from (
  select user_a as user_id, 'slice3-a@example.test' as email from test_ids
  union all select user_b, 'slice3-b@example.test' from test_ids
  union all select outsider, 'slice3-outsider@example.test' from test_ids
) fixture
on conflict (id) do nothing;

insert into public.users (id, display_name)
select user_a, 'Person A' from test_ids
union all select user_b, 'Person B' from test_ids
union all select outsider, 'Nichtmitglied' from test_ids;

insert into public.trips (id, title, start_date, end_date, created_by_user_id, updated_by_user_id)
select trip_id, 'Schnitt-3-Testreise', date '2026-09-01', date '2026-09-07', user_a, user_a from test_ids;

insert into public.trip_members (trip_id, user_id, created_by_user_id)
select trip_id, user_a, user_a from test_ids
union all select trip_id, user_b, user_a from test_ids;

grant select on table test_ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select user_a::text from test_ids), 'role', 'authenticated', 'aal', 'aal2')::text, true);

create temporary table created_ids (item_id uuid, version bigint) on commit drop;
insert into created_ids
select travel_item_id, version
from public.create_travel_item(
  (select trip_id from test_ids),
  jsonb_build_object(
    'event_type_code', 'activity',
    'title', 'Museum',
    'booking_status', 'confirmed',
    'start_time', jsonb_build_object('local_date', '2026-09-01', 'precision', 'date_only', 'resolution_status', 'date_only'),
    'end_time', null,
    'locations', jsonb_build_object('main', jsonb_build_object('name', 'Museum Berlin')),
    'common_details', jsonb_build_object('provider_name', 'Museum', 'notes', 'Testnotiz'),
    'type_details', jsonb_build_object('category', 'Kultur'),
    'segments', '[]'::jsonb
  ),
  'create-activity-1'
);

select is((select count(*)::int from created_ids), 1, 'Manuelle Anlage erzeugt genau ein TravelItem');
select is((select version::int from created_ids), 1, 'Neues TravelItem startet mit Version 1');
select is((select count(*)::int from public.travel_items where lifecycle_status = 'active'), 1, 'Aktives TravelItem ist lesbar');
select is((select count(*)::int from public.activity_details), 1, 'Passender Detail-Subtyp wird gespeichert');
select is((select common_details ->> 'notes' from public.travel_items), 'Testnotiz', 'Gemeinsame Zusatzdaten bleiben erhalten');
select is((select start_precision from public.travel_items), 'date_only', 'Datum-only bleibt ohne Uhrzeit erhalten');

select set_config('request.jwt.claims', json_build_object('sub', (select user_a::text from test_ids), 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.travel_items), 0, 'AAL1 sieht trotz Mitgliedschaft keine TravelItems');
select is(
  (select operation_status from public.create_travel_item(
    (select trip_id from test_ids),
    jsonb_build_object('event_type_code', 'activity', 'title', 'AAL1', 'start_time', jsonb_build_object('local_date', '2026-09-01', 'precision', 'date_only', 'resolution_status', 'date_only')),
    'aal1-create'
  )),
  'forbidden',
  'AAL1 kann die SECURITY-DEFINER-RPC nicht verwenden'
);
select set_config('request.jwt.claims', json_build_object('sub', (select user_a::text from test_ids), 'role', 'authenticated', 'aal', 'aal2')::text, true);

select is(
  (select operation_status from public.create_travel_item(
    (select trip_id from test_ids),
    jsonb_build_object(
      'event_type_code', 'activity',
      'title', 'Unbekanntes Feld',
      'start_time', jsonb_build_object('local_date', '2026-09-01', 'precision', 'date_only', 'resolution_status', 'date_only'),
      'unexpected', true
    ),
    'unknown-field'
  )),
  'validation',
  'Unbekannte JSON-Felder werden serverseitig abgelehnt'
);

select is(
  (select operation_status from public.create_travel_item(
    (select trip_id from test_ids),
    jsonb_build_object(
      'event_type_code', 'activity',
      'title', 'Zu große Notiz',
      'start_time', jsonb_build_object('local_date', '2026-09-01', 'precision', 'date_only', 'resolution_status', 'date_only'),
      'common_details', jsonb_build_object('notes', repeat('x', 20001))
    ),
    'oversized-notes'
  )),
  'validation',
  'Zu große JSON-Textfelder werden serverseitig abgelehnt'
);

create temporary table other_ids (item_id uuid, location_id uuid) on commit drop;
insert into other_ids (item_id)
select travel_item_id
from public.create_travel_item(
  (select trip_id from test_ids),
  jsonb_build_object(
    'event_type_code', 'activity',
    'title', 'Anderes Ereignis',
    'booking_status', 'confirmed',
    'start_time', jsonb_build_object('local_date', '2026-09-02', 'precision', 'date_only', 'resolution_status', 'date_only'),
    'locations', jsonb_build_object('main', jsonb_build_object('name', 'Fremder Ort')),
    'common_details', '{}'::jsonb,
    'type_details', '{}'::jsonb,
    'segments', '[]'::jsonb
  ),
  'create-other-item'
)
where operation_status = 'created';
update other_ids
set location_id = (select main_location_id from public.travel_items where id = other_ids.item_id);

select is(
  (select operation_status from public.update_travel_item(
    (select item_id from created_ids),
    1,
    jsonb_build_object(
      'event_type_code', 'activity',
      'title', 'Fremden Ort ändern',
      'booking_status', 'confirmed',
      'start_time', jsonb_build_object('local_date', '2026-09-01', 'precision', 'date_only', 'resolution_status', 'date_only'),
      'locations', jsonb_build_object('main', jsonb_build_object('id', (select location_id from other_ids), 'name', 'Manipuliert')),
      'common_details', '{}'::jsonb,
      'type_details', '{}'::jsonb,
      'segments', '[]'::jsonb
    ),
    'cross-item-location'
  )),
  'forbidden',
  'Ein Ereignis kann keinen Ort eines anderen Aggregats ändern'
);
select is(
  (select name from public.locations where id = (select location_id from other_ids)),
  'Fremder Ort',
  'Der fremde Ort bleibt nach dem abgelehnten Aggregatwechsel unverändert'
);

select is(
  (select operation_status from public.create_travel_item(
    (select trip_id from test_ids),
    jsonb_build_object(
      'event_type_code', 'rail',
      'title', 'Rückwärts laufende Verbindung',
      'booking_status', 'confirmed',
      'start_time', jsonb_build_object('local_date', '2026-09-01', 'precision', 'date_only', 'resolution_status', 'date_only'),
      'locations', '{}'::jsonb,
      'common_details', '{}'::jsonb,
      'type_details', '{}'::jsonb,
      'segments', jsonb_build_array(
        jsonb_build_object('sequence_number', 1, 'start_location', jsonb_build_object('name', 'A'), 'end_location', jsonb_build_object('name', 'B'), 'departure_time', jsonb_build_object('local_date', '2026-09-01', 'precision', 'date_only', 'resolution_status', 'date_only'), 'arrival_time', jsonb_build_object('local_date', '2026-09-03', 'precision', 'date_only', 'resolution_status', 'date_only'), 'details', '{}'::jsonb),
        jsonb_build_object('sequence_number', 2, 'start_location', jsonb_build_object('name', 'B'), 'end_location', jsonb_build_object('name', 'C'), 'departure_time', jsonb_build_object('local_date', '2026-09-02', 'precision', 'date_only', 'resolution_status', 'date_only'), 'arrival_time', jsonb_build_object('local_date', '2026-09-04', 'precision', 'date_only', 'resolution_status', 'date_only'), 'details', '{}'::jsonb)
      )
    ),
    'invalid-segment-chain'
  )),
  'validation',
  'Eine rückwärts laufende Segmentfolge wird serverseitig abgelehnt'
);

select is(
  (select operation_status from public.create_travel_item(
    (select trip_id from test_ids),
    jsonb_build_object(
      'event_type_code', 'rail',
      'title', 'Ungültige Strecke',
      'booking_status', 'confirmed',
      'start_time', jsonb_build_object('local_date', '2026-09-01', 'precision', 'date_only', 'resolution_status', 'date_only'),
      'locations', '{}'::jsonb,
      'common_details', '{}'::jsonb,
      'type_details', '{}'::jsonb,
      'segments', jsonb_build_array(jsonb_build_object(
        'sequence_number', 1,
        'start_location', jsonb_build_object('name', 'Berlin'),
        'end_location', jsonb_build_object('name', 'Hamburg'),
        'departure_time', jsonb_build_object('local_date', '2026-09-01', 'precision', 'date_only', 'resolution_status', 'date_only'),
        'arrival_time', jsonb_build_object('local_date', '2026-09-01', 'precision', 'date_only', 'resolution_status', 'date_only'),
        'details', '{}'::jsonb
      )
    )
    ),
    'create-invalid-segment'
  )),
  'validation',
  'Eine einzelne Teilstrecke wird serverseitig abgelehnt'
);

select is(
  (select operation_status from public.create_travel_item(
    (select trip_id from test_ids),
    jsonb_build_object(
      'event_type_code', 'rail',
      'title', 'Zwei Strecken',
      'booking_status', 'confirmed',
      'start_time', jsonb_build_object('local_date', '2026-09-01', 'precision', 'date_only', 'resolution_status', 'date_only'),
      'locations', '{}'::jsonb,
      'common_details', '{}'::jsonb,
      'type_details', jsonb_build_object('train_type', 'ICE'),
      'segments', jsonb_build_array(
        jsonb_build_object('sequence_number', 1, 'start_location', jsonb_build_object('name', 'Berlin'), 'end_location', jsonb_build_object('name', 'Hamburg'), 'departure_time', jsonb_build_object('local_date', '2026-09-01', 'precision', 'date_only', 'resolution_status', 'date_only'), 'arrival_time', jsonb_build_object('local_date', '2026-09-01', 'precision', 'date_only', 'resolution_status', 'date_only'), 'details', jsonb_build_object('number', '1')),
        jsonb_build_object('sequence_number', 2, 'start_location', jsonb_build_object('name', 'Hamburg'), 'end_location', jsonb_build_object('name', 'Kiel'), 'departure_time', jsonb_build_object('local_date', '2026-09-01', 'precision', 'date_only', 'resolution_status', 'date_only'), 'arrival_time', jsonb_build_object('local_date', '2026-09-01', 'precision', 'date_only', 'resolution_status', 'date_only'), 'details', jsonb_build_object('number', '2'))
      )
    ),
    'create-rail-1'
  )),
  'created',
  'Zwei geordnete Teilstrecken werden gespeichert'
);
select is((select count(*)::int from public.rail_segments), 2, 'Beide Bahnsegmente sind nach Reload vorhanden');

select is(
  (select operation_status from public.update_travel_item(
    (select item_id from created_ids),
    0,
    jsonb_build_object('event_type_code', 'activity', 'title', 'Konflikt', 'booking_status', 'confirmed', 'start_time', jsonb_build_object('local_date', '2026-09-01', 'precision', 'date_only', 'resolution_status', 'date_only'), 'locations', '{}'::jsonb, 'common_details', '{}'::jsonb, 'type_details', '{}'::jsonb, 'segments', '[]'::jsonb),
    'update-conflict'
  )),
  'conflict',
  'Veraltete TravelItem-Version wird abgelehnt'
);

select is(
  (select operation_status from public.update_travel_item(
    (select item_id from created_ids),
    1,
    jsonb_build_object('event_type_code', 'activity', 'title', 'Museum geändert', 'booking_status', 'confirmed', 'start_time', jsonb_build_object('local_date', '2026-09-01', 'precision', 'date_only', 'resolution_status', 'date_only'), 'locations', '{}'::jsonb, 'common_details', '{}'::jsonb, 'type_details', '{}'::jsonb, 'segments', '[]'::jsonb),
    'update-activity-1'
  )),
  'updated',
  'Gültiges Update gewinnt genau einmal'
);
select is((select version::int from public.travel_items where id = (select item_id from created_ids)), 2, 'Update erhöht die Version genau einmal');
select is((select count(*)::int from public.travel_item_revisions where travel_item_id = (select item_id from created_ids)), 2, 'Jede Mutation erzeugt eine Revision');

select is(
  (select operation_status from public.delete_travel_item((select item_id from created_ids), 2, 'delete-activity-1')),
  'deleted',
  'Löschen ist eine fachliche Soft-Löschung'
);
select is((select count(*)::int from public.travel_items where id = (select item_id from created_ids) and lifecycle_status = 'active'), 0, 'Gelöschtes Ereignis erscheint nicht in der aktiven Timeline');
select is((select count(*)::int from public.travel_item_revisions where travel_item_id = (select item_id from created_ids)), 3, 'Soft-Löschung erzeugt eine Revision');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select outsider::text from test_ids), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select is((select count(*)::int from public.travel_items), 0, 'Nichtmitglied sieht keine TravelItems');
select throws_ok($$insert into public.travel_items (trip_id, event_type_code, title, start_time, start_local_date, start_precision, stable_sort_key, created_by_user_id, updated_by_user_id) select trip_id, 'activity', 'fremd', '{}', date '2026-09-01', 'date_only', gen_random_uuid(), outsider, outsider from test_ids$$, '42501', 'permission denied for table travel_items', 'Nichtmitglied kann kein TravelItem direkt anlegen');
select throws_ok($$update public.travel_item_revisions set snapshot = '{}' where true$$, '42501', 'permission denied for table travel_item_revisions', 'Revisionen sind append-only und nicht direkt änderbar');

set local role anon;
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$select 1 from public.travel_items$$, '42501', 'permission denied for table travel_items', 'anon sieht keine TravelItems');
select throws_ok($$select * from public.create_travel_item('88888888-8888-4888-8888-888888888888'::uuid, '{}'::jsonb, 'anon')$$, '42501', 'permission denied for function create_travel_item', 'anon kann keine TravelItem-RPC aufrufen');

select * from finish();
rollback;
