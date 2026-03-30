from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('production', '0003_productionoperation_block_reason_code_and_more'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    sql="ALTER TABLE production_operations ADD COLUMN IF NOT EXISTS dispatch_owner varchar(120) NOT NULL DEFAULT '';",
                    reverse_sql='ALTER TABLE production_operations DROP COLUMN IF EXISTS dispatch_owner;',
                ),
                migrations.RunSQL(
                    sql='ALTER TABLE production_operations ADD COLUMN IF NOT EXISTS handover_at timestamp with time zone NULL;',
                    reverse_sql='ALTER TABLE production_operations DROP COLUMN IF EXISTS handover_at;',
                ),
                migrations.RunSQL(
                    sql="ALTER TABLE production_operations ADD COLUMN IF NOT EXISTS handover_note varchar(255) NOT NULL DEFAULT '';",
                    reverse_sql='ALTER TABLE production_operations DROP COLUMN IF EXISTS handover_note;',
                ),
                migrations.RunSQL(
                    sql="ALTER TABLE production_operations ADD COLUMN IF NOT EXISTS handover_receiver varchar(120) NOT NULL DEFAULT '';",
                    reverse_sql='ALTER TABLE production_operations DROP COLUMN IF EXISTS handover_receiver;',
                ),
                migrations.RunSQL(
                    sql="ALTER TABLE production_operations ADD COLUMN IF NOT EXISTS handover_status varchar(20) NOT NULL DEFAULT '';",
                    reverse_sql='ALTER TABLE production_operations DROP COLUMN IF EXISTS handover_status;',
                ),
                migrations.RunSQL(
                    sql='CREATE INDEX IF NOT EXISTS production__handove_43d01d_idx ON production_operations (handover_status);',
                    reverse_sql='DROP INDEX IF EXISTS production__handove_43d01d_idx;',
                ),
            ],
            state_operations=[
                migrations.AddField(
                    model_name='productionoperation',
                    name='dispatch_owner',
                    field=models.CharField(blank=True, default='', max_length=120),
                ),
                migrations.AddField(
                    model_name='productionoperation',
                    name='handover_at',
                    field=models.DateTimeField(blank=True, null=True),
                ),
                migrations.AddField(
                    model_name='productionoperation',
                    name='handover_note',
                    field=models.CharField(blank=True, default='', max_length=255),
                ),
                migrations.AddField(
                    model_name='productionoperation',
                    name='handover_receiver',
                    field=models.CharField(blank=True, default='', max_length=120),
                ),
                migrations.AddField(
                    model_name='productionoperation',
                    name='handover_status',
                    field=models.CharField(
                        blank=True,
                        choices=[
                            ('ACTIVE', 'Đang thao tác'),
                            ('READY', 'Sẵn sàng bàn giao'),
                            ('ACCEPTED', 'Đã tiếp quản'),
                        ],
                        db_index=True,
                        default='',
                        max_length=20,
                    ),
                ),
                migrations.AddIndex(
                    model_name='productionoperation',
                    index=models.Index(fields=['handover_status'], name='production__handove_43d01d_idx'),
                ),
            ],
        ),
    ]
