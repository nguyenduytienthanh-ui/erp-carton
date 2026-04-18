from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('sales', '0004_salesorderline_product_snapshot_and_trace_code'),
        ('inventory', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='OutboundShipment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(db_index=True, max_length=50, unique=True)),
                ('shipment_date', models.DateField(db_index=True)),
                ('status', models.CharField(choices=[('POSTED', 'Đã ghi sổ'), ('CANCELLED', 'Đã hủy')], db_index=True, default='POSTED', max_length=20)),
                ('reference', models.CharField(blank=True, max_length=200)),
                ('carrier_name', models.CharField(blank=True, max_length=200)),
                ('tracking_number', models.CharField(blank=True, db_index=True, max_length=100)),
                ('vehicle_no', models.CharField(blank=True, max_length=100)),
                ('driver_name', models.CharField(blank=True, max_length=150)),
                ('driver_phone', models.CharField(blank=True, max_length=50)),
                ('note', models.TextField(blank=True)),
                ('posted_at', models.DateTimeField(auto_now_add=True)),
                ('cancelled_at', models.DateTimeField(blank=True, null=True)),
                ('cancel_reason', models.CharField(blank=True, max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('cancelled_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='cancelled_outbound_shipments', to=settings.AUTH_USER_MODEL)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_outbound_shipments', to=settings.AUTH_USER_MODEL)),
                ('posted_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='posted_outbound_shipments', to=settings.AUTH_USER_MODEL)),
                ('sales_order', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='outbound_shipments', to='sales.salesorder')),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='updated_outbound_shipments', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'inventory_outbound_shipments',
                'ordering': ['-shipment_date', '-id'],
            },
        ),
        migrations.AddField(
            model_name='inventorytransaction',
            name='shipment_batch',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='transactions', to='inventory.outboundshipment'),
        ),
        migrations.AddIndex(
            model_name='outboundshipment',
            index=models.Index(fields=['shipment_date'], name='inventory_ou_shipment_7a3387_idx'),
        ),
        migrations.AddIndex(
            model_name='outboundshipment',
            index=models.Index(fields=['status'], name='inventory_ou_status_9234e5_idx'),
        ),
        migrations.AddIndex(
            model_name='outboundshipment',
            index=models.Index(fields=['sales_order'], name='inventory_ou_sales_o_a21769_idx'),
        ),
        migrations.AddIndex(
            model_name='outboundshipment',
            index=models.Index(fields=['tracking_number'], name='inventory_ou_trackin_6f8e98_idx'),
        ),
    ]
