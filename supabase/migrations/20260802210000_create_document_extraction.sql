-- Roadmap-Schnitt 5: kontrollierte Dokumentextraktion (nach Dokument-Upload).
-- Alle Schreibvorgänge laufen ausschließlich über die authentifizierte Edge
-- Function. Browserrollen können nur ihren kanonischen Run-/Candidate-Stand
-- lesen; ein erfolgreicher Run schreibt bewusst niemals TravelItems.

create table if not exists private.extraction_runtime_config (
  singleton boolean primary key default true check (singleton),
  provider_enabled boolean not null default false,
  monthly_budget_micro_eur bigint not null default 20000000 check (monthly_budget_micro_eur > 0),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into private.extraction_runtime_config (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists private.extraction_budget_months (
  month_start date primary key,
  limit_micro_eur bigint not null check (limit_micro_eur > 0),
  reserved_micro_eur bigint not null default 0 check (reserved_micro_eur >= 0),
  spent_micro_eur bigint not null default 0 check (spent_micro_eur >= 0),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint extraction_budget_months_limit check (reserved_micro_eur + spent_micro_eur <= limit_micro_eur)
);

create table if not exists public.extraction_runs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete restrict,
  document_version bigint not null check (document_version > 0),
  requested_by_user_id uuid not null references public.users (id) on delete restrict,
  idempotency_key text not null,
  attempt_number integer not null check (attempt_number > 0),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'succeeded', 'failed_retryable', 'failed_terminal', 'expired')),
  correlation_id uuid not null default gen_random_uuid() unique,
  model_identifier text not null,
  extraction_schema_version text not null check (extraction_schema_version = '1.0.0'),
  prompt_version text not null check (length(btrim(prompt_version)) between 1 and 80),
  candidate_adapter_version text not null check (length(btrim(candidate_adapter_version)) between 1 and 80),
  pricing_version text not null check (length(btrim(pricing_version)) between 1 and 80),
  provider_request_id text,
  provider_attempt_count integer not null default 0 check (provider_attempt_count between 0 and 3),
  budget_reservation_micro_eur bigint not null check (budget_reservation_micro_eur > 0),
  budget_month_start date not null,
  lease_owner uuid,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_detail_safe text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint extraction_runs_idempotency_key_not_blank check (length(btrim(idempotency_key)) between 1 and 200),
  constraint extraction_runs_lease_consistency check (
    (status = 'processing' and lease_owner is not null and lease_expires_at is not null)
    or (status <> 'processing' and lease_owner is null and lease_expires_at is null)
  ),
  unique (document_id, requested_by_user_id, idempotency_key),
  unique (document_id, attempt_number)
);

create unique index if not exists extraction_runs_one_active_document_idx
  on public.extraction_runs (document_id)
  where status in ('queued', 'processing');
create index if not exists extraction_runs_document_created_idx
  on public.extraction_runs (document_id, created_at desc);
create index if not exists extraction_runs_requested_by_created_idx
  on public.extraction_runs (requested_by_user_id, created_at desc);
create index if not exists extraction_runs_status_lease_idx
  on public.extraction_runs (status, lease_expires_at)
  where status = 'processing';

create table if not exists public.extraction_candidates (
  id uuid primary key default gen_random_uuid(),
  extraction_run_id uuid not null references public.extraction_runs (id) on delete restrict,
  candidate_index integer not null check (candidate_index between 0 and 11),
  proposed_event_type_code text not null references public.event_type_definitions (code) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'discarded', 'superseded')),
  overall_confidence numeric,
  candidate_format_version text not null default '1.0.0',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  version bigint not null default 1 check (version > 0),
  constraint extraction_candidates_confidence_range check (overall_confidence is null or overall_confidence between 0 and 1),
  unique (extraction_run_id, candidate_index)
);

create index if not exists extraction_candidates_run_status_idx
  on public.extraction_candidates (extraction_run_id, status, candidate_index);

create table if not exists public.candidate_fields (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.extraction_candidates (id) on delete restrict,
  field_path text not null,
  occurrence_key text not null default '',
  original_value jsonb not null,
  provenance text not null check (provenance in ('explicit', 'inferred', 'unknown')),
  confidence numeric,
  source_document_id uuid not null references public.documents (id) on delete restrict,
  source_locator jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint candidate_fields_path_not_blank check (length(btrim(field_path)) between 1 and 250),
  constraint candidate_fields_occurrence_key_length check (length(occurrence_key) <= 180),
  constraint candidate_fields_value_json check (jsonb_typeof(original_value) in ('string', 'number', 'boolean', 'array', 'object', 'null')),
  constraint candidate_fields_locator_array check (jsonb_typeof(source_locator) = 'array'),
  constraint candidate_fields_confidence_range check (confidence is null or confidence between 0 and 1),
  constraint candidate_fields_provenance_consistency check (
    (provenance = 'unknown' and original_value = 'null'::jsonb and confidence is null and source_locator = '[]'::jsonb)
    or (provenance in ('explicit', 'inferred') and original_value <> 'null'::jsonb and confidence is not null and jsonb_array_length(source_locator) > 0)
  ),
  unique (candidate_id, field_path, occurrence_key)
);

create index if not exists candidate_fields_candidate_path_idx
  on public.candidate_fields (candidate_id, field_path, occurrence_key);
create index if not exists candidate_fields_source_document_idx
  on public.candidate_fields (source_document_id);

create table if not exists public.extraction_run_warnings (
  id uuid primary key default gen_random_uuid(),
  extraction_run_id uuid not null references public.extraction_runs (id) on delete restrict,
  candidate_id uuid references public.extraction_candidates (id) on delete restrict,
  warning_code text not null check (warning_code in ('conflicting_information', 'ambiguous_information', 'missing_critical_information', 'timezone_unresolved', 'chronology_unresolved', 'unsupported_event_kind', 'possible_duplicate', 'other')),
  severity text not null check (severity in ('info', 'review', 'blocking')),
  field_path text,
  message text not null check (length(btrim(message)) between 1 and 500),
  source_locator jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint extraction_run_warnings_locator_array check (jsonb_typeof(source_locator) = 'array')
);

create index if not exists extraction_run_warnings_run_candidate_idx
  on public.extraction_run_warnings (extraction_run_id, candidate_id, created_at);

-- The Edge Function is the only caller. It passes its already verified actor
-- identity, which is rechecked against the active trip/member chain here.
create or replace function private.is_active_member_as(p_trip_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trip_members as membership
    join public.users as app_user on app_user.id = membership.user_id
    join public.trips as trip on trip.id = membership.trip_id
    where membership.trip_id = p_trip_id
      and membership.user_id = p_user_id
      and membership.membership_status = 'active'
      and app_user.account_status = 'active'
      and trip.lifecycle_status = 'active'
  );
$$;

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

  with expired_runs as (
    update public.extraction_runs
    set status = 'expired', lease_owner = null, lease_expires_at = null,
        completed_at = timezone('utc', now()), error_code = 'lease_expired',
        error_detail_safe = null, updated_at = timezone('utc', now())
    where status = 'processing'
      and lease_expires_at < timezone('utc', now())
    returning budget_month_start, budget_reservation_micro_eur
  ), expired_budget as (
    select budget_month_start, sum(budget_reservation_micro_eur) as released_micro_eur
    from expired_runs
    group by budget_month_start
  )
  update private.extraction_budget_months as budget
  set reserved_micro_eur = greatest(0, budget.reserved_micro_eur - expired_budget.released_micro_eur),
      updated_at = timezone('utc', now())
  from expired_budget
  where budget.month_start = expired_budget.budget_month_start;

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

create or replace function private.claim_extraction_run(
  p_run_id uuid,
  p_requested_by_user_id uuid,
  p_lease_owner uuid
)
returns setof public.extraction_runs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.extraction_runs as run
  set status = 'processing',
      lease_owner = p_lease_owner,
      lease_expires_at = timezone('utc', now()) + interval '5 minutes',
      started_at = coalesce(run.started_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where run.id = p_run_id
    and run.requested_by_user_id = p_requested_by_user_id
    and run.status = 'queued'
  returning *;
end;
$$;

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
  actual_cost bigint := greatest(coalesce(p_actual_cost_micro_eur, 0), 0);
begin
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) > 12
    or jsonb_typeof(p_warnings) <> 'array' or jsonb_array_length(p_warnings) > 50 then
    raise exception using errcode = 'P0001', message = '[invalid_extraction_semantics] Verarbeitungsergebnis ist ungültig';
  end if;
  select * into run_row
  from public.extraction_runs as run
  where run.id = p_run_id
  for update;
  select * into document_row
  from public.documents as document
  where document.id = run_row.document_id;
  if not found or run_row.status <> 'processing' or run_row.requested_by_user_id <> p_requested_by_user_id
    or run_row.lease_owner <> p_lease_owner or run_row.lease_expires_at <= timezone('utc', now())
    or not private.is_active_member_as(document_row.trip_id, p_requested_by_user_id) then
    raise exception using errcode = 'P0001', message = '[forbidden] Verarbeitung ist nicht verfügbar';
  end if;

  for candidate_payload in select value from jsonb_array_elements(p_candidates) loop
    insert into public.extraction_candidates (
      extraction_run_id, candidate_index, proposed_event_type_code, overall_confidence
    ) values (
      p_run_id,
      (candidate_payload ->> 'candidate_index')::integer,
      candidate_payload ->> 'proposed_event_type_code',
      nullif(candidate_payload ->> 'overall_confidence', '')::numeric
    ) returning * into candidate_row;
    for field_payload in select value from jsonb_array_elements(candidate_payload -> 'fields') loop
      insert into public.candidate_fields (
        candidate_id, field_path, occurrence_key, original_value, provenance, confidence, source_document_id, source_locator
      ) values (
        candidate_row.id,
        field_payload ->> 'field_path',
        coalesce(field_payload ->> 'occurrence_key', ''),
        field_payload -> 'original_value',
        field_payload ->> 'provenance',
        nullif(field_payload ->> 'confidence', '')::numeric,
        document_row.id,
        coalesce(field_payload -> 'source_locator', '[]'::jsonb)
      );
    end loop;
  end loop;

  for warning_payload in select value from jsonb_array_elements(p_warnings) loop
    warning_candidate_id := null;
    select candidate.id into warning_candidate_id
    from public.extraction_candidates as candidate
    where candidate.extraction_run_id = p_run_id
      and candidate.candidate_index = nullif(warning_payload ->> 'event_index', '')::integer;
    insert into public.extraction_run_warnings (
      extraction_run_id, candidate_id, warning_code, severity, field_path, message, source_locator
    ) values (
      p_run_id,
      warning_candidate_id,
      warning_payload ->> 'code',
      warning_payload ->> 'severity',
      nullif(warning_payload ->> 'field_path', ''),
      warning_payload ->> 'message',
      coalesce(warning_payload -> 'source_locator', '[]'::jsonb)
    );
  end loop;

  update private.extraction_budget_months
  set reserved_micro_eur = greatest(0, reserved_micro_eur - run_row.budget_reservation_micro_eur),
      spent_micro_eur = spent_micro_eur + actual_cost,
      updated_at = timezone('utc', now())
  where month_start = run_row.budget_month_start;
  update public.extraction_runs
  set status = 'succeeded', provider_request_id = nullif(p_provider_request_id, ''),
      provider_attempt_count = greatest(0, least(coalesce(p_provider_attempt_count, 0), 3)),
      lease_owner = null, lease_expires_at = null, completed_at = timezone('utc', now()),
      error_code = null, error_detail_safe = null, updated_at = timezone('utc', now())
  where id = p_run_id
  returning * into run_row;
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
begin
  select * into run_row from public.extraction_runs where id = p_run_id for update;
  if not found or run_row.status <> 'processing' or run_row.requested_by_user_id <> p_requested_by_user_id
    or run_row.lease_owner <> p_lease_owner or run_row.lease_expires_at <= timezone('utc', now()) then
    raise exception using errcode = 'P0001', message = '[forbidden] Verarbeitung ist nicht verfügbar';
  end if;
  update private.extraction_budget_months
  set reserved_micro_eur = greatest(0, reserved_micro_eur - run_row.budget_reservation_micro_eur),
      spent_micro_eur = spent_micro_eur + greatest(coalesce(p_actual_cost_micro_eur, 0), 0),
      updated_at = timezone('utc', now())
  where month_start = run_row.budget_month_start;
  update public.extraction_runs
  set status = case when p_retryable then 'failed_retryable' else 'failed_terminal' end,
      provider_attempt_count = greatest(0, least(coalesce(p_provider_attempt_count, 0), 3)),
      lease_owner = null, lease_expires_at = null, completed_at = timezone('utc', now()),
      error_code = left(coalesce(p_error_code, 'extraction_failed'), 80),
      error_detail_safe = null, updated_at = timezone('utc', now())
  where id = p_run_id
  returning * into run_row;
  return run_row;
end;
$$;

-- These minimal public wrappers are visible to PostgREST so the server-side
-- client can call them. Only the service role receives EXECUTE; the private
-- implementations retain the validation and state-transition rules.
create or replace function public.reserve_extraction_run(
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
language sql
security definer
set search_path = ''
as $$
  select private.reserve_extraction_run(
    p_document_id, p_document_version, p_requested_by_user_id, p_idempotency_key,
    p_model_identifier, p_extraction_schema_version, p_prompt_version,
    p_candidate_adapter_version, p_pricing_version, p_budget_reservation_micro_eur
  );
$$;

create or replace function public.claim_extraction_run(
  p_run_id uuid,
  p_requested_by_user_id uuid,
  p_lease_owner uuid
)
returns setof public.extraction_runs
language sql
security definer
set search_path = ''
as $$
  select * from private.claim_extraction_run(p_run_id, p_requested_by_user_id, p_lease_owner);
$$;

create or replace function public.complete_extraction_run(
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
language sql
security definer
set search_path = ''
as $$
  select private.complete_extraction_run(
    p_run_id, p_requested_by_user_id, p_lease_owner, p_provider_request_id,
    p_actual_cost_micro_eur, p_provider_attempt_count, p_candidates, p_warnings
  );
$$;

create or replace function public.fail_extraction_run(
  p_run_id uuid,
  p_requested_by_user_id uuid,
  p_lease_owner uuid,
  p_error_code text,
  p_retryable boolean,
  p_provider_attempt_count integer,
  p_actual_cost_micro_eur bigint default 0
)
returns public.extraction_runs
language sql
security definer
set search_path = ''
as $$
  select private.fail_extraction_run(
    p_run_id, p_requested_by_user_id, p_lease_owner, p_error_code, p_retryable,
    p_provider_attempt_count, p_actual_cost_micro_eur
  );
$$;

alter table public.extraction_runs enable row level security;
alter table public.extraction_candidates enable row level security;
alter table public.candidate_fields enable row level security;
alter table public.extraction_run_warnings enable row level security;
alter table private.extraction_runtime_config enable row level security;
alter table private.extraction_budget_months enable row level security;

create policy extraction_runs_select_member on public.extraction_runs
for select to authenticated
using (exists (
  select 1 from public.documents as document
  where document.id = extraction_runs.document_id
    and document.status = 'available'
    and private.is_active_trip_member(document.trip_id)
));
create policy extraction_candidates_select_member on public.extraction_candidates
for select to authenticated
using (exists (
  select 1 from public.extraction_runs as run
  join public.documents as document on document.id = run.document_id
  where run.id = extraction_candidates.extraction_run_id
    and document.status = 'available'
    and private.is_active_trip_member(document.trip_id)
));
create policy candidate_fields_select_member on public.candidate_fields
for select to authenticated
using (exists (
  select 1 from public.extraction_candidates as candidate
  join public.extraction_runs as run on run.id = candidate.extraction_run_id
  join public.documents as document on document.id = run.document_id
  where candidate.id = candidate_fields.candidate_id
    and document.status = 'available'
    and private.is_active_trip_member(document.trip_id)
));
create policy extraction_run_warnings_select_member on public.extraction_run_warnings
for select to authenticated
using (exists (
  select 1 from public.extraction_runs as run
  join public.documents as document on document.id = run.document_id
  where run.id = extraction_run_warnings.extraction_run_id
    and document.status = 'available'
    and private.is_active_trip_member(document.trip_id)
));

revoke all on table public.extraction_runs, public.extraction_candidates, public.candidate_fields, public.extraction_run_warnings from anon, authenticated;
grant select on table public.extraction_runs, public.extraction_candidates, public.candidate_fields, public.extraction_run_warnings to authenticated;
revoke all on table private.extraction_runtime_config, private.extraction_budget_months from public, anon, authenticated;
revoke all on function private.is_active_member_as(uuid, uuid) from public, anon, authenticated;
revoke all on function private.reserve_extraction_run(uuid, bigint, uuid, text, text, text, text, text, text, bigint) from public, anon, authenticated;
revoke all on function private.claim_extraction_run(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.complete_extraction_run(uuid, uuid, uuid, text, bigint, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.fail_extraction_run(uuid, uuid, uuid, text, boolean, integer, bigint) from public, anon, authenticated;
revoke all on function public.reserve_extraction_run(uuid, bigint, uuid, text, text, text, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.claim_extraction_run(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_extraction_run(uuid, uuid, uuid, text, bigint, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.fail_extraction_run(uuid, uuid, uuid, text, boolean, integer, bigint) from public, anon, authenticated;
grant execute on function public.reserve_extraction_run(uuid, bigint, uuid, text, text, text, text, text, text, bigint) to service_role;
grant execute on function public.claim_extraction_run(uuid, uuid, uuid) to service_role;
grant execute on function public.complete_extraction_run(uuid, uuid, uuid, text, bigint, integer, jsonb, jsonb) to service_role;
grant execute on function public.fail_extraction_run(uuid, uuid, uuid, text, boolean, integer, bigint) to service_role;

alter table public.extraction_runs replica identity full;
alter table public.extraction_candidates replica identity full;
alter table public.extraction_run_warnings replica identity full;
alter publication supabase_realtime add table public.extraction_runs;
alter publication supabase_realtime add table public.extraction_candidates;
alter publication supabase_realtime add table public.extraction_run_warnings;
