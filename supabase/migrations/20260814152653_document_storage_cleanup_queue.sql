-- Persist rejected-blob deletion so a failed Storage remove cannot orphan a
-- quarantine object. The worker schedule is installed only after deploy.

create table if not exists private.document_storage_cleanups (
  id bigint generated always as identity primary key,
  document_id uuid not null unique references public.documents (id) on delete restrict,
  storage_object_key text not null,
  status text not null check (status in ('queued', 'processing', 'succeeded')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  available_at timestamptz not null default timezone('utc', now()),
  lease_owner uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint document_storage_cleanups_lease_fields_check check (
    (status = 'processing' and lease_owner is not null and lease_expires_at is not null)
    or
    (status <> 'processing' and lease_owner is null and lease_expires_at is null)
  )
);

create index document_storage_cleanups_queue_claim_idx
  on private.document_storage_cleanups (available_at, created_at, id)
  where status = 'queued';
create index document_storage_cleanups_expired_lease_idx
  on private.document_storage_cleanups (lease_expires_at, id)
  where status = 'processing';

alter table private.document_storage_cleanups enable row level security;
alter table private.document_storage_cleanups force row level security;
revoke all on table private.document_storage_cleanups from public, anon, authenticated;
revoke all on sequence private.document_storage_cleanups_id_seq from public, anon, authenticated;
grant usage on schema private to service_role;

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
  object_key text;
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
    and document.verification_lease_expires_at >= pg_catalog.timezone('utc', now())
  returning document.storage_object_key into object_key;
  get diagnostics changed = row_count;
  if changed = 1 then
    insert into private.document_storage_cleanups (document_id, storage_object_key, status)
    values (p_document_id, object_key, 'queued')
    on conflict (document_id) do nothing;
  end if;
  return changed = 1;
end;
$$;

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
  set status = 'queued',
      lease_owner = null,
      lease_expires_at = null,
      available_at = pg_catalog.timezone('utc', now()),
      last_error_code = coalesce(cleanup.last_error_code, 'lease_expired'),
      updated_at = pg_catalog.timezone('utc', now())
  where cleanup.status = 'processing'
    and cleanup.lease_expires_at < pg_catalog.timezone('utc', now());
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

create or replace function private.complete_document_storage_cleanup(
  p_id bigint,
  p_lease_owner uuid
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
  if p_id is null or p_lease_owner is null then
    return false;
  end if;

  select cleanup.* into cleanup_row
  from private.document_storage_cleanups as cleanup
  where cleanup.id = p_id
  for update;

  if not found then
    return false;
  end if;
  if cleanup_row.status = 'succeeded' then
    return true;
  end if;
  if cleanup_row.status <> 'processing'
    or cleanup_row.lease_owner <> p_lease_owner
    or cleanup_row.lease_expires_at < pg_catalog.timezone('utc', now()) then
    return false;
  end if;

  update private.document_storage_cleanups
  set status = 'succeeded',
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = null,
      updated_at = pg_catalog.timezone('utc', now())
  where id = p_id;
  get diagnostics changed = row_count;
  return changed = 1;
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

  update private.document_storage_cleanups
  set status = 'queued',
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = left(btrim(p_error_code), 80),
      available_at = pg_catalog.timezone('utc', now()) + pg_catalog.make_interval(secs => p_retry_delay_seconds),
      updated_at = pg_catalog.timezone('utc', now())
  where id = p_id;
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
  where document.status in ('unsupported', 'invalid')
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

create or replace function private.complete_document_storage_cleanup_for_document(
  p_document_id uuid
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
  if p_document_id is null then
    return false;
  end if;

  select cleanup.* into cleanup_row
  from private.document_storage_cleanups as cleanup
  where cleanup.document_id = p_document_id
  for update;

  if not found then
    return false;
  end if;
  if cleanup_row.status = 'succeeded' then
    return true;
  end if;
  if cleanup_row.status not in ('queued', 'processing') then
    return false;
  end if;

  update private.document_storage_cleanups
  set status = 'succeeded',
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = null,
      updated_at = pg_catalog.timezone('utc', now())
  where document_id = p_document_id
    and status in ('queued', 'processing');
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.claim_next_document_storage_cleanup(
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
language sql
security invoker
set search_path = ''
as $$
  select cleanup.id, cleanup.document_id, cleanup.storage_object_key,
    cleanup.status, cleanup.attempt_count, cleanup.lease_owner
  from private.claim_next_document_storage_cleanup(p_lease_owner, p_lease_seconds) as cleanup;
$$;

create or replace function public.complete_document_storage_cleanup(
  p_id bigint,
  p_lease_owner uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.complete_document_storage_cleanup(p_id, p_lease_owner);
$$;

create or replace function public.retry_document_storage_cleanup(
  p_id bigint,
  p_lease_owner uuid,
  p_error_code text,
  p_retry_delay_seconds integer
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.retry_document_storage_cleanup(p_id, p_lease_owner, p_error_code, p_retry_delay_seconds);
$$;

create or replace function public.reconcile_rejected_document_storage()
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.reconcile_rejected_document_storage();
$$;

create or replace function public.complete_document_storage_cleanup_for_document(
  p_document_id uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.complete_document_storage_cleanup_for_document(p_document_id);
$$;

revoke all on function private.recover_expired_document_storage_cleanups() from public, anon, authenticated;
revoke all on function private.claim_next_document_storage_cleanup(uuid, integer) from public, anon, authenticated;
revoke all on function private.complete_document_storage_cleanup(bigint, uuid) from public, anon, authenticated;
revoke all on function private.retry_document_storage_cleanup(bigint, uuid, text, integer) from public, anon, authenticated;
revoke all on function private.reconcile_rejected_document_storage() from public, anon, authenticated;
revoke all on function private.complete_document_storage_cleanup_for_document(uuid) from public, anon, authenticated;
grant execute on function private.recover_expired_document_storage_cleanups() to service_role;
grant execute on function private.claim_next_document_storage_cleanup(uuid, integer) to service_role;
grant execute on function private.complete_document_storage_cleanup(bigint, uuid) to service_role;
grant execute on function private.retry_document_storage_cleanup(bigint, uuid, text, integer) to service_role;
grant execute on function private.reconcile_rejected_document_storage() to service_role;
grant execute on function private.complete_document_storage_cleanup_for_document(uuid) to service_role;

revoke all on function public.claim_next_document_storage_cleanup(uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_document_storage_cleanup(bigint, uuid) from public, anon, authenticated;
revoke all on function public.retry_document_storage_cleanup(bigint, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.reconcile_rejected_document_storage() from public, anon, authenticated;
revoke all on function public.complete_document_storage_cleanup_for_document(uuid) from public, anon, authenticated;
grant execute on function public.claim_next_document_storage_cleanup(uuid, integer) to service_role;
grant execute on function public.complete_document_storage_cleanup(bigint, uuid) to service_role;
grant execute on function public.retry_document_storage_cleanup(bigint, uuid, text, integer) to service_role;
grant execute on function public.reconcile_rejected_document_storage() to service_role;
grant execute on function public.complete_document_storage_cleanup_for_document(uuid) to service_role;

create or replace function private.install_document_storage_cleanup_schedule()
returns bigint
language plpgsql
security definer
set search_path = ''
as $migration$
declare existing_job_id bigint; new_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = 'process-document-storage-cleanups-every-minute';
  if existing_job_id is not null then perform cron.unschedule(existing_job_id); end if;
  select cron.schedule(
    'process-document-storage-cleanups-every-minute',
    '* * * * *',
    $cron$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'extraction_project_url'
          limit 1
        ) || '/functions/v1/process-document-storage-cleanups',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Extraction-Worker-Token', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'extraction_worker_token'
            limit 1
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 90000
      ) as request_id;
    $cron$
  ) into new_job_id;
  return new_job_id;
end
$migration$;

-- Applying this migration must not activate HTTP cron. Deploy installs later.
select cron.unschedule(jobid) from cron.job where jobname = 'process-document-storage-cleanups-every-minute';

revoke all on function private.install_document_storage_cleanup_schedule() from public, anon, authenticated, service_role;
