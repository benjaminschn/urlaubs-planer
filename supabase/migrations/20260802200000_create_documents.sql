-- Roadmap-Schnitt 4: private Originaldokumente.
-- Originale werden zunächst im privaten Quarantänepfad gespeichert. Erst die
-- serverseitige Verify-Function darf den Status auf available setzen.

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete restrict,
  uploaded_by_user_id uuid not null references public.users (id) on delete restrict,
  upload_idempotency_key text not null,
  upload_batch_key text not null,
  upload_batch_file_count integer not null check (upload_batch_file_count between 1 and 5),
  upload_batch_total_bytes bigint not null check (upload_batch_total_bytes > 0 and upload_batch_total_bytes <= 52428800),
  original_file_name text not null,
  reported_content_type text,
  detected_content_type text,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 20971520),
  checksum text,
  storage_object_key text not null,
  status text not null default 'uploading'
    check (status in ('uploading', 'uploaded', 'available', 'upload_failed', 'unsupported', 'invalid', 'deleted')),
  error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  uploaded_at timestamptz,
  version bigint not null default 1 check (version > 0),
  constraint documents_original_file_name_not_blank check (length(btrim(original_file_name)) between 1 and 255),
  constraint documents_upload_key_not_blank check (length(btrim(upload_idempotency_key)) between 1 and 200),
  constraint documents_batch_key_not_blank check (length(btrim(upload_batch_key)) between 1 and 200),
  constraint documents_storage_object_key_format check (storage_object_key ~ '^quarantine/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint documents_checksum_format check (checksum is null or checksum ~ '^[0-9a-f]{64}$'),
  constraint documents_available_fields check (
    (status = 'available' and checksum is not null and detected_content_type is not null and uploaded_at is not null)
    or status <> 'available'
  ),
  constraint documents_deleted_fields check (
    (status = 'deleted' and uploaded_at is not null)
    or status <> 'deleted'
  )
);

create unique index if not exists documents_upload_idempotency_idx
  on public.documents (trip_id, uploaded_by_user_id, upload_idempotency_key);
create unique index if not exists documents_storage_object_key_idx
  on public.documents (storage_object_key);
create index if not exists documents_trip_status_created_idx
  on public.documents (trip_id, status, created_at desc);
create index if not exists documents_uploaded_by_user_idx
  on public.documents (uploaded_by_user_id);
create index if not exists documents_batch_idx
  on public.documents (trip_id, uploaded_by_user_id, upload_batch_key, status);
create index if not exists documents_active_uploads_idx
  on public.documents (trip_id, uploaded_by_user_id, status)
  where status in ('uploading', 'uploaded');

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
  existing public.documents%rowtype;
  batch_document_count bigint;
  batch_byte_sum bigint;
  active_upload_count bigint;
  total_document_count bigint;
  document_id uuid;
  object_key text;
begin
  if actor_id is null or not private.is_active_trip_member(p_trip_id) then
    return;
  end if;

  if p_original_file_name is null or length(btrim(p_original_file_name)) not between 1 and 255 then
    raise exception using errcode = 'P0001', message = '[invalid_file] Dateiname ist ungültig';
  end if;
  if p_upload_idempotency_key is null or length(btrim(p_upload_idempotency_key)) not between 1 and 200 then
    raise exception using errcode = 'P0001', message = '[invalid_file] Idempotenzschlüssel ist ungültig';
  end if;
  if p_batch_key is null or length(btrim(p_batch_key)) not between 1 and 200 then
    raise exception using errcode = 'P0001', message = '[invalid_file] Auswahlkennung ist ungültig';
  end if;
  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > 20971520 then
    raise exception using errcode = 'P0001', message = '[file_too_large] Original ist zu groß';
  end if;
  if p_batch_file_count is null or p_batch_file_count < 1 or p_batch_file_count > 5 then
    raise exception using errcode = 'P0001', message = '[selection_too_many] Auswahl ist zu groß';
  end if;
  if p_batch_total_bytes is null or p_batch_total_bytes <= 0 or p_batch_total_bytes > 52428800 then
    raise exception using errcode = 'P0001', message = '[selection_too_large] Auswahl ist zu groß';
  end if;

  -- Serialize member-wide, batch-wide and idempotency-wide reservations so
  -- the limits remain correct under concurrent browser requests.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_trip_id::text || ':' || actor_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_trip_id::text || ':' || actor_id::text || ':' || p_batch_key, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_trip_id::text || ':' || actor_id::text || ':' || p_upload_idempotency_key, 0)
  );

  select document.* into existing
  from public.documents as document
  where document.trip_id = p_trip_id
    and document.uploaded_by_user_id = actor_id
    and document.upload_idempotency_key = p_upload_idempotency_key;
  if found then
    return query select existing.id, existing.trip_id, existing.uploaded_by_user_id,
      existing.original_file_name, existing.reported_content_type, existing.detected_content_type,
      existing.byte_size, existing.checksum, existing.storage_object_key, existing.status,
      existing.error_code, existing.version, existing.created_at, existing.updated_at, existing.uploaded_at;
    return;
  end if;

  select count(*) into total_document_count
  from public.documents as document
  where document.trip_id = p_trip_id and document.status <> 'deleted';
  if total_document_count >= 50 then
    raise exception using errcode = 'P0001', message = '[document_limit] Dokumentgrenze erreicht';
  end if;

  select count(*) into active_upload_count
  from public.documents as document
  where document.trip_id = p_trip_id
    and document.uploaded_by_user_id = actor_id
    and document.status in ('uploading', 'uploaded');
  if active_upload_count >= 2 then
    raise exception using errcode = 'P0001', message = '[parallel_limit] Zwei Uploads laufen bereits';
  end if;

  select count(*), coalesce(sum(document.byte_size), 0)
    into batch_document_count, batch_byte_sum
  from public.documents as document
  where document.trip_id = p_trip_id
    and document.uploaded_by_user_id = actor_id
    and document.upload_batch_key = p_batch_key
    and document.status <> 'deleted';
  if batch_document_count >= p_batch_file_count then
    raise exception using errcode = 'P0001', message = '[selection_too_many] Auswahl wurde bereits reserviert';
  end if;
  if batch_byte_sum + p_byte_size > p_batch_total_bytes or batch_byte_sum + p_byte_size > 52428800 then
    raise exception using errcode = 'P0001', message = '[selection_too_large] Auswahl ist zu groß';
  end if;

  document_id := gen_random_uuid();
  object_key := 'quarantine/' || document_id::text;
  return query
  insert into public.documents (
    id, trip_id, uploaded_by_user_id, upload_idempotency_key, upload_batch_key,
    upload_batch_file_count, upload_batch_total_bytes, original_file_name,
    reported_content_type, byte_size, storage_object_key
  ) values (
    document_id, p_trip_id, actor_id, btrim(p_upload_idempotency_key), btrim(p_batch_key),
    p_batch_file_count, p_batch_total_bytes, btrim(p_original_file_name),
    nullif(btrim(p_reported_content_type), ''), p_byte_size, object_key
  )
  returning documents.id, documents.trip_id, documents.uploaded_by_user_id,
    documents.original_file_name, documents.reported_content_type, documents.detected_content_type,
    documents.byte_size, documents.checksum, documents.storage_object_key, documents.status,
    documents.error_code, documents.version, documents.created_at, documents.updated_at, documents.uploaded_at;
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
begin
  if actor_id is null or p_expected_version is null or p_error_code not in ('upload_failed', 'verification_unavailable') then
    return;
  end if;
  return query
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
    document.error_code, document.version, document.created_at, document.updated_at, document.uploaded_at;
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
  returning document.id, document.trip_id, document.uploaded_by_user_id,
    document.original_file_name, document.reported_content_type, document.detected_content_type,
    document.byte_size, document.checksum, document.storage_object_key, document.status,
    document.error_code, document.version, document.created_at, document.updated_at, document.uploaded_at;
end;
$$;

alter table public.documents enable row level security;
alter table public.documents force row level security;

drop policy if exists documents_select_member on public.documents;
create policy documents_select_member
on public.documents
for select
to authenticated
using (
  private.is_active_trip_member(trip_id)
  and (
    status = 'available'
    or uploaded_by_user_id = (select auth.uid())
  )
);

revoke all on table public.documents from anon, authenticated;
grant select (
  id, trip_id, uploaded_by_user_id, original_file_name, reported_content_type,
  detected_content_type, byte_size, checksum, storage_object_key, status,
  error_code, version, created_at, updated_at, uploaded_at
) on table public.documents to authenticated;
revoke all on function public.reserve_document_upload(uuid, text, text, bigint, text, text, integer, bigint) from public, anon, authenticated;
grant execute on function public.reserve_document_upload(uuid, text, text, bigint, text, text, integer, bigint) to authenticated;
revoke all on function public.mark_document_upload_failed(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.mark_document_upload_failed(uuid, bigint, text) to authenticated;
revoke all on function public.prepare_document_upload_retry(uuid, bigint) from public, anon, authenticated;
grant execute on function public.prepare_document_upload_retry(uuid, bigint) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('travel-documents', 'travel-documents', false, 20971520, null)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = null;

revoke all on table storage.objects from anon, authenticated;
grant select, insert, delete on table storage.objects to authenticated;

drop policy if exists documents_storage_insert_quarantine on storage.objects;
create policy documents_storage_insert_quarantine
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'travel-documents'
  and name ~ '^quarantine/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1
    from public.documents as document
    where document.storage_object_key = name
      and document.status in ('uploading', 'uploaded')
      and document.uploaded_by_user_id = (select auth.uid())
      and private.is_active_trip_member(document.trip_id)
  )
);

drop policy if exists documents_storage_select_available on storage.objects;
create policy documents_storage_select_available
on storage.objects
for select
to authenticated
using (
  bucket_id = 'travel-documents'
  and exists (
    select 1
    from public.documents as document
    where document.storage_object_key = name
      and document.status = 'available'
      and private.is_active_trip_member(document.trip_id)
  )
);

drop policy if exists documents_storage_delete_failed_upload on storage.objects;
create policy documents_storage_delete_failed_upload
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'travel-documents'
  and exists (
    select 1
    from public.documents as document
    where document.storage_object_key = name
      and document.status = 'upload_failed'
      and document.uploaded_by_user_id = (select auth.uid())
      and private.is_active_trip_member(document.trip_id)
  )
);

alter table public.documents replica identity full;
alter publication supabase_realtime add table public.documents;
