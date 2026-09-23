# Known Limitations

- The default template is a single department using `Asia/Bangkok`.
- The default shift pattern and 12 turning times are seeded for the initial use case; customize deliberately before first deployment if your workflow differs.
- Scheduler catch-up is bounded to 5 minutes. Older stale reminders are not replayed.
- Web Push delivery depends on browser/OS/push service/network behavior.
- If a user denies notification permission, the app cannot override the device/browser setting.
- Real-device Web Push must be validated separately on each supported platform.
- V1 stores no patient-specific data and has no completion-performance dashboard.
- Third-party provider pricing/limits may change.
