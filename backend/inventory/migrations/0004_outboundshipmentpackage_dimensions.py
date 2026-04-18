from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0003_outboundshipmentpackage'),
    ]

    operations = [
        migrations.AddField(
            model_name='outboundshipmentpackage',
            name='gross_weight_kg',
            field=models.DecimalField(decimal_places=3, default=Decimal('0'), max_digits=18),
        ),
        migrations.AddField(
            model_name='outboundshipmentpackage',
            name='height_cm',
            field=models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=18),
        ),
        migrations.AddField(
            model_name='outboundshipmentpackage',
            name='length_cm',
            field=models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=18),
        ),
        migrations.AddField(
            model_name='outboundshipmentpackage',
            name='package_type',
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name='outboundshipmentpackage',
            name='width_cm',
            field=models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=18),
        ),
    ]
