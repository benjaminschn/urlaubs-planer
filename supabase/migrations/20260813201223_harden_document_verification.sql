-- Fence document verification so only a claimed lease may publish or delete an
-- uploaded object. Scanner outages remain quarantined but no longer exhaust the
-- concurrent-upload reservation limit.

alter table public.documents
  add column verification_lease_owner uuid,
  add column verification_lease_expires_at timestamptz,
  add column verification_attempt_count integer not null default 0;

drop index if exists public.documents_active_uploads_idx;
create index documents_active_uploads_idx
  on public.documents (trip_id, uploaded_by_user_id, status)
  where status in ('uploading', 'verifying');

create or replace function public.reserve_document_upload(
  p_trip_id uuid,
  p_original_file_name text,
  p_reported_content_type text,
  p_byte_size bigint,
  p_upload_idempotency_key text,
  p_batch_key text,
  p_batch_file_count integer,
  p_batch_total_bytes bigint
)
returns table (
  id uuid, trip_id uuid, uploaded_by_user_id uuid, original_file_name text,
  reported_content_type text, detected_content_type text, byte_size bigint,
  checksum text, storage_object_key text, status text, error_code text,
  version bigint, created_at timestamptz, updated_at timestamptz, uploaded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  existing public.documents%rowtype;
  total_document_count bigint;
  active_upload_count bigint;
  batch_document_count bigint;
  batch_byte_sum bigint;
  document_id uuid;
  object_key text;
begin
  if actor_id is null or not private.is_active_trip_member(p_trip_id) then return; end if;
  if p_original_file_name is null or length(btrim(p_original_file_name)) not between 1 and 255
    or p_upload_idempotency_key is null or length(btrim(p_upload_idempotency_key)) not between 1 and 200
    or p_batch_key is null or length(btrim(p_batch_key)) not between 1 and 200 then
    raise exception using errcode = 'P0001', message = '[invalid_file] Ungültige Upload-Metadaten';
  end if;
  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > 20971520 then raise exception using errcode = 'P0001', message = '[file_too_large] Datei ist zu groß'; end if;
  if p_batch_file_count is null or p_batch_file_count not between 1 and 5 then raise exception using errcode = 'P0001', message = '[selection_too_many] Zu viele Dateien'; end if;
  if p_batch_total_bytes is null or p_batch_total_bytes <= 0 or p_batch_total_bytes > 52428800 then raise exception using errcode = 'P0001', message = '[selection_too_large] Auswahl ist zu groß'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_trip_id::text || ':' || actor_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_trip_id::text || ':' || actor_id::text || ':' || p_batch_key, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_trip_id::text || ':' || actor_id::text || ':' || p_upload_idempotency_key, 0));
  select document.* into existing from public.documents document where document.trip_id = p_trip_id and document.uploaded_by_user_id = actor_id and document.upload_idempotency_key = p_upload_idempotency_key;
  if found then
    return query select existing.id, existing.trip_id, existing.uploaded_by_user_id, existing.original_file_name, existing.reported_content_type, existing.detected_content_type, existing.byte_size, existing.checksum, existing.storage_object_key, existing.status, existing.error_code, existing.version, existing.created_at, existing.updated_at, existing.uploaded_at;
    return;
  end if;
  select count(*) into total_document_count from public.documents document where document.trip_id = p_trip_id and document.status <> 'deleted';
  if total_document_count >= 50 then raise exception using errcode = 'P0001', message = '[document_limit] Dokumentgrenze erreicht'; end if;
  select count(*) into active_upload_count from public.documents document where document.trip_id = p_trip_id and document.uploaded_by_user_id = actor_id and document.status in ('uploading', 'verifying');
  if active_upload_count >= 2 then raise exception using errcode = 'P0001', message = '[parallel_limit] Zwei Uploads laufen bereits'; end if;
  select count(*), coalesce(sum(document.byte_size), 0) into batch_document_count, batch_byte_sum from public.documents document where document.trip_id = p_trip_id and document.uploaded_by_user_id = actor_id and document.upload_batch_key = p_batch_key and document.status <> 'deleted';
  if batch_document_count >= p_batch_file_count then raise exception using errcode = 'P0001', message = '[selection_too_many] Auswahl wurde bereits reserviert'; end if;
  if batch_byte_sum + p_byte_size > p_batch_total_bytes or batch_byte_sum + p_byte_size > 52428800 then raise exception using errcode = 'P0001', message = '[selection_too_large] Auswahl ist zu groß'; end if;
  document_id := gen_random_uuid(); object_key := 'quarantine/' || document_id::text;
  return query insert into public.documents (id, trip_id, uploaded_by_user_id, upload_idempotency_key, upload_batch_key, upload_batch_file_count, upload_batch_total_bytes, original_file_name, reported_content_type, byte_size, storage_object_key)
    values (document_id, p_trip_id, actor_id, btrim(p_upload_idempotency_key), btrim(p_batch_key), p_batch_file_count, p_batch_total_bytes, btrim(p_original_file_name), nullif(btrim(p_reported_content_type), ''), p_byte_size, object_key)
    returning documents.id, documents.trip_id, documents.uploaded_by_user_id, documents.original_file_name, documents.reported_content_type, documents.detected_content_type, documents.byte_size, documents.checksum, documents.storage_object_key, documents.status, documents.error_code, documents.version, documents.created_at, documents.updated_at, documents.uploaded_at;
end;
$$;

alter table public.documents
  drop constraint documents_status_check,
  add constraint documents_status_check check (
    status in ('uploading', 'uploaded', 'verifying', 'verification_pending', 'available', 'upload_failed', 'unsupported', 'invalid', 'deleted')
  ),
  add constraint documents_verification_attempt_count_check check (
    verification_attempt_count between 0 and 20
  ),
  add constraint documents_verification_lease_fields_check check (
    (status = 'verifying' and verification_lease_owner is not null and verification_lease_expires_at is not null)
    or
    (status <> 'verifying' and verification_lease_owner is null and verification_lease_expires_at is null)
  );

create index documents_verification_retry_idx
  on public.documents (status, updated_at)
  where status in ('verifying', 'verification_pending');

create or replace function public.claim_document_verification(
  p_document_id uuid,
  p_lease_owner uuid,
  p_lease_seconds integer default 60
)
returns table (
  id uuid,
  trip_id uuid,
  uploaded_by_user_id uuid,
  original_file_name text,
  reported_content_type text,
  byte_size bigint,
  storage_object_key text,
  version bigint,
  verification_lease_owner uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or p_document_id is null or p_lease_owner is null or p_lease_seconds not between 30 and 300 then
    return;
  end if;

  return query
  update public.documents as document
  set status = 'verifying',
      error_code = null,
      verification_lease_owner = p_lease_owner,
      verification_lease_expires_at = pg_catalog.timezone('utc', now()) + pg_catalog.make_interval(secs => p_lease_seconds),
      verification_attempt_count = document.verification_attempt_count + 1,
      version = document.version + 1,
      updated_at = pg_catalog.timezone('utc', now())
  where document.id = p_document_id
    and document.uploaded_by_user_id = actor_id
    and private.is_active_trip_member(document.trip_id)
    and (
      document.status in ('uploading', 'uploaded', 'verification_pending')
      or (
        document.status = 'verifying'
        and document.verification_lease_expires_at < pg_catalog.timezone('utc', now())
      )
    )
    and document.verification_attempt_count < 20
  returning document.id, document.trip_id, document.uploaded_by_user_id,
    document.original_file_name, document.reported_content_type, document.byte_size,
    document.storage_object_key, document.version, document.verification_lease_owner;
end;
$$;

create or replace function public.defer_document_verification(
  p_document_id uuid,
  p_lease_owner uuid,
  p_expected_version bigint,
  p_detected_content_type text,
  p_byte_size bigint,
  p_checksum text,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if p_error_code <> 'verification_unavailable'
    or (p_checksum is not null and p_checksum !~ '^[0-9a-f]{64}$')
    or (p_byte_size is not null and p_byte_size not between 1 and 20971520) then
    return false;
  end if;
  update public.documents as document
  set status = 'verification_pending',
      detected_content_type = coalesce(p_detected_content_type, document.detected_content_type),
      byte_size = coalesce(p_byte_size, document.byte_size),
      checksum = coalesce(p_checksum, document.checksum),
      error_code = p_error_code,
      verification_lease_owner = null,
      verification_lease_expires_at = null,
      version = document.version + 1,
      updated_at = pg_catalog.timezone('utc', now())
  where document.id = p_document_id
    and document.status = 'verifying'
    and document.verification_lease_owner = p_lease_owner
    and document.version = p_expected_version
    and document.verification_lease_expires_at >= pg_catalog.timezone('utc', now());
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.reject_document_verification(
  p_document_id uuid,
  p_lease_owner uuid,
  p_expected_version bigint,
  p_status text,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if p_status not in ('unsupported', 'invalid')
    or p_error_code is null then
    return false;
  end if;
  update public.documents as document
  set status = p_status,
      error_code = p_error_code,
      verification_lease_owner = null,
      verification_lease_expires_at = null,
      version = document.version + 1,
      updated_at = pg_catalog.timezone('utc', now())
  where document.id = p_document_id
    and document.status = 'verifying'
    and document.verification_lease_owner = p_lease_owner
    and document.version = p_expected_version
    and document.verification_lease_expires_at >= pg_catalog.timezone('utc', now());
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.publish_document_verification(
  p_document_id uuid,
  p_lease_owner uuid,
  p_expected_version bigint,
  p_detected_content_type text,
  p_byte_size bigint,
  p_checksum text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if p_checksum !~ '^[0-9a-f]{64}$'
    or p_detected_content_type is null
    or p_byte_size not between 1 and 20971520 then
    return false;
  end if;
  update public.documents as document
  set status = 'available',
      detected_content_type = p_detected_content_type,
      byte_size = p_byte_size,
      checksum = p_checksum,
      uploaded_at = pg_catalog.timezone('utc', now()),
      error_code = null,
      verification_lease_owner = null,
      verification_lease_expires_at = null,
      version = document.version + 1,
      updated_at = pg_catalog.timezone('utc', now())
  where document.id = p_document_id
    and document.status = 'verifying'
    and document.verification_lease_owner = p_lease_owner
    and document.version = p_expected_version
    and document.verification_lease_expires_at >= pg_catalog.timezone('utc', now());
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.reap_expired_document_verifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.documents as document
  set status = 'verification_pending',
      error_code = 'verification_unavailable',
      verification_lease_owner = null,
      verification_lease_expires_at = null,
      version = document.version + 1,
      updated_at = pg_catalog.timezone('utc', now())
  where document.status = 'verifying'
    and document.verification_lease_expires_at < pg_catalog.timezone('utc', now());
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.claim_document_verification(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_document_verification(uuid, uuid, integer) to authenticated;
revoke all on function public.defer_document_verification(uuid, uuid, bigint, text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.reject_document_verification(uuid, uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.publish_document_verification(uuid, uuid, bigint, text, bigint, text) from public, anon, authenticated;
revoke all on function public.reap_expired_document_verifications() from public, anon, authenticated;
grant execute on function public.defer_document_verification(uuid, uuid, bigint, text, bigint, text, text) to service_role;
grant execute on function public.reject_document_verification(uuid, uuid, bigint, text, text) to service_role;
grant execute on function public.publish_document_verification(uuid, uuid, bigint, text, bigint, text) to service_role;
grant execute on function public.reap_expired_document_verifications() to service_role;
