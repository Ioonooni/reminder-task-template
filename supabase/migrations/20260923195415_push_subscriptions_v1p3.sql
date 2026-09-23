-- V1P3 push subscription persistence. Subscriptions are owned by the authenticated user.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  public_key text not null,
  auth_key text not null,
  user_agent text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_endpoint_nonempty check (length(btrim(endpoint)) > 0),
  constraint push_public_key_nonempty check (length(btrim(public_key)) > 0),
  constraint push_auth_key_nonempty check (length(btrim(auth_key)) > 0)
);

create index push_subscriptions_user_active_idx on public.push_subscriptions(user_id, active);

create function private.touch_push_subscription()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.touch_push_subscription() from public, anon, authenticated;

create trigger push_subscriptions_updated_at before update on public.push_subscriptions
for each row execute function private.touch_push_subscription();

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant insert (user_id, endpoint, public_key, auth_key, user_agent, active, last_seen_at) on public.push_subscriptions to authenticated;
grant update (public_key, auth_key, user_agent, active, last_seen_at) on public.push_subscriptions to authenticated;

create policy push_subscriptions_select_own on public.push_subscriptions for select to authenticated
using (user_id = (select auth.uid()));

create policy push_subscriptions_insert_own on public.push_subscriptions for insert to authenticated
with check (user_id = (select auth.uid()));

create policy push_subscriptions_update_own on public.push_subscriptions for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy push_subscriptions_delete_own on public.push_subscriptions for delete to authenticated
using (user_id = (select auth.uid()));
