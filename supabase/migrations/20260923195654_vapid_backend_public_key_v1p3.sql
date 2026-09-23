-- Backend needs the matching public VAPID key to sign Web Push messages.
create function public.get_vapid_public_key_for_backend()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'v1p3_vapid_public_key' limit 1;
$$;
revoke all on function public.get_vapid_public_key_for_backend() from public, anon, authenticated;
grant execute on function public.get_vapid_public_key_for_backend() to service_role;
