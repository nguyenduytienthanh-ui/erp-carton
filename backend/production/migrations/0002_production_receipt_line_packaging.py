from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('production', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='productionreceiptline',
            name='bundle_count',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='productionreceiptline',
            name='bundles_per_pallet',
            field=models.DecimalField(blank=True, decimal_places=4, max_digits=18, null=True),
        ),
        migrations.AddField(
            model_name='productionreceiptline',
            name='pallet_count',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='productionreceiptline',
            name='units_per_bundle',
            field=models.DecimalField(blank=True, decimal_places=4, max_digits=18, null=True),
        ),
    ]
