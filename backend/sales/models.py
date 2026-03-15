"""
Chứng từ mẫu: SalesOrder (Header + Lines).
Chuẩn Document: code theo kỳ, status workflow, snapshot khi Posted, version (optimistic lock),
approval/posting/void fields, permission theo action+status.
"""
from decimal import Decimal
from django.db import models
from django.db.models import Q
from django.conf import settings
from django.utils import timezone

from sales.document_policy import round_money, calc_line_totals

User = settings.AUTH_USER_MODEL


class PeriodSequence(models.Model):
    """
    NumberSequence theo doc_type + kỳ (YYYYMM).
    Ví dụ: SO-202602-00015. Mỗi (doc_type, period) một sequence.
    """
    doc_type = models.CharField(max_length=20, help_text="SO, INV, PO...")
    period = models.CharField(max_length=6, help_text="YYYYMM")
    current_number = models.IntegerField(default=0)
    padding = models.IntegerField(default=5, help_text="Số chữ số (5 = 00015)")

    class Meta:
        db_table = 'sales_period_sequences'
        unique_together = [['doc_type', 'period']]
        verbose_name = 'Period Sequence'
        verbose_name_plural = 'Period Sequences'

    def get_next_code(self):
        from django.db import transaction
        with transaction.atomic():
            seq = PeriodSequence.objects.select_for_update().get(pk=self.pk)
            seq.current_number += 1
            seq.save()
            n = str(seq.current_number).zfill(seq.padding)
            return f"{seq.doc_type}-{seq.period}-{n}"


# Trạng thái chứng từ (khớp WorkflowDefinition SalesOrder)
class SalesOrderStatus:
    DRAFT = 'DRAFT'
    SUBMITTED = 'SUBMITTED'
    APPROVED = 'APPROVED'
    REJECTED = 'REJECTED'
    POSTED = 'POSTED'
    VOID = 'VOID'
    CHOICES = [
        (DRAFT, 'Nháp'),
        (SUBMITTED, 'Đã gửi'),
        (APPROVED, 'Đã duyệt'),
        (REJECTED, 'Từ chối'),
        (POSTED, 'Đã vào sổ'),
        (VOID, 'Hủy'),
    ]


class SalesOrder(models.Model):
    """
    Header chứng từ Đơn bán hàng (Document chuẩn).
    """
    # Identity & period
    code = models.CharField(max_length=50, unique=True, db_index=True)
    doc_type = models.CharField(max_length=20, default='SO')
    order_date = models.DateField()
    delivery_date = models.DateField(null=True, blank=True, db_index=True)
    status = models.CharField(
        max_length=20,
        choices=SalesOrderStatus.CHOICES,
        default=SalesOrderStatus.DRAFT,
        db_index=True,
    )
    # Reference (link chứng từ liên quan)
    reference = models.CharField(max_length=200, blank=True)
    # Customer
    customer = models.ForeignKey(
        'core.Customer',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='sales_orders',
    )
    # Currency
    currency = models.CharField(max_length=3, default='VND')
    exchange_rate = models.DecimalField(
        max_digits=18, decimal_places=6, default=Decimal('1'),
    )
    # Amounts (tính từ lines + money policy)
    subtotal = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal('0'),
    )
    discount_total = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal('0'),
    )
    tax_total = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal('0'),
    )
    total = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal('0'),
    )
    notes = models.TextField(blank=True)

    # Approval
    submitted_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='sales_orders_submitted',
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='sales_orders_approved',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    rejected_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='sales_orders_rejected',
    )
    rejected_at = models.DateTimeField(null=True, blank=True)
    reject_reason = models.TextField(blank=True)

    # Confirmation (xác nhận đơn hàng với khách hàng)
    confirmed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='sales_orders_confirmed',
    )
    confirmed_at = models.DateTimeField(null=True, blank=True, db_index=True)

    # Posting
    posted_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='sales_orders_posted',
    )
    posted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    post_number = models.CharField(max_length=50, blank=True, db_index=True)

    # Void
    voided_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='sales_orders_voided',
    )
    voided_at = models.DateTimeField(null=True, blank=True)
    void_reason = models.TextField(blank=True)

    # Snapshot khi Posted (customer/product/price...) để master đổi không ảnh hưởng chứng từ cũ
    posted_snapshot = models.JSONField(
        default=dict,
        blank=True,
        help_text="Snapshot customer + lines at post time",
    )

    # Concurrency
    version = models.IntegerField(default=0)

    # Audit & scope
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='sales_orders_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='sales_orders_updated',
    )
    updated_at = models.DateTimeField(auto_now=True)
    owner = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='sales_orders_owned',
    )
    team = models.ForeignKey(
        'core.Team', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='sales_orders',
    )

    # Reversal: nếu void sau khi đã post → có thể tạo chứng từ đảo
    reversal_of = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='reversals',
    )

    class Meta:
        db_table = 'sales_orders'
        ordering = ['-order_date', '-id']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['order_date']),
            models.Index(fields=['delivery_date']),
            models.Index(fields=['status']),
            models.Index(fields=['team']),
            models.Index(fields=['posted_at']),
            models.Index(fields=['post_number']),
        ]
        verbose_name = 'Sales Order'
        verbose_name_plural = 'Sales Orders'

    def __str__(self):
        return f"{self.code} - {self.order_date}"

    def recalc_totals(self):
        """Tính lại subtotal/discount_total/tax_total/total từ lines (money policy)."""
        from django.db.models import Sum
        agg = self.lines.aggregate(
            sub=Sum('line_subtotal'),
            disc=Sum('discount_amount'),
            tax=Sum('tax_amount'),
            total=Sum('line_total'),
        )
        self.subtotal = round_money(agg['sub'] or 0)
        self.discount_total = round_money(agg['disc'] or 0)
        self.tax_total = round_money(agg['tax'] or 0)
        self.total = round_money(agg['total'] or 0)
        self.save(update_fields=['subtotal', 'discount_total', 'tax_total', 'total', 'updated_at'])

    def is_editable(self):
        return self.status == SalesOrderStatus.DRAFT

    def is_posted(self):
        return self.posted_at is not None


class SalesOrderLine(models.Model):
    """Line chứng từ: product, qty, price, discount, tax, line_total."""
    sales_order = models.ForeignKey(
        SalesOrder, on_delete=models.CASCADE, related_name='lines',
    )
    line_number = models.PositiveIntegerField()
    product = models.ForeignKey(
        'products.Product',
        on_delete=models.PROTECT,
        related_name='sales_order_lines',
    )
    internal_product_code = models.CharField(max_length=50, blank=True, db_index=True)
    trace_code = models.CharField(max_length=150, blank=True, db_index=True)
    product_snapshot = models.JSONField(default=dict, blank=True)
    uom = models.CharField(max_length=20, blank=True)
    qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('1'))
    unit_price = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0'))
    tax_pct = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0'))
    line_subtotal = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    discount_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    tax_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    line_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    note = models.CharField(max_length=200, blank=True)

    class Meta:
        db_table = 'sales_order_lines'
        unique_together = [['sales_order', 'line_number']]
        ordering = ['sales_order', 'line_number']
        verbose_name = 'Sales Order Line'
        verbose_name_plural = 'Sales Order Lines'

    def __str__(self):
        return f"{self.sales_order_id}#{self.line_number}"

    def save(self, *args, **kwargs):
        if self.product_id:
            from sales.services import build_sales_order_line_product_snapshot, build_sales_order_line_trace_code

            if not self.internal_product_code:
                self.internal_product_code = getattr(self.product, 'code', '') or ''
            if not self.product_snapshot:
                as_of_datetime = getattr(self.sales_order, 'order_date', None) if self.sales_order_id else None
                self.product_snapshot = build_sales_order_line_product_snapshot(
                    self.product,
                    as_of_datetime=as_of_datetime,
                )
            if self.sales_order_id and not self.trace_code:
                self.trace_code = build_sales_order_line_trace_code(self.sales_order, self.product, self.line_number)
            if not self.uom:
                self.uom = getattr(getattr(self.product, 'unit', None), 'code', None) or self.uom
        line_sub, disc, tax, total = calc_line_totals(
            self.qty, self.unit_price, self.discount_pct, self.tax_pct,
        )
        self.line_subtotal = line_sub
        self.discount_amount = disc
        self.tax_amount = tax
        self.line_total = total
        super().save(*args, **kwargs)

    @property
    def planned_qty_total(self):
        from django.db.models import Sum
        agg = self.delivery_plans.aggregate(v=Sum('qty'))
        return agg['v'] or Decimal('0')

    @property
    def unplanned_qty(self):
        remaining = (self.qty or Decimal('0')) - self.planned_qty_total
        return remaining if remaining > 0 else Decimal('0')


class SalesOrderDeliveryPlan(models.Model):
    """
    Kế hoạch giao hàng theo từng dòng hàng.
    - Một mã hàng có thể giao nhiều ngày khác nhau.
    - Một mã hàng có thể tách nhiều lần theo số lượng.
    """
    line = models.ForeignKey(
        SalesOrderLine,
        on_delete=models.CASCADE,
        related_name='delivery_plans',
    )
    delivery_date = models.DateField(db_index=True)
    qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    shipped_qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    delivered_qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'sales_order_delivery_plans'
        ordering = ['delivery_date', 'id']
        indexes = [
            models.Index(fields=['delivery_date']),
            models.Index(fields=['line', 'delivery_date']),
        ]
        verbose_name = 'Sales Order Delivery Plan'
        verbose_name_plural = 'Sales Order Delivery Plans'

    def __str__(self):
        return f"{self.line.sales_order.code}#{self.line.line_number} {self.delivery_date} qty={self.qty}"

    @property
    def remaining_shipment_qty(self):
        remain = (self.qty or Decimal('0')) - (self.shipped_qty or Decimal('0'))
        return remain if remain > 0 else Decimal('0')

    @property
    def remaining_qty(self):
        remain = (self.qty or Decimal('0')) - (self.delivered_qty or Decimal('0'))
        return remain if remain > 0 else Decimal('0')

    @property
    def is_completed(self):
        return self.remaining_qty <= 0


# Posting log: ghi lại mỗi lần post (idempotent check bằng post_number / posted_at)
class SalesOrderPostingLog(models.Model):
    """Log mỗi lần post để idempotent + audit."""
    sales_order = models.ForeignKey(
        SalesOrder, on_delete=models.CASCADE, related_name='posting_logs',
    )
    posted_at = models.DateTimeField(auto_now_add=True)
    posted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    post_number = models.CharField(max_length=50, db_index=True)
    snapshot_saved = models.BooleanField(default=True)

    class Meta:
        db_table = 'sales_order_posting_logs'
        ordering = ['-posted_at']
        verbose_name = 'Sales Order Posting Log'
        verbose_name_plural = 'Sales Order Posting Logs'


class QuoteStatus:
    DRAFT = 'DRAFT'
    SENT = 'SENT'
    ACCEPTED = 'ACCEPTED'
    REJECTED = 'REJECTED'
    EXPIRED = 'EXPIRED'
    CHOICES = [
        (DRAFT, 'Nháp'),
        (SENT, 'Đã gửi'),
        (ACCEPTED, 'Khách chấp nhận'),
        (REJECTED, 'Từ chối'),
        (EXPIRED, 'Hết hạn'),
    ]


class Quote(models.Model):
    """Báo giá (Quote) – chứng từ trước đơn hàng."""
    code = models.CharField(max_length=50, unique=True, db_index=True)
    quote_date = models.DateField(db_index=True)
    valid_until = models.DateField(null=True, blank=True, db_index=True)
    status = models.CharField(
        max_length=20,
        choices=QuoteStatus.CHOICES,
        default=QuoteStatus.DRAFT,
        db_index=True,
    )
    reference = models.CharField(max_length=200, blank=True)
    customer = models.ForeignKey(
        'core.Customer',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='quotes',
    )
    currency = models.CharField(max_length=3, default='VND')
    subtotal = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    discount_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    tax_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name='quotes_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name='quotes_updated',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'sales_quotes'
        ordering = ['-quote_date', '-id']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['quote_date']),
            models.Index(fields=['valid_until']),
            models.Index(fields=['status']),
        ]
        verbose_name = 'Quote'
        verbose_name_plural = 'Quotes'

    def __str__(self):
        return f"{self.code} - {self.quote_date}"

    def recalc_totals(self):
        from django.db.models import Sum
        agg = self.lines.aggregate(
            sub=Sum('line_subtotal'),
            disc=Sum('discount_amount'),
            tax=Sum('tax_amount'),
            total=Sum('line_total'),
        )
        self.subtotal = round_money(agg['sub'] or 0)
        self.discount_total = round_money(agg['disc'] or 0)
        self.tax_total = round_money(agg['tax'] or 0)
        self.total = round_money(agg['total'] or 0)
        self.save(update_fields=['subtotal', 'discount_total', 'tax_total', 'total', 'updated_at'])


class QuoteLine(models.Model):
    """Dòng báo giá."""
    quote = models.ForeignKey(Quote, on_delete=models.CASCADE, related_name='lines')
    line_number = models.PositiveIntegerField()
    product = models.ForeignKey(
        'products.Product',
        on_delete=models.PROTECT,
        related_name='quote_lines',
    )
    qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('1'))
    unit_price = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0'))
    tax_pct = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0'))
    line_subtotal = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    discount_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    tax_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    line_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = 'sales_quote_lines'
        ordering = ['quote_id', 'line_number']
        unique_together = [['quote', 'line_number']]
        verbose_name = 'Quote Line'
        verbose_name_plural = 'Quote Lines'

    def __str__(self):
        return f"{self.quote.code}-L{self.line_number}"
