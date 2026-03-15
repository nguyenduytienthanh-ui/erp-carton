from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q
from unidecode import unidecode

from sales.document_policy import calc_line_totals, round_money


User = settings.AUTH_USER_MODEL


class SearchTextModelMixin(models.Model):
    search_text = models.TextField(default='', blank=True)

    class Meta:
        abstract = True

    def _search_values(self):
        return []

    def _build_search_text(self):
        combined = ' '.join(str(part).strip() for part in self._search_values() if part not in (None, ''))
        self.search_text = unidecode(combined).lower() if combined else ''

    def _merge_update_fields(self, update_fields):
        if update_fields is None:
            return None
        fields = set(update_fields)
        fields.add('search_text')
        return list(fields)


class Supplier(SearchTextModelMixin):
    code = models.CharField(max_length=30, unique=True, verbose_name='Mã NCC')
    name = models.CharField(max_length=200, verbose_name='Tên nhà cung cấp')
    company_name = models.CharField(max_length=200, blank=True, default='', verbose_name='Công ty')
    tax_code = models.CharField(max_length=50, blank=True, default='', verbose_name='Mã số thuế')
    phone = models.CharField(max_length=30, blank=True, default='', verbose_name='Điện thoại')
    email = models.EmailField(blank=True, default='', verbose_name='Email')
    address = models.TextField(blank=True, default='', verbose_name='Địa chỉ')
    contact_person = models.CharField(max_length=100, blank=True, default='', verbose_name='Người liên hệ')
    contact_phone = models.CharField(max_length=30, blank=True, default='', verbose_name='SĐT liên hệ')
    payment_terms_days = models.IntegerField(default=30, verbose_name='Hạn thanh toán (ngày)')
    is_preferred = models.BooleanField(default=False, verbose_name='NCC ưu tiên')
    rating = models.PositiveSmallIntegerField(
        default=3,
        validators=[MinValueValidator(1), MaxValueValidator(5)],
        verbose_name='Đánh giá',
    )
    note = models.TextField(blank=True, default='', verbose_name='Ghi chú')
    is_active = models.BooleanField(default=True, verbose_name='Đang dùng')
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchasing_suppliers_created',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchasing_suppliers_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'purchasing_suppliers'
        ordering = ['code']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['name']),
            models.Index(fields=['company_name']),
            models.Index(fields=['tax_code']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return f'{self.code} - {self.name}'

    def _search_values(self):
        return [
            self.code,
            self.name,
            self.company_name,
            self.tax_code,
            self.phone,
            self.email,
            self.address,
            self.contact_person,
            self.contact_phone,
            self.payment_terms_days,
            self.rating,
            'Ưu tiên' if self.is_preferred else 'Thông thường',
            'Đang dùng' if self.is_active else 'Ngừng dùng',
            self.note,
        ]

    def save(self, *args, **kwargs):
        if self.code:
            self.code = str(self.code).strip().upper()
        self._build_search_text()
        kwargs['update_fields'] = self._merge_update_fields(kwargs.get('update_fields'))
        super().save(*args, **kwargs)


class PurchaseOrderStatus:
    DRAFT = 'DRAFT'
    SUBMITTED = 'SUBMITTED'
    APPROVED = 'APPROVED'
    REJECTED = 'REJECTED'
    PARTIAL_RECEIVED = 'PARTIAL_RECEIVED'
    RECEIVED = 'RECEIVED'
    CANCELLED = 'CANCELLED'
    CHOICES = [
        (DRAFT, 'Nháp'),
        (SUBMITTED, 'Đã gửi duyệt'),
        (APPROVED, 'Đã duyệt'),
        (REJECTED, 'Từ chối'),
        (PARTIAL_RECEIVED, 'Nhập kho một phần'),
        (RECEIVED, 'Đã nhập đủ'),
        (CANCELLED, 'Đã hủy'),
    ]


class PurchaseOrder(SearchTextModelMixin):
    code = models.CharField(max_length=50, unique=True, db_index=True)
    doc_type = models.CharField(max_length=20, default='PO')
    order_date = models.DateField(db_index=True)
    expected_receipt_date = models.DateField(null=True, blank=True, db_index=True)
    status = models.CharField(
        max_length=30,
        choices=PurchaseOrderStatus.CHOICES,
        default=PurchaseOrderStatus.DRAFT,
        db_index=True,
    )
    reference = models.CharField(max_length=200, blank=True, default='')
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.PROTECT,
        related_name='purchase_orders',
    )
    supplier_snapshot = models.JSONField(default=dict, blank=True)
    warehouse = models.ForeignKey(
        'inventory.Warehouse',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='purchase_orders',
    )
    location = models.ForeignKey(
        'inventory.WarehouseLocation',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='purchase_orders',
    )
    currency = models.CharField(max_length=3, default='VND')
    exchange_rate = models.DecimalField(max_digits=18, decimal_places=6, default=Decimal('1'))
    payment_terms_days = models.IntegerField(default=30)
    subtotal = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    discount_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    tax_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    notes = models.TextField(blank=True, default='')
    submitted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_orders_submitted',
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_orders_approved',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    rejected_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_orders_rejected',
    )
    rejected_at = models.DateTimeField(null=True, blank=True)
    reject_reason = models.TextField(blank=True, default='')
    cancelled_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_orders_cancelled',
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.TextField(blank=True, default='')
    version = models.IntegerField(default=0)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_orders_created',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_orders_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    owner = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_orders_owned',
    )
    team = models.ForeignKey(
        'core.Team',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_orders',
    )

    class Meta:
        db_table = 'purchasing_purchase_orders'
        ordering = ['-order_date', '-id']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['order_date']),
            models.Index(fields=['expected_receipt_date']),
            models.Index(fields=['status']),
            models.Index(fields=['supplier']),
            models.Index(fields=['team']),
        ]

    def __str__(self):
        return f'{self.code} - {self.order_date}'

    def is_editable(self):
        return self.status in {PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.REJECTED}

    def _search_values(self):
        supplier_name = (
            self.supplier_snapshot.get('name')
            or self.supplier_snapshot.get('company_name')
            or getattr(self.supplier, 'name', '')
        )
        supplier_code = self.supplier_snapshot.get('code') or getattr(self.supplier, 'code', '')
        warehouse_name = getattr(getattr(self, 'warehouse', None), 'name', '')
        location_name = getattr(getattr(self, 'location', None), 'name', '')
        status_label = dict(PurchaseOrderStatus.CHOICES).get(self.status, self.status)
        line_tokens: list[str] = []
        if self.pk:
            line_tokens = [
                ' '.join(
                    str(value).strip()
                    for value in [
                        line.internal_product_code,
                        (line.product_snapshot or {}).get('name'),
                        line.uom,
                        line.qty,
                        line.unit_price,
                        line.received_qty,
                        line.note,
                    ]
                    if value not in (None, '')
                )
                for line in self.lines.all().order_by('line_number')
            ]
        return [
            self.code,
            self.reference,
            self.doc_type,
            self.order_date,
            self.expected_receipt_date,
            self.currency,
            self.exchange_rate,
            self.payment_terms_days,
            supplier_code,
            supplier_name,
            warehouse_name,
            location_name,
            self.subtotal,
            self.discount_total,
            self.tax_total,
            self.total,
            status_label,
            self.notes,
            *line_tokens,
        ]

    def save(self, *args, **kwargs):
        if self.code:
            self.code = str(self.code).strip().upper()
        self._build_search_text()
        kwargs['update_fields'] = self._merge_update_fields(kwargs.get('update_fields'))
        super().save(*args, **kwargs)

    def recalc_totals(self):
        agg = self.lines.aggregate(
            sub=models.Sum('line_subtotal'),
            disc=models.Sum('discount_amount'),
            tax=models.Sum('tax_amount'),
            total=models.Sum('line_total'),
        )
        self.subtotal = round_money(agg['sub'] or 0)
        self.discount_total = round_money(agg['disc'] or 0)
        self.tax_total = round_money(agg['tax'] or 0)
        self.total = round_money(agg['total'] or 0)
        self.save(update_fields=['subtotal', 'discount_total', 'tax_total', 'total', 'updated_at'])


class PurchaseOrderLine(models.Model):
    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.CASCADE,
        related_name='lines',
    )
    line_number = models.PositiveIntegerField()
    product = models.ForeignKey(
        'products.Product',
        on_delete=models.PROTECT,
        related_name='purchase_order_lines',
    )
    internal_product_code = models.CharField(max_length=50, blank=True, default='', db_index=True)
    product_snapshot = models.JSONField(default=dict, blank=True)
    uom = models.CharField(max_length=20, blank=True, default='')
    qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('1'))
    received_qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    unit_price = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0'))
    tax_pct = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0'))
    line_subtotal = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    discount_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    tax_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    line_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    note = models.CharField(max_length=255, blank=True, default='')

    class Meta:
        db_table = 'purchasing_purchase_order_lines'
        ordering = ['purchase_order_id', 'line_number']
        unique_together = [['purchase_order', 'line_number']]

    def __str__(self):
        return f'{self.purchase_order_id}#{self.line_number}'

    @property
    def remaining_qty(self):
        remaining = (self.qty or Decimal('0')) - (self.received_qty or Decimal('0'))
        return remaining if remaining > 0 else Decimal('0')

    def save(self, *args, **kwargs):
        if self.product_id:
            if not self.internal_product_code:
                self.internal_product_code = getattr(self.product, 'code', '') or ''
            if not self.uom:
                self.uom = getattr(getattr(self.product, 'unit', None), 'code', '') or ''
        line_sub, disc, tax, total = calc_line_totals(
            self.qty,
            self.unit_price,
            self.discount_pct,
            self.tax_pct,
        )
        self.line_subtotal = line_sub
        self.discount_amount = disc
        self.tax_amount = tax
        self.line_total = total
        super().save(*args, **kwargs)


class PurchaseReceiptStatus:
    POSTED = 'POSTED'
    CANCELLED = 'CANCELLED'
    CHOICES = [
        (POSTED, 'Đã ghi sổ'),
        (CANCELLED, 'Đã hủy'),
    ]


class PurchaseReceipt(SearchTextModelMixin):
    code = models.CharField(max_length=50, unique=True, db_index=True)
    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.PROTECT,
        related_name='receipts',
    )
    receipt_date = models.DateField(db_index=True)
    status = models.CharField(
        max_length=20,
        choices=PurchaseReceiptStatus.CHOICES,
        default=PurchaseReceiptStatus.POSTED,
        db_index=True,
    )
    reference = models.CharField(max_length=200, blank=True, default='')
    supplier_snapshot = models.JSONField(default=dict, blank=True)
    warehouse = models.ForeignKey(
        'inventory.Warehouse',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='purchase_receipts',
    )
    location = models.ForeignKey(
        'inventory.WarehouseLocation',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='purchase_receipts',
    )
    total_qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    total_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    note = models.TextField(blank=True, default='')
    posted_at = models.DateTimeField(auto_now_add=True)
    posted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_receipts_posted',
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_receipts_cancelled',
    )
    cancel_reason = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_receipts_created',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_receipts_updated',
    )

    class Meta:
        db_table = 'purchasing_purchase_receipts'
        ordering = ['-receipt_date', '-id']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['receipt_date']),
            models.Index(fields=['status']),
            models.Index(fields=['purchase_order']),
        ]

    def __str__(self):
        return f'{self.code} - {self.receipt_date}'

    def _search_values(self):
        supplier_name = self.supplier_snapshot.get('name') or self.supplier_snapshot.get('company_name')
        supplier_code = self.supplier_snapshot.get('code')
        warehouse_name = getattr(getattr(self, 'warehouse', None), 'name', '')
        location_name = getattr(getattr(self, 'location', None), 'name', '')
        status_label = dict(PurchaseReceiptStatus.CHOICES).get(self.status, self.status)
        line_tokens: list[str] = []
        if self.pk:
            line_tokens = [
                ' '.join(
                    str(value).strip()
                    for value in [
                        (line.product_snapshot or {}).get('code'),
                        (line.product_snapshot or {}).get('name'),
                        line.quantity,
                        line.unit_cost,
                        line.note,
                    ]
                    if value not in (None, '')
                )
                for line in self.lines.all().order_by('line_number')
            ]
        return [
            self.code,
            self.purchase_order.code if self.purchase_order_id else '',
            self.receipt_date,
            supplier_code,
            supplier_name,
            warehouse_name,
            location_name,
            self.reference,
            self.total_qty,
            self.total_amount,
            status_label,
            self.note,
            *line_tokens,
        ]

    def save(self, *args, **kwargs):
        if self.code:
            self.code = str(self.code).strip().upper()
        self._build_search_text()
        kwargs['update_fields'] = self._merge_update_fields(kwargs.get('update_fields'))
        super().save(*args, **kwargs)

    def recalc_totals(self):
        agg = self.lines.aggregate(
            qty=models.Sum('quantity'),
            amount=models.Sum('line_total'),
        )
        self.total_qty = agg['qty'] or Decimal('0')
        self.total_amount = round_money(agg['amount'] or 0)
        self.save(update_fields=['total_qty', 'total_amount', 'updated_at'])


class PurchaseReceiptLine(models.Model):
    receipt = models.ForeignKey(
        PurchaseReceipt,
        on_delete=models.CASCADE,
        related_name='lines',
    )
    line_number = models.PositiveIntegerField()
    purchase_order_line = models.ForeignKey(
        PurchaseOrderLine,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='receipt_lines',
    )
    product = models.ForeignKey(
        'products.Product',
        on_delete=models.PROTECT,
        related_name='purchase_receipt_lines',
    )
    product_snapshot = models.JSONField(default=dict, blank=True)
    quantity = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    unit_cost = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    line_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    note = models.CharField(max_length=255, blank=True, default='')
    inventory_transaction = models.ForeignKey(
        'inventory.InventoryTransaction',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_receipt_lines',
    )

    class Meta:
        db_table = 'purchasing_purchase_receipt_lines'
        ordering = ['receipt_id', 'line_number']
        unique_together = [['receipt', 'line_number']]
        indexes = [
            models.Index(fields=['receipt', 'line_number']),
            models.Index(fields=['product']),
        ]

    def __str__(self):
        return f'{self.receipt_id}#{self.line_number}'

    def save(self, *args, **kwargs):
        self.line_total = round_money((self.quantity or Decimal('0')) * (self.unit_cost or Decimal('0')))
        super().save(*args, **kwargs)


class MaterialPurchasePrice(models.Model):
    """Bảng giá nguyên vật liệu / hàng mua (giá mua theo NCC, theo thời hạn)"""
    product = models.ForeignKey(
        'products.Product',
        on_delete=models.CASCADE,
        related_name='material_purchase_prices',
    )
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='material_purchase_prices',
        help_text='Null = giá chuẩn chung',
    )
    unit_price = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        default=Decimal('0'),
        validators=[MinValueValidator(Decimal('0'))],
    )
    currency = models.CharField(max_length=3, default='VND')
    uom = models.CharField(max_length=20, blank=True, default='')
    effective_from = models.DateField(db_index=True)
    effective_to = models.DateField(null=True, blank=True, db_index=True)
    min_quantity = models.DecimalField(
        max_digits=18,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    note = models.CharField(max_length=255, blank=True, default='')
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='material_purchase_prices_created',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='material_purchase_prices_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'purchasing_material_purchase_prices'
        ordering = ['-effective_from', 'product', 'supplier']
        verbose_name = 'Bảng giá NVL'
        verbose_name_plural = 'Bảng giá nguyên vật liệu'
        indexes = [
            models.Index(fields=['product']),
            models.Index(fields=['supplier']),
            models.Index(fields=['effective_from', 'effective_to']),
        ]

    def __str__(self):
        product_code = getattr(self.product, 'code', self.product_id)
        supplier_code = getattr(self.supplier, 'code', '') if self.supplier_id else 'Chung'
        return f'{product_code} @ {supplier_code} = {self.unit_price}'


class PurchaseRequestSequence(models.Model):
    """Sequence mã yêu cầu mua PR-YYYYMM-NNNNN."""
    period = models.CharField(max_length=6, unique=True, db_index=True)  # YYYYMM
    current_number = models.IntegerField(default=0)
    padding = models.IntegerField(default=5)

    class Meta:
        db_table = 'purchasing_request_sequences'
        verbose_name = 'PR Sequence'
        verbose_name_plural = 'PR Sequences'

    def get_next_code(self):
        from django.db import transaction
        with transaction.atomic():
            seq = PurchaseRequestSequence.objects.select_for_update().get(pk=self.pk)
            seq.current_number += 1
            seq.save()
            n = str(seq.current_number).zfill(seq.padding)
            return f"PR-{seq.period}-{n}"


class PurchaseRequestStatus:
    DRAFT = 'DRAFT'
    SUBMITTED = 'SUBMITTED'
    APPROVED = 'APPROVED'
    REJECTED = 'REJECTED'
    CHOICES = [
        (DRAFT, 'Nháp'),
        (SUBMITTED, 'Đã gửi'),
        (APPROVED, 'Đã duyệt'),
        (REJECTED, 'Từ chối'),
    ]


class PurchaseRequest(models.Model):
    """Yêu cầu mua (Purchase Request)."""
    code = models.CharField(max_length=50, unique=True, db_index=True)
    request_date = models.DateField(db_index=True)
    status = models.CharField(
        max_length=20,
        choices=PurchaseRequestStatus.CHOICES,
        default=PurchaseRequestStatus.DRAFT,
        db_index=True,
    )
    reference = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)
    requested_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_requests_requested',
    )
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_requests_approved',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    rejected_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_requests_rejected',
    )
    rejected_at = models.DateTimeField(null=True, blank=True)
    reject_reason = models.TextField(blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_requests_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_requests_updated',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'purchasing_requests'
        ordering = ['-request_date', '-id']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['request_date']),
            models.Index(fields=['status']),
        ]
        verbose_name = 'Purchase Request'
        verbose_name_plural = 'Purchase Requests'

    def __str__(self):
        return f"{self.code} - {self.request_date}"


class PurchaseRequestLine(models.Model):
    """Dòng yêu cầu mua."""
    purchase_request = models.ForeignKey(
        PurchaseRequest,
        on_delete=models.CASCADE,
        related_name='lines',
    )
    line_number = models.PositiveIntegerField()
    product = models.ForeignKey(
        'products.Product',
        on_delete=models.PROTECT,
        related_name='purchase_request_lines',
    )
    qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('1'))
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = 'purchasing_request_lines'
        ordering = ['purchase_request_id', 'line_number']
        unique_together = [['purchase_request', 'line_number']]
        verbose_name = 'Purchase Request Line'
        verbose_name_plural = 'Purchase Request Lines'

    def __str__(self):
        return f"{self.purchase_request.code}-L{self.line_number}"


class PurchaseReturnStatus:
    """Purchase Return statuses."""
    DRAFT = 'DRAFT'
    SUBMITTED = 'SUBMITTED'
    APPROVED = 'APPROVED'
    POSTED = 'POSTED'
    CANCELLED = 'CANCELLED'
    CHOICES = [
        (DRAFT, 'Nháp'),
        (SUBMITTED, 'Chờ duyệt'),
        (APPROVED, 'Đã duyệt'),
        (POSTED, 'Đã vào sổ'),
        (CANCELLED, 'Đã hủy'),
    ]


class PurchaseReturn(SearchTextModelMixin):
    """Purchase Return to Supplier - trả hàng cho nhà cung cấp."""
    code = models.CharField(max_length=50, unique=True, db_index=True)
    return_date = models.DateField()
    status = models.CharField(
        max_length=20,
        choices=PurchaseReturnStatus.CHOICES,
        default=PurchaseReturnStatus.DRAFT,
        db_index=True,
    )
    
    # Reference
    reference = models.CharField(max_length=200, blank=True)
    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='returns',
    )
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.PROTECT,
        related_name='purchase_returns',
    )
    
    # Amounts
    subtotal = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    tax_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    
    # Return reason
    return_reason = models.CharField(
        max_length=20,
        choices=[
            ('DEFECT', 'Lỗi'),
            ('WRONG_QTY', 'Sai số lượng'),
            ('WRONG_ITEM', 'Sai hàng'),
            ('DAMAGE', 'Hỏng hóc'),
            ('OTHER', 'Khác'),
        ],
        default='OTHER',
    )
    return_notes = models.TextField(blank=True)
    
    # Approval
    submitted_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='purchase_returns_submitted',
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='purchase_returns_approved',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    
    # Posting
    posted_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='purchase_returns_posted',
    )
    posted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    
    # Cancellation
    cancelled_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='purchase_returns_cancelled',
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.TextField(blank=True)
    
    # Audit
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='purchase_returns_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='purchase_returns_updated',
    )
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'purchasing_returns'
        ordering = ['-return_date', '-id']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['return_date']),
            models.Index(fields=['status']),
            models.Index(fields=['supplier']),
        ]
        verbose_name = 'Purchase Return'
        verbose_name_plural = 'Purchase Returns'

    def __str__(self):
        return f"{self.code} - {self.return_date}"

    def _search_values(self):
        return [self.code, self.reference, self.supplier.name if self.supplier else '']


class PurchaseReturnLine(models.Model):
    """Dòng trả hàng nhà cung cấp."""
    purchase_return = models.ForeignKey(
        PurchaseReturn,
        on_delete=models.CASCADE,
        related_name='lines',
    )
    line_number = models.PositiveSmallIntegerField(default=1)
    
    # Product
    product = models.ForeignKey(
        'products.Product',
        on_delete=models.SET_NULL,
        null=True,
        related_name='purchase_return_lines',
    )
    qty = models.DecimalField(max_digits=15, decimal_places=4, validators=[MinValueValidator(Decimal('0.0001'))])
    unit_price = models.DecimalField(max_digits=18, decimal_places=2)
    tax_pct = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0'), validators=[MinValueValidator(0), MaxValueValidator(100)])
    
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = 'purchasing_return_lines'
        ordering = ['purchase_return_id', 'line_number']
        unique_together = [['purchase_return', 'line_number']]
        verbose_name = 'Purchase Return Line'
        verbose_name_plural = 'Purchase Return Lines'

    def __str__(self):
        return f"{self.purchase_return.code}-L{self.line_number}"

