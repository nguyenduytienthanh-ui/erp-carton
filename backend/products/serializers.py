from django.db import transaction
from rest_framework import serializers
from .models import (
    ProductCategory,
    ProductUnit,
    ProductWave,
    ProductBoxType,
    Operation,
    Product,
    ProductOperation,
    ProductRoutingStep,
    ProductBundle,
    ProductBundleComponent,
    PriceChange,
    BundlePriceChange,
)
from core.models import Task


LEGACY_PROCESS_OPERATION_MAP = [
    ('process_xa', 'XA', 'Xả', 10),
    ('process_in', 'IN', 'In', 20),
    ('process_can_mang', 'CAN_MANG', 'Cán màng', 30),
    ('process_boi', 'BOI', 'Bồi', 40),
    ('process_be', 'BE', 'Bế', 50),
    ('process_chap', 'CHAP', 'Chạp', 60),
    ('process_dong', 'DONG', 'Đóng', 70),
    ('process_dan', 'DAN', 'Dán', 80),
    ('process_khac', 'KHAC', 'Khác', 90),
]
LEGACY_PROCESS_FIELDS = [item[0] for item in LEGACY_PROCESS_OPERATION_MAP]
LEGACY_PROCESS_FIELD_BY_OPERATION_CODE = {
    operation_code: field_name
    for field_name, operation_code, _fallback_name, _fallback_sequence in LEGACY_PROCESS_OPERATION_MAP
}


class ProductCategorySerializer(serializers.ModelSerializer):
    """Serialize ProductCategory với hỗ trợ cây danh mục (Master Data chuẩn)"""
    
    parent_name = serializers.SerializerMethodField()
    children_count = serializers.SerializerMethodField()
    
    class Meta:
        model = ProductCategory
        fields = [
            'id', 'code', 'name', 'description', 'parent', 'parent_name',
            'children_count', 'is_active', 'sort_order',
            'created_at', 'updated_at', 'created_by', 'updated_by',
            'deleted_at', 'deleted_by',
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at', 'parent_name', 'children_count',
            'created_by', 'updated_by', 'deleted_at', 'deleted_by',
        ]
    
    def get_parent_name(self, obj):
        return f"{obj.parent.code} - {obj.parent.name}" if obj.parent else None
    
    def get_children_count(self, obj):
        return obj.children.filter(is_active=True, deleted_at__isnull=True).count()


class ProductUnitSerializer(serializers.ModelSerializer):
    """Serialize ProductUnit (Master Data chuẩn)"""
    
    class Meta:
        model = ProductUnit
        fields = [
            'id', 'code', 'name', 'is_active', 'sort_order',
            'created_at', 'updated_at', 'created_by', 'updated_by',
            'deleted_at', 'deleted_by',
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at',
            'created_by', 'updated_by', 'deleted_at', 'deleted_by',
        ]


class ProductWaveSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductWave
        fields = [
            'id', 'code', 'name', 'description', 'is_active', 'sort_order',
            'created_at', 'updated_at', 'created_by', 'updated_by',
            'deleted_at', 'deleted_by',
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at',
            'created_by', 'updated_by', 'deleted_at', 'deleted_by',
        ]


class ProductBoxTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductBoxType
        fields = [
            'id', 'code', 'name', 'description', 'is_active', 'sort_order',
            'created_at', 'updated_at', 'created_by', 'updated_by',
            'deleted_at', 'deleted_by',
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at',
            'created_by', 'updated_by', 'deleted_at', 'deleted_by',
        ]


class OperationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Operation
        fields = [
            'id', 'code', 'name', 'sequence', 'default_unit', 'description',
            'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class ProductOperationSerializer(serializers.ModelSerializer):
    operation_id = serializers.ReadOnlyField()

    class Meta:
        model = ProductOperation
        fields = [
            'id', 'operation_id', 'operation_code', 'operation_name',
            'sequence', 'standard_rate_per_hour', 'note', 'is_active',
        ]
        read_only_fields = fields


class ProductRoutingStepSerializer(serializers.Serializer):
    id = serializers.IntegerField(allow_null=True)
    route_step_id = serializers.IntegerField(allow_null=True)
    operation_id = serializers.IntegerField(allow_null=True)
    product_operation_id = serializers.IntegerField(allow_null=True)
    step_no = serializers.IntegerField()
    display_step = serializers.IntegerField()
    display_order = serializers.IntegerField()
    operation_code = serializers.CharField()
    operation_name = serializers.CharField()
    standard_rate_per_hour = serializers.IntegerField()
    note = serializers.CharField(allow_blank=True)
    step_type = serializers.CharField()
    group_code = serializers.CharField(allow_blank=True)
    is_required = serializers.BooleanField()
    allow_parallel = serializers.BooleanField()
    source = serializers.CharField()
    is_active = serializers.BooleanField()


class ProductRoutingInputSerializer(serializers.Serializer):
    operation_id = serializers.IntegerField(required=False, allow_null=True)
    operation_code = serializers.CharField(required=False, allow_blank=True)
    step_no = serializers.IntegerField(min_value=1)
    display_order = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    standard_rate_per_hour = serializers.IntegerField(min_value=1)
    note = serializers.CharField(required=False, allow_blank=True, default='')
    step_type = serializers.ChoiceField(
        choices=ProductRoutingStep.StepType.choices,
        required=False,
        default=ProductRoutingStep.StepType.REQUIRED,
    )
    group_code = serializers.CharField(required=False, allow_blank=True, default='')
    is_required = serializers.BooleanField(required=False, default=True)
    allow_parallel = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        operation_id = attrs.get('operation_id')
        operation_code = (attrs.get('operation_code') or '').strip().upper()
        if not operation_id and not operation_code:
            raise serializers.ValidationError('operation_id or operation_code is required.')

        attrs['operation_code'] = operation_code
        attrs['note'] = (attrs.get('note') or '').strip()
        attrs['group_code'] = (attrs.get('group_code') or '').strip().upper()

        if attrs.get('step_type') == ProductRoutingStep.StepType.CHOOSE_ONE and not attrs['group_code']:
            raise serializers.ValidationError({
                'group_code': 'group_code is required when step_type is CHOOSE_ONE.'
            })
        if attrs.get('step_type') == ProductRoutingStep.StepType.PARALLEL:
            attrs['allow_parallel'] = True
        return attrs


class ProductOperationInputSerializer(serializers.Serializer):
    operation_id = serializers.IntegerField(required=False, allow_null=True)
    operation_code = serializers.CharField(required=False, allow_blank=True)
    standard_rate_per_hour = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    note = serializers.CharField(required=False, allow_blank=True, default='')
    sequence = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    is_active = serializers.BooleanField(required=False, default=True)

    def validate(self, attrs):
        operation_id = attrs.get('operation_id')
        operation_code = (attrs.get('operation_code') or '').strip().upper()
        if not operation_id and not operation_code:
            raise serializers.ValidationError('operation_id or operation_code is required.')
        attrs['operation_code'] = operation_code
        if attrs.get('is_active', True) and not attrs.get('standard_rate_per_hour'):
            raise serializers.ValidationError({
                'standard_rate_per_hour': 'Active operation rate is required.'
            })
        return attrs


class ProductBundleComponentSerializer(serializers.ModelSerializer):
    component_product_code = serializers.CharField(source='component_product.code', read_only=True)
    component_product_name = serializers.CharField(source='component_product.name', read_only=True)
    component_product_unit_name = serializers.CharField(source='component_product.unit.name', read_only=True, allow_null=True)

    class Meta:
        model = ProductBundleComponent
        fields = [
            'id',
            'component_product',
            'component_product_code',
            'component_product_name',
            'component_product_unit_name',
            'qty_per_bundle',
            'is_required',
            'sort_order',
            'is_active',
        ]
        read_only_fields = ['id']


class ProductBundleSerializer(serializers.ModelSerializer):
    components = ProductBundleComponentSerializer(many=True)
    sellable_product_code = serializers.CharField(source='sellable_product.code', read_only=True)
    primary_product_name = serializers.SerializerMethodField()
    resolved_cost_price = serializers.SerializerMethodField()
    resolved_sale_price = serializers.SerializerMethodField()
    resolved_commission_per_unit = serializers.SerializerMethodField()
    resolved_commission_percent = serializers.SerializerMethodField()

    class Meta:
        model = ProductBundle
        fields = [
            'id',
            'sellable_product',
            'sellable_product_code',
            'primary_product',
            'primary_product_name',
            'pricing_mode',
            'fixed_cost_price',
            'fixed_sale_price',
            'commission_mode',
            'fixed_commission_per_unit',
            'fixed_commission_percent',
            'delivery_rule',
            'note',
            'is_active',
            'components',
            'resolved_cost_price',
            'resolved_sale_price',
            'resolved_commission_per_unit',
            'resolved_commission_percent',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'sellable_product_code',
            'primary_product_name',
            'resolved_cost_price',
            'resolved_sale_price',
            'resolved_commission_per_unit',
            'resolved_commission_percent',
            'created_at',
            'updated_at',
        ]

    def get_primary_product_name(self, obj):
        primary = obj.get_primary_product()
        return primary.name if primary else None

    def get_resolved_cost_price(self, obj):
        return str(obj.resolve_cost_price())

    def get_resolved_sale_price(self, obj):
        return str(obj.resolve_sale_price())

    def get_resolved_commission_per_unit(self, obj):
        return str(obj.resolve_commission_per_unit())

    def get_resolved_commission_percent(self, obj):
        return str(obj.resolve_commission_percent())

    def validate(self, attrs):
        attrs = super().validate(attrs)
        components = attrs.get('components')
        instance = getattr(self, 'instance', None)
        sellable_product = attrs.get('sellable_product') or getattr(instance, 'sellable_product', None)
        primary_product = attrs.get('primary_product') or getattr(instance, 'primary_product', None) or sellable_product
        pricing_mode = attrs.get('pricing_mode') or getattr(instance, 'pricing_mode', ProductBundle.PRICING_MODE_PRIMARY)
        fixed_sale_price = attrs.get('fixed_sale_price')
        if fixed_sale_price is None and instance is not None:
            fixed_sale_price = instance.fixed_sale_price
        attrs['commission_mode'] = ProductBundle.commission_mode_from_pricing_mode(pricing_mode)
        if components is None and instance is not None:
            components = [
                {
                    'component_product': item.component_product,
                    'qty_per_bundle': item.qty_per_bundle,
                    'is_required': item.is_required,
                    'sort_order': item.sort_order,
                    'is_active': item.is_active,
                }
                for item in instance.components.all()
            ]
        if not components:
            raise serializers.ValidationError({'components': 'Bộ sản phẩm phải có ít nhất 1 thành phần.'})
        component_ids = [item['component_product'].id if hasattr(item['component_product'], 'id') else item['component_product'] for item in components]
        if len(component_ids) != len(set(component_ids)):
            raise serializers.ValidationError({'components': 'Một mã hàng chỉ được xuất hiện 1 lần trong cùng 1 bộ.'})
        if pricing_mode == ProductBundle.PRICING_MODE_FIXED:
            if fixed_sale_price is None or fixed_sale_price <= 0:
                raise serializers.ValidationError({'fixed_sale_price': 'Giá theo bộ bắt buộc phải nhập Đơn giá bộ lớn hơn 0.'})
        elif pricing_mode == ProductBundle.PRICING_MODE_PRIMARY:
            if not primary_product or (primary_product.sale_price or 0) <= 0:
                raise serializers.ValidationError({'pricing_mode': 'Giá theo mẹ/đại diện yêu cầu mã mẹ có Đơn giá lớn hơn 0.'})
        elif pricing_mode == ProductBundle.PRICING_MODE_SUM_COMPONENTS:
            invalid_components = []
            for item in components:
                product = item['component_product']
                if (product.sale_price or 0) <= 0:
                    invalid_components.append(product.code)
            if invalid_components:
                raise serializers.ValidationError({
                    'components': f"Giá từ thành phần yêu cầu tất cả thành phần có Đơn giá > 0. Thiếu tại: {', '.join(invalid_components)}"
                })
        return attrs

    def _sync_components(self, bundle, components_data):
        bundle.components.all().delete()
        ProductBundleComponent.objects.bulk_create([
            ProductBundleComponent(
                bundle=bundle,
                component_product=item['component_product'],
                qty_per_bundle=item.get('qty_per_bundle') or 1,
                is_required=item.get('is_required', True),
                sort_order=item.get('sort_order') or 0,
                is_active=item.get('is_active', True),
            )
            for item in components_data
        ])

    def _sync_legacy_set_flag(self, bundle):
        sellable = bundle.sellable_product
        has_extra_components = bundle.components.exclude(component_product=sellable).exists()
        Product.objects.filter(pk=sellable.pk).update(is_set=has_extra_components)

    def create(self, validated_data):
        components_data = validated_data.pop('components', [])
        request = self.context.get('request')
        if request and request.user:
            validated_data.setdefault('created_by', request.user)
            validated_data['updated_by'] = request.user
        if not validated_data.get('primary_product'):
            validated_data['primary_product'] = validated_data.get('sellable_product')
        validated_data['commission_mode'] = ProductBundle.commission_mode_from_pricing_mode(
            validated_data.get('pricing_mode', ProductBundle.PRICING_MODE_PRIMARY)
        )
        bundle = ProductBundle.objects.create(**validated_data)
        self._sync_components(bundle, components_data)
        self._sync_legacy_set_flag(bundle)
        return bundle

    def update(self, instance, validated_data):
        components_data = validated_data.pop('components', None)
        request = self.context.get('request')
        if request and request.user:
            validated_data['updated_by'] = request.user
        if not validated_data.get('primary_product'):
            validated_data['primary_product'] = instance.primary_product or instance.sellable_product
        validated_data['commission_mode'] = ProductBundle.commission_mode_from_pricing_mode(
            validated_data.get('pricing_mode', instance.pricing_mode)
        )
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if components_data is not None:
            self._sync_components(instance, components_data)
        self._sync_legacy_set_flag(instance)
        return instance

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['commission_mode'] = instance.get_commission_mode()
        return data


class ProductSerializer(serializers.ModelSerializer):
    """Serialize Product thùng carton với thông tin đầy đủ"""

    category_name = serializers.SerializerMethodField()
    unit_name = serializers.SerializerMethodField()
    wave_name = serializers.SerializerMethodField()
    wave_code = serializers.SerializerMethodField()
    box_type_name = serializers.SerializerMethodField()
    box_type_code = serializers.SerializerMethodField()
    owner_name = serializers.SerializerMethodField()
    team_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()
    parent_name = serializers.SerializerMethodField()
    has_pending_price_change = serializers.BooleanField(read_only=True)
    has_scheduled_price_change = serializers.BooleanField(read_only=True)
    next_price_effective_at = serializers.DateTimeField(read_only=True)
    next_price_cost = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    next_price_sale = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    next_price_commission_per_unit = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    next_price_commission_percent = serializers.DecimalField(max_digits=5, decimal_places=2, read_only=True)
    price_workflow_status = serializers.SerializerMethodField()
    price_change_reason = serializers.CharField(write_only=True, required=False, allow_blank=True, default='')
    price_effective_at = serializers.DateTimeField(
        write_only=True,
        required=False,
        allow_null=True,
        input_formats=['%Y-%m-%dT%H:%M', '%Y-%m-%dT%H:%M:%S', 'iso-8601'],
    )
    skip_price_floor_validation = serializers.BooleanField(write_only=True, required=False, default=False)

    components = serializers.SerializerMethodField()
    components_count = serializers.SerializerMethodField()
    is_component = serializers.SerializerMethodField()
    full_name = serializers.SerializerMethodField()
    blocking_tasks_count = serializers.SerializerMethodField()
    bundle_definition = serializers.SerializerMethodField()
    bundle_id = serializers.SerializerMethodField()
    bundle_components = serializers.SerializerMethodField()
    bundle_pricing_mode = serializers.SerializerMethodField()
    bundle_commission_mode = serializers.SerializerMethodField()
    bundle_delivery_rule = serializers.SerializerMethodField()
    bundle_primary_product_id = serializers.SerializerMethodField()
    bundle_primary_product_name = serializers.SerializerMethodField()
    resolved_bundle_cost_price = serializers.SerializerMethodField()
    resolved_bundle_sale_price = serializers.SerializerMethodField()
    resolved_bundle_commission_per_unit = serializers.SerializerMethodField()
    resolved_bundle_commission_percent = serializers.SerializerMethodField()
    operations = serializers.SerializerMethodField()
    operations_input = ProductOperationInputSerializer(many=True, write_only=True, required=False)
    routing_steps = serializers.SerializerMethodField()
    routing_input = ProductRoutingInputSerializer(many=True, write_only=True, required=False)
    print_colors = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            'id', 'code', 'name', 'description',
            'product_kind', 'requires_order_spec', 'requires_order_operations_review',
            'category', 'category_name',
            'unit', 'unit_name',
            'size_order', 'size_production',
            'wave', 'wave_name', 'wave_code',
            'box_type', 'box_type_name', 'box_type_code',
            'cost_price', 'sale_price', 'min_stock',
            'delivery_tolerance', 'commission_per_unit', 'commission_percent',
            'process_xa', 'process_in', 'process_boi', 'process_can_mang',
            'process_be', 'process_chap', 'process_dong', 'process_dan', 'process_khac',
            'operations', 'operations_input', 'routing_steps', 'routing_input',
            'film_code', 'film_file_url', 'color_count',
            'print_color_1', 'print_color_2', 'print_color_3', 'print_color_4', 'print_color_5',
            'print_colors',
            'mold_code', 'mold_file_url', 'waterproof',
            'note_other', 'note',
            'parent', 'parent_name', 'component_quantity', 'is_set', 'components', 'components_count',
            'bundle_definition', 'bundle_id', 'bundle_components',
            'bundle_pricing_mode', 'bundle_commission_mode', 'bundle_delivery_rule',
            'bundle_primary_product_id', 'bundle_primary_product_name',
            'resolved_bundle_cost_price', 'resolved_bundle_sale_price',
            'resolved_bundle_commission_per_unit', 'resolved_bundle_commission_percent',
            'is_component', 'full_name',
            'status', 'owner', 'owner_name', 'team', 'team_name', 'is_active',
            'has_pending_price_change', 'has_scheduled_price_change', 'price_workflow_status',
            'next_price_effective_at', 'next_price_cost', 'next_price_sale',
            'next_price_commission_per_unit', 'next_price_commission_percent',
            'blocking_tasks_count',
            'created_at', 'updated_at', 'created_by', 'created_by_name',
            'updated_by', 'updated_by_name',
            'price_change_reason', 'price_effective_at', 'skip_price_floor_validation',
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at',
            'category_name', 'unit_name', 'wave_name', 'wave_code',
            'box_type_name', 'box_type_code', 'owner_name', 'team_name',
            'created_by_name', 'updated_by_name', 'parent_name',
            'components', 'components_count', 'is_component', 'full_name',
            'has_pending_price_change', 'has_scheduled_price_change', 'price_workflow_status',
            'next_price_effective_at', 'next_price_cost', 'next_price_sale',
            'next_price_commission_per_unit', 'next_price_commission_percent',
            'blocking_tasks_count',
            'bundle_definition', 'bundle_id', 'bundle_components',
            'bundle_pricing_mode', 'bundle_commission_mode', 'bundle_delivery_rule',
            'bundle_primary_product_id', 'bundle_primary_product_name',
            'resolved_bundle_cost_price', 'resolved_bundle_sale_price',
            'resolved_bundle_commission_per_unit', 'resolved_bundle_commission_percent',
            'operations', 'routing_steps', 'print_colors',
        ]
        extra_kwargs = {
            'code': {
                'allow_blank': True,
                'required': False,
                'default': '',
                'error_messages': {'unique': 'Mã hàng này đã tồn tại, hãy đổi lại.'},
            },
        }

    def _request_user(self):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user and getattr(user, 'is_authenticated', False):
            return user
        return None

    def _normalize_print_color_fields(self, data):
        print_colors_touched = any(field in data for field in Product.PRINT_COLOR_FIELDS)
        print_colors_count = 0

        for field in Product.PRINT_COLOR_FIELDS:
            if field in data:
                data[field] = (data.get(field) or '').strip()
                value = data[field]
            elif self.instance is not None:
                value = getattr(self.instance, field, '') or ''
            else:
                value = ''

            if str(value).strip():
                print_colors_count += 1

        if print_colors_count > 0:
            data['color_count'] = print_colors_count
        elif print_colors_touched:
            if self.instance is not None and int(getattr(self.instance, 'color_count', 0) or 0) > 0:
                data.pop('color_count', None)
            else:
                data['color_count'] = 0

    def _operation_lookup_by_id(self):
        lookup = self.context.get('_operation_lookup_by_id')
        if lookup is None:
            lookup = {operation.id: operation for operation in Operation.objects.all()}
            self.context['_operation_lookup_by_id'] = lookup
        return lookup

    def _resolve_operations_input(self, operations_data):
        operation_lookup = self._operation_lookup()
        operation_lookup_by_id = self._operation_lookup_by_id()
        resolved_operations = []
        seen_operation_codes = set()
        errors = {}

        for index, item in enumerate(operations_data):
            operation_id = item.get('operation_id')
            operation_code = (item.get('operation_code') or '').strip().upper()
            operation = None
            if operation_id:
                operation = operation_lookup_by_id.get(operation_id)
                if operation is None:
                    errors[index] = {'operation_id': 'Operation does not exist.'}
                    continue
                if operation_code and operation.code != operation_code:
                    errors[index] = {'operation_code': 'operation_code does not match operation_id.'}
                    continue
            else:
                operation = operation_lookup.get(operation_code)
                if operation is None:
                    errors[index] = {'operation_code': 'Operation does not exist.'}
                    continue

            if operation.code in seen_operation_codes:
                errors[index] = {'operation_code': 'Duplicate operation in operations_input.'}
                continue
            seen_operation_codes.add(operation.code)

            resolved_operations.append({
                'operation': operation,
                'operation_code': operation.code,
                'standard_rate_per_hour': item.get('standard_rate_per_hour'),
                'note': item.get('note', ''),
                'sequence': item.get('sequence') if item.get('sequence') is not None else operation.sequence,
                'is_active': item.get('is_active', True),
            })

        if errors:
            raise serializers.ValidationError({'operations_input': errors})
        return resolved_operations

    def _resolve_routing_input(self, routing_data):
        operation_lookup = self._operation_lookup()
        operation_lookup_by_id = self._operation_lookup_by_id()
        resolved_steps = []
        errors = {}

        for index, item in enumerate(routing_data):
            operation_id = item.get('operation_id')
            operation_code = (item.get('operation_code') or '').strip().upper()
            operation = None

            if operation_id:
                operation = operation_lookup_by_id.get(operation_id)
                if operation is None:
                    errors[index] = {'operation_id': 'Operation does not exist.'}
                    continue
                if operation_code and operation.code != operation_code:
                    errors[index] = {'operation_code': 'operation_code does not match operation_id.'}
                    continue
            else:
                operation = operation_lookup.get(operation_code)
                if operation is None:
                    errors[index] = {'operation_code': 'Operation does not exist.'}
                    continue

            if not operation.is_active:
                errors[index] = {'operation_code': 'Operation is not active.'}
                continue

            display_order = item.get('display_order')
            resolved_steps.append({
                'operation': operation,
                'operation_code': operation.code,
                'step_no': item['step_no'],
                'display_order': display_order if display_order is not None else (index + 1) * 10,
                'standard_rate_per_hour': item['standard_rate_per_hour'],
                'note': item.get('note', ''),
                'step_type': item.get('step_type', ProductRoutingStep.StepType.REQUIRED),
                'group_code': item.get('group_code', ''),
                'is_required': item.get('is_required', True),
                'allow_parallel': item.get('allow_parallel', False),
            })

        if errors:
            raise serializers.ValidationError({'routing_input': errors})
        return resolved_steps

    def _apply_operations_input_to_process_fields(self, data, resolved_operations):
        for field_name in LEGACY_PROCESS_FIELDS:
            data[field_name] = None
        for item in resolved_operations:
            if not item['is_active']:
                continue
            field_name = LEGACY_PROCESS_FIELD_BY_OPERATION_CODE.get(item['operation_code'])
            if field_name:
                data[field_name] = item['standard_rate_per_hour']

    @staticmethod
    def _positive_int(value):
        try:
            number = int(value or 0)
        except (TypeError, ValueError):
            return 0
        return number if number > 0 else 0

    def _clear_product_operation_cache(self, product):
        if hasattr(product, 'prefetched_product_operations'):
            delattr(product, 'prefetched_product_operations')
        prefetched_cache = getattr(product, '_prefetched_objects_cache', None)
        if prefetched_cache is not None:
            prefetched_cache.pop('operations', None)

    def _clear_product_routing_cache(self, product):
        if hasattr(product, 'prefetched_routing_steps'):
            delattr(product, 'prefetched_routing_steps')
        prefetched_cache = getattr(product, '_prefetched_objects_cache', None)
        if prefetched_cache is not None:
            prefetched_cache.pop('routing_steps', None)

    def _save_product_operation(self, product, operation, rate, note=None, sequence=None):
        user = self._request_user()
        product_operation, created = ProductOperation.objects.get_or_create(
            product=product,
            operation=operation,
            defaults={
                'operation_code': operation.code,
                'operation_name': operation.name,
                'sequence': sequence if sequence is not None else operation.sequence,
                'standard_rate_per_hour': rate,
                'note': note or '',
                'is_active': True,
                'created_by': user,
                'updated_by': user,
            },
        )
        if not created:
            product_operation.operation_code = operation.code
            product_operation.operation_name = operation.name
            product_operation.sequence = sequence if sequence is not None else operation.sequence
            product_operation.standard_rate_per_hour = rate
            if note is not None:
                product_operation.note = note
            product_operation.is_active = True
            product_operation.updated_by = user
            product_operation.save()
        return product_operation

    def _deactivate_product_operation(self, product, operation):
        user = self._request_user()
        updates = {'is_active': False}
        if user:
            updates['updated_by'] = user
        ProductOperation.objects.filter(product=product, operation=operation).update(**updates)

    def _sync_product_operations_from_input(self, product, resolved_operations):
        provided_operation_codes = set()
        for item in resolved_operations:
            operation = item['operation']
            provided_operation_codes.add(operation.code)
            if item['is_active']:
                self._save_product_operation(
                    product=product,
                    operation=operation,
                    rate=item['standard_rate_per_hour'],
                    note=item.get('note', ''),
                    sequence=item.get('sequence'),
                )
            else:
                self._deactivate_product_operation(product, operation)

        stale_operations = ProductOperation.objects.filter(product=product).exclude(
            operation__code__in=provided_operation_codes
        )
        user = self._request_user()
        stale_updates = {'is_active': False}
        if user:
            stale_updates['updated_by'] = user
        stale_operations.update(**stale_updates)
        self._clear_product_operation_cache(product)

    def _sync_product_operations_from_legacy_process_fields(self, product):
        operation_lookup = self._operation_lookup()
        for field_name, operation_code, _fallback_name, _fallback_sequence in LEGACY_PROCESS_OPERATION_MAP:
            operation = operation_lookup.get(operation_code)
            if operation is None:
                continue
            rate = self._positive_int(getattr(product, field_name, None))
            if rate:
                self._save_product_operation(
                    product=product,
                    operation=operation,
                    rate=rate,
                    sequence=operation.sequence,
                )
            else:
                self._deactivate_product_operation(product, operation)
        self._clear_product_operation_cache(product)

    def _sync_product_routing_steps_from_input(self, product, resolved_steps):
        ProductRoutingStep.objects.filter(product=product, is_active=True).update(is_active=False)

        new_steps = []
        for item in resolved_steps:
            operation = item['operation']
            product_operation = ProductOperation.objects.filter(
                product=product,
                operation=operation,
                is_active=True,
            ).first()
            new_steps.append(ProductRoutingStep(
                product=product,
                operation=operation,
                product_operation=product_operation,
                step_no=item['step_no'],
                display_order=item['display_order'],
                standard_rate_per_hour=item['standard_rate_per_hour'],
                note=item.get('note', ''),
                step_type=item.get('step_type', ProductRoutingStep.StepType.REQUIRED),
                group_code=item.get('group_code', ''),
                is_required=item.get('is_required', True),
                allow_parallel=item.get('allow_parallel', False),
                is_active=True,
            ))

        for step in new_steps:
            step.save()
        self._clear_product_routing_cache(product)

    def get_operations(self, obj):
        active_operations = self._get_active_product_operations(obj)
        if active_operations:
            return ProductOperationSerializer(active_operations, many=True).data
        return self._build_legacy_process_operations(obj)

    def get_routing_steps(self, obj):
        custom_steps = self._build_custom_routing_steps(obj)
        if custom_steps:
            return ProductRoutingStepSerializer(
                self._assign_routing_display_steps(custom_steps),
                many=True,
            ).data

        default_steps = self._build_default_routing_steps_from_product_operations(obj)
        if default_steps:
            return ProductRoutingStepSerializer(
                self._assign_routing_display_steps(default_steps),
                many=True,
            ).data

        return ProductRoutingStepSerializer(
            self._assign_routing_display_steps(self._build_legacy_process_routing_steps(obj)),
            many=True,
        ).data

    def get_print_colors(self, obj):
        return [
            value
            for value in ((getattr(obj, field, '') or '').strip() for field in Product.PRINT_COLOR_FIELDS)
            if value
        ]

    def _get_active_product_routing_steps(self, obj):
        prefetched = getattr(obj, 'prefetched_routing_steps', None)
        if prefetched is not None:
            steps = [step for step in prefetched if step.is_active]
            return sorted(steps, key=lambda item: (item.step_no or 0, item.display_order or 0, item.id or 0))
        return list(
            obj.routing_steps
            .filter(is_active=True)
            .select_related('operation', 'product_operation')
            .order_by('step_no', 'display_order', 'id')
        )

    def _get_active_product_operations(self, obj):
        prefetched = getattr(obj, 'prefetched_product_operations', None)
        if prefetched is not None:
            operations = [operation for operation in prefetched if operation.is_active]
            return sorted(operations, key=lambda item: (item.sequence or 0, item.operation_code or '', item.id or 0))
        return list(
            obj.operations
            .filter(is_active=True)
            .select_related('operation')
            .order_by('sequence', 'operation_code', 'id')
        )

    @staticmethod
    def _assign_routing_display_steps(steps):
        display_step_by_step_no = {}
        display_step = 0
        sorted_steps = sorted(
            steps,
            key=lambda item: (
                item.get('step_no') or 0,
                item.get('display_order') or 0,
                item.get('id') or 0,
                item.get('operation_code') or '',
            ),
        )
        for item in sorted_steps:
            step_no = item.get('step_no') or 0
            if step_no not in display_step_by_step_no:
                display_step += 1
                display_step_by_step_no[step_no] = display_step
            item['display_step'] = display_step_by_step_no[step_no]
        return sorted_steps

    @staticmethod
    def _routing_step_payload(
        *,
        route_step_id=None,
        operation_id=None,
        product_operation_id=None,
        step_no,
        display_order,
        operation_code,
        operation_name,
        standard_rate_per_hour,
        source='',
        note='',
        step_type=ProductRoutingStep.StepType.REQUIRED,
        group_code='',
        is_required=True,
        allow_parallel=False,
        is_active=True,
    ):
        return {
            'id': route_step_id,
            'route_step_id': route_step_id,
            'operation_id': operation_id,
            'product_operation_id': product_operation_id,
            'step_no': step_no,
            'display_step': 0,
            'display_order': display_order,
            'operation_code': operation_code,
            'operation_name': operation_name,
            'standard_rate_per_hour': standard_rate_per_hour,
            'note': note or '',
            'step_type': step_type,
            'group_code': group_code or '',
            'is_required': is_required,
            'allow_parallel': allow_parallel,
            'source': source,
            'is_active': is_active,
        }

    def _build_custom_routing_steps(self, obj):
        payload = []
        for step in self._get_active_product_routing_steps(obj):
            operation = getattr(step, 'operation', None)
            product_operation = getattr(step, 'product_operation', None)
            payload.append(self._routing_step_payload(
                route_step_id=step.id,
                operation_id=step.operation_id,
                product_operation_id=step.product_operation_id,
                step_no=step.step_no,
                display_order=step.display_order,
                operation_code=step.operation_code or (operation.code if operation else ''),
                operation_name=step.operation_name or (operation.name if operation else ''),
                standard_rate_per_hour=step.standard_rate_per_hour,
                note=step.note,
                step_type=step.step_type,
                group_code=step.group_code,
                is_required=step.is_required,
                allow_parallel=step.allow_parallel,
                source='product_routing',
                is_active=step.is_active,
            ))
            if product_operation and not payload[-1]['product_operation_id']:
                payload[-1]['product_operation_id'] = product_operation.id
        return payload

    def _build_default_routing_steps_from_product_operations(self, obj):
        payload = []
        for product_operation in self._get_active_product_operations(obj):
            operation = getattr(product_operation, 'operation', None)
            step_no = product_operation.sequence or (operation.sequence if operation else 0)
            payload.append(self._routing_step_payload(
                route_step_id=None,
                operation_id=product_operation.operation_id,
                product_operation_id=product_operation.id,
                step_no=step_no,
                display_order=step_no,
                operation_code=product_operation.operation_code or (operation.code if operation else ''),
                operation_name=product_operation.operation_name or (operation.name if operation else ''),
                standard_rate_per_hour=product_operation.standard_rate_per_hour,
                note=product_operation.note,
                step_type=ProductRoutingStep.StepType.REQUIRED,
                group_code='',
                is_required=True,
                allow_parallel=False,
                source='product_operations_default',
                is_active=product_operation.is_active,
            ))
        return payload

    def _build_legacy_process_routing_steps(self, obj):
        operation_lookup = self._operation_lookup()
        payload = []
        for field_name, operation_code, fallback_name, fallback_sequence in LEGACY_PROCESS_OPERATION_MAP:
            raw_rate = getattr(obj, field_name, None)
            try:
                rate = int(raw_rate or 0)
            except (TypeError, ValueError):
                rate = 0
            if rate <= 0:
                continue
            operation = operation_lookup.get(operation_code)
            step_no = operation.sequence if operation else fallback_sequence
            payload.append(self._routing_step_payload(
                route_step_id=None,
                operation_id=operation.id if operation else None,
                product_operation_id=None,
                step_no=step_no,
                display_order=step_no,
                operation_code=operation_code,
                operation_name=operation.name if operation else fallback_name,
                standard_rate_per_hour=rate,
                note='',
                step_type=ProductRoutingStep.StepType.REQUIRED,
                group_code='',
                is_required=True,
                allow_parallel=False,
                source='legacy_process_fields',
                is_active=True,
            ))
        return payload

    def _operation_lookup(self):
        lookup = self.context.get('_operation_lookup')
        if lookup is None:
            lookup = {operation.code: operation for operation in Operation.objects.all()}
            self.context['_operation_lookup'] = lookup
        return lookup

    def _build_legacy_process_operations(self, obj):
        operation_lookup = self._operation_lookup()
        payload = []
        for field_name, operation_code, fallback_name, fallback_sequence in LEGACY_PROCESS_OPERATION_MAP:
            raw_rate = getattr(obj, field_name, None)
            try:
                rate = int(raw_rate or 0)
            except (TypeError, ValueError):
                rate = 0
            if rate <= 0:
                continue
            operation = operation_lookup.get(operation_code)
            payload.append({
                'id': None,
                'operation_id': operation.id if operation else None,
                'operation_code': operation_code,
                'operation_name': operation.name if operation else fallback_name,
                'sequence': operation.sequence if operation else fallback_sequence,
                'standard_rate_per_hour': rate,
                'note': '',
                'is_active': True,
            })
        return payload

    def get_category_name(self, obj):
        return f"{obj.category.code} - {obj.category.name}" if obj.category else None

    def get_unit_name(self, obj):
        return f"{obj.unit.code} - {obj.unit.name}" if obj.unit else None

    def get_wave_name(self, obj):
        return obj.wave.name if obj.wave else None

    def get_wave_code(self, obj):
        return obj.wave.code if obj.wave else None

    def get_box_type_name(self, obj):
        return obj.box_type.name if obj.box_type else None

    def get_box_type_code(self, obj):
        return obj.box_type.code if obj.box_type else None

    def get_owner_name(self, obj):
        return obj.owner.get_full_name() if obj.owner else None

    def get_team_name(self, obj):
        return obj.team.name if obj.team else None

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() if obj.created_by else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.get_full_name() if obj.updated_by else None

    def get_parent_name(self, obj):
        return obj.parent.name if obj.parent else None

    def _bundle(self, obj):
        try:
            return obj.bundle_config
        except ProductBundle.DoesNotExist:
            return None

    @staticmethod
    def _normalize_component_quantity(value):
        if value is None:
            return None
        numeric = float(value)
        return int(numeric) if numeric.is_integer() else numeric

    def get_components(self, obj):
        if self.context.get('skip_components'):
            return []
        bundle = self._bundle(obj)
        if bundle and bundle.is_active:
            payload = []
            for component in bundle.get_active_components():
                if component.component_product_id == obj.id:
                    continue
                item = ProductSerializer(
                    component.component_product,
                    context={'skip_components': True},
                ).data
                item['component_quantity'] = self._normalize_component_quantity(component.qty_per_bundle)
                item['parent'] = obj.id
                item['parent_name'] = obj.name
                payload.append(item)
            return payload
        if obj.is_set:
            components = obj.components.filter(is_active=True)
            return ProductSerializer(
                components, many=True, context={'skip_components': True}
            ).data
        return []

    def get_components_count(self, obj):
        bundle = self._bundle(obj)
        if bundle and bundle.is_active:
            return bundle.components.exclude(component_product=obj).count()
        return getattr(obj, 'components_count', obj.components.count()) if hasattr(obj, 'components') else 0

    def get_is_component(self, obj):
        return obj.is_component

    def get_full_name(self, obj):
        return obj.full_name

    def get_blocking_tasks_count(self, obj):
        # Dùng annotated value từ get_queryset để tránh N+1 query
        if hasattr(obj, 'blocking_tasks_count_db'):
            return obj.blocking_tasks_count_db or 0
        return Task.objects.filter(
            entity_type='Product',
            entity_id=obj.id,
            is_blocking=True,
            status__in=[Task.STATUS_TODO, Task.STATUS_IN_PROGRESS],
        ).count()

    def get_price_workflow_status(self, obj):
        if getattr(obj, 'has_pending_price_change', False):
            return 'PENDING_APPROVAL'
        if getattr(obj, 'has_scheduled_price_change', False):
            return 'APPROVED_SCHEDULED'
        return 'ACTIVE_APPLIED'

    def get_bundle_definition(self, obj):
        bundle = self._bundle(obj)
        if not bundle or not bundle.is_active:
            return None
        return ProductBundleSerializer(bundle, context=self.context).data

    def get_bundle_id(self, obj):
        bundle = self._bundle(obj)
        return bundle.id if bundle and bundle.is_active else None

    def get_bundle_components(self, obj):
        bundle = self._bundle(obj)
        if not bundle or not bundle.is_active:
            return []
        return ProductBundleComponentSerializer(bundle.get_active_components(), many=True).data

    def get_bundle_pricing_mode(self, obj):
        bundle = self._bundle(obj)
        return bundle.pricing_mode if bundle and bundle.is_active else None

    def get_bundle_commission_mode(self, obj):
        bundle = self._bundle(obj)
        return bundle.get_commission_mode() if bundle and bundle.is_active else None

    def get_bundle_delivery_rule(self, obj):
        bundle = self._bundle(obj)
        return bundle.delivery_rule if bundle and bundle.is_active else None

    def get_bundle_primary_product_id(self, obj):
        bundle = self._bundle(obj)
        if not bundle or not bundle.is_active:
            return None
        primary = bundle.get_primary_product()
        return primary.id if primary else None

    def get_bundle_primary_product_name(self, obj):
        bundle = self._bundle(obj)
        if not bundle or not bundle.is_active:
            return None
        primary = bundle.get_primary_product()
        return primary.name if primary else None

    def get_resolved_bundle_cost_price(self, obj):
        bundle = self._bundle(obj)
        if not bundle or not bundle.is_active:
            return str(obj.cost_price or 0)
        return str(bundle.resolve_cost_price())

    def get_resolved_bundle_sale_price(self, obj):
        bundle = self._bundle(obj)
        if not bundle or not bundle.is_active:
            return str(obj.sale_price or 0)
        return str(bundle.resolve_sale_price())

    def get_resolved_bundle_commission_per_unit(self, obj):
        bundle = self._bundle(obj)
        if not bundle or not bundle.is_active:
            return str(obj.commission_per_unit or 0)
        return str(bundle.resolve_commission_per_unit())

    def get_resolved_bundle_commission_percent(self, obj):
        bundle = self._bundle(obj)
        if not bundle or not bundle.is_active:
            return str(obj.commission_percent or 0)
        return str(bundle.resolve_commission_percent())

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if self.context.get('skip_components'):
            data['components'] = []
        return data

    def validate_code(self, value):
        """Kiểm tra mã hàng không trùng khi có giá trị."""
        value = (value or '').strip()
        if not value:
            return value
        qs = Product.objects.filter(code__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('Mã hàng này đã tồn tại, hãy đổi lại.')
        return value

    def validate(self, data):
        if data.get('parent') and not data.get('component_quantity'):
            data['component_quantity'] = 1

        # Khi update (partial), chỉ validate nếu field được gửi lên
        # Khi create, validate bắt buộc
        is_partial = self.partial if hasattr(self, 'partial') else False
        
        # Kiểm tra unit - chỉ validate nếu được gửi lên hoặc đang create
        unit_value = data.get('unit')
        if unit_value is not None:
            # Nếu có giá trị nhưng là 0 hoặc None, báo lỗi
            if not unit_value:
                raise serializers.ValidationError({'unit': 'Vui lòng chọn ĐVT (bắt buộc).'})
        elif not is_partial:
            # Khi create, unit là bắt buộc
            raise serializers.ValidationError({'unit': 'Vui lòng chọn ĐVT (bắt buộc).'})
        
        # Wave và box_type là optional - không validate bắt buộc

        skip_price_floor_validation = bool(data.get('skip_price_floor_validation'))
        effective_cost = data.get('cost_price')
        effective_sale = data.get('sale_price')
        if self.instance:
            if effective_cost is None:
                effective_cost = getattr(self.instance, 'cost_price', None)
            if effective_sale is None:
                effective_sale = getattr(self.instance, 'sale_price', None)
        if not skip_price_floor_validation and effective_cost is not None and effective_sale is not None:
            if effective_cost > effective_sale:
                raise serializers.ValidationError({
                    'sale_price': 'Giá bán phải lớn hơn giá vốn'
                })

        # Nếu cập nhật giá vốn/đơn giá/hoa hồng thì bắt buộc ghi lý do đổi giá.
        if self.instance:
            price_touched = False
            price_fields = [
                'cost_price',
                'sale_price',
                'commission_per_unit',
                'commission_percent',
            ]
            for field in price_fields:
                if field in data and data.get(field) != getattr(self.instance, field, None):
                    price_touched = True
                    break
            if price_touched:
                reason = (data.get('price_change_reason') or '').strip()
                if not reason:
                    raise serializers.ValidationError({
                        'price_change_reason': 'Vui lòng nhập lý do khi thay đổi giá hoặc hoa hồng.'
                })

        effective_product_kind = data.get('product_kind')
        if effective_product_kind is None and self.instance:
            effective_product_kind = getattr(self.instance, 'product_kind', Product.ProductKind.SPECIFIC)
        if effective_product_kind == Product.ProductKind.GENERIC:
            data['requires_order_spec'] = True
            data['requires_order_operations_review'] = True

        self._normalize_print_color_fields(data)

        operations_input = data.get('operations_input')
        if operations_input is not None:
            resolved_operations = self._resolve_operations_input(operations_input)
            data['_resolved_operations_input'] = resolved_operations
            self._apply_operations_input_to_process_fields(data, resolved_operations)

        routing_input = data.get('routing_input')
        if routing_input is not None:
            data['_resolved_routing_input'] = self._resolve_routing_input(routing_input)

        for field in LEGACY_PROCESS_FIELDS:
            if data.get(field) is not None and data[field] < 0:
                raise serializers.ValidationError({
                    field: 'Định mức phải lớn hơn 0'
                })

        return data

    def create(self, validated_data):
        operations_input = validated_data.pop('_resolved_operations_input', None)
        routing_input = validated_data.pop('_resolved_routing_input', None)
        validated_data.pop('operations_input', None)
        validated_data.pop('routing_input', None)
        # Remove write-only fields that are not model fields
        validated_data.pop('price_change_reason', None)
        validated_data.pop('price_effective_at', None)
        validated_data.pop('skip_price_floor_validation', None)
        
        user = self._request_user()
        if user:
            validated_data['created_by'] = user
            validated_data['updated_by'] = user
        with transaction.atomic():
            product = super().create(validated_data)
            if operations_input is not None:
                self._sync_product_operations_from_input(product, operations_input)
            else:
                self._sync_product_operations_from_legacy_process_fields(product)
            if routing_input is not None:
                self._sync_product_routing_steps_from_input(product, routing_input)
        return product

    def update(self, instance, validated_data):
        operations_input = validated_data.pop('_resolved_operations_input', None)
        routing_input = validated_data.pop('_resolved_routing_input', None)
        validated_data.pop('operations_input', None)
        validated_data.pop('routing_input', None)
        legacy_process_touched = any(field in validated_data for field in LEGACY_PROCESS_FIELDS)
        validated_data.pop('price_change_reason', None)
        validated_data.pop('price_effective_at', None)
        validated_data.pop('skip_price_floor_validation', None)
        user = self._request_user()
        if user:
            validated_data['updated_by'] = user
        with transaction.atomic():
            product = super().update(instance, validated_data)
            if operations_input is not None:
                self._sync_product_operations_from_input(product, operations_input)
            elif legacy_process_touched:
                self._sync_product_operations_from_legacy_process_fields(product)
            if routing_input is not None:
                self._sync_product_routing_steps_from_input(product, routing_input)
        return product

    def validate_sale_price(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("Giá bán không được âm")
        return value

    def validate_cost_price(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("Giá vốn không được âm")
        return value


class PriceChangeSerializer(serializers.ModelSerializer):
    product_code = serializers.CharField(source='product.code', read_only=True)
    submitted_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PriceChange
        fields = [
            'id', 'product', 'product_code',
            'old_cost_price', 'new_cost_price', 'old_sale_price', 'new_sale_price',
            'old_commission_per_unit', 'new_commission_per_unit',
            'old_commission_percent', 'new_commission_percent',
            'delta_cost', 'delta_sale', 'delta_cost_percent', 'delta_sale_percent',
            'reason', 'source', 'effective_at', 'applied_at', 'status', 'batch_code',
            'submitted_by', 'submitted_by_name',
            'approved_by', 'approved_by_name', 'approved_at', 'reject_reason',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'product_code',
            'delta_cost', 'delta_sale', 'delta_cost_percent', 'delta_sale_percent',
            'submitted_by_name', 'approved_by_name',
            'created_at', 'updated_at',
        ]

    def get_submitted_by_name(self, obj):
        return obj.submitted_by.username if obj.submitted_by else None

    def get_approved_by_name(self, obj):
        return obj.approved_by.username if obj.approved_by else None


class BundlePriceChangeSerializer(serializers.ModelSerializer):
    bundle = serializers.IntegerField(source='bundle.id', read_only=True)
    sellable_product = serializers.IntegerField(source='bundle.sellable_product_id', read_only=True)
    product_code = serializers.CharField(source='bundle.sellable_product.code', read_only=True)
    submitted_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    old_cost_price = serializers.DecimalField(source='old_fixed_cost_price', max_digits=15, decimal_places=2, read_only=True)
    new_cost_price = serializers.DecimalField(source='new_fixed_cost_price', max_digits=15, decimal_places=2, read_only=True)
    old_sale_price = serializers.DecimalField(source='old_fixed_sale_price', max_digits=15, decimal_places=2, read_only=True)
    new_sale_price = serializers.DecimalField(source='new_fixed_sale_price', max_digits=15, decimal_places=2, read_only=True)
    old_commission_per_unit = serializers.DecimalField(source='old_fixed_commission_per_unit', max_digits=10, decimal_places=2, read_only=True)
    new_commission_per_unit = serializers.DecimalField(source='new_fixed_commission_per_unit', max_digits=10, decimal_places=2, read_only=True)
    old_commission_percent = serializers.DecimalField(source='old_fixed_commission_percent', max_digits=5, decimal_places=2, read_only=True)
    new_commission_percent = serializers.DecimalField(source='new_fixed_commission_percent', max_digits=5, decimal_places=2, read_only=True)
    record_scope = serializers.SerializerMethodField()

    class Meta:
        model = BundlePriceChange
        fields = [
            'id', 'bundle', 'sellable_product', 'product_code', 'record_scope',
            'old_cost_price', 'new_cost_price', 'old_sale_price', 'new_sale_price',
            'old_commission_per_unit', 'new_commission_per_unit',
            'old_commission_percent', 'new_commission_percent',
            'delta_cost', 'delta_sale', 'delta_cost_percent', 'delta_sale_percent',
            'reason', 'source', 'effective_at', 'applied_at', 'status', 'batch_code',
            'submitted_by', 'submitted_by_name',
            'approved_by', 'approved_by_name', 'approved_at', 'reject_reason',
            'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_submitted_by_name(self, obj):
        return obj.submitted_by.username if obj.submitted_by else None

    def get_approved_by_name(self, obj):
        return obj.approved_by.username if obj.approved_by else None

    def get_record_scope(self, obj):
        return 'BUNDLE_FIXED'
