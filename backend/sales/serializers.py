"""
Serializers chứng từ: nested lines, create/update trong transaction, validate.
"""
from decimal import Decimal
from rest_framework import serializers
from sales.models import SalesOrder, SalesOrderLine, SalesOrderDeliveryPlan, SalesOrderStatus


class SalesOrderDeliveryPlanSerializer(serializers.ModelSerializer):
    remaining_qty = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    is_completed = serializers.BooleanField(read_only=True)

    class Meta:
        model = SalesOrderDeliveryPlan
        fields = [
            'id', 'delivery_date', 'qty', 'delivered_qty', 'remaining_qty',
            'is_completed', 'note', 'created_at', 'updated_at',
        ]
        read_only_fields = ['remaining_qty', 'is_completed', 'created_at', 'updated_at']

    def validate_qty(self, value):
        if value is None or value <= 0:
            raise serializers.ValidationError('Số lượng kế hoạch giao phải > 0.')
        return value

    def validate_delivered_qty(self, value):
        if value is None:
            return Decimal('0')
        if value < 0:
            raise serializers.ValidationError('Số lượng đã giao không được âm.')
        return value

    def validate(self, attrs):
        qty = attrs.get('qty', getattr(self.instance, 'qty', Decimal('0')))
        delivered_qty = attrs.get('delivered_qty', getattr(self.instance, 'delivered_qty', Decimal('0')))
        if delivered_qty > qty:
            raise serializers.ValidationError({'delivered_qty': 'Số lượng đã giao không được lớn hơn số lượng kế hoạch.'})
        return attrs


class SalesOrderLineSerializer(serializers.ModelSerializer):
    delivery_plans = SalesOrderDeliveryPlanSerializer(many=True, required=False)
    planned_qty_total = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    unplanned_qty = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)

    class Meta:
        model = SalesOrderLine
        fields = [
            'id', 'line_number', 'product', 'uom', 'qty', 'unit_price',
            'discount_pct', 'tax_pct', 'line_subtotal', 'discount_amount',
            'tax_amount', 'line_total', 'note', 'delivery_plans',
            'planned_qty_total', 'unplanned_qty',
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
        with transaction.atomic():
            order = SalesOrder.objects.create(**validated_data)
            for i, line_data in enumerate(lines_data, start=1):
                delivery_plans = line_data.pop('delivery_plans', [])
                line_data['line_number'] = line_data.get('line_number') or i
                line_data['sales_order'] = order
                line = SalesOrderLine.objects.create(**line_data)
                self._save_delivery_plans(line, delivery_plans)
            order.recalc_totals()
        return order

    def validate(self, data):
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
                    line_data['line_number'] = line_data.get('line_number') or i
                    line_data['sales_order'] = instance
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
                delivered_qty=plan.get('delivered_qty') or Decimal('0'),
                note=plan.get('note') or '',
            )
            for plan in delivery_plans
        ])
