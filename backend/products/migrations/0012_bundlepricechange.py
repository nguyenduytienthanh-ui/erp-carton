from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('products', '0011_alter_pricechange_options_pricechange_applied_at_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='BundlePriceChange',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('old_fixed_cost_price', models.DecimalField(blank=True, decimal_places=2, max_digits=15, null=True)),
                ('new_fixed_cost_price', models.DecimalField(blank=True, decimal_places=2, max_digits=15, null=True)),
                ('old_fixed_sale_price', models.DecimalField(blank=True, decimal_places=2, max_digits=15, null=True)),
                ('new_fixed_sale_price', models.DecimalField(blank=True, decimal_places=2, max_digits=15, null=True)),
                ('old_fixed_commission_per_unit', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ('new_fixed_commission_per_unit', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ('old_fixed_commission_percent', models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True)),
                ('new_fixed_commission_percent', models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True)),
                ('delta_cost', models.DecimalField(blank=True, decimal_places=2, max_digits=15, null=True)),
                ('delta_sale', models.DecimalField(blank=True, decimal_places=2, max_digits=15, null=True)),
                ('delta_cost_percent', models.DecimalField(blank=True, decimal_places=2, max_digits=9, null=True)),
                ('delta_sale_percent', models.DecimalField(blank=True, decimal_places=2, max_digits=9, null=True)),
                ('reason', models.TextField(blank=True, default='')),
                ('source', models.CharField(choices=[('SYSTEM', 'Hệ thống'), ('MANUAL', 'Thủ công'), ('IMPORT', 'Nhập dữ liệu'), ('API', 'API')], default='MANUAL', max_length=20)),
                ('effective_at', models.DateTimeField(blank=True, null=True)),
                ('applied_at', models.DateTimeField(blank=True, null=True)),
                ('batch_code', models.CharField(blank=True, default='', max_length=64)),
                ('status', models.CharField(choices=[('PENDING_APPROVAL', 'Chờ duyệt'), ('APPROVED_SCHEDULED', 'Đã duyệt, chờ hiệu lực'), ('ACTIVE_APPLIED', 'Đang hiệu lực'), ('REJECTED', 'Từ chối'), ('SUPERSEDED', 'Đã bị thay thế')], default='ACTIVE_APPLIED', max_length=30)),
                ('approved_at', models.DateTimeField(blank=True, null=True)),
                ('reject_reason', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('approved_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='approved_bundle_price_changes', to=settings.AUTH_USER_MODEL)),
                ('bundle', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='price_changes', to='products.productbundle', verbose_name='Bộ sản phẩm')),
                ('submitted_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='submitted_bundle_price_changes', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'product_bundle_price_changes',
                'ordering': ['-effective_at', '-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='bundlepricechange',
            index=models.Index(fields=['bundle', 'created_at'], name='product_bun_bundle__367adb_idx'),
        ),
        migrations.AddIndex(
            model_name='bundlepricechange',
            index=models.Index(fields=['status', 'created_at'], name='product_bun_status_feffeb_idx'),
        ),
        migrations.AddIndex(
            model_name='bundlepricechange',
            index=models.Index(fields=['bundle', 'effective_at'], name='product_bun_bundle__90b8dc_idx'),
        ),
        migrations.AddIndex(
            model_name='bundlepricechange',
            index=models.Index(fields=['batch_code'], name='product_bun_batch_c_92b3ea_idx'),
        ),
    ]
