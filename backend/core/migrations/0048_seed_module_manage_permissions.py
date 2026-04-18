from django.db import migrations


def seed_module_manage_permissions(apps, schema_editor):
    Permission = apps.get_model('core', 'Permission')
    Role = apps.get_model('core', 'Role')

    workforce_perm, _ = Permission.objects.update_or_create(
        resource='WORKFORCE',
        action='MANAGE',
        defaults={
            'code': 'WORKFORCE_MANAGE',
            'name': 'Manage Workforce module',
            'description': 'Allow create/update/delete/calculate/lock workforce data',
        },
    )
    finance_perm, _ = Permission.objects.update_or_create(
        resource='FINANCE',
        action='MANAGE',
        defaults={
            'code': 'FINANCE_MANAGE',
            'name': 'Manage Finance module',
            'description': 'Allow create/update/delete/export finance data',
        },
    )

    workforce_role_codes = ['ADMIN', 'MANAGER', 'HR', 'HR_MANAGER', 'PAYROLL']
    finance_role_codes = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'FINANCE', 'FINANCE_MANAGER']

    for role_code in workforce_role_codes:
        role = Role.objects.filter(code__iexact=role_code).first()
        if role:
            role.permissions.add(workforce_perm)

    for role_code in finance_role_codes:
        role = Role.objects.filter(code__iexact=role_code).first()
        if role:
            role.permissions.add(finance_perm)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0047_rename_task_watche_user_id_8d1637_idx_task_watche_user_id_f5295c_idx_and_more'),
    ]

    operations = [
        migrations.RunPython(seed_module_manage_permissions, migrations.RunPython.noop),
    ]

