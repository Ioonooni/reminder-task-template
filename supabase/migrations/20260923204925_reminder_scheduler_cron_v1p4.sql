do $$
begin
  if exists (select 1 from cron.job where jobname = 'v1p4-reminder-engine-every-minute') then
    perform cron.unschedule('v1p4-reminder-engine-every-minute');
  end if;
end $$;

select cron.schedule(
  'v1p4-reminder-engine-every-minute',
  '* * * * *',
  $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'v1p4_project_url') || '/functions/v1/reminder-engine',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'v1p4_publishable_key'),
        'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'v1p4_scheduler_secret')
      ),
      body := '{"action":"tick"}'::jsonb,
      timeout_milliseconds := 10000
    );
  $cron$
);

-- Fresh template instances stay inactive until supabase/manual/configure_v1_instance.sql.example
-- has populated per-instance Vault secrets.
do $$
declare target_jobid bigint;
begin
  select jobid into target_jobid from cron.job
  where jobname='v1p4-reminder-engine-every-minute'
  limit 1;
  if target_jobid is not null then
    perform cron.alter_job(job_id := target_jobid, active := false);
  end if;
end $$;
