create or replace function private.install_extraction_worker_schedule()
returns bigint
language plpgsql
security definer
set search_path = ''
as $migration$
declare existing_job_id bigint; new_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = 'process-document-extractions-every-minute';
  if existing_job_id is not null then perform cron.unschedule(existing_job_id); end if;
  select cron.schedule(
    'process-document-extractions-every-minute',
    '* * * * *',
    $cron$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'extraction_project_url'
          limit 1
        ) || '/functions/v1/process-document-extractions',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Extraction-Worker-Token', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'extraction_worker_token'
            limit 1
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 90000
      ) as request_id;
    $cron$
  ) into new_job_id;
  return new_job_id;
end
$migration$;

-- Deployment installs the schedule only after the worker, Function secret and
-- Vault values have been verified. Merely applying migrations is side-effect free.
select cron.unschedule(jobid) from cron.job where jobname = 'process-document-extractions-every-minute';

revoke all on function private.install_extraction_worker_schedule() from public, anon, authenticated, service_role;
