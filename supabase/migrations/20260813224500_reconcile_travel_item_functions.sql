-- Reconcile hardened travel-item validation and location ownership functions.
--
-- These definitions were previously changed in the original travel-item migration
-- after it had already been applied remotely. Keep migration history immutable and
-- carry the corrected definitions forward explicitly.

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
-- The former three-argument helper did not scope caller-supplied location IDs to
-- the travel item and is no longer referenced after replacing the aggregate writer.
drop function if exists private.upsert_location(uuid, jsonb, uuid);

revoke execute on function private.validate_location_payload(jsonb, text) from public, anon, authenticated;
revoke execute on function private.validate_payload_schema(text, jsonb) from public, anon, authenticated;
revoke execute on function private.upsert_location(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
revoke execute on function private.validate_transport_segments(text, jsonb) from public, anon, authenticated;
revoke execute on function private.replace_travel_item_aggregate(uuid, uuid, jsonb, uuid, boolean) from public, anon, authenticated;
