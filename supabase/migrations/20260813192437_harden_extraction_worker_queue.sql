-- Extraction runs are the durable queue. The browser-facing function only
-- reserves a row; service-role workers claim due rows with SKIP LOCKED.

alter table public.extraction_runs
  add column if not exists available_at timestamptz not null default timezone('utc', now()),
  add column if not exists actual_cost_micro_eur bigint not null default 0
    check (actual_cost_micro_eur >= 0);

drop index if exists public.extraction_runs_status_lease_idx;
create index extraction_runs_queue_claim_idx
  on public.extraction_runs (available_at, created_at, id)
  where status = 'queued';
create index extraction_runs_expired_lease_idx
  on public.extraction_runs (lease_expires_at, id)
  where status = 'processing';

-- Accurate accounting must never be rolled back merely because a provider
-- response exceeded the configured reservation. Reservation checks still
-- prevent new work once the limit has been reached.
alter table private.extraction_budget_months
  drop constraint if exists extraction_budget_months_limit;

create table if not exists private.extraction_provider_charges (
  id bigint generated always as identity primary key,
  extraction_run_id uuid not null references public.extraction_runs (id) on delete restrict,
  provider_attempt_number integer not null check (provider_attempt_number between 1 and 3),
  provider_request_id text not null check (length(btrim(provider_request_id)) between 1 and 200),
  input_tokens bigint not null check (input_tokens >= 0),
  output_tokens bigint not null check (output_tokens >= 0),
  cost_micro_eur bigint not null check (cost_micro_eur >= 0),
  recorded_at timestamptz not null default timezone('utc', now()),
  unique (extraction_run_id, provider_attempt_number),
  unique (provider_request_id)
);

create index extraction_provider_charges_run_idx
  on private.extraction_provider_charges (extraction_run_id, recorded_at desc);

alter table private.extraction_provider_charges enable row level security;
alter table private.extraction_provider_charges force row level security;
revoke all on table private.extraction_provider_charges from public, anon, authenticated;
revoke all on sequence private.extraction_provider_charges_id_seq from public, anon, authenticated;

create or replace function private.release_extraction_reservation(p_run public.extraction_runs)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.extraction_budget_months
  set reserved_micro_eur = greatest(0, reserved_micro_eur - greatest(p_run.budget_reservation_micro_eur - p_run.actual_cost_micro_eur, 0)),
      updated_at = timezone('utc', now())
  where month_start = p_run.budget_month_start;
end;
$$;

create or replace function private.recover_expired_extraction_runs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.extraction_runs%rowtype;
  recovered_count integer := 0;
begin
  for run_row in
    select run.*
    from public.extraction_runs as run
    where run.status = 'processing'
      and run.lease_expires_at <= timezone('utc', now())
    order by run.lease_expires_at, run.id
    for update skip locked
  loop
    -- Runs claimed by the removed legacy per-request path have attempt zero.
    -- Preserve their old terminal expiry behavior; durable worker claims are
    -- numbered before any provider interaction and can be recovered safely.
    if run_row.provider_attempt_count = 0 then
      perform private.release_extraction_reservation(run_row);
      update public.extraction_runs
      set status = 'expired',
          lease_owner = null,
          lease_expires_at = null,
          completed_at = timezone('utc', now()),
          error_code = 'lease_expired',
          error_detail_safe = null,
          updated_at = timezone('utc', now())
      where id = run_row.id;
    elsif run_row.provider_attempt_count < 3 then
      update public.extraction_runs
      set status = 'queued',
          lease_owner = null,
          lease_expires_at = null,
          available_at = timezone('utc', now()),
          error_code = 'lease_expired_retrying',
          error_detail_safe = null,
          updated_at = timezone('utc', now())
      where id = run_row.id;
    else
      perform private.release_extraction_reservation(run_row);
      update public.extraction_runs
      set status = 'failed_retryable',
          lease_owner = null,
          lease_expires_at = null,
          completed_at = timezone('utc', now()),
          error_code = 'lease_expired',
          error_detail_safe = null,
          updated_at = timezone('utc', now())
      where id = run_row.id;
    end if;
    recovered_count := recovered_count + 1;
  end loop;
  return recovered_count;
end;
$$;

create or replace function private.claim_next_extraction_run(
  p_lease_owner uuid,
  p_lease_seconds integer default 120
)
returns setof public.extraction_runs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_owner is null or p_lease_seconds not between 30 and 135 then
    raise exception using errcode = 'P0001', message = '[invalid_worker_request] Ungültiger Worker-Aufruf';
  end if;

  perform private.recover_expired_extraction_runs();

  return query
  with next_run as (
    select run.id
    from public.extraction_runs as run
    where run.status = 'queued'
      and run.available_at <= timezone('utc', now())
      and run.provider_attempt_count < 3
    order by run.available_at, run.created_at, run.id
    for update skip locked
    limit 1
  )
  update public.extraction_runs as run
  set status = 'processing',
      provider_attempt_count = run.provider_attempt_count + 1,
      lease_owner = p_lease_owner,
      lease_expires_at = timezone('utc', now()) + pg_catalog.make_interval(secs => p_lease_seconds),
      started_at = coalesce(run.started_at, timezone('utc', now())),
      error_code = null,
      error_detail_safe = null,
      updated_at = timezone('utc', now())
  from next_run
  where run.id = next_run.id
  returning run.*;
end;
$$;

create or replace function private.record_extraction_provider_charge(
  p_run_id uuid,
  p_lease_owner uuid,
  p_provider_request_id text,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_cost_micro_eur bigint
)
returns public.extraction_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.extraction_runs%rowtype;
  inserted_cost bigint;
begin
  select * into run_row
  from public.extraction_runs as run
  where run.id = p_run_id
  for update;

  if not found or run_row.status <> 'processing' or run_row.lease_owner <> p_lease_owner
    or run_row.lease_expires_at <= timezone('utc', now())
    or p_provider_request_id is null or length(btrim(p_provider_request_id)) not between 1 and 200
    or coalesce(p_input_tokens, -1) < 0 or coalesce(p_output_tokens, -1) < 0
    or coalesce(p_cost_micro_eur, -1) < 0 then
    raise exception using errcode = 'P0001', message = '[invalid_provider_charge] Providerkosten konnten nicht verbucht werden';
  end if;

  insert into private.extraction_provider_charges (
    extraction_run_id, provider_attempt_number, provider_request_id,
    input_tokens, output_tokens, cost_micro_eur
  ) values (
    p_run_id, run_row.provider_attempt_count, btrim(p_provider_request_id),
    p_input_tokens, p_output_tokens, p_cost_micro_eur
  )
  on conflict (extraction_run_id, provider_attempt_number) do nothing
  returning cost_micro_eur into inserted_cost;

  if inserted_cost is not null then
    update private.extraction_budget_months
    set reserved_micro_eur = greatest(0, reserved_micro_eur - least(inserted_cost, greatest(run_row.budget_reservation_micro_eur - run_row.actual_cost_micro_eur, 0))),
        spent_micro_eur = spent_micro_eur + inserted_cost,
        updated_at = timezone('utc', now())
    where month_start = run_row.budget_month_start;

    update public.extraction_runs
    set actual_cost_micro_eur = actual_cost_micro_eur + inserted_cost,
        provider_request_id = btrim(p_provider_request_id),
        updated_at = timezone('utc', now())
    where id = p_run_id
    returning * into run_row;
  elsif not exists (
    select 1
    from private.extraction_provider_charges as charge
    where charge.extraction_run_id = p_run_id
      and charge.provider_attempt_number = run_row.provider_attempt_count
      and charge.provider_request_id = btrim(p_provider_request_id)
      and charge.input_tokens = p_input_tokens
      and charge.output_tokens = p_output_tokens
      and charge.cost_micro_eur = p_cost_micro_eur
  ) then
    raise exception using errcode = 'P0001', message = '[provider_charge_conflict] Providerkosten widersprechen dem bereits verbuchten Versuch';
  end if;

  return run_row;
end;
$$;

create or replace function private.retry_or_fail_extraction_run(
  p_run_id uuid,
  p_lease_owner uuid,
  p_error_code text,
  p_retryable boolean,
  p_retry_delay_seconds integer default 0
)
returns public.extraction_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.extraction_runs%rowtype;
begin
  select * into run_row
  from public.extraction_runs as run
  where run.id = p_run_id
  for update;
  if not found or run_row.status <> 'processing' or run_row.lease_owner <> p_lease_owner
    or run_row.lease_expires_at <= timezone('utc', now())
    or p_error_code is null or length(btrim(p_error_code)) not between 1 and 80
    or p_retry_delay_seconds not between 0 and 300 then
    raise exception using errcode = 'P0001', message = '[invalid_worker_transition] Verarbeitung konnte nicht aktualisiert werden';
  end if;

  if p_retryable and run_row.provider_attempt_count < 3 then
    update public.extraction_runs
    set status = 'queued',
        lease_owner = null,
        lease_expires_at = null,
        available_at = timezone('utc', now()) + pg_catalog.make_interval(secs => p_retry_delay_seconds),
        error_code = left(btrim(p_error_code), 80),
        error_detail_safe = null,
        updated_at = timezone('utc', now())
    where id = p_run_id
    returning * into run_row;
  else
    perform private.release_extraction_reservation(run_row);
    update public.extraction_runs
    set status = case when p_retryable then 'failed_retryable' else 'failed_terminal' end,
        lease_owner = null,
        lease_expires_at = null,
        completed_at = timezone('utc', now()),
        error_code = left(btrim(p_error_code), 80),
        error_detail_safe = null,
        updated_at = timezone('utc', now())
    where id = p_run_id
    returning * into run_row;
  end if;
  return run_row;
end;
$$;

create or replace function public.claim_next_extraction_run(p_lease_owner uuid, p_lease_seconds integer default 120)
returns setof public.extraction_runs
language sql
security definer
set search_path = ''
as $$ select * from private.claim_next_extraction_run(p_lease_owner, p_lease_seconds); $$;

create or replace function public.record_extraction_provider_charge(
  p_run_id uuid, p_lease_owner uuid, p_provider_request_id text,
  p_input_tokens bigint, p_output_tokens bigint, p_cost_micro_eur bigint
)
returns public.extraction_runs
language sql
security definer
set search_path = ''
as $$
  select private.record_extraction_provider_charge(
    p_run_id, p_lease_owner, p_provider_request_id,
    p_input_tokens, p_output_tokens, p_cost_micro_eur
  );
$$;

create or replace function public.retry_or_fail_extraction_run(
  p_run_id uuid, p_lease_owner uuid, p_error_code text,
  p_retryable boolean, p_retry_delay_seconds integer default 0
)
returns public.extraction_runs
language sql
security definer
set search_path = ''
as $$
  select private.retry_or_fail_extraction_run(
    p_run_id, p_lease_owner, p_error_code, p_retryable, p_retry_delay_seconds
  );
$$;

revoke all on function private.release_extraction_reservation(public.extraction_runs) from public, anon, authenticated, service_role;
revoke all on function private.recover_expired_extraction_runs() from public, anon, authenticated, service_role;
revoke all on function private.claim_next_extraction_run(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function private.record_extraction_provider_charge(uuid, uuid, text, bigint, bigint, bigint) from public, anon, authenticated, service_role;
revoke all on function private.retry_or_fail_extraction_run(uuid, uuid, text, boolean, integer) from public, anon, authenticated, service_role;
revoke all on function public.claim_next_extraction_run(uuid, integer) from public, anon, authenticated;
revoke all on function public.record_extraction_provider_charge(uuid, uuid, text, bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.retry_or_fail_extraction_run(uuid, uuid, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.claim_next_extraction_run(uuid, integer) to service_role;
grant execute on function public.record_extraction_provider_charge(uuid, uuid, text, bigint, bigint, bigint) to service_role;
grant execute on function public.retry_or_fail_extraction_run(uuid, uuid, text, boolean, integer) to service_role;

-- Existing completion/failure transitions now release only the unspent part of
-- a reservation. The worker records chargeable provider responses separately.
create or replace function private.complete_extraction_run(
  p_run_id uuid,
  p_requested_by_user_id uuid,
  p_lease_owner uuid,
  p_provider_request_id text,
  p_actual_cost_micro_eur bigint,
  p_provider_attempt_count integer,
  p_candidates jsonb,
  p_warnings jsonb
)
returns public.extraction_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.extraction_runs%rowtype;
  document_row public.documents%rowtype;
  candidate_payload jsonb;
  field_payload jsonb;
  warning_payload jsonb;
  candidate_row public.extraction_candidates%rowtype;
  warning_candidate_id uuid;
  direct_cost bigint := greatest(coalesce(p_actual_cost_micro_eur, 0), 0);
begin
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) > 12
    or jsonb_typeof(p_warnings) <> 'array' or jsonb_array_length(p_warnings) > 50 then
    raise exception using errcode = 'P0001', message = '[invalid_extraction_semantics] Verarbeitungsergebnis ist ungültig';
  end if;
  select * into run_row from public.extraction_runs as run where run.id = p_run_id for update;
  select * into document_row from public.documents as document where document.id = run_row.document_id;
  if not found or run_row.status <> 'processing' or run_row.requested_by_user_id <> p_requested_by_user_id
    or run_row.lease_owner <> p_lease_owner or run_row.lease_expires_at <= timezone('utc', now())
    or not private.is_active_member_as(document_row.trip_id, p_requested_by_user_id) then
    raise exception using errcode = 'P0001', message = '[forbidden] Verarbeitung ist nicht verfügbar';
  end if;

  for candidate_payload in select value from jsonb_array_elements(p_candidates) loop
    insert into public.extraction_candidates (extraction_run_id, candidate_index, proposed_event_type_code, overall_confidence)
    values (p_run_id, (candidate_payload ->> 'candidate_index')::integer, candidate_payload ->> 'proposed_event_type_code', nullif(candidate_payload ->> 'overall_confidence', '')::numeric)
    returning * into candidate_row;
    for field_payload in select value from jsonb_array_elements(candidate_payload -> 'fields') loop
      insert into public.candidate_fields (candidate_id, field_path, occurrence_key, original_value, provenance, confidence, source_document_id, source_locator)
      values (candidate_row.id, field_payload ->> 'field_path', coalesce(field_payload ->> 'occurrence_key', ''), field_payload -> 'original_value', field_payload ->> 'provenance', nullif(field_payload ->> 'confidence', '')::numeric, document_row.id, coalesce(field_payload -> 'source_locator', '[]'::jsonb));
    end loop;
  end loop;
  for warning_payload in select value from jsonb_array_elements(p_warnings) loop
    warning_candidate_id := null;
    select candidate.id into warning_candidate_id from public.extraction_candidates as candidate
    where candidate.extraction_run_id = p_run_id and candidate.candidate_index = nullif(warning_payload ->> 'event_index', '')::integer;
    insert into public.extraction_run_warnings (extraction_run_id, candidate_id, warning_code, severity, field_path, message, source_locator)
    values (p_run_id, warning_candidate_id, warning_payload ->> 'code', warning_payload ->> 'severity', nullif(warning_payload ->> 'field_path', ''), warning_payload ->> 'message', coalesce(warning_payload -> 'source_locator', '[]'::jsonb));
  end loop;

  update private.extraction_budget_months
  set reserved_micro_eur = greatest(0, reserved_micro_eur - greatest(run_row.budget_reservation_micro_eur - run_row.actual_cost_micro_eur, 0)),
      spent_micro_eur = spent_micro_eur + direct_cost,
      updated_at = timezone('utc', now())
  where month_start = run_row.budget_month_start;
  update public.extraction_runs
  set status = 'succeeded', provider_request_id = coalesce(nullif(p_provider_request_id, ''), provider_request_id),
      provider_attempt_count = greatest(provider_attempt_count, greatest(0, least(coalesce(p_provider_attempt_count, 0), 3))),
      actual_cost_micro_eur = actual_cost_micro_eur + direct_cost,
      lease_owner = null, lease_expires_at = null, completed_at = timezone('utc', now()),
      error_code = null, error_detail_safe = null, updated_at = timezone('utc', now())
  where id = p_run_id returning * into run_row;
  return run_row;
end;
$$;

create or replace function private.fail_extraction_run(
  p_run_id uuid,
  p_requested_by_user_id uuid,
  p_lease_owner uuid,
  p_error_code text,
  p_retryable boolean,
  p_provider_attempt_count integer,
  p_actual_cost_micro_eur bigint default 0
)
returns public.extraction_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.extraction_runs%rowtype;
  direct_cost bigint := greatest(coalesce(p_actual_cost_micro_eur, 0), 0);
begin
  select * into run_row from public.extraction_runs where id = p_run_id for update;
  if not found or run_row.status <> 'processing' or run_row.requested_by_user_id <> p_requested_by_user_id
    or run_row.lease_owner <> p_lease_owner or run_row.lease_expires_at <= timezone('utc', now()) then
    raise exception using errcode = 'P0001', message = '[forbidden] Verarbeitung ist nicht verfügbar';
  end if;
  update private.extraction_budget_months
  set reserved_micro_eur = greatest(0, reserved_micro_eur - greatest(run_row.budget_reservation_micro_eur - run_row.actual_cost_micro_eur, 0)),
      spent_micro_eur = spent_micro_eur + direct_cost,
      updated_at = timezone('utc', now())
  where month_start = run_row.budget_month_start;
  update public.extraction_runs
  set status = case when p_retryable then 'failed_retryable' else 'failed_terminal' end,
      provider_attempt_count = greatest(provider_attempt_count, greatest(0, least(coalesce(p_provider_attempt_count, 0), 3))),
      actual_cost_micro_eur = actual_cost_micro_eur + direct_cost,
      lease_owner = null, lease_expires_at = null, completed_at = timezone('utc', now()),
      error_code = left(coalesce(p_error_code, 'extraction_failed'), 80),
      error_detail_safe = null, updated_at = timezone('utc', now())
  where id = p_run_id returning * into run_row;
  return run_row;
end;
$$;

revoke all on function private.complete_extraction_run(uuid, uuid, uuid, text, bigint, integer, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.fail_extraction_run(uuid, uuid, uuid, text, boolean, integer, bigint) from public, anon, authenticated, service_role;

-- Supersede the original reservation routine so a new user request cannot
-- terminally expire work that the durable worker can still recover.
create or replace function private.reserve_extraction_run(
  p_document_id uuid,
  p_document_version bigint,
  p_requested_by_user_id uuid,
  p_idempotency_key text,
  p_model_identifier text,
  p_extraction_schema_version text,
  p_prompt_version text,
  p_candidate_adapter_version text,
  p_pricing_version text,
  p_budget_reservation_micro_eur bigint
)
returns public.extraction_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  document_row public.documents%rowtype;
  existing public.extraction_runs%rowtype;
  config private.extraction_runtime_config%rowtype;
  month_value date := date_trunc('month', timezone('utc', now()))::date;
  budget_row private.extraction_budget_months%rowtype;
  next_attempt integer;
  user_today_count integer;
  trip_today_count integer;
  active_user_count integer;
  active_global_count integer;
  result public.extraction_runs%rowtype;
begin
  if p_document_id is null
    or p_document_version is null
    or p_document_version <= 0
    or p_requested_by_user_id is null
    or p_idempotency_key is null
    or length(btrim(p_idempotency_key)) not between 1 and 200
    or p_model_identifier is null
    or length(btrim(p_model_identifier)) not between 1 and 120
    or p_extraction_schema_version <> '1.0.0'
    or p_prompt_version is null
    or length(btrim(p_prompt_version)) not between 1 and 80
    or p_candidate_adapter_version is null
    or length(btrim(p_candidate_adapter_version)) not between 1 and 80
    or p_pricing_version is null
    or length(btrim(p_pricing_version)) not between 1 and 80
    or p_budget_reservation_micro_eur is null
    or p_budget_reservation_micro_eur <= 0 then
    raise exception using errcode = 'P0001', message = '[invalid_extraction_request] Verarbeitung konnte nicht gestartet werden';
  end if;

  select * into document_row
  from public.documents as document
  where document.id = p_document_id
    and document.status = 'available';
  if not found or document_row.version <> p_document_version
    or not private.is_active_member_as(document_row.trip_id, p_requested_by_user_id) then
    raise exception using errcode = 'P0001', message = '[forbidden] Dokument ist nicht verfügbar';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('extract:' || p_document_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('extract:global', 0));

  perform private.recover_expired_extraction_runs();

  select * into existing
  from public.extraction_runs as run
  where run.document_id = p_document_id
    and run.requested_by_user_id = p_requested_by_user_id
    and run.idempotency_key = btrim(p_idempotency_key);
  if found then
    return existing;
  end if;

  select * into config from private.extraction_runtime_config where singleton;
  if not found or not config.provider_enabled then
    raise exception using errcode = 'P0001', message = '[extraction_disabled] Verarbeitung ist derzeit nicht verfügbar';
  end if;

  if exists (
    select 1 from public.extraction_runs as run
    where run.document_id = p_document_id and run.status in ('queued', 'processing')
  ) then
    raise exception using errcode = 'P0001', message = '[extraction_active] Dieses Dokument wird bereits verarbeitet';
  end if;

  select count(*) into user_today_count
  from public.extraction_runs as run
  where run.requested_by_user_id = p_requested_by_user_id
    and run.created_at >= date_trunc('day', timezone('utc', now()));
  select count(*) into trip_today_count
  from public.extraction_runs as run
  join public.documents as document on document.id = run.document_id
  where document.trip_id = document_row.trip_id
    and run.created_at >= date_trunc('day', timezone('utc', now()));
  if user_today_count >= 10 or trip_today_count >= 20 then
    raise exception using errcode = 'P0001', message = '[extraction_limit] Tageslimit für Verarbeitungen erreicht';
  end if;

  select count(*) into active_user_count
  from public.extraction_runs as run
  where run.requested_by_user_id = p_requested_by_user_id and run.status in ('queued', 'processing');
  select count(*) into active_global_count
  from public.extraction_runs as run
  where run.status in ('queued', 'processing');
  if active_user_count >= 1 or active_global_count >= 2 then
    raise exception using errcode = 'P0001', message = '[extraction_parallel_limit] Verarbeitungskapazität ist derzeit belegt';
  end if;

  insert into private.extraction_budget_months (month_start, limit_micro_eur)
  values (month_value, config.monthly_budget_micro_eur)
  on conflict (month_start) do nothing;
  select * into budget_row
  from private.extraction_budget_months
  where month_start = month_value
  for update;
  if budget_row.reserved_micro_eur + budget_row.spent_micro_eur + p_budget_reservation_micro_eur > budget_row.limit_micro_eur then
    raise exception using errcode = 'P0001', message = '[budget_exhausted] Das monatliche Verarbeitungsbudget ist erreicht';
  end if;

  select coalesce(max(run.attempt_number), 0) + 1 into next_attempt
  from public.extraction_runs as run
  where run.document_id = p_document_id;
  update private.extraction_budget_months
  set reserved_micro_eur = reserved_micro_eur + p_budget_reservation_micro_eur,
      updated_at = timezone('utc', now())
  where month_start = month_value;
  insert into public.extraction_runs (
    document_id, document_version, requested_by_user_id, idempotency_key, attempt_number, model_identifier,
    extraction_schema_version, prompt_version, candidate_adapter_version, pricing_version,
    budget_reservation_micro_eur, budget_month_start
  ) values (
    p_document_id, p_document_version, p_requested_by_user_id, btrim(p_idempotency_key), next_attempt, btrim(p_model_identifier),
    p_extraction_schema_version, btrim(p_prompt_version), btrim(p_candidate_adapter_version), btrim(p_pricing_version),
    p_budget_reservation_micro_eur, month_value
  ) returning * into result;
  return result;
end;
$$;
