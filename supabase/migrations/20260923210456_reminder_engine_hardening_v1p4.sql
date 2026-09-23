drop extension pg_net;
create extension pg_net with schema extensions;

create or replace function public.claim_due_followup_reminders_v1p4(p_now timestamptz default now())
returns table (
  reminder_id uuid,
  reminder_user_id uuid,
  reminder_position text,
  reminder_scheduled_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select ri.id
    from public.reminder_instances ri
    where ri.completed_at is null
      and ri.initial_notification_sent_at is not null
      and ri.followup_dispatch_claimed_at is null
      and ri.followup_at <= p_now
    order by ri.followup_at, ri.id
    for update skip locked
  ),
  claimed as (
    update public.reminder_instances ri
       set followup_dispatch_claimed_at = p_now
      from due
     where ri.id = due.id
     returning ri.id, ri.user_id, ri.position, ri.scheduled_at
  )
  select c.id, c.user_id, c.position, c.scheduled_at
  from claimed c;
$$;

revoke all on function public.claim_due_followup_reminders_v1p4(timestamptz)
from public, anon, authenticated;
grant execute on function public.claim_due_followup_reminders_v1p4(timestamptz)
to service_role;
