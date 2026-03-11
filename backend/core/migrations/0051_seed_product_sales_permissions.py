from django.db import migrations


PERMISSIONS = [
    {
        'resource': 'PRODUCTCATEGORY',
        'action': 'EDIT',
        'code': 'PRODUCTCATEGORY_EDIT',
        'name': 'Edit product categories',
        'description': 'Allow bulk activate/deactivate product categories',
        'role_codes': ['ADMIN', 'MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'PRODUCTUNIT',
        'action': 'EDIT',
        'code': 'PRODUCTUNIT_EDIT',
        'name': 'Edit product units',
        'description': 'Allow bulk activate/deactivate product units',
        'role_codes': ['ADMIN', 'MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'PRODUCT',
        'action': 'EDIT',
        'code': 'PRODUCT_EDIT',
        'name': 'Edit products',
        'description': 'Allow bulk product updates and product maintenance actions',
        'role_codes': ['ADMIN', 'MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'PRODUCT',
        'action': 'IMPORT',
        'code': 'PRODUCT_IMPORT',
        'name': 'Import products',
        'description': 'Allow product import operations',
        'role_codes': ['ADMIN', 'MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'SALESORDER',
        'action': 'SUBMIT',
        'code': 'SALESORDER_SUBMIT',
        'name': 'Submit sales orders',
        'description': 'Allow submitting draft sales orders into approval workflow',
        'role_codes': ['ADMIN', 'MANAGER', 'SALES', 'SALES_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'SALESORDER',
        'action': 'APPROVE',
        'code': 'SALESORDER_APPROVE',
        'name': 'Approve sales orders',
        'description': 'Allow approving submitted sales orders',
        'role_codes': ['ADMIN', 'MANAGER', 'SALES_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'SALESORDER',
        'action': 'REJECT',
        'code': 'SALESORDER_REJECT',
        'name': 'Reject sales orders',
        'description': 'Allow rejecting submitted sales orders',
        'role_codes': ['ADMIN', 'MANAGER', 'SALES_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'SALESORDER',
        'action': 'POST',
        'code': 'SALESORDER_POST',
        'name': 'Post sales orders',
        'description': 'Allow financial posting of approved sales orders',
        'role_codes': ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'FINANCE', 'FINANCE_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'SALESORDER',
        'action': 'VOID',
        'code': 'SALESORDER_VOID',
        'name': 'Void sales orders',
        'description': 'Allow voiding approved or posted sales orders',
        'role_codes': ['ADMIN', 'MANAGER', 'SALES_MANAGER', 'FINANCE_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
]


def seed_product_sales_permissions(apps, schema_editor):
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
        ('core', '0050_seed_ops_workflow_audit_permissions'),
    ]

    operations = [
        migrations.RunPython(seed_product_sales_permissions, migrations.RunPython.noop),
    ]
