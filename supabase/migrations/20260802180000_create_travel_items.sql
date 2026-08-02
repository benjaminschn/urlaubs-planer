-- Roadmap-Schnitt 3: manuelle Reiseereignisse und Timeline.
-- Führt nach der Schnitt-2-Migration aus, weil es deren Reiseaggregate referenziert.
--
-- Die Aggregate werden ausschließlich über die drei kontrollierten RPCs
-- mutiert. Die fachlichen Detailfelder bleiben in stark validierten JSONB-
-- Hüllen, während Zeitwerte, Orte, Segmente und Revisionen separat
-- abgesichert und per RLS lesbar gemacht werden.

create table if not exists public.event_type_definitions (
  code text primary key,
  display_name text not null,
  is_active boolean not null default true,
  detail_model_version integer not null default 1 check (detail_model_version > 0),
  constraint event_type_code_format check (code ~ '^[a-z_]+$'),
  constraint event_type_display_name_not_blank check (length(btrim(display_name)) between 1 and 80)
);

insert into public.event_type_definitions (code, display_name, is_active, detail_model_version)
values
  ('accommodation', 'Unterkunft', true, 1),
  ('flight', 'Flug', true, 1),
  ('rail', 'Bahn', true, 1),
  ('bus', 'Bus', true, 1),
  ('activity', 'Aktivität', true, 1)
on conflict (code) do update
set display_name = excluded.display_name,
    is_active = excluded.is_active,
    detail_model_version = excluded.detail_model_version;

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete restrict,
  name text not null,
  full_address text,
  street text,
  house_number text,
  postal_code text,
  city text,
  region text,
  country_code text,
  location_code_type text,
  location_code text,
  latitude numeric,
  longitude numeric,
  iana_time_zone text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by_user_id uuid not null references public.users (id) on delete restrict,
  updated_by_user_id uuid not null references public.users (id) on delete restrict,
  version bigint not null default 1 check (version > 0),
  constraint locations_name_not_blank check (length(btrim(name)) between 1 and 240),
  constraint locations_coordinates_pair check ((latitude is null and longitude is null) or (latitude is not null and longitude is not null)),
  constraint locations_latitude_range check (latitude is null or latitude between -90 and 90),
  constraint locations_longitude_range check (longitude is null or longitude between -180 and 180),
  constraint locations_country_code_format check (country_code is null or country_code ~ '^[A-Z]{2}$')
);

create table if not exists public.travel_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete restrict,
  event_type_code text not null references public.event_type_definitions (code) on delete restrict,
  title text not null,
  booking_status text not null default 'unknown'
    check (booking_status in ('confirmed', 'cancelled', 'unknown')),
  lifecycle_status text not null default 'active'
    check (lifecycle_status in ('active', 'deleted')),
  creation_source text not null default 'manual'
    check (creation_source in ('manual', 'candidate_confirmation')),
  start_time jsonb not null,
  end_time jsonb,
  start_local_date date not null,
  start_local_time time,
  start_precision text not null
    check (start_precision in ('exact_time', 'date_only', 'unknown_time')),
  start_iana_time_zone text,
  start_utc_offset_minutes integer,
  start_instant_utc timestamptz,
  end_local_date date,
  end_local_time time,
  end_precision text
    check (end_precision is null or end_precision in ('exact_time', 'date_only', 'unknown_time')),
  end_iana_time_zone text,
  end_utc_offset_minutes integer,
  end_instant_utc timestamptz,
  main_location_id uuid references public.locations (id) on delete restrict,
  start_location_id uuid references public.locations (id) on delete restrict,
  end_location_id uuid references public.locations (id) on delete restrict,
  provider_name text,
  booking_platform_name text,
  management_url text,
  booking_date date,
  notes text,
  common_details jsonb not null default '{}'::jsonb,
  stable_sort_key uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by_user_id uuid not null references public.users (id) on delete restrict,
  updated_by_user_id uuid not null references public.users (id) on delete restrict,
  deleted_at timestamptz,
  deleted_by_user_id uuid references public.users (id) on delete restrict,
  version bigint not null default 1 check (version > 0),
  constraint travel_items_title_not_blank check (length(btrim(title)) between 1 and 240),
  constraint travel_items_start_time_object check (jsonb_typeof(start_time) = 'object'),
  constraint travel_items_end_time_object check (end_time is null or jsonb_typeof(end_time) = 'object'),
  constraint travel_items_deleted_fields check (
    (lifecycle_status = 'active' and deleted_at is null and deleted_by_user_id is null)
    or (lifecycle_status = 'deleted' and deleted_at is not null and deleted_by_user_id is not null)
  )
);

-- Orte gehören in Schnitt 3 genau zu einem TravelItem-Aggregat. Der
-- verzögerte FK erlaubt, die zufällige Item-ID bereits für Orte zu verwenden,
-- bevor die Basiszeile innerhalb derselben atomaren RPC angelegt wird.
alter table public.locations
  add column if not exists owner_travel_item_id uuid;
alter table public.locations
  alter column owner_travel_item_id set not null;
alter table public.locations
  add constraint locations_owner_travel_item_fkey
  foreign key (owner_travel_item_id)
  references public.travel_items (id)
  on delete restrict
  deferrable initially deferred;

create table if not exists public.travel_item_revisions (
  id uuid primary key default gen_random_uuid(),
  travel_item_id uuid not null references public.travel_items (id) on delete restrict,
  version_number bigint not null check (version_number > 0),
  change_kind text not null check (change_kind in ('created_manual', 'edited_manual', 'booking_cancelled', 'deleted')),
  changed_by_user_id uuid not null references public.users (id) on delete restrict,
  changed_at timestamptz not null default timezone('utc', now()),
  domain_snapshot_version integer not null default 1 check (domain_snapshot_version > 0),
  snapshot jsonb not null,
  unique (travel_item_id, version_number)
);

create table if not exists public.accommodation_details (
  travel_item_id uuid primary key references public.travel_items (id) on delete restrict,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint accommodation_details_object check (jsonb_typeof(details) = 'object')
);

create table if not exists public.flight_details (
  travel_item_id uuid primary key references public.travel_items (id) on delete restrict,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint flight_details_object check (jsonb_typeof(details) = 'object')
);

create table if not exists public.rail_details (
  travel_item_id uuid primary key references public.travel_items (id) on delete restrict,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint rail_details_object check (jsonb_typeof(details) = 'object')
);

create table if not exists public.bus_details (
  travel_item_id uuid primary key references public.travel_items (id) on delete restrict,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint bus_details_object check (jsonb_typeof(details) = 'object')
);

create table if not exists public.activity_details (
  travel_item_id uuid primary key references public.travel_items (id) on delete restrict,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint activity_details_object check (jsonb_typeof(details) = 'object')
);

create table if not exists public.flight_segments (
  id uuid primary key default gen_random_uuid(),
  travel_item_id uuid not null references public.travel_items (id) on delete restrict,
  sequence_number integer not null check (sequence_number > 0),
  start_location_id uuid not null references public.locations (id) on delete restrict,
  end_location_id uuid not null references public.locations (id) on delete restrict,
  departure_time jsonb not null,
  arrival_time jsonb not null,
  details jsonb not null default '{}'::jsonb,
  constraint flight_segments_time_object check (jsonb_typeof(departure_time) = 'object' and jsonb_typeof(arrival_time) = 'object'),
  constraint flight_segments_details_object check (jsonb_typeof(details) = 'object'),
  unique (travel_item_id, sequence_number)
);

create table if not exists public.rail_segments (
  id uuid primary key default gen_random_uuid(),
  travel_item_id uuid not null references public.travel_items (id) on delete restrict,
  sequence_number integer not null check (sequence_number > 0),
  start_location_id uuid not null references public.locations (id) on delete restrict,
  end_location_id uuid not null references public.locations (id) on delete restrict,
  departure_time jsonb not null,
  arrival_time jsonb not null,
  details jsonb not null default '{}'::jsonb,
  constraint rail_segments_time_object check (jsonb_typeof(departure_time) = 'object' and jsonb_typeof(arrival_time) = 'object'),
  constraint rail_segments_details_object check (jsonb_typeof(details) = 'object'),
  unique (travel_item_id, sequence_number)
);

create table if not exists public.bus_segments (
  id uuid primary key default gen_random_uuid(),
  travel_item_id uuid not null references public.travel_items (id) on delete restrict,
  sequence_number integer not null check (sequence_number > 0),
  start_location_id uuid not null references public.locations (id) on delete restrict,
  end_location_id uuid not null references public.locations (id) on delete restrict,
  departure_time jsonb not null,
  arrival_time jsonb not null,
  details jsonb not null default '{}'::jsonb,
  constraint bus_segments_time_object check (jsonb_typeof(departure_time) = 'object' and jsonb_typeof(arrival_time) = 'object'),
  constraint bus_segments_details_object check (jsonb_typeof(details) = 'object'),
  unique (travel_item_id, sequence_number)
);

create table if not exists private.travel_item_mutations (
  actor_id uuid not null references public.users (id) on delete restrict,
  idempotency_key text not null,
  action text not null check (action in ('create', 'update', 'delete')),
  travel_item_id uuid references public.travel_items (id) on delete restrict,
  version_number bigint,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (actor_id, idempotency_key),
  constraint travel_item_mutation_key_not_blank check (length(btrim(idempotency_key)) between 1 and 200)
);

create index if not exists locations_trip_idx on public.locations (trip_id);
create index if not exists locations_owner_travel_item_idx on public.locations (owner_travel_item_id);
create index if not exists locations_created_by_user_idx on public.locations (created_by_user_id);
create index if not exists locations_updated_by_user_idx on public.locations (updated_by_user_id);
create index if not exists travel_items_timeline_idx
  on public.travel_items (trip_id, start_local_date, start_precision, start_instant_utc, stable_sort_key)
  where lifecycle_status = 'active';
create index if not exists travel_items_type_idx on public.travel_items (trip_id, event_type_code)
  where lifecycle_status = 'active';
create index if not exists travel_items_main_location_idx on public.travel_items (main_location_id);
create index if not exists travel_items_start_location_idx on public.travel_items (start_location_id);
create index if not exists travel_items_end_location_idx on public.travel_items (end_location_id);
create index if not exists travel_items_event_type_idx on public.travel_items (event_type_code);
create index if not exists travel_items_created_by_user_idx on public.travel_items (created_by_user_id);
create index if not exists travel_items_updated_by_user_idx on public.travel_items (updated_by_user_id);
create index if not exists travel_items_deleted_by_user_idx on public.travel_items (deleted_by_user_id);
create index if not exists travel_item_revisions_changed_idx
  on public.travel_item_revisions (travel_item_id, changed_at desc);
create index if not exists travel_item_revisions_changed_by_user_idx
  on public.travel_item_revisions (changed_by_user_id);
create index if not exists flight_segments_location_idx on public.flight_segments (start_location_id, end_location_id);
create index if not exists flight_segments_end_location_idx on public.flight_segments (end_location_id);
create index if not exists rail_segments_location_idx on public.rail_segments (start_location_id, end_location_id);
create index if not exists rail_segments_end_location_idx on public.rail_segments (end_location_id);
create index if not exists bus_segments_location_idx on public.bus_segments (start_location_id, end_location_id);
create index if not exists bus_segments_end_location_idx on public.bus_segments (end_location_id);
create index if not exists travel_item_mutations_travel_item_idx
  on private.travel_item_mutations (travel_item_id);

create or replace function private.assert_json_object_keys(
  p_value jsonb,
  p_allowed_keys text[],
  p_label text
)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_key text;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception using errcode = 'P0001', message = p_label || ': Objekt erwartet';
  end if;
  for v_key in select jsonb_object_keys(p_value) loop
    if not (v_key = any(p_allowed_keys)) then
      raise exception using errcode = 'P0001', message = p_label || ': unbekanntes Feld ' || v_key;
    end if;
  end loop;
end;
$$;

create or replace function private.assert_optional_text(
  p_value jsonb,
  p_key text,
  p_max_length integer,
  p_label text
)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_value ? p_key and p_value -> p_key <> 'null'::jsonb then
    if jsonb_typeof(p_value -> p_key) <> 'string'
      or length(p_value ->> p_key) > p_max_length then
      raise exception using errcode = 'P0001', message = p_label || ': ungültiger oder zu langer Textwert';
    end if;
  end if;
end;
$$;

create or replace function private.validate_location_payload(p_location jsonb, p_label text)
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_key text;
begin
  if p_location is null or p_location = 'null'::jsonb or p_location = '{}'::jsonb then
    return;
  end if;
  perform private.assert_json_object_keys(
    p_location,
    array['id', 'name', 'full_address', 'street', 'house_number', 'postal_code',
      'city', 'region', 'country_code', 'location_code_type', 'location_code',
      'latitude', 'longitude', 'iana_time_zone'],
    p_label
  );
  perform private.assert_optional_text(p_location, 'id', 36, p_label || ' ID');
  perform private.assert_optional_text(p_location, 'name', 240, p_label || ' Name');
  perform private.assert_optional_text(p_location, 'full_address', 1000, p_label || ' Adresse');
  perform private.assert_optional_text(p_location, 'street', 240, p_label || ' Straße');
  perform private.assert_optional_text(p_location, 'house_number', 40, p_label || ' Hausnummer');
  perform private.assert_optional_text(p_location, 'postal_code', 40, p_label || ' Postleitzahl');
  perform private.assert_optional_text(p_location, 'city', 240, p_label || ' Stadt');
  perform private.assert_optional_text(p_location, 'region', 240, p_label || ' Region');
  perform private.assert_optional_text(p_location, 'country_code', 2, p_label || ' Land');
  perform private.assert_optional_text(p_location, 'location_code_type', 40, p_label || ' Codeart');
  perform private.assert_optional_text(p_location, 'location_code', 80, p_label || ' Code');
  perform private.assert_optional_text(p_location, 'iana_time_zone', 100, p_label || ' Zeitzone');
  foreach v_key in array array['latitude', 'longitude'] loop
    if p_location ? v_key and p_location -> v_key <> 'null'::jsonb
      and jsonb_typeof(p_location -> v_key) <> 'number' then
      raise exception using errcode = 'P0001', message = p_label || ': Koordinate ist keine Zahl';
    end if;
  end loop;
end;
$$;

create or replace function private.validate_payload_schema(p_event_type text, p_payload jsonb)
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_common jsonb := coalesce(p_payload -> 'common_details', '{}'::jsonb);
  v_locations jsonb := coalesce(p_payload -> 'locations', '{}'::jsonb);
  v_type_details jsonb := coalesce(p_payload -> 'type_details', '{}'::jsonb);
  v_segments jsonb := coalesce(p_payload -> 'segments', '[]'::jsonb);
  v_entry jsonb;
  v_key text;
  v_value jsonb;
  v_allowed_type_keys text[];
  v_allowed_segment_keys constant text[] := array[
    'operator', 'number', 'departure_facility_code', 'arrival_facility_code',
    'departure_terminal_or_platform', 'arrival_terminal_or_platform',
    'passenger_names', 'seat', 'cabin_or_booking_class', 'reservation_status',
    'ticket_or_booking_numbers', 'baggage_and_services', 'duration',
    'transfer_duration', 'conditions'
  ];
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or octet_length(p_payload::text) > 262144 then
    raise exception using errcode = 'P0001', message = 'Ereignisdaten sind ungültig oder zu groß';
  end if;
  perform private.assert_json_object_keys(
    p_payload,
    array['event_type_code', 'title', 'booking_status', 'start_time', 'end_time',
      'locations', 'common_details', 'type_details', 'segments'],
    'Ereignis'
  );
  if jsonb_typeof(p_payload -> 'event_type_code') <> 'string'
    or jsonb_typeof(p_payload -> 'title') <> 'string'
    or (p_payload ? 'booking_status' and jsonb_typeof(p_payload -> 'booking_status') <> 'string') then
    raise exception using errcode = 'P0001', message = 'Ereigniskern besitzt ungültige Feldtypen';
  end if;
  perform private.assert_json_object_keys(v_locations, array['main', 'start', 'end'], 'Orte');
  perform private.validate_location_payload(v_locations -> 'main', 'Hauptort');
  perform private.validate_location_payload(v_locations -> 'start', 'Startort');
  perform private.validate_location_payload(v_locations -> 'end', 'Zielort');

  if octet_length(v_common::text) > 65536 then
    raise exception using errcode = 'P0001', message = 'Gemeinsame Detaildaten sind zu groß';
  end if;
  perform private.assert_json_object_keys(
    v_common,
    array['provider_name', 'booking_platform_name', 'management_url', 'booking_date',
      'notes', 'references', 'travelers', 'provider_contacts', 'price',
      'cancellation_deadline', 'cancellation_conditions', 'additional_attributes'],
    'Gemeinsame Details'
  );
  perform private.assert_optional_text(v_common, 'provider_name', 240, 'Anbieter');
  perform private.assert_optional_text(v_common, 'booking_platform_name', 240, 'Buchungsplattform');
  perform private.assert_optional_text(v_common, 'management_url', 2048, 'Verwaltungslink');
  perform private.assert_optional_text(v_common, 'booking_date', 10, 'Buchungsdatum');
  perform private.assert_optional_text(v_common, 'notes', 20000, 'Notizen');
  perform private.assert_optional_text(v_common, 'cancellation_conditions', 10000, 'Stornierungsbedingungen');

  if v_common ? 'references' then
    if jsonb_typeof(v_common -> 'references') <> 'array' or jsonb_array_length(v_common -> 'references') > 50 then
      raise exception using errcode = 'P0001', message = 'Referenzen sind ungültig oder zu zahlreich';
    end if;
    for v_entry in select value from jsonb_array_elements(v_common -> 'references') loop
      perform private.assert_json_object_keys(v_entry, array['kind', 'value'], 'Referenz');
      perform private.assert_optional_text(v_entry, 'kind', 20, 'Referenzart');
      perform private.assert_optional_text(v_entry, 'value', 500, 'Referenzwert');
      if coalesce(v_entry ->> 'kind', '') not in ('booking', 'reservation', 'order', 'ticket', 'voucher', 'other')
        or nullif(v_entry ->> 'value', '') is null then
        raise exception using errcode = 'P0001', message = 'Referenz ist ungültig';
      end if;
    end loop;
  end if;

  if v_common ? 'travelers' then
    if jsonb_typeof(v_common -> 'travelers') <> 'array' or jsonb_array_length(v_common -> 'travelers') > 50 then
      raise exception using errcode = 'P0001', message = 'Reisende sind ungültig oder zu zahlreich';
    end if;
    for v_value in select value from jsonb_array_elements(v_common -> 'travelers') loop
      if jsonb_typeof(v_value) <> 'string' or length(v_value #>> '{}') not between 1 and 240 then
        raise exception using errcode = 'P0001', message = 'Reisendenname ist ungültig';
      end if;
    end loop;
  end if;

  if v_common ? 'provider_contacts' then
    if jsonb_typeof(v_common -> 'provider_contacts') <> 'array' or jsonb_array_length(v_common -> 'provider_contacts') > 20 then
      raise exception using errcode = 'P0001', message = 'Kontakte sind ungültig oder zu zahlreich';
    end if;
    for v_entry in select value from jsonb_array_elements(v_common -> 'provider_contacts') loop
      perform private.assert_json_object_keys(v_entry, array['role', 'phone', 'email', 'website'], 'Kontakt');
      perform private.assert_optional_text(v_entry, 'role', 120, 'Kontaktrolle');
      perform private.assert_optional_text(v_entry, 'phone', 120, 'Telefon');
      perform private.assert_optional_text(v_entry, 'email', 320, 'E-Mail');
      perform private.assert_optional_text(v_entry, 'website', 2048, 'Website');
    end loop;
  end if;

  if v_common ? 'price' then
    perform private.assert_json_object_keys(
      v_common -> 'price',
      array['total', 'currency', 'paid', 'outstanding', 'taxes_and_fees',
        'payment_status', 'payment_method_masked'],
      'Preis'
    );
    foreach v_key in array array['total', 'paid', 'outstanding', 'taxes_and_fees',
      'payment_status', 'payment_method_masked'] loop
      perform private.assert_optional_text(v_common -> 'price', v_key, 120, 'Preisfeld ' || v_key);
    end loop;
    perform private.assert_optional_text(v_common -> 'price', 'currency', 3, 'Währung');
  end if;

  if v_common ? 'additional_attributes' then
    if jsonb_typeof(v_common -> 'additional_attributes') <> 'array'
      or jsonb_array_length(v_common -> 'additional_attributes') > 50 then
      raise exception using errcode = 'P0001', message = 'Zusatzangaben sind ungültig oder zu zahlreich';
    end if;
    for v_entry in select value from jsonb_array_elements(v_common -> 'additional_attributes') loop
      perform private.assert_json_object_keys(v_entry, array['label', 'value', 'unit'], 'Zusatzangabe');
      perform private.assert_optional_text(v_entry, 'label', 120, 'Zusatzbezeichnung');
      perform private.assert_optional_text(v_entry, 'value', 2000, 'Zusatzwert');
      perform private.assert_optional_text(v_entry, 'unit', 40, 'Zusatzeinheit');
      if nullif(v_entry ->> 'label', '') is null or nullif(v_entry ->> 'value', '') is null then
        raise exception using errcode = 'P0001', message = 'Zusatzangabe benötigt Bezeichnung und Wert';
      end if;
    end loop;
  end if;

  if p_event_type = 'accommodation' then
    v_allowed_type_keys := array['accommodation_name', 'accommodation_type', 'check_in_date',
      'check_in_time_window', 'check_out_date', 'check_out_time_window', 'nights',
      'rooms', 'guests', 'room_name', 'room_number', 'floor', 'bed_configuration',
      'guest_names', 'meal_plan', 'check_in_method', 'access_instructions', 'access_code',
      'reception_contact', 'host_contact', 'emergency_contact', 'special_requests',
      'deposit', 'tourist_tax', 'payment_plan', 'booking_conditions', 'cancellation_conditions'];
  elsif p_event_type = 'flight' then
    v_allowed_type_keys := array['marketing_carrier', 'operating_carrier', 'flight_number',
      'booking_code', 'ticket_number', 'flight_status', 'passenger_names', 'seat',
      'cabin_class', 'booking_class', 'fare_class', 'checked_baggage', 'hand_baggage',
      'booked_services', 'check_in_window', 'check_in_link', 'ticket_conditions',
      'fare_conditions', 'rebooking_conditions', 'cancellation_conditions'];
  elsif p_event_type = 'rail' then
    v_allowed_type_keys := array['operator', 'train_type', 'train_number', 'line_name',
      'traveler_names', 'coach', 'seat', 'class', 'reservation_status', 'ticket_numbers',
      'ticket_type', 'validity_period', 'train_binding', 'fare', 'discount',
      'ticket_conditions', 'rebooking_conditions', 'cancellation_conditions'];
  elsif p_event_type = 'bus' then
    v_allowed_type_keys := array['operator', 'route_number', 'traveler_names', 'seat',
      'comfort_class', 'reservation_status', 'ticket_numbers', 'ticket_type',
      'validity_period', 'baggage_rules', 'booked_services', 'ticket_conditions',
      'rebooking_conditions', 'cancellation_conditions'];
  else
    v_allowed_type_keys := array['category', 'provider', 'venue_name', 'meeting_point',
      'end_point', 'admission_time', 'meeting_time', 'duration', 'participant_names',
      'participant_count', 'ticket_number', 'ticket_type', 'ticket_count', 'seat_or_area',
      'language', 'included_services', 'excluded_services', 'requirements', 'practical_notes',
      'accessibility', 'contact', 'rebooking_conditions', 'cancellation_conditions'];
  end if;
  if octet_length(v_type_details::text) > 65536 then
    raise exception using errcode = 'P0001', message = 'Typspezifische Details sind zu groß';
  end if;
  perform private.assert_json_object_keys(v_type_details, v_allowed_type_keys, 'Typspezifische Details');
  for v_key, v_value in select key, value from jsonb_each(v_type_details) loop
    if jsonb_typeof(v_value) <> 'string' or length(v_value #>> '{}') > 10000 then
      raise exception using errcode = 'P0001', message = 'Typspezifisches Feld ist ungültig oder zu lang';
    end if;
  end loop;

  if jsonb_typeof(v_segments) <> 'array' or jsonb_array_length(v_segments) > 20 then
    raise exception using errcode = 'P0001', message = 'Teilstrecken sind ungültig oder zu zahlreich';
  end if;
  if p_event_type not in ('flight', 'rail', 'bus') and jsonb_array_length(v_segments) > 0 then
    raise exception using errcode = 'P0001', message = 'Diese Ereignisart unterstützt keine Teilstrecken';
  end if;
  for v_entry in select value from jsonb_array_elements(v_segments) loop
    perform private.assert_json_object_keys(
      v_entry,
      array['id', 'sequence_number', 'start_location', 'end_location', 'departure_time',
        'arrival_time', 'details'],
      'Teilstrecke'
    );
    perform private.validate_location_payload(v_entry -> 'start_location', 'Startort Teilstrecke');
    perform private.validate_location_payload(v_entry -> 'end_location', 'Zielort Teilstrecke');
    if v_entry ? 'id' then
      perform private.assert_optional_text(v_entry, 'id', 36, 'Teilstrecken-ID');
    end if;
    if v_entry ? 'sequence_number' and jsonb_typeof(v_entry -> 'sequence_number') <> 'number' then
      raise exception using errcode = 'P0001', message = 'Teilstreckennummer ist ungültig';
    end if;
    if octet_length(coalesce(v_entry -> 'details', '{}'::jsonb)::text) > 32768 then
      raise exception using errcode = 'P0001', message = 'Teilstreckendetails sind zu groß';
    end if;
    perform private.assert_json_object_keys(coalesce(v_entry -> 'details', '{}'::jsonb), v_allowed_segment_keys, 'Teilstreckendetails');
    for v_key, v_value in select key, value from jsonb_each(coalesce(v_entry -> 'details', '{}'::jsonb)) loop
      if jsonb_typeof(v_value) <> 'string' or length(v_value #>> '{}') > 10000 then
        raise exception using errcode = 'P0001', message = 'Teilstreckendetail ist ungültig oder zu lang';
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function private.validate_local_time(p_value jsonb, p_label text)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_precision text;
  v_resolution text;
  v_date date;
  v_local timestamp without time zone;
  v_instant timestamptz;
  v_zone text;
  v_offset integer;
  v_expected_offset integer;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception using errcode = 'P0001', message = p_label || ': Zeitwert fehlt';
  end if;
  perform private.assert_json_object_keys(
    p_value,
    array['local_date', 'local_time', 'precision', 'iana_time_zone',
      'utc_offset_minutes', 'instant_utc', 'resolution_status'],
    p_label
  );
  if jsonb_typeof(p_value -> 'local_date') <> 'string'
    or jsonb_typeof(p_value -> 'precision') <> 'string'
    or jsonb_typeof(p_value -> 'resolution_status') <> 'string' then
    raise exception using errcode = 'P0001', message = p_label || ': Zeitfelder besitzen einen ungültigen Typ';
  end if;
  perform private.assert_optional_text(p_value, 'local_time', 8, p_label || ' Uhrzeit');
  perform private.assert_optional_text(p_value, 'iana_time_zone', 100, p_label || ' Zeitzone');
  perform private.assert_optional_text(p_value, 'instant_utc', 40, p_label || ' UTC-Instant');
  if p_value ? 'utc_offset_minutes' and p_value -> 'utc_offset_minutes' <> 'null'::jsonb
    and jsonb_typeof(p_value -> 'utc_offset_minutes') <> 'number' then
    raise exception using errcode = 'P0001', message = p_label || ': UTC-Offset ist ungültig';
  end if;

  v_precision := p_value ->> 'precision';
  v_resolution := p_value ->> 'resolution_status';
  if v_precision not in ('exact_time', 'date_only', 'unknown_time') then
    raise exception using errcode = 'P0001', message = p_label || ': unbekannte Zeitpräzision';
  end if;
  if (p_value ->> 'local_date') is null or (p_value ->> 'local_date') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception using errcode = 'P0001', message = p_label || ': gültiges lokales Datum fehlt';
  end if;
  v_date := (p_value ->> 'local_date')::date;

  v_zone := nullif(btrim(p_value ->> 'iana_time_zone'), '');
  if v_zone is not null and not exists (select 1 from pg_timezone_names where name = v_zone) then
    raise exception using errcode = 'P0001', message = p_label || ': unbekannte IANA-Zeitzone';
  end if;

  if v_precision = 'exact_time' then
    if (p_value ->> 'local_time') is null or (p_value ->> 'local_time') !~ '^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$' then
      raise exception using errcode = 'P0001', message = p_label || ': exakte Uhrzeit fehlt';
    end if;
    if v_zone is null or (p_value ->> 'utc_offset_minutes') is null or (p_value ->> 'instant_utc') is null then
      raise exception using errcode = 'P0001', message = p_label || ': Zeitzone, Offset und UTC-Instant sind erforderlich';
    end if;
    if v_resolution <> 'resolved' then
      raise exception using errcode = 'P0001', message = p_label || ': mehrdeutige oder nicht existente Ortszeit';
    end if;
    v_local := v_date + (p_value ->> 'local_time')::time;
    v_instant := (p_value ->> 'instant_utc')::timestamptz;
    v_offset := (p_value ->> 'utc_offset_minutes')::integer;
    if v_local <> (v_instant at time zone v_zone) then
      raise exception using errcode = 'P0001', message = p_label || ': lokale Zeit und UTC-Instant passen nicht zusammen';
    end if;
    v_expected_offset := round(extract(epoch from (v_local - (v_instant at time zone 'UTC'))) / 60)::integer;
    if v_offset <> v_expected_offset then
      raise exception using errcode = 'P0001', message = p_label || ': UTC-Offset passt nicht zur Ortszeit';
    end if;
  else
    if (p_value ->> 'local_time') is not null or (p_value ->> 'instant_utc') is not null or (p_value ->> 'utc_offset_minutes') is not null then
      raise exception using errcode = 'P0001', message = p_label || ': Datum ohne Uhrzeit darf keinen Instant enthalten';
    end if;
    if v_resolution <> v_precision then
      raise exception using errcode = 'P0001', message = p_label || ': Zeitauflösung ist inkonsistent';
    end if;
  end if;
end;
$$;

create or replace function private.validate_time_order(p_start jsonb, p_end jsonb, p_label text)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_start_date date := (p_start ->> 'local_date')::date;
  v_end_date date := (p_end ->> 'local_date')::date;
begin
  if v_end_date < v_start_date then
    raise exception using errcode = 'P0001', message = p_label || ': Ende liegt vor dem Beginn';
  end if;
  if p_start ->> 'precision' = 'exact_time' and p_end ->> 'precision' = 'exact_time'
    and (p_end ->> 'instant_utc')::timestamptz < (p_start ->> 'instant_utc')::timestamptz then
    raise exception using errcode = 'P0001', message = p_label || ': Ende liegt vor dem Beginn';
  end if;
end;
$$;

create or replace function private.reject_sensitive_payload(p_value jsonb)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if coalesce(p_value::text, '') ~* '"(password|passwd|secret|token|api[_-]?key|cvv|cvc|card[_-]?number|iban|authorization)"\s*:' then
    raise exception using errcode = 'P0001', message = 'Geheime oder vollständige Zahlungsdaten sind nicht speicherbar';
  end if;
end;
$$;

create or replace function private.upsert_location(
  p_trip_id uuid,
  p_item_id uuid,
  p_location jsonb,
  p_actor_id uuid
)
returns uuid
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_name text;
  v_latitude numeric;
  v_longitude numeric;
  v_zone text;
begin
  if p_location is null or p_location = 'null'::jsonb or p_location = '{}'::jsonb then
    return null;
  end if;
  perform private.validate_location_payload(p_location, 'Ort');
  if jsonb_typeof(p_location) <> 'object' then
    raise exception using errcode = 'P0001', message = 'Ort ist ungültig';
  end if;
  v_name := nullif(btrim(p_location ->> 'name'), '');
  if v_name is null or length(v_name) > 240 then
    raise exception using errcode = 'P0001', message = 'Ort benötigt einen Namen';
  end if;
  v_zone := nullif(btrim(p_location ->> 'iana_time_zone'), '');
  if v_zone is not null and not exists (select 1 from pg_timezone_names where name = v_zone) then
    raise exception using errcode = 'P0001', message = 'Ort besitzt eine unbekannte IANA-Zeitzone';
  end if;
  if (p_location ->> 'latitude') is not null then
    v_latitude := (p_location ->> 'latitude')::numeric;
    v_longitude := (p_location ->> 'longitude')::numeric;
    if v_latitude not between -90 and 90 or v_longitude not between -180 and 180 then
      raise exception using errcode = 'P0001', message = 'Koordinaten liegen außerhalb des gültigen Bereichs';
    end if;
  end if;

  if (p_location ->> 'id') is not null then
    v_id := (p_location ->> 'id')::uuid;
    if not exists (
      select 1
      from public.locations
      where id = v_id
        and trip_id = p_trip_id
        and owner_travel_item_id = p_item_id
    ) then
      raise exception using errcode = '42501', message = 'Ort gehört nicht zu diesem Ereignis';
    end if;
    update public.locations
    set name = v_name,
        full_address = nullif(btrim(p_location ->> 'full_address'), ''),
        street = nullif(btrim(p_location ->> 'street'), ''),
        house_number = nullif(btrim(p_location ->> 'house_number'), ''),
        postal_code = nullif(btrim(p_location ->> 'postal_code'), ''),
        city = nullif(btrim(p_location ->> 'city'), ''),
        region = nullif(btrim(p_location ->> 'region'), ''),
        country_code = nullif(upper(btrim(p_location ->> 'country_code')), ''),
        location_code_type = nullif(btrim(p_location ->> 'location_code_type'), ''),
        location_code = nullif(btrim(p_location ->> 'location_code'), ''),
        latitude = v_latitude,
        longitude = v_longitude,
        iana_time_zone = v_zone,
        updated_at = timezone('utc', now()),
        updated_by_user_id = p_actor_id,
        version = version + 1
    where id = v_id;
    return v_id;
  end if;

  insert into public.locations (
    trip_id, owner_travel_item_id, name, full_address, street, house_number, postal_code, city, region,
    country_code, location_code_type, location_code, latitude, longitude,
    iana_time_zone, created_by_user_id, updated_by_user_id
  ) values (
    p_trip_id, p_item_id, v_name, nullif(btrim(p_location ->> 'full_address'), ''),
    nullif(btrim(p_location ->> 'street'), ''), nullif(btrim(p_location ->> 'house_number'), ''),
    nullif(btrim(p_location ->> 'postal_code'), ''), nullif(btrim(p_location ->> 'city'), ''),
    nullif(btrim(p_location ->> 'region'), ''), nullif(upper(btrim(p_location ->> 'country_code')), ''),
    nullif(btrim(p_location ->> 'location_code_type'), ''), nullif(btrim(p_location ->> 'location_code'), ''),
    v_latitude, v_longitude, v_zone, p_actor_id, p_actor_id
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.validate_transport_segments(
  p_event_type text,
  p_segments jsonb
)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_segment jsonb;
  v_index integer := 0;
  v_count integer;
  v_sequence integer;
  v_previous_arrival jsonb;
begin
  if p_segments is null or p_segments = 'null'::jsonb then
    p_segments := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_segments) <> 'array' then
    raise exception using errcode = 'P0001', message = 'Teilstrecken müssen eine Liste sein';
  end if;
  v_count := jsonb_array_length(p_segments);
  if p_event_type in ('flight', 'rail', 'bus') and v_count = 1 then
    raise exception using errcode = 'P0001', message = 'Ein Verkehrsereignis benötigt mindestens zwei geordnete Teilstrecken';
  end if;
  for v_segment in select value from jsonb_array_elements(p_segments) loop
    v_index := v_index + 1;
    if jsonb_typeof(v_segment) <> 'object' then
      raise exception using errcode = 'P0001', message = 'Teilstrecke ist ungültig';
    end if;
    v_sequence := coalesce((v_segment ->> 'sequence_number')::integer, v_index);
    if v_sequence <> v_index then
      raise exception using errcode = 'P0001', message = 'Teilstrecken müssen lückenlos sortiert sein';
    end if;
    perform private.validate_local_time(v_segment -> 'departure_time', 'Abfahrt Teilstrecke ' || v_index);
    perform private.validate_local_time(v_segment -> 'arrival_time', 'Ankunft Teilstrecke ' || v_index);
    perform private.validate_time_order(v_segment -> 'departure_time', v_segment -> 'arrival_time', 'Teilstrecke ' || v_index);
    if v_previous_arrival is not null then
      perform private.validate_time_order(
        v_previous_arrival,
        v_segment -> 'departure_time',
        'Übergang zu Teilstrecke ' || v_index
      );
    end if;
    if nullif(btrim(v_segment -> 'start_location' ->> 'name'), '') is null
      or nullif(btrim(v_segment -> 'end_location' ->> 'name'), '') is null then
      raise exception using errcode = 'P0001', message = 'Jede Teilstrecke benötigt Start- und Zielort';
    end if;
    v_previous_arrival := v_segment -> 'arrival_time';
  end loop;
end;
$$;

create or replace function private.replace_travel_item_aggregate(
  p_item_id uuid,
  p_trip_id uuid,
  p_payload jsonb,
  p_actor_id uuid,
  p_is_create boolean
)
returns uuid
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_item_id uuid := coalesce(p_item_id, gen_random_uuid());
  v_event_type text := p_payload ->> 'event_type_code';
  v_title text := nullif(btrim(p_payload ->> 'title'), '');
  v_booking_status text := coalesce(nullif(p_payload ->> 'booking_status', ''), 'unknown');
  v_start_time jsonb := p_payload -> 'start_time';
  v_end_time jsonb := p_payload -> 'end_time';
  v_segments jsonb := coalesce(p_payload -> 'segments', '[]'::jsonb);
  v_common jsonb := coalesce(p_payload -> 'common_details', '{}'::jsonb);
  v_type_details jsonb := coalesce(p_payload -> 'type_details', '{}'::jsonb);
  v_main_location uuid;
  v_start_location uuid;
  v_end_location uuid;
  v_segment jsonb;
  v_index integer := 0;
  v_booking_date date;
  v_first_segment jsonb;
  v_last_segment jsonb;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = 'P0001', message = 'Ereignisdaten sind ungültig';
  end if;
  if not exists (
    select 1 from public.event_type_definitions
    where code = v_event_type and is_active
  ) then
    raise exception using errcode = 'P0001', message = 'Ereignisart wird nicht unterstützt';
  end if;
  perform private.validate_payload_schema(v_event_type, p_payload);
  if v_title is null or length(v_title) > 240 then
    raise exception using errcode = 'P0001', message = 'Ereignis benötigt einen Titel';
  end if;
  if v_booking_status not in ('confirmed', 'cancelled', 'unknown') then
    raise exception using errcode = 'P0001', message = 'Buchungsstatus ist ungültig';
  end if;
  if jsonb_typeof(v_common) <> 'object' or jsonb_typeof(v_type_details) <> 'object' then
    raise exception using errcode = 'P0001', message = 'Detaildaten sind ungültig';
  end if;
  if nullif(btrim(v_common ->> 'management_url'), '') is not null
    and btrim(v_common ->> 'management_url') !~* '^https?://' then
    raise exception using errcode = 'P0001', message = 'Links müssen mit http:// oder https:// beginnen';
  end if;
  if v_common ? 'cancellation_deadline'
    and v_common -> 'cancellation_deadline' is not null
    and v_common -> 'cancellation_deadline' <> 'null'::jsonb then
    perform private.validate_local_time(v_common -> 'cancellation_deadline', 'Stornierungsfrist');
  end if;
  if v_segments is null or v_segments = 'null'::jsonb then
    v_segments := '[]'::jsonb;
  end if;
  perform private.reject_sensitive_payload(p_payload);
  perform private.validate_local_time(v_start_time, 'Beginn');
  if v_end_time is not null and v_end_time <> 'null'::jsonb then
    perform private.validate_local_time(v_end_time, 'Ende');
    perform private.validate_time_order(v_start_time, v_end_time, 'Ereignis');
  else
    v_end_time := null;
  end if;
  perform private.validate_transport_segments(v_event_type, v_segments);

  if jsonb_array_length(v_segments) > 0 then
    v_first_segment := v_segments -> 0;
    v_last_segment := v_segments -> (jsonb_array_length(v_segments) - 1);
    v_start_time := v_first_segment -> 'departure_time';
    v_end_time := v_last_segment -> 'arrival_time';
    perform private.validate_local_time(v_start_time, 'Beginn aus erster Teilstrecke');
    perform private.validate_local_time(v_end_time, 'Ende aus letzter Teilstrecke');
    perform private.validate_time_order(v_start_time, v_end_time, 'Gesamte Teilstrecken');
  end if;

  v_main_location := private.upsert_location(p_trip_id, v_item_id, p_payload -> 'locations' -> 'main', p_actor_id);
  v_start_location := private.upsert_location(p_trip_id, v_item_id, p_payload -> 'locations' -> 'start', p_actor_id);
  v_end_location := private.upsert_location(p_trip_id, v_item_id, p_payload -> 'locations' -> 'end', p_actor_id);
  v_booking_date := nullif(v_common ->> 'booking_date', '')::date;

  if p_is_create then
    insert into public.travel_items (
      id, trip_id, event_type_code, title, booking_status, lifecycle_status,
      creation_source, start_time, end_time, start_local_date, start_local_time,
      start_precision, start_iana_time_zone, start_utc_offset_minutes, start_instant_utc,
      end_local_date, end_local_time, end_precision, end_iana_time_zone,
      end_utc_offset_minutes, end_instant_utc, main_location_id, start_location_id,
      end_location_id, provider_name, booking_platform_name, management_url,
      booking_date, notes, common_details, stable_sort_key, created_by_user_id,
      updated_by_user_id
    ) values (
      v_item_id, p_trip_id, v_event_type, v_title, v_booking_status, 'active',
      'manual', v_start_time, v_end_time, (v_start_time ->> 'local_date')::date,
      nullif(v_start_time ->> 'local_time', '')::time, v_start_time ->> 'precision',
      nullif(v_start_time ->> 'iana_time_zone', ''), nullif(v_start_time ->> 'utc_offset_minutes', '')::integer,
      nullif(v_start_time ->> 'instant_utc', '')::timestamptz,
      case when v_end_time is null then null else (v_end_time ->> 'local_date')::date end,
      case when v_end_time is null then null else nullif(v_end_time ->> 'local_time', '')::time end,
      case when v_end_time is null then null else v_end_time ->> 'precision' end,
      case when v_end_time is null then null else nullif(v_end_time ->> 'iana_time_zone', '') end,
      case when v_end_time is null then null else nullif(v_end_time ->> 'utc_offset_minutes', '')::integer end,
      case when v_end_time is null then null else nullif(v_end_time ->> 'instant_utc', '')::timestamptz end,
      v_main_location, v_start_location, v_end_location,
      nullif(btrim(v_common ->> 'provider_name'), ''),
      nullif(btrim(v_common ->> 'booking_platform_name'), ''),
      nullif(btrim(v_common ->> 'management_url'), ''),
      v_booking_date, nullif(v_common ->> 'notes', ''), v_common, v_item_id,
      p_actor_id, p_actor_id
    );
  else
    update public.travel_items
    set event_type_code = v_event_type,
        title = v_title,
        booking_status = v_booking_status,
        lifecycle_status = 'active',
        start_time = v_start_time,
        end_time = v_end_time,
        start_local_date = (v_start_time ->> 'local_date')::date,
        start_local_time = nullif(v_start_time ->> 'local_time', '')::time,
        start_precision = v_start_time ->> 'precision',
        start_iana_time_zone = nullif(v_start_time ->> 'iana_time_zone', ''),
        start_utc_offset_minutes = nullif(v_start_time ->> 'utc_offset_minutes', '')::integer,
        start_instant_utc = nullif(v_start_time ->> 'instant_utc', '')::timestamptz,
        end_local_date = case when v_end_time is null then null else (v_end_time ->> 'local_date')::date end,
        end_local_time = case when v_end_time is null then null else nullif(v_end_time ->> 'local_time', '')::time end,
        end_precision = case when v_end_time is null then null else v_end_time ->> 'precision' end,
        end_iana_time_zone = case when v_end_time is null then null else nullif(v_end_time ->> 'iana_time_zone', '') end,
        end_utc_offset_minutes = case when v_end_time is null then null else nullif(v_end_time ->> 'utc_offset_minutes', '')::integer end,
        end_instant_utc = case when v_end_time is null then null else nullif(v_end_time ->> 'instant_utc', '')::timestamptz end,
        main_location_id = v_main_location,
        start_location_id = v_start_location,
        end_location_id = v_end_location,
        provider_name = nullif(btrim(v_common ->> 'provider_name'), ''),
        booking_platform_name = nullif(btrim(v_common ->> 'booking_platform_name'), ''),
        management_url = nullif(btrim(v_common ->> 'management_url'), ''),
        booking_date = v_booking_date,
        notes = nullif(v_common ->> 'notes', ''),
        common_details = v_common,
        deleted_at = null,
        deleted_by_user_id = null
    where id = v_item_id;
    if not found then
      raise exception using errcode = '42501', message = 'Ereignis ist nicht verfügbar';
    end if;
  end if;

  delete from public.flight_segments where travel_item_id = v_item_id;
  delete from public.rail_segments where travel_item_id = v_item_id;
  delete from public.bus_segments where travel_item_id = v_item_id;
  delete from public.accommodation_details where travel_item_id = v_item_id;
  delete from public.flight_details where travel_item_id = v_item_id;
  delete from public.rail_details where travel_item_id = v_item_id;
  delete from public.bus_details where travel_item_id = v_item_id;
  delete from public.activity_details where travel_item_id = v_item_id;

  if v_event_type = 'accommodation' then
    insert into public.accommodation_details (travel_item_id, details) values (v_item_id, v_type_details);
  elsif v_event_type = 'flight' then
    insert into public.flight_details (travel_item_id, details) values (v_item_id, v_type_details);
  elsif v_event_type = 'rail' then
    insert into public.rail_details (travel_item_id, details) values (v_item_id, v_type_details);
  elsif v_event_type = 'bus' then
    insert into public.bus_details (travel_item_id, details) values (v_item_id, v_type_details);
  elsif v_event_type = 'activity' then
    insert into public.activity_details (travel_item_id, details) values (v_item_id, v_type_details);
  end if;

  for v_segment in select value from jsonb_array_elements(v_segments) loop
    v_index := v_index + 1;
    if v_event_type = 'flight' then
      insert into public.flight_segments (
        travel_item_id, sequence_number, start_location_id, end_location_id,
        departure_time, arrival_time, details
      ) values (
        v_item_id, v_index,
        private.upsert_location(p_trip_id, v_item_id, v_segment -> 'start_location', p_actor_id),
        private.upsert_location(p_trip_id, v_item_id, v_segment -> 'end_location', p_actor_id),
        v_segment -> 'departure_time', v_segment -> 'arrival_time',
        coalesce(v_segment -> 'details', '{}'::jsonb)
      );
    elsif v_event_type = 'rail' then
      insert into public.rail_segments (
        travel_item_id, sequence_number, start_location_id, end_location_id,
        departure_time, arrival_time, details
      ) values (
        v_item_id, v_index,
        private.upsert_location(p_trip_id, v_item_id, v_segment -> 'start_location', p_actor_id),
        private.upsert_location(p_trip_id, v_item_id, v_segment -> 'end_location', p_actor_id),
        v_segment -> 'departure_time', v_segment -> 'arrival_time',
        coalesce(v_segment -> 'details', '{}'::jsonb)
      );
    elsif v_event_type = 'bus' then
      insert into public.bus_segments (
        travel_item_id, sequence_number, start_location_id, end_location_id,
        departure_time, arrival_time, details
      ) values (
        v_item_id, v_index,
        private.upsert_location(p_trip_id, v_item_id, v_segment -> 'start_location', p_actor_id),
        private.upsert_location(p_trip_id, v_item_id, v_segment -> 'end_location', p_actor_id),
        v_segment -> 'departure_time', v_segment -> 'arrival_time',
        coalesce(v_segment -> 'details', '{}'::jsonb)
      );
    end if;
  end loop;

  return v_item_id;
end;
$$;

create or replace function private.travel_item_snapshot(p_item_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'travel_item', to_jsonb(item),
    'locations', jsonb_build_object(
      'main', (select to_jsonb(location) from public.locations location where location.id = item.main_location_id),
      'start', (select to_jsonb(location) from public.locations location where location.id = item.start_location_id),
      'end', (select to_jsonb(location) from public.locations location where location.id = item.end_location_id)
    ),
    'accommodation_details', (select to_jsonb(details) from public.accommodation_details details where details.travel_item_id = item.id),
    'flight_details', (select to_jsonb(details) from public.flight_details details where details.travel_item_id = item.id),
    'rail_details', (select to_jsonb(details) from public.rail_details details where details.travel_item_id = item.id),
    'bus_details', (select to_jsonb(details) from public.bus_details details where details.travel_item_id = item.id),
    'activity_details', (select to_jsonb(details) from public.activity_details details where details.travel_item_id = item.id),
    'segments', coalesce((
      select jsonb_agg(to_jsonb(segment) order by segment.sequence_number)
      from (
        select * from public.flight_segments where travel_item_id = item.id
        union all select * from public.rail_segments where travel_item_id = item.id
        union all select * from public.bus_segments where travel_item_id = item.id
      ) segment
    ), '[]'::jsonb)
  )
  from public.travel_items item
  where item.id = p_item_id;
$$;

create or replace function private.capture_travel_item_revision(
  p_item_id uuid,
  p_change_kind text,
  p_actor_id uuid
)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_version bigint;
begin
  select version into v_version from public.travel_items where id = p_item_id;
  insert into public.travel_item_revisions (
    travel_item_id, version_number, change_kind, changed_by_user_id, snapshot
  ) values (
    p_item_id, v_version, p_change_kind, p_actor_id, private.travel_item_snapshot(p_item_id)
  );
end;
$$;

create or replace function private.guard_travel_item_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.id <> old.id
    or new.trip_id <> old.trip_id
    or new.created_at <> old.created_at
    or new.created_by_user_id <> old.created_by_user_id
    or new.creation_source <> old.creation_source
    or new.stable_sort_key <> old.stable_sort_key then
    raise exception using errcode = '42501', message = 'Reisezuordnung und Herkunft eines Ereignisses sind unveränderlich';
  end if;
  new.version := old.version + 1;
  new.updated_at := timezone('utc', now());
  new.updated_by_user_id := coalesce((select auth.uid()), old.updated_by_user_id);
  return new;
end;
$$;

drop trigger if exists travel_items_update_guard on public.travel_items;
create trigger travel_items_update_guard
before update on public.travel_items
for each row execute function private.guard_travel_item_update();

create or replace function private.reject_revision_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception using errcode = '42501', message = 'TravelItemRevision ist unveränderlich';
end;
$$;

drop trigger if exists travel_item_revisions_immutable on public.travel_item_revisions;
create trigger travel_item_revisions_immutable
before update or delete on public.travel_item_revisions
for each row execute function private.reject_revision_mutation();

create or replace function public.create_travel_item(
  p_trip_id uuid,
  p_payload jsonb,
  p_idempotency_key text
)
returns table (operation_status text, travel_item_id uuid, version bigint, error_code text, error_message text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_item_id uuid;
  v_count bigint;
  v_previous private.travel_item_mutations%rowtype;
begin
  if v_actor_id is null or p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 1 and 200 then
    return query select 'forbidden', null::uuid, null::bigint, 'FORBIDDEN', 'Vorgang nicht verfügbar';
    return;
  end if;
  if not private.is_active_trip_member(p_trip_id) then
    return query select 'forbidden', null::uuid, null::bigint, 'FORBIDDEN', 'Vorgang nicht verfügbar';
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor_id::text || ':' || p_idempotency_key, 0));
  select * into v_previous
  from private.travel_item_mutations
  where actor_id = v_actor_id and idempotency_key = p_idempotency_key;
  if found then
    return query select 'replayed', v_previous.travel_item_id, v_previous.version_number, null::text, null::text;
    return;
  end if;
  -- Serialisiert die Mengenprüfung pro Reise, damit zwei parallele Anlagen
  -- das 30er-Limit nicht gemeinsam überschreiten können.
  perform 1
  from public.trips
  where id = p_trip_id and lifecycle_status = 'active'
  for update;
  select count(*) into v_count
  from public.travel_items
  where trip_id = p_trip_id and lifecycle_status <> 'deleted';
  if v_count >= 30 then
    return query select 'limit', null::uuid, null::bigint, 'TRAVEL_ITEM_LIMIT', 'Es können höchstens 30 aktive Reiseereignisse gespeichert werden';
    return;
  end if;

  v_item_id := private.replace_travel_item_aggregate(null, p_trip_id, p_payload, v_actor_id, true);
  select travel_items.version into version from public.travel_items where id = v_item_id;
  insert into private.travel_item_mutations (actor_id, idempotency_key, action, travel_item_id, version_number)
  values (v_actor_id, p_idempotency_key, 'create', v_item_id, version);
  perform private.capture_travel_item_revision(v_item_id, 'created_manual', v_actor_id);
  return query select 'created', v_item_id, version, null::text, null::text;
exception
  when sqlstate '42501' then
    return query select 'forbidden', null::uuid, null::bigint, 'FORBIDDEN', 'Vorgang nicht verfügbar';
  when sqlstate 'P0001' then
    return query select 'validation', null::uuid, null::bigint, 'VALIDATION', sqlerrm;
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    return query select 'validation', null::uuid, null::bigint, 'VALIDATION', 'Ereignisdaten sind ungültig';
  when check_violation then
    return query select 'validation', null::uuid, null::bigint, 'VALIDATION', 'Ereignisdaten sind ungültig';
  when others then
    return query select 'unavailable', null::uuid, null::bigint, 'UNAVAILABLE', 'Ereignis konnte nicht gespeichert werden';
end;
$$;

create or replace function public.update_travel_item(
  p_travel_item_id uuid,
  p_expected_version bigint,
  p_payload jsonb,
  p_idempotency_key text
)
returns table (operation_status text, travel_item_id uuid, version bigint, error_code text, error_message text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_trip_id uuid;
  v_current_version bigint;
  v_previous private.travel_item_mutations%rowtype;
begin
  if v_actor_id is null or p_expected_version is null or p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 1 and 200 then
    return query select 'forbidden', null::uuid, null::bigint, 'FORBIDDEN', 'Vorgang nicht verfügbar';
    return;
  end if;
  select item.trip_id, item.version into v_trip_id, v_current_version
  from public.travel_items item
  where item.id = p_travel_item_id and item.lifecycle_status = 'active'
    and private.is_active_trip_member(item.trip_id)
  for update;
  if not found then
    return query select 'forbidden', null::uuid, null::bigint, 'FORBIDDEN', 'Ereignis ist nicht verfügbar';
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor_id::text || ':' || p_idempotency_key, 0));
  select * into v_previous
  from private.travel_item_mutations
  where actor_id = v_actor_id and idempotency_key = p_idempotency_key;
  if found then
    return query select 'replayed', v_previous.travel_item_id, v_previous.version_number, null::text, null::text;
    return;
  end if;
  if v_current_version <> p_expected_version then
    return query select 'conflict', p_travel_item_id, v_current_version, 'VERSION_CONFLICT', 'Ereignis wurde zwischenzeitlich geändert';
    return;
  end if;

  perform private.replace_travel_item_aggregate(p_travel_item_id, v_trip_id, p_payload, v_actor_id, false);
  select item.version into version from public.travel_items item where item.id = p_travel_item_id;
  insert into private.travel_item_mutations (actor_id, idempotency_key, action, travel_item_id, version_number)
  values (v_actor_id, p_idempotency_key, 'update', p_travel_item_id, version);
  perform private.capture_travel_item_revision(
    p_travel_item_id,
    case when (p_payload ->> 'booking_status') = 'cancelled' then 'booking_cancelled' else 'edited_manual' end,
    v_actor_id
  );
  return query select 'updated', p_travel_item_id, version, null::text, null::text;
exception
  when sqlstate '42501' then
    return query select 'forbidden', null::uuid, null::bigint, 'FORBIDDEN', 'Vorgang nicht verfügbar';
  when sqlstate 'P0001' then
    return query select 'validation', null::uuid, null::bigint, 'VALIDATION', sqlerrm;
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    return query select 'validation', null::uuid, null::bigint, 'VALIDATION', 'Ereignisdaten sind ungültig';
  when check_violation then
    return query select 'validation', null::uuid, null::bigint, 'VALIDATION', 'Ereignisdaten sind ungültig';
  when others then
    return query select 'unavailable', null::uuid, null::bigint, 'UNAVAILABLE', 'Ereignis konnte nicht gespeichert werden';
end;
$$;

create or replace function public.delete_travel_item(
  p_travel_item_id uuid,
  p_expected_version bigint,
  p_idempotency_key text
)
returns table (operation_status text, travel_item_id uuid, version bigint, error_code text, error_message text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_current_version bigint;
  v_previous private.travel_item_mutations%rowtype;
begin
  if v_actor_id is null or p_expected_version is null or p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 1 and 200 then
    return query select 'forbidden', null::uuid, null::bigint, 'FORBIDDEN', 'Vorgang nicht verfügbar';
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor_id::text || ':' || p_idempotency_key, 0));
  select * into v_previous
  from private.travel_item_mutations
  where actor_id = v_actor_id and idempotency_key = p_idempotency_key;
  if found then
    return query select 'replayed', v_previous.travel_item_id, v_previous.version_number, null::text, null::text;
    return;
  end if;
  select item.version into v_current_version
  from public.travel_items item
  where item.id = p_travel_item_id and item.lifecycle_status = 'active'
    and private.is_active_trip_member(item.trip_id)
  for update;
  if not found then
    return query select 'forbidden', null::uuid, null::bigint, 'FORBIDDEN', 'Ereignis ist nicht verfügbar';
    return;
  end if;
  if v_current_version <> p_expected_version then
    return query select 'conflict', p_travel_item_id, v_current_version, 'VERSION_CONFLICT', 'Ereignis wurde zwischenzeitlich geändert';
    return;
  end if;
  update public.travel_items item
  set lifecycle_status = 'deleted',
      deleted_at = timezone('utc', now()),
      deleted_by_user_id = v_actor_id
  where item.id = p_travel_item_id and item.version = p_expected_version;
  select item.version into version from public.travel_items item where item.id = p_travel_item_id;
  insert into private.travel_item_mutations (actor_id, idempotency_key, action, travel_item_id, version_number)
  values (v_actor_id, p_idempotency_key, 'delete', p_travel_item_id, version);
  perform private.capture_travel_item_revision(p_travel_item_id, 'deleted', v_actor_id);
  return query select 'deleted', p_travel_item_id, version, null::text, null::text;
exception
  when sqlstate '42501' then
    return query select 'forbidden', null::uuid, null::bigint, 'FORBIDDEN', 'Vorgang nicht verfügbar';
  when check_violation then
    return query select 'validation', null::uuid, null::bigint, 'VALIDATION', 'Ereignis konnte nicht gelöscht werden';
  when others then
    return query select 'unavailable', null::uuid, null::bigint, 'UNAVAILABLE', 'Ereignis konnte nicht gelöscht werden';
end;
$$;

alter table public.event_type_definitions enable row level security;
alter table public.event_type_definitions force row level security;
alter table public.locations enable row level security;
alter table public.locations force row level security;
alter table public.travel_items enable row level security;
alter table public.travel_items force row level security;
alter table public.travel_item_revisions enable row level security;
alter table public.travel_item_revisions force row level security;
alter table public.accommodation_details enable row level security;
alter table public.accommodation_details force row level security;
alter table public.flight_details enable row level security;
alter table public.flight_details force row level security;
alter table public.rail_details enable row level security;
alter table public.rail_details force row level security;
alter table public.bus_details enable row level security;
alter table public.bus_details force row level security;
alter table public.activity_details enable row level security;
alter table public.activity_details force row level security;
alter table public.flight_segments enable row level security;
alter table public.flight_segments force row level security;
alter table public.rail_segments enable row level security;
alter table public.rail_segments force row level security;
alter table public.bus_segments enable row level security;
alter table public.bus_segments force row level security;

drop policy if exists event_type_definitions_select_active on public.event_type_definitions;
create policy event_type_definitions_select_active
on public.event_type_definitions for select to authenticated using (is_active);

drop policy if exists locations_select_member on public.locations;
create policy locations_select_member
on public.locations for select to authenticated using (private.is_active_trip_member(trip_id));

drop policy if exists travel_items_select_member on public.travel_items;
create policy travel_items_select_member
on public.travel_items for select to authenticated using (private.is_active_trip_member(trip_id));

drop policy if exists travel_item_revisions_select_member on public.travel_item_revisions;
create policy travel_item_revisions_select_member
on public.travel_item_revisions for select to authenticated
using (exists (select 1 from public.travel_items item where item.id = travel_item_revisions.travel_item_id and private.is_active_trip_member(item.trip_id)));

drop policy if exists accommodation_details_select_member on public.accommodation_details;
create policy accommodation_details_select_member
on public.accommodation_details for select to authenticated
using (exists (select 1 from public.travel_items item where item.id = accommodation_details.travel_item_id and private.is_active_trip_member(item.trip_id)));

drop policy if exists flight_details_select_member on public.flight_details;
create policy flight_details_select_member
on public.flight_details for select to authenticated
using (exists (select 1 from public.travel_items item where item.id = flight_details.travel_item_id and private.is_active_trip_member(item.trip_id)));

drop policy if exists rail_details_select_member on public.rail_details;
create policy rail_details_select_member
on public.rail_details for select to authenticated
using (exists (select 1 from public.travel_items item where item.id = rail_details.travel_item_id and private.is_active_trip_member(item.trip_id)));

drop policy if exists bus_details_select_member on public.bus_details;
create policy bus_details_select_member
on public.bus_details for select to authenticated
using (exists (select 1 from public.travel_items item where item.id = bus_details.travel_item_id and private.is_active_trip_member(item.trip_id)));

drop policy if exists activity_details_select_member on public.activity_details;
create policy activity_details_select_member
on public.activity_details for select to authenticated
using (exists (select 1 from public.travel_items item where item.id = activity_details.travel_item_id and private.is_active_trip_member(item.trip_id)));

drop policy if exists flight_segments_select_member on public.flight_segments;
create policy flight_segments_select_member
on public.flight_segments for select to authenticated
using (exists (select 1 from public.travel_items item where item.id = flight_segments.travel_item_id and item.event_type_code = 'flight' and private.is_active_trip_member(item.trip_id)));

drop policy if exists rail_segments_select_member on public.rail_segments;
create policy rail_segments_select_member
on public.rail_segments for select to authenticated
using (exists (select 1 from public.travel_items item where item.id = rail_segments.travel_item_id and item.event_type_code = 'rail' and private.is_active_trip_member(item.trip_id)));

drop policy if exists bus_segments_select_member on public.bus_segments;
create policy bus_segments_select_member
on public.bus_segments for select to authenticated
using (exists (select 1 from public.travel_items item where item.id = bus_segments.travel_item_id and item.event_type_code = 'bus' and private.is_active_trip_member(item.trip_id)));

-- MFA ist eine restriktive, tabellenweite Schutzschicht. Dadurch kann eine
-- spätere permissive Fachpolicy niemals eine AAL1-Sitzung freischalten.
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

revoke all on table public.event_type_definitions, public.locations, public.travel_items,
  public.travel_item_revisions, public.accommodation_details, public.flight_details,
  public.rail_details, public.bus_details, public.activity_details, public.flight_segments,
  public.rail_segments, public.bus_segments from anon, authenticated;
grant select on table public.event_type_definitions, public.locations, public.travel_items,
  public.travel_item_revisions, public.accommodation_details, public.flight_details,
  public.rail_details, public.bus_details, public.activity_details, public.flight_segments,
  public.rail_segments, public.bus_segments to authenticated;

revoke all on table private.travel_item_mutations from public, anon, authenticated;
revoke all on function public.create_travel_item(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.update_travel_item(uuid, bigint, jsonb, text) from public, anon, authenticated;
revoke all on function public.delete_travel_item(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.create_travel_item(uuid, jsonb, text) to authenticated;
grant execute on function public.update_travel_item(uuid, bigint, jsonb, text) to authenticated;
grant execute on function public.delete_travel_item(uuid, bigint, text) to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_active_trip_member(uuid) to authenticated;

alter table public.travel_items replica identity full;
alter publication supabase_realtime add table public.travel_items;
