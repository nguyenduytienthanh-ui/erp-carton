from django.conf import settings
from django.db import models


class PaperOptimizerSupplierTemplate(models.Model):
    """
    Trạng thái official-build vẫn tạm giữ tên bảng giai đoạn recovery
    để tránh tạo migration đổi tên bảng quá rủi ro trong tranche reintegration.
    """
    name = models.CharField(max_length=120)
    note = models.TextField(blank=True, default='')
    supplier_config = models.JSONField(default=dict)
    optimization_config = models.JSONField(default=dict)
    is_system_default = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='paper_optimizer_templates_created',
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'paper_optimizer_recovery_supplier_templates'
        ordering = ['-is_system_default', 'name', '-created_at']

    def __str__(self) -> str:
        return self.name


class PaperOptimizerRun(models.Model):
    """
    Trạng thái official-build vẫn tạm giữ tên bảng giai đoạn recovery
    để tránh tạo migration đổi tên bảng quá rủi ro trong tranche reintegration.
    """
    STATUS_SUCCESS = 'SUCCESS'
    STATUS_FAILED = 'FAILED'
    STATUS_CHOICES = [
        (STATUS_SUCCESS, 'Success'),
        (STATUS_FAILED, 'Failed'),
    ]

    code = models.CharField(max_length=64, unique=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_SUCCESS)
    source_filename = models.CharField(max_length=255, blank=True, default='')
    note = models.TextField(blank=True, default='')
    input_lines = models.JSONField(default=list)
    supplier_config = models.JSONField(default=dict)
    optimization_config = models.JSONField(default=dict)
    preview_rows = models.JSONField(default=list, blank=True)
    result_payload = models.JSONField(default=dict, blank=True)
    recovery_mode = models.BooleanField(default=False)
    canonical_match = models.BooleanField(default=False)
    failed_reason = models.TextField(blank=True, default='')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='paper_optimizer_runs_created',
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'paper_optimizer_recovery_runs'
        ordering = ['-created_at']

    def __str__(self) -> str:
        return self.code
