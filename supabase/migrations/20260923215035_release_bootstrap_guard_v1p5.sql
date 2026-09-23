-- V1P5 fresh-instance guard.
-- Existing configured deployments remain unchanged.
update public.push_config
set vapid_public_key = 'UNCONFIGURED',
    updated_at = now()
where not exists (
  select 1 from vault.decrypted_secrets
  where name = 'v1p3_vapid_private_key'
    and nullif(btrim(decrypted_secret), '') is not null
);

do $$
declare
  required_count integer;
  target_jobid bigint;
begin
  select count(*) into required_count
  from vault.decrypted_secrets
  where name in (
    'v1p4_project_url',
    'v1p4_publishable_key',
    'v1p4_scheduler_secret',
    'v1p3_vapid_private_key',
    'v1p3_vapid_public_key'
  )
    and nullif(btrim(decrypted_secret), '') is not null;

  select jobid into target_jobid
  from cron.job
  where jobname = 'v1p4-reminder-engine-every-minute'
  limit 1;

  if target_jobid is not null and required_count < 5 then
    perform cron.alter_job(job_id := target_jobid, active := false);
  end if;
end $$;
