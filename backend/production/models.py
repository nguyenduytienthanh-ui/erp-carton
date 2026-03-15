from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from unidecode import unidecode

from sales.document_policy import round_money, round_qty


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


class ProductionOrderStatus:
    DRAFT = 'DRAFT'
    SUBMITTED = 'SUBMITTED'
    APPROVED = 'APPROVED'
    REJECTED = 'REJECTED'
    RELEASED = 'RELEASED'
    IN_PROGRESS = 'IN_PROGRESS'
    COMPLETED = 'COMPLETED'
    CANCELLED = 'CANCELLED'
    CHOICES = [
        (DRAFT, 'Nháp'),
        (SUBMITTED, 'Đã gửi duyệt'),
        (APPROVED, 'Đã duyệt'),
        (REJECTED, 'Từ chối'),
        (RELEASED, 'Đã phát lệnh'),
        (IN_PROGRESS, 'Đang sản xuất'),
        (COMPLETED, 'Hoàn thành'),
        (CANCELLED, 'Đã hủy'),
    ]


class ProductionOperationStatus:
    PENDING = 'PENDING'
    READY = 'READY'
    IN_PROGRESS = 'IN_PROGRESS'
    DONE = 'DONE'
    SKIPPED = 'SKIPPED'
    CHOICES = [
        (PENDING, 'Chưa sẵn sàng'),
        (READY, 'Sẵn sàng'),
        (IN_PROGRESS, 'Đang làm'),
        (DONE, 'Hoàn thành'),
        (SKIPPED, 'Bỏ qua'),
    ]


class ProductionIssueStatus:
    POSTED = 'POSTED'
    CANCELLED = 'CANCELLED'
    CHOICES = [
        (POSTED, 'Đã ghi sổ'),
        (CANCELLED, 'Đã hủy'),
    ]


class ProductionReceiptStatus:
    POSTED = 'POSTED'
    CANCELLED = 'CANCELLED'
    CHOICES = [
        (POSTED, 'Đã ghi sổ'),
        (CANCELLED, 'Đã hủy'),
    ]


class ProductionOrder(SearchTextModelMixin):
    code = models.CharField(max_length=50, unique=True, db_index=True)
    doc_type = models.CharField(max_length=20, default='MO')
    order_date = models.DateField(db_index=True)
    planned_start_date = models.DateField(null=True, blank=True, db_index=True)
    planned_end_date = models.DateField(null=True, blank=True, db_index=True)
    status = models.CharField(
        max_length=30,
        choices=ProductionOrderStatus.CHOICES,
        default=ProductionOrderStatus.DRAFT,
        db_index=True,
    )
    reference = models.CharField(max_length=200, blank=True, default='')
    sales_order = models.ForeignKey(
        'sales.SalesOrder',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_orders',
    )
    sales_order_line = models.ForeignKey(
        'sales.SalesOrderLine',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_orders',
    )
    product = models.ForeignKey(
        'products.Product',
        on_delete=models.PROTECT,
        related_name='production_orders',
    )
    product_snapshot = models.JSONField(default=dict, blank=True)
    planned_qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('1'))
    produced_qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    scrap_qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    unit_cost_estimate = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    estimated_output_value = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    target_warehouse = models.ForeignKey(
        'inventory.Warehouse',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='production_output_orders',
    )
    target_location = models.ForeignKey(
        'inventory.WarehouseLocation',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='production_output_orders',
    )
    notes = models.TextField(blank=True, default='')
    submitted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_orders_submitted',
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_orders_approved',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    rejected_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_orders_rejected',
    )
    rejected_at = models.DateTimeField(null=True, blank=True)
    reject_reason = models.TextField(blank=True, default='')
    released_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_orders_released',
    )
    released_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_orders_completed',
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_orders_cancelled',
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.TextField(blank=True, default='')
    version = models.IntegerField(default=0)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_orders_created',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_orders_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    owner = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_orders_owned',
    )
    team = models.ForeignKey(
        'core.Team',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_orders',
    )

    class Meta:
        db_table = 'production_orders'
        ordering = ['-order_date', '-id']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['order_date']),
            models.Index(fields=['planned_start_date']),
            models.Index(fields=['planned_end_date']),
            models.Index(fields=['status']),
            models.Index(fields=['product']),
            models.Index(fields=['sales_order']),
            models.Index(fields=['team']),
        ]

    def __str__(self):
        return f'{self.code} - {self.order_date}'

    @property
    def remaining_qty(self):
        remaining = Decimal(str(self.planned_qty or 0)) - Decimal(str(self.produced_qty or 0))
        return round_qty(remaining if remaining > 0 else Decimal('0'))

    def is_editable(self):
        return self.status in {ProductionOrderStatus.DRAFT, ProductionOrderStatus.REJECTED}

    def _search_values(self):
        sales_order_code = getattr(getattr(self, 'sales_order', None), 'code', '')
        sales_line_number = getattr(getattr(self, 'sales_order_line', None), 'line_number', '')
        product_code = self.product_snapshot.get('code') or getattr(getattr(self, 'product', None), 'code', '')
        product_name = self.product_snapshot.get('name') or getattr(getattr(self, 'product', None), 'name', '')
        warehouse_name = getattr(getattr(self, 'target_warehouse', None), 'name', '')
        location_name = getattr(getattr(self, 'target_location', None), 'name', '')
        status_label = dict(ProductionOrderStatus.CHOICES).get(self.status, self.status)
        operation_tokens = []
        if self.pk:
            operation_tokens = [
                ' '.join(
                    str(value).strip()
                    for value in [op.sequence, op.step_code, op.step_name, op.rate_per_hour, op.status, op.note]
                    if value not in (None, '')
                )
                for op in self.operations.all().order_by('sequence')
            ]
        return [
            self.code,
            self.reference,
            self.order_date,
            self.planned_start_date,
            self.planned_end_date,
            sales_order_code,
            sales_line_number,
            product_code,
            product_name,
            self.planned_qty,
            self.produced_qty,
            self.scrap_qty,
            self.unit_cost_estimate,
            self.estimated_output_value,
            warehouse_name,
            location_name,
            status_label,
            self.notes,
            *operation_tokens,
        ]

    def save(self, *args, **kwargs):
        self.estimated_output_value = round_money(Decimal(str(self.planned_qty or 0)) * Decimal(str(self.unit_cost_estimate or 0)))
        self._build_search_text()
        kwargs['update_fields'] = self._merge_update_fields(kwargs.get('update_fields'))
        super().save(*args, **kwargs)


class ProductionOperation(models.Model):
    production_order = models.ForeignKey(
        ProductionOrder,
        on_delete=models.CASCADE,
        related_name='operations',
    )
    sequence = models.PositiveIntegerField()
    step_code = models.CharField(max_length=30)
    step_name = models.CharField(max_length=100)
    source_field = models.CharField(max_length=50, blank=True, default='')
    rate_per_hour = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    planned_qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    completed_qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    scrap_qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    status = models.CharField(
        max_length=20,
        choices=ProductionOperationStatus.CHOICES,
        default=ProductionOperationStatus.PENDING,
    )
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'production_operations'
        ordering = ['production_order_id', 'sequence']
        unique_together = [['production_order', 'sequence']]

    def __str__(self):
        return f'{self.production_order_id}#{self.sequence}-{self.step_code}'


class ProductionMaterialRequirement(models.Model):
    production_order = models.ForeignKey(
        ProductionOrder,
        on_delete=models.CASCADE,
        related_name='material_requirements',
    )
    line_number = models.PositiveIntegerField()
    material_product = models.ForeignKey(
        'products.Product',
        on_delete=models.PROTECT,
        related_name='production_material_requirements',
    )
    internal_product_code = models.CharField(max_length=50, blank=True, default='', db_index=True)
    product_snapshot = models.JSONField(default=dict, blank=True)
    required_qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    issued_qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    source_warehouse = models.ForeignKey(
        'inventory.Warehouse',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='production_material_requirements',
    )
    source_location = models.ForeignKey(
        'inventory.WarehouseLocation',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='production_material_requirements',
    )
    note = models.CharField(max_length=255, blank=True, default='')

    class Meta:
        db_table = 'production_material_requirements'
        ordering = ['production_order_id', 'line_number']
        unique_together = [['production_order', 'line_number']]

    def __str__(self):
        return f'{self.production_order_id}#{self.line_number}'

    @property
    def remaining_issue_qty(self):
        remaining = Decimal(str(self.required_qty or 0)) - Decimal(str(self.issued_qty or 0))
        return round_qty(remaining if remaining > 0 else Decimal('0'))


class ProductionIssue(SearchTextModelMixin):
    code = models.CharField(max_length=50, unique=True, db_index=True)
    production_order = models.ForeignKey(
        ProductionOrder,
        on_delete=models.PROTECT,
        related_name='issues',
    )
    issue_date = models.DateField(db_index=True)
    status = models.CharField(
        max_length=20,
        choices=ProductionIssueStatus.CHOICES,
        default=ProductionIssueStatus.POSTED,
        db_index=True,
    )
    reference = models.CharField(max_length=200, blank=True, default='')
    total_qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    total_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    note = models.TextField(blank=True, default='')
    posted_at = models.DateTimeField(auto_now_add=True)
    posted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_issues_posted',
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_issues_cancelled',
    )
    cancel_reason = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_issues_created',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_issues_updated',
    )

    class Meta:
        db_table = 'production_issues'
        ordering = ['-issue_date', '-id']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['issue_date']),
            models.Index(fields=['status']),
            models.Index(fields=['production_order']),
        ]

    def __str__(self):
        return f'{self.code} - {self.issue_date}'

    def _search_values(self):
        line_tokens = []
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
            self.production_order.code if self.production_order_id else '',
            self.issue_date,
            self.reference,
            self.total_qty,
            self.total_amount,
            dict(ProductionIssueStatus.CHOICES).get(self.status, self.status),
            self.note,
            *line_tokens,
        ]

    def save(self, *args, **kwargs):
        self._build_search_text()
        kwargs['update_fields'] = self._merge_update_fields(kwargs.get('update_fields'))
        super().save(*args, **kwargs)

    def recalc_totals(self):
        agg = self.lines.aggregate(qty=models.Sum('quantity'), amount=models.Sum('line_total'))
        self.total_qty = agg['qty'] or Decimal('0')
        self.total_amount = round_money(agg['amount'] or 0)
        self.save(update_fields=['total_qty', 'total_amount', 'updated_at'])


class ProductionIssueLine(models.Model):
    issue = models.ForeignKey(
        ProductionIssue,
        on_delete=models.CASCADE,
        related_name='lines',
    )
    line_number = models.PositiveIntegerField()
    material_requirement = models.ForeignKey(
        ProductionMaterialRequirement,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='issue_lines',
    )
    material_product = models.ForeignKey(
        'products.Product',
        on_delete=models.PROTECT,
        related_name='production_issue_lines',
    )
    product_snapshot = models.JSONField(default=dict, blank=True)
    warehouse = models.ForeignKey(
        'inventory.Warehouse',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='production_issue_lines',
    )
    location = models.ForeignKey(
        'inventory.WarehouseLocation',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='production_issue_lines',
    )
    quantity = models.DecimalField(
        max_digits=18,
        decimal_places=4,
        default=Decimal('0'),
        validators=[MinValueValidator(Decimal('0.0001'))],
    )
    unit_cost = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    line_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    note = models.CharField(max_length=255, blank=True, default='')
    inventory_transaction = models.ForeignKey(
        'inventory.InventoryTransaction',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_issue_lines',
    )

    class Meta:
        db_table = 'production_issue_lines'
        ordering = ['issue_id', 'line_number']
        unique_together = [['issue', 'line_number']]

    def __str__(self):
        return f'{self.issue_id}#{self.line_number}'

    def save(self, *args, **kwargs):
        self.line_total = round_money((self.quantity or Decimal('0')) * (self.unit_cost or Decimal('0')))
        super().save(*args, **kwargs)


class ProductionReceipt(SearchTextModelMixin):
    code = models.CharField(max_length=50, unique=True, db_index=True)
    production_order = models.ForeignKey(
        ProductionOrder,
        on_delete=models.PROTECT,
        related_name='receipts',
    )
    receipt_date = models.DateField(db_index=True)
    status = models.CharField(
        max_length=20,
        choices=ProductionReceiptStatus.CHOICES,
        default=ProductionReceiptStatus.POSTED,
        db_index=True,
    )
    reference = models.CharField(max_length=200, blank=True, default='')
    warehouse = models.ForeignKey(
        'inventory.Warehouse',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='production_receipts',
    )
    location = models.ForeignKey(
        'inventory.WarehouseLocation',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='production_receipts',
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
        related_name='production_receipts_posted',
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_receipts_cancelled',
    )
    cancel_reason = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_receipts_created',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_receipts_updated',
    )

    class Meta:
        db_table = 'production_receipts'
        ordering = ['-receipt_date', '-id']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['receipt_date']),
            models.Index(fields=['status']),
            models.Index(fields=['production_order']),
        ]

    def __str__(self):
        return f'{self.code} - {self.receipt_date}'

    def _search_values(self):
        line_tokens = []
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
        warehouse_name = getattr(getattr(self, 'warehouse', None), 'name', '')
        location_name = getattr(getattr(self, 'location', None), 'name', '')
        return [
            self.code,
            self.production_order.code if self.production_order_id else '',
            self.receipt_date,
            warehouse_name,
            location_name,
            self.reference,
            self.total_qty,
            self.total_amount,
            dict(ProductionReceiptStatus.CHOICES).get(self.status, self.status),
            self.note,
            *line_tokens,
        ]

    def save(self, *args, **kwargs):
        self._build_search_text()
        kwargs['update_fields'] = self._merge_update_fields(kwargs.get('update_fields'))
        super().save(*args, **kwargs)

    def recalc_totals(self):
        agg = self.lines.aggregate(qty=models.Sum('quantity'), amount=models.Sum('line_total'))
        self.total_qty = agg['qty'] or Decimal('0')
        self.total_amount = round_money(agg['amount'] or 0)
        self.save(update_fields=['total_qty', 'total_amount', 'updated_at'])


class ProductionReceiptLine(models.Model):
    receipt = models.ForeignKey(
        ProductionReceipt,
        on_delete=models.CASCADE,
        related_name='lines',
    )
    line_number = models.PositiveIntegerField()
    product = models.ForeignKey(
        'products.Product',
        on_delete=models.PROTECT,
        related_name='production_receipt_lines',
    )
    product_snapshot = models.JSONField(default=dict, blank=True)
    quantity = models.DecimalField(
        max_digits=18,
        decimal_places=4,
        default=Decimal('0'),
        validators=[MinValueValidator(Decimal('0.0001'))],
    )
    unit_cost = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    line_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    note = models.CharField(max_length=255, blank=True, default='')
    inventory_transaction = models.ForeignKey(
        'inventory.InventoryTransaction',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_receipt_lines',
    )

    class Meta:
        db_table = 'production_receipt_lines'
        ordering = ['receipt_id', 'line_number']
        unique_together = [['receipt', 'line_number']]

    def __str__(self):
        return f'{self.receipt_id}#{self.line_number}'

    def save(self, *args, **kwargs):
        self.line_total = round_money((self.quantity or Decimal('0')) * (self.unit_cost or Decimal('0')))
        super().save(*args, **kwargs)
