begin;
select plan(22);

select has_table('private', 'document_storage_cleanups', 'rejected blobs have a private cleanup queue');
select ok(
  (select relrowsecurity from pg_class where oid = 'private.document_storage_cleanups'::regclass),
  'cleanup queue has RLS enabled'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'private.document_storage_cleanups'::regclass),
  'cleanup queue forces RLS'
);
select has_function(
  'private', 'install_document_storage_cleanup_schedule', array[]::text[],
  'deployment-controlled cleanup scheduler installer exists'
);
select is(
  (select count(*)::integer from cron.job where jobname = 'process-document-storage-cleanups-every-minute'),
  0,
  'migrations leave the cleanup cron unscheduled'
);

create temporary table cleanup_ids (
  owner_id uuid,
  trip_id uuid,
  reject_doc uuid,
  invalid_doc uuid,
  unsupported_doc uuid,
  available_doc uuid,
  pending_doc uuid
) on commit drop;

insert into cleanup_ids values (
  '87000000-0000-4000-8000-000000000101',
  '87000000-0000-4000-8000-000000000001',
  '87000000-0000-4000-8000-000000000011',
  '87000000-0000-4000-8000-000000000012',
  '87000000-0000-4000-8000-000000000013',
  '87000000-0000-4000-8000-000000000014',
  '87000000-0000-4000-8000-000000000015'
);

grant select on table cleanup_ids to authenticated, service_role;

set local role postgres;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
select owner_id, 'authenticated', 'authenticated', 'cleanup-user@example.test', 'test-only', timezone('utc', now())
from cleanup_ids
on conflict (id) do nothing;

insert into public.users (id, display_name)
select owner_id, 'Cleanup User' from cleanup_ids;

insert into public.trips (id, title, start_date, end_date, created_by_user_id, updated_by_user_id)
select trip_id, 'Cleanup trip', date '2026-09-01', date '2026-09-05', owner_id, owner_id from cleanup_ids;

insert into public.trip_members (trip_id, user_id, created_by_user_id)
select trip_id, owner_id, owner_id from cleanup_ids;

insert into public.documents (
  id, trip_id, uploaded_by_user_id, upload_idempotency_key, upload_batch_key,
  upload_batch_file_count, upload_batch_total_bytes, original_file_name,
  reported_content_type, byte_size, storage_object_key, status,
  verification_lease_owner, verification_lease_expires_at, verification_attempt_count, version
)
select reject_doc, trip_id, owner_id, 'cleanup-reject', 'cleanup-batch-reject', 1, 10,
  'reject.png', 'image/png', 10, 'quarantine/87000000-0000-4000-8000-000000000011', 'verifying',
  '87000000-0000-4000-8000-000000000021', timezone('utc', now()) + interval '5 minutes', 1, 2
from cleanup_ids;

set local role service_role;
select is(
  public.reject_document_verification(
    (select reject_doc from cleanup_ids), '87000000-0000-4000-8000-000000000021', 2, 'invalid', 'malware_detected'
  ),
  true,
  'lease owner may reject a claimed document'
);
set local role postgres;
select is(
  (select status from private.document_storage_cleanups where document_id = (select reject_doc from cleanup_ids)),
  'queued',
  'reject enqueues a queued cleanup row'
);

create temporary table cleanup_claim as
select * from private.claim_next_document_storage_cleanup('87000000-0000-4000-8000-000000000031', 60);
select is((select status from cleanup_claim), 'processing', 'worker claims the queued cleanup');
select is(
  private.complete_document_storage_cleanup((select id from cleanup_claim), '87000000-0000-4000-8000-000000000099'),
  false,
  'wrong lease cannot complete a claimed cleanup'
);
select is(
  (select status from private.document_storage_cleanups where id = (select id from cleanup_claim)),
  'processing',
  'failed complete leaves the processing lease intact'
);
select is(
  private.complete_document_storage_cleanup((select id from cleanup_claim), '87000000-0000-4000-8000-000000000031'),
  true,
  'lease owner completes cleanup'
);
select is(
  private.complete_document_storage_cleanup((select id from cleanup_claim), '87000000-0000-4000-8000-000000000031'),
  true,
  'complete is idempotent'
);
select is(
  (select status from private.document_storage_cleanups where id = (select id from cleanup_claim)),
  'succeeded',
  'completed cleanup remains succeeded'
);

insert into public.documents (
  id, trip_id, uploaded_by_user_id, upload_idempotency_key, upload_batch_key,
  upload_batch_file_count, upload_batch_total_bytes, original_file_name,
  reported_content_type, detected_content_type, byte_size, checksum, storage_object_key,
  status, uploaded_at, error_code
)
select invalid_doc, trip_id, owner_id, 'cleanup-invalid', 'cleanup-batch-invalid', 1, 10,
  'invalid.png', 'image/png', null::text, 10, null::text,
  'quarantine/87000000-0000-4000-8000-000000000012', 'invalid', null::timestamptz, 'invalid_file'
from cleanup_ids
union all
select unsupported_doc, trip_id, owner_id, 'cleanup-unsupported', 'cleanup-batch-unsupported', 1, 10,
  'unsupported.bin', 'application/octet-stream', null::text, 10, null::text,
  'quarantine/87000000-0000-4000-8000-000000000013', 'unsupported', null::timestamptz, 'unsupported_type'
from cleanup_ids
union all
select available_doc, trip_id, owner_id, 'cleanup-available', 'cleanup-batch-available', 1, 10,
  'available.png', 'image/png', 'image/png', 10, repeat('a', 64),
  'quarantine/87000000-0000-4000-8000-000000000014', 'available', timezone('utc', now()), null::text
from cleanup_ids
union all
select pending_doc, trip_id, owner_id, 'cleanup-pending', 'cleanup-batch-pending', 1, 10,
  'pending.png', 'image/png', null::text, 10, null::text,
  'quarantine/87000000-0000-4000-8000-000000000015', 'verification_pending', null::timestamptz, 'verification_unavailable'
from cleanup_ids;

select is(private.reconcile_rejected_document_storage(), 2, 'reconcile inserts missing rows for invalid and unsupported');
select is(
  (select count(*) from private.document_storage_cleanups
    where document_id in (select invalid_doc from cleanup_ids union all select unsupported_doc from cleanup_ids)
      and status = 'queued'),
  2::bigint,
  'reconcile queues rejected documents without a succeeded cleanup'
);
select is(
  (select count(*) from private.document_storage_cleanups
    where document_id in (select available_doc from cleanup_ids union all select pending_doc from cleanup_ids)),
  0::bigint,
  'reconcile never enqueues available or verification_pending documents'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select owner_id::text from cleanup_ids), 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
select throws_ok(
  $$select * from private.claim_next_document_storage_cleanup(gen_random_uuid(), 60)$$,
  '42501',
  'permission denied for function claim_next_document_storage_cleanup',
  'authenticated cannot execute private cleanup claim'
);
select throws_ok(
  $$select private.reconcile_rejected_document_storage()$$,
  '42501',
  'permission denied for function reconcile_rejected_document_storage',
  'authenticated cannot execute private cleanup reconcile'
);

set local role anon;
select set_config('request.jwt.claims', '{}', true);
select throws_ok(
  $$select * from private.claim_next_document_storage_cleanup(gen_random_uuid(), 60)$$,
  '42501',
  'permission denied for schema private',
  'anon cannot execute private cleanup claim'
);
select throws_ok(
  $$select private.complete_document_storage_cleanup(1, gen_random_uuid())$$,
  '42501',
  'permission denied for schema private',
  'anon cannot execute private cleanup complete'
);

reset role;
select lives_ok(
  $$select private.install_document_storage_cleanup_schedule()$$,
  'deployment can activate the cleanup schedule explicitly'
);
select is(
  (select schedule from cron.job where jobname = 'process-document-storage-cleanups-every-minute'),
  '* * * * *',
  'explicitly installed cleanup recovery runs every minute'
);

select * from finish();
rollback;
