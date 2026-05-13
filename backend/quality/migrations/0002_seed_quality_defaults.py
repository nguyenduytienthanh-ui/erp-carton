from django.db import migrations


QUALITY_PERMISSIONS = [
    ('VIEW', 'QUALITY_VIEW', 'View quality inspections', 'Allow viewing QC Printing inspections and results'),
    ('CREATE', 'QUALITY_CREATE', 'Create quality inspections', 'Allow creating QC Printing inspections and defects'),
    ('SUBMIT', 'QUALITY_SUBMIT', 'Submit quality results', 'Allow submitting official QC results'),
    ('REVIEW', 'QUALITY_REVIEW', 'Review quality results', 'Allow reviewing submitted QC results'),
    ('OVERRIDE', 'QUALITY_OVERRIDE', 'Override quality results', 'Allow overriding reviewed QC results with audit'),
    ('MANAGE_CATALOG', 'QUALITY_MANAGE_CATALOG', 'Manage quality catalog', 'Allow managing QC defect catalog'),
    ('MANAGE_STORAGE', 'QUALITY_MANAGE_STORAGE', 'Manage quality storage', 'Allow managing QC image storage policy and cleanup dry-run'),
]

QUALITY_PERMISSION_ROLE_CODES = ['ADMIN', 'MANAGER', 'OPS_MANAGER', 'PRODUCT_MANAGER', 'QUAN_LY', 'QUANLY']
QUALITY_STORAGE_ROLE_CODES = ['ADMIN', 'MANAGER', 'OPS_MANAGER', 'QUAN_LY', 'QUANLY']

PRINTING_DEFECTS = [
    ('COLOR_MISMATCH', 'Color mismatch', 'PRINTING', 'MAJOR', 10),
    ('MISREGISTRATION', 'Registration/alignment error', 'PRINTING', 'MAJOR', 20),
    ('SMEAR_DIRTY_BACKGROUND', 'Ink smear or dirty background', 'PRINTING', 'MAJOR', 30),
    ('MISSING_TEXT', 'Missing or unreadable text', 'PRINTING', 'CRITICAL', 40),
    ('WRONG_FILM_LAYOUT', 'Wrong film or layout', 'PRINTING', 'CRITICAL', 50),
    ('BLUR_LOW_DETAIL', 'Blur or low detail', 'PRINTING', 'MAJOR', 60),
]

IMAGE_TYPES = [
    'raw_image',
    'normalized_image',
    'thumbnail',
    'roi_crop',
    'diff_image',
    'heatmap_image',
    'annotated_image',
    'temporary_image',
    'calibration_image',
    'template_reference_image',
]

RESULT_STATUSES = [
    'PENDING',
    'PASS',
    'CONDITIONAL_PASS',
    'FAIL',
    'HOLD',
    'REWORK',
    'NEED_REVIEW',
    'CANCELLED',
]


def retention_defaults(image_type, result_status):
    if image_type == 'temporary_image':
        return 7, True, False
    if image_type in {'thumbnail', 'template_reference_image', 'calibration_image'}:
        return None, False, False
    if result_status == 'PASS':
        days = 14 if image_type in {'raw_image', 'normalized_image'} else 90
        return days, True, False
    if result_status == 'CONDITIONAL_PASS':
        return 180, True, False
    if result_status in {'FAIL', 'HOLD', 'REWORK', 'NEED_REVIEW'}:
        return 365, True, False
    if result_status == 'CANCELLED':
        return 30, True, False
    return 30, True, False


def seed_quality_defaults(apps, schema_editor):
    Permission = apps.get_model('core', 'Permission')
    Role = apps.get_model('core', 'Role')
    QualityDefectCatalog = apps.get_model('quality', 'QualityDefectCatalog')
    QualityImageRetentionPolicy = apps.get_model('quality', 'QualityImageRetentionPolicy')
    QualityStorageSettings = apps.get_model('quality', 'QualityStorageSettings')

    for action, code, name, description in QUALITY_PERMISSIONS:
        perm, _created = Permission.objects.update_or_create(
            resource='QUALITY',
            action=action,
            defaults={
                'code': code,
                'name': name,
                'description': description,
            },
        )
        role_codes = QUALITY_STORAGE_ROLE_CODES if action == 'MANAGE_STORAGE' else QUALITY_PERMISSION_ROLE_CODES
        for role_code in role_codes:
            role = Role.objects.filter(code__iexact=role_code, deleted_at__isnull=True).first()
            if role:
                role.permissions.add(perm)

    for code, name, category, severity, sort_order in PRINTING_DEFECTS:
        QualityDefectCatalog.objects.update_or_create(
            code=code,
            defaults={
                'name': name,
                'category': category,
                'default_severity': severity,
                'sort_order': sort_order,
                'is_active': True,
            },
        )

    for image_type in IMAGE_TYPES:
        for result_status in RESULT_STATUSES:
            retention_days, auto_delete, require_delete_approval = retention_defaults(image_type, result_status)
            QualityImageRetentionPolicy.objects.update_or_create(
                image_type=image_type,
                result_status=result_status,
                scope_type='GLOBAL',
                scope_key='',
                defaults={
                    'retention_days': retention_days,
                    'keep_thumbnail': True,
                    'keep_metadata': True,
                    'auto_delete': auto_delete,
                    'require_delete_approval': require_delete_approval,
                    'is_active': True,
                    'note': 'Editable default policy seeded by quality app migration.',
                },
            )

    QualityStorageSettings.objects.update_or_create(
        singleton_key='default',
        defaults={
            'quota_bytes': 0,
            'warning_threshold_percent': 70,
            'critical_threshold_percent': 85,
            'emergency_threshold_percent': 95,
            'cleanup_hour': 2,
            'cleanup_paused': False,
            'dry_run_required': True,
        },
    )


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0063_task_is_all_day_task_schedule_is_exception_and_more'),
        ('quality', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(seed_quality_defaults, migrations.RunPython.noop),
    ]
