from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('workforce', '0002_attendance_bonus_penalty'),
    ]

    operations = [
        migrations.CreateModel(
            name='PayrollRecord',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('search_text', models.TextField(blank=True, default='')),
                ('month', models.CharField(help_text='Định dạng YYYY-MM', max_length=7, verbose_name='Tháng')),
                ('standard_days', models.DecimalField(decimal_places=2, default=0, max_digits=5)),
                ('actual_days', models.DecimalField(decimal_places=2, default=0, max_digits=5)),
                ('basic_salary', models.DecimalField(decimal_places=2, default=0, max_digits=15)),
                ('salary_by_attendance', models.DecimalField(decimal_places=2, default=0, max_digits=15)),
                ('overtime_pay', models.DecimalField(decimal_places=2, default=0, max_digits=15)),
                ('total_bonus', models.DecimalField(decimal_places=2, default=0, max_digits=15)),
                ('total_penalty', models.DecimalField(decimal_places=2, default=0, max_digits=15)),
                ('advance_deduction', models.DecimalField(decimal_places=2, default=0, max_digits=15)),
                ('total_income', models.DecimalField(decimal_places=2, default=0, max_digits=15)),
                ('total_deductions', models.DecimalField(decimal_places=2, default=0, max_digits=15)),
                ('net_pay', models.DecimalField(decimal_places=2, default=0, max_digits=15)),
                ('status', models.CharField(choices=[('UNLOCKED', 'Chưa khóa'), ('LOCKED', 'Đã khóa')], default='UNLOCKED', max_length=20)),
                ('note', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='workforce_payroll_created', to=settings.AUTH_USER_MODEL)),
                ('employee', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='payroll_records', to='workforce.employee', verbose_name='Nhân viên')),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='workforce_payroll_updated', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'workforce_payroll_records',
                'ordering': ['-month', 'employee__code'],
                'unique_together': {('employee', 'month')},
                'indexes': [
                    models.Index(fields=['month'], name='workforce_p_month_638eac_idx'),
                    models.Index(fields=['employee', 'month'], name='workforce_p_employe_eb7229_idx'),
                    models.Index(fields=['status'], name='workforce_p_status_91f4e5_idx'),
                ],
            },
        ),
        migrations.CreateModel(
            name='SalaryAdvanceRecord',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('search_text', models.TextField(blank=True, default='')),
                ('advance_date', models.DateField(verbose_name='Ngày ứng')),
                ('month', models.CharField(help_text='Định dạng YYYY-MM', max_length=7, verbose_name='Tháng trừ lương')),
                ('amount', models.DecimalField(decimal_places=2, max_digits=15, verbose_name='Số tiền ứng')),
                ('reason', models.CharField(blank=True, default='Ứng lương', max_length=255, verbose_name='Lý do')),
                ('approved_by_name', models.CharField(blank=True, default='', max_length=120, verbose_name='Người duyệt')),
                ('note', models.TextField(blank=True, default='', verbose_name='Ghi chú')),
                ('status', models.CharField(choices=[('UNDEDUCTED', 'Chưa trừ'), ('DEDUCTED', 'Đã trừ')], default='UNDEDUCTED', max_length=20, verbose_name='Trạng thái')),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='workforce_salary_advance_created', to=settings.AUTH_USER_MODEL)),
                ('employee', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='salary_advances', to='workforce.employee', verbose_name='Nhân viên')),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='workforce_salary_advance_updated', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'workforce_salary_advance_records',
                'ordering': ['-advance_date', '-id'],
                'indexes': [
                    models.Index(fields=['month'], name='workforce_s_month_486fa1_idx'),
                    models.Index(fields=['employee', 'month'], name='workforce_s_employe_349138_idx'),
                    models.Index(fields=['status'], name='workforce_s_status_6bdfc4_idx'),
                    models.Index(fields=['is_active'], name='workforce_s_is_acti_e1ea2e_idx'),
                ],
            },
        ),
    ]

