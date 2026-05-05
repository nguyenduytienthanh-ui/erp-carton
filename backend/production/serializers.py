from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from production.models import (
    ProductionDemand,
    ProductionDemandPlanningStatus,
    ProductionDemandProductionStatus,
    ProductionIssue,
    ProductionIssueLine,
    ProductionMaterialRequirement,
    ProductionOperation,
    ProductionOrder,
    ProductionOrderStatus,
    ProductionReceipt,
    ProductionReceiptLine,
)
from production.services import (
    build_default_material_requirements,
    build_material_product_snapshot,
    build_operation_planning_snapshot,
    build_production_product_snapshot,
    build_production_order_trace_code,
    rebuild_production_operations,
)


def _format_packaging_number(value):
    if value in (None, ''):
        return ''
    text = format(value, 'f') if isinstance(value, Decimal) else str(value)
    if '.' in text:
        text = text.rstrip('0').rstrip('.')
    return text


def get_production_demand_planning_bucket(obj, today=None):
    if obj.hold_reason:
        return 'held'
    if (
        obj.planning_status == ProductionDemandPlanningStatus.CANCELLED
        or obj.production_status == ProductionDemandProductionStatus.CANCELLED
    ):
        return 'cancelled'
    if not obj.planning_due_date:
        return 'no_date'
    today_value = today or timezone.localdate()
    if obj.planning_due_date < today_value:
        return 'overdue'
    if obj.planning_due_date == today_value:
        return 'due_today'
    if obj.planning_due_date <= today_value + timedelta(days=7):
        return 'upcoming_7'
    return 'not_due'


class ProductionDemandSerializer(serializers.ModelSerializer):
    sales_order_code = serializers.CharField(source='sales_order.code', read_only=True)
    sales_order_line_number = serializers.IntegerField(source='sales_order_line.line_number', read_only=True)
    delivery_plan_date = serializers.DateField(source='delivery_plan.delivery_date', read_only=True)
    product_display_code = serializers.CharField(source='product.code', read_only=True)
    product_display_name = serializers.CharField(source='product.name', read_only=True)
    assigned_planner_name = serializers.CharField(source='assigned_planner.username', read_only=True)
    qty_remaining_to_plan = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    qty_remaining_to_release = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    qty_remaining_to_complete = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    planning_bucket = serializers.SerializerMethodField()
    is_held = serializers.SerializerMethodField()
    customer_display = serializers.SerializerMethodField()
    delivery_plan_display = serializers.SerializerMethodField()

    def get_planning_bucket(self, obj):
        return get_production_demand_planning_bucket(obj)

    def get_is_held(self, obj):
        return bool(obj.hold_reason)

    def get_customer_display(self, obj):
        return obj.customer_name_snapshot or getattr(getattr(obj.sales_order, 'customer', None), 'name', '') or ''

    def get_delivery_plan_display(self, obj):
        if not obj.delivery_plan_id:
            return ''
        date_value = getattr(getattr(obj, 'delivery_plan', None), 'delivery_date', None) or obj.delivery_date
        qty_value = getattr(obj.delivery_plan, 'qty', None)
        if date_value and qty_value is not None:
            return f'{date_value} qty={qty_value}'
        if date_value:
            return str(date_value)
        return ''

    class Meta:
        model = ProductionDemand
        fields = [
            'id',
            'demand_code',
            'demand_key',
            'sales_order',
            'sales_order_code',
            'sales_order_line',
            'sales_order_line_number',
            'delivery_plan',
            'delivery_plan_date',
            'product',
            'product_display_code',
            'product_display_name',
            'customer_id_snapshot',
            'customer_name_snapshot',
            'product_code',
            'product_name',
            'product_kind',
            'unit_name',
            'size_order',
            'size_production',
            'print_colors',
            'operations_summary',
            'routing_summary',
            'qty_required',
            'qty_planned',
            'qty_released',
            'qty_completed',
            'qty_remaining_to_plan',
            'qty_remaining_to_release',
            'qty_remaining_to_complete',
            'planning_bucket',
            'is_held',
            'customer_display',
            'delivery_plan_display',
            'order_date',
            'delivery_date',
            'production_due_date',
            'planning_due_date',
            'reminder_date',
            'planning_status',
            'production_status',
            'priority',
            'assigned_planner',
            'assigned_planner_name',
            'notes',
            'reminder_note',
            'hold_reason',
            'source',
            'created_by',
            'updated_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'qty_remaining_to_plan',
            'qty_remaining_to_release',
            'qty_remaining_to_complete',
            'planning_bucket',
            'is_held',
            'customer_display',
            'delivery_plan_display',
            'created_at',
            'updated_at',
        ]


class ProductionDemandLinkedOrderSerializer(serializers.ModelSerializer):
    operation_count = serializers.SerializerMethodField()

    class Meta:
        model = ProductionOrder
        fields = [
            'id',
            'code',
            'status',
            'planned_qty',
            'produced_qty',
            'scrap_qty',
            'planned_start_date',
            'planned_end_date',
            'released_at',
            'completed_at',
            'operation_count',
        ]
        read_only_fields = fields

    def get_operation_count(self, obj):
        annotated_count = getattr(obj, 'operation_count', None)
        if annotated_count is not None:
            return annotated_count
        prefetched_operations = getattr(obj, '_prefetched_objects_cache', {}).get('operations')
        if prefetched_operations is not None:
            return len(prefetched_operations)
        return obj.operations.count()


class ProductionDemandDetailSerializer(ProductionDemandSerializer):
    production_orders = ProductionDemandLinkedOrderSerializer(many=True, read_only=True)

    class Meta(ProductionDemandSerializer.Meta):
        fields = [*ProductionDemandSerializer.Meta.fields, 'production_orders']
        read_only_fields = [*ProductionDemandSerializer.Meta.read_only_fields, 'production_orders']


class ProductionDemandCreateOrderSerializer(serializers.Serializer):
    qty = serializers.DecimalField(max_digits=18, decimal_places=4)
    planned_start_date = serializers.DateField(required=False, allow_null=True)
    planned_end_date = serializers.DateField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, trim_whitespace=True)

    def validate_qty(self, value):
        if value is None or value <= 0:
            raise serializers.ValidationError('So luong tao lenh phai > 0.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        planned_start_date = attrs.get('planned_start_date')
        planned_end_date = attrs.get('planned_end_date')
        if planned_start_date and planned_end_date and planned_end_date < planned_start_date:
            raise serializers.ValidationError({
                'planned_end_date': 'Ngay ket thuc ke hoach khong duoc truoc ngay bat dau ke hoach.'
            })
        return attrs


class ProductionOperationSerializer(serializers.ModelSerializer):
    planned_shift_label = serializers.SerializerMethodField()
    block_reason_label = serializers.SerializerMethodField()
    handover_status_label = serializers.SerializerMethodField()
    material_readiness = serializers.SerializerMethodField()
    dependency_state = serializers.SerializerMethodField()
    risk_state = serializers.SerializerMethodField()
    previous_step_code = serializers.SerializerMethodField()
    previous_step_name = serializers.SerializerMethodField()
    next_step_code = serializers.SerializerMethodField()
    next_step_name = serializers.SerializerMethodField()
    remaining_issue_qty = serializers.SerializerMethodField()
    remaining_issue_line_count = serializers.SerializerMethodField()

    class Meta:
        model = ProductionOperation
        fields = [
            'id',
            'sequence',
            'step_code',
            'step_name',
            'source_field',
            'route_step_no',
            'display_step',
            'display_order',
            'step_type',
            'group_code',
            'is_required',
            'allow_parallel',
            'source_operation_code',
            'rate_per_hour',
            'planned_qty',
            'completed_qty',
            'scrap_qty',
            'planned_date',
            'planned_shift',
            'planned_shift_label',
            'priority_rank',
            'dispatch_sequence',
            'work_center_code',
            'work_center_name',
            'machine_code',
            'machine_name',
            'estimated_runtime_hours',
            'setup_minutes',
            'block_reason_code',
            'block_reason_label',
            'block_reason_note',
            'dispatch_owner',
            'handover_status',
            'handover_status_label',
            'handover_receiver',
            'handover_note',
            'handover_at',
            'status',
            'started_at',
            'finished_at',
            'note',
            'material_readiness',
            'dependency_state',
            'risk_state',
            'previous_step_code',
            'previous_step_name',
            'next_step_code',
            'next_step_name',
            'remaining_issue_qty',
            'remaining_issue_line_count',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields

    def _get_planning_snapshot(self, obj):
        snapshot = getattr(obj, '_planning_snapshot', None)
        if snapshot is None:
            order = getattr(obj, 'production_order', None)
            snapshot = build_operation_planning_snapshot(obj, order=order)
            setattr(obj, '_planning_snapshot', snapshot)
        return snapshot

    def get_planned_shift_label(self, obj):
        return self._get_planning_snapshot(obj).get('planned_shift_label', '')

    def get_block_reason_label(self, obj):
        return self._get_planning_snapshot(obj).get('block_reason_label', '')

    def get_handover_status_label(self, obj):
        return getattr(obj, 'get_handover_status_display', lambda: '')() or ''

    def get_material_readiness(self, obj):
        return self._get_planning_snapshot(obj).get('material_readiness', '')

    def get_dependency_state(self, obj):
        return self._get_planning_snapshot(obj).get('dependency_state', '')

    def get_risk_state(self, obj):
        return self._get_planning_snapshot(obj).get('risk_state', '')

    def get_previous_step_code(self, obj):
        return self._get_planning_snapshot(obj).get('previous_step_code')

    def get_previous_step_name(self, obj):
        return self._get_planning_snapshot(obj).get('previous_step_name')

    def get_next_step_code(self, obj):
        return self._get_planning_snapshot(obj).get('next_step_code')

    def get_next_step_name(self, obj):
        return self._get_planning_snapshot(obj).get('next_step_name')

    def get_remaining_issue_qty(self, obj):
        return self._get_planning_snapshot(obj).get('remaining_issue_qty')

    def get_remaining_issue_line_count(self, obj):
        return self._get_planning_snapshot(obj).get('remaining_issue_line_count', 0)


class ProductionMaterialRequirementSerializer(serializers.ModelSerializer):
    material_product_code = serializers.SerializerMethodField()
    material_product_name = serializers.SerializerMethodField()
    remaining_issue_qty = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    source_warehouse_name = serializers.CharField(source='source_warehouse.name', read_only=True)
    source_location_name = serializers.CharField(source='source_location.name', read_only=True)
    product_snapshot = serializers.JSONField(required=False)

    class Meta:
        model = ProductionMaterialRequirement
        fields = [
            'id',
            'line_number',
            'material_product',
            'material_product_code',
            'material_product_name',
            'internal_product_code',
            'product_snapshot',
            'required_qty',
            'issued_qty',
            'remaining_issue_qty',
            'source_warehouse',
            'source_warehouse_name',
            'source_location',
            'source_location_name',
            'note',
        ]
        read_only_fields = [
            'internal_product_code',
            'issued_qty',
            'remaining_issue_qty',
            'source_warehouse_name',
            'source_location_name',
        ]

    def get_material_product_code(self, obj):
        return obj.internal_product_code or (obj.product_snapshot or {}).get('code') or getattr(obj.material_product, 'code', None)

    def get_material_product_name(self, obj):
        return (obj.product_snapshot or {}).get('name') or getattr(obj.material_product, 'name', None)

    def validate_required_qty(self, value):
        if value is None or value <= 0:
            raise serializers.ValidationError('Số lượng yêu cầu phải > 0.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        warehouse = attrs.get('source_warehouse', getattr(self.instance, 'source_warehouse', None))
        location = attrs.get('source_location', getattr(self.instance, 'source_location', None))
        if location and warehouse and location.warehouse_id != warehouse.id:
            raise serializers.ValidationError({'source_location': 'Vị trí nguồn phải thuộc kho nguồn.'})
        return attrs


class ProductionOrderSerializer(serializers.ModelSerializer):
    operations = ProductionOperationSerializer(many=True, read_only=True)
    material_requirements = ProductionMaterialRequirementSerializer(many=True, required=False)
    product_code = serializers.CharField(source='product.code', read_only=True)
    product_name = serializers.CharField(source='product.name', read_only=True)
    trace_code = serializers.SerializerMethodField()
    qr_value = serializers.SerializerMethodField()
    sales_order_code = serializers.CharField(source='sales_order.code', read_only=True)
    sales_order_line_number = serializers.IntegerField(source='sales_order_line.line_number', read_only=True)
    production_demand_code = serializers.CharField(source='production_demand.demand_code', read_only=True)
    production_demand_display_code = serializers.SerializerMethodField()
    production_demand_key = serializers.CharField(source='production_demand.demand_key', read_only=True)
    production_demand_qty_required = serializers.DecimalField(source='production_demand.qty_required', max_digits=18, decimal_places=4, read_only=True, allow_null=True)
    production_demand_qty_planned = serializers.DecimalField(source='production_demand.qty_planned', max_digits=18, decimal_places=4, read_only=True, allow_null=True)
    production_demand_qty_released = serializers.DecimalField(source='production_demand.qty_released', max_digits=18, decimal_places=4, read_only=True, allow_null=True)
    production_demand_qty_completed = serializers.DecimalField(source='production_demand.qty_completed', max_digits=18, decimal_places=4, read_only=True, allow_null=True)
    production_demand_qty_remaining_to_plan = serializers.DecimalField(source='production_demand.qty_remaining_to_plan', max_digits=18, decimal_places=4, read_only=True, allow_null=True)
    production_demand_qty_remaining_to_release = serializers.DecimalField(source='production_demand.qty_remaining_to_release', max_digits=18, decimal_places=4, read_only=True, allow_null=True)
    production_demand_planning_status = serializers.CharField(source='production_demand.planning_status', read_only=True)
    production_demand_production_status = serializers.CharField(source='production_demand.production_status', read_only=True)
    target_warehouse_name = serializers.CharField(source='target_warehouse.name', read_only=True)
    target_location_name = serializers.CharField(source='target_location.name', read_only=True)
    remaining_qty = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)

    class Meta:
        model = ProductionOrder
        fields = [
            'id',
            'code',
            'doc_type',
            'order_date',
            'planned_start_date',
            'planned_end_date',
            'status',
            'reference',
            'sales_order',
            'sales_order_code',
            'sales_order_line',
            'sales_order_line_number',
            'production_demand',
            'production_demand_code',
            'production_demand_display_code',
            'production_demand_key',
            'production_demand_qty_required',
            'production_demand_qty_planned',
            'production_demand_qty_released',
            'production_demand_qty_completed',
            'production_demand_qty_remaining_to_plan',
            'production_demand_qty_remaining_to_release',
            'production_demand_planning_status',
            'production_demand_production_status',
            'product',
            'product_code',
            'product_name',
            'trace_code',
            'qr_value',
            'product_snapshot',
            'planned_qty',
            'produced_qty',
            'remaining_qty',
            'scrap_qty',
            'unit_cost_estimate',
            'estimated_output_value',
            'target_warehouse',
            'target_warehouse_name',
            'target_location',
            'target_location_name',
            'notes',
            'submitted_by',
            'submitted_at',
            'approved_by',
            'approved_at',
            'rejected_by',
            'rejected_at',
            'reject_reason',
            'released_by',
            'released_at',
            'completed_by',
            'completed_at',
            'cancelled_by',
            'cancelled_at',
            'cancel_reason',
            'version',
            'created_by',
            'created_at',
            'updated_by',
            'updated_at',
            'owner',
            'team',
            'material_requirements',
            'operations',
        ]
        read_only_fields = [
            'code',
            'doc_type',
            'status',
            'product_snapshot',
            'produced_qty',
            'remaining_qty',
            'scrap_qty',
            'estimated_output_value',
            'production_demand',
            'production_demand_code',
            'production_demand_display_code',
            'production_demand_key',
            'production_demand_qty_required',
            'production_demand_qty_planned',
            'production_demand_qty_released',
            'production_demand_qty_completed',
            'production_demand_qty_remaining_to_plan',
            'production_demand_qty_remaining_to_release',
            'production_demand_planning_status',
            'production_demand_production_status',
            'submitted_by',
            'submitted_at',
            'approved_by',
            'approved_at',
            'rejected_by',
            'rejected_at',
            'reject_reason',
            'released_by',
            'released_at',
            'completed_by',
            'completed_at',
            'cancelled_by',
            'cancelled_at',
            'cancel_reason',
            'version',
            'created_by',
            'created_at',
            'updated_by',
            'updated_at',
            'owner',
            'team',
            'operations',
        ]

    def get_trace_code(self, obj):
        return build_production_order_trace_code(obj, getattr(obj, 'product', None))

    def get_qr_value(self, obj):
        return self.get_trace_code(obj)

    def get_production_demand_display_code(self, obj):
        demand = getattr(obj, 'production_demand', None)
        if not demand:
            return None
        return demand.demand_code or demand.demand_key

    def validate_planned_qty(self, value):
        if value is None or value <= 0:
            raise serializers.ValidationError('Số lượng sản xuất phải > 0.')
        return value

    def validate_unit_cost_estimate(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError('Đơn giá dự kiến không được âm.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        target_warehouse = attrs.get('target_warehouse', getattr(self.instance, 'target_warehouse', None))
        target_location = attrs.get('target_location', getattr(self.instance, 'target_location', None))
        if target_location and target_warehouse and target_location.warehouse_id != target_warehouse.id:
            raise serializers.ValidationError({'target_location': 'Vị trí thành phẩm phải thuộc kho đích.'})

        sales_order_line = attrs.get('sales_order_line', getattr(self.instance, 'sales_order_line', None))
        sales_order = attrs.get('sales_order', getattr(self.instance, 'sales_order', None))
        product = attrs.get('product', getattr(self.instance, 'product', None))
        if sales_order_line:
            attrs.setdefault('sales_order', sales_order_line.sales_order)
            if sales_order and sales_order_line.sales_order_id != sales_order.id:
                raise serializers.ValidationError({'sales_order': 'Sales order phải khớp với dòng đơn hàng.'})
            if product and sales_order_line.product_id != product.id:
                raise serializers.ValidationError({'product': 'Sản phẩm phải khớp với dòng đơn hàng.'})

        if self.instance:
            incoming_version = self.initial_data.get('version')
            if incoming_version is None:
                raise serializers.ValidationError({'version': 'Thiếu version hiện tại. Vui lòng tải lại lệnh sản xuất trước khi lưu.'})
            try:
                incoming_version = int(incoming_version)
            except (TypeError, ValueError):
                raise serializers.ValidationError({'version': 'Version không hợp lệ.'})
            if incoming_version != int(getattr(self.instance, 'version', 0) or 0):
                raise serializers.ValidationError({'version': 'Lệnh sản xuất đã được cập nhật bởi người khác. Vui lòng tải lại rồi thử lại.'})
            if getattr(self.instance, 'status', None) not in {ProductionOrderStatus.DRAFT, ProductionOrderStatus.REJECTED}:
                raise serializers.ValidationError({'status': 'Chỉ được sửa lệnh sản xuất ở trạng thái Nháp hoặc Từ chối.'})
        return attrs

    def create(self, validated_data):
        material_data = validated_data.pop('material_requirements', None)
        validated_data['code'] = validated_data.get('code') or self.initial_data.get('code') or ''
        if not validated_data['code']:
            raise serializers.ValidationError({'code': 'Thiếu mã lệnh sản xuất.'})
        product = validated_data.get('product')
        sales_order_line = validated_data.get('sales_order_line')
        if not product and sales_order_line:
            product = sales_order_line.product
            validated_data['product'] = product
        validated_data['product_snapshot'] = build_production_product_snapshot(
            product,
            order_date=validated_data.get('order_date'),
            sales_order_line=sales_order_line,
        )
        if validated_data.get('unit_cost_estimate') in (None, ''):
            validated_data['unit_cost_estimate'] = Decimal(str((validated_data['product_snapshot'] or {}).get('cost_price') or 0))
        with transaction.atomic():
            order = ProductionOrder.objects.create(**validated_data)
            self._replace_material_requirements(order, material_data)
            rebuild_production_operations(order)
            order.save(update_fields=['unit_cost_estimate', 'estimated_output_value', 'updated_at'])
        return order

    def update(self, instance, validated_data):
        if instance.status not in {ProductionOrderStatus.DRAFT, ProductionOrderStatus.REJECTED}:
            raise serializers.ValidationError({'status': 'Chỉ được sửa lệnh sản xuất ở trạng thái Nháp hoặc Từ chối.'})
        material_data = validated_data.pop('material_requirements', None)
        with transaction.atomic():
            for key, value in validated_data.items():
                setattr(instance, key, value)
            instance.version += 1
            instance.product_snapshot = build_production_product_snapshot(
                instance.product,
                order_date=instance.order_date,
                sales_order_line=instance.sales_order_line,
            )
            if 'unit_cost_estimate' not in validated_data:
                instance.unit_cost_estimate = Decimal(str((instance.product_snapshot or {}).get('cost_price') or 0))
            instance.save()
            self._replace_material_requirements(instance, material_data)
            rebuild_production_operations(instance)
            instance.save(update_fields=['unit_cost_estimate', 'estimated_output_value', 'updated_at'])
        return instance

    def _replace_material_requirements(self, order, material_data):
        order.material_requirements.all().delete()
        payloads = material_data
        if payloads is None:
            payloads = build_default_material_requirements(order.product, order.planned_qty)
        for index, item in enumerate(payloads, start=1):
            material_product = item.get('material_product')
            if isinstance(material_product, int):
                from products.models import Product

                material_product = Product.objects.get(pk=material_product)
            if not material_product:
                continue
            snapshot = build_material_product_snapshot(material_product)
            snapshot.update({
                key: value
                for key, value in (item.get('product_snapshot') or {}).items()
                if value not in (None, '')
            })
            ProductionMaterialRequirement.objects.create(
                production_order=order,
                line_number=item.get('line_number') or index,
                material_product=material_product,
                internal_product_code=getattr(material_product, 'code', '') or '',
                product_snapshot=snapshot,
                required_qty=item.get('required_qty') or Decimal('0'),
                source_warehouse=item.get('source_warehouse'),
                source_location=item.get('source_location'),
                note=item.get('note') or '',
            )


class ProductionIssueLineSerializer(serializers.ModelSerializer):
    material_requirement_line_number = serializers.IntegerField(source='material_requirement.line_number', read_only=True)
    material_product_code = serializers.SerializerMethodField()
    material_product_name = serializers.SerializerMethodField()
    warehouse_name = serializers.CharField(source='warehouse.name', read_only=True)
    location_name = serializers.CharField(source='location.name', read_only=True)
    inventory_transaction_code = serializers.CharField(source='inventory_transaction.code', read_only=True)

    class Meta:
        model = ProductionIssueLine
        fields = [
            'id',
            'line_number',
            'material_requirement',
            'material_requirement_line_number',
            'material_product',
            'material_product_code',
            'material_product_name',
            'product_snapshot',
            'warehouse',
            'warehouse_name',
            'location',
            'location_name',
            'quantity',
            'unit_cost',
            'line_total',
            'note',
            'inventory_transaction',
            'inventory_transaction_code',
        ]
        read_only_fields = fields

    def get_material_product_code(self, obj):
        return (obj.product_snapshot or {}).get('code') or getattr(getattr(obj, 'material_product', None), 'code', None)

    def get_material_product_name(self, obj):
        return (obj.product_snapshot or {}).get('name') or getattr(getattr(obj, 'material_product', None), 'name', None)


class ProductionIssueSerializer(serializers.ModelSerializer):
    production_order_code = serializers.CharField(source='production_order.code', read_only=True)
    lines = ProductionIssueLineSerializer(many=True, read_only=True)

    class Meta:
        model = ProductionIssue
        fields = [
            'id',
            'code',
            'production_order',
            'production_order_code',
            'issue_date',
            'status',
            'reference',
            'total_qty',
            'total_amount',
            'note',
            'posted_at',
            'posted_by',
            'cancelled_at',
            'cancelled_by',
            'cancel_reason',
            'created_at',
            'updated_at',
            'lines',
        ]
        read_only_fields = fields


class ProductionReceiptLineSerializer(serializers.ModelSerializer):
    product_code = serializers.SerializerMethodField()
    product_name = serializers.SerializerMethodField()
    trace_code = serializers.SerializerMethodField()
    qr_value = serializers.SerializerMethodField()
    packaging_summary = serializers.SerializerMethodField()
    inventory_transaction_code = serializers.CharField(source='inventory_transaction.code', read_only=True)

    class Meta:
        model = ProductionReceiptLine
        fields = [
            'id',
            'line_number',
            'product',
            'product_code',
            'product_name',
            'trace_code',
            'qr_value',
            'bundle_count',
            'units_per_bundle',
            'pallet_count',
            'bundles_per_pallet',
            'packaging_summary',
            'product_snapshot',
            'quantity',
            'unit_cost',
            'line_total',
            'note',
            'inventory_transaction',
            'inventory_transaction_code',
        ]
        read_only_fields = fields

    def get_product_code(self, obj):
        return (obj.product_snapshot or {}).get('code') or getattr(getattr(obj, 'product', None), 'code', None)

    def get_product_name(self, obj):
        return (obj.product_snapshot or {}).get('name') or getattr(getattr(obj, 'product', None), 'name', None)

    def get_trace_code(self, obj):
        order = getattr(getattr(obj, 'receipt', None), 'production_order', None)
        product = getattr(obj, 'product', None)
        if not order or not product:
            return ''
        return build_production_order_trace_code(order, product)

    def get_qr_value(self, obj):
        return self.get_trace_code(obj)

    def get_packaging_summary(self, obj):
        parts: list[str] = []
        if obj.bundle_count:
            parts.append(f'{_format_packaging_number(obj.bundle_count)} goi lon')
        if obj.units_per_bundle:
            parts.append(f'{_format_packaging_number(obj.units_per_bundle)} cai/goi')
        if obj.pallet_count:
            parts.append(f'{_format_packaging_number(obj.pallet_count)} pallet')
        if obj.bundles_per_pallet:
            parts.append(f'{_format_packaging_number(obj.bundles_per_pallet)} goi/pallet')
        return ' | '.join(parts)


class ProductionReceiptSerializer(serializers.ModelSerializer):
    production_order_code = serializers.CharField(source='production_order.code', read_only=True)
    warehouse_name = serializers.CharField(source='warehouse.name', read_only=True)
    location_name = serializers.CharField(source='location.name', read_only=True)
    lines = ProductionReceiptLineSerializer(many=True, read_only=True)

    class Meta:
        model = ProductionReceipt
        fields = [
            'id',
            'code',
            'production_order',
            'production_order_code',
            'receipt_date',
            'status',
            'reference',
            'warehouse',
            'warehouse_name',
            'location',
            'location_name',
            'total_qty',
            'total_amount',
            'note',
            'posted_at',
            'posted_by',
            'cancelled_at',
            'cancelled_by',
            'cancel_reason',
            'created_at',
            'updated_at',
            'lines',
        ]
        read_only_fields = fields
