# Generated for search_text (token AND, prefix, unidecode, lowercase, index)

import re
from django.db import migrations, models
from unidecode import unidecode

_DIMENSION_SEP = re.compile(r'[xX*×·\s]+', re.UNICODE)


def _dimension_compact(s):
    if not s or not str(s).strip():
        return ''
    return _DIMENSION_SEP.sub('', str(s).strip()) or ''


def fill_search_text(apps, schema_editor):
    """Điền search_text cho sản phẩm hiện có (unidecode + lowercase)."""
    Product = apps.get_model('products', 'Product')
    for p in Product.objects.iterator(chunk_size=500):
        parts = []
        for name in ('code', 'name', 'description', 'size_order', 'size_production',
                     'wave_type', 'box_type', 'film_code', 'mold_code', 'note', 'note_other'):
            val = getattr(p, name, None)
            if val and str(val).strip():
                parts.append(str(val).strip())
        for f in ('size_order', 'size_production'):
            val = getattr(p, f, None)
            if val and str(val).strip():
                compact = _dimension_compact(val)
                if compact and compact != str(val).strip():
                    parts.append(compact)
        if getattr(p, 'category_id', None) and p.category_id:
            try:
                cat = p.category
                if getattr(cat, 'name', None):
                    parts.append(str(cat.name).strip())
                if getattr(cat, 'code', None):
                    parts.append(str(cat.code).strip())
            except Exception:
                pass
        if getattr(p, 'wave_id', None) and p.wave_id:
            try:
                w = p.wave
                if getattr(w, 'code', None):
                    parts.append(str(w.code).strip())
                if getattr(w, 'name', None):
                    parts.append(str(w.name).strip())
            except Exception:
                pass
        if getattr(p, 'box_type_id', None) and p.box_type_id:
            try:
                b = p.box_type
                if getattr(b, 'code', None):
                    parts.append(str(b.code).strip())
                if getattr(b, 'name', None):
                    parts.append(str(b.name).strip())
            except Exception:
                pass
        combined = ' '.join(parts)
        p.search_text = unidecode(combined).lower() if combined else ''
        p.save(update_fields=['search_text'])


class Migration(migrations.Migration):

    dependencies = [
        ('products', '0003_add_productwave_productboxtype'),
    ]

    operations = [
        migrations.AddField(
            model_name='product',
            name='search_text',
            field=models.TextField(
                blank=True,
                db_index=True,
                default='',
                editable=False,
                help_text='Gộp code, name, size, note... (unidecode + lowercase) cho AND search + prefix',
                verbose_name='Chuỗi tìm kiếm',
            ),
        ),
        migrations.RunPython(fill_search_text, migrations.RunPython.noop),
    ]
