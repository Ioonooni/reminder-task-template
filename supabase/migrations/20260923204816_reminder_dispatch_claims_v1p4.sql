alter table public.reminder_instances
  add column initial_dispatch_claimed_at timestamptz,
  add column followup_dispatch_claimed_at timestamptz;

create index reminder_initial_claim_idx on public.reminder_instances(scheduled_at)
where initial_dispatch_claimed_at is null;

drop function public.claim_due_initial_reminders_v1p4(timestamptz);
drop function public.claim_due_followup_reminders_v1p4(timestamptz);

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
    where ri.initial_dispatch_claimed_at is null
      and ri.scheduled_at <= p_now
      and ri.scheduled_at > p_now - interval '5 minutes'
    order by ri.scheduled_at, ri.id
    for update skip locked
  ),
  claimed as (
    update public.reminder_instances ri set initial_dispatch_claimed_at = p_now
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
      and ri.initial_dispatch_claimed_at is not null
      and ri.followup_dispatch_claimed_at is null
      and ri.followup_at <= p_now
    order by ri.followup_at, ri.id
    for update skip locked
  ),
  claimed as (
    update public.reminder_instances ri set followup_dispatch_claimed_at = p_now
    from due where ri.id = due.id
    returning ri.id, ri.user_id, ri.position, ri.scheduled_at
  )
  select c.id, c.user_id, c.position, c.scheduled_at from claimed c;
$$;
revoke all on function public.claim_due_followup_reminders_v1p4(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_due_followup_reminders_v1p4(timestamptz) to service_role;

create function public.finalize_reminder_dispatch_v1p4(
  p_reminder_id uuid, p_kind text, p_sent_count integer, p_error text, p_now timestamptz default now()
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_kind = 'initial' then
    update public.reminder_instances
       set initial_notification_sent_at = case when p_sent_count > 0 then p_now else initial_notification_sent_at end,
           initial_delivery_count = initial_delivery_count + greatest(p_sent_count, 0),
           last_delivery_error = p_error
     where id = p_reminder_id;
  elsif p_kind = 'followup' then
    update public.reminder_instances
       set followup_notification_sent_at = case when p_sent_count > 0 then p_now else followup_notification_sent_at end,
           followup_delivery_count = followup_delivery_count + greatest(p_sent_count, 0),
           last_delivery_error = p_error
     where id = p_reminder_id;
  else
    raise exception 'invalid dispatch kind';
  end if;
end;
$$;
revoke all on function public.finalize_reminder_dispatch_v1p4(uuid, text, integer, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.finalize_reminder_dispatch_v1p4(uuid, text, integer, text, timestamptz) to service_role;
