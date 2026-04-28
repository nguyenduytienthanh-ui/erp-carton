# Seed operation master rows and backfill ProductOperation from legacy process_* fields.

from django.db import migrations


OPERATION_SEEDS = [
    ('XA', 'Xả', 10, 'process_xa'),
    ('IN', 'In', 20, 'process_in'),
    ('CAN_MANG', 'Cán màng', 30, 'process_can_mang'),
    ('BOI', 'Bồi', 40, 'process_boi'),
    ('BE', 'Bế', 50, 'process_be'),
    ('CHAP', 'Chạp', 60, 'process_chap'),
    ('DONG', 'Đóng', 70, 'process_dong'),
    ('DAN', 'Dán', 80, 'process_dan'),
    ('KHAC', 'Khác', 90, 'process_khac'),
]


def seed_operations_and_backfill_product_operations(apps, schema_editor):
    Operation = apps.get_model('products', 'Operation')
    Product = apps.get_model('products', 'Product')
    ProductOperation = apps.get_model('products', 'ProductOperation')

    operations_by_code = {}
    for code, name, sequence, _field_name in OPERATION_SEEDS:
        operation, _created = Operation.objects.update_or_create(
            code=code,
            defaults={
                'name': name,
                'sequence': sequence,
                'default_unit': 'pcs/hour',
                'is_active': True,
            },
        )
        operations_by_code[code] = operation

    product_fields = ['id', *(field_name for _code, _name, _sequence, field_name in OPERATION_SEEDS)]
    for product in Product.objects.only(*product_fields).iterator():
        for code, _name, _sequence, field_name in OPERATION_SEEDS:
            raw_rate = getattr(product, field_name, None)
            try:
                rate = int(raw_rate or 0)
            except (TypeError, ValueError):
                rate = 0
            if rate <= 0:
                continue

            operation = operations_by_code[code]
            ProductOperation.objects.get_or_create(
                product_id=product.id,
                operation_id=operation.id,
                defaults={
                    'operation_code': operation.code,
                    'operation_name': operation.name,
                    'sequence': operation.sequence,
                    'standard_rate_per_hour': rate,
                    'is_active': True,
                },
            )


def noop_reverse(apps, schema_editor):
    # Do not delete ProductOperation rows or Operation master data automatically.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('products', '0014_operation_productoperation'),
    ]

    operations = [
        migrations.RunPython(seed_operations_and_backfill_product_operations, noop_reverse),
    ]
