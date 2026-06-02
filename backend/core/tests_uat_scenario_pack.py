import json
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, TestCase

from core.management.commands.erp_main_shop_floor_handoff_drill import build_shop_floor_handoff_drill_pack
from core.management.commands.erp_main_inventory_nxt_real_data_audit import build_nxt_real_data_audit_pack
from core.management.commands.erp_main_ops_post_uat_evidence import build_ops_post_uat_evidence_pack
from core.management.commands.erp_main_uat_round2_cleanup_decision import build_cleanup_decision_pack
from core.management.commands.erp_main_uat_round2_operator_evidence import build_operator_evidence_pack
from core.management.commands.erp_main_uat_round2_scenarios import build_uat_round2_scenario_pack
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


class ErpMainUatRound2ScenarioPackTests(SimpleTestCase):
    def test_command_returns_copy_friendly_json_for_round2_scenarios(self):
        stdout = StringIO()
        call_command('erp_main_uat_round2_scenarios', '--format', 'json', stdout=stdout)
        output = stdout.getvalue()
        payload = json.loads(output)

        self.assertEqual(payload['pack'], 'ERP Main UAT Round 2 Scenario Selection v1')
        self.assertEqual(payload['command'], 'erp_main_uat_round2_scenarios')
        self.assertEqual(payload['mode'], 'read_only_static_repository_check')
        self.assertEqual(payload['overall_status'], 'ok')
        self.assertEqual(payload['summary']['scenario_count'], 7)
        self.assertEqual(payload['summary']['warning_count'], 0)
        self.assertEqual(payload['context']['qa_uat9h_status'], 'cleaned_up_post_count_0')
        self.assertEqual(payload['context']['qa_shf1_status'], 'retained_for_shop_floor_audit')
        self.assertEqual(
            {item['domain'] for item in payload['scenarios']},
            {'Product', 'Sales', 'Production', 'Planning', 'Shop-floor', 'Inventory', 'Ops'},
        )
        self.assertEqual(payload['summary']['classification_counts']['mock_no_db'], 6)
        self.assertEqual(payload['summary']['classification_counts']['read_only_command'], 7)
        self.assertEqual(payload['summary']['classification_counts']['real_dev_db_gate'], 5)
        inventory = next(item for item in payload['scenarios'] if item['key'] == 'inventory_nxt_source_round2')
        self.assertEqual(inventory['status'], 'ok')
        self.assertIn('mock_no_db', inventory['classifications'])
        self.assertIn('read_only_command', inventory['classifications'])
        self.assertIn('real_dev_db_gate', inventory['classifications'])
        self.assertTrue(any('erp_main_uat_round2_scenarios' in item for item in payload['recommended_read_only_commands']))
        self.assertFalse(payload['safety']['writes_database'])
        self.assertFalse(payload['safety']['creates_uat_data'])
        self.assertFalse(payload['safety']['confirm_write_runs'])
        self.assertFalse(payload['safety']['cleanup_runs'])
        self.assertFalse(payload['safety']['backup_restore_runs'])
        self.assertFalse(payload['safety']['migration_runs'])
        self.assertFalse(payload['safety']['deploy_runs'])
        self.assertFalse(payload['safety']['smoke_http_runs'])
        self.assertFalse(payload['safety']['credentials_printed'])
        self.assertFalse(payload['safety']['qc_printing_in_scope'])
        output.encode('ascii')
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())

    def test_command_returns_markdown_with_classification_and_gate(self):
        stdout = StringIO()
        call_command('erp_main_uat_round2_scenarios', stdout=stdout)
        output = stdout.getvalue()

        self.assertIn('# ERP Main UAT Round 2 Scenario Selection v1', output)
        self.assertIn('## Classification reference', output)
        self.assertIn('mock/no-DB', output)
        self.assertIn('read-only command', output)
        self.assertIn('real-dev DB requires separate gate', output)
        self.assertIn('Inventory - Inventory NXT source breakdown and CSV', output)
        self.assertIn('Shop-floor - Shop-floor handoff retained-data report', output)
        self.assertIn('## Real-dev DB gate requirements', output)
        self.assertIn('No cleanup or restore is part of Round 2 scenario selection.', output)
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())

    def test_pack_marks_missing_evidence_as_warning_without_db_writes(self):
        payload = build_uat_round2_scenario_pack(repo_root=Path('Z:/missing/repo'))

        self.assertEqual(payload['overall_status'], 'warning')
        self.assertEqual(payload['summary']['ok_count'], 0)
        self.assertEqual(payload['summary']['warning_count'], payload['summary']['scenario_count'])
        self.assertFalse(payload['safety']['writes_database'])
        self.assertFalse(payload['safety']['creates_uat_data'])
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


class ErpMainUatRound2RealDevDrillCommandTests(TestCase):
    prefix = 'QA_UAT2R_'
    command = 'erp_main_uat_round2_real_dev_drill'
    release_patch = 'core.management.commands.erp_main_uat_round2_real_dev_drill._check_release_readiness'
    migration_patch = 'core.management.commands.erp_main_uat_round2_real_dev_drill._has_pending_migrations'
    db_patch = 'core.management.commands.erp_main_uat_round2_real_dev_drill._database_name'

    def _call_json(self, *args):
        stdout = StringIO()
        call_command(self.command, '--format', 'json', *args, stdout=stdout)
        return stdout.getvalue(), json.loads(stdout.getvalue())

    def _ok_release(self):
        return {'status': 'ok', 'summary': 'Release readiness: OK'}

    def _warning_release(self):
        return {'status': 'warning', 'summary': 'Release readiness: WARNING'}

    def assertLegacyConsoleSafe(self, output):
        output.encode('ascii')

    def test_round2_real_dev_drill_dry_run_is_default_and_does_not_write(self):
        before_counts = {
            'customers': Customer.objects.count(),
            'products': Product.objects.count(),
            'sales_orders': SalesOrder.objects.count(),
            'inventory_transactions': InventoryTransaction.objects.count(),
        }

        with patch(self.migration_patch, return_value=False), \
                patch(self.release_patch, return_value=self._ok_release()):
            output, payload = self._call_json('--prefix', self.prefix)

        self.assertEqual(payload['pack'], 'ERP Main UAT Round 2 Controlled Real-Dev Drill v1')
        self.assertEqual(payload['command'], self.command)
        self.assertEqual(payload['mode'], 'dry_run')
        self.assertEqual(payload['prefix'], self.prefix)
        self.assertEqual(payload['backup']['status'], 'pending')
        self.assertFalse(payload['safety']['default_writes_database'])
        self.assertFalse(payload['safety']['writes_database'])
        self.assertTrue(payload['safety']['write_requires_confirm_write'])
        self.assertTrue(payload['safety']['backup_required_for_write'])
        self.assertFalse(payload['safety']['cleanup_runs'])
        self.assertFalse(payload['safety']['restore_runs'])
        self.assertFalse(payload['safety']['migration_runs'])
        self.assertFalse(payload['safety']['deploy_runs'])
        self.assertFalse(payload['safety']['direct_sql_used'])
        self.assertFalse(payload['safety']['credentials_printed'])
        self.assertFalse(payload['safety']['qc_printing_in_scope'])
        self.assertFalse(payload['safety']['shop_floor_confirm_write_runs'])
        self.assertEqual(payload['planned_data_counts']['products'], 4)
        self.assertEqual({item['domain'] for item in payload['scenario_report']}, {
            'Product',
            'Sales',
            'Production',
            'Planning',
            'Shop-floor',
            'Inventory',
            'Ops',
        })
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
        self.assertLegacyConsoleSafe(output)

    def test_round2_real_dev_drill_markdown_is_copy_friendly(self):
        with patch(self.migration_patch, return_value=False), \
                patch(self.release_patch, return_value=self._ok_release()):
            stdout = StringIO()
            call_command(self.command, '--prefix', self.prefix, stdout=stdout)
            output = stdout.getvalue()

        self.assertIn('# ERP Main UAT Round 2 Controlled Real-Dev Drill v1', output)
        self.assertIn('Mode: dry_run', output)
        self.assertIn('Backup gate: pending', output)
        self.assertIn('## Planned Round 2 data', output)
        self.assertIn('## Scenario report', output)
        self.assertIn('Shop-floor QA_SHF1_ report is read-only', output)
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())
        self.assertLegacyConsoleSafe(output)

    def test_round2_real_dev_drill_rejects_wrong_prefixes(self):
        for prefix in ['', 'QA_', 'QA_UAT9H_', 'QA_SHF1_', 'QA_UAT3_']:
            with self.subTest(prefix=prefix):
                with self.assertRaises(CommandError):
                    self._call_json('--prefix', prefix)

    def test_round2_real_dev_drill_confirm_write_requires_backup_path(self):
        with self.assertRaises(CommandError):
            with patch(self.db_patch, return_value='test_erp_dev_clean'), \
                    patch(self.migration_patch, return_value=False), \
                    patch(self.release_patch, return_value=self._ok_release()):
                self._call_json('--prefix', self.prefix, '--confirm-write')

    def test_round2_real_dev_drill_confirm_write_rejects_bad_backup(self):
        with TemporaryDirectory() as tmpdir:
            with self.assertRaises(CommandError):
                with patch(self.db_patch, return_value='test_erp_dev_clean'), \
                        patch(self.migration_patch, return_value=False), \
                        patch(self.release_patch, return_value=self._ok_release()):
                    self._call_json(
                        '--prefix',
                        self.prefix,
                        '--backup-path',
                        str(Path(tmpdir) / 'missing'),
                        '--confirm-write',
                    )

    def test_round2_real_dev_drill_confirm_write_rejects_unsafe_db(self):
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'backup')
            with self.assertRaises(CommandError):
                with patch(self.db_patch, return_value='prod_main'), \
                        patch(self.migration_patch, return_value=False), \
                        patch(self.release_patch, return_value=self._ok_release()):
                    self._call_json('--prefix', self.prefix, '--backup-path', str(backup), '--confirm-write')

    def test_round2_real_dev_drill_confirm_write_rejects_pending_migrations(self):
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'backup')
            with self.assertRaises(CommandError):
                with patch(self.db_patch, return_value='test_erp_dev_clean'), \
                        patch(self.migration_patch, return_value=True), \
                        patch(self.release_patch, return_value=self._ok_release()):
                    self._call_json('--prefix', self.prefix, '--backup-path', str(backup), '--confirm-write')

    def test_round2_real_dev_drill_confirm_write_rejects_release_warning(self):
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'backup')
            with self.assertRaises(CommandError):
                with patch(self.db_patch, return_value='test_erp_dev_clean'), \
                        patch(self.migration_patch, return_value=False), \
                        patch(self.release_patch, return_value=self._warning_release()):
                    self._call_json('--prefix', self.prefix, '--backup-path', str(backup), '--confirm-write')

    def test_round2_real_dev_drill_confirm_write_rejects_existing_prefix(self):
        ProductUnit.objects.create(code='QA_UAT2R_U', name='Existing Round 2 unit')
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'backup')
            with self.assertRaises(CommandError):
                with patch(self.db_patch, return_value='test_erp_dev_clean'), \
                        patch(self.migration_patch, return_value=False), \
                        patch(self.release_patch, return_value=self._ok_release()):
                    self._call_json('--prefix', self.prefix, '--backup-path', str(backup), '--confirm-write')

    def test_round2_real_dev_drill_confirm_write_creates_only_prefixed_test_data(self):
        Customer.objects.create(code='REAL_KEEP', name='Real Keep')
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'backup')
            with patch(self.db_patch, return_value='test_erp_dev_clean'), \
                    patch(self.migration_patch, return_value=False), \
                    patch(self.release_patch, return_value=self._ok_release()), \
                    patch(
                        'core.management.commands.erp_main_uat_round2_real_dev_drill._shop_floor_report',
                        return_value={
                            'status': 'pass',
                            'source': 'read_only_existing_report',
                            'writes_database': False,
                            'summary': 'QA_SHF1_ report ok',
                            'counts': {'production_orders': 1, 'production_operations': 7, 'audit_logs': 7},
                        },
                    ):
                output, payload = self._call_json(
                    '--prefix',
                    self.prefix,
                    '--backup-path',
                    str(backup),
                    '--confirm-write',
                )

        self.assertEqual(payload['mode'], 'confirm_write')
        self.assertEqual(payload['overall_status'], 'ok')
        self.assertTrue(payload['backup']['verified'])
        self.assertTrue(payload['safety']['writes_database'])
        self.assertEqual(Product.objects.filter(code__startswith=self.prefix).count(), 4)
        self.assertEqual(SalesOrder.objects.filter(code__startswith=self.prefix).count(), 1)
        self.assertEqual(ProductionDemand.objects.filter(demand_code__startswith=self.prefix).count(), 1)
        self.assertEqual(ProductionOrder.objects.filter(code__startswith=self.prefix).count(), 1)
        self.assertEqual(InventoryTransaction.objects.filter(code__startswith=self.prefix).count(), 5)
        self.assertTrue(Customer.objects.filter(code='REAL_KEEP').exists())
        rows = {item['key']: item for item in payload['scenario_report']}
        self.assertEqual(rows['product_readiness']['status'], 'pass')
        self.assertEqual(rows['sales_snapshot_delivery_plan']['status'], 'pass')
        self.assertEqual(rows['production_handoff']['status'], 'pass')
        self.assertEqual(rows['planning_board_advisory']['status'], 'pass')
        self.assertEqual(rows['inventory_nxt_source_breakdown']['status'], 'pass')
        self.assertEqual(rows['inventory_nxt_source_breakdown']['source_groups'], [
            'MANUAL',
            'PRODUCTION',
            'PURCHASE',
            'STOCKTAKE',
            'TRANSFER',
        ])
        self.assertFalse(rows['shop_floor_retained_report']['writes_database'])
        self.assertFalse(rows['cleanup_status_qa_uat9h']['writes_database'])
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())
        self.assertLegacyConsoleSafe(output)

    def test_round2_real_dev_drill_reports_existing_prefixed_data_read_only(self):
        Customer.objects.create(code='REAL_KEEP', name='Real Keep')
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'backup')
            with patch(self.db_patch, return_value='test_erp_dev_clean'), \
                    patch(self.migration_patch, return_value=False), \
                    patch(self.release_patch, return_value=self._ok_release()), \
                    patch(
                        'core.management.commands.erp_main_uat_round2_real_dev_drill._shop_floor_report',
                        return_value={
                            'status': 'pass',
                            'source': 'read_only_existing_report',
                            'writes_database': False,
                            'summary': 'QA_SHF1_ report ok',
                            'counts': {'production_orders': 1, 'production_operations': 7, 'audit_logs': 7},
                        },
                    ):
                self._call_json(
                    '--prefix',
                    self.prefix,
                    '--backup-path',
                    str(backup),
                    '--confirm-write',
                )
                before_counts = {
                    'customers': Customer.objects.count(),
                    'products': Product.objects.count(),
                    'sales_orders': SalesOrder.objects.count(),
                    'production_orders': ProductionOrder.objects.count(),
                    'inventory_transactions': InventoryTransaction.objects.count(),
                }
                output, payload = self._call_json('--prefix', self.prefix, '--backup-path', str(backup))

        self.assertEqual(payload['mode'], 'dry_run')
        self.assertEqual(payload['overall_status'], 'ok')
        self.assertIsNone(payload['write_result'])
        self.assertEqual(payload['existing_data_report']['status'], 'pass')
        self.assertFalse(payload['existing_data_report']['writes_database'])
        self.assertFalse(payload['safety']['writes_database'])
        self.assertEqual(payload['existing_prefixed_total'], 38)
        self.assertEqual(
            before_counts,
            {
                'customers': Customer.objects.count(),
                'products': Product.objects.count(),
                'sales_orders': SalesOrder.objects.count(),
                'production_orders': ProductionOrder.objects.count(),
                'inventory_transactions': InventoryTransaction.objects.count(),
            },
        )

        rows = {item['key']: item for item in payload['scenario_report']}
        self.assertEqual(rows['product_readiness']['status'], 'pass')
        self.assertEqual(rows['sales_snapshot_delivery_plan']['status'], 'pass')
        self.assertEqual(rows['production_handoff']['status'], 'pass')
        self.assertEqual(rows['planning_board_advisory']['status'], 'pass')
        self.assertEqual(rows['shop_floor_retained_report']['status'], 'pass')
        self.assertEqual(rows['inventory_nxt_source_breakdown']['status'], 'pass')
        self.assertEqual(rows['ops_readiness']['status'], 'pass')
        self.assertEqual(rows['cleanup_status_qa_uat9h']['status'], 'pass')
        self.assertTrue(rows['sales_snapshot_delivery_plan']['checks']['snapshot_stable_after_qty_price_note_update'])
        self.assertEqual(rows['production_handoff']['checks']['production_order_code'], f'{self.prefix}MO001')
        self.assertEqual(rows['inventory_nxt_source_breakdown']['source_groups'], [
            'MANUAL',
            'PRODUCTION',
            'PURCHASE',
            'STOCKTAKE',
            'TRANSFER',
        ])
        self.assertTrue(all(not item['writes_database'] for item in rows.values()))
        self.assertTrue(Customer.objects.filter(code='REAL_KEEP').exists())
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())
        self.assertLegacyConsoleSafe(output)


class ErpMainUatRound2OperatorEvidenceCommandTests(TestCase):
    prefix = 'QA_UAT2R_'
    command = 'erp_main_uat_round2_operator_evidence'
    release_patch = 'core.management.commands.erp_main_uat_round2_operator_evidence._check_release_readiness'
    shop_floor_patch = 'core.management.commands.erp_main_uat_round2_operator_evidence._safe_shop_floor_report'
    round2_release_patch = 'core.management.commands.erp_main_uat_round2_real_dev_drill._check_release_readiness'
    round2_migration_patch = 'core.management.commands.erp_main_uat_round2_real_dev_drill._has_pending_migrations'
    round2_db_patch = 'core.management.commands.erp_main_uat_round2_real_dev_drill._database_name'
    round2_shop_floor_patch = 'core.management.commands.erp_main_uat_round2_real_dev_drill._shop_floor_report'

    def _call_json(self, *args):
        stdout = StringIO()
        call_command(self.command, '--format', 'json', *args, stdout=stdout)
        return stdout.getvalue(), json.loads(stdout.getvalue())

    def _ok_release(self):
        return {'status': 'ok', 'summary': 'Release readiness: OK'}

    def _shop_floor_ok(self):
        return {
            'status': 'pass',
            'prefix': 'QA_SHF1_',
            'summary': 'QA_SHF1_ retained report ok',
            'counts': {'production_orders': 1, 'production_operations': 7, 'audit_logs': 7},
            'scenario_results': [],
            'writes_database': False,
        }

    def _round2_shop_floor_ok(self):
        return {
            'status': 'pass',
            'source': 'read_only_existing_report',
            'writes_database': False,
            'summary': 'QA_SHF1_ report ok',
            'counts': {'production_orders': 1, 'production_operations': 7, 'audit_logs': 7},
        }

    def assertLegacyConsoleSafe(self, output):
        output.encode('ascii')

    def test_operator_evidence_is_read_only_when_round2_data_is_missing(self):
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'post_uat')
            before_counts = {
                'customers': Customer.objects.count(),
                'products': Product.objects.count(),
                'sales_orders': SalesOrder.objects.count(),
                'inventory_transactions': InventoryTransaction.objects.count(),
            }
            with patch(self.release_patch, return_value=self._ok_release()), \
                    patch(self.round2_release_patch, return_value=self._ok_release()), \
                    patch(self.round2_migration_patch, return_value=False), \
                    patch(self.shop_floor_patch, return_value=self._shop_floor_ok()), \
                    patch(self.round2_shop_floor_patch, return_value=self._round2_shop_floor_ok()):
                output, payload = self._call_json('--backup-path', str(backup))

        self.assertEqual(payload['pack'], 'ERP Main UAT Round 2 Operator Evidence Review v1')
        self.assertEqual(payload['command'], self.command)
        self.assertEqual(payload['mode'], 'read_only_operator_evidence')
        self.assertEqual(payload['overall_status'], 'warning')
        self.assertEqual(payload['data_retained']['qa_uat2r']['total_rows'], 0)
        self.assertFalse(payload['safety']['writes_database'])
        self.assertFalse(payload['safety']['creates_uat_data'])
        self.assertFalse(payload['safety']['confirm_write_runs'])
        self.assertFalse(payload['safety']['cleanup_runs'])
        self.assertFalse(payload['safety']['backup_restore_runs'])
        self.assertFalse(payload['safety']['migration_runs'])
        self.assertFalse(payload['safety']['deploy_runs'])
        self.assertFalse(payload['safety']['credentials_printed'])
        self.assertFalse(payload['safety']['qc_printing_in_scope'])
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
        self.assertLegacyConsoleSafe(output)

    def test_operator_evidence_reports_existing_round2_data_for_operators(self):
        Customer.objects.create(code='REAL_KEEP', name='Real Keep')
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'post_uat')
            with patch(self.round2_db_patch, return_value='test_erp_dev_clean'), \
                    patch(self.round2_migration_patch, return_value=False), \
                    patch(self.round2_release_patch, return_value=self._ok_release()), \
                    patch(self.round2_shop_floor_patch, return_value=self._round2_shop_floor_ok()):
                call_command(
                    'erp_main_uat_round2_real_dev_drill',
                    '--prefix',
                    self.prefix,
                    '--backup-path',
                    str(backup),
                    '--confirm-write',
                    '--format',
                    'json',
                    stdout=StringIO(),
                )
            before_counts = {
                'customers': Customer.objects.count(),
                'products': Product.objects.count(),
                'sales_orders': SalesOrder.objects.count(),
                'production_orders': ProductionOrder.objects.count(),
                'inventory_transactions': InventoryTransaction.objects.count(),
            }
            with patch(self.release_patch, return_value=self._ok_release()), \
                    patch(self.round2_release_patch, return_value=self._ok_release()), \
                    patch(self.round2_migration_patch, return_value=False), \
                    patch(self.shop_floor_patch, return_value=self._shop_floor_ok()), \
                    patch(self.round2_shop_floor_patch, return_value=self._round2_shop_floor_ok()):
                output, payload = self._call_json('--backup-path', str(backup))

        self.assertEqual(payload['overall_status'], 'ok')
        self.assertEqual(payload['data_retained']['qa_uat2r']['status'], 'retained_for_audit')
        self.assertEqual(payload['data_retained']['qa_uat2r']['total_rows'], 38)
        self.assertTrue(payload['data_retained']['qa_uat2r']['confirm_write_ran_exactly_once'])
        self.assertEqual(payload['data_retained']['qa_shf1']['report_status'], 'pass')
        self.assertEqual(payload['data_retained']['qa_uat9h']['status'], 'cleaned_up_post_count_0')
        self.assertTrue(payload['cleanup_guidance']['requires_future_vang_milestone'])
        self.assertEqual(payload['source_breakdown']['groups'], [
            'MANUAL',
            'PRODUCTION',
            'PURCHASE',
            'STOCKTAKE',
            'TRANSFER',
        ])
        self.assertTrue(payload['source_breakdown']['all_groups_present'])
        module_rows = {item['domain']: item for item in payload['module_evidence']}
        self.assertEqual(set(module_rows), {'Product', 'Sales', 'Production', 'Planning', 'Shop-floor', 'Inventory', 'Ops'})
        self.assertTrue(all(item['status'] == 'pass' for item in module_rows.values()))
        self.assertTrue(all(not item['writes_database'] for item in module_rows.values()))
        self.assertIn('Product', payload['scenario_classification']['mock_no_db'])
        self.assertIn('Inventory', payload['scenario_classification']['read_only_command'])
        self.assertIn('Sales', payload['scenario_classification']['real_dev_db_gate'])
        self.assertFalse(payload['safety']['writes_database'])
        self.assertFalse(payload['safety']['confirm_write_runs'])
        self.assertEqual(payload['safety']['historical_round2_confirm_write_total'], 1)
        self.assertEqual(
            before_counts,
            {
                'customers': Customer.objects.count(),
                'products': Product.objects.count(),
                'sales_orders': SalesOrder.objects.count(),
                'production_orders': ProductionOrder.objects.count(),
                'inventory_transactions': InventoryTransaction.objects.count(),
            },
        )
        self.assertTrue(Customer.objects.filter(code='REAL_KEEP').exists())
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())
        self.assertLegacyConsoleSafe(output)

    def test_operator_evidence_markdown_is_copy_friendly_and_read_only(self):
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'post_uat')
            with patch(self.release_patch, return_value=self._ok_release()), \
                    patch(self.round2_release_patch, return_value=self._ok_release()), \
                    patch(self.round2_migration_patch, return_value=False), \
                    patch(self.shop_floor_patch, return_value=self._shop_floor_ok()), \
                    patch(self.round2_shop_floor_patch, return_value=self._round2_shop_floor_ok()):
                stdout = StringIO()
                call_command(self.command, '--backup-path', str(backup), stdout=stdout)
                output = stdout.getvalue()

        self.assertIn('# ERP Main UAT Round 2 Operator Evidence Review v1', output)
        self.assertIn('## Module evidence', output)
        self.assertIn('## Data retained for audit', output)
        self.assertIn('QA_UAT2R_ remains retained for audit.', output)
        self.assertIn('This command is read-only and has no confirm-write option.', output)
        self.assertIn('QC Printing', output)
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())
        self.assertLegacyConsoleSafe(output)

    def test_operator_evidence_rejects_wrong_prefix(self):
        for prefix in ['', 'QA_', 'QA_UAT9H_', 'QA_SHF1_', 'QA_UAT3_']:
            with self.subTest(prefix=prefix):
                with self.assertRaises(CommandError):
                    build_operator_evidence_pack(prefix)


class ErpMainUatRound2CleanupDecisionCommandTests(TestCase):
    prefix = 'QA_UAT2R_'
    command = 'erp_main_uat_round2_cleanup_decision'
    operator_release_patch = 'core.management.commands.erp_main_uat_round2_operator_evidence._check_release_readiness'
    operator_shop_floor_patch = 'core.management.commands.erp_main_uat_round2_operator_evidence._safe_shop_floor_report'
    round2_release_patch = 'core.management.commands.erp_main_uat_round2_real_dev_drill._check_release_readiness'
    round2_migration_patch = 'core.management.commands.erp_main_uat_round2_real_dev_drill._has_pending_migrations'
    round2_db_patch = 'core.management.commands.erp_main_uat_round2_real_dev_drill._database_name'
    round2_shop_floor_patch = 'core.management.commands.erp_main_uat_round2_real_dev_drill._shop_floor_report'
    cleanup_execute_migration_patch = 'core.management.commands.erp_main_uat_cleanup_execute._pending_migrations'
    cleanup_execute_db_patch = 'core.management.commands.erp_main_uat_cleanup_execute._database_name'

    def _call_json(self, *args):
        stdout = StringIO()
        call_command(self.command, '--format', 'json', *args, stdout=stdout)
        return stdout.getvalue(), json.loads(stdout.getvalue())

    def _ok_release(self):
        return {'status': 'ok', 'summary': 'Release readiness: OK'}

    def _shop_floor_ok(self):
        return {
            'status': 'pass',
            'prefix': 'QA_SHF1_',
            'summary': 'QA_SHF1_ retained report ok',
            'counts': {'production_orders': 1, 'production_operations': 7, 'audit_logs': 7},
            'scenario_results': [],
            'writes_database': False,
        }

    def _round2_shop_floor_ok(self):
        return {
            'status': 'pass',
            'source': 'read_only_existing_report',
            'writes_database': False,
            'summary': 'QA_SHF1_ report ok',
            'counts': {'production_orders': 1, 'production_operations': 7, 'audit_logs': 7},
        }

    def _safe_patches(self):
        return (
            patch(self.operator_release_patch, return_value=self._ok_release()),
            patch(self.operator_shop_floor_patch, return_value=self._shop_floor_ok()),
            patch(self.round2_release_patch, return_value=self._ok_release()),
            patch(self.round2_migration_patch, return_value=False),
            patch(self.round2_shop_floor_patch, return_value=self._round2_shop_floor_ok()),
            patch(self.cleanup_execute_migration_patch, return_value=[]),
            patch(self.cleanup_execute_db_patch, return_value='test_erp_dev_clean'),
        )

    def assertLegacyConsoleSafe(self, output):
        output.encode('ascii')

    def test_cleanup_decision_is_read_only_when_round2_data_is_missing(self):
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'post_uat')
            before_counts = {
                'customers': Customer.objects.count(),
                'products': Product.objects.count(),
                'sales_orders': SalesOrder.objects.count(),
                'inventory_transactions': InventoryTransaction.objects.count(),
            }
            patches = self._safe_patches()
            with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
                output, payload = self._call_json('--backup-path', str(backup))

        self.assertEqual(payload['pack'], 'ERP Main UAT Round 2 Cleanup Decision Plan v1')
        self.assertEqual(payload['command'], self.command)
        self.assertEqual(payload['mode'], 'read_only_cleanup_decision')
        self.assertEqual(payload['overall_status'], 'warning')
        self.assertEqual(payload['data_status']['qa_uat2r']['total_rows'], 0)
        self.assertEqual(payload['data_status']['qa_uat2r']['cleanup_candidate_rows'], 0)
        self.assertEqual(payload['cleanup_decision']['recommended_decision'], 'investigate_before_cleanup')
        self.assertFalse(payload['safety']['writes_database'])
        self.assertFalse(payload['safety']['cleanup_runs'])
        self.assertFalse(payload['safety']['confirm_delete_runs'])
        self.assertFalse(payload['safety']['confirm_write_runs'])
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
        self.assertLegacyConsoleSafe(output)

    def test_cleanup_decision_reports_retained_round2_scope_and_future_gate(self):
        Customer.objects.create(code='REAL_KEEP', name='Real Keep')
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'post_uat')
            with patch(self.round2_db_patch, return_value='test_erp_dev_clean'), \
                    patch(self.round2_migration_patch, return_value=False), \
                    patch(self.round2_release_patch, return_value=self._ok_release()), \
                    patch(self.round2_shop_floor_patch, return_value=self._round2_shop_floor_ok()):
                call_command(
                    'erp_main_uat_round2_real_dev_drill',
                    '--prefix',
                    self.prefix,
                    '--backup-path',
                    str(backup),
                    '--confirm-write',
                    '--format',
                    'json',
                    stdout=StringIO(),
                )
            before_counts = {
                'customers': Customer.objects.count(),
                'products': Product.objects.count(),
                'sales_orders': SalesOrder.objects.count(),
                'production_orders': ProductionOrder.objects.count(),
                'inventory_transactions': InventoryTransaction.objects.count(),
            }
            patches = self._safe_patches()
            with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
                output, payload = self._call_json('--backup-path', str(backup))

        self.assertEqual(payload['overall_status'], 'ok')
        self.assertEqual(payload['cleanup_decision']['status'], 'ready_for_decision')
        self.assertEqual(payload['cleanup_decision']['recommended_decision'], 'defer_cleanup')
        self.assertTrue(payload['cleanup_decision']['business_signoff_required_before_cleanup'])
        self.assertEqual(payload['data_status']['qa_uat2r']['total_rows'], 38)
        self.assertEqual(payload['data_status']['qa_uat2r']['cleanup_candidate_rows'], 38)
        self.assertEqual(payload['data_status']['qa_uat2r']['dry_run_candidate_rows'], 38)
        self.assertFalse(payload['data_status']['qa_shf1']['cleanup_round2_scope'])
        self.assertEqual(payload['data_status']['qa_uat9h']['cleanup_plan_candidate_rows'], 0)
        self.assertEqual(payload['cleanup_scope']['allowed_prefix'], self.prefix)
        self.assertEqual(payload['cleanup_scope']['expected_total'], 38)
        selectors = ' '.join(group['selector'] for group in payload['cleanup_scope']['candidate_groups'])
        self.assertIn(self.prefix, selectors)
        self.assertNotIn('QA_UAT9H_', selectors)
        self.assertIn('QA_SHF1_', payload['do_not_touch'])
        self.assertIn('QA_UAT9H_', payload['do_not_touch'])
        self.assertIn('QC Printing', payload['do_not_touch'])
        gate = payload['future_cleanup_gate']['current_dry_run']
        self.assertEqual(gate['candidate_total'], 38)
        self.assertTrue(gate['expected_total_matches'])
        self.assertTrue(gate['backup_verified'])
        self.assertFalse(gate['confirm_delete'])
        self.assertFalse(gate['writes_database'])
        self.assertTrue(payload['future_cleanup_gate']['fresh_backup_required_for_actual_cleanup'])
        self.assertFalse(payload['safety']['writes_database'])
        self.assertFalse(payload['safety']['cleanup_runs'])
        self.assertFalse(payload['safety']['backup_created'])
        self.assertEqual(
            before_counts,
            {
                'customers': Customer.objects.count(),
                'products': Product.objects.count(),
                'sales_orders': SalesOrder.objects.count(),
                'production_orders': ProductionOrder.objects.count(),
                'inventory_transactions': InventoryTransaction.objects.count(),
            },
        )
        self.assertTrue(Customer.objects.filter(code='REAL_KEEP').exists())
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())
        self.assertLegacyConsoleSafe(output)

    def test_cleanup_decision_markdown_is_copy_friendly_and_read_only(self):
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'post_uat')
            patches = self._safe_patches()
            with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
                stdout = StringIO()
                call_command(self.command, '--backup-path', str(backup), stdout=stdout)
                output = stdout.getvalue()

        self.assertIn('# ERP Main UAT Round 2 Cleanup Decision Plan v1', output)
        self.assertIn('Recommended decision:', output)
        self.assertIn('## Future cleanup gate', output)
        self.assertIn('Actual cleanup is a separate VANG milestone.', output)
        self.assertIn('This command is read-only.', output)
        self.assertIn('QC Printing', output)
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())
        self.assertLegacyConsoleSafe(output)

    def test_cleanup_decision_rejects_wrong_prefix(self):
        for prefix in ['', 'QA_', 'QA_UAT9H_', 'QA_SHF1_', 'QA_UAT3_']:
            with self.subTest(prefix=prefix):
                with self.assertRaises(CommandError):
                    build_cleanup_decision_pack(prefix)


class ErpMainInventoryNxtRealDataAuditCommandTests(TestCase):
    prefix = 'QA_UAT2R_'
    command = 'erp_main_inventory_nxt_real_data_audit'
    round2_release_patch = 'core.management.commands.erp_main_uat_round2_real_dev_drill._check_release_readiness'
    round2_migration_patch = 'core.management.commands.erp_main_uat_round2_real_dev_drill._has_pending_migrations'
    round2_db_patch = 'core.management.commands.erp_main_uat_round2_real_dev_drill._database_name'
    round2_shop_floor_patch = 'core.management.commands.erp_main_uat_round2_real_dev_drill._shop_floor_report'

    def _call_json(self, *args):
        stdout = StringIO()
        call_command(self.command, '--format', 'json', *args, stdout=stdout)
        return stdout.getvalue(), json.loads(stdout.getvalue())

    def _ok_release(self):
        return {'status': 'ok', 'summary': 'Release readiness: OK'}

    def _round2_shop_floor_ok(self):
        return {
            'status': 'pass',
            'source': 'read_only_existing_report',
            'writes_database': False,
            'summary': 'QA_SHF1_ report ok',
            'counts': {'production_orders': 1, 'production_operations': 7, 'audit_logs': 7},
        }

    def assertLegacyConsoleSafe(self, output):
        output.encode('ascii')

    def _create_round2_data(self, backup_path):
        with patch(self.round2_db_patch, return_value='test_erp_dev_clean'), \
                patch(self.round2_migration_patch, return_value=False), \
                patch(self.round2_release_patch, return_value=self._ok_release()), \
                patch(self.round2_shop_floor_patch, return_value=self._round2_shop_floor_ok()):
            call_command(
                'erp_main_uat_round2_real_dev_drill',
                '--prefix',
                self.prefix,
                '--backup-path',
                str(backup_path),
                '--confirm-write',
                '--format',
                'json',
                stdout=StringIO(),
            )

    def test_nxt_real_data_audit_is_read_only_when_data_is_missing(self):
        before_counts = {
            'customers': Customer.objects.count(),
            'products': Product.objects.count(),
            'sales_orders': SalesOrder.objects.count(),
            'production_orders': ProductionOrder.objects.count(),
            'inventory_transactions': InventoryTransaction.objects.count(),
        }

        output, payload = self._call_json('--prefix', self.prefix)

        self.assertEqual(payload['pack'], 'Inventory NXT Real-Data Audit Drill v1')
        self.assertEqual(payload['command'], self.command)
        self.assertEqual(payload['mode'], 'read_only_nxt_real_data_audit')
        self.assertEqual(payload['overall_status'], 'warning')
        self.assertEqual(payload['data_status']['inventory_transactions'], 0)
        self.assertEqual(payload['scope']['status'], 'warning')
        self.assertFalse(payload['safety']['writes_database'])
        self.assertFalse(payload['safety']['creates_uat_data'])
        self.assertFalse(payload['safety']['cleanup_runs'])
        self.assertFalse(payload['safety']['confirm_write_available'])
        self.assertFalse(payload['safety']['confirm_delete_available'])
        self.assertFalse(payload['safety']['backup_created'])
        self.assertFalse(payload['safety']['restore_runs'])
        self.assertFalse(payload['safety']['migration_runs'])
        self.assertFalse(payload['safety']['deploy_runs'])
        self.assertFalse(payload['safety']['direct_sql_used'])
        self.assertFalse(payload['safety']['credentials_printed'])
        self.assertFalse(payload['safety']['qc_printing_in_scope'])
        self.assertEqual(
            before_counts,
            {
                'customers': Customer.objects.count(),
                'products': Product.objects.count(),
                'sales_orders': SalesOrder.objects.count(),
                'production_orders': ProductionOrder.objects.count(),
                'inventory_transactions': InventoryTransaction.objects.count(),
            },
        )
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())
        self.assertLegacyConsoleSafe(output)

    def test_nxt_real_data_audit_reports_retained_round2_nxt_breakdown(self):
        Customer.objects.create(code='REAL_KEEP', name='Real Keep')
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'post_uat')
            self._create_round2_data(backup)

            before_counts = {
                'customers': Customer.objects.count(),
                'products': Product.objects.count(),
                'sales_orders': SalesOrder.objects.count(),
                'production_orders': ProductionOrder.objects.count(),
                'inventory_transactions': InventoryTransaction.objects.count(),
            }
            output, payload = self._call_json('--prefix', self.prefix)

        self.assertEqual(payload['overall_status'], 'ok')
        self.assertEqual(payload['data_status']['round2_scoped_rows'], 38)
        self.assertEqual(payload['data_status']['inventory_transactions'], 5)
        self.assertEqual(payload['scope']['status'], 'ok')
        self.assertEqual(set(payload['source_results']), {'PURCHASE', 'PRODUCTION', 'STOCKTAKE', 'TRANSFER', 'MANUAL'})
        self.assertTrue(all(row['status'] == 'pass' for row in payload['source_results'].values()))
        self.assertEqual(payload['source_results']['PURCHASE']['in_qty'], '50')
        self.assertEqual(payload['source_results']['PRODUCTION']['out_qty'], '5')
        self.assertEqual(payload['source_results']['STOCKTAKE']['in_qty'], '2')
        self.assertEqual(payload['source_results']['TRANSFER']['in_qty'], '3')
        self.assertEqual(payload['source_results']['TRANSFER']['out_qty'], '3')
        self.assertEqual(payload['source_results']['MANUAL']['out_qty'], '1')
        self.assertEqual(payload['source_results']['PURCHASE']['source_document_types']['PURCHASE_REFERENCE'], 1)
        self.assertEqual(payload['source_results']['PRODUCTION']['source_document_types']['PRODUCTION_ORDER'], 1)
        self.assertEqual(payload['source_results']['STOCKTAKE']['source_document_types']['STOCKTAKE'], 1)
        self.assertEqual(payload['source_results']['TRANSFER']['source_document_types']['TRANSFER_TRANSACTION'], 2)
        self.assertEqual(payload['source_results']['MANUAL']['source_document_types']['MANUAL'], 1)
        self.assertEqual(payload['totals_reconciliation']['status'], 'pass')
        self.assertTrue(payload['totals_reconciliation']['source_in_matches_total'])
        self.assertTrue(payload['totals_reconciliation']['source_out_matches_total'])
        self.assertTrue(all(row['closing_matches_formula'] for row in payload['totals_reconciliation']['row_checks']))
        self.assertFalse(payload['safety']['writes_database'])
        self.assertFalse(payload['safety']['cleanup_runs'])
        self.assertEqual(
            before_counts,
            {
                'customers': Customer.objects.count(),
                'products': Product.objects.count(),
                'sales_orders': SalesOrder.objects.count(),
                'production_orders': ProductionOrder.objects.count(),
                'inventory_transactions': InventoryTransaction.objects.count(),
            },
        )
        self.assertTrue(Customer.objects.filter(code='REAL_KEEP').exists())
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())
        self.assertLegacyConsoleSafe(output)

    def test_nxt_real_data_audit_markdown_is_copy_friendly(self):
        stdout = StringIO()
        call_command(self.command, '--prefix', self.prefix, stdout=stdout)
        output = stdout.getvalue()

        self.assertIn('# Inventory NXT Real-Data Audit Drill v1', output)
        self.assertIn('Writes database: False', output)
        self.assertIn('## Source group result', output)
        self.assertIn('## Totals reconciliation', output)
        self.assertIn('This command is read-only', output)
        self.assertIn('QC Printing', output)
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())
        self.assertLegacyConsoleSafe(output)

    def test_nxt_real_data_audit_rejects_wrong_prefix(self):
        for prefix in ['', 'QA_', 'QA_UAT9H_', 'QA_SHF1_', 'QA_UAT3_']:
            with self.subTest(prefix=prefix):
                with self.assertRaises(CommandError):
                    build_nxt_real_data_audit_pack(prefix)


class ErpMainOpsPostUatEvidenceCommandTests(TestCase):
    command = 'erp_main_ops_post_uat_evidence'
    git_patch = 'core.management.commands.erp_main_ops_post_uat_evidence._git_evidence'
    migration_patch = 'core.management.commands.erp_main_ops_post_uat_evidence._migration_evidence'
    release_patch = 'core.management.commands.erp_main_ops_post_uat_evidence._safe_release_readiness'
    alert_patch = 'core.management.commands.erp_main_ops_post_uat_evidence._safe_alert_readiness'
    operator_patch = 'core.management.commands.erp_main_ops_post_uat_evidence._safe_operator_evidence'
    nxt_patch = 'core.management.commands.erp_main_ops_post_uat_evidence._safe_nxt_real_data_audit'
    cleanup_patch = 'core.management.commands.erp_main_ops_post_uat_evidence._safe_cleanup_decision'

    def _call_json(self, *args):
        stdout = StringIO()
        call_command(self.command, '--format', 'json', *args, stdout=stdout)
        return stdout.getvalue(), json.loads(stdout.getvalue())

    def _git_ok(self):
        return {
            'repo_root': 'D:\\ERP-Carton-2D-snapshot',
            'branch': 'feature/sales-snapshot-v2',
            'head': '85e4784',
            'head_message': '85e4784 Add inventory NXT real-data audit report',
            'status_line': '## feature/sales-snapshot-v2...origin/feature/sales-snapshot-v2',
            'clean': True,
            'dirty_files': [],
            'ahead': 0,
            'behind': 0,
            'synced_with_origin': True,
            'tags_at_head': ['checkpoint-9v-inventory-nxt-real-data-audit-drill-v1'],
            'latest_checkpoint_tag': 'checkpoint-9v-inventory-nxt-real-data-audit-drill-v1',
            'expected_checkpoint_tag': 'checkpoint-9v-inventory-nxt-real-data-audit-drill-v1',
            'expected_checkpoint_head': '85e4784',
        }

    def _migrations_ok(self):
        return {
            'status': 'ok',
            'pending_count': 0,
            'apps': [],
            'items': [],
            'migration_runs': False,
        }

    def _release_ok(self):
        return {
            'status': 'ok',
            'summary': 'Release readiness: OK',
            'checks': {'pending_migrations': '0'},
        }

    def _alert_ok(self):
        return {
            'status': 'ok',
            'summary': 'Alert channel readiness: OK',
            'configured_count': 1,
            'delivery_status': 'ok',
            'email_delivery_status': 'ok',
            'warning_count': 0,
        }

    def _operator_ok(self):
        return {
            'status': 'ok',
            'summary': 'operator evidence ok',
            'module_statuses': {
                'Product': 'pass',
                'Sales': 'pass',
                'Production': 'pass',
                'Planning': 'pass',
                'Shop-floor': 'pass',
                'Inventory': 'pass',
                'Ops': 'pass',
            },
            'module_evidence': [],
            'data_retained': {
                'qa_uat2r': {
                    'prefix': 'QA_UAT2R_',
                    'status': 'retained_for_audit',
                    'total_rows': 38,
                },
                'qa_shf1': {
                    'prefix': 'QA_SHF1_',
                    'status': 'retained_for_shop_floor_audit',
                    'cleanup_round2_scope': False,
                },
                'qa_uat9h': {
                    'prefix': 'QA_UAT9H_',
                    'status': 'cleaned_up_post_count_0',
                    'candidate_total': 0,
                },
            },
            'source_breakdown': {
                'status': 'pass',
                'groups': ['MANUAL', 'PRODUCTION', 'PURCHASE', 'STOCKTAKE', 'TRANSFER'],
                'all_groups_present': True,
            },
            'safety': {'writes_database': False},
        }

    def _nxt_ok(self):
        return {
            'status': 'ok',
            'summary': 'NXT real-data audit ok',
            'data_status': {
                'status': 'retained_for_audit',
                'round2_scoped_rows': 38,
                'inventory_transactions': 5,
            },
            'source_results': {
                'PURCHASE': 'pass',
                'PRODUCTION': 'pass',
                'STOCKTAKE': 'pass',
                'TRANSFER': 'pass',
                'MANUAL': 'pass',
            },
            'totals_reconciliation': {
                'status': 'pass',
                'source_in_matches_total': True,
                'source_out_matches_total': True,
                'net_qty': '46',
            },
            'safety': {'writes_database': False},
        }

    def _cleanup_ok(self):
        return {
            'status': 'ok',
            'summary': 'cleanup decision defer_cleanup',
            'cleanup_decision': {
                'recommended_decision': 'defer_cleanup',
            },
            'data_status': {
                'qa_uat2r': {
                    'prefix': 'QA_UAT2R_',
                    'status': 'retained_for_audit',
                    'total_rows': 38,
                    'cleanup_candidate_rows': 38,
                },
                'qa_shf1': {
                    'prefix': 'QA_SHF1_',
                    'status': 'retained_for_shop_floor_audit',
                    'cleanup_round2_scope': False,
                },
                'qa_uat9h': {
                    'prefix': 'QA_UAT9H_',
                    'status': 'cleaned_up_post_count_0',
                    'cleanup_plan_candidate_rows': 0,
                },
            },
            'future_cleanup_gate': {},
            'safety': {'writes_database': False},
        }

    def _patch_evidence(self):
        return (
            patch(self.git_patch, return_value=self._git_ok()),
            patch(self.migration_patch, return_value=self._migrations_ok()),
            patch(self.release_patch, return_value=self._release_ok()),
            patch(self.alert_patch, return_value=self._alert_ok()),
            patch(self.operator_patch, return_value=self._operator_ok()),
            patch(self.nxt_patch, return_value=self._nxt_ok()),
            patch(self.cleanup_patch, return_value=self._cleanup_ok()),
        )

    def assertLegacyConsoleSafe(self, output):
        output.encode('ascii')

    def test_ops_post_uat_evidence_reports_release_packet_read_only(self):
        Customer.objects.create(code='REAL_KEEP', name='Real Keep')
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'post_uat')
            before_counts = {
                'customers': Customer.objects.count(),
                'products': Product.objects.count(),
                'sales_orders': SalesOrder.objects.count(),
                'production_orders': ProductionOrder.objects.count(),
                'inventory_transactions': InventoryTransaction.objects.count(),
            }
            patches = self._patch_evidence()
            with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
                output, payload = self._call_json('--backup-path', str(backup))

        self.assertEqual(payload['pack'], 'Ops Release Readiness Post-UAT Evidence v1')
        self.assertEqual(payload['command'], self.command)
        self.assertEqual(payload['mode'], 'read_only_ops_post_uat_evidence')
        self.assertEqual(payload['overall_status'], 'ok')
        self.assertEqual(payload['git']['branch'], 'feature/sales-snapshot-v2')
        self.assertEqual(payload['git']['head'], '85e4784')
        self.assertEqual(payload['migrations']['pending_count'], 0)
        self.assertEqual(payload['release_readiness']['status'], 'ok')
        self.assertEqual(payload['alert_channel_readiness']['status'], 'ok')
        self.assertTrue(payload['backup_evidence']['verified'])
        self.assertEqual(payload['backup_evidence']['manifest_status'], 'ok')
        self.assertEqual(payload['backup_evidence']['restore_dry_run_status'], 'ok')
        self.assertEqual(payload['data_status']['qa_uat2r']['total_rows'], 38)
        self.assertEqual(payload['data_status']['qa_uat2r']['cleanup_status'], 'deferred_future_vang')
        self.assertEqual(payload['data_status']['qa_uat9h']['candidate_total'], 0)
        self.assertTrue(all(status == 'pass' for status in payload['operator_evidence']['module_statuses'].values()))
        self.assertEqual(set(payload['nxt_real_data_audit']['source_results']), {
            'PURCHASE',
            'PRODUCTION',
            'STOCKTAKE',
            'TRANSFER',
            'MANUAL',
        })
        self.assertTrue(all(status == 'pass' for status in payload['nxt_real_data_audit']['source_results'].values()))
        self.assertEqual(payload['cleanup_decision']['recommended_decision'], 'defer_cleanup')
        self.assertTrue(all(item['status'] in {'pass', 'planned'} for item in payload['release_checklist']))
        self.assertFalse(payload['safety']['writes_database'])
        self.assertFalse(payload['safety']['backup_created'])
        self.assertFalse(payload['safety']['restore_runs'])
        self.assertFalse(payload['safety']['cleanup_runs'])
        self.assertFalse(payload['safety']['confirm_delete_runs'])
        self.assertFalse(payload['safety']['confirm_write_runs'])
        self.assertFalse(payload['safety']['migration_runs'])
        self.assertFalse(payload['safety']['deploy_runs'])
        self.assertFalse(payload['safety']['direct_sql_used'])
        self.assertFalse(payload['safety']['credentials_printed'])
        self.assertFalse(payload['safety']['qc_printing_in_scope'])
        self.assertEqual(
            before_counts,
            {
                'customers': Customer.objects.count(),
                'products': Product.objects.count(),
                'sales_orders': SalesOrder.objects.count(),
                'production_orders': ProductionOrder.objects.count(),
                'inventory_transactions': InventoryTransaction.objects.count(),
            },
        )
        self.assertTrue(Customer.objects.filter(code='REAL_KEEP').exists())
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())
        self.assertLegacyConsoleSafe(output)

    def test_ops_post_uat_evidence_markdown_is_copy_friendly(self):
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'post_uat')
            patches = self._patch_evidence()
            with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
                stdout = StringIO()
                call_command(self.command, '--backup-path', str(backup), stdout=stdout)
                output = stdout.getvalue()

        self.assertIn('# Ops Release Readiness Post-UAT Evidence v1', output)
        self.assertIn('## Repo and git', output)
        self.assertIn('## DB, readiness, alert', output)
        self.assertIn('## Backup evidence', output)
        self.assertIn('## Release checklist', output)
        self.assertIn('QA_UAT2R_', output)
        self.assertIn('QA_SHF1_', output)
        self.assertIn('QA_UAT9H_', output)
        self.assertIn('This command is read-only', output)
        self.assertIn('QC Printing', output)
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())
        self.assertLegacyConsoleSafe(output)

    def test_ops_post_uat_evidence_marks_warning_when_gates_are_not_ready(self):
        with TemporaryDirectory() as tmpdir:
            backup = _create_backup_bundle(Path(tmpdir), 'post_uat')
            git_state = {**self._git_ok(), 'clean': False, 'dirty_files': [' M backend/core/file.py']}
            migrations = {**self._migrations_ok(), 'status': 'warning', 'pending_count': 1, 'items': ['core.0001']}
            release = {**self._release_ok(), 'status': 'warning', 'summary': 'Release readiness: WARNING'}
            patches = (
                patch(self.git_patch, return_value=git_state),
                patch(self.migration_patch, return_value=migrations),
                patch(self.release_patch, return_value=release),
                patch(self.alert_patch, return_value=self._alert_ok()),
                patch(self.operator_patch, return_value=self._operator_ok()),
                patch(self.nxt_patch, return_value=self._nxt_ok()),
                patch(self.cleanup_patch, return_value=self._cleanup_ok()),
            )
            with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
                _, payload = self._call_json('--backup-path', str(backup))

        self.assertEqual(payload['overall_status'], 'warning')
        self.assertEqual(payload['release_readiness']['status'], 'warning')
        checklist = {item['key']: item['status'] for item in payload['release_checklist']}
        self.assertEqual(checklist['repo_clean_synced'], 'warning')
        self.assertEqual(checklist['no_pending_migrations'], 'warning')
        self.assertEqual(checklist['release_readiness'], 'warning')

    def test_ops_post_uat_evidence_builder_accepts_repo_root_for_git_evidence(self):
        payload = build_ops_post_uat_evidence_pack(repo_root=Path('Z:/missing/repo'), backup_path='Z:/missing/backup')

        self.assertEqual(payload['pack'], 'Ops Release Readiness Post-UAT Evidence v1')
        self.assertEqual(payload['mode'], 'read_only_ops_post_uat_evidence')
        self.assertEqual(payload['overall_status'], 'warning')
        self.assertFalse(payload['safety']['writes_database'])
        self.assertFalse(payload['safety']['backup_created'])
        self.assertFalse(payload['safety']['cleanup_runs'])
        self.assertFalse(payload['safety']['deploy_runs'])


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
