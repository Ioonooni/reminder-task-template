-- V1P3 VAPID keys are stored in Supabase Vault outside migration history.
-- Authenticated clients can read only the public key; the private key accessor is backend-only.
create function public.get_vapid_public_key()
returns text language plpgsql stable security definer set search_path = '' as $$
declare result text;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  select decrypted_secret into result from vault.decrypted_secrets
  where name = 'v1p3_vapid_public_key' limit 1;
  return result;
end;
$$;
revoke all on function public.get_vapid_public_key() from public, anon;
grant execute on function public.get_vapid_public_key() to authenticated;

create function public.get_vapid_private_key_for_backend()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'v1p3_vapid_private_key' limit 1;
$$;
revoke all on function public.get_vapid_private_key_for_backend() from public, anon, authenticated;
grant execute on function public.get_vapid_private_key_for_backend() to service_role;
