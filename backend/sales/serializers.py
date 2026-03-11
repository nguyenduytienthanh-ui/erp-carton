"""
Serializers chứng từ: nested lines, create/update trong transaction, validate.
"""
from decimal import Decimal
from django.apps import apps
from django.db.models import Sum
from rest_framework import serializers
from sales.models import SalesOrder, SalesOrderLine, SalesOrderDeliveryPlan, SalesOrderStatus
from sales.services import (
    build_sales_order_line_trace_code,
    merge_sales_order_line_product_snapshot,
)


class SalesOrderDeliveryPlanSerializer(serializers.ModelSerializer):
    remaining_shipment_qty = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    remaining_qty = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    is_completed = serializers.BooleanField(read_only=True)

    class Meta:
        model = SalesOrderDeliveryPlan
        fields = [
            'id', 'delivery_date', 'qty', 'shipped_qty', 'delivered_qty', 'remaining_shipment_qty', 'remaining_qty',
            'is_completed', 'note', 'created_at', 'updated_at',
        ]
        read_only_fields = ['remaining_shipment_qty', 'remaining_qty', 'is_completed', 'created_at', 'updated_at']

    def validate_qty(self, value):
        if value is None or value <= 0:
            raise serializers.ValidationError('Số lượng kế hoạch giao phải > 0.')
        return value

    def validate_shipped_qty(self, value):
        if value is None:
            return Decimal('0')
        if value < 0:
            raise serializers.ValidationError('Số lượng đã xuất không được âm.')
        return value

    def validate_delivered_qty(self, value):
        if value is None:
            return Decimal('0')
        if value < 0:
            raise serializers.ValidationError('Số lượng đã giao không được âm.')
        return value

    def validate(self, attrs):
        qty = attrs.get('qty', getattr(self.instance, 'qty', Decimal('0')))
        shipped_qty = attrs.get('shipped_qty', getattr(self.instance, 'shipped_qty', Decimal('0')))
        delivered_qty = attrs.get('delivered_qty', getattr(self.instance, 'delivered_qty', Decimal('0')))
        if delivered_qty > shipped_qty:
            shipped_qty = delivered_qty
            attrs['shipped_qty'] = shipped_qty
        if shipped_qty > qty:
            raise serializers.ValidationError({'shipped_qty': 'Số lượng đã xuất không được lớn hơn số lượng kế hoạch.'})
        if delivered_qty > qty:
            raise serializers.ValidationError({'delivered_qty': 'Số lượng đã giao không được lớn hơn số lượng kế hoạch.'})
        return attrs


class SalesOrderLineSerializer(serializers.ModelSerializer):
    delivery_plans = SalesOrderDeliveryPlanSerializer(many=True, required=False)
    planned_qty_total = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    unplanned_qty = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    product_code = serializers.SerializerMethodField()
    product_name = serializers.SerializerMethodField()
    reserved_qty_total = serializers.SerializerMethodField()
    shipped_qty_total = serializers.SerializerMethodField()
    remaining_reservation_qty = serializers.SerializerMethodField()
    internal_product_code = serializers.CharField(read_only=True)
    trace_code = serializers.CharField(read_only=True)
    qr_value = serializers.SerializerMethodField()
    product_snapshot = serializers.JSONField(required=False)
    delivery_schedule_summary = serializers.SerializerMethodField()
    product_name_snapshot = serializers.SerializerMethodField()
    commission_per_unit_snapshot = serializers.SerializerMethodField()
    commission_percent_snapshot = serializers.SerializerMethodField()

    class Meta:
        model = SalesOrderLine
        fields = [
            'id', 'line_number', 'product', 'internal_product_code', 'trace_code', 'qr_value', 'product_snapshot',
            'uom', 'qty', 'unit_price',
            'discount_pct', 'tax_pct', 'line_subtotal', 'discount_amount',
            'tax_amount', 'line_total', 'note', 'delivery_plans',
            'planned_qty_total', 'unplanned_qty', 'product_code', 'product_name', 'product_name_snapshot',
            'reserved_qty_total', 'shipped_qty_total', 'remaining_reservation_qty', 'delivery_schedule_summary',
            'commission_per_unit_snapshot', 'commission_percent_snapshot',
        ]
        read_only_fields = [
            'line_subtotal', 'discount_amount', 'tax_amount', 'line_total',
            'planned_qty_total', 'unplanned_qty',
        ]

    def validate_qty(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError('Số lượng phải > 0.')
        return value

    def validate_unit_price(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError('Đơn giá không được âm.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        line_qty = attrs.get('qty', getattr(self.instance, 'qty', None))
        plans = attrs.get('delivery_plans')
        if plans is not None and line_qty is not None:
            planned_total = sum((p.get('qty') or Decimal('0')) for p in plans)
            if planned_total > line_qty:
                raise serializers.ValidationError(
                    {'delivery_plans': 'Tổng số lượng kế hoạch giao không được lớn hơn số lượng dòng hàng.'}
                )
        return attrs

    def get_reserved_qty_total(self, obj):
        InventoryReservation = apps.get_model('inventory', 'InventoryReservation')
        if InventoryReservation is None:
            return Decimal('0')
        agg = InventoryReservation.objects.filter(
            sales_order_line=obj,
            status__in=['OPEN', 'FULFILLED'],
        ).aggregate(total=Sum('reserved_qty'))
        return agg.get('total') or Decimal('0')

    def get_shipped_qty_total(self, obj):
        InventoryTransaction = apps.get_model('inventory', 'InventoryTransaction')
        if InventoryTransaction is None:
            return Decimal('0')
        agg = InventoryTransaction.objects.filter(
            sales_order_line=obj,
            transaction_type='ISSUE',
            status='POSTED',
        ).aggregate(total=Sum('quantity'))
        return agg.get('total') or Decimal('0')

    def get_remaining_reservation_qty(self, obj):
        remaining = (obj.qty or Decimal('0')) - (self.get_reserved_qty_total(obj) or Decimal('0'))
        return remaining if remaining > 0 else Decimal('0')

    def get_product_code(self, obj):
        return getattr(obj, 'internal_product_code', '') or self._snapshot(obj).get('code') or getattr(getattr(obj, 'product', None), 'code', None)

    def get_product_name(self, obj):
        return self._snapshot(obj).get('name') or getattr(getattr(obj, 'product', None), 'name', None)

    def get_qr_value(self, obj):
        return obj.trace_code or ''

    def get_delivery_schedule_summary(self, obj):
        plans = list(obj.delivery_plans.all().order_by('delivery_date', 'id'))
        if not plans:
            return ''
        return '; '.join(
            f"{plan.delivery_date.isoformat()}:{plan.qty}"
            for plan in plans
        )

    def _snapshot(self, obj):
        return getattr(obj, 'product_snapshot', None) or {}

    def get_product_name_snapshot(self, obj):
        return self._snapshot(obj).get('name') or getattr(getattr(obj, 'product', None), 'name', None)

    def get_commission_per_unit_snapshot(self, obj):
        return self._snapshot(obj).get('commission_per_unit')

    def get_commission_percent_snapshot(self, obj):
        return self._snapshot(obj).get('commission_percent')


class SalesOrderSerializer(serializers.ModelSerializer):
    lines = SalesOrderLineSerializer(many=True, required=False)
    customer_name = serializers.SerializerMethodField()

    class Meta:
        model = SalesOrder
        fields = [
            'id', 'code', 'doc_type', 'order_date', 'delivery_date', 'status', 'reference',
            'customer', 'customer_name', 'currency', 'exchange_rate',
            'subtotal', 'discount_total', 'tax_total', 'total', 'notes',
            'submitted_by', 'submitted_at', 'approved_by', 'approved_at',
            'rejected_by', 'rejected_at', 'reject_reason',
            'posted_by', 'posted_at', 'post_number',
            'voided_by', 'voided_at', 'void_reason',
            'posted_snapshot', 'version',
            'created_by', 'created_at', 'updated_by', 'updated_at',
            'owner', 'team', 'reversal_of', 'lines',
        ]
        read_only_fields = [
            'code', 'subtotal', 'discount_total', 'tax_total', 'total',
            'submitted_by', 'submitted_at', 'approved_by', 'approved_at',
            'rejected_by', 'rejected_at', 'reject_reason',
            'posted_by', 'posted_at', 'post_number',
            'voided_by', 'voided_at', 'void_reason',
            'posted_snapshot', 'version',
            'created_by', 'created_at', 'updated_by', 'updated_at',
        ]

    def get_customer_name(self, obj):
        if obj.customer_id and hasattr(obj, 'customer') and obj.customer:
            return obj.customer.name
        return None

    def validate_lines(self, value):
        if not value:
            return value
        line_numbers = [l.get('line_number') for l in value if l.get('line_number')]
        if len(line_numbers) != len(set(line_numbers)):
            raise serializers.ValidationError('line_number trùng.')
        return value

    def create(self, validated_data):
        from django.db import transaction
        lines_data = validated_data.pop('lines', [])
        validated_data['code'] = validated_data.get('code') or self.initial_data.get('code') or ''
        if not validated_data['code']:
            raise serializers.ValidationError({'code': 'Thiếu mã đơn hàng.'})
        with transaction.atomic():
            order = SalesOrder.objects.create(**validated_data)
            for i, line_data in enumerate(lines_data, start=1):
                delivery_plans = line_data.pop('delivery_plans', [])
                product_snapshot_input = line_data.pop('product_snapshot', None)
                line_data['line_number'] = line_data.get('line_number') or i
                line_data['sales_order'] = order
                product = line_data.get('product')
                if product:
                    line_data['internal_product_code'] = getattr(product, 'code', '') or ''
                    line_data['trace_code'] = build_sales_order_line_trace_code(order, product, line_data['line_number'])
                    line_data['uom'] = line_data.get('uom') or getattr(getattr(product, 'unit', None), 'code', '')
                    line_data['product_snapshot'] = merge_sales_order_line_product_snapshot(
                        product,
                        product_snapshot_input,
                        unit_price=line_data.get('unit_price'),
                        as_of_datetime=order.order_date,
                    )
                line = SalesOrderLine.objects.create(**line_data)
                self._save_delivery_plans(line, delivery_plans)
            order.recalc_totals()
        return order

    def validate(self, data):
        if self.instance:
            incoming_version = self.initial_data.get('version')
            if incoming_version is None:
                raise serializers.ValidationError({'version': 'Thiếu version hiện tại. Vui lòng tải lại đơn trước khi lưu.'})
            try:
                incoming_version = int(incoming_version)
            except (TypeError, ValueError):
                raise serializers.ValidationError({'version': 'Version không hợp lệ.'})
            if incoming_version != int(getattr(self.instance, 'version', 0) or 0):
                raise serializers.ValidationError(
                    {'version': 'Đơn hàng đã được cập nhật bởi người khác. Vui lòng tải lại rồi thử lại.'}
                )
        if self.instance and getattr(self.instance, 'status', None) != SalesOrderStatus.DRAFT:
            raise serializers.ValidationError({'status': 'Chỉ được sửa đơn ở trạng thái Nháp.'})
        return data

    def update(self, instance, validated_data):
        from django.db import transaction
        if instance.status != SalesOrderStatus.DRAFT:
            raise serializers.ValidationError({'status': 'Chỉ được sửa đơn ở trạng thái Nháp.'})
        lines_data = validated_data.pop('lines', None)
        with transaction.atomic():
            for k, v in validated_data.items():
                setattr(instance, k, v)
            instance.version += 1
            instance.save()
            if lines_data is not None:
                instance.lines.all().delete()
                for i, line_data in enumerate(lines_data, start=1):
                    delivery_plans = line_data.pop('delivery_plans', [])
                    product_snapshot_input = line_data.pop('product_snapshot', None)
                    line_data['line_number'] = line_data.get('line_number') or i
                    line_data['sales_order'] = instance
                    product = line_data.get('product')
                    if product:
                        line_data['internal_product_code'] = getattr(product, 'code', '') or ''
                        line_data['trace_code'] = build_sales_order_line_trace_code(instance, product, line_data['line_number'])
                        line_data['uom'] = line_data.get('uom') or getattr(getattr(product, 'unit', None), 'code', '')
                        line_data['product_snapshot'] = merge_sales_order_line_product_snapshot(
                            product,
                            product_snapshot_input,
                            unit_price=line_data.get('unit_price'),
                            as_of_datetime=instance.order_date,
                        )
                    line = SalesOrderLine.objects.create(**line_data)
                    self._save_delivery_plans(line, delivery_plans)
                instance.recalc_totals()
        return instance

    def _save_delivery_plans(self, line, delivery_plans):
        if not delivery_plans:
            return
        planned_total = sum((p.get('qty') or Decimal('0')) for p in delivery_plans)
        if planned_total > (line.qty or Decimal('0')):
            raise serializers.ValidationError(
                {'lines': 'Tổng số lượng kế hoạch giao không được lớn hơn số lượng dòng hàng.'}
            )
        SalesOrderDeliveryPlan.objects.bulk_create([
            SalesOrderDeliveryPlan(
                line=line,
                delivery_date=plan.get('delivery_date'),
                qty=plan.get('qty') or Decimal('0'),
                shipped_qty=max(plan.get('shipped_qty') or Decimal('0'), plan.get('delivered_qty') or Decimal('0')),
                delivered_qty=plan.get('delivered_qty') or Decimal('0'),
                note=plan.get('note') or '',
            )
            for plan in delivery_plans
        ])
