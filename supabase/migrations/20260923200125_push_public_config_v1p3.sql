-- V1P3 public VAPID configuration for authenticated clients.
-- The VAPID public key is intentionally public cryptographic material; the private key remains in Vault.
create table public.push_config (
  id boolean primary key default true check (id),
  vapid_public_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.push_config (id, vapid_public_key)
values (true, 'UNCONFIGURED');

alter table public.push_config enable row level security;
revoke all on public.push_config from public, anon, authenticated;
grant select (vapid_public_key) on public.push_config to authenticated;

create policy push_config_read_authenticated
on public.push_config for select to authenticated
using (true);

drop function public.get_vapid_public_key();
