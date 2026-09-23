-- V1P2 roster. Every entry is bound to the same department as its user and shift.
-- The private schema is not exposed through the Data API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- Avoid recursive profiles policies; the function checks the caller against
-- server-owned profile fields and is never exposed as a public RPC.
create function private.can_manage_roster(target_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.department_id = target_department
      and p.role = 'head_nurse'
  );
$$;
revoke all on function private.can_manage_roster(uuid) from public, anon, authenticated;
grant execute on function private.can_manage_roster(uuid) to authenticated;

alter table public.profiles add constraint profiles_id_department_unique unique (id, department_id);

create table public.roster_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  department_id uuid not null,
  shift_type_id uuid not null,
  shift_date date not null,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roster_user_department_fkey foreign key (user_id, department_id)
    references public.profiles(id, department_id) on delete cascade,
  constraint roster_shift_department_fkey foreign key (department_id, shift_type_id)
    references public.shift_types(department_id, id),
  constraint roster_one_identical_shift unique (user_id, shift_date, shift_type_id)
);

create index roster_department_date_shift_idx on public.roster_entries(department_id, shift_date, shift_type_id);
create index roster_user_date_idx on public.roster_entries(user_id, shift_date);
create index roster_created_by_idx on public.roster_entries(created_by);

create function private.touch_roster_entry()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.touch_roster_entry() from public, anon, authenticated;
create trigger roster_updated_at before update on public.roster_entries
for each row execute function private.touch_roster_entry();

alter table public.roster_entries enable row level security;
revoke all on public.roster_entries from public, anon, authenticated;
grant select, delete on public.roster_entries to authenticated;
grant insert (user_id, department_id, shift_type_id, shift_date) on public.roster_entries to authenticated;
grant update (shift_type_id, shift_date) on public.roster_entries to authenticated;

-- Existing own_profile_read still applies. No cross-department profile access.
create policy head_nurse_department_profile_read on public.profiles for select to authenticated
using ((select private.can_manage_roster(department_id)));

create policy roster_select on public.roster_entries for select to authenticated
using (user_id = (select auth.uid()) or (select private.can_manage_roster(department_id)));

create policy roster_insert on public.roster_entries for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (user_id = (select auth.uid()) or (select private.can_manage_roster(department_id)))
);

create policy roster_update on public.roster_entries for update to authenticated
using (user_id = (select auth.uid()) or (select private.can_manage_roster(department_id)))
with check (user_id = (select auth.uid()) or (select private.can_manage_roster(department_id)));

create policy roster_delete on public.roster_entries for delete to authenticated
using (user_id = (select auth.uid()) or (select private.can_manage_roster(department_id)));
