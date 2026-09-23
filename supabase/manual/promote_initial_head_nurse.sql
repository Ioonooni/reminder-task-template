-- ADMIN ONLY. Run manually as project owner in the isolated project's SQL editor.
-- After this account has signed up and confirmed its email, replace the placeholder UUID
-- with that user's id from Authentication > Users. Check the email before committing.
-- Never expose this script as an RPC or run it with the browser publishable key.
begin;
do $$
begin
  if not exists (
    select 1 from auth.users
    where id = '00000000-0000-0000-0000-000000000000'::uuid
      and email = 'REPLACE_WITH_CONFIRMED_EMAIL'
      and email_confirmed_at is not null
  ) then
    raise exception 'User/email not confirmed or UUID does not match; no promotion';
  end if;
end $$;
update public.profiles
set role = 'head_nurse'
where id = '00000000-0000-0000-0000-000000000000'::uuid
  and role = 'nurse'
returning id, role, department_id;
do $$
begin
  if not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-000000000000'::uuid and role = 'head_nurse') then
    raise exception 'Expected Head Nurse promotion not found; transaction rolled back';
  end if;
end $$;
commit;
