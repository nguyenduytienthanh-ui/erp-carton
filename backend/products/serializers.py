from rest_framework import serializers
from .models import ProductCategory, ProductUnit, ProductWave, ProductBoxType, Product


class ProductCategorySerializer(serializers.ModelSerializer):
    """Serialize ProductCategory với hỗ trợ cây danh mục"""
    
    parent_name = serializers.SerializerMethodField()
    children_count = serializers.SerializerMethodField()
    
    class Meta:
        model = ProductCategory
        fields = [
            'id', 'code', 'name', 'description', 'parent', 'parent_name',
            'children_count', 'is_active', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'parent_name', 'children_count']
    
    def get_parent_name(self, obj):
        return f"{obj.parent.code} - {obj.parent.name}" if obj.parent else None
    
    def get_children_count(self, obj):
        return obj.children.filter(is_active=True).count()


class ProductUnitSerializer(serializers.ModelSerializer):
    """Serialize ProductUnit (đơn giản)"""
    
    class Meta:
        model = ProductUnit
        fields = ['id', 'code', 'name', 'is_active', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


class ProductWaveSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductWave
        fields = ['id', 'code', 'name', 'description', 'is_active', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


class ProductBoxTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductBoxType
        fields = ['id', 'code', 'name', 'description', 'is_active', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


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

    components = serializers.SerializerMethodField()
    components_count = serializers.SerializerMethodField()
    is_component = serializers.SerializerMethodField()
    full_name = serializers.SerializerMethodField()

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
            'created_at', 'updated_at', 'created_by', 'created_by_name',
            'updated_by', 'updated_by_name',
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at',
            'category_name', 'unit_name', 'wave_name', 'wave_code',
            'box_type_name', 'box_type_code', 'owner_name', 'team_name',
            'created_by_name', 'updated_by_name', 'parent_name',
            'components', 'components_count', 'is_component', 'full_name',
        ]

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

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if self.context.get('skip_components'):
            data['components'] = []
        return data

    def validate(self, data):
        if data.get('parent') and not data.get('component_quantity'):
            data['component_quantity'] = 1

        if data.get('cost_price') is not None and data.get('sale_price') is not None:
            if data['cost_price'] > data['sale_price']:
                raise serializers.ValidationError({
                    'sale_price': 'Giá bán phải lớn hơn giá vốn'
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
