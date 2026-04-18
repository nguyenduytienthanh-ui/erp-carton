from django.core.management.base import BaseCommand
from core.models import ColumnPermission


class Command(BaseCommand):
    help = 'Seed column permissions for products-list'

    def handle(self, *args, **options):
        permissions = [
            {
                'page': 'products-list',
                'column': 'cost_price',
                'column_label': 'Giá vốn',
                'allowed_roles': ['admin', 'manager', 'accountant'],
                'is_restricted': True,
            },
            {
                'page': 'products-list',
                'column': 'sale_price',
                'column_label': 'Giá bán',
                'allowed_roles': ['admin', 'manager', 'sales', 'accountant'],
                'is_restricted': True,
            },
            {
                'page': 'products-list',
                'column': 'commission_per_unit',
                'column_label': 'HHCĐ',
                'allowed_roles': ['admin', 'accountant'],
                'is_restricted': True,
            },
            {
                'page': 'products-list',
                'column': 'commission_percent',
                'column_label': 'HH%',
                'allowed_roles': ['admin', 'accountant'],
                'is_restricted': True,
            },
        ]

        created = 0
        for perm_data in permissions:
            perm, created_flag = ColumnPermission.objects.get_or_create(
                page=perm_data['page'],
                column=perm_data['column'],
                defaults={
                    'column_label': perm_data['column_label'],
                    'allowed_roles': perm_data['allowed_roles'],
                    'is_restricted': perm_data['is_restricted'],
                },
            )
            if created_flag:
                created += 1
                self.stdout.write(self.style.SUCCESS(f'✅ Created: {perm.column_label}'))

        self.stdout.write(
            self.style.SUCCESS(f'\n✅ Total created: {created}/{len(permissions)}')
        )
