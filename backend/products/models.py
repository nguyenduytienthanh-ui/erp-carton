from django.db import models
from django.contrib.auth import get_user_model
from django.core.validators import MinValueValidator

User = get_user_model()


class ProductCategory(models.Model):
    """Danh mục sản phẩm - Phân loại sản phẩm theo cấu trúc cây"""
    
    code = models.CharField(max_length=20, unique=True, help_text="Mã danh mục")
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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['code']
        verbose_name = 'Product Category'
        verbose_name_plural = 'Product Categories'
    
    def __str__(self):
        return f"{self.code} - {self.name}"


class ProductUnit(models.Model):
    """Đơn vị tính của sản phẩm"""
    
    code = models.CharField(max_length=10, unique=True, help_text="Mã đơn vị (CAI, HOP, KIEN)")
    name = models.CharField(max_length=100, help_text="Tên đơn vị (Cái, Hộp, Kiện)")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['code']
        verbose_name = 'Product Unit'
        verbose_name_plural = 'Product Units'
    
    def __str__(self):
        return f"{self.code} - {self.name}"


class ProductWave(models.Model):
    """Loại sóng: A, B, C, E, BC, BE, EB..."""
    code = models.CharField(max_length=10, unique=True, verbose_name="Mã sóng")
    name = models.CharField(max_length=50, verbose_name="Tên sóng")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    is_active = models.BooleanField(default=True, verbose_name="Đang sử dụng")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'product_waves'
        verbose_name = 'Loại sóng'
        verbose_name_plural = 'Loại sóng'
        ordering = ['code']

    def __str__(self):
        return f"{self.code} - {self.name}"


class ProductBoxType(models.Model):
    """Kiểu thùng: A1, A2, A3, A5, B1, B2, C1..."""
    code = models.CharField(max_length=10, unique=True, verbose_name="Mã kiểu")
    name = models.CharField(max_length=50, verbose_name="Tên kiểu")
    description = models.TextField(blank=True, verbose_name="Mô tả")
    is_active = models.BooleanField(default=True, verbose_name="Đang sử dụng")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'product_box_types'
        verbose_name = 'Kiểu thùng'
        verbose_name_plural = 'Kiểu thùng'
        ordering = ['code']

    def __str__(self):
        return f"{self.code} - {self.name}"


class Product(models.Model):
    """Model sản phẩm thùng carton với đầy đủ thông tin sản xuất"""

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

    # ============ KÍCH THƯỚC ============
    size_order = models.CharField(max_length=50, blank=True, verbose_name="Kích thước ĐH")
    size_production = models.CharField(max_length=50, blank=True, verbose_name="KTSX")
    wave = models.ForeignKey(
        ProductWave,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='products',
        verbose_name="Sóng"
    )
    box_type = models.ForeignKey(
        ProductBoxType,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='products',
        verbose_name="Kiểu"
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
        ]

    def __str__(self):
        return f"{self.code} - {self.name}"

    def save(self, *args, **kwargs):
        if not self.size_production and self.size_order:
            self.size_production = self.size_order
        super().save(*args, **kwargs)

    @property
    def is_component(self):
        """Kiểm tra có phải là thùng con/lót/khay không"""
        return self.parent is not None

    @property
    def full_name(self):
        """Tên đầy đủ với kích thước"""
        parts = [self.name]
        if self.size_order:
            parts.append(f"({self.size_order})")
        if self.wave:
            parts.append(f"- {self.wave.code}")
        return " ".join(parts)
