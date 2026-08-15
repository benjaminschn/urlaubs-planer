begin;

select plan(19);

select has_table('public', 'documents', 'Document-Tabelle ist vorhanden');
select ok((select relrowsecurity from pg_class where oid = 'public.documents'::regclass), 'Document aktiviert RLS');
select ok((select relforcerowsecurity from pg_class where oid = 'public.documents'::regclass), 'Document erzwingt RLS');
select is((select public from storage.buckets where id = 'travel-documents'), false, 'Der Dokument-Bucket ist privat');
select ok((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'documents_storage_insert_quarantine') = 1, 'Storage-Upload ist auf reservierte Quarantänepfade begrenzt');
select ok((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'documents_storage_select_available') = 1, 'Storage-Download ist auf freigegebene Dokumente begrenzt');

create temporary table test_ids (
  user_a uuid,
  user_b uuid,
  outsider uuid,
  trip_id uuid
) on commit drop;

insert into test_ids values (
  '12121212-1212-4121-8121-121212121212',
  '13131313-1313-4131-8131-131313131313',
  '14141414-1414-4141-8141-141414141414',
  '15151515-1515-4151-8151-151515151515'
);

set local role postgres;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
select user_id, 'authenticated', 'authenticated', email, 'test-only', timezone('utc', now())
from (
  select user_a as user_id, 'slice4-a@example.test' as email from test_ids
  union all select user_b, 'slice4-b@example.test' from test_ids
  union all select outsider, 'slice4-outsider@example.test' from test_ids
) fixture
on conflict (id) do nothing;

insert into public.users (id, display_name)
select user_a, 'Person A' from test_ids
union all select user_b, 'Person B' from test_ids
union all select outsider, 'Nichtmitglied' from test_ids;

insert into public.trips (id, title, start_date, end_date, created_by_user_id, updated_by_user_id)
select trip_id, 'Schnitt-4-Testreise', date '2026-09-01', date '2026-09-07', user_a, user_a from test_ids;

insert into public.trip_members (trip_id, user_id, created_by_user_id)
select trip_id, user_a, user_a from test_ids
union all select trip_id, user_b, user_a from test_ids;

grant select on table test_ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select user_a::text from test_ids), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select is(
  (select count(*)::int from public.reserve_document_upload((select trip_id from test_ids), 'reise.pdf', 'application/pdf', 1024, 'upload-a', 'batch-a', 1, 1024)),
  0,
  'AAL1 kann kein Dokument reservieren'
);

select set_config('request.jwt.claims', json_build_object('sub', (select user_a::text from test_ids), 'role', 'authenticated', 'aal', 'aal2')::text, true);
create temporary table reserved_document as
select * from public.reserve_document_upload((select trip_id from test_ids), 'reise.pdf', 'application/pdf', 1024, 'upload-a', 'batch-a', 1, 1024);

select is((select count(*)::int from reserved_document), 1, 'Eine gültige Auswahl reserviert genau ein Document');
select is((select status from reserved_document), 'uploading', 'Die Reservierung startet in uploading');
select ok((select storage_object_key ~ '^quarantine/[0-9a-f-]{36}$' from reserved_document), 'Der Storage-Pfad ist ein serverseitig gebundener Quarantänepfad');
select is(
  (select count(*)::int from public.reserve_document_upload((select trip_id from test_ids), 'anderer-name.pdf', 'application/pdf', 1024, 'upload-a', 'batch-a', 1, 1024)),
  1,
  'Replay desselben Idempotenzschlüssels erzeugt kein zweites Document'
);
select is((select count(*)::int from public.documents where trip_id = (select trip_id from test_ids)), 1, 'Replay verändert die Document-Anzahl nicht');

create temporary table retry_document as
select * from public.reserve_document_upload((select trip_id from test_ids), 'retry.pdf', 'application/pdf', 1024, 'upload-retry', 'batch-retry', 1, 1024);
select is(
  (select count(*)::int from public.mark_document_upload_failed((select id from retry_document), 1, 'upload_failed')),
  1,
  'Ein technischer Uploadfehler wird versionsgeprüft gespeichert'
);
select is((select status from public.documents where id = (select id from retry_document)), 'upload_failed', 'Ein fehlgeschlagener Upload bleibt für das hochladende Mitglied sichtbar');
set local role postgres;
update private.document_storage_cleanups
set status = 'succeeded', lease_owner = null, lease_expires_at = null
where document_id = (select id from retry_document);
set local role authenticated;
select is(
  (select version::int from public.prepare_document_upload_retry((select id from retry_document), 2)),
  3,
  'Ein Retry erhöht die Document-Version genau einmal'
);
select is((select status from public.documents where id = (select id from retry_document)), 'uploading', 'Ein Retry setzt nur den technischen Uploadzustand zurück');

set local role postgres;
update public.documents
set status = 'available', detected_content_type = 'application/pdf', checksum = repeat('a', 64), uploaded_at = timezone('utc', now()), version = version + 1
where id = (select id from reserved_document);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select user_b::text from test_ids), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select is((select count(*)::int from public.documents), 1, 'Zweites Mitglied sieht freigegebene Dokument-Metadaten');
select set_config('request.jwt.claims', json_build_object('sub', (select outsider::text from test_ids), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select is((select count(*)::int from public.documents), 0, 'Nichtmitglied sieht keine Dokument-Metadaten');

set local role anon;
select throws_ok($$select 1 from public.documents$$, '42501', 'permission denied for table documents', 'anon besitzt keinen Document-Zugriff');

select * from finish();
rollback;
