create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

create table public.reminder_instances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  roster_entry_id uuid references public.roster_entries(id) on delete set null,
  turning_schedule_id uuid not null references public.turning_schedule(id),
  shift_date date not null,
  position text not null check (position in ('RIGHT','LEFT','SUPINE')),
  scheduled_at timestamptz not null,
  unlock_at timestamptz not null,
  followup_at timestamptz not null,
  completed_at timestamptz,
  initial_notification_sent_at timestamptz,
  followup_notification_sent_at timestamptz,
  initial_delivery_count integer not null default 0 check (initial_delivery_count >= 0),
  followup_delivery_count integer not null default 0 check (followup_delivery_count >= 0),
  last_delivery_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminder_unlock_timing check (unlock_at = scheduled_at + interval '10 minutes'),
  constraint reminder_followup_timing check (followup_at = scheduled_at + interval '40 minutes'),
  constraint reminder_unique_event unique (user_id, turning_schedule_id, scheduled_at)
);

create index reminder_user_scheduled_idx on public.reminder_instances(user_id, scheduled_at desc);
create index reminder_followup_due_idx on public.reminder_instances(followup_at)
where completed_at is null and followup_notification_sent_at is null;

create function private.touch_reminder_instance()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.touch_reminder_instance() from public, anon, authenticated;
create trigger reminder_instances_updated_at before update on public.reminder_instances
for each row execute function private.touch_reminder_instance();

alter table public.reminder_instances enable row level security;
revoke all on public.reminder_instances from public, anon, authenticated;
grant select on public.reminder_instances to authenticated;
grant all on public.reminder_instances to service_role;
create policy reminder_select_own on public.reminder_instances for select to authenticated
using (user_id = (select auth.uid()));

create function public.claim_due_initial_reminders_v1p4(p_now timestamptz default now())
returns table (reminder_id uuid, reminder_user_id uuid, reminder_position text, reminder_scheduled_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.reminder_instances (
    user_id, department_id, roster_entry_id, turning_schedule_id,
    shift_date, position, scheduled_at, unlock_at, followup_at
  )
  select re.user_id, re.department_id, re.id, ts.id, re.shift_date, ts.position,
    ((re.shift_date + ts.at_time) at time zone d.timezone),
    ((re.shift_date + ts.at_time) at time zone d.timezone) + interval '10 minutes',
    ((re.shift_date + ts.at_time) at time zone d.timezone) + interval '40 minutes'
  from public.roster_entries re
  join public.turning_schedule ts on ts.department_id = re.department_id and ts.shift_type_id = re.shift_type_id
  join public.departments d on d.id = re.department_id
  where re.shift_date = (p_now at time zone d.timezone)::date
    and ((re.shift_date + ts.at_time) at time zone d.timezone) <= p_now
    and ((re.shift_date + ts.at_time) at time zone d.timezone) > p_now - interval '5 minutes'
    and re.created_at <= ((re.shift_date + ts.at_time) at time zone d.timezone)
    and re.updated_at <= ((re.shift_date + ts.at_time) at time zone d.timezone)
  on conflict (user_id, turning_schedule_id, scheduled_at) do nothing;

  return query
  with due as (
    select ri.id from public.reminder_instances ri
    where ri.initial_notification_sent_at is null
      and ri.scheduled_at <= p_now
      and ri.scheduled_at > p_now - interval '5 minutes'
    order by ri.scheduled_at, ri.id
    for update skip locked
  ),
  claimed as (
    update public.reminder_instances ri
       set initial_notification_sent_at = p_now
      from due where ri.id = due.id
    returning ri.id, ri.user_id, ri.position, ri.scheduled_at
  )
  select c.id, c.user_id, c.position, c.scheduled_at from claimed c;
end;
$$;
revoke all on function public.claim_due_initial_reminders_v1p4(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_due_initial_reminders_v1p4(timestamptz) to service_role;

create function public.claim_due_followup_reminders_v1p4(p_now timestamptz default now())
returns table (reminder_id uuid, reminder_user_id uuid, reminder_position text, reminder_scheduled_at timestamptz)
language sql security definer set search_path = '' as $$
  with due as (
    select ri.id from public.reminder_instances ri
    where ri.completed_at is null
      and ri.initial_notification_sent_at is not null
      and ri.followup_notification_sent_at is null
      and ri.followup_at <= p_now
    order by ri.followup_at, ri.id
    for update skip locked
  ),
  claimed as (
    update public.reminder_instances ri
       set followup_notification_sent_at = p_now
      from due where ri.id = due.id
    returning ri.id, ri.user_id, ri.position, ri.scheduled_at
  )
  select c.id, c.user_id, c.position, c.scheduled_at from claimed c;
$$;
revoke all on function public.claim_due_followup_reminders_v1p4(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_due_followup_reminders_v1p4(timestamptz) to service_role;

create function public.complete_reminder_v1p4(p_reminder_id uuid, p_user_id uuid, p_now timestamptz default now())
returns table (result text, completed_at timestamptz, unlock_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare r public.reminder_instances%rowtype;
begin
  select * into r from public.reminder_instances where id = p_reminder_id for update;
  if not found or r.user_id <> p_user_id then
    return query select 'not_found'::text, null::timestamptz, null::timestamptz; return;
  end if;
  if r.completed_at is not null then
    return query select 'completed'::text, r.completed_at, r.unlock_at; return;
  end if;
  if p_now < r.unlock_at then
    return query select 'locked'::text, null::timestamptz, r.unlock_at; return;
  end if;
  update public.reminder_instances set completed_at = p_now where id = p_reminder_id;
  return query select 'completed'::text, p_now, r.unlock_at;
end;
$$;
revoke all on function public.complete_reminder_v1p4(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_reminder_v1p4(uuid, uuid, timestamptz) to service_role;

create function public.get_v1p4_scheduler_secret_for_backend()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'v1p4_scheduler_secret' limit 1;
$$;
revoke all on function public.get_v1p4_scheduler_secret_for_backend() from public, anon, authenticated;
grant execute on function public.get_v1p4_scheduler_secret_for_backend() to service_role;
