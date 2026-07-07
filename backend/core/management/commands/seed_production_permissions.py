from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.management.commands.bootstrap_uat_demo import ROLE_MATRIX
from core.models import Permission, Role
from core.permissions import PRODUCTION_PERMISSION_DEFINITIONS


PRODUCTION_PERMISSION_KEYS = {
    f"{row['resource']}:{row['action']}"
    for row in PRODUCTION_PERMISSION_DEFINITIONS
}


def _has_production_indicator(value):
    normalized = str(value or '').strip().lower()
    return normalized in {'production', 'prod', 'live'} or any(
        token in normalized
        for token in ('production-', '-production', 'prod-', '-prod', 'live-', '-live')
    )


def _assert_non_production_target():
    app_env = str(getattr(settings, 'APP_ENV', 'development') or 'development').strip().lower()
    db_config = settings.DATABASES.get('default', {})
    db_name = str(db_config.get('NAME', '') or '')
    db_host = str(db_config.get('HOST', '') or '')

    for value in (app_env, db_name, db_host):
        if _has_production_indicator(value):
            raise CommandError('Refusing Production permission seed on production/prod/live target.')


class Command(BaseCommand):
    help = 'Seed Production permissions without creating demo users, teams, or business data'

    def add_arguments(self, parser):
        parser.add_argument(
            '--grant-uat-roles',
            action='store_true',
            help='Grant Production permissions to existing UAT roles using the bootstrap role matrix',
        )

    def handle(self, *args, **options):
        _assert_non_production_target()
        grant_uat_roles = bool(options['grant_uat_roles'])
        created = 0
        updated = 0
        role_grants = 0
        skipped_roles = []

        with transaction.atomic():
            permission_map = {}
            for row in PRODUCTION_PERMISSION_DEFINITIONS:
                perm, was_created = Permission.objects.update_or_create(
                    resource=row['resource'],
                    action=row['action'],
                    defaults={
                        'code': row['code'],
                        'name': row['name'],
                    },
                )
                permission_map[f"{row['resource']}:{row['action']}"] = perm
                if was_created:
                    created += 1
                else:
                    updated += 1

            if grant_uat_roles:
                for role_row in ROLE_MATRIX:
                    production_keys = [
                        key
                        for key in role_row.get('permissions', [])
                        if key in PRODUCTION_PERMISSION_KEYS
                    ]
                    if not production_keys:
                        continue

                    role = Role.objects.filter(
                        code=role_row['code'],
                        deleted_at__isnull=True,
                    ).first()
                    if not role:
                        skipped_roles.append(role_row['code'])
                        continue

                    perms = [permission_map[key] for key in production_keys]
                    existing_ids = set(
                        role.permissions.filter(
                            id__in=[perm.id for perm in perms],
                        ).values_list('id', flat=True)
                    )
                    role.permissions.add(*perms)
                    role_grants += sum(1 for perm in perms if perm.id not in existing_ids)

        self.stdout.write(
            self.style.SUCCESS(
                f'Production permissions synced: {created} created, {updated} updated.'
            )
        )
        if grant_uat_roles:
            self.stdout.write(
                self.style.SUCCESS(
                    f'Production UAT role grants synced: {role_grants} new grants.'
                )
            )
            if skipped_roles:
                self.stdout.write(
                    self.style.WARNING(
                        f'Skipped missing roles: {", ".join(sorted(skipped_roles))}.'
                    )
                )
        else:
            self.stdout.write(
                'UAT role grants skipped; pass --grant-uat-roles to update existing roles only.'
            )
