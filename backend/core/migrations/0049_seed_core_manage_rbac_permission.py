from django.db import migrations


def seed_core_manage_rbac_permission(apps, schema_editor):
    Permission = apps.get_model('core', 'Permission')
    Role = apps.get_model('core', 'Role')

    perm, _ = Permission.objects.update_or_create(
        resource='CORE',
        action='MANAGE_RBAC',
        defaults={
            'code': 'CORE_MANAGE_RBAC',
            'name': 'Manage RBAC settings',
            'description': 'Allow managing role-module permission matrix',
        },
    )

    for role_code in ['ADMIN', 'MANAGER']:
        role = Role.objects.filter(code__iexact=role_code).first()
        if role:
            role.permissions.add(perm)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0048_seed_module_manage_permissions'),
    ]

    operations = [
        migrations.RunPython(seed_core_manage_rbac_permission, migrations.RunPython.noop),
    ]

