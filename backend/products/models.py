import re
from decimal import Decimal
from django.db import models
from django.db.models import Q
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from unidecode import unidecode

User = get_user_model()

# Phân tách kích thước: 50x30x20 → 503020 (để tìm "503020" vẫn ra)
_DIMENSION_SEP = re.compile(r'[xX*×·\s]+', re.UNICODE)


def _dimension_compact(s):
    if not s or not str(s).strip():
        return ''
    return _DIMENSION_SEP.sub('', str(s).strip()) or ''


class ProductCategory(models.Model):
    """Danh mục sản phẩm - Phân loại sản phẩm theo cấu trúc cây (Master Data chuẩn)"""
    
    code = models.CharField(max_length=20, help_text="Mã danh mục (unique trong bản ghi chưa xóa)")
    name = models.CharField(max_length=200, help_text="Tên danh mục")
    description = models.TextField(blank=True, help_text="Mô tả chi tiết")
    parent = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='children',
        help_text="Danh mục cha"
    )
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0, blank=True, help_text="Thứ tự sắp xếp")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_product_categories',
        verbose_name="Người tạo",
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_product_categories',
        verbose_name="Người cập nhật",
    )
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name="Ngày xóa (soft)")
    deleted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='deleted_product_categories',
        verbose_name="Người xóa",
    )
    
    class Meta:
        db_table = 'product_categories'
        ordering = ['sort_order', 'code']
        verbose_name = 'Product Category'
        verbose_name_plural = 'Product Categories'
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['name']),
            models.Index(fields=['is_active']),
            models.Index(fields=['created_at']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['code'],
                condition=Q(deleted_at__isnull=True),
                name='product_cat_code_uniq_active',
            ),
        ]

    def __str__(self):
        return f"{self.code} - {self.name}"

    def save(self, *args, **kwargs):
        # Chỉ normalize code; created_by/updated_by do ViewSet/admin set, không đụng ở đây
        if self.code:
            self.code = str(self.code).strip().upper()
        super().save(*args, **kwargs)


class ProductUnit(models.Model):
    """Đơn vị tính của sản phẩm (Master Data chuẩn)"""
    
    code = models.CharField(max_length=10, help_text="Mã đơn vị (unique trong bản ghi chưa xóa)")
    name = models.CharField(max_length=100, help_text="Tên đơn vị (Cái, Hộp, Kiện)")
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0, blank=True, help_text="Thứ tự sắp xếp")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_product_units',
        verbose_name="Người tạo",
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_product_units',
        verbose_name="Người cập nhật",
    )
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name="Ngày xóa (soft)")
    deleted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='deleted_product_units',
        verbose_name="Người xóa",
    )
    
    class Meta:
        db_table = 'product_units'
        ordering = ['sort_order', 'code']
        verbose_name = 'Product Unit'
        verbose_name_plural = 'Product Units'
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['name']),
            models.Index(fields=['is_active']),
            models.Index(fields=['created_at']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['code'],
                condition=Q(deleted_at__isnull=True),
                name='product_unit_code_uniq_active',
            ),
        ]

    def __str__(self):
        return f"{self.code} - {self.name}"

    def save(self, *args, **kwargs):
        if self.code:
            self.code = str(self.code).strip().upper()
        super().save(*args, **kwargs)


class ProductWave(models.Model):
    """Loại sóng: A, B, C, E, BC... (Master Data chuẩn)"""
    code = models.CharField(max_length=10, verbose_name="Mã sóng (unique trong bản ghi chưa xóa)")
    name = models.CharField(max_length=50, verbose_name="Tên sóng")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    is_active = models.BooleanField(default=True, verbose_name="Đang sử dụng")
    sort_order = models.IntegerField(default=0, blank=True, verbose_name="Thứ tự")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_product_waves',
        verbose_name="Người tạo",
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_product_waves',
        verbose_name="Người cập nhật",
    )
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name="Ngày xóa (soft)")
    deleted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='deleted_product_waves',
        verbose_name="Người xóa",
    )

    class Meta:
        db_table = 'product_waves'
        verbose_name = 'Loại sóng'
        verbose_name_plural = 'Loại sóng'
        ordering = ['sort_order', 'code']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['name']),
            models.Index(fields=['is_active']),
            models.Index(fields=['created_at']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['code'],
                condition=Q(deleted_at__isnull=True),
                name='product_wave_code_uniq_active',
            ),
        ]

    def __str__(self):
        return f"{self.code} - {self.name}"

    def save(self, *args, **kwargs):
        if self.code:
            self.code = str(self.code).strip().upper()
        super().save(*args, **kwargs)


class ProductBoxType(models.Model):
    """Kiểu thùng: A1, A2, B1, C1... (Master Data chuẩn)"""
    code = models.CharField(max_length=10, verbose_name="Mã kiểu (unique trong bản ghi chưa xóa)")
    name = models.CharField(max_length=50, verbose_name="Tên kiểu")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    is_active = models.BooleanField(default=True, verbose_name="Đang sử dụng")
    sort_order = models.IntegerField(default=0, blank=True, verbose_name="Thứ tự")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_product_box_types',
        verbose_name="Người tạo",
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_product_box_types',
        verbose_name="Người cập nhật",
    )
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name="Ngày xóa (soft)")
    deleted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='deleted_product_box_types',
        verbose_name="Người xóa",
    )

    class Meta:
        db_table = 'product_box_types'
        verbose_name = 'Kiểu thùng'
        verbose_name_plural = 'Kiểu thùng'
        ordering = ['sort_order', 'code']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['name']),
            models.Index(fields=['is_active']),
            models.Index(fields=['created_at']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['code'],
                condition=Q(deleted_at__isnull=True),
                name='product_boxtype_code_uniq_active',
            ),
        ]

    def __str__(self):
        return f"{self.code} - {self.name}"

    def save(self, *args, **kwargs):
        if self.code:
            self.code = str(self.code).strip().upper()
        super().save(*args, **kwargs)


class Operation(models.Model):
    """Master production operation used as the source for product routings."""

    code = models.CharField(max_length=30, unique=True)
    name = models.CharField(max_length=100)
    sequence = models.PositiveIntegerField(default=100)
    default_unit = models.CharField(max_length=30, default='pcs/hour')
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'operations'
        ordering = ['sequence', 'code']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['sequence']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return f"{self.code} - {self.name}"

    def save(self, *args, **kwargs):
        if self.code:
            self.code = str(self.code).strip().upper()
        super().save(*args, **kwargs)


class Product(models.Model):
    """Model sản phẩm thùng carton với đầy đủ thông tin sản xuất"""

    class ProductKind(models.TextChoices):
        SPECIFIC = 'SPECIFIC', 'Mã riêng'
        GENERIC = 'GENERIC', 'Mã chung'

    PRINT_COLOR_FIELDS = (
        'print_color_1',
        'print_color_2',
        'print_color_3',
        'print_color_4',
        'print_color_5',
    )

    # ============ CƠ BẢN (Giữ nguyên) ============
    code = models.CharField(max_length=50, unique=True, verbose_name="Mã hàng")
    name = models.CharField(max_length=200, verbose_name="Tên hàng")
    category = models.ForeignKey(
        ProductCategory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='products',
        verbose_name="Danh mục",
    )
    unit = models.ForeignKey(
        ProductUnit,
        on_delete=models.PROTECT,
        related_name='products',
        verbose_name="Đơn vị tính",
    )
    description = models.TextField(blank=True, verbose_name="Mô tả")
    product_kind = models.CharField(
        max_length=20,
        choices=ProductKind.choices,
        default=ProductKind.SPECIFIC,
        verbose_name="Loại mã hàng",
    )
    requires_order_spec = models.BooleanField(
        default=False,
        verbose_name="Bắt buộc xác nhận quy cách khi lên đơn",
    )
    requires_order_operations_review = models.BooleanField(
        default=False,
        verbose_name="Bắt buộc kiểm tra công đoạn khi lên đơn",
    )

    # ============ KÍCH THƯỚC ============
    size_order = models.CharField(max_length=50, blank=True, verbose_name="Kích thước ĐH")
    size_production = models.CharField(max_length=50, blank=True, verbose_name="KTSX")
    wave = models.ForeignKey(
        ProductWave,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='products',
        verbose_name="Sóng",
    )
    box_type = models.ForeignKey(
        ProductBoxType,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='products',
        verbose_name="Kiểu",
    )

    # ============ GIÁ & SỐ LƯỢNG (Giữ nguyên) ============
    cost_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(0)],
        verbose_name="Giá vốn",
    )
    sale_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(0)],
        verbose_name="Đơn giá",
    )
    min_stock = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=0,
        verbose_name="Tồn TT",
    )

    # ============ GIAO HÀNG ============
    delivery_tolerance = models.CharField(max_length=50, blank=True, verbose_name="+/-")

    # ============ HOA HỒNG ============
    commission_per_unit = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
        verbose_name="HHCĐ (đ/cái)",
    )
    commission_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=0,
        verbose_name="HH%",
    )

    # ============ CÔNG ĐOẠN SẢN XUẤT ============
    process_xa = models.IntegerField(null=True, blank=True, verbose_name="Xả (cái/giờ)")
    process_in = models.IntegerField(null=True, blank=True, verbose_name="In (cái/giờ)")
    process_boi = models.IntegerField(null=True, blank=True, verbose_name="Bồi (cái/giờ)")
    process_can_mang = models.IntegerField(null=True, blank=True, verbose_name="Cán màng (cái/giờ)")
    process_be = models.IntegerField(null=True, blank=True, verbose_name="Bế (cái/giờ)")
    process_chap = models.IntegerField(null=True, blank=True, verbose_name="Chạp (cái/giờ)")
    process_dong = models.IntegerField(null=True, blank=True, verbose_name="Đóng (cái/giờ)")
    process_dan = models.IntegerField(null=True, blank=True, verbose_name="Dán (cái/giờ)")
    process_khac = models.IntegerField(null=True, blank=True, verbose_name="Khác (cái/giờ)")

    # ============ IN ẤN ============
    film_code = models.CharField(max_length=100, blank=True, verbose_name="Mã phim")
    film_file_url = models.URLField(blank=True, verbose_name="Link file phim (PDF)")
    color_count = models.IntegerField(default=0, verbose_name="Số màu")
    print_color_1 = models.CharField(max_length=100, blank=True, default='', verbose_name="Màu in 1 / mã màu")
    print_color_2 = models.CharField(max_length=100, blank=True, default='', verbose_name="Màu in 2 / mã màu")
    print_color_3 = models.CharField(max_length=100, blank=True, default='', verbose_name="Màu in 3 / mã màu")
    print_color_4 = models.CharField(max_length=100, blank=True, default='', verbose_name="Màu in 4 / mã màu")
    print_color_5 = models.CharField(max_length=100, blank=True, default='', verbose_name="Màu in 5 / mã màu")

    # ============ BẾ ============
    mold_code = models.CharField(max_length=100, blank=True, verbose_name="Mã khuôn")
    mold_file_url = models.URLField(blank=True, verbose_name="Link file khuôn (PDF)")

    # ============ CHỐNG THẤM ============
    WATERPROOF_CHOICES = [
        ('', 'Không'),
        ('INSIDE', 'Trong'),
        ('OUTSIDE', 'Ngoài'),
        ('BOTH', '2 mặt'),
    ]
    waterproof = models.CharField(
        max_length=10,
        choices=WATERPROOF_CHOICES,
        blank=True,
        default='',
        verbose_name="Chống thấm",
    )

    # ============ GHI CHÚ ============
    note_other = models.TextField(blank=True, verbose_name="Ghi chú khác")
    note = models.TextField(blank=True, verbose_name="Ghi chú")

    # ============ TÌM KIẾM (token AND, prefix, không dấu, lowercase) ============
    search_text = models.TextField(
        blank=True,
        default='',
        db_index=True,
        editable=False,
        verbose_name="Chuỗi tìm kiếm",
        help_text="Gộp code, name, size, note... (unidecode + lowercase) cho AND search + prefix",
    )

    # ============ BOM - THÙNG MẸ/CON ============
    parent = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='components',
        verbose_name="Thùng mẹ",
    )
    component_quantity = models.IntegerField(default=1, verbose_name="Số lượng đi kèm")
    is_set = models.BooleanField(default=False, verbose_name="Là bộ sản phẩm")

    # ============ TRẠNG THÁI (Giữ nguyên) ============
    STATUS_CHOICES = [
        ('DRAFT', 'Nháp'),
        ('ACTIVE', 'Đang bán'),
        ('DISCONTINUED', 'Ngừng SX'),
    ]
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='DRAFT',
        verbose_name="Trạng thái",
    )

    # ============ PHÂN QUYỀN (Giữ nguyên) ============
    owner = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='owned_products',
        verbose_name="Người sở hữu",
    )
    team = models.ForeignKey(
        'core.Team',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='team_products',
        verbose_name="Nhóm",
    )
    is_active = models.BooleanField(default=True, verbose_name="Kích hoạt")

    # ============ AUDIT (Giữ nguyên) ============
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Ngày tạo")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Ngày cập nhật")
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_products',
        verbose_name="Người tạo",
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_products',
        verbose_name="Người cập nhật",
    )

    class Meta:
        db_table = 'products'
        ordering = ['-created_at']
        verbose_name = 'Sản phẩm'
        verbose_name_plural = 'Sản phẩm'
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['name']),
            models.Index(fields=['status']),
            models.Index(fields=['parent']),
            models.Index(fields=['is_active']),
            models.Index(fields=['team']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return f"{self.code} - {self.name}"

    def _build_search_text(self):
        """Chuỗi tìm kiếm: unidecode + lowercase, gộp TẤT CẢ cột hiển thị; thêm dạng compact kích thước (503020)."""
        parts = []
        # Cơ bản
        for val in (
            getattr(self, 'code', None),
            getattr(self, 'name', None),
            getattr(self, 'description', None),
            getattr(self, 'size_order', None),
            getattr(self, 'size_production', None),
            getattr(self, 'film_code', None),
            getattr(self, 'mold_code', None),
            getattr(self, 'note', None),
            getattr(self, 'note_other', None),
            getattr(self, 'delivery_tolerance', None),
        ):
            if val is not None and str(val).strip():
                parts.append(str(val).strip())
        # Số: giá, tồn, hoa hồng, công đoạn, số màu (để tìm "0", "100", "Có" v.v.)
        process_fields = (
            'process_xa', 'process_in', 'process_boi', 'process_can_mang',
            'process_be', 'process_chap', 'process_dong', 'process_dan', 'process_khac',
        )
        process_labels = {
            'process_xa': 'Xả', 'process_in': 'In', 'process_boi': 'Bồi',
            'process_can_mang': 'Cán màng', 'process_be': 'Bế', 'process_chap': 'Chạp',
            'process_dong': 'Đóng', 'process_dan': 'Dán', 'process_khac': 'Khác',
        }
        for f in (
            'cost_price', 'sale_price', 'min_stock',
            'commission_per_unit', 'commission_percent',
            *process_fields,
            'color_count',
        ):
            val = getattr(self, f, None)
            if val is not None:
                parts.append(str(val))
            if f in process_labels and val is not None:
                parts.append(process_labels[f])
        # Có CM (process_can_mang > 0)
        if getattr(self, 'process_can_mang', None) and int(self.process_can_mang or 0) > 0:
            parts.append('Có')
        else:
            parts.append('Không')
        # Kích thước dạng compact (503020)
        for f in ('size_order', 'size_production'):
            val = getattr(self, f, None)
            if val and str(val).strip():
                compact = _dimension_compact(val)
                if compact and compact != str(val).strip():
                    parts.append(compact)
        # Danh mục
        if getattr(self, 'category', None):
            c = self.category
            if getattr(c, 'name', None):
                parts.append(str(c.name).strip())
            if getattr(c, 'code', None):
                parts.append(str(c.code).strip())
        # Sóng
        if getattr(self, 'wave', None):
            w = self.wave
            if getattr(w, 'code', None):
                parts.append(str(w.code).strip())
            if getattr(w, 'name', None):
                parts.append(str(w.name).strip())
        # Kiểu
        if getattr(self, 'box_type', None):
            b = self.box_type
            if getattr(b, 'code', None):
                parts.append(str(b.code).strip())
            if getattr(b, 'name', None):
                parts.append(str(b.name).strip())
        # Đơn vị
        if getattr(self, 'unit', None):
            u = self.unit
            if getattr(u, 'name', None):
                parts.append(str(u.name).strip())
            if getattr(u, 'code', None):
                parts.append(str(u.code).strip())
        # Chống thấm: giá trị + nhãn
        wp = getattr(self, 'waterproof', None) or ''
        if wp:
            parts.append(wp)
        for choice_val, label in self.WATERPROOF_CHOICES:
            if choice_val == wp and label:
                parts.append(label)
        # Trạng thái: giá trị + nhãn
        st = getattr(self, 'status', None) or ''
        if st:
            parts.append(st)
        for choice_val, label in self.STATUS_CHOICES:
            if choice_val == st and label:
                parts.append(label)
        combined = ' '.join(parts)
        self.search_text = unidecode(combined).lower() if combined else ''

    def save(self, *args, **kwargs):
        if self.product_kind == self.ProductKind.GENERIC:
            self.requires_order_spec = True
            self.requires_order_operations_review = True
        color_count_from_print_colors = 0
        for field in self.PRINT_COLOR_FIELDS:
            value = (getattr(self, field, '') or '').strip()
            setattr(self, field, value)
            if value:
                color_count_from_print_colors += 1
        if color_count_from_print_colors > 0:
            self.color_count = color_count_from_print_colors
        elif self._state.adding:
            self.color_count = 0
        if not self.size_production and self.size_order:
            self.size_production = self.size_order
        self._build_search_text()
        super().save(*args, **kwargs)

    @property
    def is_component(self):
        """Kiểm tra có phải là thùng con/lót/khay không"""
        if self.parent is not None:
            return True
        bundle_links = getattr(self, 'bundle_memberships', None)
        if bundle_links is None:
            return False
        return bundle_links.exists()

    @property
    def full_name(self):
        """Tên đầy đủ với kích thước"""
        parts = [self.name]
        if self.size_order:
            parts.append(f"({self.size_order})")
        if self.wave:
            parts.append(f"- {self.wave.code}")
        return " ".join(parts)


class ProductOperation(models.Model):
    """Standard operation/rate for a product, replacing legacy process_* columns over time."""

    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name='operations',
    )
    operation = models.ForeignKey(
        Operation,
        on_delete=models.PROTECT,
        related_name='product_operations',
    )
    operation_code = models.CharField(max_length=30, blank=True)
    operation_name = models.CharField(max_length=100, blank=True)
    sequence = models.PositiveIntegerField(default=0)
    standard_rate_per_hour = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    note = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_product_operations',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_product_operations',
    )

    class Meta:
        db_table = 'product_operations'
        ordering = ['product_id', 'sequence', 'operation_code']
        constraints = [
            models.UniqueConstraint(
                fields=['product', 'operation'],
                name='product_operation_product_operation_uniq',
            ),
            models.CheckConstraint(
                condition=Q(standard_rate_per_hour__gt=0),
                name='product_operation_rate_gt_0',
            ),
        ]
        indexes = [
            models.Index(fields=['product', 'sequence']),
            models.Index(fields=['operation']),
            models.Index(fields=['operation_code']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return f"{self.product_id}:{self.operation_code}"

    def clean(self):
        super().clean()
        if self.standard_rate_per_hour is None or self.standard_rate_per_hour <= 0:
            raise ValidationError({'standard_rate_per_hour': 'Operation rate must be greater than 0.'})

    def save(self, *args, **kwargs):
        if self.operation_id:
            self.operation_code = self.operation.code
            self.operation_name = self.operation.name
            if not self.sequence:
                self.sequence = self.operation.sequence
        super().save(*args, **kwargs)


class ProductRoutingStep(models.Model):
    """Ordered production routing step for a product."""

    class StepType(models.TextChoices):
        REQUIRED = 'REQUIRED', 'Required'
        OPTIONAL = 'OPTIONAL', 'Optional'
        CHOOSE_ONE = 'CHOOSE_ONE', 'Choose one'
        PARALLEL = 'PARALLEL', 'Parallel'

    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name='routing_steps',
    )
    step_no = models.PositiveIntegerField(default=10, validators=[MinValueValidator(1)])
    display_order = models.PositiveIntegerField(default=10, validators=[MinValueValidator(1)])
    operation = models.ForeignKey(
        Operation,
        on_delete=models.PROTECT,
        related_name='routing_steps',
    )
    product_operation = models.ForeignKey(
        ProductOperation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='routing_steps',
    )
    operation_code = models.CharField(max_length=30, blank=True)
    operation_name = models.CharField(max_length=100, blank=True)
    standard_rate_per_hour = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    note = models.TextField(blank=True)
    step_type = models.CharField(
        max_length=20,
        choices=StepType.choices,
        default=StepType.REQUIRED,
    )
    group_code = models.CharField(max_length=50, blank=True, default='')
    is_required = models.BooleanField(default=True)
    allow_parallel = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'product_routing_steps'
        ordering = ['product_id', 'step_no', 'display_order', 'id']
        constraints = [
            models.CheckConstraint(
                condition=Q(step_no__gt=0),
                name='product_routing_step_step_no_gt_0',
            ),
            models.CheckConstraint(
                condition=Q(display_order__gt=0),
                name='product_routing_step_display_order_gt_0',
            ),
            models.CheckConstraint(
                condition=Q(standard_rate_per_hour__gt=0),
                name='product_routing_step_rate_gt_0',
            ),
        ]
        indexes = [
            models.Index(fields=['product', 'step_no', 'display_order']),
            models.Index(fields=['operation']),
            models.Index(fields=['product_operation']),
            models.Index(fields=['operation_code']),
            models.Index(fields=['is_active']),
            models.Index(fields=['step_type']),
            models.Index(fields=['group_code']),
        ]

    def __str__(self):
        return f"{self.product_id}:{self.step_no}:{self.operation_code or self.operation_id}"

    def clean(self):
        super().clean()
        errors = {}
        if self.step_no is None or self.step_no <= 0:
            errors['step_no'] = 'Step number must be greater than 0.'
        if self.display_order is None or self.display_order <= 0:
            errors['display_order'] = 'Display order must be greater than 0.'
        if self.standard_rate_per_hour is None or self.standard_rate_per_hour <= 0:
            errors['standard_rate_per_hour'] = 'Operation rate must be greater than 0.'
        if self.product_operation_id:
            if self.product_operation.product_id != self.product_id:
                errors['product_operation'] = 'Product operation must belong to the same product.'
            if self.operation_id and self.product_operation.operation_id != self.operation_id:
                errors['operation'] = 'Operation must match the selected product operation.'
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.product_operation_id:
            product_operation = self.product_operation
            if not self.operation_id:
                self.operation = product_operation.operation
            if not self.standard_rate_per_hour:
                self.standard_rate_per_hour = product_operation.standard_rate_per_hour
            if not self.note:
                self.note = product_operation.note
            if not self.step_no:
                self.step_no = product_operation.sequence or product_operation.operation.sequence
            if not self.display_order:
                self.display_order = product_operation.sequence or product_operation.operation.sequence
        if self.operation_id:
            self.operation_code = self.operation.code
            self.operation_name = self.operation.name
            if not self.step_no:
                self.step_no = self.operation.sequence
            if not self.display_order:
                self.display_order = self.operation.sequence
        if self.group_code:
            self.group_code = str(self.group_code).strip().upper()
        if self.step_type:
            self.step_type = str(self.step_type).strip().upper()
        else:
            self.step_type = self.StepType.REQUIRED
        super().save(*args, **kwargs)


class ProductBundle(models.Model):
    """Định nghĩa bộ sản phẩm để bán/giao đồng bộ mà không làm mất tính độc lập của từng mã hàng."""

    PRICING_MODE_PRIMARY = 'PRIMARY_PRODUCT'
    PRICING_MODE_FIXED = 'FIXED_BUNDLE'
    PRICING_MODE_SUM_COMPONENTS = 'SUM_COMPONENTS'
    PRICING_MODE_CHOICES = [
        (PRICING_MODE_PRIMARY, 'Lấy theo sản phẩm mẹ/đại diện'),
        (PRICING_MODE_FIXED, 'Giá bộ cố định'),
        (PRICING_MODE_SUM_COMPONENTS, 'Cộng từ các thành phần'),
    ]

    COMMISSION_MODE_PRIMARY = 'PRIMARY_PRODUCT'
    COMMISSION_MODE_FIXED = 'FIXED_VALUES'
    COMMISSION_MODE_SUM_COMPONENTS = 'SUM_COMPONENTS'
    COMMISSION_MODE_CHOICES = [
        (COMMISSION_MODE_PRIMARY, 'Lấy theo sản phẩm mẹ/đại diện'),
        (COMMISSION_MODE_FIXED, 'Hoa hồng cố định theo bộ'),
        (COMMISSION_MODE_SUM_COMPONENTS, 'Cộng từ các thành phần'),
    ]

    DELIVERY_RULE_STRICT_FULL_SET = 'STRICT_FULL_SET'
    DELIVERY_RULE_NON_SYNC = 'NON_SYNC'
    DELIVERY_RULE_CHOICES = [
        (DELIVERY_RULE_STRICT_FULL_SET, 'Giao đồng bộ đủ bộ'),
        (DELIVERY_RULE_NON_SYNC, 'Giao không đồng bộ'),
    ]

    sellable_product = models.OneToOneField(
        Product,
        on_delete=models.CASCADE,
        related_name='bundle_config',
        verbose_name='Mã bán/bộ đại diện',
    )
    primary_product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='primary_for_bundles',
        verbose_name='Sản phẩm mẹ/chính',
    )
    pricing_mode = models.CharField(
        max_length=30,
        choices=PRICING_MODE_CHOICES,
        default=PRICING_MODE_PRIMARY,
        verbose_name='Kiểu tính giá bộ',
    )
    fixed_cost_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal('0'),
        validators=[MinValueValidator(0)],
        verbose_name='Giá vốn bộ cố định',
    )
    fixed_sale_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal('0'),
        validators=[MinValueValidator(0)],
        verbose_name='Giá bán bộ cố định',
    )
    commission_mode = models.CharField(
        max_length=30,
        choices=COMMISSION_MODE_CHOICES,
        default=COMMISSION_MODE_PRIMARY,
        verbose_name='Kiểu tính hoa hồng bộ',
    )
    fixed_commission_per_unit = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0'),
        validators=[MinValueValidator(0)],
        verbose_name='HHCĐ bộ cố định',
    )
    fixed_commission_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('0'),
        validators=[MinValueValidator(0)],
        verbose_name='HH% bộ cố định',
    )
    delivery_rule = models.CharField(
        max_length=30,
        choices=DELIVERY_RULE_CHOICES,
        default=DELIVERY_RULE_STRICT_FULL_SET,
        verbose_name='Quy tắc giao đồng bộ',
    )
    note = models.TextField(blank=True, verbose_name='Ghi chú bộ')
    is_active = models.BooleanField(default=True, verbose_name='Kích hoạt')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Ngày tạo')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Ngày cập nhật')
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_product_bundles',
        verbose_name='Người tạo',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_product_bundles',
        verbose_name='Người cập nhật',
    )

    class Meta:
        db_table = 'product_bundles'
        ordering = ['sellable_product__code']
        verbose_name = 'Bộ sản phẩm'
        verbose_name_plural = 'Bộ sản phẩm'
        indexes = [
            models.Index(fields=['pricing_mode']),
            models.Index(fields=['commission_mode']),
            models.Index(fields=['delivery_rule']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return f'Bundle {self.sellable_product.code}'

    @classmethod
    def commission_mode_from_pricing_mode(cls, pricing_mode):
        return {
            cls.PRICING_MODE_PRIMARY: cls.COMMISSION_MODE_PRIMARY,
            cls.PRICING_MODE_FIXED: cls.COMMISSION_MODE_FIXED,
            cls.PRICING_MODE_SUM_COMPONENTS: cls.COMMISSION_MODE_SUM_COMPONENTS,
        }.get(pricing_mode, cls.COMMISSION_MODE_PRIMARY)

    def get_commission_mode(self):
        return self.commission_mode_from_pricing_mode(self.pricing_mode)

    def get_primary_product(self):
        return self.primary_product or self.sellable_product

    def get_active_components(self):
        return self.components.select_related(
            'component_product',
            'component_product__unit',
        ).filter(
            component_product__is_active=True,
            is_active=True,
        ).order_by('sort_order', 'id')

    def resolve_cost_price(self, as_of=None):
        from .price_services import resolve_product_price_as_of

        total = Decimal('0')
        components = list(self.get_active_components())
        for component in components:
            component_price = resolve_product_price_as_of(component.component_product, as_of)
            total += (component_price['cost_price'] or Decimal('0')) * (component.qty_per_bundle or Decimal('0'))
        if total > 0:
            return total
        primary = self.get_primary_product()
        primary_price = resolve_product_price_as_of(primary, as_of)
        return primary_price['cost_price'] or Decimal('0')

    def resolve_sale_price(self, as_of=None):
        from .price_services import resolve_product_price_as_of

        primary = self.get_primary_product()
        if self.pricing_mode == self.PRICING_MODE_FIXED:
            return self.fixed_sale_price or Decimal('0')
        if self.pricing_mode == self.PRICING_MODE_SUM_COMPONENTS:
            total = Decimal('0')
            for component in self.get_active_components():
                component_price = resolve_product_price_as_of(component.component_product, as_of)
                total += (component_price['sale_price'] or Decimal('0')) * (component.qty_per_bundle or Decimal('0'))
            return total
        primary_price = resolve_product_price_as_of(primary, as_of)
        return primary_price['sale_price'] or Decimal('0')

    def resolve_commission_per_unit(self, as_of=None):
        from .price_services import resolve_product_price_as_of

        primary = self.get_primary_product()
        commission_mode = self.get_commission_mode()
        if commission_mode == self.COMMISSION_MODE_FIXED:
            return self.fixed_commission_per_unit or Decimal('0')
        if commission_mode == self.COMMISSION_MODE_SUM_COMPONENTS:
            total = Decimal('0')
            for component in self.get_active_components():
                component_price = resolve_product_price_as_of(component.component_product, as_of)
                total += (component_price['commission_per_unit'] or Decimal('0')) * (component.qty_per_bundle or Decimal('0'))
            return total
        primary_price = resolve_product_price_as_of(primary, as_of)
        return primary_price['commission_per_unit'] or Decimal('0')

    def resolve_commission_percent(self, as_of=None):
        from .price_services import resolve_product_price_as_of

        primary = self.get_primary_product()
        commission_mode = self.get_commission_mode()
        if commission_mode == self.COMMISSION_MODE_FIXED:
            return self.fixed_commission_percent or Decimal('0')
        if commission_mode == self.COMMISSION_MODE_SUM_COMPONENTS:
            weighted_amount = Decimal('0')
            sale_base = Decimal('0')
            for component in self.get_active_components():
                component_price = resolve_product_price_as_of(component.component_product, as_of)
                component_sale = (component_price['sale_price'] or Decimal('0')) * (component.qty_per_bundle or Decimal('0'))
                if component_sale <= 0:
                    continue
                sale_base += component_sale
                weighted_amount += component_sale * ((component_price['commission_percent'] or Decimal('0')) / Decimal('100'))
            if sale_base <= 0:
                return Decimal('0')
            return (weighted_amount / sale_base * Decimal('100')).quantize(Decimal('0.01'))
        primary_price = resolve_product_price_as_of(primary, as_of)
        return primary_price['commission_percent'] or Decimal('0')


class ProductBundleComponent(models.Model):
    """Thành phần thuộc một bộ sản phẩm."""

    bundle = models.ForeignKey(
        ProductBundle,
        on_delete=models.CASCADE,
        related_name='components',
        verbose_name='Bộ sản phẩm',
    )
    component_product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT,
        related_name='bundle_memberships',
        verbose_name='Mã hàng thành phần',
    )
    qty_per_bundle = models.DecimalField(
        max_digits=18,
        decimal_places=4,
        default=Decimal('1'),
        validators=[MinValueValidator(Decimal('0.0001'))],
        verbose_name='Số lượng trong 1 bộ',
    )
    is_required = models.BooleanField(default=True, verbose_name='Bắt buộc giao đủ')
    sort_order = models.PositiveIntegerField(default=0, verbose_name='Thứ tự')
    is_active = models.BooleanField(default=True, verbose_name='Kích hoạt')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Ngày tạo')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Ngày cập nhật')

    class Meta:
        db_table = 'product_bundle_components'
        ordering = ['sort_order', 'id']
        verbose_name = 'Thành phần bộ sản phẩm'
        verbose_name_plural = 'Thành phần bộ sản phẩm'
        unique_together = [['bundle', 'component_product']]
        indexes = [
            models.Index(fields=['bundle']),
            models.Index(fields=['component_product']),
            models.Index(fields=['is_required']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return f'{self.bundle.sellable_product.code} -> {self.component_product.code} x {self.qty_per_bundle}'


class PriceChange(models.Model):
    """Lịch sử thay đổi giá chuyên dụng cho sản phẩm."""

    STATUS_PENDING_APPROVAL = 'PENDING_APPROVAL'
    STATUS_APPROVED_SCHEDULED = 'APPROVED_SCHEDULED'
    STATUS_ACTIVE_APPLIED = 'ACTIVE_APPLIED'
    STATUS_REJECTED = 'REJECTED'
    STATUS_SUPERSEDED = 'SUPERSEDED'

    STATUS_CHOICES = [
        (STATUS_PENDING_APPROVAL, 'Chờ duyệt'),
        (STATUS_APPROVED_SCHEDULED, 'Đã duyệt, chờ hiệu lực'),
        (STATUS_ACTIVE_APPLIED, 'Đang hiệu lực'),
        (STATUS_REJECTED, 'Từ chối'),
        (STATUS_SUPERSEDED, 'Đã bị thay thế'),
    ]

    SOURCE_SYSTEM = 'SYSTEM'
    SOURCE_MANUAL = 'MANUAL'
    SOURCE_IMPORT = 'IMPORT'
    SOURCE_API = 'API'

    SOURCE_CHOICES = [
        (SOURCE_SYSTEM, 'Hệ thống'),
        (SOURCE_MANUAL, 'Thủ công'),
        (SOURCE_IMPORT, 'Nhập dữ liệu'),
        (SOURCE_API, 'API'),
    ]

    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name='price_changes',
        verbose_name='Sản phẩm',
    )

    old_cost_price = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    new_cost_price = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    old_sale_price = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    new_sale_price = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    old_commission_per_unit = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    new_commission_per_unit = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    old_commission_percent = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    new_commission_percent = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    delta_cost = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    delta_sale = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    delta_cost_percent = models.DecimalField(max_digits=9, decimal_places=2, null=True, blank=True)
    delta_sale_percent = models.DecimalField(max_digits=9, decimal_places=2, null=True, blank=True)

    reason = models.TextField(blank=True, default='')
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default='MANUAL')
    effective_at = models.DateTimeField(null=True, blank=True)
    applied_at = models.DateTimeField(null=True, blank=True)
    batch_code = models.CharField(max_length=64, blank=True, default='')

    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default=STATUS_ACTIVE_APPLIED)
    submitted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='submitted_price_changes',
    )
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='approved_price_changes',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    reject_reason = models.TextField(blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'product_price_changes'
        ordering = ['-effective_at', '-created_at']
        indexes = [
            models.Index(fields=['product', 'created_at']),
            models.Index(fields=['status', 'created_at']),
            models.Index(fields=['product', 'effective_at']),
            models.Index(fields=['batch_code']),
        ]

    def __str__(self):
        return f"{self.product.code} - {self.status} ({self.created_at:%Y-%m-%d %H:%M})"

    def recalculate_delta_percents(self, save=False):
        self.delta_cost_percent = None
        self.delta_sale_percent = None
        if self.old_cost_price not in (None, Decimal('0')):
            self.delta_cost_percent = (
                (self.delta_cost or Decimal('0')) / self.old_cost_price * Decimal('100')
            ).quantize(Decimal('0.01'))
        if self.old_sale_price not in (None, Decimal('0')):
            self.delta_sale_percent = (
                (self.delta_sale or Decimal('0')) / self.old_sale_price * Decimal('100')
            ).quantize(Decimal('0.01'))
        if save:
            self.save(update_fields=['delta_cost_percent', 'delta_sale_percent', 'updated_at'])


class BundlePriceChange(models.Model):
    """Lịch sử thay đổi giá bộ cố định cho ProductBundle."""

    STATUS_PENDING_APPROVAL = 'PENDING_APPROVAL'
    STATUS_APPROVED_SCHEDULED = 'APPROVED_SCHEDULED'
    STATUS_ACTIVE_APPLIED = 'ACTIVE_APPLIED'
    STATUS_REJECTED = 'REJECTED'
    STATUS_SUPERSEDED = 'SUPERSEDED'

    STATUS_CHOICES = [
        (STATUS_PENDING_APPROVAL, 'Chờ duyệt'),
        (STATUS_APPROVED_SCHEDULED, 'Đã duyệt, chờ hiệu lực'),
        (STATUS_ACTIVE_APPLIED, 'Đang hiệu lực'),
        (STATUS_REJECTED, 'Từ chối'),
        (STATUS_SUPERSEDED, 'Đã bị thay thế'),
    ]

    SOURCE_SYSTEM = 'SYSTEM'
    SOURCE_MANUAL = 'MANUAL'
    SOURCE_IMPORT = 'IMPORT'
    SOURCE_API = 'API'

    SOURCE_CHOICES = [
        (SOURCE_SYSTEM, 'Hệ thống'),
        (SOURCE_MANUAL, 'Thủ công'),
        (SOURCE_IMPORT, 'Nhập dữ liệu'),
        (SOURCE_API, 'API'),
    ]

    bundle = models.ForeignKey(
        ProductBundle,
        on_delete=models.CASCADE,
        related_name='price_changes',
        verbose_name='Bộ sản phẩm',
    )

    old_fixed_cost_price = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    new_fixed_cost_price = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    old_fixed_sale_price = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    new_fixed_sale_price = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    old_fixed_commission_per_unit = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    new_fixed_commission_per_unit = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    old_fixed_commission_percent = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    new_fixed_commission_percent = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    delta_cost = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    delta_sale = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    delta_cost_percent = models.DecimalField(max_digits=9, decimal_places=2, null=True, blank=True)
    delta_sale_percent = models.DecimalField(max_digits=9, decimal_places=2, null=True, blank=True)

    reason = models.TextField(blank=True, default='')
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default=SOURCE_MANUAL)
    effective_at = models.DateTimeField(null=True, blank=True)
    applied_at = models.DateTimeField(null=True, blank=True)
    batch_code = models.CharField(max_length=64, blank=True, default='')

    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default=STATUS_ACTIVE_APPLIED)
    submitted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='submitted_bundle_price_changes',
    )
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='approved_bundle_price_changes',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    reject_reason = models.TextField(blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'product_bundle_price_changes'
        ordering = ['-effective_at', '-created_at']
        indexes = [
            models.Index(fields=['bundle', 'created_at']),
            models.Index(fields=['status', 'created_at']),
            models.Index(fields=['bundle', 'effective_at']),
            models.Index(fields=['batch_code']),
        ]

    def __str__(self):
        return f"{self.bundle.sellable_product.code} - {self.status} ({self.created_at:%Y-%m-%d %H:%M})"

    def recalculate_delta_percents(self, save=False):
        self.delta_cost_percent = None
        self.delta_sale_percent = None
        if self.old_fixed_cost_price not in (None, Decimal('0')):
            self.delta_cost_percent = (
                (self.delta_cost or Decimal('0')) / self.old_fixed_cost_price * Decimal('100')
            ).quantize(Decimal('0.01'))
        if self.old_fixed_sale_price not in (None, Decimal('0')):
            self.delta_sale_percent = (
                (self.delta_sale or Decimal('0')) / self.old_fixed_sale_price * Decimal('100')
            ).quantize(Decimal('0.01'))
        if save:
            self.save(update_fields=['delta_cost_percent', 'delta_sale_percent', 'updated_at'])

# ── Material Template models (tables already exist in DB) ─────────────────────


class ProductMaterialTemplate(models.Model):
    STATUS_DRAFT = 'DRAFT'
    STATUS_ACTIVE = 'ACTIVE'
    STATUS_INACTIVE = 'INACTIVE'
    STATUS_CHOICES = [
        (STATUS_DRAFT, 'Nháp'),
        (STATUS_ACTIVE, 'Đang áp dụng'),
        (STATUS_INACTIVE, 'Ngưng áp dụng'),
    ]

    finished_product = models.ForeignKey(
        'products.Product',
        on_delete=models.CASCADE,
        related_name='material_templates',
    )
    version_no = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT, db_index=True)
    effective_from = models.DateField(null=True, blank=True)
    effective_to = models.DateField(null=True, blank=True)
    is_default = models.BooleanField(default=False)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_product_material_templates',
    )
    updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='updated_product_material_templates',
    )

    class Meta:
        db_table = 'product_material_templates'
        ordering = ['finished_product_id', '-is_default', '-version_no']
        unique_together = [['finished_product', 'version_no']]

    def __str__(self):
        return f"{self.finished_product_id} v{self.version_no}"


class ProductMaterialGroup(models.Model):
    ROLE_PRIMARY = 'PRIMARY'
    ROLE_SHARED = 'SHARED'
    MATERIAL_ROLE_CHOICES = [
        (ROLE_PRIMARY, 'Nguyên liệu chính'),
        (ROLE_SHARED, 'Vật tư dùng chung'),
    ]
    RULE_ONE_OF = 'ONE_OF'
    RULE_ALL_REQUIRED = 'ALL_REQUIRED'
    SELECTION_RULE_CHOICES = [
        (RULE_ONE_OF, 'Chọn 1 trong nhiều'),
        (RULE_ALL_REQUIRED, 'Bắt buộc tất cả'),
    ]

    template = models.ForeignKey(ProductMaterialTemplate, on_delete=models.CASCADE, related_name='groups')
    group_code = models.CharField(max_length=50)
    group_name = models.CharField(max_length=255)
    material_role = models.CharField(max_length=20, choices=MATERIAL_ROLE_CHOICES, default=ROLE_PRIMARY, db_index=True)
    selection_rule = models.CharField(max_length=20, choices=SELECTION_RULE_CHOICES, default=RULE_ONE_OF, db_index=True)
    is_required = models.BooleanField(default=True)
    include_in_summary = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'product_material_groups'
        ordering = ['template_id', 'sort_order', 'id']
        unique_together = [['template', 'group_code']]

    def __str__(self):
        return f"{self.template_id}:{self.group_code}"

    def save(self, *args, **kwargs):
        if self.group_code:
            self.group_code = str(self.group_code).strip().upper()
        super().save(*args, **kwargs)


class ProductMaterialOption(models.Model):
    group = models.ForeignKey(ProductMaterialGroup, on_delete=models.CASCADE, related_name='options')
    material_product = models.ForeignKey(
        'products.Product', on_delete=models.PROTECT, related_name='material_template_options',
    )
    spec_snapshot = models.JSONField(default=dict, blank=True)
    qty_per_unit = models.DecimalField(
        max_digits=18, decimal_places=4, default=Decimal('0'),
        validators=[MinValueValidator(Decimal('0'))],
    )
    waste_pct = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('0'),
        validators=[MinValueValidator(Decimal('0'))],
    )
    priority_no = models.IntegerField(default=0)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'product_material_options'
        ordering = ['group_id', 'priority_no', 'id']
        unique_together = [['group', 'material_product']]

    def __str__(self):
        return f"{self.group_id}:{self.material_product_id}"
