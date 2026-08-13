-- Keep the travel-item aggregate schema and the SECURITY DEFINER write path in
-- one deploy invariant. This detects the class of drift where a function is
-- deployed before the columns/constraints it assumes are present.
do $fingerprint$
declare
  actual_fingerprint text;
  expected_fingerprint constant text := '8fb29f5056f933088df7ba601e438655';
begin
  set local search_path = '';

  with fingerprint_parts(part_key, part_value) as (
    select
      'column:' || c.relname || ':' || a.attnum,
      pg_catalog.concat_ws('|', c.relname, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod),
        a.attnotnull::text, coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), ''))
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
    where n.nspname = 'public' and c.relname in ('locations', 'travel_items')
    union all
    select
      'constraint:' || c.relname || ':' || con.conname,
      pg_catalog.pg_get_constraintdef(con.oid, true)
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class c on c.oid = con.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('locations', 'travel_items')
    union all
    select
      'function:' || p.oid::pg_catalog.regprocedure::text,
      pg_catalog.pg_get_functiondef(p.oid)
    from pg_catalog.pg_proc p
    where p.oid in (
      pg_catalog.to_regprocedure('private.upsert_location(uuid,uuid,jsonb,uuid)'),
      pg_catalog.to_regprocedure('private.replace_travel_item_aggregate(uuid,uuid,jsonb,uuid,boolean)'),
      pg_catalog.to_regprocedure('public.create_travel_item(uuid,jsonb,text)'),
      pg_catalog.to_regprocedure('public.update_travel_item(uuid,bigint,jsonb,text)')
    )
  )
  select pg_catalog.md5(pg_catalog.string_agg(part_key || '=' || part_value, E'\n' order by part_key))
  into actual_fingerprint
  from fingerprint_parts;

  if actual_fingerprint is distinct from expected_fingerprint then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'travel-item schema fingerprint mismatch (expected %s, got %s)',
        expected_fingerprint,
        coalesce(actual_fingerprint, '<null>')
      );
  end if;
end
$fingerprint$;
