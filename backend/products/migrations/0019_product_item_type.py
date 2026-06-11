# Generated for Product / Material item type classification.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('products', '0018_product_routing_step'),
    ]

    operations = [
        migrations.AddField(
            model_name='product',
            name='item_type',
            field=models.CharField(
                choices=[
                    ('general', 'Chưa phân loại'),
                    ('finished_good', 'Thành phẩm carton'),
                    ('semi_finished', 'Bán thành phẩm'),
                    ('raw_material', 'Nguyên vật liệu'),
                    ('accessory', 'Phụ liệu'),
                    ('service', 'Dịch vụ'),
                ],
                db_index=True,
                default='general',
                max_length=32,
                verbose_name='Loại item',
            ),
        ),
    ]
