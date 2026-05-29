import json
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, TestCase

from core.management.commands.erp_main_shop_floor_handoff_drill import build_shop_floor_handoff_drill_pack
from core.management.commands.erp_main_uat_scenarios import build_uat_scenario_pack
from core.models import AuditLog, Customer
from inventory.models import InventoryTransaction
from products.models import Product, ProductUnit
from production.models import ProductionDemand, ProductionOperation, ProductionOrder
from sales.models import SalesOrder


def _create_backup_bundle(root: Path, name: str) -> Path:
    bundle = root / name
    bundle.mkdir()
    (bundle / 'database.sql').write_text('-- test backup\n', encoding='utf-8')
    (bundle / 'backup_manifest.json').write_text(json.dumps({'status': 'ok'}), encoding='utf-8')
    (bundle / 'restore_dry_run.json').write_text(json.dumps({'status': 'ok'}), encoding='utf-8')
    return bundle


class ErpMainUatScenarioPackTests(SimpleTestCase):
    def test_command_returns_copy_friendly_json_for_core_erp_scenarios(self):
        stdout = StringIO()
        call_command('erp_main_uat_scenarios', '--format', 'json', stdout=stdout)
        payload = json.loads(stdout.getvalue())

        self.assertEqual(payload['pack'], 'ERP Main UAT Scenario Pack v1')
        self.assertEqual(payload['mode'], 'read_only_static_repository_check')
        self.assertEqual(payload['overall_status'], 'ok')
        self.assertEqual(payload['summary']['scenario_count'], 6)
        self.assertEqual(payload['summary']['warning_count'], 0)
        scenario_keys = {item['key'] for item in payload['scenarios']}
        self.assertEqual(scenario_keys, {
            'product_readiness',
            'sales_snapshot_v2',
            'production_handoff',
            'planning_dispatch',
            'inventory_ledger_nxt_source_audit',
            'ops_release_readiness',
        })
        self.assertTrue(any('release_readiness' in item for item in payload['recommended_commands']))
        self.assertTrue(any('read-only' in item.lower() for item in payload['safety_notes']))

    def test_command_returns_markdown_with_manual_uat_steps(self):
        stdout = StringIO()
        call_command('erp_main_uat_scenarios', stdout=stdout)
        output = stdout.getvalue()

        self.assertIn('# ERP Main UAT Scenario Pack v1', output)
        self.assertIn('## Scenarios', output)
        self.assertIn('Product master / routing / print readiness', output)
        self.assertIn('PlanningBoard dispatch readiness', output)
        self.assertIn('## Safety notes', output)

    def test_pack_marks_missing_evidence_as_warning_without_db_writes(self):
        payload = build_uat_scenario_pack(repo_root=Path('Z:/missing/repo'))

        self.assertEqual(payload['overall_status'], 'warning')
        self.assertEqual(payload['summary']['ok_count'], 0)
        self.assertEqual(payload['summary']['warning_count'], payload['summary']['scenario_count'])
        first_evidence = payload['scenarios'][0]['evidence'][0]
        self.assertFalse(first_evidence['exists'])
        self.assertEqual(first_evidence['status'], 'warning')


class ErpMainShopFloorHandoffDrillPackTests(SimpleTestCase):
    def test_command_returns_copy_friendly_json_for_shop_floor_drill(self):
        stdout = StringIO()
        call_command('erp_main_shop_floor_handoff_drill', '--format', 'json', stdout=stdout)
        payload = json.loads(stdout.getvalue())

        self.assertEqual(payload['pack'], 'Production Execution Shop-Floor Handoff Drill v1')
        self.assertEqual(payload['mode'], 'read_only_static_repository_check')
        self.assertEqual(payload['overall_status'], 'ok')
        self.assertEqual(payload['operator_wording']['floor_signal'], 'Tín hiệu sàn máy')
        self.assertEqual(payload['operator_wording']['handover_accepted'], 'Đã nhận bàn giao')
        self.assertEqual(payload['operator_wording']['advisory_only'], 'Chỉ cảnh báo, không chặn workflow')
        self.assertEqual(payload['operator_wording']['execution_audit'], 'Audit thực thi')
        self.assertFalse(payload['safety']['writes_database'])
        self.assertFalse(payload['safety']['creates_uat_data'])
        self.assertFalse(payload['safety']['backup_restore_runs'])
        self.assertFalse(payload['safety']['migration_runs'])
        self.assertFalse(payload['safety']['deploy_runs'])
        self.assertFalse(payload['safety']['cleanup_runs'])
        self.assertFalse(payload['safety']['production_posting_runs'])
        self.assertFalse(payload['safety']['material_reservation_runs'])
        scenario_keys = {item['key'] for item in payload['scenarios']}
        self.assertEqual(scenario_keys, {
            'receive_work_from_planning_board',
            'ready_warning_blocker_advisory',
            'machine_down_signal',
            'wait_material_signal',
            'clear_to_run_and_handover',
            'skip_with_reason',
            'done_update_audit',
        })
        self.assertTrue(any('shop-floor-handoff-drill.spec.ts' in item for item in payload['recommended_commands']))
        self.assertNotIn('password', stdout.getvalue().lower())

    def test_command_returns_markdown_with_operator_checklist(self):
        stdout = StringIO()
        call_command('erp_main_shop_floor_handoff_drill', stdout=stdout)
        output = stdout.getvalue()

        self.assertIn('# Production Execution Shop-Floor Handoff Drill v1', output)
        self.assertIn('## Operator wording', output)
        self.assertIn('Tín hiệu sàn máy', output)
        self.assertIn('Đã nhận bàn giao', output)
        self.assertIn('Chỉ cảnh báo, không chặn workflow', output)
        self.assertIn('Audit thực thi', output)
        self.assertIn('## Shop-floor drill scenarios', output)
        self.assertIn('Tín hiệu sàn máy - Báo máy dừng', output)
        self.assertIn('Tín hiệu sàn máy - Chờ vật tư', output)
        self.assertIn('## Operator checklist', output)
        self.assertIn('QC Printing is outside this ERP main drill pack.', output)

    def test_pack_marks_missing_evidence_as_warning_without_db_writes(self):
        payload = build_shop_floor_handoff_drill_pack(repo_root=Path('Z:/missing/repo'))

        self.assertEqual(payload['overall_status'], 'warning')
        self.assertEqual(payload['summary']['ok_count'], 0)
        self.assertEqual(payload['summary']['warning_count'], payload['summary']['scenario_count'])
        self.assertFalse(payload['safety']['writes_database'])
        self.assertFalse(payload['safety']['creates_uat_data'])
        first_evidence = payload['scenarios'][0]['evidence'][0]
        self.assertFalse(first_evidence['exists'])
        self.assertEqual(first_evidence['status'], 'warning')


class ErpMainRealDevUatDrillCommandTests(TestCase):
    prefix = 'QA_UAT9H_'

    def _call_json(self, *args):
        stdout = StringIO()
        call_command('erp_main_real_dev_uat_drill', '--format', 'json', *args, stdout=stdout)
        return stdout.getvalue(), json.loads(stdout.getvalue())

    def test_real_dev_uat_drill_dry_run_is_default_and_does_not_write(self):
        before_counts = {
            'customers': Customer.objects.count(),
            'products': Product.objects.count(),
            'sales_orders': SalesOrder.objects.count(),
            'inventory_transactions': InventoryTransaction.objects.count(),
        }

        output, payload = self._call_json('--prefix', self.prefix)

        self.assertEqual(payload['mode'], 'dry_run')
        self.assertEqual(payload['prefix'], self.prefix)
        self.assertFalse(payload['safety']['default_writes_db'])
        self.assertTrue(payload['safety']['write_requires_confirm_flag'])
        self.assertEqual(payload['planned_data_counts']['products'], 4)
        self.assertEqual(
            before_counts,
            {
                'customers': Customer.objects.count(),
                'products': Product.objects.count(),
                'sales_orders': SalesOrder.objects.count(),
                'inventory_transactions': InventoryTransaction.objects.count(),
            },
        )
        self.assertNotIn('Demo123', output)
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())

    def test_real_dev_uat_drill_rejects_uncontrolled_prefix(self):
        with self.assertRaises(CommandError):
            self._call_json('--prefix', 'QA_')

    def test_real_dev_uat_drill_confirm_write_creates_prefixed_test_data(self):
        _output, payload = self._call_json('--prefix', self.prefix, '--confirm-write')

        self.assertEqual(payload['mode'], 'write')
        self.assertEqual(payload['overall_status'], 'ok')
        self.assertEqual(Product.objects.filter(code__startswith=self.prefix).count(), 4)
        self.assertEqual(SalesOrder.objects.filter(code__startswith=self.prefix).count(), 1)
        self.assertEqual(ProductionDemand.objects.filter(demand_code__startswith=self.prefix).count(), 1)
        self.assertEqual(ProductionOrder.objects.filter(code__startswith=self.prefix).count(), 1)
        self.assertEqual(InventoryTransaction.objects.filter(code__startswith=self.prefix).count(), 5)

        results = payload['write_result']['scenario_results']
        self.assertEqual(results['product_readiness']['ready'], 'READY')
        self.assertEqual(results['product_readiness']['warning'], 'WARNING')
        self.assertEqual(results['product_readiness']['blocker'], 'BLOCKER')
        self.assertTrue(results['sales_snapshot_v2']['snapshot_stable_after_qty_price_note_update'])
        self.assertEqual(results['inventory_ledger_nxt_source_audit'][f'{self.prefix}INV_PURCHASE'], 'PURCHASE')
        self.assertEqual(results['inventory_ledger_nxt_source_audit'][f'{self.prefix}INV_PRODUCTION'], 'PRODUCTION')
        self.assertEqual(results['inventory_ledger_nxt_source_audit'][f'{self.prefix}INV_STOCKTAKE'], 'STOCKTAKE')
        self.assertEqual(results['inventory_ledger_nxt_source_audit'][f'{self.prefix}INV_TRANSFER'], 'TRANSFER')
        self.assertEqual(results['inventory_ledger_nxt_source_audit'][f'{self.prefix}INV_MANUAL'], 'MANUAL')

    def test_real_dev_uat_drill_markdown_is_copy_friendly(self):
        stdout = StringIO()
        call_command('erp_main_real_dev_uat_drill', '--prefix', self.prefix, stdout=stdout)
        output = stdout.getvalue()

        self.assertIn('# ERP Main Real-Dev UAT Drill v1', output)
        self.assertIn('Mode: dry_run', output)
        self.assertIn('DB write requires --confirm-write.', output)


class ErpMainShopFloorHandoffRealDevDrillCommandTests(TestCase):
    prefix = 'QA_SHF1_'
    backup_patch = 'core.management.commands.erp_main_shop_floor_handoff_real_dev_drill._check_release_readiness'
    migration_patch = 'core.management.commands.erp_main_shop_floor_handoff_real_dev_drill._has_pending_migrations'
    db_patch = 'core.management.commands.erp_main_shop_floor_handoff_real_dev_drill._database_name'

    def _call_json(self, *args):
        stdout = StringIO()
        call_command('erp_main_shop_floor_handoff_real_dev_drill', '--format', 'json', *args, stdout=stdout)
        return stdout.getvalue(), json.loads(stdout.getvalue())

    def _ok_release(self):
        return {'status': 'ok', 'summary': 'Release readiness: OK'}

    def assertLegacyConsoleSafe(self, output):
        output.encode('ascii')

    def test_shop_floor_real_dev_drill_dry_run_is_default_and_does_not_write(self):
        before_counts = {
            'product_units': ProductUnit.objects.count(),
            'products': Product.objects.count(),
            'production_orders': ProductionOrder.objects.count(),
            'audit_logs': AuditLog.objects.count(),
        }
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'backup')
            output, payload = self._call_json('--prefix', self.prefix, '--backup-path', str(backup))

        self.assertEqual(payload['mode'], 'dry_run')
        self.assertEqual(payload['prefix'], self.prefix)
        self.assertEqual(payload['overall_status'], 'ok')
        self.assertEqual(payload['operator_wording']['floor_signal'], 'Tín hiệu sàn máy')
        self.assertEqual(payload['operator_wording']['handover_accepted'], 'Đã nhận bàn giao')
        self.assertEqual(payload['operator_wording']['result_update'], 'Cập nhật kết quả')
        self.assertEqual(payload['operator_wording']['execution_audit'], 'Audit thực thi')
        self.assertTrue(payload['backup']['verified'])
        self.assertFalse(payload['safety']['default_writes_database'])
        self.assertTrue(payload['safety']['write_requires_confirm_write'])
        self.assertFalse(payload['safety']['writes_database'])
        self.assertEqual({item['key'] for item in payload['scenario_results']}, {
            'MACHINE_DOWN',
            'WAIT_MATERIAL',
            'CLEAR_TO_RUN',
            'HANDOVER_READY',
            'HANDOVER_ACCEPTED',
            'SKIP',
            'DONE_UPDATE',
        })
        self.assertEqual(
            before_counts,
            {
                'product_units': ProductUnit.objects.count(),
                'products': Product.objects.count(),
                'production_orders': ProductionOrder.objects.count(),
                'audit_logs': AuditLog.objects.count(),
            },
        )
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())
        self.assertLegacyConsoleSafe(output)

    def test_shop_floor_real_dev_drill_markdown_is_operator_friendly(self):
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'backup')
            stdout = StringIO()
            call_command(
                'erp_main_shop_floor_handoff_real_dev_drill',
                '--prefix',
                self.prefix,
                '--backup-path',
                str(backup),
                stdout=stdout,
            )
            output = stdout.getvalue()

        self.assertIn('# Production Execution Shop-Floor Handoff Real-Dev Drill v1', output)
        self.assertIn('Mode: dry_run', output)
        self.assertIn('## Operator wording', output)
        self.assertIn('## Scenario report', output)
        self.assertIn('No cleanup, restore, migration, deploy, direct SQL', output)
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())
        self.assertLegacyConsoleSafe(output)

    def test_shop_floor_real_dev_drill_rejects_wrong_prefixes(self):
        for prefix in ['', 'QA_', 'QA_UAT9H_', 'QA_SHF2_', 'TMP_SHF1_']:
            with self.subTest(prefix=prefix):
                with self.assertRaises(CommandError):
                    self._call_json('--prefix', prefix)

    def test_shop_floor_real_dev_drill_confirm_write_requires_verified_backup(self):
        with self.assertRaises(CommandError):
            with patch(self.db_patch, return_value='test_erp_dev_clean'), \
                    patch(self.migration_patch, return_value=False), \
                    patch(self.backup_patch, return_value=self._ok_release()):
                self._call_json('--prefix', self.prefix, '--confirm-write')

        with TemporaryDirectory() as tmpdir:
            bad_backup = Path(tmpdir) / 'bad'
            bad_backup.mkdir()
            (bad_backup / 'database.sql').write_text('', encoding='utf-8')
            (bad_backup / 'backup_manifest.json').write_text(json.dumps({'status': 'failed'}), encoding='utf-8')
            with self.assertRaises(CommandError):
                with patch(self.db_patch, return_value='test_erp_dev_clean'), \
                        patch(self.migration_patch, return_value=False), \
                        patch(self.backup_patch, return_value=self._ok_release()):
                    self._call_json('--prefix', self.prefix, '--backup-path', str(bad_backup), '--confirm-write')

    def test_shop_floor_real_dev_drill_confirm_write_blocks_unsafe_db(self):
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'backup')
            with self.assertRaises(CommandError):
                with patch(self.db_patch, return_value='erp_prod'), \
                        patch(self.migration_patch, return_value=False), \
                        patch(self.backup_patch, return_value=self._ok_release()):
                    self._call_json('--prefix', self.prefix, '--backup-path', str(backup), '--confirm-write')

    def test_shop_floor_real_dev_drill_confirm_write_blocks_pending_migrations_and_release_warning(self):
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'backup')
            with self.assertRaises(CommandError):
                with patch(self.db_patch, return_value='test_erp_dev_clean'), \
                        patch(self.migration_patch, return_value=True), \
                        patch(self.backup_patch, return_value=self._ok_release()):
                    self._call_json('--prefix', self.prefix, '--backup-path', str(backup), '--confirm-write')
            with self.assertRaises(CommandError):
                with patch(self.db_patch, return_value='test_erp_dev_clean'), \
                        patch(self.migration_patch, return_value=False), \
                        patch(self.backup_patch, return_value={'status': 'warning', 'summary': 'Release readiness: WARNING'}):
                    self._call_json('--prefix', self.prefix, '--backup-path', str(backup), '--confirm-write')

    def test_shop_floor_real_dev_drill_confirm_write_creates_prefixed_test_data_and_audit(self):
        Customer.objects.create(code='REAL_KEEP', name='Real Keep')
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'backup')
            with patch(self.db_patch, return_value='test_erp_dev_clean'), \
                    patch(self.migration_patch, return_value=False), \
                    patch(self.backup_patch, return_value=self._ok_release()):
                output, payload = self._call_json('--prefix', self.prefix, '--backup-path', str(backup), '--confirm-write')

        self.assertEqual(payload['mode'], 'confirm_write')
        self.assertEqual(payload['overall_status'], 'ok')
        self.assertTrue(payload['safety']['writes_database'])
        self.assertEqual(Product.objects.filter(code__startswith=self.prefix).count(), 2)
        self.assertEqual(ProductionOrder.objects.filter(code__startswith=self.prefix).count(), 1)
        self.assertEqual(ProductionOperation.objects.filter(production_order__code__startswith=self.prefix).count(), 7)
        self.assertEqual(AuditLog.objects.filter(entity_code__startswith=self.prefix).count(), 7)
        self.assertTrue(Customer.objects.filter(code='REAL_KEEP').exists())

        rows = {item['key']: item for item in payload['scenario_results']}
        self.assertEqual(rows['MACHINE_DOWN']['operator_group'], 'Tín hiệu sàn máy')
        self.assertEqual(rows['MACHINE_DOWN']['operator_label'], 'Báo máy dừng')
        self.assertEqual(rows['HANDOVER_ACCEPTED']['operator_label'], 'Đã nhận bàn giao')
        self.assertEqual(rows['SKIP']['operator_label'], 'Bỏ qua có lý do')
        self.assertEqual(rows['DONE_UPDATE']['operator_label'], 'Hoàn tất/cập nhật')
        self.assertEqual(rows['MACHINE_DOWN']['audit_action'], 'SIGNAL')
        self.assertEqual(rows['WAIT_MATERIAL']['audit_action'], 'SIGNAL')
        self.assertEqual(rows['CLEAR_TO_RUN']['last_action'], 'SIGNAL')
        self.assertEqual(rows['HANDOVER_READY']['audit_action'], 'HANDOVER')
        self.assertEqual(rows['HANDOVER_ACCEPTED']['last_action'], 'HANDOVER')
        self.assertEqual(rows['SKIP']['audit_action'], 'SKIP_OPERATION')
        self.assertEqual(rows['DONE_UPDATE']['audit_action'], 'UPDATE')
        self.assertTrue(all(item['advisory_only'] for item in rows.values()))
        self.assertTrue(all(item['workflow_blocking'] is False for item in rows.values()))
        self.assertTrue(all(payload['write_result']['scenario_results'][key]['actor'].startswith(self.prefix) for key in rows))
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())
        self.assertLegacyConsoleSafe(output)

    def test_shop_floor_real_dev_drill_reports_existing_prefixed_data_read_only(self):
        Customer.objects.create(code='REAL_KEEP', name='Real Keep')
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'backup')
            with patch(self.db_patch, return_value='test_erp_dev_clean'), \
                    patch(self.migration_patch, return_value=False), \
                    patch(self.backup_patch, return_value=self._ok_release()):
                self._call_json('--prefix', self.prefix, '--backup-path', str(backup), '--confirm-write')

            before_counts = {
                'products': Product.objects.count(),
                'production_orders': ProductionOrder.objects.count(),
                'production_operations': ProductionOperation.objects.count(),
                'audit_logs': AuditLog.objects.count(),
            }
            output, payload = self._call_json('--prefix', self.prefix, '--backup-path', str(backup))

        self.assertEqual(payload['mode'], 'dry_run')
        self.assertEqual(payload['overall_status'], 'ok')
        self.assertEqual(payload['existing_data_report']['status'], 'pass')
        self.assertFalse(payload['safety']['writes_database'])
        self.assertEqual(payload['existing_prefixed_counts']['production_orders'], 1)
        self.assertEqual(payload['existing_prefixed_counts']['production_operations'], 7)
        self.assertEqual(payload['existing_prefixed_counts']['audit_logs'], 7)
        self.assertEqual(
            before_counts,
            {
                'products': Product.objects.count(),
                'production_orders': ProductionOrder.objects.count(),
                'production_operations': ProductionOperation.objects.count(),
                'audit_logs': AuditLog.objects.count(),
            },
        )
        rows = {item['key']: item for item in payload['scenario_results']}
        self.assertEqual(rows['WAIT_MATERIAL']['operator_group'], 'Tín hiệu sàn máy')
        self.assertEqual(rows['WAIT_MATERIAL']['operator_label'], 'Chờ vật tư')
        self.assertEqual(rows['CLEAR_TO_RUN']['operator_label'], 'Sẵn chạy')
        self.assertEqual(rows['HANDOVER_READY']['operator_label'], 'Bàn giao sẵn sàng')
        self.assertTrue(all(item['status'] == 'pass' for item in rows.values()))
        self.assertEqual(rows['MACHINE_DOWN']['last_action'], 'SIGNAL')
        self.assertEqual(rows['WAIT_MATERIAL']['last_action'], 'SIGNAL')
        self.assertEqual(rows['CLEAR_TO_RUN']['last_action'], 'SIGNAL')
        self.assertEqual(rows['HANDOVER_READY']['last_action'], 'HANDOVER')
        self.assertEqual(rows['HANDOVER_ACCEPTED']['last_action'], 'HANDOVER')
        self.assertEqual(rows['SKIP']['last_action'], 'SKIP_OPERATION')
        self.assertEqual(rows['DONE_UPDATE']['last_action'], 'UPDATE')
        for row in rows.values():
            self.assertFalse(row['writes_database'])
            self.assertTrue(row['checks']['actor_present'])
            self.assertTrue(row['checks']['time_present'])
            self.assertTrue(row['checks']['note_present'])
            self.assertTrue(row['checks']['last_action_present'])
            self.assertTrue(row['checks']['execution_handoff_present'])
            self.assertTrue(row['checks']['advisory_only'])
            self.assertTrue(row['checks']['workflow_blocking_false'])
            self.assertTrue(row['advisory_only'])
            self.assertFalse(row['workflow_blocking'])
        self.assertTrue(Customer.objects.filter(code='REAL_KEEP').exists())
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())
        self.assertLegacyConsoleSafe(output)

    def test_shop_floor_real_dev_drill_confirm_write_refuses_existing_prefixed_data(self):
        ProductUnit.objects.create(code='QA_SHF1_U', name='Existing unit')
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'backup')
            with self.assertRaises(CommandError):
                with patch(self.db_patch, return_value='test_erp_dev_clean'), \
                        patch(self.migration_patch, return_value=False), \
                        patch(self.backup_patch, return_value=self._ok_release()):
                    self._call_json('--prefix', self.prefix, '--backup-path', str(backup), '--confirm-write')


class ErpMainUatEvidencePackCommandTests(TestCase):
    prefix = 'QA_UAT9H_'

    def _call_json(self, *args):
        stdout = StringIO()
        call_command('erp_main_uat_evidence_pack', '--format', 'json', *args, stdout=stdout)
        return stdout.getvalue(), json.loads(stdout.getvalue())

    def test_evidence_pack_is_read_only_and_reports_missing_retained_data(self):
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            pre_backup = _create_backup_bundle(root, 'pre')
            post_backup = _create_backup_bundle(root, 'post')
            before_counts = {
                'customers': Customer.objects.count(),
                'products': Product.objects.count(),
                'sales_orders': SalesOrder.objects.count(),
                'inventory_transactions': InventoryTransaction.objects.count(),
            }

            output, payload = self._call_json(
                '--prefix',
                self.prefix,
                '--pre-backup',
                str(pre_backup),
                '--post-backup',
                str(post_backup),
            )

        self.assertEqual(payload['pack'], 'ERP Main UAT Evidence & Operator Checklist v1')
        self.assertEqual(payload['mode'], 'read_only_evidence_check')
        self.assertEqual(payload['overall_status'], 'warning')
        self.assertFalse(payload['safety']['writes_database'])
        self.assertFalse(payload['safety']['cleanup_enabled'])
        self.assertFalse(payload['safety']['credentials_printed'])
        self.assertEqual(len(payload['scenario_results']), 6)
        self.assertEqual(
            before_counts,
            {
                'customers': Customer.objects.count(),
                'products': Product.objects.count(),
                'sales_orders': SalesOrder.objects.count(),
                'inventory_transactions': InventoryTransaction.objects.count(),
            },
        )
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())

    def test_evidence_pack_reports_retained_real_dev_uat_data(self):
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            pre_backup = _create_backup_bundle(root, 'pre')
            post_backup = _create_backup_bundle(root, 'post')
            call_command('erp_main_real_dev_uat_drill', '--prefix', self.prefix, '--confirm-write', stdout=StringIO())

            _output, payload = self._call_json(
                '--prefix',
                self.prefix,
                '--pre-backup',
                str(pre_backup),
                '--post-backup',
                str(post_backup),
            )

        self.assertEqual(payload['overall_status'], 'ok')
        self.assertEqual(payload['backups']['pre_uat']['status'], 'ok')
        self.assertEqual(payload['backups']['post_uat']['status'], 'ok')
        self.assertTrue(payload['uat_data']['retained_for_audit'])
        self.assertFalse(payload['uat_data']['cleanup_performed'])
        self.assertEqual(payload['uat_data']['counts']['products'], 4)
        self.assertEqual(payload['uat_data']['counts']['sales_orders'], 1)
        self.assertEqual(payload['uat_data']['counts']['production_orders'], 1)
        self.assertEqual(payload['uat_data']['counts']['inventory_transactions'], 5)
        self.assertTrue(all(item['status'] == 'pass' for item in payload['scenario_results']))

    def test_evidence_pack_markdown_is_operator_friendly(self):
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            pre_backup = _create_backup_bundle(root, 'pre')
            post_backup = _create_backup_bundle(root, 'post')
            stdout = StringIO()
            call_command(
                'erp_main_uat_evidence_pack',
                '--prefix',
                self.prefix,
                '--pre-backup',
                str(pre_backup),
                '--post-backup',
                str(post_backup),
                stdout=stdout,
            )
            output = stdout.getvalue()

        self.assertIn('# ERP Main UAT Evidence & Operator Checklist v1', output)
        self.assertIn('## Operator checklist', output)
        self.assertIn('Product / Product manager', output)
        self.assertIn('Inventory operator / Manager', output)
        self.assertIn('This pack is read-only.', output)
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())

    def test_evidence_pack_rejects_uncontrolled_prefix(self):
        with self.assertRaises(CommandError):
            self._call_json('--prefix', 'QA_')


class ErpMainUatCleanupPlanCommandTests(TestCase):
    prefix = 'QA_UAT9H_'

    def _call_json(self, *args):
        stdout = StringIO()
        call_command('erp_main_uat_cleanup_plan', '--format', 'json', *args, stdout=stdout)
        return stdout.getvalue(), json.loads(stdout.getvalue())

    def test_cleanup_plan_is_read_only_and_blocks_broad_prefixes(self):
        before_counts = {
            'customers': Customer.objects.count(),
            'products': Product.objects.count(),
            'sales_orders': SalesOrder.objects.count(),
            'inventory_transactions': InventoryTransaction.objects.count(),
        }

        output, payload = self._call_json('--prefix', self.prefix)

        self.assertEqual(payload['pack'], 'ERP Main UAT Data Cleanup Plan v1')
        self.assertEqual(payload['mode'], 'read_only_cleanup_plan')
        self.assertEqual(payload['cleanup_status'], 'not_performed')
        self.assertFalse(payload['safety']['writes_database'])
        self.assertFalse(payload['safety']['delete_path_available'])
        self.assertFalse(payload['safety']['confirm_delete_available'])
        self.assertFalse(payload['safety']['broad_prefix_allowed'])
        self.assertEqual(
            before_counts,
            {
                'customers': Customer.objects.count(),
                'products': Product.objects.count(),
                'sales_orders': SalesOrder.objects.count(),
                'inventory_transactions': InventoryTransaction.objects.count(),
            },
        )
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())

        with self.assertRaises(CommandError):
            self._call_json('--prefix', 'QA_')
        with self.assertRaises(CommandError):
            self._call_json('--prefix', 'QA_UAT_')

    def test_cleanup_plan_counts_prefixed_uat_candidates_and_dependency_order(self):
        call_command('erp_main_real_dev_uat_drill', '--prefix', self.prefix, '--confirm-write', stdout=StringIO())

        _output, payload = self._call_json('--prefix', self.prefix)
        groups = {group['key']: group for group in payload['candidate_groups']}

        self.assertEqual(payload['overall_status'], 'ok')
        self.assertEqual(groups['customers']['count'], 1)
        self.assertEqual(groups['products']['count'], 4)
        self.assertEqual(groups['product_operations']['count'], 3)
        self.assertEqual(groups['product_routing_steps']['count'], 3)
        self.assertEqual(groups['sales_orders']['count'], 1)
        self.assertEqual(groups['sales_order_lines']['count'], 1)
        self.assertEqual(groups['sales_order_delivery_plans']['count'], 1)
        self.assertEqual(groups['production_demands']['count'], 1)
        self.assertEqual(groups['production_orders']['count'], 1)
        self.assertEqual(groups['production_operations']['count'], 5)
        self.assertEqual(groups['production_material_requirements']['count'], 1)
        self.assertEqual(groups['stocktakes']['count'], 1)
        self.assertEqual(groups['stocktake_lines']['count'], 1)
        self.assertEqual(groups['inventory_transactions']['count'], 5)
        self.assertEqual(payload['dependency_order'][0], 'support_audit_refs')
        self.assertLess(
            payload['dependency_order'].index('inventory_transactions'),
            payload['dependency_order'].index('products'),
        )
        self.assertTrue(any(group['key'] == 'support_audit_refs' for group in payload['blocked_or_unsafe_groups']))

    def test_cleanup_plan_markdown_is_copy_friendly(self):
        stdout = StringIO()
        call_command('erp_main_uat_cleanup_plan', '--prefix', self.prefix, stdout=stdout)
        output = stdout.getvalue()

        self.assertIn('# ERP Main UAT Data Cleanup Plan v1', output)
        self.assertIn('## Candidate cleanup scope', output)
        self.assertIn('## Blocked / unsafe groups', output)
        self.assertIn('No delete path exists in this command.', output)
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())


class ErpMainUatCleanupExecuteCommandTests(TestCase):
    prefix = 'QA_UAT9H_'

    def _call_json(self, *args):
        stdout = StringIO()
        call_command('erp_main_uat_cleanup_execute', '--format', 'json', *args, stdout=stdout)
        return stdout.getvalue(), json.loads(stdout.getvalue())

    def test_cleanup_execute_dry_run_is_default_and_does_not_write(self):
        call_command('erp_main_real_dev_uat_drill', '--prefix', self.prefix, '--confirm-write', stdout=StringIO())
        before_counts = {
            'customers': Customer.objects.filter(code__startswith=self.prefix).count(),
            'products': Product.objects.filter(code__startswith=self.prefix).count(),
            'sales_orders': SalesOrder.objects.filter(code__startswith=self.prefix).count(),
            'inventory_transactions': InventoryTransaction.objects.filter(code__startswith=self.prefix).count(),
        }

        output, payload = self._call_json('--prefix', self.prefix)

        self.assertEqual(payload['command'], 'erp_main_uat_cleanup_execute')
        self.assertEqual(payload['mode'], 'dry_run')
        self.assertEqual(payload['cleanup_status'], 'not_performed')
        self.assertEqual(payload['candidate_summary']['total_candidate_rows'], 38)
        self.assertFalse(payload['safety']['writes_database'])
        self.assertTrue(payload['safety']['dry_run_is_default'])
        self.assertTrue(payload['safety']['delete_requires_confirm_delete'])
        self.assertEqual(
            before_counts,
            {
                'customers': Customer.objects.filter(code__startswith=self.prefix).count(),
                'products': Product.objects.filter(code__startswith=self.prefix).count(),
                'sales_orders': SalesOrder.objects.filter(code__startswith=self.prefix).count(),
                'inventory_transactions': InventoryTransaction.objects.filter(code__startswith=self.prefix).count(),
            },
        )
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())

    def test_cleanup_execute_rejects_broad_prefixes(self):
        with self.assertRaises(CommandError):
            self._call_json('--prefix', 'QA_')
        with self.assertRaises(CommandError):
            self._call_json('--prefix', 'QA_UAT_')
        with self.assertRaises(CommandError):
            self._call_json('--prefix', '')

    def test_cleanup_execute_expected_total_and_backup_gates_block_delete(self):
        call_command('erp_main_real_dev_uat_drill', '--prefix', self.prefix, '--confirm-write', stdout=StringIO())

        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'backup')
            with self.assertRaises(CommandError):
                self._call_json(
                    '--prefix',
                    self.prefix,
                    '--confirm-delete',
                    '--expected-total',
                    '37',
                    '--backup-path',
                    str(backup),
                )
            with self.assertRaises(CommandError):
                self._call_json(
                    '--prefix',
                    self.prefix,
                    '--confirm-delete',
                    '--expected-total',
                    '38',
                    '--backup-path',
                    str(Path(tmpdir) / 'missing'),
                )

        self.assertEqual(Product.objects.filter(code__startswith=self.prefix).count(), 4)
        self.assertEqual(InventoryTransaction.objects.filter(code__startswith=self.prefix).count(), 5)

    def test_cleanup_execute_dependency_order_and_blocked_groups(self):
        _output, payload = self._call_json('--prefix', self.prefix)

        self.assertEqual(payload['dependency_order'][0], 'inventory_transactions')
        self.assertEqual(payload['dependency_order'][-1], 'customers')
        self.assertLess(
            payload['dependency_order'].index('production_operations'),
            payload['dependency_order'].index('production_orders'),
        )
        self.assertLess(
            payload['dependency_order'].index('sales_order_lines'),
            payload['dependency_order'].index('sales_orders'),
        )
        self.assertTrue(any(group['key'] == 'support_audit_refs' for group in payload['blocked_or_unsafe_groups']))

    def test_cleanup_execute_confirm_delete_only_deletes_prefixed_test_data(self):
        Customer.objects.create(code='REAL_KEEP', name='Real Keep')
        call_command('erp_main_real_dev_uat_drill', '--prefix', self.prefix, '--confirm-write', stdout=StringIO())

        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'backup')
            output, payload = self._call_json(
                '--prefix',
                self.prefix,
                '--confirm-delete',
                '--expected-total',
                '38',
                '--backup-path',
                str(backup),
            )

        self.assertEqual(payload['mode'], 'confirm_delete')
        self.assertEqual(payload['cleanup_status'], 'deleted')
        self.assertTrue(payload['backup']['verified'])
        self.assertTrue(payload['gates']['expected_total_matches'])
        self.assertEqual(payload['deleted_summary']['deleted_total'], 38)
        self.assertTrue(payload['deleted_summary']['matches_expected_total'])
        self.assertEqual(Customer.objects.filter(code__startswith=self.prefix).count(), 0)
        self.assertEqual(Product.objects.filter(code__startswith=self.prefix).count(), 0)
        self.assertEqual(SalesOrder.objects.filter(code__startswith=self.prefix).count(), 0)
        self.assertEqual(ProductionDemand.objects.filter(demand_code__startswith=self.prefix).count(), 0)
        self.assertEqual(ProductionOrder.objects.filter(code__startswith=self.prefix).count(), 0)
        self.assertEqual(InventoryTransaction.objects.filter(code__startswith=self.prefix).count(), 0)
        self.assertTrue(Customer.objects.filter(code='REAL_KEEP').exists())
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())
