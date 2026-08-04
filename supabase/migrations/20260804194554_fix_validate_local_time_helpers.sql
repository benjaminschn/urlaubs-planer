-- Production may be missing private.assert_* helpers from the original travel-item
-- migration. Ensure they exist, then reinstall validate_local_time safely.

create schema if not exists private;

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
    if not (v_key = any (p_allowed_keys)) then
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

create or replace function private.validate_local_time(p_value jsonb, p_label text)
returns void
language plpgsql
set search_path = pg_catalog, public, private
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
  v_has_zone boolean;
  v_has_offset boolean;
  v_has_instant boolean;
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
  perform private.assert_optional_text(p_value, 'local_time', 12, p_label || ' Uhrzeit');
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
  if v_resolution not in ('resolved', 'date_only', 'unknown_time', 'ambiguous', 'nonexistent', 'unresolved') then
    raise exception using errcode = 'P0001', message = p_label || ': unbekannte Zeitauflösung';
  end if;
  if (p_value ->> 'local_date') is null or (p_value ->> 'local_date') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception using errcode = 'P0001', message = p_label || ': gültiges lokales Datum fehlt';
  end if;
  v_date := (p_value ->> 'local_date')::date;

  v_zone := nullif(btrim(p_value ->> 'iana_time_zone'), '');
  if v_zone is not null and not exists (select 1 from pg_timezone_names where name = v_zone) then
    raise exception using errcode = 'P0001', message = p_label || ': unbekannte IANA-Zeitzone';
  end if;

  v_has_zone := v_zone is not null;
  v_has_offset := (p_value ->> 'utc_offset_minutes') is not null;
  v_has_instant := nullif(btrim(p_value ->> 'instant_utc'), '') is not null;

  if v_precision = 'exact_time' then
    if (p_value ->> 'local_time') is null or (p_value ->> 'local_time') !~ '^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$' then
      raise exception using errcode = 'P0001', message = p_label || ': exakte Uhrzeit fehlt';
    end if;

    if v_resolution = 'resolved' then
      if not (v_has_zone and v_has_offset and v_has_instant) then
        raise exception using errcode = 'P0001', message = p_label || ': Zeitzone, Offset und UTC-Instant sind für resolved erforderlich';
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
      if v_resolution not in ('unresolved', 'ambiguous', 'nonexistent') then
        raise exception using errcode = 'P0001', message = p_label || ': Zeitauflösung ist inkonsistent';
      end if;
      if v_has_zone and v_has_offset and v_has_instant then
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
      end if;
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
set search_path = pg_catalog, public, private
as $$
declare
  v_start_date date := (p_start ->> 'local_date')::date;
  v_end_date date := (p_end ->> 'local_date')::date;
  v_start_instant text := nullif(btrim(p_start ->> 'instant_utc'), '');
  v_end_instant text := nullif(btrim(p_end ->> 'instant_utc'), '');
  v_start_time text := nullif(btrim(p_start ->> 'local_time'), '');
  v_end_time text := nullif(btrim(p_end ->> 'local_time'), '');
begin
  if v_end_date < v_start_date then
    raise exception using errcode = 'P0001', message = p_label || ': Ende liegt vor dem Beginn';
  end if;
  if v_start_instant is not null and v_end_instant is not null
    and v_end_instant::timestamptz < v_start_instant::timestamptz then
    raise exception using errcode = 'P0001', message = p_label || ': Ende liegt vor dem Beginn';
  end if;
  if v_start_date = v_end_date
    and v_start_instant is null and v_end_instant is null
    and v_start_time is not null and v_end_time is not null
    and v_end_time::time < v_start_time::time then
    raise exception using errcode = 'P0001', message = p_label || ': Ende liegt vor dem Beginn';
  end if;
end;
$$;
