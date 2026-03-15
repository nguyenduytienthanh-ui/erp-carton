"""
Shipment Model & Related
Handles outbound delivery of sales orders to customers
"""

from django.db import models
from django.contrib.auth.models import User
from core.models import BaseModel


class OutboundShipmentStatus:
    DRAFT = 'DRAFT'
    SUBMITTED = 'SUBMITTED'
    APPROVED = 'APPROVED'
    PACKED = 'PACKED'
    IN_TRANSIT = 'IN_TRANSIT'
    DELIVERED = 'DELIVERED'
    RETURNED = 'RETURNED'
    CANCELLED = 'CANCELLED'
    
    CHOICES = [
        (DRAFT, 'Nháp'),
        (SUBMITTED, 'Chờ duyệt'),
        (APPROVED, 'Đã duyệt'),
        (PACKED, 'Đã đóng gói'),
        (IN_TRANSIT, 'Đang vận chuyển'),
        (DELIVERED, 'Đã giao'),
        (RETURNED, 'Đã trả'),
        (CANCELLED, 'Đã hủy'),
    ]


class OutboundShipment(BaseModel):
    """Shipment to customer"""
    code = models.CharField(max_length=50, unique=True, db_index=True)
    sales_order = models.ForeignKey(
        'sales.SalesOrder',
        on_delete=models.PROTECT,
        related_name='shipments',
        null=True,
        blank=True
    )
    customer = models.ForeignKey(
        'customers.Customer',
        on_delete=models.PROTECT,
        related_name='shipments'
    )
    shipment_date = models.DateField(db_index=True)
    status = models.CharField(
        max_length=20,
        choices=OutboundShipmentStatus.CHOICES,
        default=OutboundShipmentStatus.DRAFT,
        db_index=True
    )
    
    # Shipment details
    reference = models.CharField(max_length=100, blank=True)  # Invoice#, PO#, etc
    carrier = models.CharField(max_length=100, blank=True)  # Carrier name
    tracking_number = models.CharField(max_length=100, blank=True)
    shipping_address = models.TextField(blank=True)
    
    # Delivery details
    expected_delivery_date = models.DateField(null=True, blank=True)
    actual_delivery_date = models.DateField(null=True, blank=True)
    delivered_by = models.CharField(max_length=100, blank=True)
    delivery_notes = models.TextField(blank=True)
    
    # Tracking
    submitted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='shipments_submitted'
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='shipments_approved'
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    
    packed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='shipments_packed'
    )
    packed_at = models.DateTimeField(null=True, blank=True)
    
    delivered_by_user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='shipments_delivered'
    )
    
    total_qty = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    total_weight_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    
    # Additional fields
    notes = models.TextField(blank=True)
    
    class Meta:
        ordering = ['-shipment_date', '-created_at']
        indexes = [
            models.Index(fields=['status', '-shipment_date']),
            models.Index(fields=['customer', 'status']),
            models.Index(fields=['sales_order', 'status']),
        ]
    
    def __str__(self):
        return f"{self.code} - {self.customer.name}"


class ShipmentLine(BaseModel):
    """Line items in shipment"""
    shipment = models.ForeignKey(
        OutboundShipment,
        on_delete=models.CASCADE,
        related_name='lines'
    )
    line_number = models.PositiveIntegerField()
    product = models.ForeignKey(
        'products.Product',
        on_delete=models.PROTECT
    )
    
    qty_ordered = models.DecimalField(max_digits=18, decimal_places=4)
    qty_shipped = models.DecimalField(max_digits=18, decimal_places=4)
    qty_received = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    
    unit_price = models.DecimalField(max_digits=18, decimal_places=4)
    discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    tax_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    
    weight_per_unit = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)
    notes = models.TextField(blank=True)
    
    class Meta:
        ordering = ['line_number']
        unique_together = [['shipment', 'line_number']]
    
    def __str__(self):
        return f"{self.shipment.code} - Line {self.line_number}"
