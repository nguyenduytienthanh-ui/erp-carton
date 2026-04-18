from django.conf import settings
from django.db import models


class CustomReportDefinition(models.Model):
    TYPE_SALES = 'SALES'
    TYPE_PURCHASE = 'PURCHASE'
    TYPE_INVENTORY = 'INVENTORY'
    TYPE_PRODUCTION = 'PRODUCTION'
    TYPE_FINANCIAL = 'FINANCIAL'
    TYPE_SHIPPING = 'SHIPPING'
    TYPE_WORKFORCE = 'WORKFORCE'
    TYPE_CHOICES = [
        (TYPE_SALES, 'Ban hang'),
        (TYPE_PURCHASE, 'Mua hang'),
        (TYPE_INVENTORY, 'Ton kho'),
        (TYPE_PRODUCTION, 'San xuat'),
        (TYPE_FINANCIAL, 'Tai chinh'),
        (TYPE_SHIPPING, 'Van chuyen'),
        (TYPE_WORKFORCE, 'Nhan su'),
    ]

    STATUS_DRAFT = 'DRAFT'
    STATUS_GENERATED = 'GENERATED'
    STATUS_FINALIZED = 'FINALIZED'
    STATUS_ARCHIVED = 'ARCHIVED'
    STATUS_CHOICES = [
        (STATUS_DRAFT, 'Nhap'),
        (STATUS_GENERATED, 'Da tao'),
        (STATUS_FINALIZED, 'Hoan tat'),
        (STATUS_ARCHIVED, 'Luu tru'),
    ]

    SCHEDULE_NONE = 'NONE'
    SCHEDULE_DAILY = 'DAILY'
    SCHEDULE_WEEKLY = 'WEEKLY'
    SCHEDULE_MONTHLY = 'MONTHLY'
    SCHEDULE_CHOICES = [
        (SCHEDULE_NONE, 'Không lập lịch'),
        (SCHEDULE_DAILY, 'Hàng ngày'),
        (SCHEDULE_WEEKLY, 'Hàng tuần'),
        (SCHEDULE_MONTHLY, 'Hàng tháng'),
    ]

    code = models.CharField(max_length=100, unique=True, db_index=True)
    name = models.CharField(max_length=200)
    report_type = models.CharField(max_length=20, choices=TYPE_CHOICES, db_index=True)
    description = models.TextField(blank=True, default='')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT, db_index=True)
    is_system = models.BooleanField(default=False, db_index=True)
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)
    config = models.JSONField(default=dict, blank=True)
    schedule_frequency = models.CharField(max_length=20, choices=SCHEDULE_CHOICES, default=SCHEDULE_NONE)
    schedule_enabled = models.BooleanField(default=False, db_index=True)
    schedule_time = models.TimeField(null=True, blank=True)
    schedule_day_of_week = models.PositiveSmallIntegerField(null=True, blank=True)
    schedule_day_of_month = models.PositiveSmallIntegerField(null=True, blank=True)
    schedule_recipients = models.JSONField(default=list, blank=True)
    schedule_name = models.CharField(max_length=100, blank=True, default='')
    next_run_at = models.DateTimeField(null=True, blank=True)
    last_generated_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_generated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='custom_reports_last_generated',
    )
    last_run_status = models.CharField(max_length=20, blank=True, default='')
    last_run_error = models.TextField(blank=True, default='')
    last_run_summary = models.JSONField(default=dict, blank=True)
    run_count = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='custom_reports_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='custom_reports_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'custom_report_definitions'
        ordering = ['-last_generated_at', '-updated_at', 'code']
        indexes = [
            models.Index(fields=['report_type', 'status']),
            models.Index(fields=['schedule_enabled', 'schedule_frequency']),
            models.Index(fields=['is_system', 'code']),
        ]

    def __str__(self):
        return f'{self.code} - {self.name}'

    def save(self, *args, **kwargs):
        if self.code:
            self.code = str(self.code).strip().upper()
        if self.schedule_frequency == self.SCHEDULE_NONE:
            self.schedule_enabled = False
        super().save(*args, **kwargs)


class CustomReportRun(models.Model):
    TRIGGER_MANUAL = 'MANUAL'
    TRIGGER_SCHEDULED = 'SCHEDULED'
    TRIGGER_CHOICES = [
        (TRIGGER_MANUAL, 'Thu cong'),
        (TRIGGER_SCHEDULED, 'Lich'),
    ]

    STATUS_SUCCESS = 'SUCCESS'
    STATUS_FAILED = 'FAILED'
    STATUS_CHOICES = [
        (STATUS_SUCCESS, 'Thanh cong'),
        (STATUS_FAILED, 'That bai'),
    ]

    report = models.ForeignKey(
        CustomReportDefinition,
        on_delete=models.CASCADE,
        related_name='runs',
    )
    trigger_type = models.CharField(max_length=20, choices=TRIGGER_CHOICES, default=TRIGGER_MANUAL)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_SUCCESS, db_index=True)
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)
    request_payload = models.JSONField(default=dict, blank=True)
    result_payload = models.JSONField(default=dict, blank=True)
    summary = models.JSONField(default=dict, blank=True)
    row_count = models.PositiveIntegerField(default=0)
    duration_ms = models.PositiveIntegerField(default=0)
    error_message = models.TextField(blank=True, default='')
    generated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='custom_report_runs_generated',
    )
    generated_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'custom_report_runs'
        ordering = ['-generated_at', '-id']
        indexes = [
            models.Index(fields=['report', 'generated_at']),
            models.Index(fields=['status', 'generated_at']),
        ]

    def __str__(self):
        return f'{self.report.code} - {self.trigger_type} - {self.generated_at}'
