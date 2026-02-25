from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0036_sales_order_document'),
    ]

    operations = [
        migrations.AddField(
            model_name='auditlog',
            name='entity_id_str',
            field=models.CharField(default='', help_text='Record ID as string (for UUID entities)', max_length=64),
        ),
    ]

