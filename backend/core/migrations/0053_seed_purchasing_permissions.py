from django.db import migrations


PERMISSIONS = [
    {
        'resource': 'PURCHASING',
        'action': 'MANAGE',
        'code': 'PURCHASING_MANAGE',
        'name': 'Manage purchasing module',
        'description': 'Allow managing suppliers, purchase orders, and receipts',
        'role_codes': ['ADMIN', 'MANAGER', 'OPS_MANAGER', 'PRODUCT_MANAGER', 'FINANCE_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'PURCHASEORDER',
        'action': 'SUBMIT',
        'code': 'PURCHASEORDER_SUBMIT',
        'name': 'Submit purchase orders',
        'description': 'Allow submitting draft purchase orders into approval workflow',
        'role_codes': ['ADMIN', 'MANAGER', 'OPS_MANAGER', 'PRODUCT_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'PURCHASEORDER',
        'action': 'APPROVE',
        'code': 'PURCHASEORDER_APPROVE',
        'name': 'Approve purchase orders',
        'description': 'Allow approving submitted purchase orders',
        'role_codes': ['ADMIN', 'MANAGER', 'FINANCE_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'PURCHASEORDER',
        'action': 'REJECT',
        'code': 'PURCHASEORDER_REJECT',
        'name': 'Reject purchase orders',
        'description': 'Allow rejecting submitted purchase orders',
        'role_codes': ['ADMIN', 'MANAGER', 'FINANCE_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'PURCHASEORDER',
        'action': 'RECEIVE',
        'code': 'PURCHASEORDER_RECEIVE',
        'name': 'Receive purchase orders',
        'description': 'Allow receiving approved purchase orders into inventory',
        'role_codes': ['ADMIN', 'MANAGER', 'OPS_MANAGER', 'PRODUCT_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'PURCHASEORDER',
        'action': 'CANCEL',
        'code': 'PURCHASEORDER_CANCEL',
        'name': 'Cancel purchase orders',
        'description': 'Allow cancelling purchase orders or purchase receipts',
        'role_codes': ['ADMIN', 'MANAGER', 'FINANCE_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
]


def seed_purchasing_permissions(apps, schema_editor):
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
        ('core', '0052_seed_inventory_permissions'),
    ]

    operations = [
        migrations.RunPython(seed_purchasing_permissions, migrations.RunPython.noop),
    ]
