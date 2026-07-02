from decimal import Decimal
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.utils import timezone

from core.models import Permission, Role, Team
from core.permissions import (
    CUSTOMER_PERMISSION_DEFINITIONS,
    INVENTORY_PERMISSION_DEFINITIONS,
    PURCHASING_PERMISSION_DEFINITIONS,
    SUPPLIER_PERMISSION_DEFINITIONS,
)


PERMISSIONS = [
    ('WORKFORCE', 'MANAGE', 'WORKFORCE_MANAGE', 'Manage Workforce module'),
    ('FINANCE', 'MANAGE', 'FINANCE_MANAGE', 'Manage Finance module'),
    *[
        (row['resource'], row['action'], row['code'], row['name'])
        for row in INVENTORY_PERMISSION_DEFINITIONS
    ],
    ('OPS', 'VIEW', 'OPS_VIEW', 'View operations cockpit'),
    ('WORKFLOW', 'VIEW', 'WORKFLOW_VIEW', 'View workflow boards'),
    ('WORKFLOW', 'MANAGE', 'WORKFLOW_MANAGE', 'Manage workflow templates'),
    ('CORE', 'VIEW_REPORTS', 'CORE_VIEW_REPORTS', 'View reports center'),
    ('CORE', 'VIEW_OPERATIONS_LOG', 'CORE_VIEW_OPERATIONS_LOG', 'View operations log'),
    ('CORE', 'VIEW_RBAC_AUDIT', 'CORE_VIEW_RBAC_AUDIT', 'View RBAC audit history'),
    ('CORE', 'MANAGE_RBAC', 'CORE_MANAGE_RBAC', 'Manage RBAC settings'),
    ('PRODUCTCATEGORY', 'EDIT', 'PRODUCTCATEGORY_EDIT', 'Edit product categories'),
    ('PRODUCTUNIT', 'EDIT', 'PRODUCTUNIT_EDIT', 'Edit product units'),
    ('PRODUCT', 'EDIT', 'PRODUCT_EDIT', 'Edit products'),
    ('PRODUCT', 'IMPORT', 'PRODUCT_IMPORT', 'Import products'),
    *[
        (row['resource'], row['action'], row['code'], row['name'])
        for row in PURCHASING_PERMISSION_DEFINITIONS
    ],
    ('PURCHASING', 'MANAGE', 'PURCHASING_MANAGE', 'Manage purchasing module'),
    ('PURCHASEORDER', 'SUBMIT', 'PURCHASEORDER_SUBMIT', 'Submit purchase orders'),
    ('PURCHASEORDER', 'APPROVE', 'PURCHASEORDER_APPROVE', 'Approve purchase orders'),
    ('PURCHASEORDER', 'REJECT', 'PURCHASEORDER_REJECT', 'Reject purchase orders'),
    ('PURCHASEORDER', 'RECEIVE', 'PURCHASEORDER_RECEIVE', 'Receive purchase orders'),
    ('PURCHASEORDER', 'CANCEL', 'PURCHASEORDER_CANCEL', 'Cancel purchase orders'),
    ('PRODUCTION', 'MANAGE', 'PRODUCTION_MANAGE', 'Manage production module'),
    ('PRODUCTIONORDER', 'SUBMIT', 'PRODUCTIONORDER_SUBMIT', 'Submit production orders'),
    ('PRODUCTIONORDER', 'APPROVE', 'PRODUCTIONORDER_APPROVE', 'Approve production orders'),
    ('PRODUCTIONORDER', 'REJECT', 'PRODUCTIONORDER_REJECT', 'Reject production orders'),
    ('PRODUCTIONORDER', 'RELEASE', 'PRODUCTIONORDER_RELEASE', 'Release production orders'),
    ('PRODUCTIONORDER', 'ISSUE', 'PRODUCTIONORDER_ISSUE', 'Issue materials for production orders'),
    ('PRODUCTIONORDER', 'RECEIVE', 'PRODUCTIONORDER_RECEIVE', 'Receive production output'),
    ('PRODUCTIONORDER', 'CANCEL', 'PRODUCTIONORDER_CANCEL', 'Cancel production orders'),
    ('SALESORDER', 'SUBMIT', 'SALESORDER_SUBMIT', 'Submit sales orders'),
    ('SALESORDER', 'APPROVE', 'SALESORDER_APPROVE', 'Approve sales orders'),
    ('SALESORDER', 'REJECT', 'SALESORDER_REJECT', 'Reject sales orders'),
    ('SALESORDER', 'POST', 'SALESORDER_POST', 'Post sales orders'),
    ('SALESORDER', 'VOID', 'SALESORDER_VOID', 'Void sales orders'),
    *[
        (row['resource'], row['action'], row['code'], row['name'])
        for row in CUSTOMER_PERMISSION_DEFINITIONS
    ],
    *[
        (row['resource'], row['action'], row['code'], row['name'])
        for row in SUPPLIER_PERMISSION_DEFINITIONS
    ],
]

ROLE_MATRIX = [
    {
        'code': 'ADMIN',
        'name': 'Admin',
        'sort_order': 10,
        'permissions': [f'{resource}:{action}' for resource, action, _code, _name in PERMISSIONS],
    },
    {
        'code': 'MANAGER',
        'name': 'Manager',
        'sort_order': 20,
        'permissions': [
            'WORKFORCE:MANAGE', 'FINANCE:MANAGE',
            'INVENTORY:VIEW', 'INVENTORY:MANAGE', 'INVENTORY:ADJUST', 'INVENTORY:STOCKTAKE', 'INVENTORY:TRANSFER', 'INVENTORY:RESERVE',
            'PURCHASING:VIEW', 'PURCHASING:MANAGE', 'PURCHASEORDER:SUBMIT', 'PURCHASEORDER:APPROVE', 'PURCHASEORDER:REJECT', 'PURCHASEORDER:RECEIVE', 'PURCHASEORDER:CANCEL',
            'PRODUCTION:MANAGE', 'PRODUCTIONORDER:SUBMIT', 'PRODUCTIONORDER:APPROVE', 'PRODUCTIONORDER:REJECT', 'PRODUCTIONORDER:RELEASE', 'PRODUCTIONORDER:ISSUE', 'PRODUCTIONORDER:RECEIVE', 'PRODUCTIONORDER:CANCEL',
            'OPS:VIEW', 'WORKFLOW:VIEW', 'WORKFLOW:MANAGE', 'CORE:VIEW_REPORTS',
            'CORE:VIEW_OPERATIONS_LOG', 'CORE:VIEW_RBAC_AUDIT',
            'PRODUCTCATEGORY:EDIT', 'PRODUCTUNIT:EDIT', 'PRODUCT:EDIT', 'PRODUCT:IMPORT',
            'SUPPLIER:VIEW', 'SUPPLIER:CREATE', 'SUPPLIER:EDIT', 'SUPPLIER:IMPORT', 'SUPPLIER:EXPORT',
            'SALESORDER:SUBMIT', 'SALESORDER:APPROVE', 'SALESORDER:REJECT', 'SALESORDER:POST', 'SALESORDER:VOID',
            'CUSTOMER:VIEW', 'CUSTOMER:CREATE', 'CUSTOMER:EDIT', 'CUSTOMER:SUBMIT',
            'CUSTOMER:APPROVE', 'CUSTOMER:REJECT', 'CUSTOMER:IMPORT', 'CUSTOMER:EXPORT', 'CUSTOMER:ASSIGN',
        ],
    },
    {
        'code': 'FINANCE_MANAGER',
        'name': 'Finance Manager',
        'sort_order': 30,
        'permissions': [
            'FINANCE:MANAGE', 'CORE:VIEW_OPERATIONS_LOG',
            'PURCHASING:VIEW', 'PURCHASING:MANAGE', 'PURCHASEORDER:APPROVE', 'PURCHASEORDER:REJECT', 'PURCHASEORDER:CANCEL',
            'PRODUCTION:MANAGE', 'PRODUCTIONORDER:APPROVE', 'PRODUCTIONORDER:REJECT', 'PRODUCTIONORDER:CANCEL',
            'CORE:VIEW_REPORTS',
            'SUPPLIER:VIEW', 'SUPPLIER:CREATE', 'SUPPLIER:EDIT', 'SUPPLIER:EXPORT',
            'SALESORDER:POST', 'SALESORDER:VOID',
        ],
    },
    {
        'code': 'ACCOUNTANT',
        'name': 'Accountant',
        'sort_order': 40,
        'permissions': ['FINANCE:MANAGE', 'CORE:VIEW_REPORTS', 'SALESORDER:POST'],
    },
    {
        'code': 'HR_MANAGER',
        'name': 'HR Manager',
        'sort_order': 50,
        'permissions': ['WORKFORCE:MANAGE'],
    },
    {
        'code': 'PAYROLL',
        'name': 'Payroll Operator',
        'sort_order': 60,
        'permissions': ['WORKFORCE:MANAGE'],
    },
    {
        'code': 'OPS_MANAGER',
        'name': 'Operations Manager',
        'sort_order': 70,
        'permissions': [
            'OPS:VIEW', 'WORKFLOW:VIEW', 'WORKFLOW:MANAGE', 'CORE:VIEW_OPERATIONS_LOG', 'CORE:VIEW_REPORTS',
            'INVENTORY:VIEW', 'INVENTORY:MANAGE', 'INVENTORY:ADJUST', 'INVENTORY:STOCKTAKE', 'INVENTORY:TRANSFER', 'INVENTORY:RESERVE',
            'PURCHASING:VIEW', 'PURCHASING:MANAGE', 'PURCHASEORDER:SUBMIT', 'PURCHASEORDER:RECEIVE',
            'SUPPLIER:VIEW', 'SUPPLIER:CREATE', 'SUPPLIER:EDIT',
            'PRODUCTION:MANAGE', 'PRODUCTIONORDER:SUBMIT', 'PRODUCTIONORDER:RELEASE', 'PRODUCTIONORDER:ISSUE', 'PRODUCTIONORDER:RECEIVE',
        ],
    },
    {
        'code': 'AUDITOR',
        'name': 'Auditor',
        'sort_order': 80,
        'permissions': ['CORE:VIEW_OPERATIONS_LOG', 'CORE:VIEW_RBAC_AUDIT'],
    },
    {
        'code': 'SALES',
        'name': 'Sales Executive',
        'sort_order': 90,
        'permissions': ['SALESORDER:SUBMIT', 'CUSTOMER:VIEW', 'CUSTOMER:CREATE', 'CUSTOMER:EDIT', 'CUSTOMER:SUBMIT'],
    },
    {
        'code': 'SALES_MANAGER',
        'name': 'Sales Manager',
        'sort_order': 100,
        'permissions': [
            'SALESORDER:SUBMIT', 'SALESORDER:APPROVE', 'SALESORDER:REJECT', 'SALESORDER:VOID',
            'INVENTORY:VIEW', 'INVENTORY:RESERVE', 'CORE:VIEW_REPORTS',
            'CUSTOMER:VIEW', 'CUSTOMER:CREATE', 'CUSTOMER:EDIT', 'CUSTOMER:SUBMIT',
            'CUSTOMER:APPROVE', 'CUSTOMER:REJECT', 'CUSTOMER:EXPORT', 'CUSTOMER:ASSIGN',
        ],
    },
    {
        'code': 'PRODUCT_MANAGER',
        'name': 'Product Manager',
        'sort_order': 110,
        'permissions': [
            'PRODUCTCATEGORY:EDIT', 'PRODUCTUNIT:EDIT', 'PRODUCT:EDIT', 'PRODUCT:IMPORT',
            'INVENTORY:VIEW', 'INVENTORY:MANAGE', 'INVENTORY:ADJUST', 'INVENTORY:STOCKTAKE', 'INVENTORY:TRANSFER', 'INVENTORY:RESERVE',
            'PURCHASING:VIEW', 'PURCHASING:MANAGE', 'PURCHASEORDER:SUBMIT', 'PURCHASEORDER:RECEIVE',
            'SUPPLIER:VIEW', 'SUPPLIER:CREATE', 'SUPPLIER:EDIT',
            'PRODUCTION:MANAGE', 'PRODUCTIONORDER:SUBMIT', 'PRODUCTIONORDER:RELEASE', 'PRODUCTIONORDER:ISSUE', 'PRODUCTIONORDER:RECEIVE', 'CORE:VIEW_REPORTS',
        ],
    },
]

TEAM_MATRIX = [
    {'code': 'BACKOFFICE', 'name': 'Back Office', 'sort_order': 10},
    {'code': 'SALES_TEAM', 'name': 'Sales Team', 'sort_order': 20},
    {'code': 'FINANCE_TEAM', 'name': 'Finance Team', 'sort_order': 30},
    {'code': 'HR_TEAM', 'name': 'HR Team', 'sort_order': 40},
    {'code': 'OPS_TEAM', 'name': 'Operations Team', 'sort_order': 50},
]

USER_MATRIX = [
    {
        'username': 'uat_admin',
        'first_name': 'UAT',
        'last_name': 'Admin',
        'roles': ['ADMIN'],
        'teams': ['BACKOFFICE'],
        'email': 'uat_admin@example.com',
    },
    {
        'username': 'uat_manager',
        'first_name': 'UAT',
        'last_name': 'Manager',
        'roles': ['MANAGER'],
        'teams': ['BACKOFFICE', 'OPS_TEAM'],
        'email': 'uat_manager@example.com',
    },
    {
        'username': 'uat_finance',
        'first_name': 'UAT',
        'last_name': 'Finance',
        'roles': ['FINANCE_MANAGER', 'ACCOUNTANT'],
        'teams': ['FINANCE_TEAM', 'BACKOFFICE'],
        'email': 'uat_finance@example.com',
    },
    {
        'username': 'uat_hr',
        'first_name': 'UAT',
        'last_name': 'HR',
        'roles': ['HR_MANAGER', 'PAYROLL'],
        'teams': ['HR_TEAM', 'BACKOFFICE'],
        'email': 'uat_hr@example.com',
    },
    {
        'username': 'uat_ops',
        'first_name': 'UAT',
        'last_name': 'Ops',
        'roles': ['OPS_MANAGER'],
        'teams': ['OPS_TEAM'],
        'email': 'uat_ops@example.com',
    },
    {
        'username': 'uat_sales',
        'first_name': 'UAT',
        'last_name': 'Sales',
        'roles': ['SALES'],
        'teams': ['SALES_TEAM'],
        'email': 'uat_sales@example.com',
    },
    {
        'username': 'uat_sales_manager',
        'first_name': 'UAT',
        'last_name': 'Sales Manager',
        'roles': ['SALES_MANAGER'],
        'teams': ['SALES_TEAM'],
        'email': 'uat_sales_manager@example.com',
    },
    {
        'username': 'uat_product',
        'first_name': 'UAT',
        'last_name': 'Product',
        'roles': ['PRODUCT_MANAGER'],
        'teams': ['BACKOFFICE'],
        'email': 'uat_product@example.com',
    },
    {
        'username': 'uat_auditor',
        'first_name': 'UAT',
        'last_name': 'Auditor',
        'roles': ['AUDITOR'],
        'teams': ['BACKOFFICE'],
        'email': 'uat_auditor@example.com',
    },
]


class Command(BaseCommand):
    help = 'Bootstrap stable demo roles, teams, and UAT users for acceptance testing'

    def add_arguments(self, parser):
        parser.add_argument('--password', type=str, default='Demo123!', help='Password for created demo users')
        parser.add_argument(
            '--reset-passwords',
            action='store_true',
            help='Reset passwords for existing demo users to the provided password',
        )

    def handle(self, *args, **options):
        password = options['password']
        reset_passwords = bool(options['reset_passwords'])
        user_model = get_user_model()

        permission_map = {}
        for resource, action, code, name in PERMISSIONS:
            perm, _ = Permission.objects.update_or_create(
                resource=resource,
                action=action,
                defaults={'code': code, 'name': name},
            )
            permission_map[f'{resource}:{action}'] = perm

        role_map = {}
        for row in ROLE_MATRIX:
            role, _ = Role.objects.update_or_create(
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

        team_map = {}
        for row in TEAM_MATRIX:
            team, _ = Team.objects.update_or_create(
                code=row['code'],
                deleted_at__isnull=True,
                defaults={
                    'name': row['name'],
                    'sort_order': row['sort_order'],
                    'is_active': True,
                },
            )
            team_map[row['code']] = team

        summary = []
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
                user.set_password(password)
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
            summary.append({
                'username': user.username,
                'created': created,
                'roles': ', '.join(row['roles']),
                'teams': ', '.join(row['teams']),
            })

        # --- Seed workflow ---
        call_command('seed_sales_order_workflow')

        # --- Seed warehouses ---
        from inventory.models import Warehouse
        wh_data = [
            {'code': 'WH-MAIN', 'name': 'Kho chinh', 'address': '123 Demo Street'},
            {'code': 'WH-RAW', 'name': 'Kho nguyen lieu', 'address': '456 Material Ave'},
        ]
        for row in wh_data:
            Warehouse.objects.update_or_create(code=row['code'], defaults=row)

        # --- Seed one full demo sales order with lines ---
        from core.models import Customer
        from products.models import Product
        from sales.models import SalesOrder, SalesOrderLine, SalesOrderDeliveryPlan

        admin_user = user_model.objects.filter(username='uat_admin').first()
        if not admin_user:
            admin_user = user_model.objects.filter(is_staff=True).first()

        customer = Customer.objects.filter(is_active=True).first()
        products = list(Product.objects.filter(is_active=True)[:3])

        if admin_user and customer and products:
            demo_code = 'SO-DEMO-001'
            order, order_created = SalesOrder.objects.get_or_create(
                code=demo_code,
                defaults={
                    'customer': customer,
                    'order_date': timezone.localdate(),
                    'status': 'DRAFT',
                    'created_by': admin_user,
                },
            )
            if order_created:
                for idx, product in enumerate(products, 1):
                    SalesOrderLine.objects.create(
                        sales_order=order,
                        line_number=idx,
                        product=product,
                        qty=Decimal('100'),
                        unit_price=Decimal('50'),
                    )
                    SalesOrderDeliveryPlan.objects.create(
                        line=order.lines.get(line_number=idx),
                        delivery_date=timezone.localdate() + timedelta(days=7),
                        qty=Decimal('100'),
                        shipped_qty=Decimal('0'),
                        delivered_qty=Decimal('0'),
                    )
                self.stdout.write(f'Demo order {demo_code}: created with {len(products)} lines')
            else:
                self.stdout.write(f'Demo order {demo_code}: already exists')

        self.stdout.write(self.style.SUCCESS('Bootstrap UAT demo completed.'))
        self.stdout.write(f'Demo password in this run: {password}')
        for item in summary:
            verb = 'created' if item['created'] else 'updated'
            self.stdout.write(
                f"- {item['username']} ({verb}) | roles: {item['roles']} | teams: {item['teams']}"
            )
