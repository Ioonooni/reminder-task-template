# Architecture

## Components

- React + Vite PWA
- Supabase Auth
- Postgres + RLS
- Supabase Cron
- Supabase Edge Functions
- Web Push / service worker

## Authorization

- Nurse: own profile and own roster
- Head Nurse: department roster management
- Client cannot self-promote role or change department
- Reminder completion is authorized server-side
- VAPID private key and scheduler secret stay server-side

## Reminder lifecycle

```
T       initial reminder
T+10    Done becomes actionable
T+40    one follow-up if still incomplete
```

Current roster is authoritative for future reminder eligibility. Completed reminders do not receive the follow-up.

## Deployment boundary

This is an independent-deployment template, not a shared SaaS.

Every adopter owns a separate project/data/security boundary. There is no central IOON operational database for external users.
