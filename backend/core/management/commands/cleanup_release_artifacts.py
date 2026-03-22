from __future__ import annotations

import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import AuditLog
from core.release_readiness import get_release_hygiene_payload


def _artifact_category(path_value: str) -> str:
    normalized = str(path_value or '').replace('\\', '/').lower()
    if normalized.endswith('.log'):
        return 'log'
    if normalized.endswith('/restore_dry_run.json') or normalized.endswith('/restore_last_run.json'):
        return 'restore_report'
    if normalized.endswith('go_live_handoff_latest.json'):
        return 'handoff_bundle'
    if normalized.endswith('release_lock_latest.json'):
        return 'release_lockfile'
    return 'generated_artifact'


class Command(BaseCommand):
    help = 'Preview or remove generated release artifacts that should not stay in the final release workspace'

    def add_arguments(self, parser):
        parser.add_argument('--confirm', action='store_true', help='Actually delete the detected artifact files')
        parser.add_argument('--json', action='store_true', help='Print result as JSON')

    def handle(self, *args, **options):
        repo_root = Path(settings.BASE_DIR).parent.resolve()
        hygiene_payload = get_release_hygiene_payload()
        candidates = list(hygiene_payload.get('artifact_candidates') or [])
        confirm = bool(options.get('confirm'))

        removed_count = 0
        missing_count = 0
        blocked_count = 0
        items = []

        for raw_path in candidates:
            relative_path = str(raw_path or '').replace('\\', '/').strip()
            if not relative_path:
                continue
            candidate_path = (repo_root / relative_path).resolve()
            try:
                candidate_path.relative_to(repo_root)
            except ValueError:
                blocked_count += 1
                items.append({
                    'path': relative_path,
                    'category': _artifact_category(relative_path),
                    'exists': False,
                    'removed': False,
                    'status': 'blocked',
                })
                continue

            exists = candidate_path.exists()
            removed = False
            status_value = 'ok'
            if not exists:
                missing_count += 1
                status_value = 'missing'
            elif candidate_path.is_dir():
                blocked_count += 1
                status_value = 'blocked'
            elif confirm:
                candidate_path.unlink()
                removed = True
                removed_count += 1
                status_value = 'removed'
            else:
                status_value = 'detected'

            items.append({
                'path': relative_path,
                'category': _artifact_category(relative_path),
                'exists': exists,
                'removed': removed,
                'status': status_value,
            })

        existing_count = sum(1 for item in items if item['exists'])
        remaining_count = existing_count - removed_count
        warnings = []
        if remaining_count > 0 and not confirm:
            warnings.append('Generated artifacts are still present in the working tree.')
        if blocked_count > 0:
            warnings.append('Some artifact paths could not be removed automatically.')

        payload = {
            'generated_at': timezone.now(),
            'mode': 'apply' if confirm else 'dry_run',
            'repo_root': str(repo_root),
            'artifact_count': len(items),
            'existing_count': existing_count,
            'removed_count': removed_count,
            'missing_count': missing_count,
            'blocked_count': blocked_count,
            'remaining_count': remaining_count,
            'items': items,
            'recommended_commands': [
                'python manage.py cleanup_release_artifacts --json',
                'python manage.py cleanup_release_artifacts --confirm --json',
                'python manage.py release_hygiene --json',
            ],
            'warnings': warnings,
            'status': 'warning' if warnings else 'ok',
        }

        AuditLog.objects.create(
            user=None,
            action='DELETE' if confirm else 'DRY_RUN',
            entity_type='ReleaseArtifactCleanup',
            entity_id=0,
            entity_id_str='worktree',
            entity_code='WORKTREE',
            old_values={},
            new_values={
                'mode': payload['mode'],
                'artifact_count': payload['artifact_count'],
                'removed_count': payload['removed_count'],
                'remaining_count': payload['remaining_count'],
                'blocked_count': payload['blocked_count'],
            },
            changed_fields=['artifact_count', 'removed_count', 'remaining_count'],
        )

        if options.get('json'):
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(f"Release artifact cleanup: {payload['status'].upper()}")
            self.stdout.write(f"- mode: {payload['mode']}")
            self.stdout.write(f"- detected: {payload['artifact_count']}")
            self.stdout.write(f"- removed: {payload['removed_count']}")
            self.stdout.write(f"- remaining: {payload['remaining_count']}")
