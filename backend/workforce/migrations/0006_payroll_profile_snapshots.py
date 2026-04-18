from django.db import migrations, models


def backfill_payroll_profile_snapshots(apps, schema_editor):
    PayrollRecord = apps.get_model('workforce', 'PayrollRecord')
    EmployeeProfileHistory = apps.get_model('workforce', 'EmployeeProfileHistory')

    for payroll in PayrollRecord.objects.select_related('employee').all().iterator():
        history = None
        if getattr(payroll, 'profile_effective_month', ''):
            history = (
                EmployeeProfileHistory.objects
                .filter(employee_id=payroll.employee_id, effective_month=payroll.profile_effective_month)
                .order_by('-id')
                .first()
            )
        if history is None:
            history = (
                EmployeeProfileHistory.objects
                .filter(employee_id=payroll.employee_id, effective_month__lte=payroll.month)
                .order_by('-effective_month', '-id')
                .first()
            )
        payroll.employee_department_snapshot = history.department if history else (payroll.employee.department or '')
        payroll.employee_position_snapshot = history.position if history else (payroll.employee.position or '')
        payroll.save(update_fields=['employee_department_snapshot', 'employee_position_snapshot'])


class Migration(migrations.Migration):

    dependencies = [
        ('workforce', '0005_employee_profile_history'),
    ]

    operations = [
        migrations.AddField(
            model_name='payrollrecord',
            name='employee_department_snapshot',
            field=models.CharField(blank=True, default='', max_length=120, verbose_name='Phòng ban snapshot'),
        ),
        migrations.AddField(
            model_name='payrollrecord',
            name='employee_position_snapshot',
            field=models.CharField(blank=True, default='', max_length=120, verbose_name='Chức vụ snapshot'),
        ),
        migrations.RunPython(backfill_payroll_profile_snapshots, migrations.RunPython.noop),
    ]
