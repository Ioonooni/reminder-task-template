# Nurse Turning Reminder Template

Reusable PWA template for nurse roster-based turning reminders.

> Created by **IOON**  
> Canonical source: https://github.com/Ioonooni/reminder-task-template


## Original V1 Delivery

The original V1 product was delivered from the initial project brief to release in a **single overnight build cycle of approximately 10.5 hours (~11 hours) end-to-end**.

- Initial project brief: ~19:00, 23 Sep 2026
- Repository created / implementation began: 20:05
- V1 released to `main`: 05:22, 24 Sep 2026
- GitHub implementation window: **9 hours 17 minutes**

This delivery window covered requirements and architecture, authentication and role-based authorization, roster management, PWA/Web Push, the reminder lifecycle, validation, security/release work, and reusable deployment preparation.

> Delivery time is elapsed end-to-end project time, not uninterrupted manual coding time.

## What it does

- Email/password sign-up with 6-digit email verification
- Nurse and Head Nurse roles
- 30-day personal roster, multiple shifts per day
- Head Nurse department roster management
- PWA + Web Push
- Reminder schedule driven by roster and turning schedule
- Done action unlocks 10 minutes after the reminder
- One follow-up at T+40 if still incomplete
- Per-user state protected by Supabase RLS
- No patient name, HN, bed, diagnosis, or medical-record data

## Portfolio actions

**Use This** → create your own copy and connect your own Supabase/Vercel/VAPID configuration:

https://github.com/Ioonooni/reminder-task-template/generate

**Source** → this repository:

https://github.com/Ioonooni/reminder-task-template

**Try** → not provided as a shared hosted demo. This product is intentionally designed for isolated deployments so demo users never touch another organization's production data.

## Architecture

React/Vite PWA + Supabase Auth/Postgres/RLS/Cron/Edge Functions + Web Push.

Each deployment owns its own:
- Supabase project and users
- database/data
- VAPID key pair
- scheduler secret
- hosting project/domain

No external user should use IOON's private production database or credentials.

## Zero → running instance

### 1. Create your copy

Use GitHub **Use this template**, or clone/fork your own copy.

### 2. Install locally

```bash
npm install
cp .env.example .env
```

### 3. Create an isolated Supabase project

Install/link the Supabase CLI, then apply the migrations to a **new project only**:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

The reusable template starts with:
- one generic department: `หน่วยงานพยาบาล`
- timezone: `Asia/Bangkok`
- Morning 08:00–16:00
- Evening 16:00–00:00
- Night 00:00–08:00
- 12 canonical turning times

### 4. Generate your own VAPID keys

```bash
npx web-push generate-vapid-keys --json
```

Never commit the private key.

### 5. Configure per-instance secrets

Copy:

`supabase/manual/configure_v1_instance.sql.example`

Replace every `REPLACE_*` placeholder with values from **your own** instance:
- Supabase project URL
- Supabase publishable key
- VAPID public key
- VAPID private key
- a strong random scheduler secret

Run the filled copy in your Supabase SQL editor. Do **not** commit the filled copy.

Fresh template deployments keep push config unconfigured and the reminder Cron inactive until this step succeeds.

### 6. Deploy Edge Functions

```bash
supabase functions deploy test-push --no-verify-jwt
supabase functions deploy reminder-engine --no-verify-jwt
```

### 7. Configure Auth email verification

In Supabase Authentication:
- enable email/password signup
- configure your Site URL / Redirect URLs
- use `supabase/templates/confirmation.html` for the confirmation template

### 8. Configure frontend

Put only public frontend values in `.env`:

```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
```

Never expose a service-role/secret key to the browser.

### 9. Validate and build

```bash
npm run check
npm run build
npm run dev
```

Then follow [docs/VALIDATION.md](docs/VALIDATION.md).

### 10. Deploy over HTTPS

Deploy to Vercel or another HTTPS-capable host. Add the same two `VITE_*` public variables to the deployment environment and rebuild.

### 11. Bootstrap the first Head Nurse

1. Let the real Head Nurse sign up and confirm email normally.
2. Copy that user's UUID from Supabase Authentication → Users.
3. Fill and run `supabase/manual/promote_initial_head_nurse.sql`.
4. Sign out/in or refresh and verify the role.

All other new accounts remain `nurse` by default.

## Default turning schedule

| Local time | Position |
|---|---|
| 01:00 | Right |
| 03:00 | Left |
| 05:00 | Supine |
| 07:00 | Right |
| 09:00 | Left |
| 11:00 | Supine |
| 13:00 | Right |
| 15:00 | Left |
| 17:00 | Supine |
| 19:00 | Right |
| 21:00 | Left |
| 23:00 | Supine |

Night shift date X means 00:00–08:00 on date X.

## Documentation

- [Deployment](docs/DEPLOYMENT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Validation](docs/VALIDATION.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)

## Scope boundary

V1 does not include patient assignment, bed management, EMR/HIS integration, completion-performance dashboards, GPS, chat, AI, payroll, attendance, a shared multi-tenant SaaS backend, or a native mobile app.

## License

MIT License. See [LICENSE](LICENSE).

Copyright © 2026 IOON.
