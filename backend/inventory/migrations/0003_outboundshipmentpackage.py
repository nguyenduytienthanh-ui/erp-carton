from decimal import Decimal

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('sales', '0004_salesorderline_product_snapshot_and_trace_code'),
        ('inventory', '0002_outboundshipment_and_transaction_batch'),
    ]

    operations = [
        migrations.CreateModel(
            name='OutboundShipmentPackage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('status', models.CharField(choices=[('ACTIVE', 'Đang hiệu lực'), ('CANCELLED', 'Đã hủy')], db_index=True, default='ACTIVE', max_length=20)),
                ('package_no', models.PositiveIntegerField()),
                ('total_packages', models.PositiveIntegerField(default=1)),
                ('quantity', models.DecimalField(decimal_places=4, default=Decimal('0'), max_digits=18)),
                ('package_code', models.CharField(db_index=True, max_length=80, unique=True)),
                ('label_qr_value', models.CharField(db_index=True, max_length=255)),
                ('note', models.TextField(blank=True)),
                ('cancelled_at', models.DateTimeField(blank=True, null=True)),
                ('cancel_reason', models.CharField(blank=True, max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_outbound_shipment_packages', to=settings.AUTH_USER_MODEL)),
                ('inventory_transaction', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='packages', to='inventory.inventorytransaction')),
                ('sales_order_line', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='shipment_packages', to='sales.salesorderline')),
                ('shipment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='packages', to='inventory.outboundshipment')),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='updated_outbound_shipment_packages', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'inventory_outbound_shipment_packages',
                'ordering': ['shipment_id', 'inventory_transaction_id', 'package_no'],
            },
        ),
        migrations.AddIndex(
            model_name='outboundshipmentpackage',
            index=models.Index(fields=['shipment', 'status'], name='inventory_ou_shipment_3ffb2a_idx'),
        ),
        migrations.AddIndex(
            model_name='outboundshipmentpackage',
            index=models.Index(fields=['inventory_transaction', 'status'], name='inventory_ou_invento_9ce2dc_idx'),
        ),
        migrations.AddIndex(
            model_name='outboundshipmentpackage',
            index=models.Index(fields=['sales_order_line', 'status'], name='inventory_ou_sales_o_0d9608_idx'),
        ),
    ]
