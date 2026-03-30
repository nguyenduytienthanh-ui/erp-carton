from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('production', '0004_productionoperation_dispatch_owner_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='productionoperation',
            name='dispatch_sequence',
            field=models.PositiveIntegerField(default=100),
        ),
        migrations.AddField(
            model_name='productionoperation',
            name='estimated_runtime_hours',
            field=models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=10),
        ),
        migrations.AddField(
            model_name='productionoperation',
            name='machine_code',
            field=models.CharField(blank=True, db_index=True, default='', max_length=40),
        ),
        migrations.AddField(
            model_name='productionoperation',
            name='machine_name',
            field=models.CharField(blank=True, default='', max_length=120),
        ),
        migrations.AddField(
            model_name='productionoperation',
            name='setup_minutes',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='productionoperation',
            name='work_center_code',
            field=models.CharField(blank=True, db_index=True, default='', max_length=40),
        ),
        migrations.AddField(
            model_name='productionoperation',
            name='work_center_name',
            field=models.CharField(blank=True, default='', max_length=120),
        ),
        migrations.AddIndex(
            model_name='productionoperation',
            index=models.Index(fields=['work_center_code'], name='production__work_ce_0914cf_idx'),
        ),
        migrations.AddIndex(
            model_name='productionoperation',
            index=models.Index(fields=['machine_code'], name='production__machine_77fb69_idx'),
        ),
    ]
