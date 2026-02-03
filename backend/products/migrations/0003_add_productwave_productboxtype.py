# Generated manually for ProductWave, ProductBoxType and Product field migration

from django.db import migrations, models
import django.db.models.deletion


def create_waves_and_boxtypes(apps, schema_editor):
    """Seed ProductWave and ProductBoxType, migrate existing Product data"""
    ProductWave = apps.get_model('products', 'ProductWave')
    ProductBoxType = apps.get_model('products', 'ProductBoxType')
    Product = apps.get_model('products', 'Product')

    # Seed waves
    waves_data = [
        {'code': 'A', 'name': 'Sóng A', 'description': 'Sóng A - 1 lớp'},
        {'code': 'B', 'name': 'Sóng B', 'description': 'Sóng B - 1 lớp'},
        {'code': 'C', 'name': 'Sóng C', 'description': 'Sóng C - 1 lớp'},
        {'code': 'E', 'name': 'Sóng E', 'description': 'Sóng E - 1 lớp mỏng'},
        {'code': 'BC', 'name': 'Sóng BC', 'description': 'Sóng BC - 3 lớp (B+C)'},
        {'code': 'BE', 'name': 'Sóng BE', 'description': 'Sóng BE - 3 lớp (B+E)'},
        {'code': 'EB', 'name': 'Sóng EB', 'description': 'Sóng EB - 3 lớp (E+B)'},
        {'code': 'AA', 'name': 'Sóng AA', 'description': 'Sóng AA - 3 lớp (A+A)'},
    ]
    wave_by_code = {}
    for w in waves_data:
        obj, _ = ProductWave.objects.get_or_create(code=w['code'], defaults=w)
        wave_by_code[w['code']] = obj

    # Seed box types
    box_types_data = [
        {'code': 'A1', 'name': 'Kiểu A1', 'description': 'Thùng 1 chi tiết - nắp liền'},
        {'code': 'A2', 'name': 'Kiểu A2', 'description': 'Thùng 1 chi tiết - nắp rời'},
        {'code': 'A3', 'name': 'Kiểu A3', 'description': 'Thùng 1 chi tiết - nắp kéo'},
        {'code': 'A5', 'name': 'Kiểu A5', 'description': 'Thùng 1 chi tiết - dán 4 góc'},
        {'code': 'B1', 'name': 'Kiểu B1', 'description': 'Thùng 2 chi tiết - nắp + thân'},
        {'code': 'B2', 'name': 'Kiểu B2', 'description': 'Thùng 2 chi tiết - nắp chụp'},
        {'code': 'C1', 'name': 'Kiểu C1', 'description': 'Thùng 3 chi tiết - nắp + thân + đáy'},
        {'code': 'D1', 'name': 'Kiểu D1', 'description': 'Hộp giấy - 1 chi tiết'},
    ]
    boxtype_by_code = {}
    for bt in box_types_data:
        obj, _ = ProductBoxType.objects.get_or_create(code=bt['code'], defaults=bt)
        boxtype_by_code[bt['code']] = obj

    # Migrate existing Products - wave_type (char) -> wave (FK)
    for p in Product.objects.all():
        updated = False
        if hasattr(p, 'wave_type') and p.wave_type and p.wave_type.strip():
            code = p.wave_type.strip()
            if code in wave_by_code:
                p.wave = wave_by_code[code]
                updated = True
        if hasattr(p, 'box_type_old') and p.box_type_old and p.box_type_old.strip():
            code = p.box_type_old.strip()
            if code in boxtype_by_code:
                p.box_type = boxtype_by_code[code]
                updated = True
        if updated:
            p.save()


def reverse_migration(apps, schema_editor):
    """Reverse: cannot fully restore CharField data from FK"""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('products', '0002_alter_productpricing_unique_together_and_more'),
    ]

    operations = [
        # 1. Create ProductWave and ProductBoxType
        migrations.CreateModel(
            name='ProductWave',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(max_length=10, unique=True, verbose_name='Mã sóng')),
                ('name', models.CharField(max_length=50, verbose_name='Tên sóng')),
                ('description', models.TextField(blank=True, verbose_name='Mô tả')),
                ('is_active', models.BooleanField(default=True, verbose_name='Đang sử dụng')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Loại sóng',
                'verbose_name_plural': 'Loại sóng',
                'db_table': 'product_waves',
                'ordering': ['code'],
            },
        ),
        migrations.CreateModel(
            name='ProductBoxType',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(max_length=10, unique=True, verbose_name='Mã kiểu')),
                ('name', models.CharField(max_length=50, verbose_name='Tên kiểu')),
                ('description', models.TextField(blank=True, verbose_name='Mô tả')),
                ('is_active', models.BooleanField(default=True, verbose_name='Đang sử dụng')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Kiểu thùng',
                'verbose_name_plural': 'Kiểu thùng',
                'db_table': 'product_box_types',
                'ordering': ['code'],
            },
        ),
        # 2. Add Product.wave (FK)
        migrations.AddField(
            model_name='product',
            name='wave',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='products',
                to='products.productwave',
                verbose_name='Sóng',
            ),
        ),
        # 3. Rename box_type (CharField) -> box_type_old
        migrations.RenameField(
            model_name='product',
            old_name='box_type',
            new_name='box_type_old',
        ),
        # 4. Add new box_type (FK)
        migrations.AddField(
            model_name='product',
            name='box_type',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='products',
                to='products.productboxtype',
                verbose_name='Kiểu',
            ),
        ),
        # 5. Run data migration (while wave_type and box_type_old still exist)
        migrations.RunPython(create_waves_and_boxtypes, reverse_migration),
        # 6. Remove old fields
        migrations.RemoveField(
            model_name='product',
            name='wave_type',
        ),
        migrations.RemoveField(
            model_name='product',
            name='box_type_old',
        ),
    ]
