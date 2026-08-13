-- A structured editor save is one logical operation. Apply every field-level
-- correction and the required canonical snapshot in a single transaction so
-- a later validation/conflict cannot leave a partial correction history.
create or replace function public.apply_candidate_review(
  p_candidate_id uuid,
  p_expected_version bigint,
  p_corrections jsonb,
  p_canonical_payload jsonb
)
returns table (operation_status text, candidate_id uuid, version bigint, error_code text, error_message text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  correction jsonb;
  current_version bigint := p_expected_version;
  mutation record;
  failed_status text;
  failed_candidate_id uuid;
  failed_version bigint;
  failed_code text;
  failed_message text;
begin
  if p_candidate_id is null
    or p_expected_version is null
    or jsonb_typeof(p_corrections) <> 'array'
    or jsonb_array_length(p_corrections) > 200
    or jsonb_typeof(p_canonical_payload) <> 'object' then
    return query select 'validation', p_candidate_id, p_expected_version, 'VALIDATION', 'Korrektur ist ungültig';
    return;
  end if;

  begin
    for correction in
      select value
      from jsonb_array_elements(
        p_corrections || jsonb_build_array(jsonb_build_object(
          'field_path', '$canonical_payload',
          'occurrence_key', '',
          'operation', 'set',
          'new_value', p_canonical_payload
        ))
      )
    loop
      if jsonb_typeof(correction) <> 'object'
        or not correction ?& array['field_path', 'occurrence_key', 'operation', 'new_value']
        or (select count(*) from jsonb_object_keys(correction)) <> 4 then
        failed_status := 'validation';
        failed_candidate_id := p_candidate_id;
        failed_version := p_expected_version;
        failed_code := 'VALIDATION';
        failed_message := 'Korrektur ist ungültig';
        raise exception using errcode = 'P0001', message = '[batch_candidate_review_rollback]';
      end if;

      select * into mutation
      from public.apply_candidate_correction(
        p_candidate_id,
        current_version,
        correction ->> 'field_path',
        correction ->> 'occurrence_key',
        correction ->> 'operation',
        correction -> 'new_value'
      );

      if mutation.operation_status <> 'updated' then
        failed_status := mutation.operation_status;
        failed_candidate_id := mutation.candidate_id;
        failed_version := mutation.version;
        failed_code := mutation.error_code;
        failed_message := mutation.error_message;
        raise exception using errcode = 'P0001', message = '[batch_candidate_review_rollback]';
      end if;
      current_version := mutation.version;
    end loop;

    return query select 'updated', p_candidate_id, current_version, null::text, null::text;
    return;
  exception
    when sqlstate 'P0001' then
      return query select
        coalesce(failed_status, 'unavailable'),
        failed_candidate_id,
        failed_version,
        coalesce(failed_code, 'UNAVAILABLE'),
        coalesce(failed_message, 'Korrektur konnte nicht gespeichert werden');
      return;
    when others then
      return query select 'unavailable', null::uuid, null::bigint, 'UNAVAILABLE', 'Korrektur konnte nicht gespeichert werden';
      return;
  end;
end;
$$;

revoke all on function public.apply_candidate_review(uuid, bigint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_candidate_review(uuid, bigint, jsonb, jsonb) to authenticated;
