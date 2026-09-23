# Validation Guide

Do not treat a successful build as proof that reminders work.

## Authentication
- signup
- 6-digit email verification
- valid/invalid login
- session refresh
- logout
- role escalation blocked

## Roster
- Nurse add/edit/delete own shifts
- multiple shifts in one day
- exact duplicate rejected
- Nurse cannot read/edit another Nurse's roster
- Head Nurse can manage same-department roster
- last-minute roster change affects future eligibility

## Push
- PWA install
- permission flow
- subscription persisted to correct user
- test push
- expired 404/410 subscription handling
- notification click opens/focuses app

## Real-device validation
For every production deployment, verify supported device classes actually used by the organization:
- app not foregrounded
- locked screen
- expected message and position
- notification click behavior

Do not infer Android support from iPhone evidence or vice versa.

## Reminder engine
- all 12 schedule times
- timezone/date transition
- off-shift exclusion
- T+10 lock/unlock
- completion persistence
- one follow-up only when incomplete
- completion suppresses follow-up
- duplicate scheduler invocation is idempotent
- backend delay within 5 minutes catches up
- stale reminders older than the bounded 5-minute catch-up window are not replayed

## Security
- Supabase Security Advisor
- RLS enabled
- no privileged secret in frontend/source
- no production credentials in repository
- no patient-data domain added unintentionally

Record commit SHA, deployment ID, device/browser/OS, and any owner-approved waiver.
