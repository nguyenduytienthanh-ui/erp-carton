from django.db import migrations


def _has_column(schema_editor, table_name, column_name):
    with schema_editor.connection.cursor() as cursor:
        column_names = {
            column.name
            for column in schema_editor.connection.introspection.get_table_description(
                cursor,
                table_name,
            )
        }
    return column_name in column_names


def _has_table(schema_editor, table_name):
    return table_name in schema_editor.connection.introspection.table_names()


def _add_field_if_missing(schema_editor, model, field_name, column_name):
    if not _has_column(schema_editor, model._meta.db_table, column_name):
        schema_editor.add_field(model, model._meta.get_field(field_name))


def add_missing_0005_database_columns(apps, schema_editor):
    PurchaseOrderLine = apps.get_model('purchasing', 'PurchaseOrderLine')
    PurchaseOrderLineMaterialAllocation = apps.get_model(
        'purchasing',
        'PurchaseOrderLineMaterialAllocation',
    )
    PurchaseReceiptLine = apps.get_model('purchasing', 'PurchaseReceiptLine')
    PurchaseReceiptLineMaterialAllocation = apps.get_model(
        'purchasing',
        'PurchaseReceiptLineMaterialAllocation',
    )
    PurchaseRequest = apps.get_model('purchasing', 'PurchaseRequest')
    PurchaseRequestLine = apps.get_model('purchasing', 'PurchaseRequestLine')

    # Migration 0005 used SeparateDatabaseAndState with no database operations.
    # Reapply the missing DB pieces only when absent, so existing DBs that
    # already received them manually do not fail with duplicate objects.
    if not _has_table(schema_editor, PurchaseOrderLineMaterialAllocation._meta.db_table):
        schema_editor.create_model(PurchaseOrderLineMaterialAllocation)

    if not _has_table(schema_editor, PurchaseReceiptLineMaterialAllocation._meta.db_table):
        schema_editor.create_model(PurchaseReceiptLineMaterialAllocation)

    _add_field_if_missing(
        schema_editor,
        PurchaseOrderLine,
        'purchase_request_line',
        'purchase_request_line_id',
    )

    for field_name in (
        'bundle_count',
        'bundles_per_pallet',
        'pallet_count',
        'units_per_bundle',
    ):
        _add_field_if_missing(
            schema_editor,
            PurchaseReceiptLine,
            field_name,
            field_name,
        )

    for field_name in ('cancel_reason', 'cancelled_at'):
        _add_field_if_missing(schema_editor, PurchaseRequest, field_name, field_name)
    _add_field_if_missing(schema_editor, PurchaseRequest, 'cancelled_by', 'cancelled_by_id')

    for field_name in ('sales_material_plan_item_id', 'source_snapshot'):
        _add_field_if_missing(schema_editor, PurchaseRequestLine, field_name, field_name)


class Migration(migrations.Migration):

    dependencies = [
        ('purchasing', '0005_purchaseorderlinematerialallocation_and_more'),
    ]

    operations = [
        migrations.RunPython(
            add_missing_0005_database_columns,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
