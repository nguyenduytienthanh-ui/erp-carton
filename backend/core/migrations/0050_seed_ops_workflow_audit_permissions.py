from django.db import migrations


PERMISSIONS = [
    {
        'resource': 'OPS',
        'action': 'VIEW',
        'code': 'OPS_VIEW',
        'name': 'View operations cockpit',
        'description': 'Allow access to executive cockpit and task operations pages',
        'role_codes': ['ADMIN', 'MANAGER', 'OPERATION_MANAGER', 'OPS_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'WORKFLOW',
        'action': 'VIEW',
        'code': 'WORKFLOW_VIEW',
        'name': 'View workflow boards',
        'description': 'Allow access to workflow pipeline and workflow analytics pages',
        'role_codes': ['ADMIN', 'MANAGER', 'OPERATION_MANAGER', 'OPS_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'WORKFLOW',
        'action': 'MANAGE',
        'code': 'WORKFLOW_MANAGE',
        'name': 'Manage workflow templates',
        'description': 'Allow create/update/delete workflow templates and move workflow cards',
        'role_codes': ['ADMIN', 'MANAGER', 'OPERATION_MANAGER', 'OPS_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'CORE',
        'action': 'VIEW_OPERATIONS_LOG',
        'code': 'CORE_VIEW_OPERATIONS_LOG',
        'name': 'View operations log',
        'description': 'Allow access to operations log dashboard and live operational audit feeds',
        'role_codes': ['ADMIN', 'MANAGER', 'OPERATION_MANAGER', 'OPS_MANAGER', 'QUAN_LY', 'QUANLY'],
    },
    {
        'resource': 'CORE',
        'action': 'VIEW_RBAC_AUDIT',
        'code': 'CORE_VIEW_RBAC_AUDIT',
        'name': 'View RBAC audit history',
        'description': 'Allow access to role-module permission history and anomaly monitoring',
        'role_codes': ['ADMIN', 'MANAGER', 'QUAN_LY', 'QUANLY'],
    },
]


def seed_ops_workflow_audit_permissions(apps, schema_editor):
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
            role = Role.objects.filter(code__iexact=role_code).first()
            if role:
                role.permissions.add(perm)


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0049_seed_core_manage_rbac_permission'),
    ]

    operations = [
        migrations.RunPython(seed_ops_workflow_audit_permissions, migrations.RunPython.noop),
    ]
