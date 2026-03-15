from django.db import migrations


PERMISSIONS = [
    {
        'resource': 'PRODUCTION',
        'action': 'MANAGE',
        'code': 'PRODUCTION_MANAGE',
        'name': 'Manage production module',
        'description': 'Allow managing production orders, material issues, and production receipts',
        'role_codes': ['ADMIN', 'MANAGER', 'OPS_MANAGER', 'PRODUCT_MANAGER', 'FINANCE_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'PRODUCTIONORDER',
        'action': 'SUBMIT',
        'code': 'PRODUCTIONORDER_SUBMIT',
        'name': 'Submit production orders',
        'description': 'Allow submitting production orders into approval workflow',
        'role_codes': ['ADMIN', 'MANAGER', 'OPS_MANAGER', 'PRODUCT_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'PRODUCTIONORDER',
        'action': 'APPROVE',
        'code': 'PRODUCTIONORDER_APPROVE',
        'name': 'Approve production orders',
        'description': 'Allow approving submitted production orders',
        'role_codes': ['ADMIN', 'MANAGER', 'FINANCE_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'PRODUCTIONORDER',
        'action': 'REJECT',
        'code': 'PRODUCTIONORDER_REJECT',
        'name': 'Reject production orders',
        'description': 'Allow rejecting submitted production orders',
        'role_codes': ['ADMIN', 'MANAGER', 'FINANCE_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'PRODUCTIONORDER',
        'action': 'RELEASE',
        'code': 'PRODUCTIONORDER_RELEASE',
        'name': 'Release production orders',
        'description': 'Allow releasing approved production orders to the shop floor',
        'role_codes': ['ADMIN', 'MANAGER', 'OPS_MANAGER', 'PRODUCT_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'PRODUCTIONORDER',
        'action': 'ISSUE',
        'code': 'PRODUCTIONORDER_ISSUE',
        'name': 'Issue production materials',
        'description': 'Allow issuing raw materials for production orders',
        'role_codes': ['ADMIN', 'MANAGER', 'OPS_MANAGER', 'PRODUCT_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'PRODUCTIONORDER',
        'action': 'RECEIVE',
        'code': 'PRODUCTIONORDER_RECEIVE',
        'name': 'Receive production output',
        'description': 'Allow receiving finished goods from production orders',
        'role_codes': ['ADMIN', 'MANAGER', 'OPS_MANAGER', 'PRODUCT_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'PRODUCTIONORDER',
        'action': 'CANCEL',
        'code': 'PRODUCTIONORDER_CANCEL',
        'name': 'Cancel production orders',
        'description': 'Allow cancelling production orders, issues, or receipts',
        'role_codes': ['ADMIN', 'MANAGER', 'FINANCE_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
]


def seed_production_permissions(apps, schema_editor):
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
        ('core', '0053_seed_purchasing_permissions'),
    ]

    operations = [
        migrations.RunPython(seed_production_permissions, migrations.RunPython.noop),
    ]
