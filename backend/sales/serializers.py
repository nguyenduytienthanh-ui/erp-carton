"""
Serializers chứng từ: nested lines, create/update trong transaction, validate.
"""
from decimal import Decimal
from django.apps import apps
from django.db import transaction
from django.db.models import Sum
from rest_framework import serializers
from sales.document_policy import calc_line_totals
from sales.models import (
    DeliveryCarrier,
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
    resolve_delivery_carrier_assignment,
)


SALES_ORDER_LINE_SNAPSHOT_EDITABLE_KEYS = {
    'description',
    'size_order',
    'size_production',
    'sale_price',
    'delivery_tolerance',
    'commission_per_unit',
    'commission_percent',
    'process_xa',
    'process_in',
    'process_boi',
    'process_can_mang',
    'process_be',
    'process_chap',
    'process_dong',
    'process_dan',
    'process_khac',
    'film_code',
    'film_file_url',
    'color_count',
    'mold_code',
    'mold_file_url',
    'waterproof',
    'note_other',
    'note',
    'unit_name',
}


def _merge_existing_sales_order_line_product_snapshot(existing_snapshot, overrides=None, *, unit_price=None):
    snapshot = dict(existing_snapshot or {})
    for key, value in (overrides or {}).items():
        if key in SALES_ORDER_LINE_SNAPSHOT_EDITABLE_KEYS and value is not None:
            snapshot[key] = value
    if unit_price is not None:
        snapshot['sale_price'] = str(unit_price)
    return snapshot


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
    id = serializers.IntegerField(required=False)
    remaining_shipment_qty = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    remaining_qty = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    is_completed = serializers.BooleanField(read_only=True)

    class Meta:
        model = SalesOrderDeliveryPlan
        fields = [
            'id', 'delivery_date', 'qty', 'shipped_qty', 'delivered_qty', 'remaining_shipment_qty', 'remaining_qty',
            'is_completed', 'planned_carrier', 'planned_carrier_name', 'delivery_rule', 'note', 'created_at', 'updated_at',
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
        carrier_value = attrs.get('planned_carrier', getattr(self.instance, 'planned_carrier', None))
        carrier_name_value = attrs.get('planned_carrier_name', getattr(self.instance, 'planned_carrier_name', '') or '')
        try:
            carrier, carrier_snapshot = resolve_delivery_carrier_assignment(
                carrier_id=carrier_value,
                carrier_name=carrier_name_value,
            )
        except ValueError as exc:
            raise serializers.ValidationError({'planned_carrier': str(exc)}) from exc
        attrs['planned_carrier'] = carrier
        attrs['planned_carrier_name'] = carrier_snapshot
        attrs['delivery_rule'] = (
            attrs.get('delivery_rule')
            or getattr(self.instance, 'delivery_rule', None)
            or SalesOrderDeliveryPlan.DELIVERY_RULE_PARTIAL_ALLOWED
        )
        if delivered_qty > shipped_qty:
            shipped_qty = delivered_qty
            attrs['shipped_qty'] = shipped_qty
        if shipped_qty > qty:
            raise serializers.ValidationError({'shipped_qty': 'Số lượng đã xuất không được lớn hơn số lượng kế hoạch.'})
        if delivered_qty > qty:
            raise serializers.ValidationError({'delivered_qty': 'Số lượng đã giao không được lớn hơn số lượng kế hoạch.'})
        return attrs


class DeliveryCarrierSerializer(serializers.ModelSerializer):
    delivery_plan_usage_count = serializers.IntegerField(read_only=True)
    shipment_usage_count = serializers.IntegerField(read_only=True)
    legacy_shipment_usage_count = serializers.IntegerField(read_only=True)
    total_usage_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = DeliveryCarrier
        fields = [
            'id',
            'code',
            'name',
            'contact_person',
            'phone',
            'email',
            'note',
            'is_internal',
            'is_active',
            'sort_order',
            'delivery_plan_usage_count',
            'shipment_usage_count',
            'legacy_shipment_usage_count',
            'total_usage_count',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'delivery_plan_usage_count',
            'shipment_usage_count',
            'legacy_shipment_usage_count',
            'total_usage_count',
            'created_at',
            'updated_at',
        ]

    def validate_code(self, value):
        normalized = str(value or '').strip().upper()
        if not normalized:
            raise serializers.ValidationError('Mã đơn vị vận chuyển là bắt buộc.')
        return normalized

    def validate_name(self, value):
        normalized = str(value or '').strip()
        if not normalized:
            raise serializers.ValidationError('Tên đơn vị vận chuyển là bắt buộc.')
        return normalized

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user and request.user.is_authenticated:
            validated_data.setdefault('created_by', request.user)
            validated_data.setdefault('updated_by', request.user)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        request = self.context.get('request')
        if request and request.user and request.user.is_authenticated:
            validated_data['updated_by'] = request.user
        return super().update(instance, validated_data)


class SalesOrderLineSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(required=False)
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
        if instance.status != SalesOrderStatus.DRAFT:
            raise serializers.ValidationError({'status': 'Chỉ được sửa đơn ở trạng thái Nháp.'})
        lines_data = validated_data.pop('lines', None)
        with transaction.atomic():
            for k, v in validated_data.items():
                setattr(instance, k, v)
            instance.version += 1
            instance.save()
            if lines_data is not None:
                self._sync_lines(instance, lines_data)
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
        plan_rows = []
        for plan in delivery_plans:
            try:
                carrier, carrier_name = resolve_delivery_carrier_assignment(
                    carrier_id=plan.get('planned_carrier'),
                    carrier_name=plan.get('planned_carrier_name') or '',
                )
            except ValueError as exc:
                raise serializers.ValidationError({'lines': str(exc)}) from exc
            plan_rows.append(
                SalesOrderDeliveryPlan(
                    line=line,
                    delivery_date=plan.get('delivery_date'),
                    qty=plan.get('qty') or Decimal('0'),
                    shipped_qty=max(plan.get('shipped_qty') or Decimal('0'), plan.get('delivered_qty') or Decimal('0')),
                    delivered_qty=plan.get('delivered_qty') or Decimal('0'),
                    planned_carrier=carrier,
                    planned_carrier_name=carrier_name,
                    delivery_rule=plan.get('delivery_rule') or SalesOrderDeliveryPlan.DELIVERY_RULE_PARTIAL_ALLOWED,
                    note=plan.get('note') or '',
                )
            )
        SalesOrderDeliveryPlan.objects.bulk_create(plan_rows)

    def _sync_lines(self, order, lines_data):
        existing_lines = list(order.lines.select_related('product').prefetch_related('delivery_plans').order_by('line_number', 'id'))
        lines_by_id = {line.id: line for line in existing_lines}
        lines_by_number = {line.line_number: line for line in existing_lines}
        seen_ids = set()
        seen_line_numbers = set()
        kept_ids = set()
        resolved_rows = []

        for i, raw_line_data in enumerate(lines_data, start=1):
            line_data = dict(raw_line_data)
            delivery_plans = line_data.pop('delivery_plans', None)
            product_snapshot_input = line_data.pop('product_snapshot', None)
            line_id = line_data.pop('id', None)
            line_number = line_data.get('line_number') or i
            line_data['line_number'] = line_number
            if line_number in seen_line_numbers:
                raise serializers.ValidationError({'lines': f'Dòng hàng số {line_number} bị trùng.'})
            seen_line_numbers.add(line_number)

            line = None
            if line_id not in (None, ''):
                line_id = int(line_id)
                if line_id in seen_ids:
                    raise serializers.ValidationError({'lines': f'Dòng hàng id {line_id} bị trùng.'})
                line = lines_by_id.get(line_id)
                if line is None:
                    raise serializers.ValidationError({'lines': f'Dòng hàng id {line_id} không thuộc đơn này.'})
                seen_ids.add(line_id)
            else:
                line = lines_by_number.get(line_number)
                if line and line.id in kept_ids:
                    line = None

            if line is not None:
                kept_ids.add(line.id)
            resolved_rows.append({
                'line': line,
                'line_data': line_data,
                'delivery_plans': delivery_plans,
                'product_snapshot_input': product_snapshot_input,
            })

        omitted_lines = [line for line in existing_lines if line.id not in kept_ids]
        for line in omitted_lines:
            ok, summary = self._line_can_be_deleted(line)
            if not ok:
                raise serializers.ValidationError(
                    {'lines': f'Không thể xóa dòng hàng đã có kế hoạch giao/sản xuất/kho: {summary}.'}
                )
        for line in existing_lines:
            if line.id in kept_ids:
                continue
            line.delete()

        final_line_numbers = [row['line_data']['line_number'] for row in resolved_rows]
        temp_line_number = max(
            [line.line_number for line in existing_lines] + final_line_numbers + [0]
        ) + 1000
        for row in resolved_rows:
            line = row['line']
            if line is not None and line.line_number != row['line_data']['line_number']:
                SalesOrderLine.objects.filter(pk=line.pk).update(line_number=temp_line_number)
                line.line_number = temp_line_number
                temp_line_number += 1

        for row in resolved_rows:
            line = row['line']
            if line is None:
                line = self._create_order_line(order, row['line_data'], row['product_snapshot_input'])
            else:
                line = self._update_order_line(order, line, row['line_data'], row['product_snapshot_input'])
            if row['delivery_plans'] is not None:
                self._sync_delivery_plans(line, row['delivery_plans'], replace_existing=True)

    def _create_order_line(self, order, line_data, product_snapshot_input):
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
        return SalesOrderLine.objects.create(**line_data)

    def _update_order_line(self, order, line, line_data, product_snapshot_input):
        product = line_data.get('product') or line.product
        product_changed = bool(product and line.product_id and product.id != line.product_id)
        if product_changed:
            ok, summary = self._line_can_be_deleted(line)
            if not ok:
                raise serializers.ValidationError(
                    {'lines': f'Không thể đổi sản phẩm của dòng hàng đã có kế hoạch giao/sản xuất/kho: {summary}.'}
                )
        line_number_changed = line_data.get('line_number') != line.line_number
        if product:
            line_data['product'] = product
            line_data['internal_product_code'] = getattr(product, 'code', '') or ''
            if product_changed or line_number_changed or not line.trace_code:
                line_data['trace_code'] = build_sales_order_line_trace_code(order, product, line_data['line_number'])
            line_data['uom'] = line_data.get('uom') or getattr(getattr(product, 'unit', None), 'code', '')
            if product_changed or not line.product_snapshot:
                line_data['product_snapshot'] = merge_sales_order_line_product_snapshot(
                    product,
                    product_snapshot_input,
                    unit_price=line_data.get('unit_price'),
                    as_of_datetime=order.order_date,
                )
            else:
                line_data['product_snapshot'] = _merge_existing_sales_order_line_product_snapshot(
                    line.product_snapshot,
                    product_snapshot_input,
                    unit_price=line_data.get('unit_price'),
                )
        for field, value in line_data.items():
            setattr(line, field, value)
        line.save()
        return line

    def _sync_delivery_plans(self, line, delivery_plans, *, replace_existing):
        planned_total = sum((p.get('qty') or Decimal('0')) for p in delivery_plans)
        if planned_total > (line.qty or Decimal('0')):
            raise serializers.ValidationError(
                {'lines': 'Tổng số lượng kế hoạch giao không được lớn hơn số lượng dòng hàng.'}
            )
        existing_plans = list(line.delivery_plans.order_by('delivery_date', 'id'))
        plans_by_id = {plan.id: plan for plan in existing_plans}
        matched_plan_ids = set()
        fallback_cursor = 0

        for raw_plan_data in delivery_plans:
            plan_data = dict(raw_plan_data)
            plan_id = plan_data.pop('id', None)
            plan = None
            if plan_id not in (None, ''):
                plan_id = int(plan_id)
                if plan_id in matched_plan_ids:
                    raise serializers.ValidationError({'lines': f'Kế hoạch giao id {plan_id} bị trùng.'})
                plan = plans_by_id.get(plan_id)
                if plan is None:
                    raise serializers.ValidationError({'lines': f'Kế hoạch giao id {plan_id} không thuộc dòng hàng này.'})
            elif replace_existing:
                plan, fallback_cursor = self._match_delivery_plan_by_fallback(
                    plan_data,
                    existing_plans,
                    matched_plan_ids,
                    fallback_cursor,
                )

            if plan is None:
                plan = SalesOrderDeliveryPlan(line=line)
            else:
                matched_plan_ids.add(plan.id)
            self._apply_delivery_plan_data(plan, plan_data)
            plan.save()

        if replace_existing:
            for plan in existing_plans:
                if plan.id in matched_plan_ids:
                    continue
                if self._delivery_plan_has_downstream(plan):
                    raise serializers.ValidationError(
                        {'lines': 'Không thể xóa kế hoạch giao đã có số lượng xuất/giao.'}
                    )
                plan.delete()

    def _match_delivery_plan_by_fallback(self, plan_data, existing_plans, matched_plan_ids, fallback_cursor):
        delivery_date = plan_data.get('delivery_date')
        for plan in existing_plans:
            if plan.id in matched_plan_ids:
                continue
            if delivery_date and plan.delivery_date == delivery_date:
                return plan, fallback_cursor
        while fallback_cursor < len(existing_plans):
            plan = existing_plans[fallback_cursor]
            fallback_cursor += 1
            if plan.id not in matched_plan_ids:
                return plan, fallback_cursor
        return None, fallback_cursor

    def _apply_delivery_plan_data(self, plan, plan_data):
        try:
            carrier, carrier_name = resolve_delivery_carrier_assignment(
                carrier_id=plan_data.get('planned_carrier'),
                carrier_name=plan_data.get('planned_carrier_name') or '',
            )
        except ValueError as exc:
            raise serializers.ValidationError({'lines': str(exc)}) from exc
        plan.delivery_date = plan_data.get('delivery_date')
        plan.qty = plan_data.get('qty') or Decimal('0')
        plan.delivered_qty = plan_data.get('delivered_qty') or Decimal('0')
        plan.shipped_qty = max(plan_data.get('shipped_qty') or Decimal('0'), plan.delivered_qty or Decimal('0'))
        plan.planned_carrier = carrier
        plan.planned_carrier_name = carrier_name
        plan.delivery_rule = plan_data.get('delivery_rule') or SalesOrderDeliveryPlan.DELIVERY_RULE_PARTIAL_ALLOWED
        plan.note = plan_data.get('note') or ''

    def _delivery_plan_has_downstream(self, plan):
        return (plan.shipped_qty or Decimal('0')) > 0 or (plan.delivered_qty or Decimal('0')) > 0

    def _line_can_be_deleted(self, line):
        blockers = []
        if line.delivery_plans.filter(shipped_qty__gt=0).exists() or line.delivery_plans.filter(delivered_qty__gt=0).exists():
            blockers.append('kế hoạch giao đã xuất/giao')
        if SalesLineMaterialPlan.objects.filter(sales_order_line=line).exists():
            blockers.append('kế hoạch vật tư')
        if getattr(line, 'production_orders', None) and line.production_orders.exclude(status='CANCELLED').exists():
            blockers.append('lệnh sản xuất')
        if getattr(line, 'inventory_reservations', None) and line.inventory_reservations.exclude(status__in=['CANCELLED', 'RELEASED']).exists():
            blockers.append('giữ kho')
        if getattr(line, 'inventory_transactions', None) and line.inventory_transactions.exclude(status='CANCELLED').exists():
            blockers.append('giao dịch kho')
        if getattr(line, 'shipment_packages', None) and line.shipment_packages.exclude(status='CANCELLED').exists():
            blockers.append('kiện giao hàng')
        if getattr(line, 'profitability_attributions', None) and line.profitability_attributions.exists():
            blockers.append('phân bổ lợi nhuận')
        return not blockers, ', '.join(blockers)


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
    carrier_master_name = serializers.CharField(source='carrier_master.name', read_only=True, allow_null=True)
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
            'reference', 'carrier_master', 'carrier_master_name', 'carrier', 'tracking_number', 'shipping_address',
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
        carrier_value = validated_data.pop('carrier_master', None)
        request = self.context.get('request')
        try:
            carrier, carrier_name = resolve_delivery_carrier_assignment(
                carrier_id=carrier_value,
                carrier_name=validated_data.get('carrier') or '',
            )
        except ValueError as exc:
            raise serializers.ValidationError({'carrier_master': str(exc)}) from exc
        
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
            validated_data['carrier_master'] = carrier
            validated_data['carrier'] = carrier_name
            
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
        carrier_value = validated_data.pop('carrier_master', getattr(instance, 'carrier_master', None))
        request = self.context.get('request')
        changed_fields = list(validated_data.keys())
        if lines_data is not None:
            changed_fields.append('lines')
        if 'carrier' in validated_data or carrier_value is not None:
            changed_fields.append('carrier_master')
        old_status = instance.status
        try:
            carrier, carrier_name = resolve_delivery_carrier_assignment(
                carrier_id=carrier_value,
                carrier_name=validated_data.get('carrier', getattr(instance, 'carrier', '') or ''),
            )
        except ValueError as exc:
            raise serializers.ValidationError({'carrier_master': str(exc)}) from exc
        
        with transaction.atomic():
            for k, v in validated_data.items():
                setattr(instance, k, v)
            instance.carrier_master = carrier
            instance.carrier = carrier_name
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
