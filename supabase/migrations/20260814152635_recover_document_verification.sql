-- Recover expired verification leases before they exhaust the two-upload
-- reservation. Exhausted attempts become a terminal invalid state that
-- prepare_document_upload_retry cannot reopen.

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
  set status = case
        when document.verification_attempt_count >= 20 then 'invalid'
        else 'verification_pending'
      end,
      error_code = case
        when document.verification_attempt_count >= 20 then 'verification_attempts_exhausted'
        else 'verification_unavailable'
      end,
      verification_lease_owner = null,
      verification_lease_expires_at = null,
      version = document.version + 1,
      updated_at = pg_catalog.timezone('utc', now())
  where (
      document.status = 'verifying'
      and document.verification_lease_expires_at < pg_catalog.timezone('utc', now())
    )
    or (
      document.status = 'verification_pending'
      and document.verification_attempt_count >= 20
    );
  get diagnostics changed = row_count;
  return changed;
end;
$$;

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
  perform public.reap_expired_document_verifications();
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
  perform public.reap_expired_document_verifications();
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

select cron.unschedule(jobid)
from cron.job
where jobname = 'reap-expired-document-verifications-every-minute';

select cron.schedule(
  'reap-expired-document-verifications-every-minute',
  '* * * * *',
  $$select public.reap_expired_document_verifications()$$
);
