# Deployment Guide

This repository is a self-hosted template. Each organization creates an isolated deployment with its own Supabase project, VAPID keys, users, data, and hosting.

## Required services

- GitHub or another source host
- Node.js + npm
- Supabase project
- Supabase CLI
- HTTPS hosting such as Vercel
- real iPhone/Android devices for notification validation

## Safe deployment order

1. Create a new repository from the template.
2. Create a new Supabase project.
3. Run `supabase db push`.
4. Generate a new VAPID key pair.
5. Fill and run `supabase/manual/configure_v1_instance.sql.example`.
6. Deploy `test-push` and `reminder-engine`.
7. Configure Auth email confirmation.
8. Configure the two public frontend environment variables.
9. Build/deploy the PWA.
10. Sign up the first real Head Nurse and promote it with the admin-only SQL script.
11. Complete real-device validation before operational use.

## Fresh-instance safety

The template intentionally ships with:
- `push_config.vapid_public_key = UNCONFIGURED`
- reminder Cron disabled until required Vault secrets are present

This prevents a copy from silently inheriting another deployment's push identity or sending reminders before setup is complete.

## Environment variables

Frontend only:

```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
```

Do not put service-role keys, private VAPID keys, passwords, or scheduler secrets in frontend environment variables.

## Vercel

Create a new Vercel project from your own repository and add the two `VITE_*` values to Production/Preview as appropriate. Deployment protection is an owner decision; an operational staff app must be accessible to intended users without requiring membership in the owner's Vercel team.

## Head Nurse role

New signups are always created as `nurse`. The first Head Nurse is promoted manually by the Supabase project owner after the account has confirmed its email.

Never expose role-promotion SQL as a browser RPC.
