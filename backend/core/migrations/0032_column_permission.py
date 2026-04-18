# Generated for ColumnPermission model

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0031_user_preferences'),
    ]

    operations = [
        migrations.CreateModel(
            name='ColumnPermission',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('page', models.CharField(help_text='VD: products-list, customers-list', max_length=50, verbose_name='Trang')),
                ('column', models.CharField(help_text='VD: cost_price, sale_price, commission_per_unit', max_length=50, verbose_name='Tên cột (key)')),
                ('column_label', models.CharField(help_text='VD: Giá vốn, Giá bán, HHCĐ', max_length=100, verbose_name='Nhãn hiển thị')),
                ('allowed_roles', models.JSONField(default=list, help_text='VD: ["admin", "manager", "accountant"]', verbose_name='Roles được phép xem')),
                ('is_restricted', models.BooleanField(default=True, help_text='False = Tất cả được xem, True = Chỉ allowed_roles/users', verbose_name='Có giới hạn quyền')),
                ('is_active', models.BooleanField(default=True, verbose_name='Đang áp dụng')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('allowed_users', models.ManyToManyField(blank=True, related_name='column_permissions', to=settings.AUTH_USER_MODEL, verbose_name='Users được phép xem (ngoài roles)')),
            ],
            options={
                'verbose_name': 'Phân quyền cột',
                'verbose_name_plural': 'Phân quyền cột',
                'db_table': 'column_permissions',
            },
        ),
        migrations.AddIndex(
            model_name='columnpermission',
            index=models.Index(fields=['page', 'is_active'], name='column_perm_page_id_8a1b2c_idx'),
        ),
        migrations.AlterUniqueTogether(
            name='columnpermission',
            unique_together={('page', 'column')},
        ),
    ]
