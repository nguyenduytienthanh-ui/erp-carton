"""
ProductImportService: map + validate từng dòng Excel cho Product.
Dùng chung với core.utils.import_from_excel_with_processor (engine chung).
"""

from django.db import IntegrityError

from products.models import Product, ProductCategory, ProductUnit, ProductWave, ProductBoxType
from core.models import NumberSequence


class ProductImportService:
    """
    Service xử lý import Excel cho Product. Mỗi row được map và validate,
    sau đó create/update Product. Engine chung gọi process_row.
    """

    @staticmethod
    def process_row(row_values, headers, row_idx, context):
        """
        Xử lý 1 dòng Excel: map, validate, create/update Product.

        Args:
            row_values: list giá trị theo cột (index 0-28, 29 cột - trùng Quản lý sản phẩm)
            headers: list tiêu đề (không dùng vì Product dùng cố định)
            row_idx: số dòng (1-based)
            context: dict {user, update_if_exists, seq}

        Returns:
            (success: bool, error_str: str or None)
        """
        user = context.get('user')
        update_if_exists = context.get('update_if_exists', False)
        seq = context.get('seq')

        # Pad row nếu thiếu cột (29 cột - thứ tự theo Quản lý sản phẩm, không có Tồn TT, không có Mô tả)
        row = list(row_values) if row_values else []
        if len(row) < 29:
            row.extend([None] * (29 - len(row)))

        (code, name, category_code, status_val,
         cost_price, sale_price, commission_per_unit, commission_percent,
         size_order, size_production, wave_type, box_type, unit_code,
         delivery_tolerance,
         process_xa, process_in, film_code, color_count, waterproof,
         process_can_mang, process_boi, process_be, mold_code,
         process_chap, process_dong, process_dan, process_khac,
         note_other, note) = row[:29]

        name = str(name).strip() if name is not None else ''

        # Bắt buộc: tên hàng
        if not name:
            return (False, 'Thiếu tên hàng (bắt buộc)')

        # Bắt buộc: mã đơn vị
        unit_code_str = str(unit_code).strip().upper() if unit_code else ''
        if not unit_code_str:
            return (False, 'Thiếu mã đơn vị (bắt buộc)')

        # Resolve category
        category = None
        if category_code:
            cat_code = str(category_code).strip().upper()
            category = ProductCategory.objects.filter(code=cat_code, deleted_at__isnull=True).first()

        # Resolve unit
        unit = ProductUnit.objects.filter(code=unit_code_str, deleted_at__isnull=True).first()
        if not unit:
            return (False, f'Không tìm thấy đơn vị "{unit_code_str}"')

        # Resolve wave
        wave = None
        if wave_type:
            wc = str(wave_type).strip().upper()
            wave = ProductWave.objects.filter(code=wc, deleted_at__isnull=True).first()

        # Resolve box_type
        box_type_obj = None
        if box_type:
            bc = str(box_type).strip().upper()
            box_type_obj = ProductBoxType.objects.filter(code=bc, deleted_at__isnull=True).first()

        # Code: dùng NumberSequence nếu thiếu
        code_str = str(code).strip() if code else ''
        if not code_str and seq:
            code_str = seq.get_next_number()

        # Status
        status_val = (str(status_val).strip() if status_val else 'DRAFT')
        if status_val not in dict(Product.STATUS_CHOICES):
            status_val = 'DRAFT'

        def _int_or_none(val):
            if val is None or val == '':
                return None
            try:
                return int(float(val))
            except (TypeError, ValueError):
                return None

        def _str_blank(val):
            return str(val).strip() if val is not None else ''

        wp_val = _str_blank(waterproof).upper()
        if wp_val and wp_val not in ('INSIDE', 'OUTSIDE', 'BOTH'):
            wp_val = ''

        defaults = {
            'name': name,
            'category': category,
            'unit': unit,
            'size_order': _str_blank(size_order),
            'size_production': _str_blank(size_production),
            'wave': wave,
            'box_type': box_type_obj,
            'cost_price': cost_price or 0,
            'sale_price': sale_price or 0,
            'delivery_tolerance': _str_blank(delivery_tolerance),
            'commission_per_unit': commission_per_unit or 0,
            'commission_percent': commission_percent or 0,
            'note': _str_blank(note),
            'status': status_val,
            'updated_by': user,
            'process_xa': _int_or_none(process_xa),
            'process_in': _int_or_none(process_in),
            'process_boi': _int_or_none(process_boi),
            'process_can_mang': _int_or_none(process_can_mang),
            'process_be': _int_or_none(process_be),
            'process_chap': _int_or_none(process_chap),
            'process_dong': _int_or_none(process_dong),
            'process_dan': _int_or_none(process_dan),
            'process_khac': _int_or_none(process_khac),
            'film_code': _str_blank(film_code),
            'color_count': _int_or_none(color_count) if _int_or_none(color_count) is not None else 0,
            'mold_code': _str_blank(mold_code),
            'waterproof': wp_val,
            'note_other': _str_blank(note_other),
        }

        try:
            if update_if_exists:
                Product.objects.update_or_create(
                    code=code_str,
                    defaults={**defaults, 'created_by': user},
                )
            else:
                if Product.objects.filter(code=code_str).exists():
                    return (False, f'Mã hàng "{code_str}" đã tồn tại, hãy đổi lại')
                Product.objects.create(
                    code=code_str,
                    created_by=user,
                    **defaults,
                )
            return (True, None)
        except IntegrityError as ie:
            err_msg = str(ie)
            if 'code' in err_msg.lower() or 'unique' in err_msg.lower():
                return (False, f'Mã hàng "{code_str}" đã tồn tại, hãy đổi lại')
            return (False, err_msg[:200])
        except Exception as e:
            return (False, str(e))
