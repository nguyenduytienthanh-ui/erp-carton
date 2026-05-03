from datetime import timedelta
from decimal import Decimal
from io import StringIO

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import connection
from django.db.models import Q
from django.utils import timezone

from core.management.commands.bootstrap_uat_demo import (
    PERMISSIONS,
    ROLE_MATRIX,
    TEAM_MATRIX,
    USER_MATRIX,
)
from core.models import Customer, NumberSequence, Permission, Role, Setting, Team
from finance.models import GeneralLedgerAccount
from finance.posting import save_finance_gl_control_mappings
from inventory.models import (
    InventoryReservation,
    InventoryTransaction,
    OutboundShipment as InventoryOutboundShipment,
    OutboundShipmentPackage,
    Warehouse,
    WarehouseLocation,
)
from products.models import (
    Operation,
    Product,
    ProductBoxType,
    ProductCategory,
    ProductOperation,
    ProductRoutingStep,
    ProductUnit,
    ProductWave,
)
from production.demand_services import (
    PRODUCTION_DEMAND_SETTING_DEFAULTS,
    extract_product_snapshot_summary,
)
from production.models import (
    ProductionDemand,
    ProductionDemandPlanningStatus,
    ProductionDemandPriority,
    ProductionDemandProductionStatus,
)
from sales.models import (
    DeliveryCarrier,
    OutboundShipment as SalesOutboundShipment,
    SalesOrder,
    SalesOrderDeliveryPlan,
    SalesOrderLine,
    SalesOrderStatus,
)
from sales.services import build_sales_order_line_product_snapshot


QA_PREFIX = 'QA_'
QA_DEMAND_SOURCE = 'QA_SEED'
DEFAULT_DEV_PASSWORD = 'Demo123!'

OPERATION_SEEDS = [
    ('XA', 'Xa', 10),
    ('IN', 'In', 20),
    ('CAN_MANG', 'Can mang', 30),
    ('BOI', 'Boi', 40),
    ('BE', 'Be', 50),
    ('CHAP', 'Chap', 60),
    ('DONG', 'Dong', 70),
    ('DAN', 'Dan', 80),
    ('KHAC', 'Khac', 90),
]


class DevSeedSafetyError(ValueError):
    pass


def _quiet_call_command(name, *args, **options):
    options.setdefault('stdout', StringIO())
    return call_command(name, *args, **options)


def _count_increment(summary, key, created):
    bucket = f'{key}_created' if created else f'{key}_updated'
    summary[bucket] = summary.get(bucket, 0) + 1


def _database_is_safe_for_reset():
    config = connection.settings_dict
    engine = str(config.get('ENGINE') or '').lower()
    name = str(config.get('NAME') or '').lower()
    host = str(config.get('HOST') or '').lower()
    if 'sqlite' in engine:
        return name in {'', ':memory:'} or any(token in name for token in ('test', 'dev', 'clean', 'local'))
    safe_name = any(token in name for token in ('test', 'dev', 'clean', 'local'))
    safe_host = host in {'', 'localhost', '127.0.0.1', '::1'} or 'local' in host
    return safe_name and safe_host


def _seed_access_matrix(password=None, reset_passwords=False):
    user_model = get_user_model()
    summary = {}
    permission_map = {}
    for resource, action, code, name in PERMISSIONS:
        permission, created = Permission.objects.update_or_create(
            resource=resource,
            action=action,
            defaults={'code': code, 'name': name},
        )
        permission_map[f'{resource}:{action}'] = permission
        _count_increment(summary, 'permissions', created)

    role_map = {}
    for row in ROLE_MATRIX:
        role, created = Role.objects.update_or_create(
            code=row['code'],
            deleted_at__isnull=True,
            defaults={
                'name': row['name'],
                'sort_order': row['sort_order'],
                'is_active': True,
            },
        )
        role.permissions.set([permission_map[key] for key in row['permissions'] if key in permission_map])
        role_map[row['code']] = role
        _count_increment(summary, 'roles', created)

    team_map = {}
    for row in TEAM_MATRIX:
        team, created = Team.objects.update_or_create(
            code=row['code'],
            deleted_at__isnull=True,
            defaults={
                'name': row['name'],
                'sort_order': row['sort_order'],
                'is_active': True,
            },
        )
        team_map[row['code']] = team
        _count_increment(summary, 'teams', created)

    user_password = password if password is not None else DEFAULT_DEV_PASSWORD
    for row in USER_MATRIX:
        user, created = user_model.objects.get_or_create(
            username=row['username'],
            defaults={
                'email': row['email'],
                'first_name': row['first_name'],
                'last_name': row['last_name'],
                'is_active': True,
                'is_staff': False,
                'is_superuser': False,
            },
        )
        changed = created
        for attr in ('email', 'first_name', 'last_name'):
            if getattr(user, attr) != row[attr]:
                setattr(user, attr, row[attr])
                changed = True
        if created or reset_passwords:
            user.set_password(user_password)
            changed = True
        if not user.is_active:
            user.is_active = True
            changed = True
        if user.is_staff:
            user.is_staff = False
            changed = True
        if user.is_superuser:
            user.is_superuser = False
            changed = True
        if changed:
            user.save()
        user.roles.set([role_map[code] for code in row['roles'] if code in role_map])
        user.teams.set([team_map[code] for code in row['teams'] if code in team_map])
        _count_increment(summary, 'users', created)
    return summary


def _seed_product_master():
    _quiet_call_command('seed_master_data')
    summary = {}
    for code, name, sequence in OPERATION_SEEDS:
        _operation, created = Operation.objects.update_or_create(
            code=code,
            defaults={
                'name': name,
                'sequence': sequence,
                'default_unit': 'pcs/hour',
                'is_active': True,
            },
        )
        _count_increment(summary, 'operations', created)
    _sequence, created = NumberSequence.objects.update_or_create(
        entity_type='Product',
        defaults={
            'prefix': 'PRD',
            'current_number': 0,
            'padding': 5,
            'format_template': '{prefix}-{number}',
            'is_active': True,
        },
    )
    _count_increment(summary, 'number_sequences', created)
    return summary


def _seed_production_demand_settings():
    summary = {}
    for key, value in PRODUCTION_DEMAND_SETTING_DEFAULTS.items():
        _setting, created = Setting.objects.update_or_create(
            key=key,
            defaults={
                'value': str(value),
                'data_type': 'integer',
                'description': 'Default dev setting for production demand planning.',
                'is_active': True,
            },
        )
        _count_increment(summary, 'settings', created)
    return summary


def _seed_inventory_master():
    warehouse, wh_created = Warehouse.objects.update_or_create(
        code='WH-MAIN',
        deleted_at__isnull=True,
        defaults={
            'name': 'Main Warehouse',
            'address': 'Dev main warehouse',
            'is_active': True,
            'sort_order': 10,
        },
    )
    _location, loc_created = WarehouseLocation.objects.update_or_create(
        warehouse=warehouse,
        code='MAIN',
        deleted_at__isnull=True,
        defaults={
            'name': 'Main Location',
            'location_type': 'STORAGE',
            'is_active': True,
            'sort_order': 10,
        },
    )
    return {
        'warehouses_created': int(wh_created),
        'warehouses_updated': int(not wh_created),
        'warehouse_locations_created': int(loc_created),
        'warehouse_locations_updated': int(not loc_created),
    }


def _seed_finance_master():
    accounts = {}
    rows = [
        ('DEV-AR', 'Dev Accounts Receivable', 'ASSET'),
        ('DEV-AP', 'Dev Accounts Payable', 'LIABILITY'),
        ('DEV-ADV', 'Dev Advances', 'ASSET'),
        ('DEV-BANK-ADJ', 'Dev Bank Adjustments', 'EXPENSE'),
        ('DEV-PAYROLL', 'Dev Payroll Clearing', 'LIABILITY'),
        ('DEV-SALES', 'Dev Sales Revenue', 'REVENUE'),
        ('DEV-PURCHASE', 'Dev Purchase Clearing', 'LIABILITY'),
        ('DEV-ADV-EXP', 'Dev Advance Settlement Expense', 'EXPENSE'),
        ('DEV-INV', 'Dev Inventory Asset', 'ASSET'),
        ('DEV-COGS', 'Dev Cost of Goods Sold', 'EXPENSE'),
        ('DEV-WIP', 'Dev Production WIP', 'ASSET'),
        ('DEV-INV-ADJ', 'Dev Inventory Adjustment', 'EXPENSE'),
        ('DEV-VAT-IN', 'Dev VAT Input', 'ASSET'),
        ('DEV-VAT-OUT', 'Dev VAT Output', 'LIABILITY'),
    ]
    summary = {}
    for code, name, account_type in rows:
        account, created = GeneralLedgerAccount.objects.update_or_create(
            code=code,
            defaults={
                'name': name,
                'account_type': account_type,
                'is_active': True,
            },
        )
        accounts[code] = account
        _count_increment(summary, 'gl_accounts', created)
    save_finance_gl_control_mappings({
        'ar_control_gl_account_id': accounts['DEV-AR'].id,
        'ap_control_gl_account_id': accounts['DEV-AP'].id,
        'advance_control_gl_account_id': accounts['DEV-ADV'].id,
        'bank_reconciliation_adjustment_gl_account_id': accounts['DEV-BANK-ADJ'].id,
        'payroll_clearing_gl_account_id': accounts['DEV-PAYROLL'].id,
        'default_sales_revenue_gl_account_id': accounts['DEV-SALES'].id,
        'default_purchase_clearing_gl_account_id': accounts['DEV-PURCHASE'].id,
        'default_advance_settlement_expense_gl_account_id': accounts['DEV-ADV-EXP'].id,
        'inventory_asset_gl_account_id': accounts['DEV-INV'].id,
        'cogs_gl_account_id': accounts['DEV-COGS'].id,
        'production_wip_gl_account_id': accounts['DEV-WIP'].id,
        'inventory_adjustment_gl_account_id': accounts['DEV-INV-ADJ'].id,
        'vat_input_gl_account_id': accounts['DEV-VAT-IN'].id,
        'vat_output_gl_account_id': accounts['DEV-VAT-OUT'].id,
    })
    summary['finance_control_mappings_updated'] = 1
    return summary


def seed_dev_master_data(password=None, reset_passwords=False):
    summary = {}
    for payload in (
        _seed_access_matrix(password=password, reset_passwords=reset_passwords),
        _seed_product_master(),
        _seed_production_demand_settings(),
        _seed_inventory_master(),
        _seed_finance_master(),
    ):
        for key, value in payload.items():
            summary[key] = summary.get(key, 0) + value
    _quiet_call_command('seed_sales_order_workflow')
    summary['sales_order_workflow_seeded'] = 1
    return summary


def _admin_user():
    user_model = get_user_model()
    return (
        user_model.objects.filter(username='uat_admin').first()
        or user_model.objects.filter(is_superuser=True).first()
        or user_model.objects.filter(is_staff=True).first()
    )


def _product_master_objects():
    return {
        'category': ProductCategory.objects.filter(code='THUNG', deleted_at__isnull=True).first(),
        'unit': ProductUnit.objects.filter(code='CAI', deleted_at__isnull=True).first(),
        'wave': ProductWave.objects.filter(code='BC').first(),
        'box_type': ProductBoxType.objects.filter(code='A1').first(),
    }


def _upsert_customer(code, name, user):
    return Customer.objects.update_or_create(
        code=code,
        defaults={
            'name': name,
            'company_name': name,
            'phone': '0900000000',
            'email': f'{code.lower()}@example.com',
            'address': 'QA address',
            'contact_person': 'QA Contact',
            'payment_terms': 30,
            'credit_limit': Decimal('100000000'),
            'is_active': True,
            'status': 'APPROVED',
            'created_by': user,
            'updated_by': user,
        },
    )[0]


def _upsert_product(code, defaults):
    product, _created = Product.objects.update_or_create(code=code, defaults=defaults)
    return product


def _replace_product_operations(product, rates):
    ProductRoutingStep.objects.filter(product=product).delete()
    operation_codes = list(rates.keys())
    ProductOperation.objects.filter(product=product).exclude(operation__code__in=operation_codes).delete()
    product_operations = {}
    for index, (operation_code, rate) in enumerate(rates.items(), 1):
        operation = Operation.objects.get(code=operation_code)
        product_operation, _created = ProductOperation.objects.update_or_create(
            product=product,
            operation=operation,
            defaults={
                'sequence': operation.sequence or index * 10,
                'standard_rate_per_hour': rate,
                'note': f'QA rate for {operation_code}',
                'is_active': True,
            },
        )
        product_operations[operation_code] = product_operation
    return product_operations


def _replace_product_routing(product, rows, product_operations):
    ProductRoutingStep.objects.filter(product=product).delete()
    for row in rows:
        operation = Operation.objects.get(code=row['operation_code'])
        product_operation = product_operations.get(row['operation_code'])
        ProductRoutingStep.objects.create(
            product=product,
            step_no=row['step_no'],
            display_order=row['display_order'],
            operation=operation,
            product_operation=product_operation,
            standard_rate_per_hour=row['rate'],
            note=row.get('note', ''),
            step_type=row.get('step_type', ProductRoutingStep.StepType.REQUIRED),
            group_code=row.get('group_code', ''),
            is_required=row.get('is_required', True),
            allow_parallel=row.get('allow_parallel', False),
        )


def _seed_qa_products(user):
    master = _product_master_objects()
    common_defaults = {
        'category': master['category'],
        'unit': master['unit'],
        'wave': master['wave'],
        'box_type': master['box_type'],
        'status': 'ACTIVE',
        'is_active': True,
        'created_by': user,
        'updated_by': user,
        'owner': user,
    }
    specific = _upsert_product('QA_PRODUCT_SPECIFIC_BOX', {
        **common_defaults,
        'name': 'QA Specific Box',
        'product_kind': Product.ProductKind.SPECIFIC,
        'requires_order_spec': False,
        'requires_order_operations_review': False,
        'size_order': '300x200x150',
        'size_production': '305x205x155',
        'sale_price': Decimal('12000'),
        'cost_price': Decimal('8000'),
        'print_color_1': 'Black',
        'print_color_2': 'Blue',
        'print_color_3': '',
        'print_color_4': '',
        'print_color_5': '',
        'process_xa': 12000,
        'process_in': 18000,
        'process_be': 9000,
    })
    specific_ops = _replace_product_operations(specific, {'XA': 12000, 'IN': 18000, 'BE': 9000})
    _replace_product_routing(specific, [
        {'operation_code': 'XA', 'step_no': 10, 'display_order': 10, 'rate': 12000},
        {'operation_code': 'IN', 'step_no': 20, 'display_order': 20, 'rate': 18000},
        {'operation_code': 'BE', 'step_no': 30, 'display_order': 30, 'rate': 9000},
    ], specific_ops)

    generic = _upsert_product('QA_PRODUCT_GENERIC_CARTON', {
        **common_defaults,
        'name': 'QA Generic Carton',
        'product_kind': Product.ProductKind.GENERIC,
        'requires_order_spec': True,
        'requires_order_operations_review': True,
        'size_order': 'Customer spec',
        'size_production': 'Production spec',
        'sale_price': Decimal('15000'),
        'cost_price': Decimal('9500'),
        'print_color_1': 'Black',
        'print_color_2': 'Pantone 185C',
        'print_color_3': 'Blue',
        'print_color_4': 'Yellow',
        'print_color_5': 'Green',
        'process_in': 20000,
        'process_be': 8500,
    })
    generic_ops = _replace_product_operations(generic, {'IN': 20000, 'BE': 8500})
    _replace_product_routing(generic, [
        {'operation_code': 'IN', 'step_no': 10, 'display_order': 10, 'rate': 20000},
        {'operation_code': 'XA', 'step_no': 20, 'display_order': 20, 'rate': 12000},
        {'operation_code': 'XA', 'step_no': 30, 'display_order': 30, 'rate': 12000, 'note': 'Repeat QA step'},
        {'operation_code': 'DONG', 'step_no': 40, 'display_order': 40, 'rate': 15000, 'group_code': 'PACK'},
        {'operation_code': 'DAN', 'step_no': 40, 'display_order': 41, 'rate': 9000, 'group_code': 'PACK'},
    ], generic_ops)

    legacy = _upsert_product('QA_PRODUCT_LEGACY_PROCESS', {
        **common_defaults,
        'name': 'QA Legacy Process Product',
        'product_kind': Product.ProductKind.SPECIFIC,
        'requires_order_spec': False,
        'requires_order_operations_review': False,
        'size_order': 'Legacy order size',
        'size_production': 'Legacy production size',
        'sale_price': Decimal('10000'),
        'cost_price': Decimal('7000'),
        'color_count': 2,
        'process_in': 20000,
        'process_be': 8500,
    })
    return {
        'specific': specific,
        'generic': generic,
        'legacy': legacy,
    }


def _upsert_carrier(user):
    return DeliveryCarrier.objects.update_or_create(
        code='QA_CARRIER_INTERNAL',
        deleted_at__isnull=True,
        defaults={
            'name': 'QA Internal Carrier',
            'is_internal': True,
            'is_active': True,
            'sort_order': 10,
            'created_by': user,
            'updated_by': user,
        },
    )[0]


def _snapshot_for_product(product):
    return build_sales_order_line_product_snapshot(product, as_of_datetime=timezone.localdate())


def _upsert_order(code, customer, status, delivery_date, user):
    return SalesOrder.objects.update_or_create(
        code=code,
        defaults={
            'doc_type': 'SO',
            'order_date': timezone.localdate(),
            'delivery_date': delivery_date,
            'status': status,
            'customer': customer,
            'currency': 'VND',
            'exchange_rate': Decimal('1'),
            'notes': f'{code} controlled QA order',
            'created_by': user,
            'updated_by': user,
            'owner': user,
        },
    )[0]


def _upsert_line(order, line_number, product, qty, unit_price, product_snapshot=None):
    snapshot = product_snapshot if product_snapshot is not None else _snapshot_for_product(product)
    return SalesOrderLine.objects.update_or_create(
        sales_order=order,
        line_number=line_number,
        defaults={
            'product': product,
            'internal_product_code': product.code,
            'product_snapshot': snapshot,
            'uom': getattr(getattr(product, 'unit', None), 'code', ''),
            'qty': Decimal(str(qty)),
            'unit_price': Decimal(str(unit_price)),
            'note': f'{order.code} line {line_number}',
        },
    )[0]


def _replace_delivery_plans(line, rows, carrier):
    SalesOrderDeliveryPlan.objects.filter(line=line).delete()
    plans = []
    for row in rows:
        plans.append(SalesOrderDeliveryPlan.objects.create(
            line=line,
            delivery_date=row['delivery_date'],
            qty=Decimal(str(row['qty'])),
            shipped_qty=Decimal('0'),
            delivered_qty=Decimal('0'),
            planned_carrier=carrier,
            planned_carrier_name=carrier.name,
            note=row.get('note', ''),
        ))
    return plans


def _legacy_snapshot(product):
    return {
        'code': product.code,
        'name': product.name,
        'unit_name': getattr(getattr(product, 'unit', None), 'name', ''),
        'size_order': 'Legacy order size',
        'size_production': 'Legacy production size',
        'color_count': 2,
        'process_in': 20000,
        'process_be': 8500,
        'note': 'QA legacy v1 snapshot',
    }


def _seed_qa_sales(customers, products, carrier, user):
    today = timezone.localdate()
    order_v2 = _upsert_order(
        'QA_SO_SNAPSHOT_V2',
        customers['a'],
        SalesOrderStatus.APPROVED,
        today + timedelta(days=21),
        user,
    )
    line_v2 = _upsert_line(order_v2, 1, products['generic'], 150, products['generic'].sale_price)
    _replace_delivery_plans(line_v2, [
        {'delivery_date': today + timedelta(days=14), 'qty': 100, 'note': 'QA first shipment'},
        {'delivery_date': today + timedelta(days=21), 'qty': 50, 'note': 'QA second shipment'},
    ], carrier)
    order_v2.recalc_totals()

    order_legacy = _upsert_order(
        'QA_SO_SNAPSHOT_V1_LEGACY',
        customers['b'],
        SalesOrderStatus.DRAFT,
        today + timedelta(days=12),
        user,
    )
    line_legacy = _upsert_line(
        order_legacy,
        1,
        products['legacy'],
        40,
        products['legacy'].sale_price,
        product_snapshot=_legacy_snapshot(products['legacy']),
    )
    _replace_delivery_plans(line_legacy, [
        {'delivery_date': today + timedelta(days=12), 'qty': 40, 'note': 'QA legacy delivery'},
    ], carrier)
    order_legacy.recalc_totals()

    order_approve = _upsert_order(
        'QA_SO_APPROVE_DEMAND',
        customers['a'],
        SalesOrderStatus.SUBMITTED,
        today + timedelta(days=18),
        user,
    )
    line_approve = _upsert_line(order_approve, 1, products['specific'], 30, products['specific'].sale_price)
    _replace_delivery_plans(line_approve, [
        {'delivery_date': today + timedelta(days=18), 'qty': 30, 'note': 'QA approve demand delivery'},
    ], carrier)
    order_approve.recalc_totals()

    return {
        'order_v2': order_v2,
        'line_v2': line_v2,
        'order_legacy': order_legacy,
        'line_legacy': line_legacy,
        'order_approve': order_approve,
        'line_approve': line_approve,
    }


def _summary_payload_from_line(line):
    summary = extract_product_snapshot_summary(line)
    return {
        'customer_id_snapshot': summary['customer_id_snapshot'],
        'customer_name_snapshot': summary['customer_name_snapshot'],
        'product_code': summary['product_code'],
        'product_name': summary['product_name'],
        'product_kind': summary['product_kind'],
        'unit_name': summary['unit_name'],
        'size_order': summary['size_order'],
        'size_production': summary['size_production'],
        'print_colors': summary['print_colors'],
        'operations_summary': summary['operations_summary'],
        'routing_summary': summary['routing_summary'],
    }


def _upsert_qa_demand(name, line, **overrides):
    today = timezone.localdate()
    base = _summary_payload_from_line(line)
    payload = {
        **base,
        'demand_code': f'QA_DEMAND_{name}',
        'sales_order': line.sales_order,
        'sales_order_line': line,
        'delivery_plan': None,
        'product': line.product,
        'qty_required': Decimal('100'),
        'qty_planned': Decimal('0'),
        'qty_released': Decimal('0'),
        'qty_completed': Decimal('0'),
        'order_date': line.sales_order.order_date,
        'delivery_date': today + timedelta(days=14),
        'production_due_date': today + timedelta(days=12),
        'planning_due_date': today + timedelta(days=7),
        'reminder_date': today + timedelta(days=6),
        'planning_status': ProductionDemandPlanningStatus.NOT_DUE,
        'production_status': ProductionDemandProductionStatus.NOT_RELEASED,
        'priority': ProductionDemandPriority.NORMAL,
        'notes': f'QA seeded demand {name}',
        'reminder_note': '',
        'hold_reason': '',
        'source': QA_DEMAND_SOURCE,
        'created_by': _admin_user(),
        'updated_by': _admin_user(),
    }
    payload.update(overrides)
    demand, _created = ProductionDemand.objects.update_or_create(
        demand_key=f'QA:DEMAND:{name}',
        defaults=payload,
    )
    return demand


def _seed_qa_demands(line):
    today = timezone.localdate()
    scenarios = [
        ('OVERDUE', {
            'planning_due_date': today - timedelta(days=1),
            'delivery_date': today + timedelta(days=3),
            'production_due_date': today + timedelta(days=1),
            'reminder_date': today - timedelta(days=2),
            'planning_status': ProductionDemandPlanningStatus.OVERDUE,
            'priority': ProductionDemandPriority.HIGH,
        }),
        ('DUE_TODAY', {
            'planning_due_date': today,
            'delivery_date': today + timedelta(days=5),
            'production_due_date': today + timedelta(days=3),
            'reminder_date': today - timedelta(days=1),
            'planning_status': ProductionDemandPlanningStatus.DUE,
        }),
        ('UPCOMING_7', {
            'planning_due_date': today + timedelta(days=4),
            'delivery_date': today + timedelta(days=11),
            'production_due_date': today + timedelta(days=9),
            'reminder_date': today + timedelta(days=3),
            'planning_status': ProductionDemandPlanningStatus.UPCOMING,
        }),
        ('NO_DATE', {
            'planning_due_date': None,
            'delivery_date': None,
            'production_due_date': None,
            'reminder_date': None,
            'planning_status': ProductionDemandPlanningStatus.NOT_DUE,
        }),
        ('HELD', {
            'planning_due_date': today - timedelta(days=2),
            'delivery_date': today + timedelta(days=2),
            'production_due_date': today,
            'reminder_date': today - timedelta(days=3),
            'planning_status': ProductionDemandPlanningStatus.OVERDUE,
            'hold_reason': 'QA hold reason for planner review',
            'priority': ProductionDemandPriority.URGENT,
        }),
        ('PARTIALLY_PLANNED', {
            'qty_planned': Decimal('40'),
            'planning_status': ProductionDemandPlanningStatus.PARTIALLY_PLANNED,
        }),
        ('FULLY_PLANNED', {
            'qty_planned': Decimal('100'),
            'planning_status': ProductionDemandPlanningStatus.FULLY_PLANNED,
        }),
        ('IN_PROGRESS', {
            'qty_planned': Decimal('100'),
            'qty_released': Decimal('60'),
            'planning_status': ProductionDemandPlanningStatus.FULLY_PLANNED,
            'production_status': ProductionDemandProductionStatus.IN_PROGRESS,
        }),
        ('COMPLETED', {
            'qty_planned': Decimal('100'),
            'qty_released': Decimal('100'),
            'qty_completed': Decimal('100'),
            'planning_status': ProductionDemandPlanningStatus.FULLY_PLANNED,
            'production_status': ProductionDemandProductionStatus.COMPLETED,
        }),
        ('CANCELLED', {
            'planning_status': ProductionDemandPlanningStatus.CANCELLED,
            'production_status': ProductionDemandProductionStatus.CANCELLED,
            'notes': 'QA cancelled demand',
        }),
    ]
    return [_upsert_qa_demand(name, line, **payload) for name, payload in scenarios]


def seed_dev_qa_data(password=None, reset_passwords=False):
    seed_dev_master_data(password=password, reset_passwords=reset_passwords)
    user = _admin_user()
    customers = {
        'a': _upsert_customer('QA_CUSTOMER_A', 'QA Customer A', user),
        'b': _upsert_customer('QA_CUSTOMER_B', 'QA Customer B', user),
    }
    carrier = _upsert_carrier(user)
    products = _seed_qa_products(user)
    sales_payload = _seed_qa_sales(customers, products, carrier, user)
    demands = _seed_qa_demands(sales_payload['line_v2'])
    return {
        'customers': len(customers),
        'products': len(products),
        'sales_orders': 3,
        'production_demands': len(demands),
    }


def _delete_or_count(queryset, label, summary, dry_run):
    count = queryset.count()
    summary[label] = count
    if not dry_run and count:
        queryset.delete()
    return count


def reset_dev_qa_data(confirm=False, dry_run=False):
    if not confirm:
        raise DevSeedSafetyError('reset_dev_qa_data requires --confirm.')
    if not _database_is_safe_for_reset():
        raise DevSeedSafetyError('Refusing to reset QA data because the database does not look local/dev/test/clean.')

    summary = {'dry_run': bool(dry_run)}
    qa_order_codes = SalesOrder.objects.filter(code__startswith=QA_PREFIX).values_list('code', flat=True)

    _delete_or_count(
        ProductionDemand.objects.filter(
            Q(source=QA_DEMAND_SOURCE)
            | Q(demand_key__startswith='QA')
            | Q(demand_code__startswith=QA_PREFIX)
            | Q(sales_order__code__startswith=QA_PREFIX)
            | Q(product_code__startswith=QA_PREFIX)
        ),
        'production_demands',
        summary,
        dry_run,
    )
    _delete_or_count(
        OutboundShipmentPackage.objects.filter(package_code__startswith=QA_PREFIX),
        'inventory_shipment_packages',
        summary,
        dry_run,
    )
    _delete_or_count(
        InventoryOutboundShipment.objects.filter(code__startswith=QA_PREFIX),
        'inventory_shipments',
        summary,
        dry_run,
    )
    _delete_or_count(
        InventoryReservation.objects.filter(code__startswith=QA_PREFIX),
        'inventory_reservations',
        summary,
        dry_run,
    )
    _delete_or_count(
        InventoryTransaction.objects.filter(code__startswith=QA_PREFIX),
        'inventory_transactions',
        summary,
        dry_run,
    )
    _delete_or_count(
        SalesOutboundShipment.objects.filter(code__startswith=QA_PREFIX),
        'sales_shipments',
        summary,
        dry_run,
    )
    _delete_or_count(
        SalesOrderDeliveryPlan.objects.filter(line__sales_order__code__in=qa_order_codes),
        'sales_order_delivery_plans',
        summary,
        dry_run,
    )
    _delete_or_count(
        SalesOrderLine.objects.filter(sales_order__code__startswith=QA_PREFIX),
        'sales_order_lines',
        summary,
        dry_run,
    )
    _delete_or_count(
        SalesOrder.objects.filter(code__startswith=QA_PREFIX),
        'sales_orders',
        summary,
        dry_run,
    )
    _delete_or_count(
        ProductRoutingStep.objects.filter(product__code__startswith=QA_PREFIX),
        'product_routing_steps',
        summary,
        dry_run,
    )
    _delete_or_count(
        ProductOperation.objects.filter(product__code__startswith=QA_PREFIX),
        'product_operations',
        summary,
        dry_run,
    )
    _delete_or_count(
        Product.objects.filter(code__startswith=QA_PREFIX),
        'products',
        summary,
        dry_run,
    )
    _delete_or_count(
        Customer.objects.filter(code__startswith=QA_PREFIX),
        'customers',
        summary,
        dry_run,
    )
    _delete_or_count(
        DeliveryCarrier.objects.filter(code__startswith=QA_PREFIX),
        'delivery_carriers',
        summary,
        dry_run,
    )
    return summary
