do $health$
declare
  worker_job_id bigint;
begin
  select jobid into worker_job_id
  from cron.job
  where jobname = 'process-document-extractions-every-minute'
    and active;

  if worker_job_id is null then
    raise exception using errcode = 'P0001', message = 'extraction worker cron is not active';
  end if;
  if not exists (
    select 1
    from cron.job_run_details
    where jobid = worker_job_id
      and status = 'succeeded'
      and end_time >= timezone('utc', now()) - interval '10 minutes'
  ) then
    raise exception using errcode = 'P0001', message = 'no recent successful extraction worker cron run';
  end if;
  if not exists (
    select 1
    from net._http_response
    where created >= timezone('utc', now()) - interval '10 minutes'
      and status_code between 200 and 299
      and not timed_out
      and error_msg is null
      and content like '%"processed":%'
  ) then
    raise exception using errcode = 'P0001', message = 'no recent successful extraction worker pg_net response';
  end if;
end
$health$;
