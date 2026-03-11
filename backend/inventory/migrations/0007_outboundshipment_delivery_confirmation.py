from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0006_outboundshipment_loading_confirmation'),
    ]

    operations = [
        migrations.AddField(
            model_name='outboundshipment',
            name='customer_receiver_name',
            field=models.CharField(blank=True, max_length=150),
        ),
        migrations.AddField(
            model_name='outboundshipment',
            name='customer_receiver_phone',
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name='outboundshipment',
            name='delivery_confirmation_note',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='outboundshipment',
            name='delivery_confirmed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='outboundshipment',
            name='delivery_confirmed_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=models.SET_NULL, related_name='delivery_confirmed_outbound_shipments', to='core.user'),
        ),
        migrations.AddField(
            model_name='outboundshipment',
            name='delivery_proof_url',
            field=models.URLField(blank=True),
        ),
        migrations.AddField(
            model_name='outboundshipment',
            name='delivery_reference',
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name='outboundshipment',
            name='delivered_at_actual',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
