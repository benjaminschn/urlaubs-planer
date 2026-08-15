begin;

select plan(8);

create temporary table budget_ids (
  user_a uuid,
  user_b uuid,
  trip_id uuid,
  document_a uuid,
  document_b uuid
) on commit drop;
insert into budget_ids values (
  '51515151-5151-4151-8151-515151515151',
  '52525252-5252-4252-8252-525252525252',
  '53535353-5353-4353-8353-535353535353',
  '54545454-5454-4454-8454-545454545454',
  '55555555-5555-4555-8555-555555555555'
);
grant select on table budget_ids to authenticated, service_role;

set local role postgres;
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
select user_id, 'authenticated', 'authenticated', email, 'test-only', timezone('utc', now())
from (
  select user_a as user_id, 'budget-a@example.test' as email from budget_ids
  union all select user_b, 'budget-b@example.test' from budget_ids
) fixture
on conflict (id) do nothing;
insert into public.users (id, display_name)
select user_a, 'Budget A' from budget_ids
union all select user_b, 'Budget B' from budget_ids;
insert into public.trips (id, title, start_date, end_date, created_by_user_id, updated_by_user_id)
select trip_id, 'Budget-Testreise', date '2026-09-01', date '2026-09-07', user_a, user_a from budget_ids;
insert into public.trip_members (trip_id, user_id, created_by_user_id)
select trip_id, user_a, user_a from budget_ids
union all select trip_id, user_b, user_a from budget_ids;
insert into public.documents (
  id, trip_id, uploaded_by_user_id, upload_idempotency_key, upload_batch_key,
  upload_batch_file_count, upload_batch_total_bytes, original_file_name, reported_content_type,
  detected_content_type, byte_size, checksum, storage_object_key, status, uploaded_at
)
select document_a, trip_id, user_a, 'budget-upload-a', 'budget-batch-a', 1, 1024,
  'budget-a.pdf', 'application/pdf', 'application/pdf', 1024, repeat('a', 64),
  'quarantine/54545454-5454-4454-8454-545454545454', 'available', timezone('utc', now())
from budget_ids
union all
select document_b, trip_id, user_b, 'budget-upload-b', 'budget-batch-b', 1, 1024,
  'budget-b.pdf', 'application/pdf', 'application/pdf', 1024, repeat('b', 64),
  'quarantine/55555555-5555-4555-8555-555555555555', 'available', timezone('utc', now())
from budget_ids;
update private.extraction_runtime_config set provider_enabled = true, monthly_budget_micro_eur = 20000000 where singleton;

create temporary table budget_first as
select (private.reserve_priced_extraction_run(
  (select document_a from budget_ids), 1, (select user_a from budget_ids),
  'budget-first', 'gpt-test', '1.0.0', '1.0.0', '1.0.0', 'test-pricing-v1', 1000000,
  0.25, 0.05, 2.0
)).*;
select is((select status from budget_first), 'queued', 'Erste Reservierung R belegt das Monatsbudget atomar');
select is((select reserved_micro_eur from private.extraction_budget_months), 1000000::bigint, 'Nach der ersten Reservierung ist reserved = R');

update private.extraction_budget_months
set limit_micro_eur = 1999999
where month_start = date_trunc('month', timezone('utc', now()))::date;

select throws_ok(
  $$select private.reserve_priced_extraction_run(
    (select document_b from budget_ids), 1, (select user_b from budget_ids),
    'budget-second', 'gpt-test', '1.0.0', '1.0.0', '1.0.0', 'test-pricing-v1', 1000000,
    0.25, 0.05, 2.0
  )$$,
  'P0001',
  '[budget_exhausted] Das monatliche Verarbeitungsbudget ist erreicht',
  'Zweite Reservierung R bei Limit 2R-1 wird mit budget_exhausted abgewiesen'
);
select is((select count(*)::int from public.extraction_runs), 1, 'Die abgewiesene zweite Reservierung erzeugt keinen Run');

create temporary table budget_claim as
select * from private.claim_next_extraction_run('56565656-5656-4656-8656-565656565656', 120);
select private.begin_extraction_provider_call((select id from budget_claim), '56565656-5656-4656-8656-565656565656');
select private.record_extraction_provider_charge_v2(
  (select id from budget_claim), '56565656-5656-4656-8656-565656565656',
  'resp-budget-overspend', 0, 0, 0, 2000000
);
select is((select spent_micro_eur from private.extraction_budget_months), 2000000::bigint, 'Tatsächliche Providerkosten 2R werden trotz Reservierung R verbucht');
select is((select reserved_micro_eur from private.extraction_budget_months), 0::bigint, 'Nach der Überbuchung ist die Reservierung vollständig aufgelöst');
select is((select actual_cost_micro_eur from public.extraction_runs where id = (select id from budget_claim)), 2000000::bigint, 'Der Run speichert die über die Reservierung hinausgehenden Kosten');

select throws_ok(
  $$select private.reserve_priced_extraction_run(
    (select document_b from budget_ids), 1, (select user_b from budget_ids),
    'budget-third', 'gpt-test', '1.0.0', '1.0.0', '1.0.0', 'test-pricing-v1', 1000000,
    0.25, 0.05, 2.0
  )$$,
  'P0001',
  '[budget_exhausted] Das monatliche Verarbeitungsbudget ist erreicht',
  'Nach spent=2R blockiert spent+R eine weitere Reservierung R'
);

select * from finish();
rollback;
