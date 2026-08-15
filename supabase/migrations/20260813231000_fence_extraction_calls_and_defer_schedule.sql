alter table public.extraction_runs
  add column if not exists provider_call_started_at timestamptz,
  add column if not exists input_micro_eur_per_token numeric,
  add column if not exists cached_input_micro_eur_per_token numeric,
  add column if not exists output_micro_eur_per_token numeric;

alter table public.extraction_runs
  add constraint extraction_runs_pricing_snapshot_valid check (
    (input_micro_eur_per_token is null and cached_input_micro_eur_per_token is null and output_micro_eur_per_token is null)
    or (input_micro_eur_per_token >= 0 and cached_input_micro_eur_per_token >= 0 and output_micro_eur_per_token >= 0)
  );

alter table private.extraction_provider_charges
  add column if not exists cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0 and cached_input_tokens <= input_tokens),
  add column if not exists pricing_version text,
  add column if not exists input_micro_eur_per_token numeric,
  add column if not exists cached_input_micro_eur_per_token numeric,
  add column if not exists output_micro_eur_per_token numeric;

create or replace function private.reserve_priced_extraction_run(
  p_document_id uuid, p_document_version bigint, p_requested_by_user_id uuid,
  p_idempotency_key text, p_model_identifier text, p_extraction_schema_version text,
  p_prompt_version text, p_candidate_adapter_version text, p_pricing_version text,
  p_budget_reservation_micro_eur bigint, p_input_micro_eur_per_token numeric,
  p_cached_input_micro_eur_per_token numeric, p_output_micro_eur_per_token numeric
)
returns public.extraction_runs
language plpgsql
security definer
set search_path = ''
as $$
declare run_row public.extraction_runs%rowtype;
begin
  if p_input_micro_eur_per_token is null or p_input_micro_eur_per_token < 0
    or p_cached_input_micro_eur_per_token is null or p_cached_input_micro_eur_per_token < 0
    or p_output_micro_eur_per_token is null or p_output_micro_eur_per_token < 0 then
    raise exception using errcode = 'P0001', message = '[invalid_pricing_snapshot] Preisstand ist ungültig';
  end if;
  run_row := private.reserve_extraction_run(
    p_document_id, p_document_version, p_requested_by_user_id, p_idempotency_key,
    p_model_identifier, p_extraction_schema_version, p_prompt_version,
    p_candidate_adapter_version, p_pricing_version, p_budget_reservation_micro_eur
  );
  update public.extraction_runs
  set input_micro_eur_per_token = p_input_micro_eur_per_token,
      cached_input_micro_eur_per_token = p_cached_input_micro_eur_per_token,
      output_micro_eur_per_token = p_output_micro_eur_per_token
  where id = run_row.id
    and input_micro_eur_per_token is null;
  -- UPDATE ... RETURNING clears a composite target when an idempotent replay
  -- updates zero rows. Re-read under the reservation function's row lock so a
  -- replay compares against the immutable first snapshot instead.
  select * into strict run_row
  from public.extraction_runs
  where id = run_row.id;
  -- An idempotent replay after a secret rotation intentionally returns the
  -- first snapshot. The provider attempt must remain attributable to the
  -- prices that were accepted when this run reserved budget.
  return run_row;
end;
$$;

create or replace function public.reserve_priced_extraction_run(
  p_document_id uuid, p_document_version bigint, p_requested_by_user_id uuid,
  p_idempotency_key text, p_model_identifier text, p_extraction_schema_version text,
  p_prompt_version text, p_candidate_adapter_version text, p_pricing_version text,
  p_budget_reservation_micro_eur bigint, p_input_micro_eur_per_token numeric,
  p_cached_input_micro_eur_per_token numeric, p_output_micro_eur_per_token numeric
)
returns public.extraction_runs language sql security definer set search_path = ''
as $$ select private.reserve_priced_extraction_run($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13); $$;

create or replace function private.begin_extraction_provider_call(p_run_id uuid, p_lease_owner uuid)
returns public.extraction_runs language plpgsql security definer set search_path = ''
as $$
declare run_row public.extraction_runs%rowtype;
begin
  update public.extraction_runs
  set provider_call_started_at = timezone('utc', now()), updated_at = timezone('utc', now())
  where id = p_run_id and status = 'processing' and lease_owner = p_lease_owner
    and lease_expires_at > timezone('utc', now()) and provider_call_started_at is null
  returning * into run_row;
  if not found then raise exception using errcode = 'P0001', message = '[invalid_provider_fence] Provideraufruf ist nicht verfügbar'; end if;
  return run_row;
end;
$$;

create or replace function public.begin_extraction_provider_call(p_run_id uuid, p_lease_owner uuid)
returns public.extraction_runs language sql security definer set search_path = ''
as $$ select private.begin_extraction_provider_call($1,$2); $$;

create or replace function private.record_extraction_provider_charge_v2(
  p_run_id uuid, p_lease_owner uuid, p_provider_request_id text,
  p_input_tokens bigint, p_cached_input_tokens bigint, p_output_tokens bigint,
  p_cost_micro_eur bigint
)
returns public.extraction_runs language plpgsql security definer set search_path = ''
as $$
declare run_row public.extraction_runs%rowtype; inserted_cost bigint;
begin
  select * into run_row from public.extraction_runs where id = p_run_id for update;
  if not found or run_row.status <> 'processing' or run_row.lease_owner <> p_lease_owner
    or run_row.lease_expires_at <= timezone('utc', now()) or run_row.provider_call_started_at is null
    or p_provider_request_id is null or length(btrim(p_provider_request_id)) not between 1 and 200
    or coalesce(p_input_tokens,-1) < 0 or coalesce(p_cached_input_tokens,-1) < 0
    or p_cached_input_tokens > p_input_tokens or coalesce(p_output_tokens,-1) < 0
    or coalesce(p_cost_micro_eur,-1) < 0 or run_row.input_micro_eur_per_token is null then
    raise exception using errcode = 'P0001', message = '[invalid_provider_charge] Providerkosten konnten nicht verbucht werden';
  end if;
  insert into private.extraction_provider_charges (
    extraction_run_id, provider_attempt_number, provider_request_id, input_tokens,
    cached_input_tokens, output_tokens, cost_micro_eur, pricing_version,
    input_micro_eur_per_token, cached_input_micro_eur_per_token, output_micro_eur_per_token
  ) values (
    p_run_id, run_row.provider_attempt_count, btrim(p_provider_request_id), p_input_tokens,
    p_cached_input_tokens, p_output_tokens, p_cost_micro_eur, run_row.pricing_version,
    run_row.input_micro_eur_per_token, run_row.cached_input_micro_eur_per_token, run_row.output_micro_eur_per_token
  ) on conflict (extraction_run_id, provider_attempt_number) do nothing returning cost_micro_eur into inserted_cost;
  if inserted_cost is not null then
    update private.extraction_budget_months
    set reserved_micro_eur = greatest(0, reserved_micro_eur - least(inserted_cost, greatest(run_row.budget_reservation_micro_eur - run_row.actual_cost_micro_eur,0))),
        spent_micro_eur = spent_micro_eur + inserted_cost, updated_at = timezone('utc', now())
    where month_start = run_row.budget_month_start;
    update public.extraction_runs set actual_cost_micro_eur = actual_cost_micro_eur + inserted_cost,
      provider_request_id = btrim(p_provider_request_id), updated_at = timezone('utc', now())
    where id = p_run_id returning * into run_row;
  elsif not exists (select 1 from private.extraction_provider_charges c where c.extraction_run_id=p_run_id
    and c.provider_attempt_number=run_row.provider_attempt_count and c.provider_request_id=btrim(p_provider_request_id)
    and c.input_tokens=p_input_tokens and c.cached_input_tokens=p_cached_input_tokens
    and c.output_tokens=p_output_tokens and c.cost_micro_eur=p_cost_micro_eur) then
    raise exception using errcode = 'P0001', message = '[provider_charge_conflict] Providerkosten widersprechen dem bereits verbuchten Versuch';
  end if;
  return run_row;
end;
$$;

create or replace function public.record_extraction_provider_charge_v2(
  p_run_id uuid, p_lease_owner uuid, p_provider_request_id text,
  p_input_tokens bigint, p_cached_input_tokens bigint, p_output_tokens bigint, p_cost_micro_eur bigint
)
returns public.extraction_runs language sql security definer set search_path = ''
as $$ select private.record_extraction_provider_charge_v2($1,$2,$3,$4,$5,$6,$7); $$;

-- A provider call whose worker disappears is never automatically repeated.
-- If no response charge was persisted, consume the remaining reservation as an
-- uncertain charge so the external cost cannot be silently undercounted.
create or replace function private.recover_expired_extraction_runs()
returns integer language plpgsql security definer set search_path = ''
as $$
declare run_row public.extraction_runs%rowtype; uncertain_cost bigint; recovered_count integer := 0;
begin
  for run_row in select r.* from public.extraction_runs r where r.status='processing'
    and r.lease_expires_at <= timezone('utc', now()) order by r.lease_expires_at,r.id for update skip locked
  loop
    if run_row.provider_call_started_at is not null then
      if not exists (select 1 from private.extraction_provider_charges c where c.extraction_run_id=run_row.id and c.provider_attempt_number=run_row.provider_attempt_count) then
        uncertain_cost := greatest(run_row.budget_reservation_micro_eur - run_row.actual_cost_micro_eur, 0);
        insert into private.extraction_provider_charges (
          extraction_run_id, provider_attempt_number, provider_request_id, input_tokens, cached_input_tokens,
          output_tokens, cost_micro_eur, pricing_version, input_micro_eur_per_token,
          cached_input_micro_eur_per_token, output_micro_eur_per_token
        ) values (run_row.id, run_row.provider_attempt_count,
          'uncertain_' || run_row.correlation_id::text || '_' || run_row.provider_attempt_count,
          0,0,0,uncertain_cost,run_row.pricing_version,run_row.input_micro_eur_per_token,
          run_row.cached_input_micro_eur_per_token,run_row.output_micro_eur_per_token);
        update private.extraction_budget_months set reserved_micro_eur=greatest(0,reserved_micro_eur-uncertain_cost),
          spent_micro_eur=spent_micro_eur+uncertain_cost, updated_at=timezone('utc',now()) where month_start=run_row.budget_month_start;
        update public.extraction_runs set actual_cost_micro_eur=actual_cost_micro_eur+uncertain_cost where id=run_row.id;
        run_row.actual_cost_micro_eur := run_row.actual_cost_micro_eur + uncertain_cost;
      end if;
      perform private.release_extraction_reservation(run_row);
      update public.extraction_runs set status='failed_retryable', lease_owner=null, lease_expires_at=null,
        completed_at=timezone('utc',now()), error_code='provider_call_outcome_uncertain', updated_at=timezone('utc',now()) where id=run_row.id;
    elsif run_row.provider_attempt_count = 0 then
      perform private.release_extraction_reservation(run_row);
      update public.extraction_runs set status='expired',lease_owner=null,lease_expires_at=null,
        completed_at=timezone('utc',now()),error_code='lease_expired',updated_at=timezone('utc',now()) where id=run_row.id;
    elsif run_row.provider_attempt_count < 3 then
      update public.extraction_runs set status='queued',lease_owner=null,lease_expires_at=null,
        available_at=timezone('utc',now()),error_code='lease_expired_retrying',updated_at=timezone('utc',now()) where id=run_row.id;
    else
      perform private.release_extraction_reservation(run_row);
      update public.extraction_runs set status='failed_retryable',lease_owner=null,lease_expires_at=null,
        completed_at=timezone('utc',now()),error_code='lease_expired',updated_at=timezone('utc',now()) where id=run_row.id;
    end if;
    recovered_count := recovered_count + 1;
  end loop;
  return recovered_count;
end;
$$;

create or replace function private.retry_or_fail_extraction_run(
  p_run_id uuid, p_lease_owner uuid, p_error_code text,
  p_retryable boolean, p_retry_delay_seconds integer default 0
)
returns public.extraction_runs language plpgsql security definer set search_path = ''
as $$
declare run_row public.extraction_runs%rowtype;
begin
  select * into run_row from public.extraction_runs where id=p_run_id for update;
  if not found or run_row.status<>'processing' or run_row.lease_owner<>p_lease_owner
    or run_row.lease_expires_at<=timezone('utc',now()) or p_error_code is null
    or length(btrim(p_error_code)) not between 1 and 80 or p_retry_delay_seconds not between 0 and 300 then
    raise exception using errcode='P0001',message='[invalid_worker_transition] Verarbeitung konnte nicht aktualisiert werden';
  end if;
  if p_retryable and run_row.provider_attempt_count<3 then
    update public.extraction_runs set status='queued',lease_owner=null,lease_expires_at=null,
      provider_call_started_at=null,available_at=timezone('utc',now())+pg_catalog.make_interval(secs=>p_retry_delay_seconds),
      error_code=left(btrim(p_error_code),80),error_detail_safe=null,updated_at=timezone('utc',now())
    where id=p_run_id returning * into run_row;
  else
    perform private.release_extraction_reservation(run_row);
    update public.extraction_runs set status=case when p_retryable then 'failed_retryable' else 'failed_terminal' end,
      lease_owner=null,lease_expires_at=null,completed_at=timezone('utc',now()),error_code=left(btrim(p_error_code),80),
      error_detail_safe=null,updated_at=timezone('utc',now()) where id=p_run_id returning * into run_row;
  end if;
  return run_row;
end;
$$;

revoke all on function private.reserve_priced_extraction_run(uuid,bigint,uuid,text,text,text,text,text,text,bigint,numeric,numeric,numeric) from public,anon,authenticated,service_role;
revoke all on function private.begin_extraction_provider_call(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.record_extraction_provider_charge_v2(uuid,uuid,text,bigint,bigint,bigint,bigint) from public,anon,authenticated,service_role;
revoke all on function public.reserve_priced_extraction_run(uuid,bigint,uuid,text,text,text,text,text,text,bigint,numeric,numeric,numeric) from public,anon,authenticated;
revoke all on function public.begin_extraction_provider_call(uuid,uuid) from public,anon,authenticated;
revoke all on function public.record_extraction_provider_charge_v2(uuid,uuid,text,bigint,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.reserve_priced_extraction_run(uuid,bigint,uuid,text,text,text,text,text,text,bigint,numeric,numeric,numeric) to service_role;
grant execute on function public.begin_extraction_provider_call(uuid,uuid) to service_role;
grant execute on function public.record_extraction_provider_charge_v2(uuid,uuid,text,bigint,bigint,bigint,bigint) to service_role;
