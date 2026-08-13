begin;
select plan(9);

create temporary table batch_ids (
  user_id uuid,
  trip_id uuid,
  document_id uuid,
  run_id uuid,
  candidate_id uuid
) on commit drop;
insert into batch_ids values (
  '71313131-3131-4131-8131-313131313131',
  '71414141-4141-4141-8141-414141414141',
  '71515151-5151-4151-8151-515151515151',
  '71616161-6161-4161-8161-616161616161',
  '71717171-7171-4171-8171-717171717171'
);
grant select on table batch_ids to authenticated;

set local role postgres;
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
select user_id, 'authenticated', 'authenticated', 'batch-review@example.test', 'test-only', timezone('utc', now()) from batch_ids;
insert into public.users (id, display_name) select user_id, 'Batch Reviewer' from batch_ids;
insert into public.trips (id, title, start_date, end_date, created_by_user_id, updated_by_user_id)
select trip_id, 'Batch-Testreise', date '2026-09-01', date '2026-09-07', user_id, user_id from batch_ids;
insert into public.trip_members (trip_id, user_id, created_by_user_id) select trip_id, user_id, user_id from batch_ids;
insert into public.documents (
  id, trip_id, uploaded_by_user_id, upload_idempotency_key, upload_batch_key,
  upload_batch_file_count, upload_batch_total_bytes, original_file_name,
  reported_content_type, detected_content_type, byte_size, checksum,
  storage_object_key, status, uploaded_at
)
select document_id, trip_id, user_id, 'batch-upload', 'batch-batch', 1, 128,
  'batch.pdf', 'application/pdf', 'application/pdf', 128, repeat('d', 64),
  'quarantine/71515151-5151-4151-8151-515151515151', 'available', timezone('utc', now()) from batch_ids;
insert into public.extraction_runs (
  id, document_id, document_version, requested_by_user_id, idempotency_key,
  attempt_number, status, model_identifier, extraction_schema_version,
  prompt_version, candidate_adapter_version, pricing_version,
  provider_attempt_count, budget_reservation_micro_eur, budget_month_start, completed_at
)
select run_id, document_id, 1, user_id, 'batch-run', 1, 'succeeded', 'gpt-test',
  '1.0.0', '1.0.0', '1.0.0', 'test', 1, 1, date '2026-08-01', timezone('utc', now()) from batch_ids;
insert into public.extraction_candidates (id, extraction_run_id, candidate_index, proposed_event_type_code)
select candidate_id, run_id, 0, 'activity' from batch_ids;
insert into public.candidate_fields (candidate_id, field_path, original_value, provenance, confidence, source_document_id, source_locator)
select candidate_id, 'title', '"Alt"'::jsonb, 'explicit', 0.9, document_id, '[{"page_number":1,"source_hint":"Titel"}]'::jsonb from batch_ids;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id::text from batch_ids), 'role', 'authenticated', 'aal', 'aal2')::text, true);

create temporary table batch_success as
select * from public.apply_candidate_review(
  (select candidate_id from batch_ids),
  1,
  '[{"field_path":"title","occurrence_key":"","operation":"set","new_value":"Neu"},{"field_path":"common_details.notes","occurrence_key":"","operation":"set","new_value":"Notiz"}]'::jsonb,
  '{"event_type_code":"activity","title":"Neu","start_time":{"local_date":"2026-09-01"},"segments":[]}'::jsonb
);
select is((select operation_status from batch_success), 'updated', 'Batch-Review wird atomar gespeichert');
select is((select version from batch_success), 4::bigint, 'zwei Felder und Snapshot erhöhen die Version deterministisch');
select is((select count(*)::int from public.candidate_corrections where candidate_id = (select candidate_id from batch_ids)), 3, 'Feldkorrekturen und Snapshot sind append-only vorhanden');
select is((select count(*)::int from public.candidate_corrections where candidate_id = (select candidate_id from batch_ids) and field_path = '$canonical_payload'), 1, 'Batch enthält genau einen kanonischen Snapshot');

create temporary table batch_failure as
select * from public.apply_candidate_review(
  (select candidate_id from batch_ids),
  4,
  '[{"field_path":"booking_status","occurrence_key":"","operation":"set","new_value":"confirmed"},{"field_path":"broken"}]'::jsonb,
  '{"event_type_code":"activity","title":"Neu","start_time":{"local_date":"2026-09-01"},"segments":[]}'::jsonb
);
select is((select operation_status from batch_failure), 'validation', 'Ungültige spätere Korrektur lehnt den gesamten Batch ab');
select is((select version from public.extraction_candidates where id = (select candidate_id from batch_ids)), 4::bigint, 'Fehlgeschlagener Batch ändert die Candidate-Version nicht');
select is((select count(*)::int from public.candidate_corrections where candidate_id = (select candidate_id from batch_ids)), 3, 'Fehlgeschlagener Batch hinterlässt keine Teilhistorie');

select is(
  (select operation_status from public.apply_candidate_review(
    (select candidate_id from batch_ids), 3, '[]'::jsonb,
    '{"event_type_code":"activity","title":"Alt","start_time":{"local_date":"2026-09-01"},"segments":[]}'::jsonb
  )),
  'conflict',
  'Veraltete Batch-Version wird als Konflikt abgelehnt'
);
select is((select count(*)::int from public.candidate_corrections where candidate_id = (select candidate_id from batch_ids)), 3, 'Konflikt hinterlässt keine Historie');

select * from finish();
rollback;
