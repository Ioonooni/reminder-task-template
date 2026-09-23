-- V1P3 frontend filters push_config by id, so authenticated clients need read access
-- to the singleton id plus the public VAPID key. No private material is exposed.
revoke all on public.push_config from authenticated;
grant select (id, vapid_public_key) on public.push_config to authenticated;
