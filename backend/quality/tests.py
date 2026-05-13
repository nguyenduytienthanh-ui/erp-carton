from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from inventory.models import InventoryTransaction
from production.models import ProductionOperation, ProductionOperationStatus, ProductionOrder
from products.models import Product, ProductUnit

from .models import (
    QualityImageArtifact,
    QualityImageRetentionPolicy,
    QualityImageType,
    QualityInspection,
    QualityInspectionResult,
    QualityRetentionScope,
    VisionInspectionJob,
)
from .services import create_image_artifact


User = get_user_model()


class QualityPrintingFoundationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_superuser(username='quality-admin', password='test-pass')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.unit = ProductUnit.objects.create(code='QC1A', name='QC unit')
        self.product = Product.objects.create(
            code='QC-BOX-001',
            name='QC printing box',
            unit=self.unit,
            process_in=1200,
            film_code='FILM-QC-001',
            color_count=2,
            print_color_1='Cyan',
            print_color_2='Black',
        )
        self.production_order = ProductionOrder.objects.create(
            code='MO-QC-001',
            order_date=timezone.localdate(),
            product=self.product,
            product_snapshot={
                'code': self.product.code,
                'name': self.product.name,
                'film_code': self.product.film_code,
                'color_count': self.product.color_count,
                'print_colors': ['Cyan', 'Black'],
            },
            planned_qty=1000,
        )
        self.print_operation = ProductionOperation.objects.create(
            production_order=self.production_order,
            sequence=10,
            step_code='IN',
            step_name='In',
            source_field='process_in',
            source_operation_code='IN',
            status=ProductionOperationStatus.READY,
            work_center_code='WC-IN',
            work_center_name='May in',
            machine_code='M-IN-01',
            machine_name='May in 01',
        )
        self.non_print_operation = ProductionOperation.objects.create(
            production_order=self.production_order,
            sequence=20,
            step_code='BE',
            step_name='Be',
            source_field='process_be',
            source_operation_code='BE',
            status=ProductionOperationStatus.READY,
        )

    def _create_inspection_from_print_operation(self):
        response = self.client.post(
            '/api/quality/printing-inspections/create-from-operation/',
            {'production_operation_id': self.print_operation.id},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        return QualityInspection.objects.get(id=response.data['inspection']['id'])

    def test_create_inspection_from_print_operation_does_not_change_production_or_inventory(self):
        before_inventory_count = InventoryTransaction.objects.count()
        before_operation_status = self.print_operation.status

        inspection = self._create_inspection_from_print_operation()

        self.print_operation.refresh_from_db()
        self.assertEqual(inspection.production_operation_id, self.print_operation.id)
        self.assertEqual(inspection.operation_code, 'IN')
        self.assertEqual(inspection.expected_print_snapshot['film_code'], 'FILM-QC-001')
        self.assertEqual(inspection.lines.count(), 5)
        self.assertEqual(self.print_operation.status, before_operation_status)
        self.assertEqual(InventoryTransaction.objects.count(), before_inventory_count)

    def test_create_inspection_from_non_print_operation_is_rejected(self):
        response = self.client.post(
            '/api/quality/printing-inspections/create-from-operation/',
            {'production_operation_id': self.non_print_operation.id},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(QualityInspection.objects.filter(production_operation=self.non_print_operation).exists())

    def test_vision_job_returns_job_id_without_processing_in_request(self):
        inspection = self._create_inspection_from_print_operation()

        response = self.client.post(
            '/api/quality/vision-jobs/',
            {'inspection': inspection.id, 'request_payload': {'reference_path': 'refs/sample.jpg'}},
            format='json',
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data['job_id'])
        job = VisionInspectionJob.objects.get(job_id=response.data['job_id'])
        self.assertEqual(job.status, 'QUEUED')
        self.assertIsNone(job.started_at)
        self.assertIsNone(job.finished_at)
        self.assertEqual(job.result_json, {})

    def test_image_artifact_expires_at_comes_from_retention_policy(self):
        inspection = self._create_inspection_from_print_operation()
        policy, _created = QualityImageRetentionPolicy.objects.update_or_create(
            image_type=QualityImageType.RAW,
            result_status=QualityInspectionResult.PASS,
            scope_type=QualityRetentionScope.GLOBAL,
            scope_key='',
            defaults={
                'retention_days': 14,
                'auto_delete': True,
                'keep_thumbnail': True,
                'keep_metadata': True,
                'is_active': True,
            },
        )

        artifact = create_image_artifact(
            inspection=inspection,
            image_type=QualityImageType.RAW,
            result_status=QualityInspectionResult.PASS,
            storage_path='quality/raw/sample-pass.jpg',
            file_size=1234,
            user=self.user,
        )

        self.assertEqual(artifact.retention_policy_id, policy.id)
        self.assertIsNotNone(artifact.expires_at)
        self.assertGreaterEqual(artifact.expires_at, timezone.now() + timedelta(days=13))

    def test_pinned_artifact_is_not_in_cleanup_dry_run_and_dry_run_deletes_nothing(self):
        inspection = self._create_inspection_from_print_operation()
        policy, _created = QualityImageRetentionPolicy.objects.update_or_create(
            image_type=QualityImageType.RAW,
            result_status=QualityInspectionResult.FAIL,
            scope_type=QualityRetentionScope.GLOBAL,
            scope_key='',
            defaults={
                'retention_days': 1,
                'auto_delete': True,
                'keep_thumbnail': True,
                'keep_metadata': True,
                'is_active': True,
            },
        )
        pinned_artifact = QualityImageArtifact.objects.create(
            inspection=inspection,
            image_type=QualityImageType.RAW,
            result_status=QualityInspectionResult.FAIL,
            storage_path='quality/raw/pinned-fail.jpg',
            file_size=500,
            retention_policy=policy,
            expires_at=timezone.now() - timedelta(days=1),
            is_pinned=True,
            pinned_by=self.user,
            pinned_at=timezone.now(),
            pin_reason='Important claim evidence',
        )
        candidate_artifact = QualityImageArtifact.objects.create(
            inspection=inspection,
            image_type=QualityImageType.RAW,
            result_status=QualityInspectionResult.FAIL,
            storage_path='quality/raw/candidate-fail.jpg',
            file_size=700,
            retention_policy=policy,
            expires_at=timezone.now() - timedelta(days=1),
        )

        response = self.client.post('/api/quality/storage-cleanup/dry-run/', {'limit': 100}, format='json')

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['candidate_count'], 1)
        returned_paths = {item['storage_path'] for item in response.data['items']}
        self.assertNotIn(pinned_artifact.storage_path, returned_paths)
        self.assertIn(candidate_artifact.storage_path, returned_paths)
        pinned_artifact.refresh_from_db()
        candidate_artifact.refresh_from_db()
        self.assertIsNone(pinned_artifact.deleted_at)
        self.assertIsNone(candidate_artifact.deleted_at)
        self.assertTrue(QualityImageArtifact.objects.filter(id=candidate_artifact.id).exists())
