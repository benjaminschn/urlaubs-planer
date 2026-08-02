begin;

select plan(27);

select has_table('public', 'extraction_runs', 'ExtractionRun-Tabelle ist vorhanden');
select has_table('public', 'extraction_candidates', 'ExtractionCandidate-Tabelle ist vorhanden');
select has_table('public', 'candidate_fields', 'CandidateField-Tabelle ist vorhanden');
select ok((select relrowsecurity from pg_class where oid = 'public.extraction_runs'::regclass), 'ExtractionRuns haben RLS aktiviert');
select ok((select relrowsecurity from pg_class where oid = 'public.extraction_candidates'::regclass), 'Candidates haben RLS aktiviert');
select ok((select relrowsecurity from pg_class where oid = 'public.candidate_fields'::regclass), 'CandidateFields haben RLS aktiviert');

create temporary table test_ids (
  user_a uuid,
  user_b uuid,
  outsider uuid,
  trip_id uuid,
  document_id uuid
) on commit drop;

insert into test_ids values (
  '21212121-2121-4121-8121-212121212121',
  '23232323-2323-4232-8232-232323232323',
  '24242424-2424-4242-8242-242424242424',
  '25252525-2525-4252-8252-252525252525',
  '26262626-2626-4262-8262-262626262626'
);
grant select on table test_ids to authenticated, service_role;

set local role postgres;
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
select user_id, 'authenticated', 'authenticated', email, 'test-only', timezone('utc', now())
from (
  select user_a as user_id, 'slice5-a@example.test' as email from test_ids
  union all select user_b, 'slice5-b@example.test' from test_ids
  union all select outsider, 'slice5-outsider@example.test' from test_ids
) fixture
on conflict (id) do nothing;
insert into public.users (id, display_name)
select user_a, 'Person A' from test_ids
union all select user_b, 'Person B' from test_ids
union all select outsider, 'Nichtmitglied' from test_ids;
insert into public.trips (id, title, start_date, end_date, created_by_user_id, updated_by_user_id)
select trip_id, 'Schnitt-5-Testreise', date '2026-09-01', date '2026-09-07', user_a, user_a from test_ids;
insert into public.trip_members (trip_id, user_id, created_by_user_id)
select trip_id, user_a, user_a from test_ids
union all select trip_id, user_b, user_a from test_ids;
insert into public.documents (
  id, trip_id, uploaded_by_user_id, upload_idempotency_key, upload_batch_key,
  upload_batch_file_count, upload_batch_total_bytes, original_file_name, reported_content_type,
  detected_content_type, byte_size, checksum, storage_object_key, status, uploaded_at
)
select document_id, trip_id, user_a, 'slice5-upload', 'slice5-batch', 1, 1024,
  'synthetic.pdf', 'application/pdf', 'application/pdf', 1024, repeat('a', 64),
  'quarantine/26262626-2626-4262-8262-262626262626', 'available', timezone('utc', now())
from test_ids;
update private.extraction_runtime_config set provider_enabled = true, monthly_budget_micro_eur = 20000000 where singleton;

create temporary table reserved_run as
select (private.reserve_extraction_run(
  (select document_id from test_ids), 1, (select user_a from test_ids), 'start-a', 'gpt-test', '1.0.0', '1.0.0', '1.0.0', 'test-pricing-v1', 1000000
)).*;
select is((select status from reserved_run), 'queued', 'Ein berechtigter Start reserviert genau einen queued Run');
select is((select count(*)::int from public.extraction_runs), 1, 'Die erste Reservierung erzeugt genau einen Run');
select is((select count(*)::int from private.extraction_budget_months), 1, 'Die Budgetreservierung wird atomar angelegt');
select is(
  (select count(*)::int from private.reserve_extraction_run(
    (select document_id from test_ids), 1, (select user_a from test_ids), 'start-a', 'gpt-test', '1.0.0', '1.0.0', '1.0.0', 'test-pricing-v1', 1000000
  )),
  1,
  'Ein Replay desselben Idempotenzschlüssels erzeugt keinen zweiten Run'
);
select is((select count(*)::int from public.extraction_runs), 1, 'Replay verändert weder Run- noch Providerkostenanzahl');

create temporary table claimed_run as
select * from private.claim_extraction_run((select id from reserved_run), (select user_a from test_ids), '27272727-2727-4272-8272-272727272727');
select is((select status from claimed_run), 'processing', 'Der Run wird exklusiv mit Lease beansprucht');
select is(
  (select status from private.complete_extraction_run(
    (select id from claimed_run), (select user_a from test_ids), '27272727-2727-4272-8272-272727272727', 'resp-test', 100,
    1,
    '[{"candidate_index":0,"proposed_event_type_code":"accommodation","overall_confidence":null,"fields":[{"field_path":"title","occurrence_key":"","original_value":"Testhotel","provenance":"explicit","confidence":0.9,"source_locator":[{"page_number":1,"source_hint":"Hotel"}]}]}]'::jsonb,
    '[{"code":"missing_critical_information","severity":"review","event_index":0,"field_path":"start.local_date","message":"Startdatum prüfen","source_locator":[{"page_number":1,"source_hint":"Datum"}]}]'::jsonb
  )),
  'succeeded',
  'Ein validierter Run speichert ausschließlich unbestätigte Candidates'
);
select is((select count(*)::int from public.extraction_candidates), 1, 'Genau ein Candidate wird in stabiler Reihenfolge gespeichert');
select is((select count(*)::int from public.candidate_fields), 1, 'CandidateField bewahrt den Originalwert mit Herkunft');
select is((select count(*)::int from public.travel_items), 0, 'Extraktion erzeugt kein TravelItem');

create temporary table expiring_run as
select (private.reserve_extraction_run(
  (select document_id from test_ids), 1, (select user_a from test_ids), 'lease-a', 'gpt-test', '1.0.0', '1.0.0', '1.0.0', 'test-pricing-v1', 1000000
)).*;
select * from private.claim_extraction_run((select id from expiring_run), (select user_a from test_ids), '28282828-2828-4282-8282-282828282828');
update public.extraction_runs set lease_expires_at = timezone('utc', now()) - interval '1 second' where id = (select id from expiring_run);
select throws_ok(
  $$select private.fail_extraction_run((select id from expiring_run), (select user_a from test_ids), '28282828-2828-4282-8282-282828282828', 'provider_unavailable', true, 1, 0)$$,
  'P0001',
  '[forbidden] Verarbeitung ist nicht verfügbar',
  'Ein abgelaufener Lease kann nicht mehr abgeschlossen werden'
);
create temporary table replacement_run as
select (private.reserve_extraction_run(
  (select document_id from test_ids), 1, (select user_a from test_ids), 'lease-b', 'gpt-test', '1.0.0', '1.0.0', '1.0.0', 'test-pricing-v1', 1000000
)).*;
select is((select status from public.extraction_runs where id = (select id from expiring_run)), 'expired', 'Ein abgelaufener Lease wird terminal markiert');
select is((select status from replacement_run), 'queued', 'Nach Lease-Ablauf kann ein neuer Run reserviert werden');
select is((select reserved_micro_eur from private.extraction_budget_months), 1000000::bigint, 'Ein abgelaufener Lease gibt seine Budgetreservierung genau einmal frei');

set local role service_role;
select is(
  (select count(*)::int from public.reserve_extraction_run(
    (select document_id from test_ids), 1, (select user_a from test_ids), 'start-a', 'gpt-test', '1.0.0', '1.0.0', '1.0.0', 'test-pricing-v1', 1000000
  )),
  1,
  'Die serverseitige Rolle kann die nicht für Browser freigegebene RPC aufrufen'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select user_b::text from test_ids), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select is((select count(*)::int from public.extraction_runs), 3, 'Zweites Mitglied sieht alle Runs des Dokuments');
select is((select count(*)::int from public.extraction_candidates), 1, 'Zweites Mitglied sieht unbestätigte Candidates');
select throws_ok(
  $$select * from public.reserve_extraction_run(null::uuid, 1::bigint, null::uuid, 'browser', 'browser', '1.0.0', '1.0.0', '1.0.0', 'test-pricing-v1', 1)$$,
  '42501',
  'permission denied for function reserve_extraction_run',
  'Browserrollen dürfen keine privilegierte Extraktionsfunktion aufrufen'
);
select set_config('request.jwt.claims', json_build_object('sub', (select outsider::text from test_ids), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select is((select count(*)::int from public.extraction_runs), 0, 'Nichtmitglied sieht keine Runs');
select is((select count(*)::int from public.candidate_fields), 0, 'Nichtmitglied sieht keine CandidateFields');
set local role anon;
select throws_ok($$select 1 from public.extraction_candidates$$, '42501', 'permission denied for table extraction_candidates', 'anon besitzt keinen Candidate-Zugriff');

select * from finish();
rollback;
