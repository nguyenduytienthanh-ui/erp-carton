from rest_framework import serializers
from .models import (
    ProductCategory,
    ProductUnit,
    ProductWave,
    ProductBoxType,
    Product,
    ProductBundle,
    ProductBundleComponent,
    PriceChange,
    BundlePriceChange,
)
from core.models import Task


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

    class Meta:
        model = Product
        fields = [
            'id', 'code', 'name', 'description',
            'category', 'category_name',
            'unit', 'unit_name',
            'size_order', 'size_production',
            'wave', 'wave_name', 'wave_code',
            'box_type', 'box_type_name', 'box_type_code',
            'cost_price', 'sale_price', 'min_stock',
            'delivery_tolerance', 'commission_per_unit', 'commission_percent',
            'process_xa', 'process_in', 'process_boi', 'process_can_mang',
            'process_be', 'process_chap', 'process_dong', 'process_dan', 'process_khac',
            'film_code', 'film_file_url', 'color_count',
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
        ]
        extra_kwargs = {
            'code': {
                'allow_blank': True,
                'required': False,
                'default': '',
                'error_messages': {'unique': 'Mã hàng này đã tồn tại, hãy đổi lại.'},
            },
        }

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

        process_fields = [
            'process_xa', 'process_in', 'process_boi', 'process_can_mang',
            'process_be', 'process_chap', 'process_dong', 'process_dan', 'process_khac',
        ]
        for field in process_fields:
            if data.get(field) is not None and data[field] < 0:
                raise serializers.ValidationError({
                    field: 'Định mức phải lớn hơn 0'
                })

        return data

    def create(self, validated_data):
        # Remove write-only fields that are not model fields
        validated_data.pop('price_change_reason', None)
        validated_data.pop('price_effective_at', None)
        validated_data.pop('skip_price_floor_validation', None)
        
        request = self.context.get('request')
        if request and request.user:
            validated_data['created_by'] = request.user
            validated_data['updated_by'] = request.user
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop('price_change_reason', None)
        validated_data.pop('price_effective_at', None)
        validated_data.pop('skip_price_floor_validation', None)
        request = self.context.get('request')
        if request and request.user:
            validated_data['updated_by'] = request.user
        return super().update(instance, validated_data)

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
