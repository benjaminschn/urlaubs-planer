-- Read-only production health check. The query intentionally fails the job
-- when cleanup work is terminal or has stopped progressing; it does not
-- mutate queue state.
do $health$
declare
  failed_count bigint;
  stale_queued_count bigint;
  expired_processing_count bigint;
begin
  select count(*)
    into failed_count
  from private.document_storage_cleanups
  where status = 'failed';

  select count(*)
    into stale_queued_count
  from private.document_storage_cleanups
  where status = 'queued'
    and available_at < timezone('utc', now()) - interval '10 minutes';

  select count(*)
    into expired_processing_count
  from private.document_storage_cleanups
  where status = 'processing'
    and lease_expires_at < timezone('utc', now());

  if failed_count > 0
    or stale_queued_count > 0
    or expired_processing_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'document storage cleanup unhealthy: failed=%s stale_queued=%s expired_processing=%s',
        failed_count,
        stale_queued_count,
        expired_processing_count
      );
  end if;
end
$health$;
