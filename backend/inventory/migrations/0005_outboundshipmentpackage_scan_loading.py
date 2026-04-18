from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0004_outboundshipmentpackage_dimensions'),
    ]

    operations = [
        migrations.AddField(
            model_name='outboundshipmentpackage',
            name='loaded_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='outboundshipmentpackage',
            name='loaded_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=models.SET_NULL, related_name='loaded_outbound_shipment_packages', to='core.user'),
        ),
        migrations.AddField(
            model_name='outboundshipmentpackage',
            name='verified_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='outboundshipmentpackage',
            name='verified_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=models.SET_NULL, related_name='verified_outbound_shipment_packages', to='core.user'),
        ),
    ]
