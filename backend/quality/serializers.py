from rest_framework import serializers

from .models import (
    QualityDefectCatalog,
    QualityImageArtifact,
    QualityImageRetentionPolicy,
    QualityInspection,
    QualityInspectionDefect,
    QualityInspectionLine,
    QualityStorageCleanupItem,
    QualityStorageCleanupRun,
    QualityStorageSettings,
    VisionInspectionJob,
)


class QualityInspectionLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = QualityInspectionLine
        fields = [
            'id',
            'line_no',
            'check_key',
            'label',
            'expected_value',
            'actual_value',
            'result',
            'note',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class QualityDefectCatalogSerializer(serializers.ModelSerializer):
    class Meta:
        model = QualityDefectCatalog
        fields = [
            'id',
            'code',
            'name',
            'category',
            'default_severity',
            'description',
            'is_active',
            'sort_order',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class QualityInspectionDefectSerializer(serializers.ModelSerializer):
    defect_code = serializers.CharField(read_only=True)
    defect_name = serializers.CharField(read_only=True)

    class Meta:
        model = QualityInspectionDefect
        fields = [
            'id',
            'inspection',
            'defect',
            'defect_code',
            'defect_name',
            'severity',
            'quantity',
            'sample_size',
            'roi',
            'location_note',
            'disposition',
            'note',
            'created_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'defect_code', 'defect_name', 'created_by', 'created_at', 'updated_at']


class VisionInspectionJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = VisionInspectionJob
        fields = [
            'id',
            'job_id',
            'inspection',
            'status',
            'requested_by',
            'queue_name',
            'worker_id',
            'retry_count',
            'timeout_seconds',
            'request_payload',
            'result_json',
            'error_message',
            'started_at',
            'finished_at',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'job_id',
            'status',
            'requested_by',
            'worker_id',
            'retry_count',
            'result_json',
            'error_message',
            'started_at',
            'finished_at',
            'created_at',
            'updated_at',
        ]


class QualityImageArtifactSerializer(serializers.ModelSerializer):
    retention_policy_code = serializers.SerializerMethodField()

    class Meta:
        model = QualityImageArtifact
        fields = [
            'id',
            'inspection',
            'job',
            'image_type',
            'result_status',
            'storage_path',
            'thumbnail_path',
            'file_size',
            'width',
            'height',
            'dpi',
            'mm_per_pixel',
            'checksum',
            'metadata',
            'retention_policy',
            'retention_policy_code',
            'expires_at',
            'deleted_at',
            'cleanup_status',
            'is_pinned',
            'legal_hold',
            'pinned_by',
            'pinned_at',
            'pin_reason',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'retention_policy',
            'retention_policy_code',
            'expires_at',
            'deleted_at',
            'cleanup_status',
            'is_pinned',
            'pinned_by',
            'pinned_at',
            'pin_reason',
            'created_at',
            'updated_at',
        ]

    def get_retention_policy_code(self, obj):
        policy = getattr(obj, 'retention_policy', None)
        return str(policy) if policy else ''


class QualityInspectionSerializer(serializers.ModelSerializer):
    line_count = serializers.IntegerField(read_only=True)
    defect_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = QualityInspection
        fields = [
            'id',
            'code',
            'inspection_type',
            'status',
            'result',
            'sample_size',
            'notes',
            'product',
            'sales_order',
            'sales_order_line',
            'production_order',
            'production_operation',
            'operation_code',
            'operation_name',
            'work_center_code',
            'work_center_name',
            'machine_code',
            'machine_name',
            'expected_print_snapshot',
            'production_context_snapshot',
            'vision_result_snapshot',
            'inspector',
            'reviewed_by',
            'submitted_at',
            'reviewed_at',
            'created_by',
            'updated_by',
            'created_at',
            'updated_at',
            'line_count',
            'defect_count',
        ]
        read_only_fields = [
            'id',
            'code',
            'status',
            'result',
            'expected_print_snapshot',
            'production_context_snapshot',
            'vision_result_snapshot',
            'inspector',
            'reviewed_by',
            'submitted_at',
            'reviewed_at',
            'created_by',
            'updated_by',
            'created_at',
            'updated_at',
            'line_count',
            'defect_count',
        ]


class QualityInspectionDetailSerializer(QualityInspectionSerializer):
    lines = QualityInspectionLineSerializer(many=True, read_only=True)
    defects = QualityInspectionDefectSerializer(many=True, read_only=True)
    vision_jobs = VisionInspectionJobSerializer(many=True, read_only=True)
    image_artifacts = QualityImageArtifactSerializer(many=True, read_only=True)

    class Meta(QualityInspectionSerializer.Meta):
        fields = QualityInspectionSerializer.Meta.fields + [
            'lines',
            'defects',
            'vision_jobs',
            'image_artifacts',
        ]


class QualityImageRetentionPolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = QualityImageRetentionPolicy
        fields = [
            'id',
            'image_type',
            'result_status',
            'scope_type',
            'scope_key',
            'retention_days',
            'keep_thumbnail',
            'keep_metadata',
            'auto_delete',
            'require_delete_approval',
            'note',
            'is_active',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class QualityStorageSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = QualityStorageSettings
        fields = [
            'id',
            'singleton_key',
            'storage_root',
            'quota_bytes',
            'warning_threshold_percent',
            'critical_threshold_percent',
            'emergency_threshold_percent',
            'cleanup_hour',
            'cleanup_paused',
            'dry_run_required',
            'updated_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'singleton_key', 'updated_by', 'created_at', 'updated_at']


class QualityStorageCleanupItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = QualityStorageCleanupItem
        fields = [
            'id',
            'artifact',
            'storage_path',
            'file_size',
            'action',
            'status',
            'error_message',
            'created_at',
        ]


class QualityStorageCleanupRunSerializer(serializers.ModelSerializer):
    items = QualityStorageCleanupItemSerializer(many=True, read_only=True)

    class Meta:
        model = QualityStorageCleanupRun
        fields = [
            'id',
            'run_id',
            'dry_run',
            'status',
            'candidate_count',
            'candidate_bytes',
            'deleted_count',
            'deleted_bytes',
            'started_by',
            'notes',
            'created_at',
            'items',
        ]
