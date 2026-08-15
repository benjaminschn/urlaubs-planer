-- Harden the durable quarantine-object cleanup path. Upload failures must be
-- queued in the same database transaction as the document state transition;
-- retries may only begin after the worker has completed that cleanup.

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'private.document_storage_cleanups'::pg_catalog.regclass
      and conname = 'document_storage_cleanups_status_check'
  ) then
    alter table private.document_storage_cleanups
      drop constraint document_storage_cleanups_status_check;
  end if;
  alter table private.document_storage_cleanups
    add constraint document_storage_cleanups_status_check
    check (status in ('queued', 'processing', 'succeeded', 'failed'));
end
$$;

-- Rows which had already reached the attempt ceiling before this migration
-- become terminal immediately. A later reconciliation must never revive them.
update private.document_storage_cleanups
set status = 'failed',
    lease_owner = null,
    lease_expires_at = null,
    available_at = pg_catalog.timezone('utc', now()),
    last_error_code = coalesce(last_error_code, 'cleanup_attempts_exhausted'),
    updated_at = pg_catalog.timezone('utc', now())
where attempt_count >= 20
  and status in ('queued', 'processing');

create or replace function private.recover_expired_document_storage_cleanups()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update private.document_storage_cleanups as cleanup
  set status = case
        when cleanup.attempt_count >= 20 then 'failed'
        else 'queued'
      end,
      lease_owner = null,
      lease_expires_at = null,
      available_at = pg_catalog.timezone('utc', now()),
      last_error_code = case
        when cleanup.attempt_count >= 20
          then coalesce(cleanup.last_error_code, 'cleanup_attempts_exhausted')
        else coalesce(cleanup.last_error_code, 'lease_expired')
      end,
      updated_at = pg_catalog.timezone('utc', now())
  where (
      cleanup.status = 'processing'
      and cleanup.lease_expires_at < pg_catalog.timezone('utc', now())
    )
    or (
      cleanup.status = 'queued'
      and cleanup.attempt_count >= 20
    );
  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function private.claim_next_document_storage_cleanup(
  p_lease_owner uuid,
  p_lease_seconds integer default 60
)
returns table (
  id bigint,
  document_id uuid,
  storage_object_key text,
  status text,
  attempt_count integer,
  lease_owner uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_owner is null or p_lease_seconds not between 30 and 300 then
    return;
  end if;

  perform private.recover_expired_document_storage_cleanups();

  return query
  with next_cleanup as (
    select cleanup.id
    from private.document_storage_cleanups as cleanup
    where cleanup.status = 'queued'
      and cleanup.available_at <= pg_catalog.timezone('utc', now())
      and cleanup.attempt_count < 20
    order by cleanup.available_at, cleanup.created_at, cleanup.id
    for update skip locked
    limit 1
  )
  update private.document_storage_cleanups as cleanup
  set status = 'processing',
      attempt_count = cleanup.attempt_count + 1,
      lease_owner = p_lease_owner,
      lease_expires_at = pg_catalog.timezone('utc', now()) + pg_catalog.make_interval(secs => p_lease_seconds),
      last_error_code = null,
      updated_at = pg_catalog.timezone('utc', now())
  from next_cleanup
  where cleanup.id = next_cleanup.id
  returning cleanup.id, cleanup.document_id, cleanup.storage_object_key,
    cleanup.status, cleanup.attempt_count, cleanup.lease_owner;
end;
$$;

create or replace function private.retry_document_storage_cleanup(
  p_id bigint,
  p_lease_owner uuid,
  p_error_code text,
  p_retry_delay_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleanup_row private.document_storage_cleanups%rowtype;
  changed integer;
begin
  if p_id is null or p_lease_owner is null
    or p_error_code is null or length(btrim(p_error_code)) not between 1 and 80
    or p_retry_delay_seconds is null or p_retry_delay_seconds not between 0 and 300 then
    return false;
  end if;

  select cleanup.* into cleanup_row
  from private.document_storage_cleanups as cleanup
  where cleanup.id = p_id
  for update;

  if not found
    or cleanup_row.status <> 'processing'
    or cleanup_row.lease_owner <> p_lease_owner
    or cleanup_row.lease_expires_at < pg_catalog.timezone('utc', now()) then
    return false;
  end if;

  update private.document_storage_cleanups as cleanup
  set status = case
        when cleanup_row.attempt_count >= 20 then 'failed'
        else 'queued'
      end,
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = left(btrim(p_error_code), 80),
      available_at = pg_catalog.timezone('utc', now()) + pg_catalog.make_interval(secs => p_retry_delay_seconds),
      updated_at = pg_catalog.timezone('utc', now())
  where cleanup.id = p_id;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function private.reconcile_rejected_document_storage()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  insert into private.document_storage_cleanups (document_id, storage_object_key, status)
  select document.id, document.storage_object_key, 'queued'
  from public.documents as document
  where document.status in ('unsupported', 'invalid', 'upload_failed')
    and not exists (
      select 1
      from private.document_storage_cleanups as cleanup
      where cleanup.document_id = document.id
        and cleanup.status = 'succeeded'
    )
  on conflict (document_id) do nothing;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function public.mark_document_upload_failed(
  p_document_id uuid,
  p_expected_version bigint,
  p_error_code text
)
returns table (
  id uuid,
  trip_id uuid,
  uploaded_by_user_id uuid,
  original_file_name text,
  reported_content_type text,
  detected_content_type text,
  byte_size bigint,
  checksum text,
  storage_object_key text,
  status text,
  error_code text,
  version bigint,
  created_at timestamptz,
  updated_at timestamptz,
  uploaded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  changed integer;
begin
  if actor_id is null or p_expected_version is null or p_error_code is null
    or p_error_code not in ('upload_failed', 'verification_unavailable') then
    return;
  end if;

  update public.documents as document
  set status = 'upload_failed',
      error_code = p_error_code,
      updated_at = pg_catalog.timezone('utc', now()),
      version = document.version + 1
  where document.id = p_document_id
    and document.uploaded_by_user_id = actor_id
    and document.status in ('uploading', 'uploaded')
    and document.version = p_expected_version
    and private.is_active_trip_member(document.trip_id)
  returning document.id, document.trip_id, document.uploaded_by_user_id,
    document.original_file_name, document.reported_content_type, document.detected_content_type,
    document.byte_size, document.checksum, document.storage_object_key, document.status,
    document.error_code, document.version, document.created_at, document.updated_at, document.uploaded_at
  into id, trip_id, uploaded_by_user_id, original_file_name, reported_content_type,
    detected_content_type, byte_size, checksum, storage_object_key, status,
    error_code, version, created_at, updated_at, uploaded_at;
  get diagnostics changed = row_count;

  if changed <> 1 then
    return;
  end if;

  -- A successful cleanup is re-armed for the next failed upload attempt. A
  -- terminal failure is intentionally preserved and cannot be auto-revived.
  insert into private.document_storage_cleanups as cleanup (
    document_id, storage_object_key, status, attempt_count, available_at,
    lease_owner, lease_expires_at, last_error_code
  ) values (
    id, storage_object_key, 'queued', 0, pg_catalog.timezone('utc', now()),
    null, null, null
  )
  on conflict (document_id) do update
  set storage_object_key = excluded.storage_object_key,
      status = case
        when cleanup.status = 'succeeded' then 'queued'
        when cleanup.status = 'failed' then 'failed'
        else cleanup.status
      end,
      attempt_count = case
        when cleanup.status = 'succeeded' then 0
        else cleanup.attempt_count
      end,
      available_at = case
        when cleanup.status = 'succeeded' then pg_catalog.timezone('utc', now())
        else cleanup.available_at
      end,
      lease_owner = case
        when cleanup.status = 'succeeded' then null
        else cleanup.lease_owner
      end,
      lease_expires_at = case
        when cleanup.status = 'succeeded' then null
        else cleanup.lease_expires_at
      end,
      last_error_code = case
        when cleanup.status = 'succeeded' then null
        else cleanup.last_error_code
      end,
      updated_at = pg_catalog.timezone('utc', now());

  return next;
end;
$$;

create or replace function public.prepare_document_upload_retry(
  p_document_id uuid,
  p_expected_version bigint
)
returns table (
  id uuid,
  trip_id uuid,
  uploaded_by_user_id uuid,
  original_file_name text,
  reported_content_type text,
  detected_content_type text,
  byte_size bigint,
  checksum text,
  storage_object_key text,
  status text,
  error_code text,
  version bigint,
  created_at timestamptz,
  updated_at timestamptz,
  uploaded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or p_expected_version is null then
    return;
  end if;
  return query
  update public.documents as document
  set status = 'uploading',
      error_code = null,
      updated_at = pg_catalog.timezone('utc', now()),
      version = document.version + 1
  where document.id = p_document_id
    and document.uploaded_by_user_id = actor_id
    and document.status = 'upload_failed'
    and document.version = p_expected_version
    and private.is_active_trip_member(document.trip_id)
    and exists (
      select 1
      from private.document_storage_cleanups as cleanup
      where cleanup.document_id = document.id
        and cleanup.storage_object_key = document.storage_object_key
        and cleanup.status = 'succeeded'
    )
  returning document.id, document.trip_id, document.uploaded_by_user_id,
    document.original_file_name, document.reported_content_type, document.detected_content_type,
    document.byte_size, document.checksum, document.storage_object_key, document.status,
    document.error_code, document.version, document.created_at, document.updated_at, document.uploaded_at;
end;
$$;

-- Browser uploads no longer need to delete quarantine objects. Only the
-- service-role cleanup worker may remove them after this migration.
drop policy if exists documents_storage_delete_failed_upload on storage.objects;
revoke delete on table storage.objects from public, anon, authenticated;

revoke all on function private.recover_expired_document_storage_cleanups() from public, anon, authenticated;
revoke all on function private.claim_next_document_storage_cleanup(uuid, integer) from public, anon, authenticated;
revoke all on function private.retry_document_storage_cleanup(bigint, uuid, text, integer) from public, anon, authenticated;
grant execute on function private.recover_expired_document_storage_cleanups() to service_role;
grant execute on function private.claim_next_document_storage_cleanup(uuid, integer) to service_role;
grant execute on function private.retry_document_storage_cleanup(bigint, uuid, text, integer) to service_role;

revoke all on function public.mark_document_upload_failed(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.mark_document_upload_failed(uuid, bigint, text) to authenticated;
revoke all on function public.prepare_document_upload_retry(uuid, bigint) from public, anon, authenticated;
grant execute on function public.prepare_document_upload_retry(uuid, bigint) to authenticated;
