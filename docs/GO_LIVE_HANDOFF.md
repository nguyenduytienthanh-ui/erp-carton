# Go-Live Handoff

This note ties together the new operational commands added for go-live readiness.

## 1. Alert drill

Run a manual delivery drill before production cutover:

```powershell
cd backend
python manage.py send_test_alert --json
```

Recommended:
- Configure at least one real channel in `ALERT_EMAIL_RECIPIENTS`, `ALERT_SLACK_WEBHOOK_URL`, `ALERT_TELEGRAM_BOT_TOKEN` + `ALERT_TELEGRAM_CHAT_ID`, or `SENTRY_DSN`.
- Confirm the alert arrives in the real bridge and is acknowledged by IT.
- Review recent results from `AdminObservabilityCenter` or `python manage.py release_readiness --json`.

## 2. Audit retention

Preview retention cleanup:

```powershell
cd backend
python manage.py purge_audit_logs --dry-run --json
```

Execute retention cleanup after approval:

```powershell
python manage.py purge_audit_logs --confirm --json
```

Recommended:
- Keep `AUDIT_LOG_RETENTION_DAYS` aligned with policy and compliance sign-off.
- Export critical investigations before purge windows are shortened.
- Record the cleanup result in the release notes.

## 3. Handoff bundle

Generate the final operations bundle for staging, UAT, or production:

```powershell
cd backend
python manage.py go_live_handoff --environment staging --json
```

Optional file export:

```powershell
python manage.py go_live_handoff --environment production --output ..\docs\GO_LIVE_HANDOFF_PRODUCTION.json --json
```

The bundle includes:
- release readiness status
- release hygiene status
- performance readiness status
- cleanup preview and release lock guidance
- promotion rehearsal status
- UAT access matrix coverage
- permission surface audit coverage
- recommended follow-up commands
- document references for IT handoff

## 4. Suggested cutover order

1. `python manage.py backup --json`
2. `python manage.py restore <backup_dir> --dry-run --json`
3. `python manage.py migrate`
4. `python manage.py release_hygiene --json`
5. `python manage.py cleanup_release_artifacts --json`
6. `python manage.py release_lockfile --environment staging --json`
7. `python manage.py performance_readiness --json`
8. `python manage.py performance_drilldown --json`
9. `python manage.py uat_access_matrix --json`
10. `python manage.py permission_surface_audit --json`
11. `python manage.py send_test_alert --json`
12. `python manage.py release_readiness --json`
13. `python manage.py go_live_handoff --environment production --json`

## 5. Exit criteria

- No pending migrations
- Latest backup and restore drill are `ok`
- UAT personas are complete
- At least one monitored alert channel is configured and tested
- Audit retention policy is confirmed and the latest dry-run is reviewed
