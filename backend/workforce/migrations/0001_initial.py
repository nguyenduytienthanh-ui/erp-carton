from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Employee',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(max_length=30, unique=True, verbose_name='Mã nhân viên')),
                ('name', models.CharField(max_length=150, verbose_name='Họ tên')),
                ('cccd', models.CharField(blank=True, default='', max_length=20, verbose_name='CCCD')),
                ('birth_date', models.DateField(blank=True, null=True, verbose_name='Ngày sinh')),
                ('gender', models.CharField(blank=True, default='', max_length=10, verbose_name='Giới tính')),
                ('address', models.CharField(blank=True, default='', max_length=255, verbose_name='Địa chỉ')),
                ('phone', models.CharField(blank=True, default='', max_length=20, verbose_name='Điện thoại')),
                ('email', models.EmailField(blank=True, default='', max_length=254, verbose_name='Email')),
                ('department', models.CharField(blank=True, default='', max_length=120, verbose_name='Phòng ban')),
                ('position', models.CharField(blank=True, default='', max_length=120, verbose_name='Chức vụ')),
                ('start_date', models.DateField(blank=True, null=True, verbose_name='Ngày vào làm')),
                ('status', models.CharField(choices=[('ACTIVE', 'Đang làm'), ('ON_LEAVE', 'Tạm nghỉ'), ('RESIGNED', 'Nghỉ việc')], default='ACTIVE', max_length=20, verbose_name='Trạng thái')),
                ('salary_basic', models.DecimalField(decimal_places=2, default=0, max_digits=15, verbose_name='Lương cơ bản')),
                ('bank_account_number', models.CharField(blank=True, default='', max_length=50, verbose_name='Số tài khoản')),
                ('bank_name', models.CharField(blank=True, default='', max_length=120, verbose_name='Ngân hàng')),
                ('bank_branch', models.CharField(blank=True, default='', max_length=120, verbose_name='Chi nhánh')),
                ('note', models.TextField(blank=True, default='', verbose_name='Ghi chú')),
                ('search_text', models.TextField(blank=True, default='')),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='workforce_employees_created', to=settings.AUTH_USER_MODEL)),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='workforce_employees_updated', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'workforce_employees',
                'ordering': ['code'],
                'indexes': [
                    models.Index(fields=['code'], name='workforce_e_code_ca40fd_idx'),
                    models.Index(fields=['name'], name='workforce_e_name_8c9628_idx'),
                    models.Index(fields=['status'], name='workforce_e_status_bf5521_idx'),
                    models.Index(fields=['is_active'], name='workforce_e_is_acti_68fd95_idx'),
                ],
            },
        ),
    ]

