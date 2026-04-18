from django.db import migrations


PERMISSIONS = [
    {
        'resource': 'INVENTORY',
        'action': 'MANAGE',
        'code': 'INVENTORY_MANAGE',
        'name': 'Manage inventory module',
        'description': 'Allow warehouse, stock, movement, and reservation management',
        'role_codes': ['ADMIN', 'MANAGER', 'OPS_MANAGER', 'PRODUCT_MANAGER', 'SALES_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
]


def seed_inventory_permissions(apps, schema_editor):
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
        ('core', '0051_seed_product_sales_permissions'),
    ]

    operations = [
        migrations.RunPython(seed_inventory_permissions, migrations.RunPython.noop),
    ]
