-- V1P1: run against a NEW, isolated Supabase project only.
create table public.departments (
  id uuid primary key,
  name text not null check (length(btrim(name)) between 1 and 150),
  timezone text not null default 'Asia/Bangkok' check (timezone = 'Asia/Bangkok'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (length(btrim(first_name)) between 1 and 100),
  last_name text not null check (length(btrim(last_name)) between 1 and 100),
  role text not null default 'nurse' check (role in ('nurse','head_nurse')),
  department_id uuid not null references public.departments(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shift_types (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id),
  code text not null check (code in ('MORNING','EVENING','NIGHT')),
  starts_at time not null,
  ends_at time not null,
  unique (department_id, code),
  unique (department_id, id)
);

create table public.turning_schedule (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id),
  shift_type_id uuid not null,
  at_time time not null,
  position text not null check (position in ('RIGHT','LEFT','SUPINE')),
  unique (department_id, at_time),
  foreign key (department_id, shift_type_id) references public.shift_types(department_id, id)
);

insert into public.departments(id,name,timezone)
values ('3f1a3060-49af-45ea-a799-589047100001','หน่วยงานพยาบาล','Asia/Bangkok');

insert into public.shift_types(department_id,code,starts_at,ends_at) values
('3f1a3060-49af-45ea-a799-589047100001','MORNING','08:00','16:00'),
('3f1a3060-49af-45ea-a799-589047100001','EVENING','16:00','00:00'),
('3f1a3060-49af-45ea-a799-589047100001','NIGHT','00:00','08:00');

insert into public.turning_schedule(department_id,shift_type_id,at_time,position)
select '3f1a3060-49af-45ea-a799-589047100001', s.id, v.at_time::time, v.position
from (values
 ('01:00','NIGHT','RIGHT'),('03:00','NIGHT','LEFT'),('05:00','NIGHT','SUPINE'),('07:00','NIGHT','RIGHT'),
 ('09:00','MORNING','LEFT'),('11:00','MORNING','SUPINE'),('13:00','MORNING','RIGHT'),('15:00','MORNING','LEFT'),
 ('17:00','EVENING','SUPINE'),('19:00','EVENING','RIGHT'),('21:00','EVENING','LEFT'),('23:00','EVENING','SUPINE')
) v(at_time,code,position)
join public.shift_types s on s.code=v.code and s.department_id='3f1a3060-49af-45ea-a799-589047100001';

-- Role and department are server assigned. Do not trust user_metadata for permissions.
create function public.create_nurse_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,first_name,last_name,role,department_id)
  values (new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data->>'first_name'),''),'ชื่อ'),100),
    left(coalesce(nullif(btrim(new.raw_user_meta_data->>'last_name'),''),'นามสกุล'),100),
    'nurse','3f1a3060-49af-45ea-a799-589047100001');
  return new;
end;
$$;
revoke all on function public.create_nurse_profile() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.create_nurse_profile();

create function public.touch_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.touch_profile() from public, anon, authenticated;
create trigger profile_updated_at before update on public.profiles
for each row execute function public.touch_profile();

alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.shift_types enable row level security;
alter table public.turning_schedule enable row level security;

-- Only these grants are available through ordinary authenticated API calls.
revoke all on public.departments,public.profiles,public.shift_types,public.turning_schedule from public,anon,authenticated;
grant usage on schema public to authenticated;
grant select on public.departments,public.shift_types,public.turning_schedule to authenticated;
grant select on public.profiles to authenticated;
grant update (first_name,last_name) on public.profiles to authenticated;

create policy own_profile_read on public.profiles for select to authenticated
using (id = (select auth.uid()));
create policy own_profile_update on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy department_read on public.departments for select to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.department_id = departments.id));
create policy shift_read on public.shift_types for select to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.department_id = shift_types.department_id));
create policy schedule_read on public.turning_schedule for select to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.department_id = turning_schedule.department_id));
