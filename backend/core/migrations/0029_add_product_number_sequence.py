from django.db import migrations


def create_product_sequence(apps, schema_editor):
    NumberSequence = apps.get_model('core', 'NumberSequence')

    # Tạo sequence cho Product
    NumberSequence.objects.get_or_create(
        entity_type='Product',
        defaults={
            'prefix': 'PROD',
            'current_number': 0,
            'padding': 4,
            'format_template': '{prefix}-{number}'
        }
    )


def reverse_product_sequence(apps, schema_editor):
    NumberSequence = apps.get_model('core', 'NumberSequence')
    NumberSequence.objects.filter(entity_type='Product').delete()


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0028_emailtemplate'),
    ]

    operations = [
        migrations.RunPython(create_product_sequence, reverse_product_sequence),
    ]

