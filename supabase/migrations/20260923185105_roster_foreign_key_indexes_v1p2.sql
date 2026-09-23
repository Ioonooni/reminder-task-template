-- Cover composite foreign keys separately from the date-oriented query indexes.
create index roster_user_department_fk_idx on public.roster_entries(user_id, department_id);
create index roster_shift_department_fk_idx on public.roster_entries(department_id, shift_type_id);
