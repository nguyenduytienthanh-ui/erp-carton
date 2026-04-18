from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0029_add_product_number_sequence'),
    ]

    operations = [
        migrations.RunSQL(
            sql="CREATE EXTENSION IF NOT EXISTS pg_trgm;",
            reverse_sql="DROP EXTENSION IF EXISTS pg_trgm;",
        ),
    ]
