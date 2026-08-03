begin;

select plan(40);

select has_table('public', 'candidate_corrections', 'CandidateCorrection-Tabelle ist vorhanden');
select has_table('public', 'candidate_confirmations', 'CandidateConfirmation-Tabelle ist vorhanden');
select has_table('public', 'travel_item_documents', 'TravelItemDocument-Tabelle ist vorhanden');
select ok((select relrowsecurity from pg_class where oid = 'public.candidate_corrections'::regclass), 'CandidateCorrections erzwingen RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.candidate_confirmations'::regclass), 'CandidateConfirmations erzwingen RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.travel_item_documents'::regclass), 'TravelItemDocuments erzwingen RLS');

create temporary table test_ids (
  user_a uuid,
  user_b uuid,
  outsider uuid,
  trip_id uuid,
  document_id uuid,
  run_id uuid,
  candidate_id uuid,
  discard_candidate_id uuid,
  invalid_candidate_id uuid
) on commit drop;
insert into test_ids values (
  '31313131-3131-4131-8131-313131313131',
  '32323232-3232-4232-8232-323232323232',
  '33333333-3333-4333-8333-333333333333',
  '34343434-3434-4434-8434-343434343434',
  '35353535-3535-4535-8535-353535353535',
  '36363636-3636-4636-8636-363636363636',
  '37373737-3737-4737-8737-373737373737',
  '38383838-3838-4838-8838-383838383838',
  '39393939-3939-4939-8939-393939393939'
);
grant select on table test_ids to authenticated;

set local role postgres;
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
select user_id, 'authenticated', 'authenticated', email, 'test-only', timezone('utc', now())
from (
  select user_a as user_id, 'slice67-a@example.test' as email from test_ids
  union all select user_b, 'slice67-b@example.test' from test_ids
  union all select outsider, 'slice67-outsider@example.test' from test_ids
) fixture on conflict (id) do nothing;
insert into public.users (id, display_name)
select user_a, 'Person A' from test_ids union all
select user_b, 'Person B' from test_ids union all
select outsider, 'Nichtmitglied' from test_ids;
insert into public.trips (id, title, start_date, end_date, created_by_user_id, updated_by_user_id)
select trip_id, 'Schnitt-6-7-Testreise', date '2026-09-01', date '2026-09-07', user_a, user_a from test_ids;
insert into public.trip_members (trip_id, user_id, created_by_user_id)
select trip_id, user_a, user_a from test_ids union all select trip_id, user_b, user_a from test_ids;
insert into public.documents (
  id, trip_id, uploaded_by_user_id, upload_idempotency_key, upload_batch_key,
  upload_batch_file_count, upload_batch_total_bytes, original_file_name,
  reported_content_type, detected_content_type, byte_size, checksum,
  storage_object_key, status, uploaded_at
)
select document_id, trip_id, user_a, 'slice67-upload', 'slice67-batch', 1, 1024,
  'synthetic.pdf', 'application/pdf', 'application/pdf', 1024, repeat('b', 64),
  'quarantine/35353535-3535-4535-8535-353535353535', 'available', timezone('utc', now()) from test_ids;
insert into public.extraction_runs (
  id, document_id, document_version, requested_by_user_id, idempotency_key,
  attempt_number, status, model_identifier, extraction_schema_version,
  prompt_version, candidate_adapter_version, pricing_version,
  provider_attempt_count, budget_reservation_micro_eur, budget_month_start,
  completed_at
)
select run_id, document_id, 1, user_a, 'slice67-run', 1, 'succeeded', 'gpt-test',
  '1.0.0', '1.0.0', '1.0.0', 'test', 1, 1, date '2026-08-01', timezone('utc', now())
from test_ids;
insert into public.extraction_candidates (id, extraction_run_id, candidate_index, proposed_event_type_code)
select candidate_id, run_id, 0, 'activity' from test_ids union all
select discard_candidate_id, run_id, 1, 'activity' from test_ids union all
select invalid_candidate_id, run_id, 2, 'activity' from test_ids;
insert into public.candidate_fields (candidate_id, field_path, original_value, provenance, confidence, source_document_id, source_locator)
select candidate_id, 'title', '"Museum"'::jsonb, 'explicit', 0.9, document_id, '[{"page_number":1,"source_hint":"Titel"}]'::jsonb from test_ids union all
select candidate_id, 'start.local_date', '"2026-09-01"'::jsonb, 'explicit', 0.9, document_id, '[{"page_number":1,"source_hint":"Datum"}]'::jsonb from test_ids union all
select discard_candidate_id, 'title', '"Verwerfen"'::jsonb, 'explicit', 0.9, document_id, '[{"page_number":1,"source_hint":"Titel"}]'::jsonb from test_ids union all
select invalid_candidate_id, 'title', '"Ungültig"'::jsonb, 'explicit', 0.9, document_id, '[{"page_number":1,"source_hint":"Titel"}]'::jsonb from test_ids;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select user_a::text from test_ids), 'role', 'authenticated', 'aal', 'aal2')::text, true);

create temporary table canonical_payload as
select jsonb_build_object(
  'event_type_code', 'activity',
  'title', 'Museum korrigiert',
  'booking_status', 'confirmed',
  'start_time', jsonb_build_object('local_date', '2026-09-01', 'precision', 'date_only', 'resolution_status', 'date_only'),
  'end_time', null,
  'locations', '{}'::jsonb,
  'common_details', '{}'::jsonb,
  'type_details', jsonb_build_object('category', 'Kultur'),
  'segments', '[]'::jsonb
) as value;
grant select on table canonical_payload to authenticated;

select is(
  (select operation_status from public.apply_candidate_correction((select candidate_id from test_ids), 1, '$canonical_payload', '', 'set', (select value from canonical_payload))),
  'updated',
  'Gespeicherte Prüfung erzeugt eine append-only Korrektur'
);
select is((select version from public.extraction_candidates where id = (select candidate_id from test_ids)), 2::bigint, 'Korrektur erhöht Candidate-Version genau einmal');
select is((select count(*)::int from public.candidate_corrections where candidate_id = (select candidate_id from test_ids)), 1, 'Genau eine Korrektur wurde angelegt');
select is((select previous_effective_value from public.candidate_corrections where candidate_id = (select candidate_id from test_ids)), 'null'::jsonb, 'Korrektur bewahrt den vorherigen effektiven Wert');
select is((select original_value from public.candidate_fields where candidate_id = (select candidate_id from test_ids) and field_path = 'title'), '"Museum"'::jsonb, 'CandidateField-Original bleibt unverändert');
select is(
  (select operation_status from public.apply_candidate_correction((select candidate_id from test_ids), 1, 'title', '', 'set', '"Veraltet"'::jsonb)),
  'conflict',
  'Parallele Korrektur auf alter Version überschreibt nichts'
);

create temporary table confirmation_result as
select * from public.confirm_candidate((select candidate_id from test_ids), 2, 'confirm-once', (select value from canonical_payload));
select is((select operation_status from confirmation_result), 'created', 'Ausdrückliche Bestätigung erzeugt ein Ereignis');
select is((select count(*)::int from public.travel_items), 1, 'Bestätigung erzeugt genau ein TravelItem');
select is((select count(*)::int from public.candidate_confirmations), 1, 'Bestätigung erzeugt genau eine CandidateConfirmation');
select is((select count(*)::int from public.travel_item_revisions), 1, 'Bestätigung erzeugt genau eine Revision');
select is((select count(*)::int from public.travel_item_documents), 1, 'Bestätigung verknüpft genau ein Herkunftsdokument');
select is((select link_role from public.travel_item_documents), 'source', 'Dokumentrelation markiert die Extraktionsherkunft');
select is((select linked_by_user_id from public.travel_item_documents), (select user_a from test_ids), 'Dokumentrelation protokolliert den bestätigenden Akteur');
select is((select creation_source from public.travel_items), 'candidate_confirmation', 'TravelItem markiert die Candidate-Herkunft');
select is((select created_from_candidate_id from public.travel_items), (select candidate_id from test_ids), 'TravelItem referenziert den erzeugenden Candidate');
select is((select change_kind from public.travel_item_revisions), 'created_from_candidate', 'Revision markiert die Bestätigung');
select is((select status from public.extraction_candidates where id = (select candidate_id from test_ids)), 'confirmed', 'Candidate wird terminal bestätigt');
select is(
  (select operation_status from public.confirm_candidate((select candidate_id from test_ids), 2, 'confirm-once', (select value from canonical_payload))),
  'replayed',
  'Identischer Idempotenzschlüssel liefert dasselbe Ergebnis'
);
select is(
  (select operation_status from public.confirm_candidate((select candidate_id from test_ids), 3, 'confirm-twice', (select value from canonical_payload))),
  'forbidden',
  'Terminaler Candidate kann mit neuem Schlüssel nicht erneut bestätigt werden'
);
select is((select count(*)::int from public.travel_items), 1, 'Replay und neuer Schlüssel erzeugen kein Duplikat');

select is(
  (select operation_status from public.apply_candidate_correction((select discard_candidate_id from test_ids), 1, 'title', '', 'set', '"Korrigiert"'::jsonb)),
  'updated',
  'Ein zweiter Candidate kann vor dem Verwerfen korrigiert werden'
);
select is(
  (select operation_status from public.discard_candidate((select discard_candidate_id from test_ids), 2)),
  'discarded',
  'Verwerfen ist eine terminale, versionsgeprüfte Aktion'
);
select is((select count(*)::int from public.candidate_corrections where candidate_id = (select discard_candidate_id from test_ids)), 1, 'Verwerfen bewahrt die Korrekturhistorie');
select is((select count(*)::int from public.travel_items), 1, 'Verwerfen erzeugt kein TravelItem');

create temporary table invalid_payload as
select jsonb_set((select value from canonical_payload), '{title}', '""'::jsonb) as value;
grant select on table invalid_payload to authenticated;
select is(
  (select operation_status from public.apply_candidate_correction((select invalid_candidate_id from test_ids), 1, '$canonical_payload', '', 'set', (select value from invalid_payload))),
  'updated',
  'Auch ein noch ungültiger Prüfstand bleibt bearbeitbar und speicherbar'
);
select is(
  (select operation_status from public.confirm_candidate((select invalid_candidate_id from test_ids), 2, 'confirm-invalid', (select value from invalid_payload))),
  'validation',
  'Die zweite Fachvalidierung blockiert einen ungültigen Prüfstand'
);
select is((select status from public.extraction_candidates where id = (select invalid_candidate_id from test_ids)), 'draft', 'Fehlgeschlagene Bestätigung lässt den Candidate unverändert');
select is((select count(*)::int from public.candidate_confirmations), 1, 'Fehlgeschlagene Bestätigung legt keine Confirmation an');
select is((select count(*)::int from public.travel_items), 1, 'Fehlgeschlagene Bestätigung rollt das TravelItem vollständig zurück');

select set_config('request.jwt.claims', json_build_object('sub', (select outsider::text from test_ids), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select is((select count(*)::int from public.candidate_corrections), 0, 'Nichtmitglied sieht keine Korrekturen');
select is((select count(*)::int from public.candidate_confirmations), 0, 'Nichtmitglied sieht keine Bestätigungen');
select is(
  (select operation_status from public.discard_candidate((select invalid_candidate_id from test_ids), 1)),
  'forbidden',
  'Bekannte fremde Candidate-ID liefert keinen Existenzhinweis'
);

set local role anon;
select throws_ok($$select 1 from public.candidate_confirmations$$, '42501', 'permission denied for table candidate_confirmations', 'anon besitzt keinen Bestätigungszugriff');

set local role postgres;
delete from public.trip_members where trip_id = (select trip_id from test_ids) and user_id = (select user_a from test_ids);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select user_a::text from test_ids), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select is(
  (select operation_status from public.confirm_candidate((select candidate_id from test_ids), 2, 'confirm-once', (select value from canonical_payload))),
  'forbidden',
  'Ein Replay liefert nach entzogener Mitgliedschaft keinen Ereignisverweis'
);

select * from finish();
rollback;
