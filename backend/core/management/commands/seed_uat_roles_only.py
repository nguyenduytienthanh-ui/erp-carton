from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.management.commands.bootstrap_uat_demo import ROLE_MATRIX
from core.models import Role


EXPECTED_UAT_ROLE_CODES = (
    'ADMIN',
    'MANAGER',
    'FINANCE_MANAGER',
    'OPS_MANAGER',
    'PRODUCT_MANAGER',
)

ROLE_ROWS = {
    row['code']: row
    for row in ROLE_MATRIX
    if row['code'] in EXPECTED_UAT_ROLE_CODES
}


def _has_production_indicator(value):
    normalized = str(value or '').strip().lower()
    return normalized in {'production', 'prod', 'live'} or any(
        token in normalized
        for token in ('production-', '-production', 'prod-', '-prod', 'live-', '-live')
    )


def _assert_safe_target():
    app_env = str(getattr(settings, 'APP_ENV', 'development') or 'development').strip().lower()
    db_config = settings.DATABASES.get('default', {})
    db_name = str(db_config.get('NAME', '') or '')
    db_host = str(db_config.get('HOST', '') or '')

    for value in (app_env, db_name, db_host):
        if _has_production_indicator(value):
            raise CommandError('Refusing role-only seed on production/prod/live target.')

    if app_env == 'sandbox':
        expected = {
            'NAME': 'erp_carton_sandbox',
            'USER': 'erp_carton_sandbox_user',
            'HOST': '127.0.0.1',
            'PORT': '5432',
        }
        for key, expected_value in expected.items():
            actual_value = str(db_config.get(key, '') or '')
            if actual_value != expected_value:
                raise CommandError(f'Refusing role-only seed: sandbox {key} mismatch.')
        return

    if app_env == 'test' or db_name == ':memory:' or db_name.startswith('test_'):
        return

    raise CommandError('Role-only seed is allowed only on explicit sandbox or Django test DB.')


class Command(BaseCommand):
    help = 'Seed expected UAT roles only; does not create users, teams, permissions, or business data'

    def handle(self, *args, **options):
        _assert_safe_target()

        created = 0
        existing = 0

        with transaction.atomic():
            for code in EXPECTED_UAT_ROLE_CODES:
                row = ROLE_ROWS[code]
                role = Role.objects.filter(code=code, deleted_at__isnull=True).first()
                if role:
                    existing += 1
                    continue

                Role.objects.create(
                    code=code,
                    name=row['name'],
                    sort_order=row.get('sort_order', 0),
                    is_active=True,
                    description='UAT role-only sandbox seed',
                )
                created += 1

        self.stdout.write(
            self.style.SUCCESS(
                f'UAT roles synced: {created} created, {existing} existing.'
            )
        )
        self.stdout.write('No users, teams, permissions, or business data were created.')
