"""
Serializers chứng từ: nested lines, create/update trong transaction, validate.
"""
from decimal import Decimal
from django.apps import apps
from django.db.models import Sum
from rest_framework import serializers
from sales.document_policy import calc_line_totals
from sales.models import (
    SalesOrder,
    SalesOrderLine,
    SalesOrderDeliveryPlan,
    SalesOrderStatus,
    Quote,
    QuoteLine,
    OutboundShipment,
    ShipmentLine,
    SalesLineMaterialPlan,
    SalesLineMaterialPlanItem,
)
from sales.services import (
    build_sales_order_line_trace_code,
    merge_sales_order_line_product_snapshot,
)


def _create_outbound_shipment_audit_log(*, user, shipment, action, changed_fields, new_values, old_values=None):
    from core.models import AuditLog

    AuditLog.objects.create(
        user=user,
        action=action,
        entity_type='OutboundShipment',
        entity_id=shipment.id,
        entity_code=shipment.code or '',
        old_values=old_values,
        new_values=new_values,
        changed_fields=changed_fields,
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


class QuoteLineSerializer(serializers.ModelSerializer):
    product_code = serializers.CharField(source='product.code', read_only=True)
    product_name = serializers.CharField(source='product.name', read_only=True)

    class Meta:
        model = QuoteLine
        fields = [
            'id', 'line_number', 'product', 'product_code', 'product_name',
            'qty', 'unit_price', 'discount_pct', 'tax_pct',
            'line_subtotal', 'discount_amount', 'tax_amount', 'line_total', 'note',
        ]
        read_only_fields = ['line_subtotal', 'discount_amount', 'tax_amount', 'line_total']

    def validate_qty(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError('Số lượng phải > 0.')
        return value

    def validate(self, attrs):
        qty = attrs.get('qty', getattr(self.instance, 'qty', None))
        unit_price = attrs.get('unit_price', getattr(self.instance, 'unit_price', None))
        discount_pct = attrs.get('discount_pct', getattr(self.instance, 'discount_pct', Decimal('0')))
        tax_pct = attrs.get('tax_pct', getattr(self.instance, 'tax_pct', Decimal('0')))
        if qty is not None and unit_price is not None:
            sub, disc, tax, total = calc_line_totals(qty, unit_price, discount_pct, tax_pct)
            attrs['line_subtotal'] = sub
            attrs['discount_amount'] = disc
            attrs['tax_amount'] = tax
            attrs['line_total'] = total
        return attrs


class QuoteSerializer(serializers.ModelSerializer):
    lines = QuoteLineSerializer(many=True, required=False)
    customer_name = serializers.SerializerMethodField()

    class Meta:
        model = Quote
        fields = [
            'id', 'code', 'quote_date', 'valid_until', 'status', 'reference',
            'customer', 'customer_name', 'currency',
            'subtotal', 'discount_total', 'tax_total', 'total', 'notes',
            'created_by', 'created_at', 'updated_by', 'updated_at', 'lines',
        ]
        read_only_fields = [
            'code', 'subtotal', 'discount_total', 'tax_total', 'total',
            'created_by', 'created_at', 'updated_by', 'updated_at',
        ]

    def get_customer_name(self, obj):
        if obj.customer_id and getattr(obj, 'customer', None):
            return obj.customer.name
        return None

    def create(self, validated_data, **kwargs):
        from django.db import transaction
        from sales.services import get_next_quote_code
        lines_data = validated_data.pop('lines', [])
        quote_date = validated_data.get('quote_date')
        if not quote_date:
            raise serializers.ValidationError({'quote_date': 'Thiếu ngày báo giá.'})
        validated_data['code'] = get_next_quote_code(quote_date)
        validated_data.update({k: v for k, v in kwargs.items() if k in ('created_by', 'updated_by')})
        with transaction.atomic():
            quote = Quote.objects.create(**validated_data)
            for i, line_data in enumerate(lines_data, start=1):
                line_data['line_number'] = line_data.get('line_number') or i
                line_data['quote'] = quote
                qty = line_data.get('qty', Decimal('1'))
                unit_price = line_data.get('unit_price', Decimal('0'))
                discount_pct = line_data.get('discount_pct', Decimal('0'))
                tax_pct = line_data.get('tax_pct', Decimal('0'))
                sub, disc, tax, total = calc_line_totals(qty, unit_price, discount_pct, tax_pct)
                line_data['line_subtotal'] = sub
                line_data['discount_amount'] = disc
                line_data['tax_amount'] = tax
                line_data['line_total'] = total
                QuoteLine.objects.create(**line_data)
            quote.recalc_totals()
        return quote

    def update(self, instance, validated_data):
        from django.db import transaction
        lines_data = validated_data.pop('lines', None)
        with transaction.atomic():
            for k, v in validated_data.items():
                setattr(instance, k, v)
            instance.save()
            if lines_data is not None:
                instance.lines.all().delete()
                for i, line_data in enumerate(lines_data, start=1):
                    line_data['line_number'] = line_data.get('line_number') or i
                    line_data['quote'] = instance
                    qty = line_data.get('qty', Decimal('1'))
                    unit_price = line_data.get('unit_price', Decimal('0'))
                    discount_pct = line_data.get('discount_pct', Decimal('0'))
                    tax_pct = line_data.get('tax_pct', Decimal('0'))
                    sub, disc, tax, total = calc_line_totals(qty, unit_price, discount_pct, tax_pct)
                    line_data['line_subtotal'] = sub
                    line_data['discount_amount'] = disc
                    line_data['tax_amount'] = tax
                    line_data['line_total'] = total
                    QuoteLine.objects.create(**line_data)
                instance.recalc_totals()
        return instance


# ============== OUTBOUND SHIPMENTS ==============
class ShipmentLineSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_code = serializers.CharField(source='product.code', read_only=True)
    
    class Meta:
        model = ShipmentLine
        fields = [
            'id', 'line_number', 'product', 'product_name', 'product_code',
            'qty_ordered', 'qty_shipped', 'qty_received',
            'unit_price', 'discount_pct', 'tax_pct',
            'weight_per_unit', 'notes', 'created_at', 'updated_at'
        ]
        read_only_fields = ['created_at', 'updated_at']


class OutboundShipmentSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source='customer.name', read_only=True)
    sales_order_code = serializers.CharField(source='sales_order.code', read_only=True, allow_null=True)
    submitted_by_name = serializers.CharField(source='submitted_by.username', read_only=True, allow_null=True)
    approved_by_name = serializers.CharField(source='approved_by.username', read_only=True, allow_null=True)
    packed_by_name = serializers.CharField(source='packed_by.username', read_only=True, allow_null=True)
    delivered_by_user_name = serializers.CharField(source='delivered_by_user.username', read_only=True, allow_null=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True, allow_null=True)
    
    lines = ShipmentLineSerializer(many=True, required=False)
    
    class Meta:
        model = OutboundShipment
        fields = [
            'id', 'code', 'sales_order', 'sales_order_code',
            'customer', 'customer_name', 'shipment_date', 'status',
            'reference', 'carrier', 'tracking_number', 'shipping_address',
            'expected_delivery_date', 'actual_delivery_date',
            'delivered_by', 'delivery_notes',
            'submitted_by', 'submitted_by_name', 'submitted_at',
            'approved_by', 'approved_by_name', 'approved_at',
            'packed_by', 'packed_by_name', 'packed_at',
            'delivered_by_user', 'delivered_by_user_name',
            'total_qty', 'total_weight_kg', 'notes',
            'created_at', 'updated_at', 'created_by', 'created_by_name',
            'lines'
        ]
        read_only_fields = [
            'code', 'created_at', 'updated_at', 'created_by',
            'submitted_by', 'submitted_at', 'approved_by', 'approved_at',
            'packed_by', 'packed_at', 'delivered_by_user'
        ]
    
    def create(self, validated_data):
        from django.db import transaction
        from django.utils import timezone
        
        lines_data = validated_data.pop('lines', [])
        request = self.context.get('request')
        
        with transaction.atomic():
            # Generate code
            from sales.models import PeriodSequence
            period = timezone.now().strftime('%Y%m')
            seq, _ = PeriodSequence.objects.get_or_create(
                doc_type='SHIP',
                period=period,
                defaults={'current_number': 0, 'padding': 5}
            )
            validated_data['code'] = seq.get_next_code()
            validated_data['created_by'] = request.user if request else None
            
            shipment = OutboundShipment.objects.create(**validated_data)
            
            for i, line_data in enumerate(lines_data, start=1):
                line_data['shipment'] = shipment
                line_data['line_number'] = i
                ShipmentLine.objects.create(**line_data)
            
            # Audit log
            if request:
                _create_outbound_shipment_audit_log(
                    user=request.user,
                    action='CREATE',
                    shipment=shipment,
                    changed_fields=['code', 'status'],
                    new_values={'code': shipment.code, 'status': shipment.status},
                )
        
        return shipment
    
    def update(self, instance, validated_data):
        from django.db import transaction
        
        lines_data = validated_data.pop('lines', None)
        request = self.context.get('request')
        changed_fields = list(validated_data.keys())
        if lines_data is not None:
            changed_fields.append('lines')
        old_status = instance.status
        
        with transaction.atomic():
            for k, v in validated_data.items():
                setattr(instance, k, v)
            instance.save()
            
            if lines_data is not None:
                instance.lines.all().delete()
                for i, line_data in enumerate(lines_data, start=1):
                    line_data['shipment'] = instance
                    line_data['line_number'] = i
                    ShipmentLine.objects.create(**line_data)
            
            # Audit log
            if request:
                _create_outbound_shipment_audit_log(
                    user=request.user,
                    action='UPDATE',
                    shipment=instance,
                    changed_fields=changed_fields or ['status'],
                    old_values={'status': old_status},
                    new_values={'status': instance.status, 'reference': instance.reference},
                )
        
        return instance


# ── Material Plan serializers ─────────────────────────────────────────────────

class SalesLineMaterialPlanItemSerializer(serializers.ModelSerializer):
    material_product_code = serializers.CharField(source='material_product.code', read_only=True)
    material_product_name = serializers.CharField(source='material_product.name', read_only=True)
    material_product_unit_name = serializers.SerializerMethodField()

    def get_material_product_unit_name(self, obj):
        unit = getattr(getattr(obj, 'material_product', None), 'unit', None)
        return getattr(unit, 'name', None)

    class Meta:
        model = SalesLineMaterialPlanItem
        fields = [
            'id', 'template_group', 'template_option',
            'group_code_snapshot', 'group_name_snapshot',
            'material_role', 'selection_rule',
            'material_product', 'material_product_code', 'material_product_name', 'material_product_unit_name',
            'spec_snapshot', 'is_selected',
            'required_qty', 'ordered_qty_cache', 'received_qty_cache',
            'available_qty_cache', 'short_qty_cache',
            'note', 'created_at', 'updated_at',
        ]
        read_only_fields = fields


class SalesLineMaterialPlanSerializer(serializers.ModelSerializer):
    sales_order_code = serializers.CharField(source='sales_order.code', read_only=True)
    sales_order_line_number = serializers.IntegerField(source='sales_order_line.line_number', read_only=True)
    finished_product_code = serializers.CharField(source='finished_product.code', read_only=True)
    finished_product_name = serializers.CharField(source='finished_product.name', read_only=True)
    items = SalesLineMaterialPlanItemSerializer(many=True, read_only=True)

    class Meta:
        model = SalesLineMaterialPlan
        fields = [
            'id', 'sales_order', 'sales_order_code',
            'sales_order_line', 'sales_order_line_number',
            'finished_product', 'finished_product_code', 'finished_product_name',
            'template', 'ordered_finished_qty', 'status',
            'note', 'confirmed_by', 'confirmed_at',
            'created_at', 'updated_at', 'items',
        ]
        read_only_fields = fields
