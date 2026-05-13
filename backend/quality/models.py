import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


User = settings.AUTH_USER_MODEL


class QualityInspectionStatus:
    DRAFT = 'DRAFT'
    SUBMITTED = 'SUBMITTED'
    REVIEWED = 'REVIEWED'
    CANCELLED = 'CANCELLED'
    CHOICES = [
        (DRAFT, 'Draft'),
        (SUBMITTED, 'Submitted'),
        (REVIEWED, 'Reviewed'),
        (CANCELLED, 'Cancelled'),
    ]


class QualityInspectionResult:
    PENDING = 'PENDING'
    PASS = 'PASS'
    CONDITIONAL_PASS = 'CONDITIONAL_PASS'
    FAIL = 'FAIL'
    HOLD = 'HOLD'
    REWORK = 'REWORK'
    NEED_REVIEW = 'NEED_REVIEW'
    CANCELLED = 'CANCELLED'
    CHOICES = [
        (PENDING, 'Pending'),
        (PASS, 'Pass'),
        (CONDITIONAL_PASS, 'Conditional pass'),
        (FAIL, 'Fail'),
        (HOLD, 'Hold'),
        (REWORK, 'Rework'),
        (NEED_REVIEW, 'Need review'),
        (CANCELLED, 'Cancelled'),
    ]


class QualityInspectionLineResult:
    OK = 'OK'
    NG = 'NG'
    NA = 'NA'
    CHOICES = [
        (OK, 'OK'),
        (NG, 'NG'),
        (NA, 'N/A'),
    ]


class QualityDefectSeverity:
    MINOR = 'MINOR'
    MAJOR = 'MAJOR'
    CRITICAL = 'CRITICAL'
    CHOICES = [
        (MINOR, 'Minor'),
        (MAJOR, 'Major'),
        (CRITICAL, 'Critical'),
    ]


class VisionJobStatus:
    QUEUED = 'QUEUED'
    RUNNING = 'RUNNING'
    SUCCEEDED = 'SUCCEEDED'
    FAILED = 'FAILED'
    CANCELLED = 'CANCELLED'
    CHOICES = [
        (QUEUED, 'Queued'),
        (RUNNING, 'Running'),
        (SUCCEEDED, 'Succeeded'),
        (FAILED, 'Failed'),
        (CANCELLED, 'Cancelled'),
    ]


class QualityImageType:
    RAW = 'raw_image'
    NORMALIZED = 'normalized_image'
    THUMBNAIL = 'thumbnail'
    ROI_CROP = 'roi_crop'
    DIFF = 'diff_image'
    HEATMAP = 'heatmap_image'
    ANNOTATED = 'annotated_image'
    TEMPORARY = 'temporary_image'
    CALIBRATION = 'calibration_image'
    TEMPLATE_REFERENCE = 'template_reference_image'
    CHOICES = [
        (RAW, 'Raw image'),
        (NORMALIZED, 'Normalized image'),
        (THUMBNAIL, 'Thumbnail'),
        (ROI_CROP, 'ROI crop'),
        (DIFF, 'Diff image'),
        (HEATMAP, 'Heatmap image'),
        (ANNOTATED, 'Annotated image'),
        (TEMPORARY, 'Temporary image'),
        (CALIBRATION, 'Calibration image'),
        (TEMPLATE_REFERENCE, 'Template reference image'),
    ]


class QualityRetentionScope:
    GLOBAL = 'GLOBAL'
    MACHINE = 'MACHINE'
    PRODUCT = 'PRODUCT'
    CUSTOMER = 'CUSTOMER'
    TEMPLATE_VERSION = 'TEMPLATE_VERSION'
    INSPECTION_TYPE = 'INSPECTION_TYPE'
    CHOICES = [
        (GLOBAL, 'Global'),
        (MACHINE, 'Machine'),
        (PRODUCT, 'Product'),
        (CUSTOMER, 'Customer'),
        (TEMPLATE_VERSION, 'Template version'),
        (INSPECTION_TYPE, 'Inspection type'),
    ]


class QualityArtifactCleanupStatus:
    ACTIVE = 'ACTIVE'
    DELETED = 'DELETED'
    ERROR = 'ERROR'
    CHOICES = [
        (ACTIVE, 'Active'),
        (DELETED, 'Deleted'),
        (ERROR, 'Error'),
    ]


class QualityInspection(models.Model):
    code = models.CharField(max_length=50, unique=True, db_index=True)
    inspection_type = models.CharField(max_length=30, default='PRINTING', db_index=True)
    status = models.CharField(
        max_length=20,
        choices=QualityInspectionStatus.CHOICES,
        default=QualityInspectionStatus.DRAFT,
        db_index=True,
    )
    result = models.CharField(
        max_length=30,
        choices=QualityInspectionResult.CHOICES,
        default=QualityInspectionResult.PENDING,
        db_index=True,
    )
    sample_size = models.PositiveIntegerField(default=0)
    notes = models.TextField(blank=True, default='')

    product = models.ForeignKey(
        'products.Product',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='quality_inspections',
    )
    sales_order = models.ForeignKey(
        'sales.SalesOrder',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='quality_inspections',
    )
    sales_order_line = models.ForeignKey(
        'sales.SalesOrderLine',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='quality_inspections',
    )
    production_order = models.ForeignKey(
        'production.ProductionOrder',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='quality_inspections',
    )
    production_operation = models.ForeignKey(
        'production.ProductionOperation',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='quality_inspections',
    )

    operation_code = models.CharField(max_length=50, blank=True, default='', db_index=True)
    operation_name = models.CharField(max_length=120, blank=True, default='')
    work_center_code = models.CharField(max_length=40, blank=True, default='', db_index=True)
    work_center_name = models.CharField(max_length=120, blank=True, default='')
    machine_code = models.CharField(max_length=40, blank=True, default='', db_index=True)
    machine_name = models.CharField(max_length=120, blank=True, default='')

    expected_print_snapshot = models.JSONField(default=dict, blank=True)
    production_context_snapshot = models.JSONField(default=dict, blank=True)
    vision_result_snapshot = models.JSONField(default=dict, blank=True)

    inspector = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='quality_inspections_inspected',
    )
    reviewed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='quality_inspections_reviewed',
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='quality_inspections_created',
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='quality_inspections_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'quality_inspections'
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['inspection_type', 'status']),
            models.Index(fields=['result']),
            models.Index(fields=['production_operation']),
            models.Index(fields=['production_order']),
            models.Index(fields=['product']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return self.code


class QualityInspectionLine(models.Model):
    inspection = models.ForeignKey(
        QualityInspection,
        on_delete=models.CASCADE,
        related_name='lines',
    )
    line_no = models.PositiveIntegerField(default=10)
    check_key = models.CharField(max_length=80)
    label = models.CharField(max_length=200)
    expected_value = models.CharField(max_length=255, blank=True, default='')
    actual_value = models.CharField(max_length=255, blank=True, default='')
    result = models.CharField(
        max_length=10,
        choices=QualityInspectionLineResult.CHOICES,
        default=QualityInspectionLineResult.NA,
    )
    note = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'quality_inspection_lines'
        ordering = ['inspection_id', 'line_no', 'id']
        constraints = [
            models.UniqueConstraint(fields=['inspection', 'check_key'], name='quality_line_inspection_check_uniq'),
        ]
        indexes = [
            models.Index(fields=['inspection', 'result']),
        ]

    def __str__(self):
        return f'{self.inspection_id}:{self.check_key}'


class QualityDefectCatalog(models.Model):
    code = models.CharField(max_length=60, unique=True)
    name = models.CharField(max_length=200)
    category = models.CharField(max_length=80, blank=True, default='PRINTING')
    default_severity = models.CharField(
        max_length=20,
        choices=QualityDefectSeverity.CHOICES,
        default=QualityDefectSeverity.MAJOR,
    )
    description = models.TextField(blank=True, default='')
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=100)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'quality_defect_catalog'
        ordering = ['sort_order', 'code']
        indexes = [
            models.Index(fields=['category', 'is_active']),
            models.Index(fields=['code']),
        ]

    def save(self, *args, **kwargs):
        self.code = str(self.code or '').strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.code} - {self.name}'


class QualityInspectionDefect(models.Model):
    inspection = models.ForeignKey(
        QualityInspection,
        on_delete=models.CASCADE,
        related_name='defects',
    )
    defect = models.ForeignKey(
        QualityDefectCatalog,
        on_delete=models.PROTECT,
        related_name='inspection_defects',
    )
    defect_code = models.CharField(max_length=60, blank=True, default='')
    defect_name = models.CharField(max_length=200, blank=True, default='')
    severity = models.CharField(
        max_length=20,
        choices=QualityDefectSeverity.CHOICES,
        default=QualityDefectSeverity.MAJOR,
    )
    quantity = models.PositiveIntegerField(default=1)
    sample_size = models.PositiveIntegerField(default=0)
    roi = models.JSONField(default=dict, blank=True)
    location_note = models.CharField(max_length=255, blank=True, default='')
    disposition = models.CharField(max_length=50, blank=True, default='')
    note = models.TextField(blank=True, default='')
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='quality_defects_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'quality_inspection_defects'
        ordering = ['inspection_id', '-created_at', '-id']
        indexes = [
            models.Index(fields=['inspection', 'severity']),
            models.Index(fields=['defect_code']),
        ]

    def save(self, *args, **kwargs):
        if self.defect_id:
            self.defect_code = self.defect.code
            self.defect_name = self.defect.name
            if not self.severity:
                self.severity = self.defect.default_severity
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.inspection_id}:{self.defect_code}'


class VisionInspectionJob(models.Model):
    job_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True)
    inspection = models.ForeignKey(
        QualityInspection,
        on_delete=models.CASCADE,
        related_name='vision_jobs',
    )
    status = models.CharField(
        max_length=20,
        choices=VisionJobStatus.CHOICES,
        default=VisionJobStatus.QUEUED,
        db_index=True,
    )
    requested_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='vision_jobs_requested',
    )
    queue_name = models.CharField(max_length=80, default='vision_inspection')
    worker_id = models.CharField(max_length=120, blank=True, default='')
    retry_count = models.PositiveIntegerField(default=0)
    timeout_seconds = models.PositiveIntegerField(default=300)
    request_payload = models.JSONField(default=dict, blank=True)
    result_json = models.JSONField(default=dict, blank=True)
    error_message = models.TextField(blank=True, default='')
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'quality_vision_jobs'
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['inspection', 'status']),
            models.Index(fields=['status', 'created_at']),
        ]

    def __str__(self):
        return str(self.job_id)


class QualityImageRetentionPolicy(models.Model):
    image_type = models.CharField(max_length=40, choices=QualityImageType.CHOICES)
    result_status = models.CharField(max_length=30, choices=QualityInspectionResult.CHOICES)
    scope_type = models.CharField(
        max_length=30,
        choices=QualityRetentionScope.CHOICES,
        default=QualityRetentionScope.GLOBAL,
    )
    scope_key = models.CharField(max_length=120, blank=True, default='')
    retention_days = models.PositiveIntegerField(null=True, blank=True)
    keep_thumbnail = models.BooleanField(default=True)
    keep_metadata = models.BooleanField(default=True)
    auto_delete = models.BooleanField(default=True)
    require_delete_approval = models.BooleanField(default=False)
    note = models.TextField(blank=True, default='')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'quality_image_retention_policies'
        ordering = ['scope_type', 'scope_key', 'image_type', 'result_status']
        constraints = [
            models.UniqueConstraint(
                fields=['image_type', 'result_status', 'scope_type', 'scope_key'],
                name='quality_retention_policy_scope_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['image_type', 'result_status', 'is_active']),
            models.Index(fields=['scope_type', 'scope_key']),
        ]

    def __str__(self):
        scope = self.scope_key or self.scope_type
        return f'{self.image_type}/{self.result_status}/{scope}'


class QualityStorageSettings(models.Model):
    singleton_key = models.CharField(max_length=30, default='default', unique=True)
    storage_root = models.CharField(max_length=500, blank=True, default='')
    quota_bytes = models.BigIntegerField(default=0)
    warning_threshold_percent = models.PositiveSmallIntegerField(
        default=70,
        validators=[MinValueValidator(1), MaxValueValidator(100)],
    )
    critical_threshold_percent = models.PositiveSmallIntegerField(
        default=85,
        validators=[MinValueValidator(1), MaxValueValidator(100)],
    )
    emergency_threshold_percent = models.PositiveSmallIntegerField(
        default=95,
        validators=[MinValueValidator(1), MaxValueValidator(100)],
    )
    cleanup_hour = models.PositiveSmallIntegerField(
        default=2,
        validators=[MinValueValidator(0), MaxValueValidator(23)],
    )
    cleanup_paused = models.BooleanField(default=False)
    dry_run_required = models.BooleanField(default=True)
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='quality_storage_settings_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'quality_storage_settings'
        verbose_name = 'Quality storage settings'
        verbose_name_plural = 'Quality storage settings'

    def __str__(self):
        return self.singleton_key


class QualityImageArtifact(models.Model):
    inspection = models.ForeignKey(
        QualityInspection,
        on_delete=models.CASCADE,
        related_name='image_artifacts',
    )
    job = models.ForeignKey(
        VisionInspectionJob,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='image_artifacts',
    )
    image_type = models.CharField(max_length=40, choices=QualityImageType.CHOICES, db_index=True)
    result_status = models.CharField(
        max_length=30,
        choices=QualityInspectionResult.CHOICES,
        default=QualityInspectionResult.PENDING,
        db_index=True,
    )
    storage_path = models.CharField(max_length=1000)
    thumbnail_path = models.CharField(max_length=1000, blank=True, default='')
    file_size = models.BigIntegerField(default=0)
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    dpi = models.PositiveIntegerField(null=True, blank=True)
    mm_per_pixel = models.DecimalField(max_digits=12, decimal_places=6, null=True, blank=True)
    checksum = models.CharField(max_length=128, blank=True, default='', db_index=True)
    metadata = models.JSONField(default=dict, blank=True)
    retention_policy = models.ForeignKey(
        QualityImageRetentionPolicy,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='image_artifacts',
    )
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    cleanup_status = models.CharField(
        max_length=20,
        choices=QualityArtifactCleanupStatus.CHOICES,
        default=QualityArtifactCleanupStatus.ACTIVE,
        db_index=True,
    )
    is_pinned = models.BooleanField(default=False, db_index=True)
    legal_hold = models.BooleanField(default=False, db_index=True)
    pinned_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='quality_images_pinned',
    )
    pinned_at = models.DateTimeField(null=True, blank=True)
    pin_reason = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'quality_image_artifacts'
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['inspection', 'image_type']),
            models.Index(fields=['expires_at', 'deleted_at', 'is_pinned']),
            models.Index(fields=['job', 'image_type']),
        ]

    def __str__(self):
        return f'{self.inspection_id}:{self.image_type}:{self.storage_path}'


class QualityStorageCleanupRun(models.Model):
    run_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True)
    dry_run = models.BooleanField(default=True)
    status = models.CharField(max_length=20, default='COMPLETED')
    candidate_count = models.PositiveIntegerField(default=0)
    candidate_bytes = models.BigIntegerField(default=0)
    deleted_count = models.PositiveIntegerField(default=0)
    deleted_bytes = models.BigIntegerField(default=0)
    started_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='quality_cleanup_runs_started',
    )
    notes = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'quality_storage_cleanup_runs'
        ordering = ['-created_at', '-id']

    def __str__(self):
        return str(self.run_id)


class QualityStorageCleanupItem(models.Model):
    cleanup_run = models.ForeignKey(
        QualityStorageCleanupRun,
        on_delete=models.CASCADE,
        related_name='items',
    )
    artifact = models.ForeignKey(
        QualityImageArtifact,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='cleanup_items',
    )
    storage_path = models.CharField(max_length=1000)
    file_size = models.BigIntegerField(default=0)
    action = models.CharField(max_length=20, default='DRY_RUN')
    status = models.CharField(max_length=20, default='CANDIDATE')
    error_message = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'quality_storage_cleanup_items'
        ordering = ['cleanup_run_id', 'id']

    def __str__(self):
        return f'{self.cleanup_run_id}:{self.storage_path}'
