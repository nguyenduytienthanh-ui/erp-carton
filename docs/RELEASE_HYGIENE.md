# Release Hygiene

This checklist helps IT lock the release branch before tagging or production promotion.

## 1. Inspect the branch

```powershell
cd backend
python manage.py release_hygiene --json
```

Review:
- current branch and commit
- open changes in the working tree
- migration files still moving in the branch
- generated artifacts such as logs or dry-run bundles

## 2. Clean the workspace

Recommended checks:

```powershell
git status --short
git diff --stat
```

Focus items:
- close or split unrelated changes before creating a release tag
- lock the migration list that belongs to the release
- remove generated logs and temporary artifacts from the final release branch

Preview generated artifact cleanup:

```powershell
python manage.py cleanup_release_artifacts --json
```

Apply cleanup when the preview looks correct:

```powershell
python manage.py cleanup_release_artifacts --confirm --json
```

Export a release lockfile after the branch is stable:

```powershell
python manage.py release_lockfile --environment staging --json
```

## 3. Tagging gate

Only tag when:
- no unresolved merge conflicts remain
- the release branch contains only intended code and migration changes
- backup, restore, alert drill, and release readiness have all been reviewed

Example:

```powershell
git tag v2026.03.22
```
