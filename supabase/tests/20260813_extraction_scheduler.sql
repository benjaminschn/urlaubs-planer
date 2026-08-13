begin;
select plan(9);

select ok(exists(select 1 from pg_extension where extname = 'pg_cron'), 'pg_cron is installed');
select ok(exists(select 1 from pg_extension where extname = 'pg_net'), 'pg_net is installed');
select has_function('private', 'install_extraction_worker_schedule', array[]::text[], 'deployment-controlled scheduler installer exists');
select is(
  (select count(*)::integer from cron.job where jobname = 'process-document-extractions-every-minute'),
  0,
  'migrations do not activate the worker before its function and secrets are deployed'
);

select lives_ok(
  $$select private.install_extraction_worker_schedule()$$,
  'deployment can activate the worker schedule explicitly'
);
select is(
  (select schedule from cron.job where jobname = 'process-document-extractions-every-minute'),
  '* * * * *',
  'explicitly installed worker recovery runs every minute'
);
select ok(
  (select active from cron.job where jobname = 'process-document-extractions-every-minute'),
  'explicitly installed worker recovery schedule is active'
);
select ok(
  position('extraction_project_url' in (select command from cron.job where jobname = 'process-document-extractions-every-minute')) > 0,
  'worker URL is read from Vault'
);
select ok(
  position('extraction_worker_token' in (select command from cron.job where jobname = 'process-document-extractions-every-minute')) > 0,
  'worker credential is read from Vault'
);

select * from finish();
rollback;
