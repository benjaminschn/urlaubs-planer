begin;
select plan(12);

create temporary table recover_ids (
  owner_id uuid,
  trip_id uuid,
  active_one uuid,
  active_two uuid,
  expired_retry uuid,
  expired_exhaust uuid
) on commit drop;

insert into recover_ids values (
  '86000000-0000-4000-8000-000000000101',
  '86000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000011',
  '86000000-0000-4000-8000-000000000012',
  '86000000-0000-4000-8000-000000000013',
  '86000000-0000-4000-8000-000000000014'
);

grant select on table recover_ids to authenticated, service_role;

set local role postgres;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
select owner_id, 'authenticated', 'authenticated', 'recover-user@example.test', 'test-only', timezone('utc', now())
from recover_ids
on conflict (id) do nothing;

insert into public.users (id, display_name)
select owner_id, 'Recover User' from recover_ids;

insert into public.trips (id, title, start_date, end_date, created_by_user_id, updated_by_user_id)
select trip_id, 'Recover trip', date '2026-09-01', date '2026-09-05', owner_id, owner_id from recover_ids;

insert into public.trip_members (trip_id, user_id, created_by_user_id)
select trip_id, owner_id, owner_id from recover_ids;

insert into public.documents (
  id, trip_id, uploaded_by_user_id, upload_idempotency_key, upload_batch_key,
  upload_batch_file_count, upload_batch_total_bytes, original_file_name,
  reported_content_type, byte_size, storage_object_key, status,
  verification_lease_owner, verification_lease_expires_at, verification_attempt_count
)
select active_one, trip_id, owner_id, 'recover-active-1', 'recover-batch-active', 2, 20,
  'active-one.png', 'image/png', 10, 'quarantine/86000000-0000-4000-8000-000000000011', 'verifying',
  '86000000-0000-4000-8000-000000000021'::uuid, timezone('utc', now()) + interval '5 minutes', 1
from recover_ids
union all
select active_two, trip_id, owner_id, 'recover-active-2', 'recover-batch-active', 2, 20,
  'active-two.png', 'image/png', 10, 'quarantine/86000000-0000-4000-8000-000000000012', 'verifying',
  '86000000-0000-4000-8000-000000000022'::uuid, timezone('utc', now()) + interval '5 minutes', 1
from recover_ids;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select owner_id::text from recover_ids), 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);

select throws_ok(
  $$select * from public.reserve_document_upload(
    (select trip_id from recover_ids), 'three.png', 'image/png', 10,
    'recover-3', 'recover-batch-3', 1, 10
  )$$,
  'P0001',
  '[parallel_limit] Zwei Uploads laufen bereits',
  'two verifying rows block reserve_document_upload with parallel_limit'
);

set local role postgres;
update public.documents
set verification_lease_expires_at = timezone('utc', now()) - interval '1 minute'
where id in (select active_one from recover_ids union all select active_two from recover_ids);

set local role service_role;
select is(public.reap_expired_document_verifications(), 2, 'reaper releases both expired verifying rows');
set local role postgres;
select is(
  (select count(*) from public.documents
    where id in (select active_one from recover_ids union all select active_two from recover_ids)
      and status = 'verification_pending'
      and error_code = 'verification_unavailable'),
  2::bigint,
  'reaped claims become retryable and no longer occupy verifying'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select owner_id::text from recover_ids), 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
select lives_ok(
  $$select public.reserve_document_upload(
    (select trip_id from recover_ids), 'three.png', 'image/png', 10,
    'recover-3', 'recover-batch-3', 1, 10
  )$$,
  'after reaper, reserve succeeds'
);

set local role postgres;
insert into public.documents (
  id, trip_id, uploaded_by_user_id, upload_idempotency_key, upload_batch_key,
  upload_batch_file_count, upload_batch_total_bytes, original_file_name,
  reported_content_type, byte_size, storage_object_key, status,
  verification_lease_owner, verification_lease_expires_at, verification_attempt_count
)
select expired_retry, trip_id, owner_id, 'recover-retry', 'recover-batch-retry', 1, 10,
  'retry.png', 'image/png', 10, 'quarantine/86000000-0000-4000-8000-000000000013', 'verifying',
  '86000000-0000-4000-8000-000000000023'::uuid, timezone('utc', now()) - interval '1 minute', 5
from recover_ids;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select owner_id::text from recover_ids), 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
select is(
  (select count(*) from public.claim_document_verification(
    (select expired_retry from recover_ids), '86000000-0000-4000-8000-000000000033', 60
  )),
  1::bigint,
  'expired verifying with remaining attempts is claimable without calling reaper'
);

set local role postgres;
update public.documents
set status = 'verification_pending',
    error_code = 'verification_unavailable',
    verification_lease_owner = null,
    verification_lease_expires_at = null
where id = (select expired_retry from recover_ids)
   or status = 'uploading';

insert into public.documents (
  id, trip_id, uploaded_by_user_id, upload_idempotency_key, upload_batch_key,
  upload_batch_file_count, upload_batch_total_bytes, original_file_name,
  reported_content_type, byte_size, storage_object_key, status,
  verification_lease_owner, verification_lease_expires_at, verification_attempt_count
)
select expired_exhaust, trip_id, owner_id, 'recover-exhaust', 'recover-batch-exhaust', 1, 10,
  'exhaust.png', 'image/png', 10, 'quarantine/86000000-0000-4000-8000-000000000014', 'verifying',
  '86000000-0000-4000-8000-000000000024'::uuid, timezone('utc', now()) - interval '1 minute', 20
from recover_ids;

set local role service_role;
select is(public.reap_expired_document_verifications(), 1, 'reaper terminates exhausted verifying');
set local role postgres;
select is((select status from public.documents where id = (select expired_exhaust from recover_ids)), 'invalid', 'exhausted verification becomes invalid');
select is(
  (select error_code from public.documents where id = (select expired_exhaust from recover_ids)),
  'verification_attempts_exhausted',
  'exhausted verification stores verification_attempts_exhausted'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select owner_id::text from recover_ids), 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
select is(
  (select count(*) from public.claim_document_verification(
    (select expired_exhaust from recover_ids), '86000000-0000-4000-8000-000000000034', 60
  )),
  0::bigint,
  'further claim after exhausted reaper returns 0'
);
select lives_ok(
  $$select public.reserve_document_upload(
    (select trip_id from recover_ids), 'four.png', 'image/png', 10,
    'recover-4', 'recover-batch-4', 1, 10
  )$$,
  'exhausted verification does not block reserve'
);

set local role postgres;
select ok(
  exists(
    select 1
    from cron.job
    where jobname = 'reap-expired-document-verifications-every-minute'
      and active
  ),
  'cron job reap-expired-document-verifications-every-minute exists and is active after migrations'
);
select is(
  (select schedule from cron.job where jobname = 'reap-expired-document-verifications-every-minute'),
  '* * * * *',
  'verification reaper runs every minute'
);

select * from finish();
rollback;
