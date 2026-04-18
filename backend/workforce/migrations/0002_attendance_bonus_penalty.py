from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('workforce', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='AttendanceRecord',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('search_text', models.TextField(blank=True, default='')),
                ('month', models.CharField(help_text='Định dạng YYYY-MM', max_length=7, verbose_name='Tháng')),
                ('standard_days', models.DecimalField(decimal_places=2, default=26, max_digits=5, verbose_name='Ngày công chuẩn')),
                ('actual_days', models.DecimalField(decimal_places=2, default=0, max_digits=5, verbose_name='Ngày công thực tế')),
                ('paid_leave', models.DecimalField(decimal_places=2, default=0, max_digits=5, verbose_name='Nghỉ phép')),
                ('unpaid_leave', models.DecimalField(decimal_places=2, default=0, max_digits=5, verbose_name='Nghỉ không phép')),
                ('note', models.TextField(blank=True, default='', verbose_name='Ghi chú')),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='workforce_attendance_created', to=settings.AUTH_USER_MODEL)),
                ('employee', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='attendance_records', to='workforce.employee', verbose_name='Nhân viên')),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='workforce_attendance_updated', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'workforce_attendance_records',
                'ordering': ['-month', 'employee__code'],
                'unique_together': {('employee', 'month')},
                'indexes': [
                    models.Index(fields=['month'], name='workforce_a_month_49cd76_idx'),
                    models.Index(fields=['employee', 'month'], name='workforce_a_employe_1b08ac_idx'),
                    models.Index(fields=['is_active'], name='workforce_a_is_acti_c0f638_idx'),
                ],
            },
        ),
        migrations.CreateModel(
            name='BonusPenaltyRecord',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('search_text', models.TextField(blank=True, default='')),
                ('month', models.CharField(help_text='Định dạng YYYY-MM', max_length=7, verbose_name='Tháng')),
                ('record_type', models.CharField(choices=[('BONUS', 'Thưởng'), ('PENALTY', 'Phạt')], default='BONUS', max_length=20, verbose_name='Loại')),
                ('reason', models.CharField(max_length=255, verbose_name='Lý do')),
                ('amount', models.DecimalField(decimal_places=2, max_digits=15, verbose_name='Số tiền')),
                ('calculation_type', models.CharField(choices=[('FIXED', 'Cố định'), ('DAILY_RATIO', 'Theo ngày công')], default='FIXED', max_length=20, verbose_name='Cách tính')),
                ('record_date', models.DateField(verbose_name='Ngày ghi nhận')),
                ('approved_by_name', models.CharField(blank=True, default='', max_length=120, verbose_name='Người duyệt')),
                ('note', models.TextField(blank=True, default='', verbose_name='Ghi chú')),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='workforce_bonus_penalty_created', to=settings.AUTH_USER_MODEL)),
                ('employee', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='bonus_penalty_records', to='workforce.employee', verbose_name='Nhân viên')),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='workforce_bonus_penalty_updated', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'workforce_bonus_penalty_records',
                'ordering': ['-record_date', '-id'],
                'indexes': [
                    models.Index(fields=['month'], name='workforce_b_month_a3f16d_idx'),
                    models.Index(fields=['record_type'], name='workforce_b_record__2bf14b_idx'),
                    models.Index(fields=['employee', 'month'], name='workforce_b_employe_a9f101_idx'),
                    models.Index(fields=['is_active'], name='workforce_b_is_acti_5d98c0_idx'),
                ],
            },
        ),
        migrations.CreateModel(
            name='AttendanceOvertimeItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('search_text', models.TextField(blank=True, default='')),
                ('overtime_date', models.DateField(verbose_name='Ngày tăng ca')),
                ('day_type', models.CharField(choices=[('WEEKDAY', 'Ngày thường'), ('SUNDAY', 'Chủ nhật'), ('HOLIDAY', 'Ngày lễ')], default='WEEKDAY', max_length=20, verbose_name='Loại ngày')),
                ('shift', models.CharField(choices=[('MORNING', 'Sáng'), ('AFTERNOON', 'Chiều'), ('EVENING', 'Tối'), ('NIGHT', 'Đêm'), ('FULLDAY', 'Cả ngày')], default='EVENING', max_length=20, verbose_name='Buổi')),
                ('hours', models.DecimalField(decimal_places=2, default=0, max_digits=5, verbose_name='Số giờ')),
                ('rate', models.DecimalField(decimal_places=2, default=1.5, max_digits=4, verbose_name='Hệ số')),
                ('note', models.TextField(blank=True, default='', verbose_name='Ghi chú')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('attendance', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='overtime_items', to='workforce.attendancerecord', verbose_name='Bảng chấm công')),
            ],
            options={
                'db_table': 'workforce_attendance_overtime_items',
                'ordering': ['overtime_date', 'id'],
                'indexes': [
                    models.Index(fields=['overtime_date'], name='workforce_a_overtim_6a6f44_idx'),
                    models.Index(fields=['day_type'], name='workforce_a_day_typ_0385fe_idx'),
                    models.Index(fields=['shift'], name='workforce_a_shift_384422_idx'),
                ],
            },
        ),
    ]

