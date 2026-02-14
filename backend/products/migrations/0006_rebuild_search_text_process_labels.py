# Rebuild search_text to include process column labels (Đóng, Dán, ...) for search

from django.db import migrations
from unidecode import unidecode

WATERPROOF_LABELS = {'': 'Không', 'INSIDE': 'Trong', 'OUTSIDE': 'Ngoài', 'BOTH': '2 mặt'}
STATUS_LABELS = {'DRAFT': 'Nháp', 'ACTIVE': 'Đang bán', 'DISCONTINUED': 'Ngừng SX'}
PROCESS_LABELS = {
    'process_xa': 'Xả', 'process_in': 'In', 'process_boi': 'Bồi',
    'process_can_mang': 'Cán màng', 'process_be': 'Bế', 'process_chap': 'Chạp',
    'process_dong': 'Đóng', 'process_dan': 'Dán', 'process_khac': 'Khác',
}


def rebuild_search_text(apps, schema_editor):
    """Rebuild search_text với nhãn cột công đoạn (Đóng, Dán, ...) để tìm theo tên cột."""
    Product = apps.get_model('products', 'Product')
    process_fields = (
        'process_xa', 'process_in', 'process_boi', 'process_can_mang',
        'process_be', 'process_chap', 'process_dong', 'process_dan', 'process_khac',
    )
    for p in Product.objects.select_related('category', 'wave', 'box_type', 'unit').iterator(chunk_size=500):
        parts = []
        for val in (
            getattr(p, 'code', None),
            getattr(p, 'name', None),
            getattr(p, 'description', None),
            getattr(p, 'size_order', None),
            getattr(p, 'size_production', None),
            getattr(p, 'film_code', None),
            getattr(p, 'mold_code', None),
            getattr(p, 'note', None),
            getattr(p, 'note_other', None),
            getattr(p, 'delivery_tolerance', None),
        ):
            if val is not None and str(val).strip():
                parts.append(str(val).strip())
        for f in (
            'cost_price', 'sale_price', 'min_stock',
            'commission_per_unit', 'commission_percent',
            *process_fields,
            'color_count',
        ):
            val = getattr(p, f, None)
            if val is not None:
                parts.append(str(val))
            if f in PROCESS_LABELS and val is not None:
                parts.append(PROCESS_LABELS[f])
        if getattr(p, 'process_can_mang', None) and int(p.process_can_mang or 0) > 0:
            parts.append('Có')
        else:
            parts.append('Không')
        if p.size_order and str(p.size_order).strip():
            compact = ''.join(c for c in str(p.size_order) if c.isdigit())
            if compact:
                parts.append(compact)
        if p.size_production and str(p.size_production).strip():
            compact = ''.join(c for c in str(p.size_production) if c.isdigit())
            if compact:
                parts.append(compact)
        if getattr(p, 'category', None) and p.category:
            parts.append(str(p.category.name).strip())
            parts.append(str(p.category.code).strip())
        if getattr(p, 'wave', None) and p.wave:
            parts.append(str(p.wave.code).strip())
            parts.append(str(p.wave.name).strip())
        if getattr(p, 'box_type', None) and p.box_type:
            parts.append(str(p.box_type.code).strip())
            parts.append(str(p.box_type.name).strip())
        if getattr(p, 'unit', None) and p.unit:
            parts.append(str(p.unit.name).strip())
            parts.append(str(p.unit.code).strip())
        wp = getattr(p, 'waterproof', None) or ''
        if wp:
            parts.append(wp)
        if wp in WATERPROOF_LABELS:
            parts.append(WATERPROOF_LABELS[wp])
        st = getattr(p, 'status', None) or ''
        if st:
            parts.append(st)
        if st in STATUS_LABELS:
            parts.append(STATUS_LABELS[st])
        combined = ' '.join(parts)
        p.search_text = unidecode(combined).lower() if combined else ''
        p.save(update_fields=['search_text'])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('products', '0005_rebuild_search_text_all_columns'),
    ]

    operations = [
        migrations.RunPython(rebuild_search_text, noop),
    ]
