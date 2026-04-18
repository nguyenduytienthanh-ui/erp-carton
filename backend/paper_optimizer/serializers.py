from rest_framework import serializers

from .models import PaperOptimizerRun, PaperOptimizerSupplierTemplate
from .services import normalize_result_payload_for_display

STANDARD_RAW_WIDTHS_CM = tuple(range(110, 281, 5))
MANDATORY_MIN_PURCHASE_LENGTH_CM = 5000.0


class PaperOptimizerLineSerializer(serializers.Serializer):
    id = serializers.CharField(required=False, allow_blank=True)
    note = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    quantity = serializers.IntegerField(min_value=1)
    width_cm = serializers.FloatField(min_value=0.01)
    length_cm = serializers.FloatField(min_value=0.01)
    source_row_number = serializers.IntegerField(required=False, allow_null=True)


class PaperOptimizerSupplierConfigSerializer(serializers.Serializer):
    trim_edge_cm = serializers.FloatField(required=False, min_value=0.0)
    max_combined_length_cm = serializers.FloatField(required=False, allow_null=True, min_value=0.0)
    min_purchase_length_cm = serializers.FloatField(required=False, min_value=0.0)
    available_raw_widths_cm = serializers.ListField(
        child=serializers.FloatField(min_value=0.01),
        required=False,
        allow_empty=True,
    )
    max_combination_width_cm = serializers.FloatField(required=False, min_value=0.01)
    allow_reuse_self_sufficient_patterns = serializers.BooleanField(required=False)

    def validate_available_raw_widths_cm(self, value):
        normalized = []
        invalid = []
        for item in value:
            rounded = int(round(float(item)))
            if abs(float(item) - rounded) > 1e-9 or rounded not in STANDARD_RAW_WIDTHS_CM:
                invalid.append(item)
                continue
            if rounded not in normalized:
                normalized.append(rounded)
        if invalid:
            allowed = ', '.join(str(width) for width in STANDARD_RAW_WIDTHS_CM)
            invalid_text = ', '.join(str(item) for item in invalid)
            raise serializers.ValidationError(
                f'Khổ giấy thô chỉ được chọn trong tập chuẩn {allowed}. Giá trị không hợp lệ: {invalid_text}.'
            )
        return normalized

    def validate_min_purchase_length_cm(self, value):
        normalized = float(value)
        if normalized < MANDATORY_MIN_PURCHASE_LENGTH_CM:
            raise serializers.ValidationError(
                'Tổng chiều dài tối thiểu mỗi quy cách mua phải từ 5.000 cm trở lên để đủ tiêu chuẩn đặt giấy.'
            )
        return normalized


class PaperOptimizerOptimizationConfigSerializer(serializers.Serializer):
    max_length_delta_cm = serializers.FloatField(required=False, allow_null=True, min_value=0.0)
    top_candidates_keep = serializers.IntegerField(required=False, min_value=1)
    deep_optimization_mode = serializers.BooleanField(required=False)
    max_waste_rate_percent = serializers.FloatField(required=False, min_value=0.0)
    production_reserve_scope = serializers.ChoiceField(required=False, choices=['per_line', 'whole_order'])
    fragmentation_cost_weight = serializers.FloatField(required=False, min_value=0.0)
    new_raw_width_cost_weight = serializers.FloatField(required=False, min_value=0.0)
    allow_exceed_target_demand = serializers.BooleanField(required=False)
    technical_waste_cost_weight = serializers.FloatField(required=False, min_value=0.0)
    max_multiplier_per_component = serializers.IntegerField(required=False, min_value=1)
    allow_economic_overproduction = serializers.BooleanField(required=False)
    new_purchase_spec_cost_weight = serializers.FloatField(required=False, min_value=0.0)
    max_components_per_combination = serializers.IntegerField(required=False, min_value=1)
    production_reserve_rate_percent = serializers.FloatField(required=False, min_value=0.0)
    production_reserve_rounding_mode = serializers.ChoiceField(required=False, choices=['ceil', 'round', 'floor'])
    economic_overproduction_cost_weight = serializers.FloatField(required=False, min_value=0.0)
    max_economic_overproduction_quantity_total = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    max_economic_overproduction_quantity_per_line = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    max_economic_overproduction_rate_percent_total = serializers.FloatField(required=False, allow_null=True, min_value=0.0)
    acceptable_cost_increase_for_fewer_specs_percent = serializers.FloatField(required=False, min_value=0.0)
    acceptable_waste_increase_for_fewer_specs_percent = serializers.FloatField(required=False, min_value=0.0)
    max_economic_overproduction_rate_percent_per_line = serializers.FloatField(required=False, allow_null=True, min_value=0.0)
    acceptable_cost_increase_for_fewer_raw_widths_percent = serializers.FloatField(required=False, min_value=0.0)


class PaperOptimizerTemplateSerializer(serializers.ModelSerializer):
    supplier_config = PaperOptimizerSupplierConfigSerializer()
    optimization_config = PaperOptimizerOptimizationConfigSerializer()

    class Meta:
        model = PaperOptimizerSupplierTemplate
        fields = [
            'id',
            'name',
            'note',
            'supplier_config',
            'optimization_config',
            'is_system_default',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'is_system_default', 'created_at', 'updated_at']


class PaperOptimizerOptimizeRequestSerializer(serializers.Serializer):
    source_filename = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    input_lines = PaperOptimizerLineSerializer(many=True)
    supplier_config = PaperOptimizerSupplierConfigSerializer()
    optimization_config = PaperOptimizerOptimizationConfigSerializer()


class PaperOptimizerRunSummarySerializer(serializers.ModelSerializer):
    selected_plan_code = serializers.SerializerMethodField()
    selected_plan_name = serializers.SerializerMethodField()
    selected_scenario_code = serializers.SerializerMethodField()
    engine_primary = serializers.SerializerMethodField()
    engine_fallback_used = serializers.SerializerMethodField()
    engine_fallback_source = serializers.SerializerMethodField()
    line_count = serializers.SerializerMethodField()
    total_quantity = serializers.SerializerMethodField()

    class Meta:
        model = PaperOptimizerRun
        fields = [
            'id',
            'code',
            'status',
            'source_filename',
            'note',
            'recovery_mode',
            'canonical_match',
            'failed_reason',
            'created_at',
            'updated_at',
            'selected_plan_code',
            'selected_plan_name',
            'selected_scenario_code',
            'engine_primary',
            'engine_fallback_used',
            'engine_fallback_source',
            'line_count',
            'total_quantity',
        ]

    def _normalized_result_payload(self, obj: PaperOptimizerRun) -> dict:
        cache = getattr(obj, '_paper_optimizer_normalized_result_payload', None)
        if cache is None:
            cache = normalize_result_payload_for_display(
                obj.result_payload or {},
                canonical_match=bool(obj.canonical_match),
            )
            setattr(obj, '_paper_optimizer_normalized_result_payload', cache)
        return cache

    def get_selected_plan_code(self, obj: PaperOptimizerRun) -> str:
        return str(self._normalized_result_payload(obj).get('selected_plan_code') or '')

    def get_selected_plan_name(self, obj: PaperOptimizerRun) -> str:
        selected_plan = self._normalized_result_payload(obj).get('selected_plan') or {}
        return str(selected_plan.get('plan_name') or '')

    def get_selected_scenario_code(self, obj: PaperOptimizerRun) -> str:
        return str(self._normalized_result_payload(obj).get('selected_scenario_code') or '')

    def get_engine_primary(self, obj: PaperOptimizerRun) -> str:
        stats = self._normalized_result_payload(obj).get('stats') or {}
        return str(stats.get('engine_primary') or '')

    def get_engine_fallback_used(self, obj: PaperOptimizerRun) -> bool:
        stats = self._normalized_result_payload(obj).get('stats') or {}
        return bool(stats.get('engine_fallback_used'))

    def get_engine_fallback_source(self, obj: PaperOptimizerRun) -> str:
        stats = self._normalized_result_payload(obj).get('stats') or {}
        return str(stats.get('engine_fallback_source') or '')

    def get_line_count(self, obj: PaperOptimizerRun) -> int:
        return len(obj.input_lines or [])

    def get_total_quantity(self, obj: PaperOptimizerRun) -> int:
        return sum(int(line.get('quantity') or 0) for line in (obj.input_lines or []))


class PaperOptimizerRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaperOptimizerRun
        fields = [
            'id',
            'code',
            'status',
            'source_filename',
            'note',
            'input_lines',
            'supplier_config',
            'optimization_config',
            'preview_rows',
            'result_payload',
            'recovery_mode',
            'canonical_match',
            'failed_reason',
            'created_at',
            'updated_at',
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['result_payload'] = normalize_result_payload_for_display(
            instance.result_payload or {},
            canonical_match=bool(instance.canonical_match),
        )
        return data


class PaperOptimizerManualPatternComponentSerializer(serializers.Serializer):
    width_cm = serializers.FloatField(min_value=0.01)
    length_cm = serializers.FloatField(min_value=0.01)
    multiplier = serializers.IntegerField(min_value=1)


class PaperOptimizerManualPatternRequestSerializer(serializers.Serializer):
    raw_width_cm = serializers.FloatField(min_value=0.01)
    trim_edge_cm = serializers.FloatField(required=False, min_value=0.0, default=0.0)
    run_length_cm = serializers.FloatField(min_value=0.01)
    sets = serializers.IntegerField(min_value=1)
    components = PaperOptimizerManualPatternComponentSerializer(many=True)
