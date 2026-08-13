-- Reconcile table security and supporting schema that had been added to the
-- original travel-item migration after production had already applied it.

alter table public.locations
  add column if not exists owner_travel_item_id uuid;

-- A pre-existing location must be attributable to exactly one travel item.
-- Refuse to guess when legacy data is orphaned or shared across aggregates.
with location_references as (
  select id as travel_item_id, main_location_id as location_id
  from public.travel_items where main_location_id is not null
  union all
  select id, start_location_id from public.travel_items where start_location_id is not null
  union all
  select id, end_location_id from public.travel_items where end_location_id is not null
  union all
  select travel_item_id, start_location_id from public.flight_segments
  union all
  select travel_item_id, end_location_id from public.flight_segments
  union all
  select travel_item_id, start_location_id from public.rail_segments
  union all
  select travel_item_id, end_location_id from public.rail_segments
  union all
  select travel_item_id, start_location_id from public.bus_segments
  union all
  select travel_item_id, end_location_id from public.bus_segments
), unique_owners as (
  select location_id, (array_agg(distinct travel_item_id))[1] as travel_item_id
  from location_references
  group by location_id
  having count(distinct travel_item_id) = 1
)
update public.locations as location
set owner_travel_item_id = owner.travel_item_id
from unique_owners as owner
where location.id = owner.location_id
  and location.owner_travel_item_id is null;

do $$
begin
  if exists (
    select 1 from public.locations where owner_travel_item_id is null
  ) then
    raise exception using
      errcode = '23502',
      message = 'Legacy location ownership is missing or ambiguous; reconcile it before applying this migration';
  end if;
end;
$$;

alter table public.locations
  alter column owner_travel_item_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.locations'::regclass
      and conname = 'locations_owner_travel_item_fkey'
  ) then
    alter table public.locations
      add constraint locations_owner_travel_item_fkey
      foreign key (owner_travel_item_id)
      references public.travel_items (id)
      on delete restrict
      deferrable initially deferred;
  end if;
end;
$$;

create index if not exists locations_owner_travel_item_idx
  on public.locations (owner_travel_item_id);
create index if not exists locations_created_by_user_idx
  on public.locations (created_by_user_id);
create index if not exists locations_updated_by_user_idx
  on public.locations (updated_by_user_id);
create index if not exists travel_items_event_type_idx
  on public.travel_items (event_type_code);
create index if not exists travel_items_created_by_user_idx
  on public.travel_items (created_by_user_id);
create index if not exists travel_items_updated_by_user_idx
  on public.travel_items (updated_by_user_id);
create index if not exists travel_items_deleted_by_user_idx
  on public.travel_items (deleted_by_user_id);
create index if not exists travel_item_revisions_changed_by_user_idx
  on public.travel_item_revisions (changed_by_user_id);
create index if not exists flight_segments_end_location_idx
  on public.flight_segments (end_location_id);
create index if not exists rail_segments_end_location_idx
  on public.rail_segments (end_location_id);
create index if not exists bus_segments_end_location_idx
  on public.bus_segments (end_location_id);
create index if not exists travel_item_mutations_travel_item_idx
  on private.travel_item_mutations (travel_item_id);

-- MFA is a restrictive, table-wide protection layer. It cannot be bypassed by
-- a later permissive business policy.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'event_type_definitions', 'locations', 'travel_items', 'travel_item_revisions',
    'accommodation_details', 'flight_details', 'rail_details', 'bus_details',
    'activity_details', 'flight_segments', 'rail_segments', 'bus_segments'
  ] loop
    execute format('drop policy if exists require_aal2 on public.%I', v_table);
    execute format(
      'create policy require_aal2 on public.%I as restrictive for all to authenticated using (coalesce((select auth.jwt()) ->> ''aal'', ''aal1'') = ''aal2'') with check (coalesce((select auth.jwt()) ->> ''aal'', ''aal1'') = ''aal2'')',
      v_table
    );
  end loop;
end;
$$;
