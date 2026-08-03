-- Roadmap-Schnitte 6+7: append-only Candidate-Korrekturen, terminales
-- Verwerfen und atomare create-only-Bestätigung in ein TravelItem.

alter table public.extraction_candidates
  add column if not exists discarded_at timestamptz,
  add column if not exists discarded_by_user_id uuid references public.users (id) on delete restrict;

alter table public.extraction_candidates
  add constraint extraction_candidates_discard_consistency check (
    (status = 'discarded' and discarded_at is not null and discarded_by_user_id is not null)
    or (status <> 'discarded' and discarded_at is null and discarded_by_user_id is null)
  );

create table public.candidate_corrections (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.extraction_candidates (id) on delete restrict,
  field_path text not null,
  occurrence_key text not null default '',
  operation text not null check (operation in ('set', 'remove', 'add_occurrence', 'remove_occurrence', 'reorder')),
  previous_effective_value jsonb not null,
  new_value jsonb not null,
  corrected_by_user_id uuid not null references public.users (id) on delete restrict,
  corrected_at timestamptz not null default timezone('utc', now()),
  candidate_version_after bigint not null check (candidate_version_after > 1),
  constraint candidate_corrections_path check (length(btrim(field_path)) between 1 and 250),
  constraint candidate_corrections_occurrence_key check (length(occurrence_key) <= 180),
  unique (candidate_id, candidate_version_after)
);

create index candidate_corrections_candidate_order_idx
  on public.candidate_corrections (candidate_id, corrected_at, id);
create index candidate_corrections_actor_time_idx
  on public.candidate_corrections (corrected_by_user_id, corrected_at desc);

alter table public.travel_items
  add column if not exists created_from_candidate_id uuid
    references public.extraction_candidates (id) on delete restrict;
create unique index travel_items_created_from_candidate_idx
  on public.travel_items (created_from_candidate_id)
  where created_from_candidate_id is not null;

create table public.candidate_confirmations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null unique references public.extraction_candidates (id) on delete restrict,
  confirmation_mode text not null default 'create' check (confirmation_mode = 'create'),
  travel_item_id uuid not null references public.travel_items (id) on delete restrict,
  candidate_version bigint not null check (candidate_version > 0),
  idempotency_key text not null,
  confirmed_by_user_id uuid not null references public.users (id) on delete restrict,
  confirmed_at timestamptz not null default timezone('utc', now()),
  constraint candidate_confirmations_idempotency_key check (length(btrim(idempotency_key)) between 1 and 200),
  unique (confirmed_by_user_id, idempotency_key)
);
create index candidate_confirmations_travel_item_idx
  on public.candidate_confirmations (travel_item_id);

create table public.travel_item_documents (
  travel_item_id uuid not null references public.travel_items (id) on delete restrict,
  document_id uuid not null references public.documents (id) on delete restrict,
  link_role text not null default 'source' check (link_role in ('source', 'supporting')),
  linked_by_confirmation_id uuid not null references public.candidate_confirmations (id) on delete restrict,
  linked_by_user_id uuid not null references public.users (id) on delete restrict,
  linked_at timestamptz not null default timezone('utc', now()),
  primary key (travel_item_id, document_id)
);
create index travel_item_documents_document_idx
  on public.travel_item_documents (document_id, travel_item_id);

alter table public.travel_item_revisions drop constraint travel_item_revisions_change_kind_check;
alter table public.travel_item_revisions
  add constraint travel_item_revisions_change_kind_check check (
    change_kind in ('created_manual', 'created_from_candidate', 'edited_manual', 'updated_from_candidate', 'booking_cancelled', 'deleted')
  ),
  add column if not exists confirmation_id uuid references public.candidate_confirmations (id) on delete restrict;

create or replace function private.reject_candidate_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'Candidate-Herkunft und Korrekturhistorie sind unveränderlich';
end;
$$;

create trigger candidate_corrections_immutable
before update or delete on public.candidate_corrections
for each row execute function private.reject_candidate_history_mutation();

create or replace function private.guard_travel_item_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_candidate_setting text := pg_catalog.current_setting('app.confirming_candidate_id', true);
  v_provenance_transition boolean :=
    old.creation_source = 'manual'
    and old.created_from_candidate_id is null
    and new.creation_source = 'candidate_confirmation'
    and new.created_from_candidate_id is not null
    and v_candidate_setting = new.created_from_candidate_id::text;
begin
  if new.id <> old.id
    or new.trip_id <> old.trip_id
    or new.created_at <> old.created_at
    or new.created_by_user_id <> old.created_by_user_id
    or new.stable_sort_key <> old.stable_sort_key
    or (not v_provenance_transition and (
      new.creation_source <> old.creation_source
      or new.created_from_candidate_id is distinct from old.created_from_candidate_id
    )) then
    raise exception using errcode = '42501', message = 'Reisezuordnung und Herkunft eines Ereignisses sind unveränderlich';
  end if;
  if v_provenance_transition then
    new.version := old.version;
    new.updated_at := old.updated_at;
    new.updated_by_user_id := old.updated_by_user_id;
  else
    new.version := old.version + 1;
    new.updated_at := pg_catalog.timezone('utc', pg_catalog.now());
    new.updated_by_user_id := coalesce((select auth.uid()), old.updated_by_user_id);
  end if;
  return new;
end;
$$;

create or replace function public.apply_candidate_correction(
  p_candidate_id uuid,
  p_expected_version bigint,
  p_field_path text,
  p_occurrence_key text,
  p_operation text,
  p_new_value jsonb
)
returns table (operation_status text, candidate_id uuid, version bigint, error_code text, error_message text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_candidate public.extraction_candidates%rowtype;
  v_previous jsonb := 'null'::jsonb;
begin
  if v_actor_id is null
    or coalesce((select auth.jwt()) ->> 'aal', 'aal1') <> 'aal2'
    or p_expected_version is null
    or p_field_path is null or length(btrim(p_field_path)) not between 1 and 250
    or coalesce(length(p_occurrence_key), 0) > 180
    or p_operation not in ('set', 'remove', 'add_occurrence', 'remove_occurrence', 'reorder')
    or p_new_value is null then
    return query select 'forbidden', null::uuid, null::bigint, 'FORBIDDEN', 'Entwurf ist nicht verfügbar';
    return;
  end if;

  select candidate.* into v_candidate
  from public.extraction_candidates candidate
  join public.extraction_runs run on run.id = candidate.extraction_run_id
  join public.documents document on document.id = run.document_id
  where candidate.id = p_candidate_id
    and candidate.status = 'draft'
    and document.status = 'available'
    and private.is_active_trip_member(document.trip_id)
  for update of candidate;
  if not found then
    return query select 'forbidden', null::uuid, null::bigint, 'FORBIDDEN', 'Entwurf ist nicht verfügbar';
    return;
  end if;
  if v_candidate.version <> p_expected_version then
    return query select 'conflict', p_candidate_id, v_candidate.version, 'VERSION_CONFLICT', 'Entwurf wurde zwischenzeitlich geändert';
    return;
  end if;

  select correction.new_value into v_previous
  from public.candidate_corrections correction
  where correction.candidate_id = p_candidate_id
    and correction.field_path = btrim(p_field_path)
    and correction.occurrence_key = coalesce(p_occurrence_key, '')
  order by correction.candidate_version_after desc
  limit 1;
  if not found then
    select field.original_value into v_previous
    from public.candidate_fields field
    where field.candidate_id = p_candidate_id
      and field.field_path = btrim(p_field_path)
      and field.occurrence_key = coalesce(p_occurrence_key, '');
  end if;
  v_previous := coalesce(v_previous, 'null'::jsonb);

  update public.extraction_candidates as candidate
  set version = candidate.version + 1, updated_at = pg_catalog.timezone('utc', pg_catalog.now())
  where candidate.id = p_candidate_id;
  insert into public.candidate_corrections (
    candidate_id, field_path, occurrence_key, operation,
    previous_effective_value, new_value, corrected_by_user_id, candidate_version_after
  ) values (
    p_candidate_id, btrim(p_field_path), coalesce(p_occurrence_key, ''), p_operation,
    v_previous, p_new_value, v_actor_id, v_candidate.version + 1
  );
  return query select 'updated', p_candidate_id, v_candidate.version + 1, null::text, null::text;
exception
  when check_violation or invalid_text_representation then
    return query select 'validation', p_candidate_id, v_candidate.version, 'VALIDATION', 'Korrektur ist ungültig';
  when others then
    return query select 'unavailable', null::uuid, null::bigint, 'UNAVAILABLE', 'Korrektur konnte nicht gespeichert werden';
end;
$$;

create or replace function public.discard_candidate(
  p_candidate_id uuid,
  p_expected_version bigint
)
returns table (operation_status text, candidate_id uuid, version bigint, error_code text, error_message text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_candidate public.extraction_candidates%rowtype;
begin
  if v_actor_id is null or coalesce((select auth.jwt()) ->> 'aal', 'aal1') <> 'aal2' then
    return query select 'forbidden', null::uuid, null::bigint, 'FORBIDDEN', 'Entwurf ist nicht verfügbar';
    return;
  end if;
  select candidate.* into v_candidate
  from public.extraction_candidates candidate
  join public.extraction_runs run on run.id = candidate.extraction_run_id
  join public.documents document on document.id = run.document_id
  where candidate.id = p_candidate_id
    and candidate.status = 'draft'
    and document.status = 'available'
    and private.is_active_trip_member(document.trip_id)
  for update of candidate;
  if not found then
    return query select 'forbidden', null::uuid, null::bigint, 'FORBIDDEN', 'Entwurf ist nicht verfügbar';
    return;
  end if;
  if v_candidate.version <> p_expected_version then
    return query select 'conflict', p_candidate_id, v_candidate.version, 'VERSION_CONFLICT', 'Entwurf wurde zwischenzeitlich geändert';
    return;
  end if;
  update public.extraction_candidates as candidate
  set status = 'discarded', discarded_at = pg_catalog.timezone('utc', pg_catalog.now()),
      discarded_by_user_id = v_actor_id, version = candidate.version + 1,
      updated_at = pg_catalog.timezone('utc', pg_catalog.now())
  where candidate.id = p_candidate_id;
  return query select 'discarded', p_candidate_id, v_candidate.version + 1, null::text, null::text;
end;
$$;

create or replace function public.confirm_candidate(
  p_candidate_id uuid,
  p_expected_version bigint,
  p_idempotency_key text,
  p_payload jsonb
)
returns table (operation_status text, candidate_id uuid, travel_item_id uuid, version bigint, error_code text, error_message text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_candidate public.extraction_candidates%rowtype;
  v_document public.documents%rowtype;
  v_trip_id uuid;
  v_saved_payload jsonb;
  v_existing public.candidate_confirmations%rowtype;
  v_confirmation_id uuid := gen_random_uuid();
  v_item_id uuid;
  v_item_version bigint;
  v_count bigint;
begin
  if v_actor_id is null
    or coalesce((select auth.jwt()) ->> 'aal', 'aal1') <> 'aal2'
    or p_expected_version is null
    or p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 1 and 200
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return query select 'forbidden', null::uuid, null::uuid, null::bigint, 'FORBIDDEN', 'Bestätigung ist nicht verfügbar';
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor_id::text || ':confirm:' || btrim(p_idempotency_key), 0));
  select * into v_existing
  from public.candidate_confirmations confirmation
  where confirmation.confirmed_by_user_id = v_actor_id
    and confirmation.idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing.candidate_id = p_candidate_id then
      select item.version into v_item_version from public.travel_items item where item.id = v_existing.travel_item_id;
      return query select 'replayed', p_candidate_id, v_existing.travel_item_id, v_item_version, null::text, null::text;
      return;
    end if;
    return query select 'forbidden', null::uuid, null::uuid, null::bigint, 'FORBIDDEN', 'Bestätigung ist nicht verfügbar';
    return;
  end if;

  select candidate.* into v_candidate
  from public.extraction_candidates candidate
  join public.extraction_runs run on run.id = candidate.extraction_run_id
  join public.documents document on document.id = run.document_id
  where candidate.id = p_candidate_id
    and candidate.status = 'draft'
    and document.status = 'available'
    and private.is_active_trip_member(document.trip_id)
  for update of candidate;
  if not found then
    return query select 'forbidden', null::uuid, null::uuid, null::bigint, 'FORBIDDEN', 'Bestätigung ist nicht verfügbar';
    return;
  end if;
  select document.* into v_document
  from public.extraction_runs run
  join public.documents document on document.id = run.document_id
  where run.id = v_candidate.extraction_run_id;
  v_trip_id := v_document.trip_id;
  if v_candidate.version <> p_expected_version then
    return query select 'conflict', p_candidate_id, null::uuid, v_candidate.version, 'VERSION_CONFLICT', 'Entwurf wurde zwischenzeitlich geändert';
    return;
  end if;

  select correction.new_value into v_saved_payload
  from public.candidate_corrections correction
  where correction.candidate_id = p_candidate_id
    and correction.field_path = '$canonical_payload'
  order by correction.candidate_version_after desc
  limit 1;
  if not found or v_saved_payload is distinct from p_payload then
    return query select 'validation', p_candidate_id, null::uuid, v_candidate.version, 'UNSAVED_REVIEW', 'Der geprüfte Stand muss vor der Bestätigung gespeichert werden';
    return;
  end if;
  if p_payload ->> 'event_type_code' not in ('accommodation', 'flight', 'rail', 'bus', 'activity') then
    return query select 'validation', p_candidate_id, null::uuid, v_candidate.version, 'INVALID_TYPE', 'Ereignisart wird nicht unterstützt';
    return;
  end if;
  if (select count(*) from public.candidate_confirmations c where c.confirmed_by_user_id = v_actor_id and c.confirmed_at >= pg_catalog.now() - interval '1 hour') >= 30 then
    return query select 'limit', p_candidate_id, null::uuid, v_candidate.version, 'CONFIRMATION_LIMIT', 'Bestätigungslimit ist erreicht';
    return;
  end if;

  perform 1 from public.trips trip where trip.id = v_trip_id and trip.lifecycle_status = 'active' for update;
  select count(*) into v_count from public.travel_items item where item.trip_id = v_trip_id and item.lifecycle_status <> 'deleted';
  if v_count >= 30 then
    return query select 'limit', p_candidate_id, null::uuid, v_candidate.version, 'TRAVEL_ITEM_LIMIT', 'Es können höchstens 30 aktive Reiseereignisse gespeichert werden';
    return;
  end if;

  v_item_id := private.replace_travel_item_aggregate(null, v_trip_id, p_payload, v_actor_id, true);
  perform pg_catalog.set_config('app.confirming_candidate_id', p_candidate_id::text, true);
  update public.travel_items
  set creation_source = 'candidate_confirmation', created_from_candidate_id = p_candidate_id
  where id = v_item_id;
  perform pg_catalog.set_config('app.confirming_candidate_id', '', true);
  select item.version into v_item_version from public.travel_items item where item.id = v_item_id;

  insert into public.candidate_confirmations (
    id, candidate_id, travel_item_id, candidate_version, idempotency_key, confirmed_by_user_id
  ) values (
    v_confirmation_id, p_candidate_id, v_item_id, v_candidate.version, btrim(p_idempotency_key), v_actor_id
  );
  insert into public.travel_item_documents (
    travel_item_id, document_id, link_role, linked_by_confirmation_id, linked_by_user_id
  ) values (
    v_item_id, v_document.id, 'source', v_confirmation_id, v_actor_id
  );
  insert into public.travel_item_revisions (
    travel_item_id, version_number, change_kind, confirmation_id, changed_by_user_id, snapshot
  ) values (
    v_item_id, v_item_version, 'created_from_candidate', v_confirmation_id, v_actor_id,
    private.travel_item_snapshot(v_item_id)
  );
  update public.extraction_candidates as candidate
  set status = 'confirmed', version = candidate.version + 1, updated_at = pg_catalog.timezone('utc', pg_catalog.now())
  where candidate.id = p_candidate_id;
  return query select 'created', p_candidate_id, v_item_id, v_item_version, null::text, null::text;
exception
  when sqlstate 'P0001' or check_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    return query select 'validation', p_candidate_id, null::uuid, v_candidate.version, 'VALIDATION', 'Der geprüfte Entwurf enthält ungültige Angaben';
  when unique_violation then
    return query select 'conflict', p_candidate_id, null::uuid, v_candidate.version, 'ALREADY_CONFIRMED', 'Entwurf wurde bereits bestätigt';
  when others then
    return query select 'unavailable', null::uuid, null::uuid, null::bigint, 'UNAVAILABLE', 'Speicherstatus konnte nicht bestätigt werden';
end;
$$;

alter table public.candidate_corrections enable row level security;
alter table public.candidate_corrections force row level security;
alter table public.candidate_confirmations enable row level security;
alter table public.candidate_confirmations force row level security;
alter table public.travel_item_documents enable row level security;
alter table public.travel_item_documents force row level security;

create policy candidate_corrections_select_member on public.candidate_corrections
for select to authenticated using (exists (
  select 1 from public.extraction_candidates candidate
  join public.extraction_runs run on run.id = candidate.extraction_run_id
  join public.documents document on document.id = run.document_id
  where candidate.id = candidate_corrections.candidate_id
    and private.is_active_trip_member(document.trip_id)
));
create policy candidate_confirmations_select_member on public.candidate_confirmations
for select to authenticated using (exists (
  select 1 from public.extraction_candidates candidate
  join public.extraction_runs run on run.id = candidate.extraction_run_id
  join public.documents document on document.id = run.document_id
  where candidate.id = candidate_confirmations.candidate_id
    and private.is_active_trip_member(document.trip_id)
));
create policy travel_item_documents_select_member on public.travel_item_documents
for select to authenticated using (exists (
  select 1 from public.travel_items item
  join public.documents document on document.id = travel_item_documents.document_id
  where item.id = travel_item_documents.travel_item_id
    and item.trip_id = document.trip_id
    and private.is_active_trip_member(item.trip_id)
));

do $$
declare
  v_table text;
begin
  foreach v_table in array array['candidate_corrections', 'candidate_confirmations', 'travel_item_documents'] loop
    execute format(
      'create policy require_aal2 on public.%I as restrictive for all to authenticated using (coalesce((select auth.jwt()) ->> ''aal'', ''aal1'') = ''aal2'') with check (coalesce((select auth.jwt()) ->> ''aal'', ''aal1'') = ''aal2'')',
      v_table
    );
  end loop;
end;
$$;

revoke all on table public.candidate_corrections, public.candidate_confirmations, public.travel_item_documents from anon, authenticated;
grant select on table public.candidate_corrections, public.candidate_confirmations, public.travel_item_documents to authenticated;
revoke all on function public.apply_candidate_correction(uuid, bigint, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.discard_candidate(uuid, bigint) from public, anon, authenticated;
revoke all on function public.confirm_candidate(uuid, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_candidate_correction(uuid, bigint, text, text, text, jsonb) to authenticated;
grant execute on function public.discard_candidate(uuid, bigint) to authenticated;
grant execute on function public.confirm_candidate(uuid, bigint, text, jsonb) to authenticated;
revoke all on function private.reject_candidate_history_mutation() from public, anon, authenticated;

alter table public.extraction_candidates replica identity full;
alter publication supabase_realtime add table public.candidate_corrections;
alter publication supabase_realtime add table public.candidate_confirmations;
alter publication supabase_realtime add table public.travel_item_documents;
