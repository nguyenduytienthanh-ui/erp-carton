from django.db import migrations, models


def backfill_sales_order_line_snapshot(apps, schema_editor):
    SalesOrderLine = apps.get_model('sales', 'SalesOrderLine')
    for line in SalesOrderLine.objects.select_related(
        'sales_order',
        'product',
        'product__category',
        'product__unit',
        'product__wave',
        'product__box_type',
        'product__parent',
        'product__owner',
        'product__team',
    ).all():
        product = getattr(line, 'product', None)
        order = getattr(line, 'sales_order', None)
        if not product or not order:
            continue
        line.internal_product_code = getattr(product, 'code', '') or ''
        line.trace_code = (
            f"{getattr(product, 'code', '') or ''}|"
            f"{order.order_date.strftime('%Y%m%d') if getattr(order, 'order_date', None) else ''}|"
            f"{getattr(order, 'code', '') or ''}|"
            f"L{str(getattr(line, 'line_number', 0) or 0).zfill(3)}"
        )
        line.product_snapshot = {
            'product_id': product.id,
            'code': product.code,
            'name': product.name,
            'category_id': product.category_id,
            'category_name': getattr(getattr(product, 'category', None), 'name', None),
            'unit_id': product.unit_id,
            'unit_name': getattr(getattr(product, 'unit', None), 'name', None),
            'description': product.description or '',
            'size_order': product.size_order or '',
            'size_production': product.size_production or '',
            'wave_id': product.wave_id,
            'wave_code': getattr(getattr(product, 'wave', None), 'code', None),
            'wave_name': getattr(getattr(product, 'wave', None), 'name', None),
            'box_type_id': product.box_type_id,
            'box_type_code': getattr(getattr(product, 'box_type', None), 'code', None),
            'box_type_name': getattr(getattr(product, 'box_type', None), 'name', None),
            'cost_price': str(product.cost_price or 0),
            'sale_price': str(product.sale_price or 0),
            'min_stock': str(product.min_stock or 0),
            'delivery_tolerance': product.delivery_tolerance or '',
            'commission_per_unit': str(product.commission_per_unit or 0),
            'commission_percent': str(product.commission_percent or 0),
            'process_xa': product.process_xa,
            'process_in': product.process_in,
            'process_boi': product.process_boi,
            'process_can_mang': product.process_can_mang,
            'process_be': product.process_be,
            'process_chap': product.process_chap,
            'process_dong': product.process_dong,
            'process_dan': product.process_dan,
            'process_khac': product.process_khac,
            'film_code': product.film_code or '',
            'film_file_url': product.film_file_url or '',
            'color_count': product.color_count,
            'mold_code': product.mold_code or '',
            'mold_file_url': product.mold_file_url or '',
            'waterproof': product.waterproof or '',
            'note_other': product.note_other or '',
            'note': product.note or '',
            'parent_id': product.parent_id,
            'parent_name': getattr(getattr(product, 'parent', None), 'name', None),
            'component_quantity': product.component_quantity,
            'is_set': product.is_set,
            'status': product.status,
            'owner_id': product.owner_id,
            'owner_name': getattr(getattr(product, 'owner', None), 'username', None),
            'team_id': product.team_id,
            'team_name': getattr(getattr(product, 'team', None), 'name', None),
            'is_active': product.is_active,
        }
        if not line.uom:
            line.uom = getattr(getattr(product, 'unit', None), 'code', None) or ''
        line.save(update_fields=['internal_product_code', 'trace_code', 'product_snapshot', 'uom'])


class Migration(migrations.Migration):
    dependencies = [
        ('sales', '0003_salesorder_delivery_date_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='salesorderline',
            name='internal_product_code',
            field=models.CharField(blank=True, db_index=True, max_length=50),
        ),
        migrations.AddField(
            model_name='salesorderline',
            name='product_snapshot',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='salesorderline',
            name='trace_code',
            field=models.CharField(blank=True, db_index=True, max_length=150),
        ),
        migrations.RunPython(backfill_sales_order_line_snapshot, migrations.RunPython.noop),
    ]
