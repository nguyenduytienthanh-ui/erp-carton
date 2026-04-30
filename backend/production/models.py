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


class ProductionOperationBlockReason:
    WAIT_MATERIAL = 'WAIT_MATERIAL'
    WAIT_PREVIOUS_STEP = 'WAIT_PREVIOUS_STEP'
    WAIT_APPROVAL = 'WAIT_APPROVAL'
    MACHINE_DOWN = 'MACHINE_DOWN'
    OTHER = 'OTHER'
    CHOICES = [
        (WAIT_MATERIAL, 'Chờ vật tư/giấy/mực'),
        (WAIT_PREVIOUS_STEP, 'Chờ công đoạn trước'),
        (WAIT_APPROVAL, 'Chờ duyệt'),
        (MACHINE_DOWN, 'Máy dừng/sự cố máy'),
        (OTHER, 'Khác'),
    ]


class ProductionShift:
    MORNING = 'MORNING'
    AFTERNOON = 'AFTERNOON'
    EVENING = 'EVENING'
    NIGHT = 'NIGHT'
    FULLDAY = 'FULLDAY'
    CHOICES = [
        (MORNING, 'Sáng'),
        (AFTERNOON, 'Chiều'),
        (EVENING, 'Tối'),
        (NIGHT, 'Đêm'),
        (FULLDAY, 'Cả ngày'),
    ]


class ProductionHandoverStatus:
    ACTIVE = 'ACTIVE'
    READY = 'READY'
    ACCEPTED = 'ACCEPTED'
    CHOICES = [
        (ACTIVE, 'Đang thao tác'),
        (READY, 'Sẵn sàng bàn giao'),
        (ACCEPTED, 'Đã tiếp quản'),
    ]


class ProductionDemandPlanningStatus:
    NOT_DUE = 'NOT_DUE'
    UPCOMING = 'UPCOMING'
    DUE = 'DUE'
    OVERDUE = 'OVERDUE'
    PARTIALLY_PLANNED = 'PARTIALLY_PLANNED'
    FULLY_PLANNED = 'FULLY_PLANNED'
    NO_PRODUCTION_NEEDED = 'NO_PRODUCTION_NEEDED'
    CANCELLED = 'CANCELLED'
    CHOICES = [
        (NOT_DUE, 'Not due'),
        (UPCOMING, 'Upcoming'),
        (DUE, 'Due'),
        (OVERDUE, 'Overdue'),
        (PARTIALLY_PLANNED, 'Partially planned'),
        (FULLY_PLANNED, 'Fully planned'),
        (NO_PRODUCTION_NEEDED, 'No production needed'),
        (CANCELLED, 'Cancelled'),
    ]


class ProductionDemandProductionStatus:
    NOT_RELEASED = 'NOT_RELEASED'
    PARTIALLY_RELEASED = 'PARTIALLY_RELEASED'
    FULLY_RELEASED = 'FULLY_RELEASED'
    IN_PROGRESS = 'IN_PROGRESS'
    PARTIALLY_COMPLETED = 'PARTIALLY_COMPLETED'
    COMPLETED = 'COMPLETED'
    PAUSED = 'PAUSED'
    CANCELLED = 'CANCELLED'
    CHOICES = [
        (NOT_RELEASED, 'Not released'),
        (PARTIALLY_RELEASED, 'Partially released'),
        (FULLY_RELEASED, 'Fully released'),
        (IN_PROGRESS, 'In progress'),
        (PARTIALLY_COMPLETED, 'Partially completed'),
        (COMPLETED, 'Completed'),
        (PAUSED, 'Paused'),
        (CANCELLED, 'Cancelled'),
    ]


class ProductionDemandPriority:
    LOW = 'LOW'
    NORMAL = 'NORMAL'
    HIGH = 'HIGH'
    URGENT = 'URGENT'
    CHOICES = [
        (LOW, 'Low'),
        (NORMAL, 'Normal'),
        (HIGH, 'High'),
        (URGENT, 'Urgent'),
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


class ProductionDemand(SearchTextModelMixin):
    demand_code = models.CharField(max_length=50, unique=True, null=True, blank=True, db_index=True)
    demand_key = models.CharField(max_length=200, unique=True, db_index=True)
    sales_order = models.ForeignKey(
        'sales.SalesOrder',
        on_delete=models.PROTECT,
        related_name='production_demands',
    )
    sales_order_line = models.ForeignKey(
        'sales.SalesOrderLine',
        on_delete=models.PROTECT,
        related_name='production_demands',
    )
    delivery_plan = models.ForeignKey(
        'sales.SalesOrderDeliveryPlan',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_demands',
    )
    product = models.ForeignKey(
        'products.Product',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_demands',
    )
    customer_id_snapshot = models.PositiveIntegerField(null=True, blank=True, db_index=True)
    customer_name_snapshot = models.CharField(max_length=200, blank=True, default='')
    product_code = models.CharField(max_length=80, blank=True, default='', db_index=True)
    product_name = models.CharField(max_length=255, blank=True, default='')
    product_kind = models.CharField(max_length=20, blank=True, default='', db_index=True)
    unit_name = models.CharField(max_length=80, blank=True, default='')
    size_order = models.CharField(max_length=255, blank=True, default='')
    size_production = models.CharField(max_length=255, blank=True, default='')
    print_colors = models.JSONField(default=list, blank=True)
    operations_summary = models.JSONField(default=list, blank=True)
    routing_summary = models.JSONField(default=list, blank=True)
    qty_required = models.DecimalField(
        max_digits=18,
        decimal_places=4,
        default=Decimal('0'),
        validators=[MinValueValidator(Decimal('0'))],
    )
    qty_planned = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    qty_released = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    qty_completed = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    order_date = models.DateField(null=True, blank=True, db_index=True)
    delivery_date = models.DateField(null=True, blank=True, db_index=True)
    production_due_date = models.DateField(null=True, blank=True, db_index=True)
    planning_due_date = models.DateField(null=True, blank=True, db_index=True)
    reminder_date = models.DateField(null=True, blank=True, db_index=True)
    planning_status = models.CharField(
        max_length=30,
        choices=ProductionDemandPlanningStatus.CHOICES,
        default=ProductionDemandPlanningStatus.NOT_DUE,
        db_index=True,
    )
    production_status = models.CharField(
        max_length=30,
        choices=ProductionDemandProductionStatus.CHOICES,
        default=ProductionDemandProductionStatus.NOT_RELEASED,
        db_index=True,
    )
    priority = models.CharField(
        max_length=20,
        choices=ProductionDemandPriority.CHOICES,
        default=ProductionDemandPriority.NORMAL,
        db_index=True,
    )
    assigned_planner = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assigned_production_demands',
    )
    notes = models.TextField(blank=True, default='')
    reminder_note = models.TextField(blank=True, default='')
    hold_reason = models.TextField(blank=True, default='')
    source = models.CharField(max_length=50, blank=True, default='SALES_ORDER', db_index=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_demands_created',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_demands_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'production_demands'
        ordering = ['planning_due_date', 'delivery_date', 'id']
        indexes = [
            models.Index(fields=['planning_status']),
            models.Index(fields=['production_status']),
            models.Index(fields=['planning_due_date']),
            models.Index(fields=['delivery_date']),
            models.Index(fields=['product_code']),
            models.Index(fields=['product_kind']),
            models.Index(fields=['assigned_planner']),
            models.Index(fields=['priority']),
            models.Index(fields=['source']),
        ]

    def __str__(self):
        return self.demand_code or self.demand_key

    @property
    def qty_remaining_to_plan(self):
        remaining = Decimal(str(self.qty_required or 0)) - Decimal(str(self.qty_planned or 0))
        return round_qty(remaining if remaining > 0 else Decimal('0'))

    @property
    def qty_remaining_to_release(self):
        remaining = Decimal(str(self.qty_required or 0)) - Decimal(str(self.qty_released or 0))
        return round_qty(remaining if remaining > 0 else Decimal('0'))

    @property
    def qty_remaining_to_complete(self):
        remaining = Decimal(str(self.qty_required or 0)) - Decimal(str(self.qty_completed or 0))
        return round_qty(remaining if remaining > 0 else Decimal('0'))

    def _search_values(self):
        sales_order_code = getattr(getattr(self, 'sales_order', None), 'code', '')
        line_number = getattr(getattr(self, 'sales_order_line', None), 'line_number', '')
        return [
            self.demand_code,
            self.demand_key,
            sales_order_code,
            line_number,
            self.customer_name_snapshot,
            self.product_code,
            self.product_name,
            self.product_kind,
            self.unit_name,
            self.size_order,
            self.size_production,
            self.planning_status,
            self.production_status,
            self.priority,
            self.delivery_date,
            self.planning_due_date,
            self.notes,
            self.reminder_note,
            self.hold_reason,
            self.source,
        ]

    def save(self, *args, **kwargs):
        self._build_search_text()
        kwargs['update_fields'] = self._merge_update_fields(kwargs.get('update_fields'))
        super().save(*args, **kwargs)


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
    block_reason_code = models.CharField(
        max_length=30,
        choices=ProductionOperationBlockReason.CHOICES,
        blank=True,
        default='',
        db_index=True,
    )
    block_reason_note = models.CharField(max_length=255, blank=True, default='')
    planned_date = models.DateField(null=True, blank=True, db_index=True)
    planned_shift = models.CharField(
        max_length=20,
        choices=ProductionShift.CHOICES,
        blank=True,
        default='',
        db_index=True,
    )
    priority_rank = models.PositiveIntegerField(default=100)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    dispatch_owner = models.CharField(max_length=120, blank=True, default='')
    handover_at = models.DateTimeField(null=True, blank=True)
    handover_note = models.CharField(max_length=255, blank=True, default='')
    handover_receiver = models.CharField(max_length=120, blank=True, default='')
    handover_status = models.CharField(
        max_length=20,
        choices=ProductionHandoverStatus.CHOICES,
        blank=True,
        default='',
        db_index=True,
    )
    dispatch_sequence = models.PositiveIntegerField(default=100)
    estimated_runtime_hours = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0'))
    machine_code = models.CharField(max_length=40, blank=True, default='', db_index=True)
    machine_name = models.CharField(max_length=120, blank=True, default='')
    setup_minutes = models.PositiveIntegerField(default=0)
    work_center_code = models.CharField(max_length=40, blank=True, default='', db_index=True)
    work_center_name = models.CharField(max_length=120, blank=True, default='')
    note = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'production_operations'
        ordering = ['production_order_id', 'sequence']
        unique_together = [['production_order', 'sequence']]
        indexes = [
            models.Index(fields=['planned_date']),
            models.Index(fields=['planned_shift']),
            models.Index(fields=['block_reason_code']),
            models.Index(fields=['handover_status']),
            models.Index(fields=['work_center_code']),
            models.Index(fields=['machine_code']),
        ]

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
    bundle_count = models.PositiveIntegerField(null=True, blank=True)
    units_per_bundle = models.DecimalField(max_digits=18, decimal_places=4, null=True, blank=True)
    pallet_count = models.PositiveIntegerField(null=True, blank=True)
    bundles_per_pallet = models.DecimalField(max_digits=18, decimal_places=4, null=True, blank=True)
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
