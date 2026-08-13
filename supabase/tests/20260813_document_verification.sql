begin;
select plan(18);

create temporary table verify_ids (
  owner_id uuid,
  member_id uuid,
  outsider_id uuid,
  trip_id uuid,
  document_one uuid,
  document_two uuid,
  document_deny uuid
) on commit drop;

insert into verify_ids values (
  '85000000-0000-4000-8000-000000000101',
  '85000000-0000-4000-8000-000000000102',
  '85000000-0000-4000-8000-000000000103',
  '85000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000011',
  '85000000-0000-4000-8000-000000000012',
  '85000000-0000-4000-8000-000000000013'
);

grant select on table verify_ids to authenticated, service_role;

set local role postgres;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
select user_id, 'authenticated', 'authenticated', email, 'test-only', timezone('utc', now())
from (
  select owner_id as user_id, 'verify-user@example.test' as email from verify_ids
  union all select member_id, 'verify-member@example.test' from verify_ids
  union all select outsider_id, 'verify-outsider@example.test' from verify_ids
) fixture
on conflict (id) do nothing;

insert into public.users (id, display_name)
select owner_id, 'Verify User' from verify_ids
union all select member_id, 'Verify Member' from verify_ids
union all select outsider_id, 'Verify Outsider' from verify_ids;

insert into public.trips (id, title, start_date, end_date, created_by_user_id, updated_by_user_id)
select trip_id, 'Verify trip', date '2026-09-01', date '2026-09-05', owner_id, owner_id from verify_ids;

insert into public.trip_members (trip_id, user_id, created_by_user_id)
select trip_id, owner_id, owner_id from verify_ids
union all select trip_id, member_id, owner_id from verify_ids;

insert into public.documents (
  id, trip_id, uploaded_by_user_id, upload_idempotency_key, upload_batch_key,
  upload_batch_file_count, upload_batch_total_bytes, original_file_name,
  reported_content_type, byte_size, storage_object_key, status
)
select document_one, trip_id, owner_id, 'verify-1', 'verify-batch', 2, 20,
  'one.png', 'image/png', 10, 'quarantine/85000000-0000-4000-8000-000000000011', 'uploaded'
from verify_ids
union all
select document_two, trip_id, owner_id, 'verify-2', 'verify-batch', 2, 20,
  'two.png', 'image/png', 10, 'quarantine/85000000-0000-4000-8000-000000000012', 'uploaded'
from verify_ids
union all
select document_deny, trip_id, owner_id, 'verify-deny', 'verify-batch-deny', 1, 10,
  'deny.png', 'image/png', 10, 'quarantine/85000000-0000-4000-8000-000000000013', 'uploaded'
from verify_ids;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select owner_id::text from verify_ids), 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);

select is(
  (select count(*) from public.claim_document_verification(
    (select document_one from verify_ids), '85000000-0000-4000-8000-000000000021', 60
  )),
  1::bigint,
  'owner claims verification once'
);
select is((select status from public.documents where id = (select document_one from verify_ids)), 'verifying', 'claim enters verifying');
select is(
  (select count(*) from public.claim_document_verification(
    (select document_one from verify_ids), '85000000-0000-4000-8000-000000000022', 60
  )),
  0::bigint,
  'second verifier cannot claim active lease'
);

set local role service_role;
select is(
  public.publish_document_verification(
    (select document_one from verify_ids), '85000000-0000-4000-8000-000000000022', 2, 'image/png', 10, repeat('a', 64)
  ),
  false,
  'wrong lease owner cannot publish'
);
select is(
  public.reject_document_verification(
    (select document_one from verify_ids), '85000000-0000-4000-8000-000000000022', 2, 'invalid', 'malware_detected'
  ),
  false,
  'wrong lease owner cannot reject'
);
select is(
  public.defer_document_verification(
    (select document_one from verify_ids), '85000000-0000-4000-8000-000000000021', 2, 'image/png', 10, repeat('a', 64), 'verification_unavailable'
  ),
  true,
  'lease owner may defer scanner outage'
);
set local role postgres;
select is((select status from public.documents where id = (select document_one from verify_ids)), 'verification_pending', 'scanner outage enters retryable quarantine');
select is((select verification_lease_owner from public.documents where id = (select document_one from verify_ids)), null::uuid, 'defer releases lease');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select owner_id::text from verify_ids), 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
select is(
  (select count(*) from public.claim_document_verification(
    (select document_one from verify_ids), '85000000-0000-4000-8000-000000000023', 60
  )),
  1::bigint,
  'owner explicitly retries pending verification'
);

set local role service_role;
select is(
  public.publish_document_verification(
    (select document_one from verify_ids), '85000000-0000-4000-8000-000000000023', 4, 'image/png', 10, repeat('b', 64)
  ),
  true,
  'retry lease owner publishes'
);
set local role postgres;
select is((select status from public.documents where id = (select document_one from verify_ids)), 'available', 'publish makes document available');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select owner_id::text from verify_ids), 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
select lives_ok($$
  select public.reserve_document_upload(
    (select trip_id from verify_ids), 'three.png', 'image/png', 10,
    'verify-3', 'verify-batch-2', 1, 10
  )
$$, 'verification_pending rows do not exhaust upload concurrency');

set local role postgres;
update public.documents
set status = 'verifying',
    verification_lease_owner = '85000000-0000-4000-8000-000000000024',
    verification_lease_expires_at = timezone('utc', now()) - interval '1 minute'
where id = (select document_two from verify_ids);

set local role service_role;
select is(public.reap_expired_document_verifications(), 1, 'reaper releases expired claims');
set local role postgres;
select is((select status from public.documents where id = (select document_two from verify_ids)), 'verification_pending', 'reaped claim becomes retryable');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select owner_id::text from verify_ids), 'role', 'authenticated', 'aal', 'aal1')::text,
  true
);
select is(
  (select count(*) from public.claim_document_verification(
    (select document_deny from verify_ids), '85000000-0000-4000-8000-000000000031', 60
  )),
  0::bigint,
  'AAL1 authenticated member cannot claim verification'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select outsider_id::text from verify_ids), 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
select is(
  (select count(*) from public.claim_document_verification(
    (select document_deny from verify_ids), '85000000-0000-4000-8000-000000000032', 60
  )),
  0::bigint,
  'authenticated non-member cannot claim a known document'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select member_id::text from verify_ids), 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
select is(
  (select count(*) from public.claim_document_verification(
    (select document_deny from verify_ids), '85000000-0000-4000-8000-000000000033', 60
  )),
  0::bigint,
  'second trip member who did not upload cannot claim'
);

set local role anon;
select set_config('request.jwt.claims', '{}', true);
select throws_ok(
  $$select * from public.claim_document_verification(
    '85000000-0000-4000-8000-000000000013', '85000000-0000-4000-8000-000000000034', 60
  )$$,
  '42501',
  'permission denied for function claim_document_verification',
  'anon cannot execute claim_document_verification'
);

select * from finish();
rollback;
