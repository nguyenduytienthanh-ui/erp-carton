from django.db import migrations


def ensure_recovery_tables(apps, schema_editor):
    existing_tables = set(schema_editor.connection.introspection.table_names())
    template_model = apps.get_model('paper_optimizer', 'PaperOptimizerSupplierTemplate')
    run_model = apps.get_model('paper_optimizer', 'PaperOptimizerRun')

    if template_model._meta.db_table not in existing_tables:
        schema_editor.create_model(template_model)
        existing_tables.add(template_model._meta.db_table)

    if run_model._meta.db_table not in existing_tables:
        schema_editor.create_model(run_model)


class Migration(migrations.Migration):

    dependencies = [
        ('paper_optimizer', '0001_initial'),
    ]

    operations = [
        # Tables may already exist in DB from a prior recovery run; this migration is safe to apply --fake.
        migrations.RunPython(ensure_recovery_tables, migrations.RunPython.noop),
    ]
