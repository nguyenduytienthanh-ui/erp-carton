from rest_framework import serializers
from .models import ProductCategory, ProductUnit, ProductWave, ProductBoxType, Product, PriceChange
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
    price_change_reason = serializers.CharField(write_only=True, required=False, allow_blank=True, default='')
    price_effective_at = serializers.DateTimeField(
        write_only=True,
        required=False,
        allow_null=True,
        input_formats=['%Y-%m-%dT%H:%M', '%Y-%m-%dT%H:%M:%S', 'iso-8601'],
    )

    components = serializers.SerializerMethodField()
    components_count = serializers.SerializerMethodField()
    is_component = serializers.SerializerMethodField()
    full_name = serializers.SerializerMethodField()
    blocking_tasks_count = serializers.SerializerMethodField()

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
            'is_component', 'full_name',
            'status', 'owner', 'owner_name', 'team', 'team_name', 'is_active',
            'has_pending_price_change',
            'blocking_tasks_count',
            'created_at', 'updated_at', 'created_by', 'created_by_name',
            'updated_by', 'updated_by_name',
            'price_change_reason', 'price_effective_at',
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at',
            'category_name', 'unit_name', 'wave_name', 'wave_code',
            'box_type_name', 'box_type_code', 'owner_name', 'team_name',
            'created_by_name', 'updated_by_name', 'parent_name',
            'components', 'components_count', 'is_component', 'full_name',
            'has_pending_price_change', 'blocking_tasks_count',
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

    def get_components(self, obj):
        if obj.is_set:
            components = obj.components.filter(is_active=True)
            return ProductSerializer(
                components, many=True, context={'skip_components': True}
            ).data
        return []

    def get_components_count(self, obj):
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
        
        # Kiểm tra wave - chỉ validate nếu được gửi lên hoặc đang create
        wave_value = data.get('wave')
        if wave_value is not None:
            if not wave_value:
                raise serializers.ValidationError({'wave': 'Vui lòng chọn Sóng (bắt buộc).'})
        elif not is_partial:
            raise serializers.ValidationError({'wave': 'Vui lòng chọn Sóng (bắt buộc).'})
        
        # Kiểm tra box_type - chỉ validate nếu được gửi lên hoặc đang create
        box_type_value = data.get('box_type')
        if box_type_value is not None:
            if not box_type_value:
                raise serializers.ValidationError({'box_type': 'Vui lòng chọn Kiểu (bắt buộc).'})
        elif not is_partial:
            raise serializers.ValidationError({'box_type': 'Vui lòng chọn Kiểu (bắt buộc).'})

        if data.get('cost_price') is not None and data.get('sale_price') is not None:
            if data['cost_price'] > data['sale_price']:
                raise serializers.ValidationError({
                    'sale_price': 'Giá bán phải lớn hơn giá vốn'
                })

        # Nếu cập nhật giá vốn/đơn giá thì bắt buộc ghi lý do đổi giá.
        if self.instance:
            price_touched = False
            if 'cost_price' in data and data.get('cost_price') != getattr(self.instance, 'cost_price', None):
                price_touched = True
            if 'sale_price' in data and data.get('sale_price') != getattr(self.instance, 'sale_price', None):
                price_touched = True
            if price_touched:
                reason = (data.get('price_change_reason') or '').strip()
                if not reason:
                    raise serializers.ValidationError({
                        'price_change_reason': 'Vui lòng nhập lý do khi thay đổi giá bán/mua.'
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
        request = self.context.get('request')
        if request and request.user:
            validated_data['created_by'] = request.user
            validated_data['updated_by'] = request.user
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop('price_change_reason', None)
        validated_data.pop('price_effective_at', None)
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
            'delta_cost', 'delta_sale', 'delta_cost_percent', 'delta_sale_percent',
            'reason', 'source', 'effective_at', 'status',
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
