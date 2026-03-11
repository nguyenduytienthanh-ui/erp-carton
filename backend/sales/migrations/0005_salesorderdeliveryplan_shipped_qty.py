from decimal import Decimal

from django.db import migrations, models


def seed_shipped_qty_from_delivered(apps, schema_editor):
    SalesOrderDeliveryPlan = apps.get_model('sales', 'SalesOrderDeliveryPlan')
    SalesOrderDeliveryPlan.objects.filter(shipped_qty__lt=models.F('delivered_qty')).update(
        shipped_qty=models.F('delivered_qty')
    )


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0004_salesorderline_product_snapshot_and_trace_code'),
    ]

    operations = [
        migrations.AddField(
            model_name='salesorderdeliveryplan',
            name='shipped_qty',
            field=models.DecimalField(decimal_places=4, default=Decimal('0'), max_digits=18),
        ),
        migrations.RunPython(seed_shipped_qty_from_delivered, migrations.RunPython.noop),
    ]
