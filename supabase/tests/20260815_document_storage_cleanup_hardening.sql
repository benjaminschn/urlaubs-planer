begin;
select plan(45);

select has_table('private', 'document_storage_cleanups', 'the durable cleanup queue remains private');
select ok(
  position('failed' in (
    select pg_get_constraintdef(oid)
    from pg_catalog.pg_constraint
    where conrelid = 'private.document_storage_cleanups'::pg_catalog.regclass
      and conname = 'document_storage_cleanups_status_check'
  )) > 0,
  'cleanup queue accepts the explicit terminal failed state'
);
select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where grantee = 'authenticated'
      and grantor = 'postgres'
      and table_schema = 'storage'
      and table_name = 'objects'
      and privilege_type = 'DELETE'
  ),
  'the application migration does not grant authenticated DELETE on storage.objects'
);
select is(
  (select count(*)::integer
   from pg_catalog.pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and policyname = 'documents_storage_delete_failed_upload'),
  0,
  'the browser delete policy is removed'
);

create temporary table cleanup_hardening_ids (
  owner_id uuid,
  trip_id uuid,
  mark_doc uuid,
  legacy_doc uuid,
  terminal_doc uuid,
  exhausted_doc uuid,
  expired_doc uuid,
  recover_doc uuid,
  failed_legacy_doc uuid
) on commit drop;

insert into cleanup_hardening_ids values (
  '88000000-0000-4000-8000-000000000101',
  '88000000-0000-4000-8000-000000000001',
  '88000000-0000-4000-8000-000000000011',
  '88000000-0000-4000-8000-000000000012',
  '88000000-0000-4000-8000-000000000013',
  '88000000-0000-4000-8000-000000000014',
  '88000000-0000-4000-8000-000000000015',
  '88000000-0000-4000-8000-000000000016',
  '88000000-0000-4000-8000-000000000017'
);

grant select on table cleanup_hardening_ids to authenticated, service_role;

set local role postgres;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
select owner_id, 'authenticated', 'authenticated', 'cleanup-hardening@example.test', 'test-only', timezone('utc', now())
from cleanup_hardening_ids
on conflict (id) do nothing;

insert into public.users (id, display_name)
select owner_id, 'Cleanup Hardening User' from cleanup_hardening_ids
on conflict (id) do nothing;

insert into public.trips (id, title, start_date, end_date, created_by_user_id, updated_by_user_id)
select trip_id, 'Cleanup hardening trip', date '2026-09-01', date '2026-09-05', owner_id, owner_id
from cleanup_hardening_ids
on conflict (id) do nothing;

insert into public.trip_members (trip_id, user_id, created_by_user_id)
select trip_id, owner_id, owner_id from cleanup_hardening_ids
on conflict (trip_id, user_id) do nothing;

insert into public.documents (
  id, trip_id, uploaded_by_user_id, upload_idempotency_key, upload_batch_key,
  upload_batch_file_count, upload_batch_total_bytes, original_file_name,
  reported_content_type, byte_size, storage_object_key, status, error_code
)
select mark_doc, trip_id, owner_id, 'hardening-mark', 'hardening-batch-mark', 1, 10,
  'mark.png', 'image/png', 10, 'quarantine/88000000-0000-4000-8000-000000000011', 'uploading', null
from cleanup_hardening_ids
union all
select legacy_doc, trip_id, owner_id, 'hardening-legacy', 'hardening-batch-legacy', 1, 10,
  'legacy.png', 'image/png', 10, 'quarantine/88000000-0000-4000-8000-000000000012', 'upload_failed', 'upload_failed'
from cleanup_hardening_ids
union all
select terminal_doc, trip_id, owner_id, 'hardening-terminal', 'hardening-batch-terminal', 1, 10,
  'terminal.png', 'image/png', 10, 'quarantine/88000000-0000-4000-8000-000000000013', 'uploading', null
from cleanup_hardening_ids
union all
select exhausted_doc, trip_id, owner_id, 'hardening-exhausted', 'hardening-batch-exhausted', 1, 10,
  'exhausted.png', 'image/png', 10, 'quarantine/88000000-0000-4000-8000-000000000014', 'upload_failed', 'upload_failed'
from cleanup_hardening_ids
union all
select expired_doc, trip_id, owner_id, 'hardening-expired', 'hardening-batch-expired', 1, 10,
  'expired.png', 'image/png', 10, 'quarantine/88000000-0000-4000-8000-000000000015', 'upload_failed', 'upload_failed'
from cleanup_hardening_ids
union all
select recover_doc, trip_id, owner_id, 'hardening-recover', 'hardening-batch-recover', 1, 10,
  'recover.png', 'image/png', 10, 'quarantine/88000000-0000-4000-8000-000000000016', 'upload_failed', 'upload_failed'
from cleanup_hardening_ids
union all
select failed_legacy_doc, trip_id, owner_id, 'hardening-failed-legacy', 'hardening-batch-failed-legacy', 1, 10,
  'failed-legacy.png', 'image/png', 10, 'quarantine/88000000-0000-4000-8000-000000000017', 'upload_failed', 'upload_failed'
from cleanup_hardening_ids;

insert into private.document_storage_cleanups (
  document_id, storage_object_key, status, attempt_count, available_at,
  lease_owner, lease_expires_at, last_error_code
)
select terminal_doc, 'quarantine/88000000-0000-4000-8000-000000000013', 'failed', 7,
  timezone('utc', now()), null::uuid, null::timestamptz, 'cleanup_attempts_exhausted'
from cleanup_hardening_ids
union all
select exhausted_doc, 'quarantine/88000000-0000-4000-8000-000000000014', 'queued', 19,
  timezone('utc', now()) + interval '1 hour', null::uuid, null::timestamptz, null
from cleanup_hardening_ids
union all
select expired_doc, 'quarantine/88000000-0000-4000-8000-000000000015', 'processing', 20,
  timezone('utc', now()), '88000000-0000-4000-8000-000000000021', timezone('utc', now()) + interval '1 hour', 'storage_unavailable'
from cleanup_hardening_ids
union all
select recover_doc, 'quarantine/88000000-0000-4000-8000-000000000016', 'processing', 1,
  timezone('utc', now()), '88000000-0000-4000-8000-000000000022', timezone('utc', now()) + interval '1 hour', null
from cleanup_hardening_ids
union all
select failed_legacy_doc, 'quarantine/88000000-0000-4000-8000-000000000017', 'failed', 20,
  timezone('utc', now()), null::uuid, null::timestamptz, 'cleanup_attempts_exhausted'
from cleanup_hardening_ids;

set local role postgres;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select owner_id::text from cleanup_hardening_ids), 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);

select is(
  (select count(*)::integer
   from public.mark_document_upload_failed((select mark_doc from cleanup_hardening_ids), 1, 'upload_failed')),
  1,
  'marking an upload failure returns the updated document'
);
select is(
  (select status from public.documents where id = (select mark_doc from cleanup_hardening_ids)),
  'upload_failed',
  'the upload failure and queue enqueue share one transaction'
);
select is(
  (select status from private.document_storage_cleanups where document_id = (select mark_doc from cleanup_hardening_ids)),
  'queued',
  'marking an upload failure atomically queues cleanup'
);
select is(
  (select storage_object_key from private.document_storage_cleanups where document_id = (select mark_doc from cleanup_hardening_ids)),
  (select storage_object_key from public.documents where id = (select mark_doc from cleanup_hardening_ids)),
  'the cleanup row is bound to the document object key'
);
select is(
  (select count(*)::integer from public.prepare_document_upload_retry((select mark_doc from cleanup_hardening_ids), 2)),
  0,
  'retry is gated until the worker reports cleanup success'
);
select is(
  (select status from public.documents where id = (select mark_doc from cleanup_hardening_ids)),
  'upload_failed',
  'a gated retry leaves the failed upload state unchanged'
);

set local role postgres;
create temporary table mark_claim as
select *
from private.claim_next_document_storage_cleanup('88000000-0000-4000-8000-000000000031', 60)
where document_id = (select mark_doc from cleanup_hardening_ids);
select is((select status from mark_claim), 'processing', 'worker claims the upload-failure cleanup');
select is((select attempt_count from mark_claim), 1, 'the first cleanup claim records attempt one');
select is(
  private.complete_document_storage_cleanup((select id from mark_claim), '88000000-0000-4000-8000-000000000031'),
  true,
  'worker completion marks the cleanup succeeded'
);
select is(
  (select status from private.document_storage_cleanups where document_id = (select mark_doc from cleanup_hardening_ids)),
  'succeeded',
  'a completed cleanup is durable'
);

set local role postgres;
select is(
  (select count(*)::integer from public.prepare_document_upload_retry((select mark_doc from cleanup_hardening_ids), 2)),
  1,
  'retry opens only after the matching cleanup succeeds'
);
select is(
  (select status from public.documents where id = (select mark_doc from cleanup_hardening_ids)),
  'uploading',
  'a permitted retry returns to uploading'
);

select is(
  (select count(*)::integer
   from public.mark_document_upload_failed((select mark_doc from cleanup_hardening_ids), 3, 'upload_failed')),
  1,
  'a subsequent failed retry is recorded'
);
select is(
  (select status from private.document_storage_cleanups where document_id = (select mark_doc from cleanup_hardening_ids)),
  'queued',
  'a succeeded cleanup is re-armed for the later failed retry'
);
select is(
  (select attempt_count from private.document_storage_cleanups where document_id = (select mark_doc from cleanup_hardening_ids)),
  0,
  're-arming resets the cleanup attempt count'
);
select ok(
  (select lease_owner is null and lease_expires_at is null and last_error_code is null
   from private.document_storage_cleanups where document_id = (select mark_doc from cleanup_hardening_ids)),
  're-arming clears the prior cleanup lease and error'
);

select is(
  (select count(*)::integer
   from public.mark_document_upload_failed((select terminal_doc from cleanup_hardening_ids), 1, 'upload_failed')),
  1,
  'a later upload failure can still be recorded for a terminal cleanup'
);
select is(
  (select status from private.document_storage_cleanups where document_id = (select terminal_doc from cleanup_hardening_ids)),
  'failed',
  'a terminal cleanup is never silently revived'
);
select is(
  (select attempt_count from private.document_storage_cleanups where document_id = (select terminal_doc from cleanup_hardening_ids)),
  7,
  'a terminal cleanup preserves its attempt history'
);
select is(
  (select last_error_code from private.document_storage_cleanups where document_id = (select terminal_doc from cleanup_hardening_ids)),
  'cleanup_attempts_exhausted',
  'a terminal cleanup preserves its diagnostic error'
);

update private.document_storage_cleanups
set available_at = timezone('utc', now()) + interval '1 hour'
where document_id = (select mark_doc from cleanup_hardening_ids);

set local role postgres;
select is(private.reconcile_rejected_document_storage(), 1, 'reconcile discovers a legacy upload_failed document');
select is(
  (select status from private.document_storage_cleanups where document_id = (select legacy_doc from cleanup_hardening_ids)),
  'queued',
  'legacy upload_failed rows become queued cleanup work'
);
select is(
  (select status from private.document_storage_cleanups where document_id = (select failed_legacy_doc from cleanup_hardening_ids)),
  'failed',
  'reconcile does not revive a terminal legacy cleanup'
);
select is(private.reconcile_rejected_document_storage(), 0, 'reconcile is idempotent for existing cleanup rows');

set local role postgres;
select is(
  (select count(*)::integer from public.prepare_document_upload_retry((select legacy_doc from cleanup_hardening_ids), 1)),
  0,
  'a reconciled but not-yet-cleaned legacy upload remains gated'
);

set local role postgres;
create temporary table legacy_claim as
select *
from private.claim_next_document_storage_cleanup('88000000-0000-4000-8000-000000000032', 60)
where document_id = (select legacy_doc from cleanup_hardening_ids);
select is((select status from legacy_claim), 'processing', 'worker claims reconciled legacy cleanup');
select is(
  private.complete_document_storage_cleanup((select id from legacy_claim), '88000000-0000-4000-8000-000000000032'),
  true,
  'worker completes reconciled legacy cleanup'
);

set local role postgres;
select is(
  (select count(*)::integer from public.prepare_document_upload_retry((select legacy_doc from cleanup_hardening_ids), 1)),
  1,
  'legacy retry opens after cleanup completion'
);
select is(
  (select status from public.documents where id = (select legacy_doc from cleanup_hardening_ids)),
  'uploading',
  'legacy retry returns to uploading only after cleanup'
);

set local role postgres;
update private.document_storage_cleanups
set lease_expires_at = timezone('utc', now()) - interval '1 minute'
where document_id in (
  (select expired_doc from cleanup_hardening_ids),
  (select recover_doc from cleanup_hardening_ids)
);
select is(private.recover_expired_document_storage_cleanups(), 2, 'expired cleanup leases are recovered once');
select is(
  (select status from private.document_storage_cleanups where document_id = (select expired_doc from cleanup_hardening_ids)),
  'failed',
  'an expired lease at the attempt ceiling becomes terminal failed'
);
select is(
  (select status from private.document_storage_cleanups where document_id = (select recover_doc from cleanup_hardening_ids)),
  'queued',
  'an expired lease below the ceiling returns to queued'
);

set local role postgres;
update private.document_storage_cleanups
set available_at = timezone('utc', now()) + interval '1 hour'
where document_id in (
  (select mark_doc from cleanup_hardening_ids),
  (select recover_doc from cleanup_hardening_ids)
);
update private.document_storage_cleanups
set available_at = timezone('utc', now())
where document_id = (select exhausted_doc from cleanup_hardening_ids);

set local role postgres;
create temporary table exhausted_claim as
select *
from private.claim_next_document_storage_cleanup('88000000-0000-4000-8000-000000000033', 60)
where document_id = (select exhausted_doc from cleanup_hardening_ids);
select is((select status from exhausted_claim), 'processing', 'the final allowed cleanup attempt is claimed');
select is((select attempt_count from exhausted_claim), 20, 'the attempt ceiling is recorded at twenty');
select is(
  private.retry_document_storage_cleanup(
    (select id from exhausted_claim),
    '88000000-0000-4000-8000-000000000033',
    'storage_unavailable',
    60
  ),
  true,
  'a failed final attempt transitions deterministically'
);
select is(
  (select status from private.document_storage_cleanups where document_id = (select exhausted_doc from cleanup_hardening_ids)),
  'failed',
  'cleanup exhaustion is an explicit terminal state'
);
select ok(
  (select lease_owner is null and lease_expires_at is null
   from private.document_storage_cleanups where document_id = (select exhausted_doc from cleanup_hardening_ids)),
  'terminal cleanup releases its worker lease'
);
select is(
  (select count(*)::integer from private.claim_next_document_storage_cleanup('88000000-0000-4000-8000-000000000034', 60)),
  0,
  'terminal cleanup rows are never auto-revived'
);

set local role authenticated;
select throws_ok(
  $$select * from private.claim_next_document_storage_cleanup(gen_random_uuid(), 60)$$,
  '42501',
  'permission denied for function claim_next_document_storage_cleanup',
  'authenticated cannot execute the private cleanup claim'
);
select throws_ok(
  $$select * from public.claim_next_document_storage_cleanup(gen_random_uuid(), 60)$$,
  '42501',
  'permission denied for function claim_next_document_storage_cleanup',
  'authenticated cannot execute the worker-only public wrapper'
);
select throws_ok(
  $$select * from private.document_storage_cleanups$$,
  '42501',
  'permission denied for table document_storage_cleanups',
  'authenticated cannot read the private cleanup queue'
);

select * from finish();
rollback;
