from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('production', '0002_production_receipt_line_packaging'),
    ]

    operations = [
        migrations.AddField(
            model_name='productionoperation',
            name='block_reason_code',
            field=models.CharField(
                blank=True,
                choices=[
                    ('WAIT_MATERIAL', 'Chờ vật tư/giấy/mực'),
                    ('WAIT_PREVIOUS_STEP', 'Chờ công đoạn trước'),
                    ('WAIT_APPROVAL', 'Chờ duyệt'),
                    ('MACHINE_DOWN', 'Máy dừng/sự cố máy'),
                    ('OTHER', 'Khác'),
                ],
                db_index=True,
                default='',
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name='productionoperation',
            name='block_reason_note',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='productionoperation',
            name='planned_date',
            field=models.DateField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='productionoperation',
            name='planned_shift',
            field=models.CharField(
                blank=True,
                choices=[
                    ('MORNING', 'Sáng'),
                    ('AFTERNOON', 'Chiều'),
                    ('EVENING', 'Tối'),
                    ('NIGHT', 'Đêm'),
                    ('FULLDAY', 'Cả ngày'),
                ],
                db_index=True,
                default='',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='productionoperation',
            name='priority_rank',
            field=models.PositiveIntegerField(default=100),
        ),
        migrations.AddIndex(
            model_name='productionoperation',
            index=models.Index(fields=['planned_date'], name='production__planned_591922_idx'),
        ),
        migrations.AddIndex(
            model_name='productionoperation',
            index=models.Index(fields=['planned_shift'], name='production__planned_a8704e_idx'),
        ),
        migrations.AddIndex(
            model_name='productionoperation',
            index=models.Index(fields=['block_reason_code'], name='production__block_r_c2e379_idx'),
        ),
    ]
