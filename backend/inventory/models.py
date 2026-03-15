from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import Q


User = settings.AUTH_USER_MODEL


class Warehouse(models.Model):
    code = models.CharField(max_length=20, help_text='Mã kho')
    name = models.CharField(max_length=200, help_text='Tên kho')
    address = models.CharField(max_length=255, blank=True)
    manager = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='managed_warehouses',
    )
    note = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_warehouses',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_warehouses',
    )
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='deleted_warehouses',
    )

    class Meta:
        db_table = 'inventory_warehouses'
        ordering = ['sort_order', 'code']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['name']),
            models.Index(fields=['is_active']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['code'],
                condition=Q(deleted_at__isnull=True),
                name='warehouse_code_uniq_active',
            ),
        ]

    def __str__(self):
        return f'{self.code} - {self.name}'

    def save(self, *args, **kwargs):
        if self.code:
            self.code = str(self.code).strip().upper()
        super().save(*args, **kwargs)


class WarehouseLocationType:
    STORAGE = 'STORAGE'
    STAGING = 'STAGING'
    SHIPPING = 'SHIPPING'
    RETURN = 'RETURN'
    PRODUCTION = 'PRODUCTION'
    OTHER = 'OTHER'
    CHOICES = [
        (STORAGE, 'Lưu trữ'),
        (STAGING, 'Chờ xử lý'),
        (SHIPPING, 'Xuất hàng'),
        (RETURN, 'Hàng trả'),
        (PRODUCTION, 'Sản xuất'),
        (OTHER, 'Khác'),
    ]


class WarehouseLocation(models.Model):
    warehouse = models.ForeignKey(
        Warehouse,
        on_delete=models.CASCADE,
        related_name='locations',
    )
    code = models.CharField(max_length=30, help_text='Mã vị trí')
    name = models.CharField(max_length=200, help_text='Tên vị trí')
    parent = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='children',
    )
    location_type = models.CharField(
        max_length=20,
        choices=WarehouseLocationType.CHOICES,
        default=WarehouseLocationType.STORAGE,
    )
    allow_mixed_products = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0, blank=True)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_warehouse_locations',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_warehouse_locations',
    )
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='deleted_warehouse_locations',
    )

    class Meta:
        db_table = 'inventory_warehouse_locations'
        ordering = ['warehouse__sort_order', 'warehouse__code', 'sort_order', 'code']
        indexes = [
            models.Index(fields=['warehouse', 'code']),
            models.Index(fields=['warehouse', 'is_active']),
            models.Index(fields=['location_type']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['warehouse', 'code'],
                condition=Q(deleted_at__isnull=True),
                name='warehouse_location_code_uniq_active',
            ),
        ]

    def __str__(self):
        return f'{self.warehouse.code}/{self.code}'

    def save(self, *args, **kwargs):
        if self.code:
            self.code = str(self.code).strip().upper()
        super().save(*args, **kwargs)


class InventoryTransactionType:
    RECEIPT = 'RECEIPT'
    ISSUE = 'ISSUE'
    TRANSFER = 'TRANSFER'
    ADJUSTMENT_IN = 'ADJUSTMENT_IN'
    ADJUSTMENT_OUT = 'ADJUSTMENT_OUT'
    CHOICES = [
        (RECEIPT, 'Nhập kho'),
        (ISSUE, 'Xuất kho'),
        (TRANSFER, 'Chuyển kho'),
        (ADJUSTMENT_IN, 'Điều chỉnh tăng'),
        (ADJUSTMENT_OUT, 'Điều chỉnh giảm'),
    ]


class InventoryTransactionStatus:
    POSTED = 'POSTED'
    CANCELLED = 'CANCELLED'
    CHOICES = [
        (POSTED, 'Đã ghi sổ'),
        (CANCELLED, 'Đã hủy'),
    ]


class OutboundShipmentStatus:
    POSTED = 'POSTED'
    CANCELLED = 'CANCELLED'
    CHOICES = [
        (POSTED, 'Đã ghi sổ'),
        (CANCELLED, 'Đã hủy'),
    ]


class OutboundShipment(models.Model):
    code = models.CharField(max_length=50, unique=True, db_index=True)
    sales_order = models.ForeignKey(
        'sales.SalesOrder',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='outbound_shipments',
    )
    shipment_date = models.DateField(db_index=True)
    status = models.CharField(
        max_length=20,
        choices=OutboundShipmentStatus.CHOICES,
        default=OutboundShipmentStatus.POSTED,
        db_index=True,
    )
    reference = models.CharField(max_length=200, blank=True)
    carrier_name = models.CharField(max_length=200, blank=True)
    tracking_number = models.CharField(max_length=100, blank=True, db_index=True)
    vehicle_no = models.CharField(max_length=100, blank=True)
    driver_name = models.CharField(max_length=150, blank=True)
    driver_phone = models.CharField(max_length=50, blank=True)
    note = models.TextField(blank=True)
    loading_reference = models.CharField(max_length=100, blank=True)
    handover_receiver_name = models.CharField(max_length=150, blank=True)
    handover_receiver_phone = models.CharField(max_length=50, blank=True)
    handover_proof_url = models.URLField(blank=True)
    loading_confirmation_note = models.TextField(blank=True)
    loading_confirmed_at = models.DateTimeField(null=True, blank=True)
    loading_confirmed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='loading_confirmed_outbound_shipments',
    )
    delivery_reference = models.CharField(max_length=100, blank=True)
    customer_receiver_name = models.CharField(max_length=150, blank=True)
    customer_receiver_phone = models.CharField(max_length=50, blank=True)
    delivery_proof_url = models.URLField(blank=True)
    delivery_confirmation_note = models.TextField(blank=True)
    delivered_at_actual = models.DateTimeField(null=True, blank=True)
    delivery_confirmed_at = models.DateTimeField(null=True, blank=True)
    delivery_confirmed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='delivery_confirmed_outbound_shipments',
    )
    posted_at = models.DateTimeField(auto_now_add=True)
    posted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='posted_outbound_shipments',
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='cancelled_outbound_shipments',
    )
    cancel_reason = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_outbound_shipments',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_outbound_shipments',
    )

    class Meta:
        db_table = 'inventory_outbound_shipments'
        ordering = ['-shipment_date', '-id']
        indexes = [
            models.Index(fields=['shipment_date']),
            models.Index(fields=['status']),
            models.Index(fields=['sales_order']),
            models.Index(fields=['tracking_number']),
        ]

    def __str__(self):
        return f'{self.code} - {self.sales_order_id or "-"}'


class OutboundShipmentPackageStatus:
    ACTIVE = 'ACTIVE'
    CANCELLED = 'CANCELLED'
    CHOICES = [
        (ACTIVE, 'Đang hiệu lực'),
        (CANCELLED, 'Đã hủy'),
    ]


class OutboundShipmentPackage(models.Model):
    shipment = models.ForeignKey(
        OutboundShipment,
        on_delete=models.CASCADE,
        related_name='packages',
    )
    inventory_transaction = models.ForeignKey(
        'inventory.InventoryTransaction',
        on_delete=models.CASCADE,
        related_name='packages',
    )
    sales_order_line = models.ForeignKey(
        'sales.SalesOrderLine',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='shipment_packages',
    )
    status = models.CharField(
        max_length=20,
        choices=OutboundShipmentPackageStatus.CHOICES,
        default=OutboundShipmentPackageStatus.ACTIVE,
        db_index=True,
    )
    package_no = models.PositiveIntegerField()
    total_packages = models.PositiveIntegerField(default=1)
    quantity = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    package_type = models.CharField(max_length=100, blank=True)
    gross_weight_kg = models.DecimalField(max_digits=18, decimal_places=3, default=Decimal('0'))
    length_cm = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    width_cm = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    height_cm = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    package_code = models.CharField(max_length=80, unique=True, db_index=True)
    label_qr_value = models.CharField(max_length=255, db_index=True)
    note = models.TextField(blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='verified_outbound_shipment_packages',
    )
    loaded_at = models.DateTimeField(null=True, blank=True)
    loaded_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='loaded_outbound_shipment_packages',
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_outbound_shipment_packages',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_outbound_shipment_packages',
    )

    class Meta:
        db_table = 'inventory_outbound_shipment_packages'
        ordering = ['shipment_id', 'inventory_transaction_id', 'package_no']
        indexes = [
            models.Index(fields=['shipment', 'status']),
            models.Index(fields=['inventory_transaction', 'status']),
            models.Index(fields=['sales_order_line', 'status']),
        ]

    def __str__(self):
        return self.package_code


class InventoryTransaction(models.Model):
    code = models.CharField(max_length=50, unique=True, db_index=True)
    transaction_type = models.CharField(max_length=20, choices=InventoryTransactionType.CHOICES)
    status = models.CharField(
        max_length=20,
        choices=InventoryTransactionStatus.CHOICES,
        default=InventoryTransactionStatus.POSTED,
        db_index=True,
    )
    transaction_date = models.DateField(db_index=True)
    reference = models.CharField(max_length=200, blank=True)
    reason = models.CharField(max_length=255, blank=True)
    note = models.TextField(blank=True)
    product = models.ForeignKey(
        'products.Product',
        on_delete=models.PROTECT,
        related_name='inventory_transactions',
    )
    warehouse = models.ForeignKey(
        Warehouse,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='transactions',
    )
    location = models.ForeignKey(
        WarehouseLocation,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='transactions',
    )
    target_warehouse = models.ForeignKey(
        Warehouse,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='incoming_transactions',
    )
    target_location = models.ForeignKey(
        WarehouseLocation,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='incoming_transactions',
    )
    quantity = models.DecimalField(
        max_digits=18,
        decimal_places=4,
        validators=[MinValueValidator(Decimal('0.0001'))],
    )
    unit_cost = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0'))
    sales_order = models.ForeignKey(
        'sales.SalesOrder',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='inventory_transactions',
    )
    sales_order_line = models.ForeignKey(
        'sales.SalesOrderLine',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='inventory_transactions',
    )
    purchase_order = models.ForeignKey(
        'purchasing.PurchaseOrder',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='inventory_transactions',
    )
    purchase_order_line = models.ForeignKey(
        'purchasing.PurchaseOrderLine',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='inventory_transactions',
    )
    purchase_receipt = models.ForeignKey(
        'purchasing.PurchaseReceipt',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='inventory_transactions',
    )
    production_order = models.ForeignKey(
        'production.ProductionOrder',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='inventory_transactions',
    )
    production_issue = models.ForeignKey(
        'production.ProductionIssue',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='inventory_transactions',
    )
    production_receipt = models.ForeignKey(
        'production.ProductionReceipt',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='inventory_transactions',
    )
    reservation = models.ForeignKey(
        'inventory.InventoryReservation',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='transactions',
    )
    shipment_batch = models.ForeignKey(
        'inventory.OutboundShipment',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='transactions',
    )
    posted_at = models.DateTimeField(auto_now_add=True)
    posted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='posted_inventory_transactions',
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='cancelled_inventory_transactions',
    )
    cancel_reason = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_inventory_transactions',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_inventory_transactions',
    )

    class Meta:
        db_table = 'inventory_transactions'
        ordering = ['-transaction_date', '-id']
        indexes = [
            models.Index(fields=['transaction_date']),
            models.Index(fields=['transaction_type']),
            models.Index(fields=['status']),
            models.Index(fields=['product', 'warehouse']),
            models.Index(fields=['sales_order']),
            models.Index(fields=['purchase_order']),
            models.Index(fields=['purchase_receipt']),
            models.Index(fields=['production_order']),
            models.Index(fields=['production_issue']),
            models.Index(fields=['production_receipt']),
        ]

    def __str__(self):
        return f'{self.code} - {self.product_id}'

    @property
    def amount(self):
        return (self.quantity or Decimal('0')) * (self.unit_cost or Decimal('0'))


class InventoryReservationStatus:
    OPEN = 'OPEN'
    RELEASED = 'RELEASED'
    FULFILLED = 'FULFILLED'
    CANCELLED = 'CANCELLED'
    CHOICES = [
        (OPEN, 'Đang giữ'),
        (RELEASED, 'Đã nhả'),
        (FULFILLED, 'Đã xuất đủ'),
        (CANCELLED, 'Đã hủy'),
    ]


class InventoryReservation(models.Model):
    code = models.CharField(max_length=50, unique=True, db_index=True)
    status = models.CharField(
        max_length=20,
        choices=InventoryReservationStatus.CHOICES,
        default=InventoryReservationStatus.OPEN,
        db_index=True,
    )
    reservation_date = models.DateField(db_index=True)
    sales_order = models.ForeignKey(
        'sales.SalesOrder',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='inventory_reservations',
    )
    sales_order_line = models.ForeignKey(
        'sales.SalesOrderLine',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='inventory_reservations',
    )
    product = models.ForeignKey(
        'products.Product',
        on_delete=models.PROTECT,
        related_name='inventory_reservations',
    )
    warehouse = models.ForeignKey(
        Warehouse,
        on_delete=models.PROTECT,
        related_name='reservations',
    )
    location = models.ForeignKey(
        WarehouseLocation,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='reservations',
    )
    reserved_qty = models.DecimalField(
        max_digits=18,
        decimal_places=4,
        validators=[MinValueValidator(Decimal('0.0001'))],
    )
    released_qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    fulfilled_qty = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0'))
    reference = models.CharField(max_length=200, blank=True)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_inventory_reservations',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_inventory_reservations',
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='cancelled_inventory_reservations',
    )
    cancel_reason = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = 'inventory_reservations'
        ordering = ['-reservation_date', '-id']
        indexes = [
            models.Index(fields=['status']),
            models.Index(fields=['reservation_date']),
            models.Index(fields=['product', 'warehouse']),
            models.Index(fields=['sales_order']),
        ]

    def __str__(self):
        return f'{self.code} - {self.product_id}'

    @property
    def active_qty(self):
        remaining = (
            (self.reserved_qty or Decimal('0'))
            - (self.released_qty or Decimal('0'))
            - (self.fulfilled_qty or Decimal('0'))
        )
        return remaining if remaining > 0 else Decimal('0')


class StocktakeStatus:
    DRAFT = 'DRAFT'
    COMPLETED = 'COMPLETED'
    CANCELLED = 'CANCELLED'
    CHOICES = [
        (DRAFT, 'Nháp'),
        (COMPLETED, 'Đã hoàn tất'),
        (CANCELLED, 'Đã hủy'),
    ]


class Stocktake(models.Model):
    """Phiếu kiểm tồn: kho + ngày kiểm, trạng thái."""
    code = models.CharField(max_length=50, unique=True, db_index=True)
    warehouse = models.ForeignKey(
        Warehouse,
        on_delete=models.PROTECT,
        related_name='stocktakes',
    )
    count_date = models.DateField(db_index=True)
    status = models.CharField(
        max_length=20,
        choices=StocktakeStatus.CHOICES,
        default=StocktakeStatus.DRAFT,
        db_index=True,
    )
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_stocktakes',
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='completed_stocktakes',
    )

    class Meta:
        db_table = 'inventory_stocktakes'
        ordering = ['-count_date', '-id']
        indexes = [
            models.Index(fields=['count_date']),
            models.Index(fields=['status']),
            models.Index(fields=['warehouse']),
        ]
        verbose_name = 'Phiếu kiểm tồn'
        verbose_name_plural = 'Phiếu kiểm tồn'

    def __str__(self):
        return f'{self.code} - {self.warehouse_id} - {self.count_date}'


class StocktakeLine(models.Model):
    """Dòng kiểm tồn: sản phẩm, tồn hệ thống, tồn đếm, chênh lệch."""
    stocktake = models.ForeignKey(
        Stocktake,
        on_delete=models.CASCADE,
        related_name='lines',
    )
    product = models.ForeignKey(
        'products.Product',
        on_delete=models.PROTECT,
        related_name='stocktake_lines',
    )
    warehouse = models.ForeignKey(
        Warehouse,
        on_delete=models.PROTECT,
        related_name='stocktake_lines',
    )
    line_number = models.PositiveIntegerField()
    system_qty = models.DecimalField(
        max_digits=18,
        decimal_places=4,
        default=Decimal('0'),
        help_text='Tồn theo hệ thống tại thời điểm kiểm',
    )
    count_qty = models.DecimalField(
        max_digits=18,
        decimal_places=4,
        default=Decimal('0'),
        help_text='Số lượng đếm thực tế',
    )
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = 'inventory_stocktake_lines'
        unique_together = [['stocktake', 'line_number']]
        ordering = ['stocktake', 'line_number']
        verbose_name = 'Dòng kiểm tồn'
        verbose_name_plural = 'Dòng kiểm tồn'

    def __str__(self):
        return f'{self.stocktake_id}#{self.line_number}'

    @property
    def variance_qty(self):
        return (self.count_qty or Decimal('0')) - (self.system_qty or Decimal('0'))
