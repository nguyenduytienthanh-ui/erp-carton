from django.db import migrations


PERMISSIONS = [
    {
        'resource': 'CORE',
        'action': 'VIEW_REPORTS',
        'code': 'CORE_VIEW_REPORTS',
        'name': 'View reports center',
        'description': 'Allow viewing the centralized reports center',
        'role_codes': ['ADMIN', 'MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'OPS_MANAGER', 'SALES_MANAGER', 'PRODUCT_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
]


def seed_reports_permission(apps, schema_editor):
    Permission = apps.get_model('core', 'Permission')
    Role = apps.get_model('core', 'Role')

    for row in PERMISSIONS:
        perm, _ = Permission.objects.update_or_create(
            resource=row['resource'],
            action=row['action'],
            defaults={
                'code': row['code'],
                'name': row['name'],
                'description': row['description'],
            },
        )
        for role_code in row['role_codes']:
            role = Role.objects.filter(code__iexact=role_code, deleted_at__isnull=True).first()
            if role:
                role.permissions.add(perm)


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0054_seed_production_permissions'),
    ]

    operations = [
        migrations.RunPython(seed_reports_permission, migrations.RunPython.noop),
    ]
