from django.contrib import admin

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


class QualityInspectionLineInline(admin.TabularInline):
    model = QualityInspectionLine
    extra = 0


class QualityInspectionDefectInline(admin.TabularInline):
    model = QualityInspectionDefect
    extra = 0


@admin.register(QualityInspection)
class QualityInspectionAdmin(admin.ModelAdmin):
    list_display = ['code', 'inspection_type', 'status', 'result', 'operation_code', 'machine_code', 'created_at']
    list_filter = ['inspection_type', 'status', 'result', 'operation_code']
    search_fields = ['code', 'operation_code', 'machine_code', 'production_order__code', 'product__code']
    inlines = [QualityInspectionLineInline, QualityInspectionDefectInline]


@admin.register(QualityDefectCatalog)
class QualityDefectCatalogAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'category', 'default_severity', 'is_active', 'sort_order']
    list_filter = ['category', 'default_severity', 'is_active']
    search_fields = ['code', 'name']


@admin.register(VisionInspectionJob)
class VisionInspectionJobAdmin(admin.ModelAdmin):
    list_display = ['job_id', 'inspection', 'status', 'queue_name', 'created_at']
    list_filter = ['status', 'queue_name']
    search_fields = ['job_id', 'inspection__code']


@admin.register(QualityImageArtifact)
class QualityImageArtifactAdmin(admin.ModelAdmin):
    list_display = ['id', 'inspection', 'image_type', 'result_status', 'expires_at', 'is_pinned', 'deleted_at']
    list_filter = ['image_type', 'result_status', 'cleanup_status', 'is_pinned', 'legal_hold']
    search_fields = ['storage_path', 'checksum', 'inspection__code']


admin.site.register(QualityInspectionLine)
admin.site.register(QualityInspectionDefect)
admin.site.register(QualityImageRetentionPolicy)
admin.site.register(QualityStorageSettings)
admin.site.register(QualityStorageCleanupRun)
admin.site.register(QualityStorageCleanupItem)
