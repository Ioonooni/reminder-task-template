-- Index foreign keys used for department boundaries and shift lookup.
create index profiles_department_id_idx on public.profiles(department_id);
create index turning_schedule_department_shift_idx on public.turning_schedule(department_id,shift_type_id);
