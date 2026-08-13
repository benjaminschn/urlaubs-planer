-- The durable queue is kicked on enqueue and polled once per minute so an
-- interrupted or missed Edge Function invocation is always recovered.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

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
);

revoke all on schema cron from public, anon, authenticated;
revoke all on schema net from public, anon, authenticated;
