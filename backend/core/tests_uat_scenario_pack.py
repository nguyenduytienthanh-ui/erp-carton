import json
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, TestCase

from core.management.commands.erp_main_uat_scenarios import build_uat_scenario_pack
from core.models import Customer
from inventory.models import InventoryTransaction
from products.models import Product
from production.models import ProductionDemand, ProductionOrder
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
        self.assertIn('No delete path exists in this milestone.', output)
        self.assertNotIn('password', output.lower())
        self.assertNotIn('token', output.lower())
        self.assertNotIn('secret', output.lower())
