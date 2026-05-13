from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from core.models import AuditLog
from production.models import ProductionOperation

from .models import (
    QualityArtifactCleanupStatus,
    QualityImageArtifact,
    QualityImageRetentionPolicy,
    QualityInspection,
    QualityInspectionLine,
    QualityInspectionLineResult,
    QualityInspectionResult,
    QualityInspectionStatus,
    QualityRetentionScope,
    QualityStorageCleanupItem,
    QualityStorageCleanupRun,
    VisionInspectionJob,
)
from .permissions import (
    can_create_quality,
    can_manage_quality_storage,
    can_override_quality,
    can_review_quality,
    can_submit_quality,
)
from .vision import enqueue_vision_job


DEFAULT_PRINTING_CHECKLIST = [
    {'line_no': 10, 'check_key': 'color_match', 'label': 'Color matches approved sample'},
    {'line_no': 20, 'check_key': 'film_layout', 'label': 'Film/layout is correct'},
    {'line_no': 30, 'check_key': 'registration_alignment', 'label': 'Registration/alignment is acceptable'},
    {'line_no': 40, 'check_key': 'text_content', 'label': 'Text/content is complete and readable'},
    {'line_no': 50, 'check_key': 'ink_surface', 'label': 'Ink surface has no smear or dirty background'},
]


def create_quality_audit(user, *, action, entity_type, entity_id, entity_code='', old_values=None, new_values=None, changed_fields=None):
    AuditLog.objects.create(
        user=user if getattr(user, 'is_authenticated', False) else None,
        action=action,
        entity_type=entity_type,
        entity_id=int(entity_id or 0),
        entity_code=str(entity_code or '')[:50],
        old_values=old_values or {},
        new_values=new_values or {},
        changed_fields=changed_fields or [],
    )


def generate_inspection_code():
    today = timezone.localdate()
    prefix = f'QCP-{today:%Y%m%d}'
    existing_count = QualityInspection.objects.filter(code__startswith=prefix).count()
    return f'{prefix}-{existing_count + 1:04d}'


def is_printing_operation(operation):
    candidates = [
        getattr(operation, 'step_code', ''),
        getattr(operation, 'source_operation_code', ''),
        getattr(operation, 'source_field', ''),
    ]
    normalized = {str(value or '').strip().upper() for value in candidates}
    return 'IN' in normalized or 'PROCESS_IN' in normalized


def build_expected_print_snapshot(order):
    snapshot = dict(getattr(order, 'product_snapshot', None) or {})
    product = getattr(order, 'product', None)
    if product is not None:
        print_colors = []
        for field_name in getattr(product, 'PRINT_COLOR_FIELDS', []):
            value = str(getattr(product, field_name, '') or '').strip()
            if value:
                print_colors.append(value)
        product_snapshot = {
            'product_id': product.id,
            'product_code': product.code,
            'product_name': product.name,
            'process_in': product.process_in,
            'film_code': product.film_code or '',
            'film_file_url': product.film_file_url or '',
            'color_count': product.color_count,
            'print_colors': print_colors,
        }
        for key, value in product_snapshot.items():
            snapshot.setdefault(key, value)
    return snapshot


def build_production_context_snapshot(order, operation):
    demand = getattr(order, 'production_demand', None)
    return {
        'production_order_id': order.id,
        'production_order_code': order.code,
        'production_order_status': order.status,
        'production_operation_id': operation.id,
        'operation_code': operation.step_code,
        'operation_name': operation.step_name,
        'operation_status': operation.status,
        'production_operation_status': operation.status,
        'production_operation_status_unchanged_by_quality': True,
        'production_demand_id': getattr(demand, 'id', None),
        'production_demand_code': getattr(demand, 'demand_code', '') or '',
        'work_center_code': operation.work_center_code or '',
        'work_center_name': operation.work_center_name or '',
        'machine_code': operation.machine_code or '',
        'machine_name': operation.machine_name or '',
    }


def ensure_default_checklist_lines(inspection):
    existing_keys = set(inspection.lines.values_list('check_key', flat=True))
    rows = []
    for item in DEFAULT_PRINTING_CHECKLIST:
        if item['check_key'] in existing_keys:
            continue
        rows.append(
            QualityInspectionLine(
                inspection=inspection,
                line_no=item['line_no'],
                check_key=item['check_key'],
                label=item['label'],
            )
        )
    if rows:
        QualityInspectionLine.objects.bulk_create(rows)


@transaction.atomic
def create_inspection_from_operation(*, operation_id, user, require_printing_operation=True):
    if not can_create_quality(user):
        raise PermissionDenied('Bạn không có quyền tạo phiếu QC.')
    operation = (
        ProductionOperation.objects
        .select_related(
            'production_order',
            'production_order__product',
            'production_order__sales_order',
            'production_order__sales_order_line',
            'production_order__production_demand',
        )
        .get(pk=operation_id)
    )
    if require_printing_operation and not is_printing_operation(operation):
        raise ValidationError({'operation_id': 'Chỉ được tạo QC Printing từ công đoạn IN.'})

    existing = (
        QualityInspection.objects
        .filter(
            production_operation=operation,
            inspection_type='PRINTING',
        )
        .exclude(status=QualityInspectionStatus.CANCELLED)
        .order_by('-id')
        .first()
    )
    if existing:
        ensure_default_checklist_lines(existing)
        return existing, False

    order = operation.production_order
    inspection = QualityInspection.objects.create(
        code=generate_inspection_code(),
        inspection_type='PRINTING',
        product=order.product,
        sales_order=order.sales_order,
        sales_order_line=order.sales_order_line,
        production_order=order,
        production_operation=operation,
        operation_code=operation.step_code or operation.source_operation_code or '',
        operation_name=operation.step_name or '',
        work_center_code=operation.work_center_code or '',
        work_center_name=operation.work_center_name or '',
        machine_code=operation.machine_code or '',
        machine_name=operation.machine_name or '',
        expected_print_snapshot=build_expected_print_snapshot(order),
        production_context_snapshot=build_production_context_snapshot(order, operation),
        inspector=user if getattr(user, 'is_authenticated', False) else None,
        created_by=user if getattr(user, 'is_authenticated', False) else None,
        updated_by=user if getattr(user, 'is_authenticated', False) else None,
    )
    ensure_default_checklist_lines(inspection)
    create_quality_audit(
        user,
        action='QC_CREATE',
        entity_type='QualityInspection',
        entity_id=inspection.id,
        entity_code=inspection.code,
        new_values={
            'production_operation_id': operation.id,
            'production_operation_status': operation.status,
            'operation_code': operation.step_code,
        },
        changed_fields=['status', 'result', 'production_operation'],
    )
    return inspection, True


def update_checklist_lines(*, inspection, items, user):
    if not can_create_quality(user) and not can_submit_quality(user):
        raise PermissionDenied('Bạn không có quyền cập nhật checklist QC.')
    updated = []
    for index, item in enumerate(items, start=1):
        check_key = str(item.get('check_key') or '').strip()
        if not check_key:
            raise ValidationError({'items': f'Dòng {index}: thiếu check_key.'})
        line_result = str(item.get('result') or QualityInspectionLineResult.NA).strip().upper()
        if line_result not in {choice[0] for choice in QualityInspectionLineResult.CHOICES}:
            raise ValidationError({'items': f'Dòng {index}: kết quả checklist không hợp lệ.'})
        line, _created = QualityInspectionLine.objects.update_or_create(
            inspection=inspection,
            check_key=check_key,
            defaults={
                'line_no': item.get('line_no') or index * 10,
                'label': str(item.get('label') or check_key).strip(),
                'expected_value': str(item.get('expected_value') or '').strip(),
                'actual_value': str(item.get('actual_value') or '').strip(),
                'result': line_result,
                'note': str(item.get('note') or '').strip(),
            },
        )
        updated.append(line)
    create_quality_audit(
        user,
        action='QC_LINE_BULK',
        entity_type='QualityInspection',
        entity_id=inspection.id,
        entity_code=inspection.code,
        new_values={'line_count': len(updated)},
        changed_fields=['lines'],
    )
    return updated


def submit_inspection_result(*, inspection, result, user, notes=''):
    if not can_submit_quality(user):
        raise PermissionDenied('Bạn không có quyền gửi kết quả QC.')
    normalized = str(result or '').strip().upper()
    valid_results = {choice[0] for choice in QualityInspectionResult.CHOICES} - {QualityInspectionResult.PENDING}
    if normalized not in valid_results:
        raise ValidationError({'result': 'Kết quả QC không hợp lệ.'})
    old_values = {'status': inspection.status, 'result': inspection.result}
    inspection.result = normalized
    inspection.status = QualityInspectionStatus.SUBMITTED
    inspection.submitted_at = timezone.now()
    if notes:
        inspection.notes = str(notes)
    inspection.updated_by = user
    inspection.save(update_fields=['result', 'status', 'submitted_at', 'notes', 'updated_by', 'updated_at'])
    create_quality_audit(
        user,
        action='QC_SUBMIT',
        entity_type='QualityInspection',
        entity_id=inspection.id,
        entity_code=inspection.code,
        old_values=old_values,
        new_values={'status': inspection.status, 'result': inspection.result},
        changed_fields=['status', 'result', 'submitted_at'],
    )
    return inspection


def review_inspection(*, inspection, user, notes=''):
    if not can_review_quality(user):
        raise PermissionDenied('Bạn không có quyền review QC.')
    old_values = {'status': inspection.status}
    inspection.status = QualityInspectionStatus.REVIEWED
    inspection.reviewed_by = user
    inspection.reviewed_at = timezone.now()
    if notes:
        inspection.notes = str(notes)
    inspection.updated_by = user
    inspection.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'notes', 'updated_by', 'updated_at'])
    create_quality_audit(
        user,
        action='QC_REVIEW',
        entity_type='QualityInspection',
        entity_id=inspection.id,
        entity_code=inspection.code,
        old_values=old_values,
        new_values={'status': inspection.status, 'reviewed_by': getattr(user, 'username', '')},
        changed_fields=['status', 'reviewed_by', 'reviewed_at'],
    )
    return inspection


def override_inspection_result(*, inspection, result, user, reason=''):
    if not can_override_quality(user):
        raise PermissionDenied('Bạn không có quyền override QC.')
    normalized = str(result or '').strip().upper()
    if normalized not in {choice[0] for choice in QualityInspectionResult.CHOICES}:
        raise ValidationError({'result': 'Kết quả QC không hợp lệ.'})
    old_values = {'result': inspection.result}
    inspection.result = normalized
    inspection.updated_by = user
    inspection.notes = f"{inspection.notes}\nOverride: {reason}".strip() if reason else inspection.notes
    inspection.save(update_fields=['result', 'notes', 'updated_by', 'updated_at'])
    create_quality_audit(
        user,
        action='QC_OVERRIDE',
        entity_type='QualityInspection',
        entity_id=inspection.id,
        entity_code=inspection.code,
        old_values=old_values,
        new_values={'result': inspection.result, 'reason': reason},
        changed_fields=['result'],
    )
    return inspection


def create_vision_job(*, inspection, user, payload=None):
    job = VisionInspectionJob.objects.create(
        inspection=inspection,
        requested_by=user if getattr(user, 'is_authenticated', False) else None,
        request_payload=payload or {},
    )
    queue_result = enqueue_vision_job(job)
    create_quality_audit(
        user,
        action='QC_JOB_CREATE',
        entity_type='VisionInspectionJob',
        entity_id=job.id,
        entity_code=str(job.job_id)[:50],
        new_values={'inspection_id': inspection.id, 'status': job.status, 'queue': queue_result},
        changed_fields=['status'],
    )
    return job


def _retention_scope_candidates(*, inspection, image_type, result_status):
    if inspection is not None:
        if inspection.machine_code:
            yield QualityRetentionScope.MACHINE, inspection.machine_code
        if inspection.product_id:
            yield QualityRetentionScope.PRODUCT, str(inspection.product_id)
        yield QualityRetentionScope.INSPECTION_TYPE, inspection.inspection_type
    yield QualityRetentionScope.GLOBAL, ''


def resolve_retention_policy(*, image_type, result_status, inspection=None):
    for scope_type, scope_key in _retention_scope_candidates(
        inspection=inspection,
        image_type=image_type,
        result_status=result_status,
    ):
        policy = (
            QualityImageRetentionPolicy.objects
            .filter(
                image_type=image_type,
                result_status=result_status,
                scope_type=scope_type,
                scope_key=scope_key,
                is_active=True,
            )
            .first()
        )
        if policy:
            return policy
    return None


def calculate_expires_at(*, policy, created_at=None):
    if policy is None or not policy.auto_delete or policy.retention_days is None:
        return None
    base_time = created_at or timezone.now()
    return base_time + timedelta(days=int(policy.retention_days))


def create_image_artifact(*, inspection, image_type, storage_path, user=None, job=None, result_status=None, **kwargs):
    artifact_result = result_status or inspection.result or QualityInspectionResult.PENDING
    policy = resolve_retention_policy(
        image_type=image_type,
        result_status=artifact_result,
        inspection=inspection,
    )
    artifact = QualityImageArtifact.objects.create(
        inspection=inspection,
        job=job,
        image_type=image_type,
        result_status=artifact_result,
        storage_path=storage_path,
        thumbnail_path=kwargs.get('thumbnail_path', ''),
        file_size=kwargs.get('file_size', 0) or 0,
        width=kwargs.get('width'),
        height=kwargs.get('height'),
        dpi=kwargs.get('dpi'),
        mm_per_pixel=kwargs.get('mm_per_pixel'),
        checksum=kwargs.get('checksum', ''),
        metadata=kwargs.get('metadata', {}) or {},
        retention_policy=policy,
        expires_at=calculate_expires_at(policy=policy),
    )
    create_quality_audit(
        user,
        action='QC_ARTIFACT_ADD',
        entity_type='QualityImageArtifact',
        entity_id=artifact.id,
        entity_code=str(artifact.id),
        new_values={
            'inspection_id': inspection.id,
            'image_type': image_type,
            'storage_path': storage_path,
            'expires_at': artifact.expires_at.isoformat() if artifact.expires_at else None,
        },
        changed_fields=['image_type', 'storage_path', 'expires_at'],
    )
    return artifact


def pin_image_artifact(*, artifact, user, reason):
    reason_text = str(reason or '').strip()
    if not reason_text:
        raise ValidationError({'reason': 'Bắt buộc nhập lý do giữ lại ảnh.'})
    artifact.is_pinned = True
    artifact.pinned_by = user
    artifact.pinned_at = timezone.now()
    artifact.pin_reason = reason_text
    artifact.save(update_fields=['is_pinned', 'pinned_by', 'pinned_at', 'pin_reason', 'updated_at'])
    create_quality_audit(
        user,
        action='QC_PIN',
        entity_type='QualityImageArtifact',
        entity_id=artifact.id,
        entity_code=str(artifact.id),
        new_values={'reason': reason_text},
        changed_fields=['is_pinned', 'pinned_by', 'pinned_at', 'pin_reason'],
    )
    return artifact


def unpin_image_artifact(*, artifact, user):
    old_values = {'pin_reason': artifact.pin_reason}
    artifact.is_pinned = False
    artifact.pinned_by = None
    artifact.pinned_at = None
    artifact.pin_reason = ''
    artifact.save(update_fields=['is_pinned', 'pinned_by', 'pinned_at', 'pin_reason', 'updated_at'])
    create_quality_audit(
        user,
        action='QC_UNPIN',
        entity_type='QualityImageArtifact',
        entity_id=artifact.id,
        entity_code=str(artifact.id),
        old_values=old_values,
        changed_fields=['is_pinned', 'pinned_by', 'pinned_at', 'pin_reason'],
    )
    return artifact


def get_cleanup_candidates(*, now=None):
    current_time = now or timezone.now()
    return QualityImageArtifact.objects.filter(
        expires_at__isnull=False,
        expires_at__lte=current_time,
        deleted_at__isnull=True,
        is_pinned=False,
        legal_hold=False,
        cleanup_status=QualityArtifactCleanupStatus.ACTIVE,
    ).filter(
        Q(retention_policy__isnull=True) | Q(retention_policy__auto_delete=True)
    )


@transaction.atomic
def run_cleanup_dry_run(*, user, limit=1000):
    if not can_manage_quality_storage(user):
        raise PermissionDenied('Bạn không có quyền quản lý lưu trữ QC.')
    candidates = list(get_cleanup_candidates().order_by('expires_at', 'id')[:limit])
    total_bytes = sum(int(item.file_size or 0) for item in candidates)
    cleanup_run = QualityStorageCleanupRun.objects.create(
        dry_run=True,
        candidate_count=len(candidates),
        candidate_bytes=total_bytes,
        started_by=user if getattr(user, 'is_authenticated', False) else None,
    )
    QualityStorageCleanupItem.objects.bulk_create([
        QualityStorageCleanupItem(
            cleanup_run=cleanup_run,
            artifact=artifact,
            storage_path=artifact.storage_path,
            file_size=artifact.file_size or 0,
            action='DRY_RUN',
            status='CANDIDATE',
        )
        for artifact in candidates
    ])
    create_quality_audit(
        user,
        action='QC_CLEANUP_DRYRUN',
        entity_type='QualityStorageCleanupRun',
        entity_id=cleanup_run.id,
        entity_code=str(cleanup_run.run_id)[:50],
        new_values={'candidate_count': len(candidates), 'candidate_bytes': total_bytes},
        changed_fields=['candidate_count', 'candidate_bytes'],
    )
    return cleanup_run
