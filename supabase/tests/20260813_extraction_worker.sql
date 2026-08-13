begin;

select plan(30);

select has_table('private', 'extraction_provider_charges', 'Providerkosten haben ein privates Ledger');
select has_column('public', 'extraction_runs', 'available_at', 'Queued Runs besitzen einen Fälligkeitszeitpunkt');
select has_column('public', 'extraction_runs', 'actual_cost_micro_eur', 'Runkosten werden dauerhaft aggregiert');
select ok((select relrowsecurity from pg_class where oid = 'private.extraction_provider_charges'::regclass), 'Das Kostenledger hat RLS aktiviert');
select has_index('public', 'extraction_runs', 'extraction_runs_queue_claim_idx', 'Die Worker-Queue hat einen partiellen Claim-Index');

create temporary table worker_test_ids (
  user_id uuid,
  trip_id uuid,
  document_id uuid
) on commit drop;
insert into worker_test_ids values (
  '31313131-3131-4131-8131-313131313131',
  '32323232-3232-4232-8232-323232323232',
  '33333333-3333-4333-8333-333333333333'
);
grant select on table worker_test_ids to authenticated, service_role;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
select user_id, 'authenticated', 'authenticated', 'worker@example.test', 'test-only', timezone('utc', now())
from worker_test_ids on conflict (id) do nothing;
insert into public.users (id, display_name) select user_id, 'Worker Person' from worker_test_ids;
insert into public.trips (id, title, start_date, end_date, created_by_user_id, updated_by_user_id)
select trip_id, 'Worker Testreise', date '2026-09-01', date '2026-09-07', user_id, user_id from worker_test_ids;
insert into public.trip_members (trip_id, user_id, created_by_user_id)
select trip_id, user_id, user_id from worker_test_ids;
insert into public.documents (
  id, trip_id, uploaded_by_user_id, upload_idempotency_key, upload_batch_key,
  upload_batch_file_count, upload_batch_total_bytes, original_file_name, reported_content_type,
  detected_content_type, byte_size, checksum, storage_object_key, status, uploaded_at
)
select document_id, trip_id, user_id, 'worker-upload', 'worker-batch', 1, 1024,
  'worker.pdf', 'application/pdf', 'application/pdf', 1024, repeat('b', 64),
  'quarantine/33333333-3333-4333-8333-333333333333', 'available', timezone('utc', now())
from worker_test_ids;
update private.extraction_runtime_config set provider_enabled = true where singleton;

create temporary table worker_reserved as
select (private.reserve_priced_extraction_run(
  (select document_id from worker_test_ids), 1, (select user_id from worker_test_ids),
  'worker-start', 'gpt-test', '1.0.0', '1.0.0', '1.0.0', 'test-pricing-v1', 1000000,
  0.25, 0.05, 2.0
)).*;
select is((select status from worker_reserved), 'queued', 'Reservation schreibt dauerhaft in die Queue');
select is((select cached_input_micro_eur_per_token from worker_reserved), 0.05::numeric, 'Run speichert den Cached-Input-Preis unveränderlich');
select is(
  (private.reserve_priced_extraction_run(
    (select document_id from worker_test_ids), 1, (select user_id from worker_test_ids),
    'worker-start', 'gpt-test', '1.0.0', '1.0.0', '1.0.0', 'test-pricing-v2', 1000000,
    9.0, 8.0, 7.0
  )).cached_input_micro_eur_per_token,
  0.05::numeric,
  'Idempotenter Replay nach Preisrotation behält den ursprünglichen Snapshot'
);

create temporary table worker_claim_1 as
select * from private.claim_next_extraction_run('34343434-3434-4434-8434-343434343434', 120);
select is((select status from worker_claim_1), 'processing', 'Worker beansprucht den nächsten fälligen Run');
select is((select provider_attempt_count from worker_claim_1), 1, 'Claim zählt genau einen begrenzten Provider-Versuch');
select private.begin_extraction_provider_call((select id from worker_claim_1), '34343434-3434-4434-8434-343434343434');

select private.record_extraction_provider_charge_v2(
  (select id from worker_claim_1), '34343434-3434-4434-8434-343434343434',
  'resp-worker-1', 125, 25, 40, 107
);
select is((select actual_cost_micro_eur from public.extraction_runs where id = (select id from worker_claim_1)), 107::bigint, 'Chargeable Antwort wird sofort am Run verbucht');
select is((select count(*)::int from private.extraction_provider_charges), 1, 'Providerantwort erhält genau einen Ledger-Eintrag');
select is((select cached_input_tokens from private.extraction_provider_charges limit 1), 25::bigint, 'Ledger trennt Cached-Input-Tokens');
select is((select pricing_version from private.extraction_provider_charges limit 1), 'test-pricing-v1', 'Ledger bewahrt die Preisversion des Runs');
select private.record_extraction_provider_charge_v2(
  (select id from worker_claim_1), '34343434-3434-4434-8434-343434343434',
  'resp-worker-1', 125, 25, 40, 107
);
select is((select count(*)::int from private.extraction_provider_charges), 1, 'Ledger-Replay desselben Versuchs ist idempotent');
select throws_ok(
  $$select private.record_extraction_provider_charge_v2(
    (select id from worker_claim_1), '34343434-3434-4434-8434-343434343434',
    'resp-worker-conflict', 125, 25, 40, 108
  )$$,
  'P0001',
  '[provider_charge_conflict] Providerkosten widersprechen dem bereits verbuchten Versuch',
  'Ein widersprüchlicher Ledger-Replay wird abgewiesen'
);

select private.retry_or_fail_extraction_run(
  (select id from worker_claim_1), '34343434-3434-4434-8434-343434343434',
  'provider_timeout', true, 0
);
select is((select status from public.extraction_runs where id = (select id from worker_claim_1)), 'queued', 'Retryable Fehler stellt den Run erneut fällig');

create temporary table worker_claim_2 as
select * from private.claim_next_extraction_run('35353535-3535-4535-8535-353535353535', 120);
select is((select provider_attempt_count from worker_claim_2), 2, 'Der zweite Claim erhöht den Versuchszähler monoton');
update public.extraction_runs set lease_expires_at = timezone('utc', now()) - interval '1 second'
where id = (select id from worker_claim_2);
create temporary table worker_claim_3 as
select * from private.claim_next_extraction_run('36363636-3636-4636-8636-363636363636', 120);
select is((select provider_attempt_count from worker_claim_3), 3, 'Abgelaufener Lease wird wiederhergestellt und höchstens dreimal beansprucht');
update public.extraction_runs set lease_expires_at = timezone('utc', now()) - interval '1 second'
where id = (select id from worker_claim_3);
select is((select count(*)::int from private.claim_next_extraction_run('37373737-3737-4737-8737-373737373737', 120)), 0, 'Nach drei Versuchen wird kein vierter Claim vergeben');
select is((select status from public.extraction_runs where id = (select id from worker_claim_3)), 'failed_retryable', 'Ein dritter verlorener Lease endet kontrolliert retryable');
select is((select reserved_micro_eur from private.extraction_budget_months), 0::bigint, 'Terminaler Worker-Run gibt die restliche Reservierung genau einmal frei');
select is((select spent_micro_eur from private.extraction_budget_months), 107::bigint, 'Bereits verbuchte Providerkosten bleiben nach Recovery erhalten');

insert into public.documents (
  id, trip_id, uploaded_by_user_id, upload_idempotency_key, upload_batch_key,
  upload_batch_file_count, upload_batch_total_bytes, original_file_name, reported_content_type,
  detected_content_type, byte_size, checksum, storage_object_key, status, uploaded_at
)
select '38383838-3838-4838-8838-383838383838', trip_id, user_id, 'uncertain-upload', 'uncertain-batch', 1, 1024,
  'uncertain.pdf', 'application/pdf', 'application/pdf', 1024, repeat('c',64),
  'quarantine/38383838-3838-4838-8838-383838383838', 'available', timezone('utc',now()) from worker_test_ids;
create temporary table uncertain_run as select (private.reserve_priced_extraction_run(
  '38383838-3838-4838-8838-383838383838',1,(select user_id from worker_test_ids),'uncertain-start','gpt-test',
  '1.0.0','1.0.0','1.0.0','test-pricing-v1',1000000,0.25,0.05,2.0)).*;
create temporary table uncertain_claim as select * from private.claim_next_extraction_run('39393939-3939-4939-8939-393939393939',120);
select private.begin_extraction_provider_call((select id from uncertain_claim),'39393939-3939-4939-8939-393939393939');
select ok((select provider_call_started_at is not null from public.extraction_runs where id=(select id from uncertain_claim)), 'Provider-Fence wird vor dem externen Aufruf persistiert');
update public.extraction_runs set lease_expires_at=timezone('utc',now())-interval '1 second' where id=(select id from uncertain_claim);
select is((select count(*)::int from private.claim_next_extraction_run('40404040-4040-4040-8040-404040404040',120)),0,'Ungewisser Provideraufruf wird niemals automatisch doppelt ausgeführt');
select is((select status from public.extraction_runs where id=(select id from uncertain_claim)),'failed_retryable','Ungewisser Providerausgang endet kontrolliert');
select is((select cost_micro_eur from private.extraction_provider_charges where extraction_run_id=(select id from uncertain_claim)),1000000::bigint,'Ungewisser Ausgang verbucht konservativ die Restreservierung');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id::text from worker_test_ids), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select throws_ok(
  $$select * from public.claim_next_extraction_run(gen_random_uuid(), 120)$$,
  '42501',
  'permission denied for function claim_next_extraction_run',
  'Browserrollen können keinen Worker-Run beanspruchen'
);
reset role;
select ok(has_function_privilege('service_role', 'public.claim_next_extraction_run(uuid,integer)', 'EXECUTE'), 'Nur die Service-Rolle besitzt den öffentlichen Worker-Entry-Point');
select ok(not has_function_privilege('public', 'private.claim_next_extraction_run(uuid,integer)', 'EXECUTE'), 'Die SECURITY-DEFINER-Implementierung ist für PUBLIC gesperrt');

select * from finish();
rollback;
