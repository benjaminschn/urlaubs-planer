alter function public.confirm_candidate(uuid, bigint, text, jsonb)
  rename to confirm_candidate_after_membership_check;

revoke all on function public.confirm_candidate_after_membership_check(uuid, bigint, text, jsonb)
  from public, anon, authenticated;

create function public.confirm_candidate(
  p_candidate_id uuid,
  p_expected_version bigint,
  p_idempotency_key text,
  p_payload jsonb
)
returns table (
  operation_status text,
  candidate_id uuid,
  travel_item_id uuid,
  version bigint,
  error_code text,
  error_message text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.extraction_candidates candidate
  join public.extraction_runs run on run.id = candidate.extraction_run_id
  join public.documents document on document.id = run.document_id
  where candidate.id = p_candidate_id
    and document.status = 'available'
    and private.is_active_trip_member(document.trip_id);
  if not found then
    return query
      select 'forbidden', null::uuid, null::uuid, null::bigint,
             'FORBIDDEN', 'Bestätigung ist nicht verfügbar';
    return;
  end if;

  return query
    select result.operation_status, result.candidate_id, result.travel_item_id,
           result.version, result.error_code, result.error_message
    from public.confirm_candidate_after_membership_check(
      p_candidate_id, p_expected_version, p_idempotency_key, p_payload
    ) result;
end;
$$;

revoke all on function public.confirm_candidate(uuid, bigint, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.confirm_candidate(uuid, bigint, text, jsonb)
  to authenticated;
