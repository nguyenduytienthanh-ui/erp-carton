# Release Lock

Use the release lockfile to freeze the exact branch state that is being promoted.

## 1. Export the lockfile

```powershell
cd backend
python manage.py release_lockfile --environment staging --json
```

Optional output path:

```powershell
python manage.py release_lockfile --environment production --output ..\docs\RELEASE_LOCK_PRODUCTION.json --json
```

## 2. What it captures

- branch, commit SHA, and latest tag
- pending migration summary and migration files still open in the working tree
- latest backup bundle metadata
- cleanup preview for generated artifacts
- readiness, rehearsal, and UAT coverage reports

## 3. Exit criteria

- branch/commit in the lockfile match the branch that will be tagged
- pending migrations are understood and frozen for the release
- cleanup preview is reviewed and non-code artifacts are removed
- UAT persona coverage and permission surface audit are attached to the cutover packet
