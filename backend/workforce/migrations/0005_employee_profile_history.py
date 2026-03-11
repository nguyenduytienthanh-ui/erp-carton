from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
from django.utils import timezone


def _initial_effective_month(employee):
    start_date = getattr(employee, 'start_date', None)
    if start_date:
        return start_date.strftime('%Y-%m')
    created_at = getattr(employee, 'created_at', None)
    if created_at:
        return created_at.strftime('%Y-%m')
    return timezone.localdate().strftime('%Y-%m')


def seed_employee_profile_history(apps, schema_editor):
    Employee = apps.get_model('workforce', 'Employee')
    EmployeeProfileHistory = apps.get_model('workforce', 'EmployeeProfileHistory')
    PayrollRecord = apps.get_model('workforce', 'PayrollRecord')

    for employee in Employee.objects.all().iterator():
        effective_month = _initial_effective_month(employee)
        EmployeeProfileHistory.objects.get_or_create(
            employee_id=employee.id,
            effective_month=effective_month,
            defaults={
                'salary_basic': employee.salary_basic,
                'department': employee.department,
                'position': employee.position,
                'status': employee.status,
                'note': 'Backfill từ hồ sơ nhân viên hiện tại',
                'search_text': '',
                'created_by_id': employee.created_by_id,
                'updated_by_id': employee.updated_by_id,
            },
        )

    for payroll in PayrollRecord.objects.all().iterator():
        history = (
            EmployeeProfileHistory.objects
            .filter(employee_id=payroll.employee_id, effective_month__lte=payroll.month)
            .order_by('-effective_month', '-id')
            .first()
        )
        if history:
            payroll.profile_effective_month = history.effective_month
            payroll.save(update_fields=['profile_effective_month'])


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('workforce', '0004_salary_advance_approval_fields'),
    ]

    operations = [
        migrations.CreateModel(
            name='EmployeeProfileHistory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('search_text', models.TextField(blank=True, default='')),
                ('effective_month', models.CharField(help_text='Định dạng YYYY-MM', max_length=7, verbose_name='Tháng hiệu lực')),
                ('salary_basic', models.DecimalField(decimal_places=2, default=0, max_digits=15, verbose_name='Lương cơ bản')),
                ('department', models.CharField(blank=True, default='', max_length=120, verbose_name='Phòng ban')),
                ('position', models.CharField(blank=True, default='', max_length=120, verbose_name='Chức vụ')),
                ('status', models.CharField(choices=[('ACTIVE', 'Đang làm'), ('ON_LEAVE', 'Tạm nghỉ'), ('RESIGNED', 'Nghỉ việc')], default='ACTIVE', max_length=20, verbose_name='Trạng thái hiệu lực')),
                ('note', models.TextField(blank=True, default='', verbose_name='Ghi chú hiệu lực')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='workforce_employee_profile_history_created', to=settings.AUTH_USER_MODEL)),
                ('employee', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='profile_histories', to='workforce.employee', verbose_name='Nhân viên')),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='workforce_employee_profile_history_updated', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'workforce_employee_profile_histories',
                'ordering': ['employee__code', '-effective_month', '-id'],
                'unique_together': {('employee', 'effective_month')},
            },
        ),
        migrations.AddField(
            model_name='payrollrecord',
            name='profile_effective_month',
            field=models.CharField(blank=True, default='', max_length=7, verbose_name='Tháng hiệu lực hồ sơ'),
        ),
        migrations.AddIndex(
            model_name='employeeprofilehistory',
            index=models.Index(fields=['employee', 'effective_month'], name='workforce_e_employe_14ce3e_idx'),
        ),
        migrations.AddIndex(
            model_name='employeeprofilehistory',
            index=models.Index(fields=['effective_month'], name='workforce_e_effecti_e85e37_idx'),
        ),
        migrations.RunPython(seed_employee_profile_history, migrations.RunPython.noop),
    ]
