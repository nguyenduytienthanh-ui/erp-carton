from collections import Counter, defaultdict
import csv
from io import StringIO

from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
import django_filters
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth.password_validation import validate_password
from decimal import Decimal
import json
import math
import re
import secrets
import string
import time
import unicodedata
from django.http import HttpResponse
from django.conf import settings
from django.db import models, transaction
from django.db.models import Count, DateTimeField, Exists, IntegerField, OuterRef, Subquery
from django.db.models.functions import Coalesce, Cast, TruncDate
from django.core.serializers.json import DjangoJSONEncoder
from django.core.management import call_command
from datetime import datetime
from datetime import timedelta
import uuid
from django.utils.dateparse import parse_datetime
from django.core.cache import cache
from .alerting import send_operational_alert
from .health import _compose_health
from .models import User, Role, Permission, Team, Setting, Customer, ExportTemplate, SavedView, Attachment, Comment, Notification, AuditLog, ApprovalHistory, UserSession, UserPreferences, ColumnPermission, Task, WorkflowTaskTemplate, TaskWatcher, WorkflowPipelineEvent, DocumentType, TaxRate, Shift, ExpenseCategory, NumberSequence
from .release_readiness import (
    get_alert_readiness_payload,
    get_alert_delivery_health_payload,
    get_alert_channel_status_payload,
    get_backup_inventory_payload,
    get_latest_audit_retention_run_payload,
    get_email_delivery_health_payload,
    get_performance_readiness_payload,
    get_release_hygiene_payload,
)
from .serializers import (
    UserSerializer, UserMentionSerializer, UserDirectorySerializer, AdminUserAccessUpdateSerializer, BulkUserAccessUpdateSerializer, RoleSerializer, RoleWriteSerializer, PermissionSerializer,
    TeamSerializer, TeamWriteSerializer, SettingSerializer, CustomTokenObtainPairSerializer,
    OnboardingPresetSerializer, OnboardingPresetPreviewSerializer, ApplyOnboardingPresetSerializer,
    UserProvisionPreviewSerializer, CreateProvisionedUserSerializer, UserOffboardingPreviewSerializer, ApplyUserOffboardingSerializer,
    AccessReviewCampaignSerializer, AccessReviewPreviewSerializer, ApplyAccessReviewSerializer,
    AccessExceptionPolicySerializer, AccessExceptionPreviewSerializer, CreateAccessExceptionRequestSerializer,
    AccessExceptionRoutingRuleSerializer, AccessExceptionApproverAvailabilitySerializer,
    CreateAccessExceptionRenewalSerializer, DecisionAccessExceptionRequestSerializer, RevokeAccessExceptionRequestSerializer, RerouteAccessExceptionRequestSerializer,
    AccessExceptionAutomationPolicySerializer, AccessExceptionAutomationRunSerializer, AccessExceptionAbsenceSimulationSerializer, AccessExceptionGuidedRemediationSerializer,
    CurrentUserUpdateSerializer, ChangePasswordSerializer,
    CustomerSerializer, ExportTemplateSerializer, SavedViewSerializer, AttachmentSerializer, CommentSerializer, NotificationSerializer, UserSessionSerializer, UserPreferencesSerializer, ColumnPermissionSerializer, TaskSerializer,
    WorkflowTaskTemplateSerializer,
    DocumentTypeSerializer, TaxRateSerializer, ShiftSerializer, ExpenseCategorySerializer, NumberSequenceSerializer,
)
from django.utils import timezone as django_timezone
from .filters import CustomerFilter, TeamFilter, RoleFilter
from .utils import export_to_excel
from .mixins import AuditLogMixin, ExportExcelMixin
from .permissions import check_action_permission


WORKFLOW_SCHEDULER_JOB_NAME = 'workflow-automation-global-scheduler'

MODULE_PERMISSION_FIELDS = [
    {
        'field': 'workforce_manage',
        'label': 'Nhân sự',
        'resource': 'WORKFORCE',
        'action': 'MANAGE',
        'changed_type': 'workforce',
    },
    {
        'field': 'finance_manage',
        'label': 'Tài chính',
        'resource': 'FINANCE',
        'action': 'MANAGE',
        'changed_type': 'finance',
    },
    {
        'field': 'purchasing_manage',
        'label': 'Mua hàng',
        'resource': 'PURCHASING',
        'action': 'MANAGE',
        'changed_type': 'purchasing',
    },
    {
        'field': 'production_manage',
        'label': 'Sản xuất',
        'resource': 'PRODUCTION',
        'action': 'MANAGE',
        'changed_type': 'production',
    },
    {
        'field': 'ops_view',
        'label': 'Điều hành',
        'resource': 'OPS',
        'action': 'VIEW',
        'changed_type': 'ops',
    },
    {
        'field': 'reports_view',
        'label': 'Trung tâm báo cáo',
        'resource': 'CORE',
        'action': 'VIEW_REPORTS',
        'changed_type': 'reports',
    },
    {
        'field': 'workflow_view',
        'label': 'Quy trình xem',
        'resource': 'WORKFLOW',
        'action': 'VIEW',
        'changed_type': 'workflow_view',
    },
    {
        'field': 'workflow_manage',
        'label': 'Quy trình quản lý',
        'resource': 'WORKFLOW',
        'action': 'MANAGE',
        'changed_type': 'workflow_manage',
    },
    {
        'field': 'operations_log_view',
        'label': 'Nhật ký vận hành',
        'resource': 'CORE',
        'action': 'VIEW_OPERATIONS_LOG',
        'changed_type': 'operations_log',
    },
    {
        'field': 'rbac_audit_view',
        'label': 'Lịch sử phân quyền',
        'resource': 'CORE',
        'action': 'VIEW_RBAC_AUDIT',
        'changed_type': 'rbac_audit',
    },
    {
        'field': 'rbac_manage',
        'label': 'Quản trị phân quyền',
        'resource': 'CORE',
        'action': 'MANAGE_RBAC',
        'changed_type': 'rbac',
    },
]

ROLE_GOVERNANCE_TEMPLATE_DEFINITIONS = [
    {
        'key': 'governance-steward',
        'name': 'Governance Steward',
        'description': 'Quan ly RBAC, workflow va nhat ky kiem soat cho bo phan dieu hanh he thong.',
        'tone': 'volcano',
        'permission_pairs': [
            ('CORE', 'MANAGE_RBAC'),
            ('CORE', 'VIEW_RBAC_AUDIT'),
            ('CORE', 'VIEW_OPERATIONS_LOG'),
            ('WORKFLOW', 'VIEW'),
            ('WORKFLOW', 'MANAGE'),
            ('CORE', 'VIEW_REPORTS'),
        ],
        'focus_modules': ['rbac-manage', 'rbac-audit', 'ops-log', 'workflow-manage'],
    },
    {
        'key': 'finance-control',
        'name': 'Finance Control',
        'description': 'Tap trung kiem soat tai chinh, bao cao va nhung diem cham phe duyet quan trong.',
        'tone': 'gold',
        'permission_pairs': [
            ('FINANCE', 'MANAGE'),
            ('CORE', 'VIEW_REPORTS'),
            ('CORE', 'VIEW_OPERATIONS_LOG'),
            ('PURCHASEORDER', 'APPROVE'),
            ('PURCHASEORDER', 'REJECT'),
            ('SALESORDER', 'POST'),
            ('SALESORDER', 'VOID'),
        ],
        'focus_modules': ['finance', 'reports', 'ops-log'],
    },
    {
        'key': 'operations-lead',
        'name': 'Operations Lead',
        'description': 'Phu hop cho team van hanh, mua hang, kho va san xuat lien thong.',
        'tone': 'blue',
        'permission_pairs': [
            ('OPS', 'VIEW'),
            ('WORKFLOW', 'VIEW'),
            ('WORKFLOW', 'MANAGE'),
            ('PURCHASING', 'MANAGE'),
            ('PRODUCTION', 'MANAGE'),
            ('INVENTORY', 'MANAGE'),
            ('CORE', 'VIEW_REPORTS'),
        ],
        'focus_modules': ['operations', 'workflow-manage', 'purchasing', 'production'],
    },
    {
        'key': 'sales-pipeline',
        'name': 'Sales Pipeline',
        'description': 'Nhom kinh doanh co kha nang submit, phe duyet va theo doi thong tin ban hang.',
        'tone': 'green',
        'permission_pairs': [
            ('SALESORDER', 'SUBMIT'),
            ('SALESORDER', 'APPROVE'),
            ('SALESORDER', 'REJECT'),
            ('CORE', 'VIEW_REPORTS'),
            ('WORKFLOW', 'VIEW'),
        ],
        'focus_modules': ['reports', 'workflow-view'],
    },
    {
        'key': 'audit-observer',
        'name': 'Audit Observer',
        'description': 'Chi doc bao cao, lich su phan quyen va nhat ky van hanh de giam sat.',
        'tone': 'purple',
        'permission_pairs': [
            ('CORE', 'VIEW_RBAC_AUDIT'),
            ('CORE', 'VIEW_OPERATIONS_LOG'),
            ('CORE', 'VIEW_REPORTS'),
            ('WORKFLOW', 'VIEW'),
        ],
        'focus_modules': ['rbac-audit', 'ops-log', 'reports'],
    },
]

TEAM_GOVERNANCE_PRESETS = [
    {
        'key': 'back-office',
        'code': 'BACKOFFICE',
        'name': 'Back Office',
        'description': 'Preset cho nhom ho tro van hanh trung tam.',
        'tone': 'blue',
    },
    {
        'key': 'sales-hub',
        'code': 'SALES_HUB',
        'name': 'Sales Hub',
        'description': 'Preset cho nhom kinh doanh va cham soc khach hang.',
        'tone': 'green',
    },
    {
        'key': 'finance-pod',
        'code': 'FINANCE_POD',
        'name': 'Finance Pod',
        'description': 'Preset cho nhom tai chinh, thu chi va doi soat.',
        'tone': 'gold',
    },
    {
        'key': 'ops-cell',
        'code': 'OPS_CELL',
        'name': 'Ops Cell',
        'description': 'Preset cho nhom dieu phoI mua hang, kho va san xuat.',
        'tone': 'cyan',
    },
]

ACCESS_EXCEPTION_POLICY_PACKS = [
    {
        'key': 'ops-hotfix',
        'name': 'Ops Hotfix',
        'description': 'Cho incident response va can mo quyen nhanh trong khung van hanh ngan han.',
        'tone': 'cyan',
        'risk_level': 'elevated',
        'requires_approval': True,
        'approval_stage_count': 1,
        'approval_sla_hours': 12,
        'stage_one_label': 'Operations lead review',
        'stage_two_label': '',
        'default_duration_days': 3,
        'max_duration_days': 7,
        'checklist': ['Link ticket incident', 'Xac nhan owner', 'Dat lich revoke/renewal'],
        'department_key': 'operations',
        'department_label': 'Operations',
        'preferred_team_tokens': ['OPS', 'BACKOFFICE', 'OPS_CELL', 'WAREHOUSE', 'PRODUCTION'],
        'routing_summary': 'Uu tien approver dang nam cung cell van hanh cua target de mo exception nhanh.',
        'stage_one_strategy_label': 'Ops lead gan nhat voi team cua target',
        'stage_two_strategy_label': '',
        'require_independent_stage_two': False,
    },
    {
        'key': 'finance-sensitive',
        'name': 'Finance Sensitive',
        'description': 'Dung cho access anh huong doi soat, posting, hoac thay doi so lieu tai chinh nhay cam.',
        'tone': 'gold',
        'risk_level': 'critical',
        'requires_approval': True,
        'approval_stage_count': 2,
        'approval_sla_hours': 8,
        'stage_one_label': 'Finance control review',
        'stage_two_label': 'Governance sign-off',
        'default_duration_days': 2,
        'max_duration_days': 5,
        'checklist': ['Gan ticket kiem soat', 'Mo ta blast radius', 'Xac nhan nguoi revoke'],
        'department_key': 'finance',
        'department_label': 'Finance',
        'preferred_team_tokens': ['FINANCE', 'FIN', 'ACCOUNT', 'CONTROL', 'TREASURY'],
        'routing_summary': 'Stage 1 di qua finance control cung domain, stage 2 tach sang governance de dam bao 4-eye control.',
        'stage_one_strategy_label': 'Finance controller cung department',
        'stage_two_strategy_label': 'Governance approver doc lap ngoai team target',
        'require_independent_stage_two': True,
    },
    {
        'key': 'cross-team-bridge',
        'name': 'Cross-team Bridge',
        'description': 'Cho truong hop user can access lien phong ban trong suot mot wave giao ban/chuyen giao.',
        'tone': 'blue',
        'risk_level': 'elevated',
        'requires_approval': True,
        'approval_stage_count': 2,
        'approval_sla_hours': 24,
        'stage_one_label': 'Functional manager review',
        'stage_two_label': 'Platform steward review',
        'default_duration_days': 5,
        'max_duration_days': 14,
        'checklist': ['Xac nhan business sponsor', 'Ke hoach rollback', 'Review renewal truoc 24h'],
        'department_key': 'cross-functional',
        'department_label': 'Cross-functional',
        'preferred_team_tokens': ['OPS', 'PLATFORM', 'PMO', 'PROJECT', 'BACKOFFICE'],
        'routing_summary': 'Stage 1 uu tien approver co lien he voi team hien tai, stage 2 chuyen sang steward ngoai team de kiem soat blast radius.',
        'stage_one_strategy_label': 'Lead gan voi team hien tai cua target',
        'stage_two_strategy_label': 'Steward ngoai team target',
        'require_independent_stage_two': True,
    },
    {
        'key': 'audit-readonly',
        'name': 'Audit Readonly',
        'description': 'Pack cho tai khoan can doc du lieu tam thoi de kiem tra, audit hoac doi soat.',
        'tone': 'green',
        'risk_level': 'standard',
        'requires_approval': True,
        'approval_stage_count': 1,
        'approval_sla_hours': 24,
        'stage_one_label': 'Audit owner review',
        'stage_two_label': '',
        'default_duration_days': 7,
        'max_duration_days': 21,
        'checklist': ['Xac nhan chi doc', 'Gan case ref', 'Dat reminder het han'],
        'department_key': 'audit',
        'department_label': 'Audit',
        'preferred_team_tokens': ['AUDIT', 'COMPLIANCE', 'CONTROL', 'FINANCE'],
        'routing_summary': 'Goi y audit owner hoac compliance approver, uu tien nhom chi-doc va truy vet ro rang.',
        'stage_one_strategy_label': 'Audit owner hoac compliance reviewer',
        'stage_two_strategy_label': '',
        'require_independent_stage_two': False,
    },
]

ROLE_GOVERNANCE_MODULE_KEY_LOOKUP = {
    ('WORKFORCE', 'MANAGE'): 'workforce',
    ('FINANCE', 'MANAGE'): 'finance',
    ('PURCHASING', 'MANAGE'): 'purchasing',
    ('PRODUCTION', 'MANAGE'): 'production',
    ('OPS', 'VIEW'): 'operations',
    ('CORE', 'VIEW_REPORTS'): 'reports',
    ('WORKFLOW', 'VIEW'): 'workflow-view',
    ('WORKFLOW', 'MANAGE'): 'workflow-manage',
    ('CORE', 'VIEW_OPERATIONS_LOG'): 'ops-log',
    ('CORE', 'VIEW_RBAC_AUDIT'): 'rbac-audit',
    ('CORE', 'MANAGE_RBAC'): 'rbac-manage',
}

USER_ONBOARDING_PRESETS_SETTING_KEY = 'USER_ONBOARDING_PRESETS'
USER_ACCESS_REVIEW_CAMPAIGNS_SETTING_KEY = 'USER_ACCESS_REVIEW_CAMPAIGNS'
USER_ACCESS_EXCEPTION_POLICIES_SETTING_KEY = 'USER_ACCESS_EXCEPTION_POLICIES'
USER_ACCESS_EXCEPTION_REQUESTS_SETTING_KEY = 'USER_ACCESS_EXCEPTION_REQUESTS'
USER_ACCESS_EXCEPTION_ROUTING_RULES_SETTING_KEY = 'USER_ACCESS_EXCEPTION_ROUTING_RULES'
USER_ACCESS_EXCEPTION_APPROVER_AVAILABILITY_SETTING_KEY = 'USER_ACCESS_EXCEPTION_APPROVER_AVAILABILITY'
USER_ACCESS_EXCEPTION_AUTOMATION_SETTING_KEY = 'USER_ACCESS_EXCEPTION_AUTOMATION'
USER_ACCESS_EXCEPTION_CONTINUITY_DRILL_SETTING_KEY = 'USER_ACCESS_EXCEPTION_CONTINUITY_DRILLS'
USER_ACCESS_EXCEPTION_REMEDIATION_CAMPAIGNS_SETTING_KEY = 'USER_ACCESS_EXCEPTION_REMEDIATION_CAMPAIGNS'
ACCESS_EXCEPTION_AUTOMATION_SCHEDULER_NAME = 'access-exception-automation-global-scheduler'
ACCESS_EXCEPTION_AUTOMATION_LOCK_KEY = 'access_exception_automation_scheduler_job_lock'
USER_ONBOARDING_NOTIFICATION_TYPES = [
    'approval_request',
    'approval_approved',
    'approval_rejected',
    'assignment',
    'due_date',
    'mention',
    'system',
]

ACCOUNT_IMPORTANT_NOTIFICATION_TYPES = {
    'approval_request',
    'approval_rejected',
    'assignment',
    'due_date',
}

ACCOUNT_ENTITY_ROUTE_MAP = {
    'Task': '/task-inbox',
    'SalesOrder': '/sales-orders',
    'PurchaseOrder': '/purchase-orders',
    'PurchaseReceipt': '/purchase-receipts',
    'ProductionOrder': '/production-orders',
    'ProductionReceipt': '/production-receipts',
    'Customer': '/customers',
    'Supplier': '/suppliers',
}

ACCOUNT_ACCESS_MODULES = [
    {
        'key': 'sales',
        'label': 'Kinh doanh',
        'description': 'Đơn hàng xuất, báo giá và giao hàng',
        'primary_route': '/sales-orders',
        'permissions': [
            ('SALESORDER', 'SUBMIT'),
            ('SALESORDER', 'APPROVE'),
            ('SALESORDER', 'REJECT'),
            ('SALESORDER', 'POST'),
            ('SALESORDER', 'VOID'),
        ],
        'role_names': {'admin', 'manager', 'sales', 'sales-manager', 'accountant', 'finance', 'finance-manager', 'ops-manager', 'quan-ly', 'quanly'},
        'matcher': '_can_access_sales_orders',
    },
    {
        'key': 'inventory',
        'label': 'Kho',
        'description': 'Tồn kho, kiểm tồn và chuyển kho',
        'primary_route': '/inventory-stock',
        'permissions': [
            ('INVENTORY', 'MANAGE'),
            ('INVENTORY', 'STOCKTAKE'),
        ],
        'role_names': {'admin', 'manager', 'operation-manager', 'ops-manager', 'product-manager', 'sales-manager', 'quan-ly', 'quanly'},
        'matcher': '_can_access_inventory_hub',
    },
    {
        'key': 'purchasing',
        'label': 'Mua hàng',
        'description': 'Nhà cung cấp, đơn mua và nhập mua',
        'primary_route': '/purchase-orders',
        'permissions': [
            ('PURCHASING', 'MANAGE'),
            ('PURCHASEORDER', 'SUBMIT'),
            ('PURCHASEORDER', 'APPROVE'),
            ('PURCHASEORDER', 'RECEIVE'),
            ('PURCHASEORDER', 'CANCEL'),
        ],
        'role_names': {'admin', 'manager', 'operation-manager', 'ops-manager', 'product-manager', 'finance-manager', 'quan-ly', 'quanly'},
        'matcher': '_can_manage_purchasing_data',
    },
    {
        'key': 'production',
        'label': 'Sản xuất',
        'description': 'Lệnh sản xuất, cấp vật tư và nhập thành phẩm',
        'primary_route': '/production-orders',
        'permissions': [
            ('PRODUCTION', 'MANAGE'),
            ('PRODUCTIONORDER', 'SUBMIT'),
            ('PRODUCTIONORDER', 'APPROVE'),
            ('PRODUCTIONORDER', 'RELEASE'),
            ('PRODUCTIONORDER', 'ISSUE'),
            ('PRODUCTIONORDER', 'RECEIVE'),
        ],
        'role_names': {'admin', 'manager', 'operation-manager', 'ops-manager', 'product-manager', 'finance-manager', 'quan-ly', 'quanly'},
        'matcher': '_can_access_production_center',
    },
    {
        'key': 'workforce',
        'label': 'Nhân sự',
        'description': 'Nhân viên, chấm công, lương và ứng lương',
        'primary_route': '/employees',
        'permissions': [
            ('WORKFORCE', 'MANAGE'),
        ],
        'role_names': {'admin', 'manager', 'hr', 'hr-manager', 'human-resources', 'payroll', 'accountant', 'quan-ly', 'quanly'},
        'matcher': '_can_manage_workforce_data',
    },
    {
        'key': 'finance',
        'label': 'Tài chính',
        'description': 'Công nợ, sổ cái, ngân sách và đối soát',
        'primary_route': '/finance-summary',
        'permissions': [
            ('FINANCE', 'MANAGE'),
        ],
        'role_names': {'admin', 'manager', 'finance', 'finance-manager', 'accountant', 'quan-ly', 'quanly'},
        'matcher': '_can_manage_finance_data',
    },
    {
        'key': 'workflow',
        'label': 'Quy trình',
        'description': 'Pipeline, nhiệm vụ và workflow analytics',
        'primary_route': '/workflow-pipeline',
        'permissions': [
            ('WORKFLOW', 'VIEW'),
            ('WORKFLOW', 'MANAGE'),
        ],
        'role_names': {'admin', 'manager', 'operation-manager', 'ops-manager', 'quan-ly', 'quanly'},
        'matcher': '_can_view_workflow',
    },
    {
        'key': 'reports',
        'label': 'Bao cao',
        'description': 'Bao cao tong hop va dashboard dieu hanh',
        'primary_route': '/reports',
        'permissions': [
            ('CORE', 'VIEW_REPORTS'),
        ],
        'role_names': set(),
        'matcher': '_can_view_reports_center',
    },
    {
        'key': 'operations',
        'label': 'Dieu hanh',
        'description': 'Cockpit dieu hanh, BI va task operations',
        'primary_route': '/executive-cockpit',
        'permissions': [
            ('OPS', 'VIEW'),
        ],
        'role_names': {'admin', 'manager', 'operation-manager', 'ops-manager', 'quan-ly', 'quanly'},
        'matcher': '_can_view_ops_hub',
    },
    {
        'key': 'governance',
        'label': 'Kiem soat',
        'description': 'Nhat ky van hanh va quan tri phan quyen',
        'primary_route': '/operations-log',
        'permissions': [
            ('CORE', 'VIEW_OPERATIONS_LOG'),
            ('CORE', 'VIEW_RBAC_AUDIT'),
            ('CORE', 'MANAGE_RBAC'),
        ],
        'role_names': {'admin', 'manager', 'quan-ly', 'quanly'},
        'matcher': '_can_access_governance_hub',
    },
]


def _get_request_ip(request):
    if not request:
        return '127.0.0.1'
    forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR', '')
    client_ip = forwarded_for.split(',')[0].strip() if forwarded_for else ''
    return client_ip or request.META.get('REMOTE_ADDR') or '127.0.0.1'


def _detect_browser(user_agent):
    ua = (user_agent or '').lower()
    if 'edg/' in ua:
        return 'Microsoft Edge'
    if 'chrome/' in ua and 'edg/' not in ua:
        return 'Google Chrome'
    if 'firefox/' in ua:
        return 'Mozilla Firefox'
    if 'safari/' in ua and 'chrome/' not in ua:
        return 'Safari'
    if 'opr/' in ua or 'opera/' in ua:
        return 'Opera'
    return 'Không rõ'


def _detect_operating_system(user_agent):
    ua = (user_agent or '').lower()
    if 'windows' in ua:
        return 'Windows'
    if 'iphone' in ua or 'ipad' in ua or 'ios' in ua:
        return 'iOS'
    if 'android' in ua:
        return 'Android'
    if 'mac os x' in ua or 'macintosh' in ua:
        return 'macOS'
    if 'linux' in ua:
        return 'Linux'
    return 'Không rõ'


def _extract_device_info(request):
    user_agent = (request.META.get('HTTP_USER_AGENT') or '')[:500]
    return {
        'user_agent': user_agent,
        'browser': _detect_browser(user_agent),
        'os': _detect_operating_system(user_agent),
        'device_type': 'Di động' if any(token in user_agent.lower() for token in ['mobile', 'android', 'iphone']) else 'Máy tính',
    }


def _get_current_session_identifier(request):
    auth = getattr(request, 'auth', None)
    if auth is not None:
        try:
            sid = auth.get('sid')
        except AttributeError:
            sid = None
        if sid:
            return str(sid)
    return getattr(request.session, 'session_key', None)


def _register_user_session(request, user, session_key):
    if not session_key:
        return None
    defaults = {
        'device_info': _extract_device_info(request),
        'ip_address': _get_request_ip(request),
        'is_active': True,
        'logout_at': None,
    }
    session, created = UserSession.objects.update_or_create(
        session_key=str(session_key),
        defaults={'user': user, **defaults},
    )
    if not created:
        UserSession.objects.filter(pk=session.pk).update(
            device_info=defaults['device_info'],
            ip_address=defaults['ip_address'],
            is_active=True,
            logout_at=None,
        )
        session.refresh_from_db()
    return session


def _user_role_names(user):
    try:
        pairs = user.roles.values_list('name', 'code')
    except Exception:
        return set()
    role_names = set()
    for name, code in pairs:
        if name:
            role_names.add(str(name).strip().lower())
        if code:
            role_names.add(str(code).strip().lower())
    return role_names


def _has_any_role_name(user, accepted_names):
    return any(role_name in accepted_names for role_name in _user_role_names(user))


def _can_view_ops_hub(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'OPS', 'VIEW', strict=True):
        return True
    return _has_any_role_name(user, {'admin', 'manager', 'operation-manager', 'ops-manager', 'quan-ly', 'quanly'})


def _can_view_workflow(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'WORKFLOW', 'VIEW', strict=True):
        return True
    if check_action_permission(user, 'WORKFLOW', 'MANAGE', strict=True):
        return True
    return _has_any_role_name(user, {'admin', 'manager', 'operation-manager', 'ops-manager', 'quan-ly', 'quanly'})


def _can_manage_workflow(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'WORKFLOW', 'MANAGE', strict=True):
        return True
    return _has_any_role_name(user, {'admin', 'manager', 'operation-manager', 'ops-manager', 'quan-ly', 'quanly'})


def _can_view_operations_log(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'CORE', 'VIEW_OPERATIONS_LOG', strict=True):
        return True
    return _has_any_role_name(user, {'admin', 'manager', 'operation-manager', 'ops-manager', 'quan-ly', 'quanly'})


def _can_view_rbac_audit(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'CORE', 'VIEW_RBAC_AUDIT', strict=True):
        return True
    if check_action_permission(user, 'CORE', 'MANAGE_RBAC', strict=True):
        return True
    return _has_any_role_name(user, {'admin', 'manager', 'quan-ly', 'quanly'})


def _can_view_reports_center(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    return check_action_permission(user, 'CORE', 'VIEW_REPORTS', strict=True)


def _can_manage_workforce_data(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'WORKFORCE', 'MANAGE', strict=True):
        return True
    return _has_any_role_name(user, {'admin', 'manager', 'hr', 'hr-manager', 'human-resources', 'payroll', 'accountant', 'quan-ly', 'quanly'})


def _can_manage_finance_data(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'FINANCE', 'MANAGE', strict=True):
        return True
    return _has_any_role_name(user, {'admin', 'manager', 'finance', 'finance-manager', 'accountant', 'quan-ly', 'quanly'})


def _can_manage_inventory_data(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'INVENTORY', 'MANAGE', strict=True):
        return True
    return _has_any_role_name(user, {'admin', 'manager', 'operation-manager', 'ops-manager', 'product-manager', 'sales-manager', 'quan-ly', 'quanly'})


def _can_manage_stocktake(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'INVENTORY', 'MANAGE', strict=True):
        return True
    if check_action_permission(user, 'INVENTORY', 'STOCKTAKE', strict=True):
        return True
    return _has_any_role_name(user, {'admin', 'manager', 'operation-manager', 'ops-manager', 'product-manager', 'sales-manager', 'quan-ly', 'quanly'})


def _can_access_inventory_hub(user):
    return _can_manage_inventory_data(user) or _can_manage_stocktake(user)


def _can_manage_purchasing_data(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'PURCHASING', 'MANAGE', strict=True):
        return True
    return _has_any_role_name(user, {'admin', 'manager', 'operation-manager', 'ops-manager', 'product-manager', 'finance-manager', 'quan-ly', 'quanly'})


def _can_manage_production_data(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'PRODUCTION', 'MANAGE', strict=True):
        return True
    return _has_any_role_name(user, {'admin', 'manager', 'operation-manager', 'ops-manager', 'product-manager', 'finance-manager', 'quan-ly', 'quanly'})


def _can_access_production_center(user):
    if _can_manage_production_data(user):
        return True
    if not user or not user.is_authenticated:
        return False
    if (
        check_action_permission(user, 'PRODUCTIONORDER', 'SUBMIT', strict=True)
        or check_action_permission(user, 'PRODUCTIONORDER', 'APPROVE', strict=True)
        or check_action_permission(user, 'PRODUCTIONORDER', 'RELEASE', strict=True)
        or check_action_permission(user, 'PRODUCTIONORDER', 'ISSUE', strict=True)
        or check_action_permission(user, 'PRODUCTIONORDER', 'RECEIVE', strict=True)
        or check_action_permission(user, 'PRODUCTIONORDER', 'CANCEL', strict=True)
    ):
        return True
    return False


def _can_access_sales_orders(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if (
        check_action_permission(user, 'SALESORDER', 'SUBMIT', strict=True)
        or check_action_permission(user, 'SALESORDER', 'APPROVE', strict=True)
        or check_action_permission(user, 'SALESORDER', 'REJECT', strict=True)
        or check_action_permission(user, 'SALESORDER', 'POST', strict=True)
        or check_action_permission(user, 'SALESORDER', 'VOID', strict=True)
    ):
        return True
    return _has_any_role_name(user, {'admin', 'manager', 'sales', 'sales-manager', 'accountant', 'finance', 'finance-manager', 'ops-manager', 'quan-ly', 'quanly'})


def _can_manage_module_permissions(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'CORE', 'MANAGE_RBAC', strict=True):
        return True
    return _has_any_role_name(user, {'admin', 'manager', 'quan-ly', 'quanly'})


def _can_manage_user_directory(user):
    return _can_manage_module_permissions(user)


def _can_access_governance_hub(user):
    return _can_view_operations_log(user) or _can_view_rbac_audit(user) or _can_manage_module_permissions(user)


def _can_view_admin_observability(user):
    return (
        _can_view_operations_log(user)
        or _can_view_workflow(user)
        or _can_access_governance_hub(user)
        or _can_manage_finance_data(user)
        or _can_manage_workforce_data(user)
        or _can_manage_purchasing_data(user)
        or _can_manage_production_data(user)
    )


def _can_view_access_governance_center(user):
    return _can_manage_module_permissions(user) or _can_view_rbac_audit(user)


def _can_view_approval_control_tower(user):
    return (
        _can_manage_finance_data(user)
        or _can_manage_workforce_data(user)
        or _can_manage_purchasing_data(user)
        or _can_manage_production_data(user)
        or _can_view_admin_observability(user)
    )


ACCESS_SURFACE_ROUTE_DEFINITIONS = [
    {'key': 'sales_orders', 'label': 'Đơn hàng xuất', 'path': '/sales-orders', 'capability': 'sales_orders', 'group': 'sales'},
    {'key': 'shipments', 'label': 'Phiếu xuất', 'path': '/shipments', 'capability': 'sales_orders', 'group': 'sales'},
    {'key': 'quotes', 'label': 'Quotes', 'path': '/quotes', 'capability': 'sales_orders', 'group': 'sales'},
    {'key': 'purchase_orders', 'label': 'Purchase orders', 'path': '/purchase-orders', 'capability': 'purchasing', 'group': 'purchasing'},
    {'key': 'purchase_receipts', 'label': 'Purchase receipts', 'path': '/purchase-receipts', 'capability': 'purchasing', 'group': 'purchasing'},
    {'key': 'purchase_requests', 'label': 'Purchase requests', 'path': '/purchase-requests', 'capability': 'purchasing', 'group': 'purchasing'},
    {'key': 'purchase_returns', 'label': 'Purchase returns', 'path': '/purchase-returns', 'capability': 'purchasing', 'group': 'purchasing'},
    {'key': 'production_orders', 'label': 'Lệnh sản xuất', 'path': '/production-orders', 'capability': 'production', 'group': 'production'},
    {'key': 'production_planning', 'label': 'Điều độ sản xuất', 'path': '/production-planning', 'capability': 'production_planning', 'group': 'production'},
    {'key': 'material_issues', 'label': 'Material issues', 'path': '/material-issues', 'capability': 'production', 'group': 'production'},
    {'key': 'production_receipts', 'label': 'Production receipts', 'path': '/production-receipts', 'capability': 'production', 'group': 'production'},
    {'key': 'warehouses', 'label': 'Warehouses', 'path': '/warehouses', 'capability': 'inventory', 'group': 'inventory'},
    {'key': 'inventory_stock', 'label': 'Inventory stock', 'path': '/inventory-stock', 'capability': 'inventory', 'group': 'inventory'},
    {'key': 'inventory_transactions', 'label': 'Inventory transactions', 'path': '/inventory-transactions', 'capability': 'inventory', 'group': 'inventory'},
    {'key': 'inventory_reservations', 'label': 'Inventory reservations', 'path': '/inventory-reservations', 'capability': 'inventory', 'group': 'inventory'},
    {'key': 'warehouse_transfers', 'label': 'Warehouse transfers', 'path': '/warehouse-transfers', 'capability': 'inventory', 'group': 'inventory'},
    {'key': 'stocktakes', 'label': 'Stocktakes', 'path': '/stocktakes', 'capability': 'stocktake', 'group': 'inventory'},
    {'key': 'stock_alerts', 'label': 'Stock alerts', 'path': '/stock-alerts', 'capability': 'inventory', 'group': 'inventory'},
    {'key': 'executive_cockpit', 'label': 'Executive cockpit', 'path': '/executive-cockpit', 'capability': 'ops_hub', 'group': 'operations'},
    {'key': 'reports_center', 'label': 'Reports center', 'path': '/reports', 'capability': 'reports', 'group': 'operations'},
    {'key': 'workflow_pipeline', 'label': 'Workflow pipeline', 'path': '/workflow-pipeline', 'capability': 'workflow_view', 'group': 'workflow'},
    {'key': 'workflow_analytics', 'label': 'Workflow analytics', 'path': '/workflow-analytics', 'capability': 'workflow_view', 'group': 'workflow'},
    {'key': 'workflow_task_templates', 'label': 'Workflow task templates', 'path': '/workflow-task-templates', 'capability': 'workflow_manage', 'group': 'workflow'},
    {'key': 'operations_log', 'label': 'Operations log', 'path': '/operations-log', 'capability': 'operations_log', 'group': 'operations'},
    {'key': 'finance_summary', 'label': 'Finance summary', 'path': '/finance-summary', 'capability': 'finance', 'group': 'finance'},
    {'key': 'advance_transactions', 'label': 'Tạm ứng - quyết toán', 'path': '/advance-transactions', 'capability': 'finance', 'group': 'finance'},
    {'key': 'receivables', 'label': 'Receivables', 'path': '/receivables', 'capability': 'finance', 'group': 'finance'},
    {'key': 'payables', 'label': 'Payables', 'path': '/payables', 'capability': 'finance', 'group': 'finance'},
    {'key': 'budget_management', 'label': 'Budget management', 'path': '/budget-management', 'capability': 'finance', 'group': 'finance'},
    {'key': 'bank_reconciliation', 'label': 'Bank reconciliation', 'path': '/bank-reconciliation', 'capability': 'finance', 'group': 'finance'},
    {'key': 'employees', 'label': 'Employees', 'path': '/employees', 'capability': 'workforce', 'group': 'workforce'},
    {'key': 'attendance', 'label': 'Attendance', 'path': '/attendance', 'capability': 'workforce', 'group': 'workforce'},
    {'key': 'payroll', 'label': 'Payroll', 'path': '/payroll', 'capability': 'workforce', 'group': 'workforce'},
    {'key': 'salary_advance', 'label': 'Ứng lương', 'path': '/salary-advance', 'capability': 'workforce', 'group': 'workforce'},
    {'key': 'approval_control_tower', 'label': 'Approval control tower', 'path': '/admin/approval-control-tower', 'capability': 'approval_control_tower', 'group': 'admin'},
    {'key': 'admin_audit', 'label': 'Admin audit center', 'path': '/admin/audit-center', 'capability': 'admin_audit', 'group': 'admin'},
    {'key': 'admin_observability', 'label': 'Admin observability', 'path': '/admin/observability', 'capability': 'admin_observability', 'group': 'admin'},
    {'key': 'access_governance', 'label': 'Access governance', 'path': '/admin/access-governance', 'capability': 'access_governance', 'group': 'admin'},
    {'key': 'access_exceptions', 'label': 'Access exceptions', 'path': '/admin/access-exceptions', 'capability': 'user_access_exceptions', 'group': 'admin'},
    {'key': 'access_reviews', 'label': 'Access reviews', 'path': '/admin/access-reviews', 'capability': 'user_access_reviews', 'group': 'admin'},
    {'key': 'user_provisioning', 'label': 'User provisioning', 'path': '/admin/user-provisioning', 'capability': 'user_provisioning', 'group': 'admin'},
    {'key': 'user_lifecycle', 'label': 'User lifecycle', 'path': '/admin/user-lifecycle', 'capability': 'user_lifecycle', 'group': 'admin'},
    {'key': 'onboarding_studio', 'label': 'Trợ lý triển khai công việc', 'path': '/admin/onboarding-studio', 'capability': 'onboarding', 'group': 'admin'},
    {'key': 'roles_teams', 'label': 'Roles and teams', 'path': '/admin/roles-teams', 'capability': 'role_team_governance', 'group': 'admin'},
    {'key': 'user_directory', 'label': 'User directory', 'path': '/admin/users', 'capability': 'user_directory', 'group': 'admin'},
    {'key': 'module_permissions', 'label': 'Module permission settings', 'path': '/admin/module-permissions', 'capability': 'module_permission_settings', 'group': 'admin'},
    {'key': 'module_permissions_history', 'label': 'Module permission history', 'path': '/admin/module-permissions-history', 'capability': 'module_permission_history', 'group': 'admin'},
]


ACCESS_SURFACE_API_DEFINITIONS = [
    {'key': 'sales_orders_api', 'label': 'Sales order API', 'path_prefix': '/api/sales/orders/', 'capability': 'sales_orders', 'group': 'sales'},
    {'key': 'shipments_api', 'label': 'Shipment API', 'path_prefix': '/api/sales/shipments/', 'capability': 'sales_orders', 'group': 'sales'},
    {'key': 'purchase_orders_api', 'label': 'Purchase order API', 'path_prefix': '/api/purchasing/orders/', 'capability': 'purchasing', 'group': 'purchasing'},
    {'key': 'purchase_requests_api', 'label': 'Purchase request API', 'path_prefix': '/api/purchasing/requests/', 'capability': 'purchasing', 'group': 'purchasing'},
    {'key': 'purchase_receipts_api', 'label': 'Purchase receipt API', 'path_prefix': '/api/purchasing/receipts/', 'capability': 'purchasing', 'group': 'purchasing'},
    {'key': 'purchase_returns_api', 'label': 'Purchase return API', 'path_prefix': '/api/purchasing/returns/', 'capability': 'purchasing', 'group': 'purchasing'},
    {'key': 'production_orders_api', 'label': 'Production order API', 'path_prefix': '/api/production/orders/', 'capability': 'production', 'group': 'production'},
    {'key': 'production_issues_api', 'label': 'Production issue API', 'path_prefix': '/api/production/issues/', 'capability': 'production', 'group': 'production'},
    {'key': 'production_receipts_api', 'label': 'Production receipt API', 'path_prefix': '/api/production/receipts/', 'capability': 'production', 'group': 'production'},
    {'key': 'inventory_stock_api', 'label': 'Inventory stock API', 'path_prefix': '/api/inventory/stock/', 'capability': 'inventory', 'group': 'inventory'},
    {'key': 'warehouse_transfers_api', 'label': 'Warehouse transfer API', 'path_prefix': '/api/inventory/warehouse-transfers/', 'capability': 'inventory', 'group': 'inventory'},
    {'key': 'stocktake_api', 'label': 'Stocktake API', 'path_prefix': '/api/inventory/stocktakes/', 'capability': 'stocktake', 'group': 'inventory'},
    {'key': 'finance_api', 'label': 'Finance API', 'path_prefix': '/api/finance/', 'capability': 'finance', 'group': 'finance'},
    {'key': 'workforce_api', 'label': 'Workforce API', 'path_prefix': '/api/workforce/', 'capability': 'workforce', 'group': 'workforce'},
    {'key': 'workflow_templates_api', 'label': 'Workflow template API', 'path_prefix': '/api/workflow-task-templates/', 'capability': 'workflow_manage', 'group': 'workflow'},
    {'key': 'operations_log_api', 'label': 'Operations log API', 'path_prefix': '/api/activity/operations_log_meta/', 'capability': 'operations_log', 'group': 'operations'},
    {'key': 'admin_observability_api', 'label': 'Admin observability API', 'path_prefix': '/api/users/admin_observability_workspace/', 'capability': 'admin_observability', 'group': 'admin'},
    {'key': 'admin_audit_api', 'label': 'Admin audit API', 'path_prefix': '/api/users/admin_audit_workspace/', 'capability': 'admin_audit', 'group': 'admin'},
    {'key': 'access_governance_api', 'label': 'Access governance API', 'path_prefix': '/api/users/access_surface_matrix/', 'capability': 'access_governance', 'group': 'admin'},
    {'key': 'access_exception_api', 'label': 'Access exception API', 'path_prefix': '/api/users/access_exception_workspace/', 'capability': 'user_access_exceptions', 'group': 'admin'},
    {'key': 'access_review_api', 'label': 'Access review API', 'path_prefix': '/api/users/access_review_workspace/', 'capability': 'user_access_reviews', 'group': 'admin'},
    {'key': 'user_provisioning_api', 'label': 'User provisioning API', 'path_prefix': '/api/users/provisioning_workspace/', 'capability': 'user_provisioning', 'group': 'admin'},
    {'key': 'user_lifecycle_api', 'label': 'User lifecycle API', 'path_prefix': '/api/users/offboarding_workspace/', 'capability': 'user_lifecycle', 'group': 'admin'},
    {'key': 'user_directory_api', 'label': 'User directory API', 'path_prefix': '/api/users/directory/', 'capability': 'user_directory', 'group': 'admin'},
    {'key': 'role_team_governance_api', 'label': 'Role and team API', 'path_prefix': '/api/roles/governance_summary/', 'capability': 'role_team_governance', 'group': 'admin'},
    {'key': 'module_permissions_api', 'label': 'Module permission API', 'path_prefix': '/api/roles/module_permissions/', 'capability': 'module_permission_settings', 'group': 'admin'},
    {'key': 'module_permission_history_api', 'label': 'Module permission history API', 'path_prefix': '/api/roles/module_permissions_history/', 'capability': 'module_permission_history', 'group': 'admin'},
]

ACCESS_SURFACE_CRITICAL_ACTION_DEFINITIONS = [
    {'key': 'purchase_order_submit', 'label': 'Submit purchase order', 'permission_key': 'PURCHASEORDER:SUBMIT', 'group': 'purchasing'},
    {'key': 'purchase_order_approve', 'label': 'Approve purchase order', 'permission_key': 'PURCHASEORDER:APPROVE', 'group': 'purchasing'},
    {'key': 'purchase_order_reject', 'label': 'Reject purchase order', 'permission_key': 'PURCHASEORDER:REJECT', 'group': 'purchasing'},
    {'key': 'purchase_order_receive', 'label': 'Receive purchase order', 'permission_key': 'PURCHASEORDER:RECEIVE', 'group': 'purchasing'},
    {'key': 'purchase_order_cancel', 'label': 'Cancel purchase order', 'permission_key': 'PURCHASEORDER:CANCEL', 'group': 'purchasing'},
    {'key': 'production_order_submit', 'label': 'Submit production order', 'permission_key': 'PRODUCTIONORDER:SUBMIT', 'group': 'production'},
    {'key': 'production_order_approve', 'label': 'Approve production order', 'permission_key': 'PRODUCTIONORDER:APPROVE', 'group': 'production'},
    {'key': 'production_order_reject', 'label': 'Reject production order', 'permission_key': 'PRODUCTIONORDER:REJECT', 'group': 'production'},
    {'key': 'production_order_release', 'label': 'Release production order', 'permission_key': 'PRODUCTIONORDER:RELEASE', 'group': 'production'},
    {'key': 'production_order_issue', 'label': 'Issue materials', 'permission_key': 'PRODUCTIONORDER:ISSUE', 'group': 'production'},
    {'key': 'production_order_receive', 'label': 'Receive production output', 'permission_key': 'PRODUCTIONORDER:RECEIVE', 'group': 'production'},
    {'key': 'production_order_cancel', 'label': 'Cancel production order', 'permission_key': 'PRODUCTIONORDER:CANCEL', 'group': 'production'},
    {'key': 'sales_order_submit', 'label': 'Submit sales order', 'permission_key': 'SALESORDER:SUBMIT', 'group': 'sales'},
    {'key': 'sales_order_approve', 'label': 'Approve sales order', 'permission_key': 'SALESORDER:APPROVE', 'group': 'sales'},
    {'key': 'sales_order_reject', 'label': 'Reject sales order', 'permission_key': 'SALESORDER:REJECT', 'group': 'sales'},
    {'key': 'sales_order_post', 'label': 'Post sales order', 'permission_key': 'SALESORDER:POST', 'group': 'sales'},
    {'key': 'sales_order_void', 'label': 'Void sales order', 'permission_key': 'SALESORDER:VOID', 'group': 'sales'},
]


def _get_user_permission_keys(user):
    permissions = set()
    try:
        roles = user.roles.prefetch_related('permissions').all()
    except Exception:
        return []
    for role in roles:
        for perm in _get_prefetched_role_permissions(role):
            resource = str(getattr(perm, 'resource', '') or '').strip().upper()
            action = str(getattr(perm, 'action', '') or '').strip().upper()
            if resource and action:
                permissions.add(f'{resource}:{action}')
    return sorted(permissions)


def _build_access_capability_map(user):
    return {
        'sales_orders': _can_access_sales_orders(user),
        'purchasing': _can_manage_purchasing_data(user),
        'production': _can_access_production_center(user),
        'production_planning': _can_manage_production_data(user),
        'inventory': _can_manage_inventory_data(user),
        'stocktake': _can_manage_stocktake(user),
        'ops_hub': _can_view_ops_hub(user),
        'reports': _can_view_reports_center(user),
        'workflow_view': _can_view_workflow(user),
        'workflow_manage': _can_manage_workflow(user),
        'operations_log': _can_view_operations_log(user),
        'finance': _can_manage_finance_data(user),
        'workforce': _can_manage_workforce_data(user),
        'module_permission_history': _can_view_rbac_audit(user),
        'module_permission_settings': _can_manage_module_permissions(user),
        'role_team_governance': _can_manage_module_permissions(user),
        'onboarding': _can_manage_module_permissions(user),
        'user_provisioning': _can_manage_module_permissions(user),
        'user_lifecycle': _can_manage_module_permissions(user),
        'user_access_reviews': _can_manage_module_permissions(user),
        'user_access_exceptions': _can_manage_module_permissions(user),
        'user_directory': _can_manage_user_directory(user),
        'access_governance': _can_view_access_governance_center(user),
        'approval_control_tower': _can_view_approval_control_tower(user),
        'admin_observability': _can_view_admin_observability(user),
        'admin_audit': _can_view_admin_audit(user),
    }


def _build_access_surface_matrix_payload(user):
    capability_map = _build_access_capability_map(user)
    permission_keys = set(_get_user_permission_keys(user))
    route_rows = []
    api_rows = []
    critical_action_rows = []
    for row in ACCESS_SURFACE_ROUTE_DEFINITIONS:
        route_rows.append({
            **row,
            'allowed': bool(capability_map.get(row['capability'], False)),
        })
    for row in ACCESS_SURFACE_API_DEFINITIONS:
        api_rows.append({
            **row,
            'allowed': bool(capability_map.get(row['capability'], False)),
        })
    for row in ACCESS_SURFACE_CRITICAL_ACTION_DEFINITIONS:
        critical_action_rows.append({
            **row,
            'allowed': bool(user.is_superuser or row['permission_key'] in permission_keys),
        })
    allowed_route_count = len([row for row in route_rows if row['allowed']])
    allowed_api_count = len([row for row in api_rows if row['allowed']])
    allowed_critical_action_count = len([row for row in critical_action_rows if row['allowed']])
    return {
        'user': {
            'id': int(user.id),
            'username': user.username,
            'full_name': user.get_full_name(),
            'email': user.email,
            'is_staff': bool(user.is_staff),
            'is_superuser': bool(user.is_superuser),
        },
        'role_names': sorted(_user_role_names(user)),
        'permission_keys': sorted(permission_keys),
        'capabilities': capability_map,
        'frontend_routes': route_rows,
        'api_surfaces': api_rows,
        'critical_actions': critical_action_rows,
        'summary': {
            'allowed_route_count': allowed_route_count,
            'blocked_route_count': len(route_rows) - allowed_route_count,
            'allowed_api_surface_count': allowed_api_count,
            'blocked_api_surface_count': len(api_rows) - allowed_api_count,
            'allowed_critical_action_count': allowed_critical_action_count,
            'blocked_critical_action_count': len(critical_action_rows) - allowed_critical_action_count,
        },
        'generated_at': django_timezone.now(),
    }


def _get_admin_monitoring_payload(hours=24):
    safe_hours = max(1, min(int(hours or 24), 168))
    return {
        'backup': get_backup_inventory_payload(),
        'email_delivery': get_email_delivery_health_payload(hours=safe_hours),
        'alert_channels': get_alert_channel_status_payload(),
        'alert_readiness': get_alert_readiness_payload(hours=safe_hours),
        'alert_delivery': get_alert_delivery_health_payload(hours=max(24, safe_hours)),
        'alert_drill': {
            'recommended_command': 'python manage.py send_test_alert --json',
        },
        'database': {
            'slow_query_threshold_ms': int(getattr(settings, 'DB_SLOW_QUERY_THRESHOLD_MS', 0) or 0),
        },
        'performance': get_performance_readiness_payload(),
        'release_hygiene': get_release_hygiene_payload(),
        'go_live_handoff': {
            'recommended_command': 'python manage.py go_live_handoff --environment staging --json',
        },
        'incident_response': {
            'runbook_url': str(getattr(settings, 'INCIDENT_RUNBOOK_URL', '') or ''),
            'contacts': list(getattr(settings, 'INCIDENT_CONTACT_EMAILS', []) or []),
        },
    }


def _parse_query_bool(value):
    if value is None:
        return None
    normalized = str(value).strip().lower()
    if normalized in {'true', '1', 'yes', 'y'}:
        return True
    if normalized in {'false', '0', 'no', 'n'}:
        return False
    return None


def _run_command_json_payload(*args):
    stdout = StringIO()
    call_command(*args, '--json', stdout=stdout)
    return json.loads(stdout.getvalue())


def _get_role_label(role):
    return (getattr(role, 'name', '') or getattr(role, 'code', '') or '').strip()


def _get_prefetched_role_permissions(role):
    cache_data = getattr(role, '_prefetched_objects_cache', {})
    prefetched = cache_data.get('permissions')
    if prefetched is not None:
        return prefetched
    return list(role.permissions.all())


def _get_user_permission_rows(user):
    seen = {}
    for role in user.roles.all():
        for perm in _get_prefetched_role_permissions(role):
            key = f'{str(perm.resource).upper()}:{str(perm.action).upper()}'
            if key not in seen:
                seen[key] = {
                    'key': key,
                    'resource': str(perm.resource).upper(),
                    'action': str(perm.action).upper(),
                    'code': str(perm.code or ''),
                    'name': str(perm.name or key),
                }
    return list(seen.values())


def _get_prefetched_user_relation_rows(user, relation_name):
    cache_data = getattr(user, '_prefetched_objects_cache', {})
    prefetched = cache_data.get(relation_name)
    if prefetched is not None:
        return list(prefetched)
    relation = getattr(user, relation_name)
    return list(relation.all())


def _serialize_access_relation_rows(items):
    rows = []
    for item in items:
        rows.append({
            'id': item.id,
            'code': item.code,
            'name': item.name,
        })
    return rows


def _build_user_access_snapshot(user):
    role_rows = _get_prefetched_user_relation_rows(user, 'roles')
    team_rows = _get_prefetched_user_relation_rows(user, 'teams')
    return {
        'roles': _serialize_access_relation_rows(role_rows),
        'role_ids': [item.id for item in role_rows],
        'teams': _serialize_access_relation_rows(team_rows),
        'team_ids': [item.id for item in team_rows],
    }


def _get_profile_completion(user):
    checks = [
        ('first_name', 'Ho'),
        ('last_name', 'Ten'),
        ('email', 'Email'),
        ('phone', 'So dien thoai'),
        ('roles', 'Vai tro'),
        ('teams', 'Nhom'),
    ]
    missing_fields = []
    completed_fields = 0
    for field, label in checks:
        if field == 'roles':
            has_value = user.roles.exists()
        elif field == 'teams':
            has_value = user.teams.exists()
        else:
            has_value = bool(getattr(user, field, '') or '')
        if has_value:
            completed_fields += 1
        else:
            missing_fields.append(label)
    total_fields = len(checks)
    score = int(round((completed_fields / total_fields) * 100)) if total_fields else 100
    return {
        'score': score,
        'completed_fields': completed_fields,
        'total_fields': total_fields,
        'missing_fields': missing_fields,
    }


def _get_security_summary(user, current_session=None):
    now = django_timezone.now()
    sessions = list(UserSession.objects.filter(user=user).order_by('-is_active', '-last_active', '-login_at'))
    active_sessions = [session for session in sessions if session.is_active]
    current_session_key = str(current_session.session_key) if current_session else ''
    other_active_sessions = [session for session in active_sessions if str(session.session_key) != current_session_key]
    stale_cutoff = now - timedelta(days=14)
    stale_sessions = [session for session in active_sessions if session.last_active and session.last_active < stale_cutoff]
    unique_ip_count = len({session.ip_address for session in active_sessions if session.ip_address})

    score = 0
    if user.email:
        score += 20
    if user.phone:
        score += 15
    if current_session:
        score += 20
    if len(other_active_sessions) == 0:
        score += 20
    elif len(other_active_sessions) <= 2:
        score += 10
    if unique_ip_count <= 1:
        score += 15
    elif unique_ip_count == 2:
        score += 8
    if not stale_sessions:
        score += 10

    recommendations = []
    if not user.phone:
        recommendations.append('Bo sung so dien thoai de doi van hanh lien he khi co su co tai khoan.')
    if other_active_sessions:
        recommendations.append('Ra soat va thu hoi cac phien dang nhap khong con su dung.')
    if stale_sessions:
        recommendations.append('Phat hien phien dang nhap da lau khong hoat dong, nen thu hoi de giam rui ro.')
    if unique_ip_count > 2:
        recommendations.append('Tai khoan dang xuat hien tren nhieu dia chi IP, can xac minh thiet bi dang su dung.')
    if not recommendations:
        recommendations.append('Trang thai bao mat dang on dinh, tiep tuc doi mat khau dinh ky va giu email canh bao hoat dong.')

    if score >= 80:
        level = 'good'
    elif score >= 60:
        level = 'warning'
    else:
        level = 'critical'

    current_browser = current_session.device_info.get('browser', 'Khong ro') if current_session else 'Khong ro'
    current_os = current_session.device_info.get('os', 'Khong ro') if current_session else 'Khong ro'

    return {
        'score': min(score, 100),
        'level': level,
        'active_sessions': len(active_sessions),
        'other_active_sessions': len(other_active_sessions),
        'unique_ip_count': unique_ip_count,
        'stale_session_count': len(stale_sessions),
        'last_login_at': current_session.login_at if current_session else None,
        'current_browser': current_browser,
        'current_operating_system': current_os,
        'recommendations': recommendations,
    }


def _get_work_summary(user):
    open_statuses = [Task.STATUS_TODO, Task.STATUS_IN_PROGRESS]
    today = django_timezone.localdate()
    queryset = Task.objects.filter(assigned_to=user)
    counts = queryset.aggregate(
        open_tasks=Count('id', filter=models.Q(status__in=open_statuses)),
        in_progress_tasks=Count('id', filter=models.Q(status=Task.STATUS_IN_PROGRESS)),
        overdue_tasks=Count('id', filter=models.Q(status__in=open_statuses, due_date__lt=today)),
        needs_help_tasks=Count('id', filter=models.Q(status__in=open_statuses, needs_help=True)),
        high_priority_tasks=Count('id', filter=models.Q(status__in=open_statuses, priority__in=[Task.PRIORITY_HIGH, Task.PRIORITY_URGENT])),
        blocking_tasks=Count('id', filter=models.Q(status__in=open_statuses, is_blocking=True)),
    )
    preview_rows = []
    preview_qs = (
        queryset
        .filter(status__in=open_statuses)
        .order_by('-is_pinned', 'due_date', '-created_at')[:5]
    )
    for task in preview_qs:
        preview_rows.append({
            'id': task.id,
            'title': task.title,
            'entity_type': task.entity_type,
            'entity_code': task.entity_code,
            'status': task.status,
            'status_display': task.get_status_display(),
            'priority': task.priority,
            'priority_display': task.get_priority_display(),
            'due_date': task.due_date,
            'needs_help': bool(task.needs_help),
            'is_blocking': bool(task.is_blocking),
            'route': '/task-inbox',
        })
    return {
        **counts,
        'preview': preview_rows,
    }


def _get_notification_summary(user):
    queryset = Notification.objects.filter(recipient=user).order_by('-created_at', '-id')
    unread_qs = queryset.filter(is_read=False)
    return {
        'unread_count': unread_qs.count(),
        'important_unread_count': unread_qs.filter(notification_type__in=ACCOUNT_IMPORTANT_NOTIFICATION_TYPES).count(),
        'recent_7d_count': queryset.filter(created_at__gte=django_timezone.now() - timedelta(days=7)).count(),
        'last_unread_at': unread_qs.values_list('created_at', flat=True).first(),
    }


def _get_module_source_roles(user, module_config):
    if getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False):
        return ['Khối vận hành']
    permission_pairs = {(resource.upper(), action.upper()) for resource, action in module_config.get('permissions', [])}
    accepted_roles = {str(item).strip().lower() for item in module_config.get('role_names', set())}
    labels = []
    for role in user.roles.all():
        role_name = str(getattr(role, 'name', '') or '').strip().lower()
        role_code = str(getattr(role, 'code', '') or '').strip().lower()
        matched = role_name in accepted_roles or role_code in accepted_roles
        if not matched:
            for perm in _get_prefetched_role_permissions(role):
                key = (str(perm.resource).upper(), str(perm.action).upper())
                if key in permission_pairs:
                    matched = True
                    break
        if matched:
            label = _get_role_label(role)
            if label:
                labels.append(label)
    return labels


def _get_access_summary(user):
    permission_rows = _get_user_permission_rows(user)
    permission_keys = {row['key'] for row in permission_rows}
    modules = []
    matcher_map = {
        '_can_access_sales_orders': _can_access_sales_orders,
        '_can_access_inventory_hub': _can_access_inventory_hub,
        '_can_manage_purchasing_data': _can_manage_purchasing_data,
        '_can_access_production_center': _can_access_production_center,
        '_can_manage_production_data': _can_manage_production_data,
        '_can_manage_workforce_data': _can_manage_workforce_data,
        '_can_manage_finance_data': _can_manage_finance_data,
        '_can_view_workflow': _can_view_workflow,
        '_can_view_reports_center': _can_view_reports_center,
        '_can_view_ops_hub': _can_view_ops_hub,
        '_can_access_governance_hub': _can_access_governance_hub,
    }
    for module in ACCOUNT_ACCESS_MODULES:
        matcher = matcher_map[module['matcher']]
        matched_permissions = []
        for resource, action in module.get('permissions', []):
            key = f'{str(resource).upper()}:{str(action).upper()}'
            if key in permission_keys:
                matched_permissions.append(key)
        enabled = matcher(user)
        route = module['primary_route']
        if module['key'] == 'governance':
            if _can_manage_module_permissions(user):
                route = '/admin/module-permissions'
            elif _can_view_rbac_audit(user):
                route = '/admin/module-permissions-history'
            else:
                route = '/operations-log'
        modules.append({
            'key': module['key'],
            'label': module['label'],
            'description': module['description'],
            'enabled': enabled,
            'primary_route': route,
            'matched_permissions': matched_permissions,
            'source_roles': _get_module_source_roles(user, module),
        })
    roles = []
    for role in user.roles.all():
        roles.append({
            'id': role.id,
            'code': role.code,
            'name': role.name,
            'permission_count': len(_get_prefetched_role_permissions(role)),
        })
    teams = [
        {
            'id': team.id,
            'code': team.code,
            'name': team.name,
        }
        for team in user.teams.all()
    ]
    return {
        'enabled_module_count': len([item for item in modules if item['enabled']]),
        'permission_count': len(permission_rows),
        'top_permissions': permission_rows[:12],
        'modules': modules,
        'roles': roles,
        'teams': teams,
    }


def _get_notification_route(notification):
    route = ACCOUNT_ENTITY_ROUTE_MAP.get(str(notification.entity_type or ''))
    if route:
        return route
    return '/notifications'


def _get_audit_route(log):
    route = ACCOUNT_ENTITY_ROUTE_MAP.get(str(log.entity_type or ''))
    if route:
        return route
    return '/account'


def _build_account_activity_items(user, limit=15, kind='all'):
    safe_limit = max(1, min(int(limit or 15), 50))
    selected_kind = str(kind or 'all').strip().lower()
    if selected_kind not in {'all', 'notification', 'audit', 'session'}:
        selected_kind = 'all'

    items = []
    source_limit = max(safe_limit * 2, 10)

    if selected_kind in {'all', 'notification'}:
        notifications = (
            Notification.objects
            .filter(recipient=user)
            .order_by('-created_at', '-id')[:source_limit]
        )
        for notification in notifications:
            tone = 'warning' if (not notification.is_read and notification.notification_type in ACCOUNT_IMPORTANT_NOTIFICATION_TYPES) else 'info'
            if notification.is_read:
                tone = 'default'
            items.append({
                'id': f'notification-{notification.id}',
                'kind': 'notification',
                'kind_label': 'Thông báo',
                'timestamp': notification.created_at,
                'title': notification.title,
                'summary': notification.message,
                'status': 'unread' if not notification.is_read else 'read',
                'tone': tone,
                'route': _get_notification_route(notification),
                'meta': {
                    'notification_type': notification.notification_type,
                    'entity_type': notification.entity_type,
                    'entity_id': notification.entity_id,
                    'actor_username': notification.actor.username if notification.actor else '',
                },
            })

    if selected_kind in {'all', 'audit'}:
        logs = (
            AuditLog.objects
            .filter(user=user)
            .order_by('-created_at', '-id')[:source_limit]
        )
        for log in logs:
            changed_fields = ', '.join((log.changed_fields or [])[:3])
            summary = log.entity_code or log.entity_id_str or str(log.entity_id)
            if changed_fields:
                summary = f'{summary} · Truong thay doi: {changed_fields}'
            items.append({
                'id': f'audit-{log.id}',
                'kind': 'audit',
                'kind_label': 'Hoạt động',
                'timestamp': log.created_at,
                'title': f'{log.get_action_display()} {log.entity_type}',
                'summary': summary,
                'status': str(log.action or '').lower(),
                'tone': 'success' if log.action in {'APPROVE', 'POST', 'ACTIVATE'} else 'info',
                'route': _get_audit_route(log),
                'meta': {
                    'entity_type': log.entity_type,
                    'entity_id': log.entity_id,
                    'entity_code': log.entity_code,
                    'action': log.action,
                },
            })

    if selected_kind in {'all', 'session'}:
        sessions = (
            UserSession.objects
            .filter(user=user)
            .order_by('-last_active', '-login_at')[:source_limit]
        )
        for session in sessions:
            event_time = session.logout_at or session.last_active or session.login_at
            is_closed = not session.is_active
            browser = session.device_info.get('browser', 'Không rõ')
            operating_system = session.device_info.get('os', 'Không rõ')
            items.append({
                'id': f'session-{session.id}',
                'kind': 'session',
                'kind_label': 'Bảo mật',
                'timestamp': event_time,
                'title': f'Phiên đăng nhập trên {browser}',
                'summary': f'{operating_system} · {session.ip_address}',
                'status': 'revoked' if is_closed else 'active',
                'tone': 'default' if is_closed else 'processing',
                'route': '/account',
                'meta': {
                    'browser': browser,
                    'operating_system': operating_system,
                    'ip_address': session.ip_address,
                    'login_at': session.login_at,
                    'last_active': session.last_active,
                    'logout_at': session.logout_at,
                },
            })

    fallback_time = django_timezone.make_aware(datetime(1970, 1, 1))
    items.sort(key=lambda item: item['timestamp'] or fallback_time, reverse=True)
    return items[:safe_limit]


def _annotate_user_directory_queryset(queryset):
    active_session_count_subquery = (
        UserSession.objects
        .filter(user=OuterRef('pk'), is_active=True)
        .values('user')
        .annotate(cnt=Count('id'))
        .values('cnt')[:1]
    )
    latest_seen_subquery = (
        UserSession.objects
        .filter(user=OuterRef('pk'))
        .order_by('-last_active', '-login_at')
        .values('last_active')[:1]
    )
    latest_login_subquery = (
        UserSession.objects
        .filter(user=OuterRef('pk'))
        .order_by('-login_at')
        .values('login_at')[:1]
    )
    latest_ip_subquery = (
        UserSession.objects
        .filter(user=OuterRef('pk'))
        .order_by('-last_active', '-login_at')
        .values('ip_address')[:1]
    )
    return queryset.annotate(
        active_session_count=Coalesce(Subquery(active_session_count_subquery, output_field=IntegerField()), 0),
        last_seen_at=Subquery(latest_seen_subquery, output_field=DateTimeField()),
        last_login_at=Subquery(latest_login_subquery, output_field=DateTimeField()),
        last_seen_ip=Subquery(latest_ip_subquery, output_field=models.CharField(max_length=64)),
    )


def _get_user_directory_attention_reasons(user, dormant_cutoff=None):
    dormant_cutoff = dormant_cutoff or (django_timezone.now() - timedelta(days=30))
    reasons = []
    if getattr(user, 'is_locked', False):
        reasons.append('Tai khoan dang bi khoa')
    if not getattr(user, 'is_active', True):
        reasons.append('Tai khoan dang tam ngung')

    role_rows = _get_prefetched_user_relation_rows(user, 'roles')
    team_rows = _get_prefetched_user_relation_rows(user, 'teams')
    if not role_rows:
        reasons.append('Chua gan vai tro')
    if not team_rows:
        reasons.append('Chua gan nhom')

    active_session_count = int(getattr(user, 'active_session_count', 0) or 0)
    if active_session_count >= 4:
        reasons.append('Dang mo nhieu phien dang nhap')

    last_seen_at = getattr(user, 'last_seen_at', None)
    if last_seen_at is None or last_seen_at < dormant_cutoff:
        reasons.append('Khong hoat dong gan day')

    return reasons


def _build_user_directory_attention_preview(queryset, limit=6):
    dormant_cutoff = django_timezone.now() - timedelta(days=30)
    preview_rows = []
    for user in list(queryset[:80]):
        reasons = _get_user_directory_attention_reasons(user, dormant_cutoff=dormant_cutoff)
        if not reasons:
            continue
        score = 0
        if getattr(user, 'is_locked', False):
            score += 120
        if not getattr(user, 'is_active', True):
            score += 80
        if 'Chua gan vai tro' in reasons:
            score += 55
        if 'Chua gan nhom' in reasons:
            score += 35
        if 'Dang mo nhieu phien dang nhap' in reasons:
            score += 20
        if 'Khong hoat dong gan day' in reasons:
            score += 15

        preview_rows.append({
            'id': user.id,
            'username': user.username,
            'full_name': user.get_full_name() or user.username,
            'email': user.email,
            'is_active': bool(user.is_active),
            'is_locked': bool(user.is_locked),
            'active_session_count': int(getattr(user, 'active_session_count', 0) or 0),
            'last_seen_at': getattr(user, 'last_seen_at', None),
            'role_count': len(_get_prefetched_user_relation_rows(user, 'roles')),
            'team_count': len(_get_prefetched_user_relation_rows(user, 'teams')),
            'reasons': reasons,
            'severity': 'error' if (user.is_locked or not user.is_active) else 'warning',
            'route': '/admin/users',
            'score': score,
        })

    preview_rows.sort(
        key=lambda item: (
            item['score'],
            item['active_session_count'],
            item['last_seen_at'] or django_timezone.make_aware(datetime(1970, 1, 1)),
        ),
        reverse=True,
    )
    return preview_rows[:max(1, min(int(limit or 6), 12))]


def _create_user_access_audit_log(request, actor, target_user, old_snapshot, new_snapshot, changed_fields, strategy='replace'):
    AuditLog.objects.create(
        user=actor,
        action='UPDATE',
        entity_type='UserAccess',
        entity_id=target_user.id,
        entity_id_str=target_user.username,
        entity_code=target_user.username,
        old_values={
            **old_snapshot,
            'strategy': strategy,
        },
        new_values={
            **new_snapshot,
            'strategy': strategy,
        },
        changed_fields=changed_fields,
        ip_address=_get_request_ip(request) if request is not None else None,
        user_agent=((request.META.get('HTTP_USER_AGENT') or '')[:500] if request is not None else ''),
    )


def _build_user_access_activity_items(queryset, limit=10):
    safe_limit = max(1, min(int(limit or 10), 50))
    logs = list(queryset.order_by('-created_at', '-id')[:safe_limit])
    target_ids = {log.entity_id for log in logs if log.entity_type == 'UserAccess' and log.entity_id}
    target_users = {
        user.id: user
        for user in User.objects.filter(id__in=target_ids)
    }
    items = []
    for log in logs:
        old_values = log.old_values or {}
        new_values = log.new_values or {}
        target_user = target_users.get(log.entity_id)
        changed_fields = [str(field) for field in (log.changed_fields or [])]
        change_labels = []
        if 'roles' in changed_fields:
            change_labels.append('vai tro')
        if 'teams' in changed_fields:
            change_labels.append('nhom')
        summary = 'Cap nhat truy cap nguoi dung'
        if change_labels:
            summary = f'Cap nhat {", ".join(change_labels)}'

        items.append({
            'id': log.id,
            'timestamp': log.created_at,
            'summary': summary,
            'changed_fields': changed_fields,
            'strategy': new_values.get('strategy') or old_values.get('strategy') or 'replace',
            'actor': {
                'id': log.user_id,
                'username': log.user.username if log.user else '',
                'full_name': log.user.get_full_name() if log.user else '',
            },
            'target_user': {
                'id': target_user.id if target_user else log.entity_id,
                'username': target_user.username if target_user else log.entity_code,
                'full_name': target_user.get_full_name() if target_user else log.entity_code,
            },
            'roles_before': old_values.get('roles', []),
            'roles_after': new_values.get('roles', []),
            'teams_before': old_values.get('teams', []),
            'teams_after': new_values.get('teams', []),
        })
    return items


def _serialize_permission_rows(permission_rows):
    rows = []
    for permission in permission_rows:
        rows.append({
            'id': permission.id,
            'code': str(permission.code or ''),
            'name': str(permission.name or permission.code or ''),
            'resource': str(permission.resource or '').upper(),
            'action': str(permission.action or '').upper(),
        })
    rows.sort(key=lambda item: (item['resource'], item['action'], item['code']))
    return rows


def _get_role_governance_module_keys(permission_rows):
    keys = []
    for permission in permission_rows:
        key = ROLE_GOVERNANCE_MODULE_KEY_LOOKUP.get(
            (str(permission.resource or '').upper(), str(permission.action or '').upper())
        )
        if key and key not in keys:
            keys.append(key)
    return keys


def _serialize_role_snapshot(role):
    permission_rows = _get_prefetched_role_permissions(role)
    serialized_permissions = _serialize_permission_rows(permission_rows)
    return {
        'id': role.id,
        'code': str(role.code or ''),
        'name': str(role.name or ''),
        'description': str(role.description or ''),
        'is_active': bool(role.is_active),
        'sort_order': int(role.sort_order or 0),
        'permission_ids': [item['id'] for item in serialized_permissions],
        'permission_codes': [item['code'] for item in serialized_permissions],
        'permissions': serialized_permissions,
        'module_keys': _get_role_governance_module_keys(permission_rows),
        'user_count': int(getattr(role, 'user_count', role.users.count()) or 0),
        'active_user_count': int(getattr(role, 'active_user_count', role.users.filter(is_active=True).count()) or 0),
    }


def _serialize_team_snapshot(team):
    return {
        'id': team.id,
        'code': str(team.code or ''),
        'name': str(team.name or ''),
        'description': str(team.description or ''),
        'is_active': bool(team.is_active),
        'sort_order': int(team.sort_order or 0),
        'user_count': int(getattr(team, 'user_count', team.users.count()) or 0),
        'active_user_count': int(getattr(team, 'active_user_count', team.users.filter(is_active=True).count()) or 0),
        'locked_user_count': int(getattr(team, 'locked_user_count', team.users.filter(is_locked=True).count()) or 0),
    }


def _get_snapshot_changed_fields(old_snapshot, new_snapshot):
    return [
        key
        for key in new_snapshot.keys()
        if old_snapshot.get(key) != new_snapshot.get(key)
    ]


def _create_catalog_audit_log(request, actor, action, entity_type, entity_id, entity_code, old_values, new_values, changed_fields):
    AuditLog.objects.create(
        user=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_id_str=str(entity_id),
        entity_code=str(entity_code or ''),
        old_values=old_values,
        new_values=new_values,
        changed_fields=changed_fields,
        ip_address=_get_request_ip(request),
        user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
    )


def _annotate_role_governance_queryset(queryset):
    role_activity_queryset = (
        AuditLog.objects
        .filter(entity_type='Role', entity_id=OuterRef('id'))
        .order_by('-created_at', '-id')
    )
    return (
        queryset
        .filter(deleted_at__isnull=True)
        .prefetch_related('permissions')
        .annotate(
            user_count=Count('users', distinct=True),
            active_user_count=Count('users', filter=models.Q(users__is_active=True), distinct=True),
            permission_count=Count('permissions', distinct=True),
            last_activity_at=Subquery(
                role_activity_queryset.values('created_at')[:1],
                output_field=DateTimeField(),
            ),
            last_activity_action=Subquery(
                role_activity_queryset.values('action')[:1],
                output_field=models.CharField(),
            ),
        )
    )


def _annotate_team_governance_queryset(queryset):
    team_activity_queryset = (
        AuditLog.objects
        .filter(entity_type='Team', entity_id=OuterRef('id'))
        .order_by('-created_at', '-id')
    )
    return (
        queryset
        .filter(deleted_at__isnull=True)
        .annotate(
            user_count=Count('users', distinct=True),
            active_user_count=Count('users', filter=models.Q(users__is_active=True), distinct=True),
            locked_user_count=Count('users', filter=models.Q(users__is_locked=True), distinct=True),
            last_activity_at=Subquery(
                team_activity_queryset.values('created_at')[:1],
                output_field=DateTimeField(),
            ),
            last_activity_action=Subquery(
                team_activity_queryset.values('action')[:1],
                output_field=models.CharField(),
            ),
        )
    )


def _build_role_governance_templates():
    requested_pairs = {
        (str(resource).upper(), str(action).upper())
        for template in ROLE_GOVERNANCE_TEMPLATE_DEFINITIONS
        for resource, action in template['permission_pairs']
    }
    permission_queryset = Permission.objects.none()
    if requested_pairs:
        query = models.Q()
        for resource, action in requested_pairs:
            query |= models.Q(resource=resource, action=action)
        permission_queryset = Permission.objects.filter(query)
    permission_map = {
        (str(permission.resource).upper(), str(permission.action).upper()): permission
        for permission in permission_queryset
    }
    items = []
    for template in ROLE_GOVERNANCE_TEMPLATE_DEFINITIONS:
        permission_rows = []
        missing_pairs = []
        for resource, action in template['permission_pairs']:
            permission = permission_map.get((str(resource).upper(), str(action).upper()))
            if permission is None:
                missing_pairs.append(f'{resource}:{action}')
                continue
            permission_rows.append(permission)
        items.append({
            'key': template['key'],
            'name': template['name'],
            'description': template['description'],
            'tone': template['tone'],
            'focus_modules': template['focus_modules'],
            'permission_ids': [permission.id for permission in permission_rows],
            'permissions': _serialize_permission_rows(permission_rows),
            'missing_permissions': missing_pairs,
        })
    return items


def _build_governance_watchlist(role_rows, team_rows):
    items = []
    for role in role_rows:
        if role['user_count'] == 0:
            items.append({
                'kind': 'role',
                'severity': 'warning',
                'title': f"Role {role['code']} chua duoc gan",
                'description': f"Vai tro {role['name']} chua co user nao su dung.",
                'entity_id': role['id'],
                'route': '/admin/roles-teams',
            })
        if role['is_active'] and role['permission_count'] == 0:
            items.append({
                'kind': 'role',
                'severity': 'error',
                'title': f"Role {role['code']} chua co permission",
                'description': 'Vai tro dang hoat dong nhung chua co quyen nao duoc cap.',
                'entity_id': role['id'],
                'route': '/admin/roles-teams',
            })
    for team in team_rows:
        if team['user_count'] == 0:
            items.append({
                'kind': 'team',
                'severity': 'warning',
                'title': f"Nhom {team['code']} dang trong",
                'description': 'Nhom hien chua co thanh vien nao.',
                'entity_id': team['id'],
                'route': '/admin/roles-teams',
            })
    users_without_role = User.objects.filter(is_active=True, roles__isnull=True).distinct().count()
    if users_without_role:
        items.append({
            'kind': 'user',
            'severity': 'error',
            'title': f'{users_without_role} user dang thieu role',
            'description': 'Can bo sung role de tranh loi phan quyen va audit.',
            'entity_id': 0,
            'route': '/admin/users',
        })
    users_without_team = User.objects.filter(is_active=True, teams__isnull=True).distinct().count()
    if users_without_team:
        items.append({
            'kind': 'user',
            'severity': 'warning',
            'title': f'{users_without_team} user dang thieu team',
            'description': 'Can gan team de du lieu va workflow di dung scope.',
            'entity_id': 0,
            'route': '/admin/users',
        })
    return items[:10]


def _build_governance_activity_items(queryset, limit=20):
    safe_limit = max(1, min(int(limit or 20), 60))
    logs = list(queryset.order_by('-created_at', '-id')[:safe_limit])
    items = []
    for log in logs:
        entity_type = str(log.entity_type or '')
        kind = 'catalog'
        kind_label = 'Danh muc'
        route = '/admin/roles-teams'
        summary = str(log.entity_code or entity_type or 'Governance')
        severity = 'default'
        if entity_type == 'Role':
            kind = 'role'
            kind_label = 'Vai tro'
            summary = f"{'Tao' if log.action == 'CREATE' else 'Cap nhat' if log.action == 'UPDATE' else 'Luu'} role {log.entity_code}"
            if log.action == 'DELETE':
                summary = f'Luu tru role {log.entity_code}'
            elif log.action == 'ACTIVATE':
                summary = f'Kich hoat role {log.entity_code}'
            elif log.action == 'DEACTIVATE':
                summary = f'Tam dung role {log.entity_code}'
        elif entity_type == 'Team':
            kind = 'team'
            kind_label = 'Nhom'
            summary = f"{'Tao' if log.action == 'CREATE' else 'Cap nhat' if log.action == 'UPDATE' else 'Luu'} nhom {log.entity_code}"
            if log.action == 'DELETE':
                summary = f'Luu tru nhom {log.entity_code}'
            elif log.action == 'ACTIVATE':
                summary = f'Kich hoat nhom {log.entity_code}'
            elif log.action == 'DEACTIVATE':
                summary = f'Tam dung nhom {log.entity_code}'
        elif entity_type == 'UserAccess':
            kind = 'assignment'
            kind_label = 'Gan quyen'
            route = '/admin/users'
            summary = f'Dieu chinh truy cap cho {log.entity_code}'
            severity = 'processing'
        elif entity_type == 'RoleModulePermission':
            kind = 'module'
            kind_label = 'Quyen module'
            route = '/admin/module-permissions'
            changed_count = len((log.new_values or {}).get('items', [])) if isinstance(log.new_values, dict) else 0
            summary = f'Cap nhat quyen module cho {changed_count or 1} vai tro'
            severity = 'warning'
        items.append({
            'id': log.id,
            'timestamp': log.created_at,
            'kind': kind,
            'kind_label': kind_label,
            'action': log.action,
            'summary': summary,
            'severity': severity,
            'route': route,
            'changed_fields': log.changed_fields or [],
            'entity_type': entity_type,
            'entity_id': log.entity_id,
            'entity_code': log.entity_code,
            'actor': {
                'id': log.user_id,
                'username': log.user.username if log.user else '',
                'full_name': log.user.get_full_name() if log.user else '',
            },
            'old_values': log.old_values or {},
            'new_values': log.new_values or {},
        })
    return items


def _get_onboarding_preset_entity_id(preset_key):
    return int(uuid.uuid5(uuid.NAMESPACE_DNS, f'erp-carton-onboarding-{preset_key}').int % 1_000_000_000)


def _serialize_onboarding_preset_storage(preset):
    return {
        'key': str(preset.get('key') or ''),
        'name': str(preset.get('name') or ''),
        'description': str(preset.get('description') or ''),
        'is_active': bool(preset.get('is_active', True)),
        'tone': str(preset.get('tone') or 'blue'),
        'access_strategy': str(preset.get('access_strategy') or 'merge'),
        'role_ids': [int(value) for value in preset.get('role_ids', [])],
        'team_ids': [int(value) for value in preset.get('team_ids', [])],
        'workflow_template_ids': [int(value) for value in preset.get('workflow_template_ids', [])],
        'task_owner_mode': str(preset.get('task_owner_mode') or 'target_user'),
        'checklist': [str(item) for item in preset.get('checklist', [])],
        'email_notifications_enabled': bool(preset.get('email_notifications_enabled', True)),
        'email_notification_types': [str(item) for item in preset.get('email_notification_types', [])],
    }


def _load_onboarding_presets():
    setting = (
        Setting.objects
        .filter(key=USER_ONBOARDING_PRESETS_SETTING_KEY)
        .only('value')
        .first()
    )
    if setting is None or not str(setting.value or '').strip():
        return []
    try:
        raw_value = json.loads(setting.value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    if not isinstance(raw_value, list):
        return []

    presets = []
    for item in raw_value:
        if not isinstance(item, dict):
            continue
        serializer = OnboardingPresetSerializer(data=item)
        if serializer.is_valid():
            presets.append(_serialize_onboarding_preset_storage(serializer.validated_data))
    return presets


def _save_onboarding_presets(presets):
    serialized = [
        _serialize_onboarding_preset_storage(item)
        for item in presets
        if isinstance(item, dict)
    ]
    serialized.sort(key=lambda item: (not item.get('is_active', True), str(item.get('name') or '').lower(), str(item.get('key') or '').lower()))
    Setting.objects.update_or_create(
        key=USER_ONBOARDING_PRESETS_SETTING_KEY,
        defaults={
            'value': json.dumps(serialized, ensure_ascii=False),
            'data_type': 'json',
            'description': 'Admin-managed onboarding presets for user rollout and access standardization.',
            'is_active': True,
        },
    )
    return serialized


def _serialize_onboarding_role_rows(role_rows):
    items = []
    for role in role_rows:
        permission_rows = _get_prefetched_role_permissions(role)
        items.append({
            'id': role.id,
            'code': str(role.code or ''),
            'name': str(role.name or ''),
            'is_active': bool(role.is_active),
            'permission_count': int(getattr(role, 'permission_count', len(permission_rows)) or 0),
            'user_count': int(getattr(role, 'user_count', role.users.count()) or 0),
            'module_keys': _get_role_governance_module_keys(permission_rows),
        })
    return items


def _serialize_onboarding_team_rows(team_rows):
    items = []
    for team in team_rows:
        items.append({
            'id': team.id,
            'code': str(team.code or ''),
            'name': str(team.name or ''),
            'is_active': bool(team.is_active),
            'user_count': int(getattr(team, 'user_count', team.users.count()) or 0),
            'locked_user_count': int(getattr(team, 'locked_user_count', team.users.filter(is_locked=True).count()) or 0),
        })
    return items


def _serialize_onboarding_template_rows(template_rows):
    items = []
    for template in template_rows:
        items.append({
            'id': template.id,
            'entity_type': str(template.entity_type or ''),
            'trigger': str(template.trigger or ''),
            'title_template': str(template.title_template or ''),
            'due_in_days': int(template.due_in_days or 0),
            'priority': str(template.priority or ''),
            'is_active': bool(template.is_active),
            'sort_order': int(template.sort_order or 0),
        })
    return items


def _build_onboarding_notification_type_options():
    labels = {
        'approval_request': 'Approval request',
        'approval_approved': 'Approval approved',
        'approval_rejected': 'Approval rejected',
        'assignment': 'Assignment',
        'due_date': 'Due date',
        'mention': 'Mention',
        'system': 'System update',
    }
    default_selected = {'approval_request', 'approval_rejected', 'assignment', 'due_date'}
    return [
        {
            'value': value,
            'label': labels.get(value, value.replace('_', ' ').title()),
            'default_selected': value in default_selected,
        }
        for value in USER_ONBOARDING_NOTIFICATION_TYPES
    ]


def _build_onboarding_preset_rows(presets):
    all_role_ids = sorted({role_id for preset in presets for role_id in preset.get('role_ids', [])})
    all_team_ids = sorted({team_id for preset in presets for team_id in preset.get('team_ids', [])})
    all_template_ids = sorted({template_id for preset in presets for template_id in preset.get('workflow_template_ids', [])})

    role_rows = _annotate_role_governance_queryset(Role.objects.filter(id__in=all_role_ids))
    team_rows = _annotate_team_governance_queryset(Team.objects.filter(id__in=all_team_ids))
    template_rows = WorkflowTaskTemplate.objects.filter(id__in=all_template_ids)

    role_map = {row.id: row for row in role_rows}
    team_map = {row.id: row for row in team_rows}
    template_map = {row.id: row for row in template_rows}

    items = []
    for preset in presets:
        preset_role_ids = [role_id for role_id in preset.get('role_ids', []) if role_id in role_map]
        preset_team_ids = [team_id for team_id in preset.get('team_ids', []) if team_id in team_map]
        preset_template_ids = [template_id for template_id in preset.get('workflow_template_ids', []) if template_id in template_map]

        roles = _serialize_onboarding_role_rows([role_map[role_id] for role_id in preset_role_ids])
        teams = _serialize_onboarding_team_rows([team_map[team_id] for team_id in preset_team_ids])
        workflow_templates = _serialize_onboarding_template_rows([template_map[template_id] for template_id in preset_template_ids])

        missing_role_ids = [role_id for role_id in preset.get('role_ids', []) if role_id not in role_map]
        missing_team_ids = [team_id for team_id in preset.get('team_ids', []) if team_id not in team_map]
        missing_template_ids = [template_id for template_id in preset.get('workflow_template_ids', []) if template_id not in template_map]
        inactive_role_ids = [item['id'] for item in roles if not item['is_active']]
        inactive_team_ids = [item['id'] for item in teams if not item['is_active']]
        inactive_template_ids = [item['id'] for item in workflow_templates if not item['is_active']]

        items.append({
            **_serialize_onboarding_preset_storage(preset),
            'roles': roles,
            'teams': teams,
            'workflow_templates': workflow_templates,
            'role_count': len(roles),
            'team_count': len(teams),
            'workflow_template_count': len(workflow_templates),
            'checklist_count': len(preset.get('checklist', [])),
            'missing_role_ids': missing_role_ids,
            'missing_team_ids': missing_team_ids,
            'missing_workflow_template_ids': missing_template_ids,
            'inactive_role_ids': inactive_role_ids,
            'inactive_team_ids': inactive_team_ids,
            'inactive_workflow_template_ids': inactive_template_ids,
            'has_issues': bool(
                missing_role_ids
                or missing_team_ids
                or missing_template_ids
                or inactive_role_ids
                or inactive_team_ids
                or inactive_template_ids
            ),
        })
    return items


def _build_onboarding_watchlist(preset_rows):
    items = []
    for preset in preset_rows:
        if preset['is_active'] and preset['role_count'] == 0:
            items.append({
                'severity': 'warning',
                'title': f"Preset {preset['name']} chua gan role",
                'description': 'Nen bo sung role de user moi vao dung scope phan quyen ngay tu dau.',
                'preset_key': preset['key'],
                'route': '/admin/onboarding-studio',
            })
        if preset['is_active'] and preset['team_count'] == 0:
            items.append({
                'severity': 'warning',
                'title': f"Preset {preset['name']} chua gan team",
                'description': 'Team la diem neo cho governance va task routing, nen can duoc bo sung.',
                'preset_key': preset['key'],
                'route': '/admin/onboarding-studio',
            })
        if preset['is_active'] and preset['workflow_template_count'] == 0 and preset['checklist_count'] == 0:
            items.append({
                'severity': 'error',
                'title': f"Preset {preset['name']} chua co task hoac checklist",
                'description': 'Preset dang hoat dong nhung chua co buoc ban giao nao cho nguoi dung moi.',
                'preset_key': preset['key'],
                'route': '/admin/onboarding-studio',
            })
        if preset['missing_role_ids'] or preset['missing_team_ids'] or preset['missing_workflow_template_ids']:
            items.append({
                'severity': 'error',
                'title': f"Preset {preset['name']} dang tham chieu du lieu khong ton tai",
                'description': 'Can mo preset va loai bo role, team hoac workflow template da bi xoa.',
                'preset_key': preset['key'],
                'route': '/admin/onboarding-studio',
            })
        if preset['inactive_role_ids'] or preset['inactive_team_ids'] or preset['inactive_workflow_template_ids']:
            items.append({
                'severity': 'warning',
                'title': f"Preset {preset['name']} dang dung dependency tam ngung",
                'description': 'Role, team hoac workflow template trong preset hien dang khong hoat dong.',
                'preset_key': preset['key'],
                'route': '/admin/onboarding-studio',
            })
    return items[:10]


def _build_onboarding_activity_items(queryset, limit=20):
    safe_limit = max(1, min(int(limit or 20), 60))
    logs = list(queryset.order_by('-created_at', '-id')[:safe_limit])
    items = []
    for log in logs:
        entity_type = str(log.entity_type or '')
        if entity_type == 'UserOnboardingPreset':
            preset_name = (
                ((log.new_values or {}).get('name') if isinstance(log.new_values, dict) else None)
                or ((log.old_values or {}).get('name') if isinstance(log.old_values, dict) else None)
                or str(log.entity_code or 'Preset')
            )
            summary = f"{'Tao' if log.action == 'CREATE' else 'Cap nhat' if log.action == 'UPDATE' else 'Xoa'} preset {preset_name}"
            if log.action == 'DEACTIVATE':
                summary = f'Tam dung preset {preset_name}'
            items.append({
                'id': log.id,
                'timestamp': log.created_at,
                'kind': 'preset',
                'action': log.action,
                'summary': summary,
                'route': '/admin/onboarding-studio',
                'changed_fields': log.changed_fields or [],
                'entity_code': log.entity_code,
                'actor': {
                    'id': log.user_id,
                    'username': log.user.username if log.user else '',
                    'full_name': log.user.get_full_name() if log.user else '',
                },
                'old_values': log.old_values or {},
                'new_values': log.new_values or {},
            })
            continue

        preset_name = (
            ((log.new_values or {}).get('preset_name') if isinstance(log.new_values, dict) else None)
            or ((log.new_values or {}).get('preset_key') if isinstance(log.new_values, dict) else None)
            or str(log.entity_code or 'user')
        )
        tasks_created_count = int(((log.new_values or {}).get('tasks_created_count') if isinstance(log.new_values, dict) else 0) or 0)
        summary = f"Apply preset {preset_name} cho {log.entity_code or 'user'}"
        if tasks_created_count:
            summary = f"{summary} va tao {tasks_created_count} task"
        items.append({
            'id': log.id,
            'timestamp': log.created_at,
            'kind': 'rollout',
            'action': log.action,
            'summary': summary,
            'route': '/admin/onboarding-studio',
            'changed_fields': log.changed_fields or [],
            'entity_code': log.entity_code,
            'actor': {
                'id': log.user_id,
                'username': log.user.username if log.user else '',
                'full_name': log.user.get_full_name() if log.user else '',
            },
            'old_values': log.old_values or {},
            'new_values': log.new_values or {},
        })
    return items


def _get_user_notification_preference_snapshot(user):
    preference = (
        UserPreferences.objects
        .filter(user=user, page='account-center')
        .only('config')
        .first()
    )
    config = preference.config if preference and isinstance(preference.config, dict) else {}
    selected_types = config.get('email_notification_types')
    cleaned_types = []
    if isinstance(selected_types, list):
        for value in selected_types:
            normalized = str(value or '').strip()
            if normalized and normalized not in cleaned_types:
                cleaned_types.append(normalized)
    if not cleaned_types:
        cleaned_types = sorted(ACCOUNT_IMPORTANT_NOTIFICATION_TYPES)
    return {
        'email_notifications_enabled': config.get('email_notifications_enabled') is not False,
        'email_notification_types': cleaned_types,
    }


def _build_onboarding_notification_snapshot(preset, current_snapshot):
    current_types = list(current_snapshot.get('email_notification_types') or [])
    preset_types = [
        str(value).strip()
        for value in preset.get('email_notification_types', [])
        if str(value).strip()
    ]
    if preset.get('email_notifications_enabled', True):
        return {
            'email_notifications_enabled': True,
            'email_notification_types': list(dict.fromkeys(preset_types or current_types or sorted(ACCOUNT_IMPORTANT_NOTIFICATION_TYPES))),
        }
    return {
        'email_notifications_enabled': False,
        'email_notification_types': [],
    }


def _serialize_access_rows_for_ids(model_class, ids):
    if not ids:
        return []
    queryset = model_class.objects.filter(id__in=ids)
    if model_class is Role:
        queryset = queryset.filter(deleted_at__isnull=True)
    if model_class is Team:
        queryset = queryset.filter(deleted_at__isnull=True)
    rows = list(queryset.order_by('name', 'code'))
    row_map = {
        row.id: {
            'id': row.id,
            'code': str(row.code or ''),
            'name': str(row.name or ''),
        }
        for row in rows
    }
    return [row_map[row_id] for row_id in ids if row_id in row_map]


def _resolve_onboarding_access_ids(current_ids, preset_ids, strategy):
    current_set = {int(value) for value in current_ids}
    preset_set = {int(value) for value in preset_ids}
    if str(strategy or 'merge') == 'replace':
        return sorted(preset_set)
    return sorted(current_set | preset_set)


def _build_onboarding_target_user_payload(user):
    access_snapshot = _build_user_access_snapshot(user)
    return {
        'id': user.id,
        'username': user.username,
        'full_name': user.get_full_name() or user.username,
        'email': user.email or '',
        'is_active': bool(user.is_active),
        'is_locked': bool(user.is_locked),
        'roles': access_snapshot['roles'],
        'teams': access_snapshot['teams'],
    }


def _build_onboarding_task_context(user, roles_after, teams_after):
    full_name = user.get_full_name() or user.username
    return {
        'entity_code': user.username,
        'entity_type': 'User',
        'trigger': 'MANUAL',
        'user_name': full_name,
        'full_name': full_name,
        'username': user.username,
        'email': user.email or '',
        'role_names': ', '.join(item['name'] or item['code'] for item in roles_after),
        'team_names': ', '.join(item['name'] or item['code'] for item in teams_after),
    }


def _preview_onboarding_tasks_for_user(user, preset, roles_after, teams_after):
    from .workflow_services import _interpolate, _resolve_assigned_to

    template_ids = preset.get('workflow_template_ids', [])
    templates = list(
        WorkflowTaskTemplate.objects
        .filter(id__in=template_ids)
        .order_by('sort_order', 'id')
    )
    template_map = {template.id: template for template in templates}
    ordered_templates = [template_map[template_id] for template_id in template_ids if template_id in template_map]
    context = _build_onboarding_task_context(user, roles_after, teams_after)
    today = django_timezone.now().date()
    preview_items = []
    previous_source_key = None
    for template in ordered_templates:
        source_key = f"ob-{preset['key']}-{template.id}-user-{user.id}"
        assigned_to = user if preset.get('task_owner_mode') == 'target_user' else _resolve_assigned_to(template.assign_rule)
        due_date = (today + timedelta(days=template.due_in_days)).isoformat() if template.due_in_days else None
        preview_items.append({
            'template_id': template.id,
            'template_title': str(template.title_template or ''),
            'entity_type': str(template.entity_type or ''),
            'trigger': str(template.trigger or ''),
            'title': _interpolate(template.title_template, context),
            'description': _interpolate(template.description_template, context),
            'priority': str(template.priority or ''),
            'is_blocking': bool(template.is_blocking),
            'assigned_to': assigned_to.username if assigned_to else None,
            'due_date': due_date,
            'source_key': source_key,
            'depends_on_source_key': previous_source_key if template.depends_on_previous else None,
            'would_skip': Task.objects.filter(source_key=source_key).exists(),
        })
        previous_source_key = source_key
    return preview_items


def _create_onboarding_tasks_for_user(user, preset, roles_after, teams_after, triggered_by):
    from .workflow_services import _interpolate, _resolve_assigned_to

    template_ids = preset.get('workflow_template_ids', [])
    templates = list(
        WorkflowTaskTemplate.objects
        .filter(id__in=template_ids)
        .order_by('sort_order', 'id')
    )
    template_map = {template.id: template for template in templates}
    ordered_templates = [template_map[template_id] for template_id in template_ids if template_id in template_map]
    context = _build_onboarding_task_context(user, roles_after, teams_after)
    today = django_timezone.now().date()
    created = []
    skipped = []
    previous_task = None
    for template in ordered_templates:
        source_key = f"ob-{preset['key']}-{template.id}-user-{user.id}"
        existing_task = Task.objects.filter(source_key=source_key).first()
        if existing_task is not None:
            skipped.append({
                'id': existing_task.id,
                'title': existing_task.title,
                'source_key': existing_task.source_key,
            })
            previous_task = existing_task
            continue

        assigned_to = user if preset.get('task_owner_mode') == 'target_user' else _resolve_assigned_to(template.assign_rule)
        task = Task.objects.create(
            entity_type='User',
            entity_id=user.id,
            entity_code=user.username,
            title=_interpolate(template.title_template, context),
            description=_interpolate(template.description_template, context),
            assigned_to=assigned_to,
            assigned_by=triggered_by,
            depends_on=previous_task if template.depends_on_previous else None,
            priority=template.priority,
            is_blocking=template.is_blocking,
            blocks_action=template.blocks_action or '',
            tags=list(template.tags or []),
            due_date=today + timedelta(days=template.due_in_days) if template.due_in_days else None,
            source_key=source_key,
        )
        created.append({
            'id': task.id,
            'title': task.title,
            'source_key': task.source_key,
        })
        previous_task = task
    return created, skipped


def _create_onboarding_audit_log(request, actor, action, entity_type, entity_id, entity_id_str, entity_code, old_values, new_values, changed_fields):
    AuditLog.objects.create(
        user=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_id_str=str(entity_id_str or entity_id),
        entity_code=str(entity_code or ''),
        old_values=old_values,
        new_values=new_values,
        changed_fields=changed_fields,
        ip_address=_get_request_ip(request),
        user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
    )


def _build_onboarding_studio_summary(preset_rows):
    recent_cutoff = django_timezone.now() - timedelta(days=30)
    return {
        'total_presets': len(preset_rows),
        'active_presets': sum(1 for preset in preset_rows if preset['is_active']),
        'presets_with_tasks': sum(1 for preset in preset_rows if preset['workflow_template_count'] > 0),
        'presets_with_notifications': sum(1 for preset in preset_rows if preset['email_notifications_enabled']),
        'users_without_role': User.objects.filter(is_active=True, roles__isnull=True).distinct().count(),
        'users_without_team': User.objects.filter(is_active=True, teams__isnull=True).distinct().count(),
        'applied_30d': AuditLog.objects.filter(entity_type='UserOnboarding', created_at__gte=recent_cutoff).count(),
        'tasks_created_30d': Task.objects.filter(source_key__startswith='ob-', created_at__gte=recent_cutoff).count(),
    }


def _get_access_review_campaign_entity_id(campaign_key):
    return int(uuid.uuid5(uuid.NAMESPACE_DNS, f'erp-carton-access-review-{campaign_key}').int % 1_000_000_000)


def _serialize_access_review_campaign_storage(campaign):
    return {
        'key': str(campaign.get('key') or ''),
        'name': str(campaign.get('name') or ''),
        'description': str(campaign.get('description') or ''),
        'is_active': bool(campaign.get('is_active', True)),
        'tone': str(campaign.get('tone') or 'blue'),
        'scope': str(campaign.get('scope') or 'dormant'),
        'review_action': str(campaign.get('review_action') or 'certify'),
        'role_ids': [int(value) for value in campaign.get('role_ids', [])],
        'team_ids': [int(value) for value in campaign.get('team_ids', [])],
        'inactivity_days': int(campaign.get('inactivity_days') or 30),
        'include_locked': bool(campaign.get('include_locked', False)),
        'only_active_users': bool(campaign.get('only_active_users', True)),
        'checklist': [str(item) for item in campaign.get('checklist', [])],
    }


def _load_access_review_campaigns():
    setting = (
        Setting.objects
        .filter(key=USER_ACCESS_REVIEW_CAMPAIGNS_SETTING_KEY)
        .only('value')
        .first()
    )
    if setting is None or not str(setting.value or '').strip():
        return []
    try:
        raw_value = json.loads(setting.value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    if not isinstance(raw_value, list):
        return []

    campaigns = []
    for item in raw_value:
        if not isinstance(item, dict):
            continue
        serializer = AccessReviewCampaignSerializer(data=item)
        if serializer.is_valid():
            campaigns.append(_serialize_access_review_campaign_storage(serializer.validated_data))
    return campaigns


def _save_access_review_campaigns(campaigns):
    serialized = [
        _serialize_access_review_campaign_storage(item)
        for item in campaigns
        if isinstance(item, dict)
    ]
    serialized.sort(key=lambda item: (not item.get('is_active', True), str(item.get('name') or '').lower(), str(item.get('key') or '').lower()))
    Setting.objects.update_or_create(
        key=USER_ACCESS_REVIEW_CAMPAIGNS_SETTING_KEY,
        defaults={
            'value': json.dumps(serialized, ensure_ascii=False),
            'data_type': 'json',
            'description': 'Admin-managed access review campaigns for periodic user access governance.',
            'is_active': True,
        },
    )
    return serialized


def _get_access_review_scope_meta(scope):
    scope_key = str(scope or 'dormant')
    items = {
        'all_active': {
            'label': 'Tài khoản hoạt động',
            'description': 'Rà soát toàn bộ tài khoản đang hoạt động trong hệ thống.',
        },
        'dormant': {
            'label': 'Tài khoản ngủ quên',
            'description': 'Tìm tài khoản không hoạt động gần đây để rà soát quyền đang lưu cũ.',
        },
        'privileged': {
            'label': 'Tài khoản đặc quyền',
            'description': 'Tập trung vào staff và nhóm có quyền quản trị RBAC.',
        },
        'unassigned': {
            'label': 'Tài khoản chưa gán đủ',
            'description': 'Lọc ra người dùng chưa có vai trò hoặc nhóm đầy đủ.',
        },
        'locked': {
            'label': 'Tài khoản bị khóa',
            'description': 'Rà soát tài khoản đang bị khóa nhưng còn giữ quyền hay backlog.',
        },
    }
    return items.get(scope_key, items['dormant'])


def _get_access_review_action_meta(action):
    action_key = str(action or 'certify')
    items = {
        'certify': {
            'label': 'Xác nhận quyền',
            'description': 'Chỉ ghi nhận kết quả rà soát và giữ nguyên trạng thái quyền.',
            'impact': 'Không thay đổi quyền, chỉ ghi lịch sử rà soát.',
        },
        'revoke_access': {
            'label': 'Thu hồi quyền',
            'description': 'Gỡ vai trò và nhóm của nhóm người dùng được chọn.',
            'impact': 'Thu hồi vai trò và nhóm hiện tại của tài khoản.',
        },
        'lock_account': {
            'label': 'Khóa tài khoản',
            'description': 'Khóa tài khoản để đóng vòng truy cập cho đối tượng rà soát.',
            'impact': 'Khóa tài khoản và giữ lại dữ liệu lịch sử.',
        },
    }
    return items.get(action_key, items['certify'])


def _build_access_review_scope_options():
    return [
        {'value': key, **_get_access_review_scope_meta(key)}
        for key in ['all_active', 'dormant', 'privileged', 'unassigned', 'locked']
    ]


def _build_access_review_action_options():
    items = []
    for key in ['certify', 'revoke_access', 'lock_account']:
        meta = _get_access_review_action_meta(key)
        items.append({
            'value': key,
            'label': meta['label'],
            'description': meta['description'],
            'impact': meta['impact'],
        })
    return items


def _is_privileged_user(user):
    if bool(getattr(user, 'is_staff', False)):
        return True
    for role in _get_prefetched_user_relation_rows(user, 'roles'):
        for permission in _get_prefetched_role_permissions(role):
            if str(permission.resource or '').upper() == 'CORE' and str(permission.action or '').upper() == 'MANAGE_RBAC':
                return True
    return False


def _build_access_review_queryset(campaign):
    campaign_payload = _serialize_access_review_campaign_storage(campaign)
    scope = str(campaign_payload.get('scope') or 'dormant')
    queryset = _annotate_user_directory_queryset(
        User.objects
        .filter(is_superuser=False)
        .prefetch_related('roles__permissions', 'teams')
    )

    if bool(campaign_payload.get('only_active_users', True)) or scope == 'all_active':
        queryset = queryset.filter(is_active=True)
    if not bool(campaign_payload.get('include_locked', False)) and scope != 'locked':
        queryset = queryset.filter(is_locked=False)

    role_ids = [int(item) for item in campaign_payload.get('role_ids', [])]
    team_ids = [int(item) for item in campaign_payload.get('team_ids', [])]
    if role_ids:
        queryset = queryset.filter(roles__id__in=role_ids)
    if team_ids:
        queryset = queryset.filter(teams__id__in=team_ids)

    inactivity_days = int(campaign_payload.get('inactivity_days') or 30)
    dormant_cutoff = django_timezone.now() - timedelta(days=inactivity_days)
    if scope == 'dormant':
        queryset = queryset.filter(models.Q(last_seen_at__isnull=True) | models.Q(last_seen_at__lt=dormant_cutoff))
    elif scope == 'privileged':
        queryset = queryset.filter(
            models.Q(is_staff=True)
            | models.Q(roles__permissions__resource='CORE', roles__permissions__action='MANAGE_RBAC')
        )
    elif scope == 'unassigned':
        queryset = queryset.filter(models.Q(roles__isnull=True) | models.Q(teams__isnull=True))
    elif scope == 'locked':
        queryset = queryset.filter(is_locked=True)

    return queryset.distinct().order_by('-is_staff', '-is_active', 'first_name', 'last_name', 'username')


def _resolve_access_review_target_users(campaign, selected_user_ids=None):
    queryset = _build_access_review_queryset(campaign)
    if selected_user_ids:
        queryset = queryset.filter(id__in=[int(item) for item in selected_user_ids])
    return list(queryset)


def _format_access_review_datetime(value):
    if value is None:
        return 'chua ghi nhan'
    try:
        return django_timezone.localtime(value).strftime('%d/%m/%Y %H:%M')
    except (AttributeError, ValueError, TypeError):
        return str(value)


def _build_access_review_target_rows(users, campaign):
    campaign_payload = _serialize_access_review_campaign_storage(campaign)
    scope = str(campaign_payload.get('scope') or 'dormant')
    review_action = str(campaign_payload.get('review_action') or 'certify')
    dormant_cutoff = django_timezone.now() - timedelta(days=int(campaign_payload.get('inactivity_days') or 30))
    rows = []
    for user in users:
        access_snapshot = _build_user_access_snapshot(user)
        role_count = len(access_snapshot['roles'])
        team_count = len(access_snapshot['teams'])
        active_session_count = int(getattr(user, 'active_session_count', 0) or 0)
        last_seen_at = getattr(user, 'last_seen_at', None)
        is_privileged = _is_privileged_user(user)
        is_dormant = bool(last_seen_at is None or last_seen_at < dormant_cutoff)

        reasons = []
        if scope == 'all_active':
            reasons.append('Tai khoan dang nam trong tap user hoat dong.')
        elif scope == 'dormant':
            if last_seen_at is None:
                reasons.append('Chua co dau vet hoat dong gan day.')
            else:
                reasons.append(f"Khong hoat dong tu {_format_access_review_datetime(last_seen_at)}.")
        elif scope == 'privileged':
            if getattr(user, 'is_staff', False):
                reasons.append('Tai khoan dang la staff.')
            if is_privileged and not getattr(user, 'is_staff', False):
                reasons.append('Tai khoan dang so huu quyen quan tri RBAC.')
        elif scope == 'unassigned':
            if role_count == 0:
                reasons.append('Chua duoc gan role.')
            if team_count == 0:
                reasons.append('Chua duoc gan team.')
        elif scope == 'locked':
            reasons.append('Tai khoan dang bi khoa.')

        if active_session_count > 0:
            reasons.append(f'Dang mo {active_session_count} session.')

        risk_level = 'info'
        impact = _get_access_review_action_meta(review_action)['impact']
        if review_action == 'revoke_access':
            if role_count or team_count:
                impact = f'Se go {role_count} role va {team_count} team.'
            else:
                impact = 'Tai khoan khong co role/team de revoke.'
        elif review_action == 'lock_account':
            impact = 'Tai khoan da khoa, campaign chi xac nhan lai trang thai.' if user.is_locked else 'Se khoa tai khoan neu apply.'

        if is_privileged and review_action in {'revoke_access', 'lock_account'}:
            risk_level = 'error'
        elif review_action in {'revoke_access', 'lock_account'} and (role_count > 0 or team_count > 0):
            risk_level = 'warning'
        elif is_dormant and (role_count > 0 or team_count > 0):
            risk_level = 'warning'

        rows.append({
            'id': user.id,
            'username': user.username,
            'full_name': user.get_full_name() or user.username,
            'email': user.email or '',
            'is_active': bool(user.is_active),
            'is_locked': bool(user.is_locked),
            'is_staff': bool(user.is_staff),
            'is_privileged': bool(is_privileged),
            'is_dormant': bool(is_dormant),
            'active_session_count': active_session_count,
            'last_seen_at': last_seen_at,
            'roles': access_snapshot['roles'],
            'teams': access_snapshot['teams'],
            'role_count': role_count,
            'team_count': team_count,
            'reasons': reasons,
            'risk_level': risk_level,
            'impact': impact,
        })
    return rows


def _build_access_review_preview_summary(target_rows, skipped_rows, review_action):
    return {
        'matched_users': len(target_rows) + len(skipped_rows),
        'selected_users': len(target_rows),
        'skipped_users': len(skipped_rows),
        'privileged_users': sum(1 for item in target_rows if item['is_privileged']),
        'locked_users': sum(1 for item in target_rows if item['is_locked']),
        'dormant_users': sum(1 for item in target_rows if item['is_dormant']),
        'users_with_access': sum(1 for item in target_rows if item['role_count'] > 0 or item['team_count'] > 0),
        'destructive_review': review_action in {'revoke_access', 'lock_account'},
    }


def _build_access_review_preflight_checks(campaign_row, target_rows, skipped_rows, manual_selection=False):
    review_action = str(campaign_row.get('review_action') or 'certify')
    is_destructive = review_action in {'revoke_access', 'lock_account'}
    privileged_count = sum(1 for item in target_rows if item['is_privileged'])
    zero_access_count = sum(1 for item in target_rows if item['role_count'] == 0 and item['team_count'] == 0)
    requires_manual_confirmation = bool(is_destructive and len(target_rows) > 10 and not manual_selection)
    return [
        {
            'key': 'coverage',
            'title': 'Target coverage',
            'status': 'blocked' if not target_rows else 'ready',
            'description': (
                'Khong co tai khoan nao khop campaign hien tai.'
                if not target_rows
                else f"Campaign dang target {len(target_rows)} tai khoan hop le."
            ),
        },
        {
            'key': 'protected',
            'title': 'Protected targets',
            'status': 'warning' if skipped_rows else 'ready',
            'description': (
                f"Da bo qua {len(skipped_rows)} tai khoan duoc bao ve, can xu ly thu cong neu thuc su can."
                if skipped_rows
                else 'Khong co tai khoan duoc bao ve trong dot review nay.'
            ),
        },
        {
            'key': 'blast-radius',
            'title': 'Blast radius',
            'status': 'blocked' if requires_manual_confirmation else ('warning' if is_destructive and len(target_rows) >= 5 else 'ready'),
            'description': (
                'Campaign co tac dong pha huy len nhieu hon 10 tai khoan, can chon thu cong truoc khi apply.'
                if requires_manual_confirmation
                else (
                    'Campaign dang tac dong thay doi access/lock account tren mot nhom user can review ky.'
                    if is_destructive and len(target_rows) >= 5
                    else 'Pham vi tac dong nam trong nguong an toan de review.'
                )
            ),
        },
        {
            'key': 'privileged',
            'title': 'Privileged exposure',
            'status': 'warning' if privileged_count else 'ready',
            'description': (
                f"Co {privileged_count} tai khoan privileged nam trong campaign nay."
                if privileged_count
                else 'Khong co privileged account nao trong tap target.'
            ),
        },
        {
            'key': 'access-effect',
            'title': 'Access effect',
            'status': 'info' if (review_action == 'certify' or zero_access_count == len(target_rows)) else 'ready',
            'description': (
                'Campaign chi certify, se khong thay doi access hien tai.'
                if review_action == 'certify'
                else (
                    'Nhieu tai khoan trong tap target khong con role/team de thu hoi.'
                    if target_rows and zero_access_count == len(target_rows)
                    else 'Campaign se tao bien dong access ro rang tren tap target.'
                )
            ),
        },
    ]


def _build_access_review_campaign_rows(campaigns):
    all_role_ids = sorted({role_id for campaign in campaigns for role_id in campaign.get('role_ids', [])})
    all_team_ids = sorted({team_id for campaign in campaigns for team_id in campaign.get('team_ids', [])})
    role_map = {row.id: row for row in _annotate_role_governance_queryset(Role.objects.filter(id__in=all_role_ids))}
    team_map = {row.id: row for row in _annotate_team_governance_queryset(Team.objects.filter(id__in=all_team_ids))}
    items = []
    for campaign in campaigns:
        campaign_payload = _serialize_access_review_campaign_storage(campaign)
        campaign_role_ids = [role_id for role_id in campaign_payload.get('role_ids', []) if role_id in role_map]
        campaign_team_ids = [team_id for team_id in campaign_payload.get('team_ids', []) if team_id in team_map]
        roles = _serialize_onboarding_role_rows([role_map[role_id] for role_id in campaign_role_ids])
        teams = _serialize_onboarding_team_rows([team_map[team_id] for team_id in campaign_team_ids])
        missing_role_ids = [role_id for role_id in campaign_payload.get('role_ids', []) if role_id not in role_map]
        missing_team_ids = [team_id for team_id in campaign_payload.get('team_ids', []) if team_id not in team_map]
        inactive_role_ids = [item['id'] for item in roles if not item['is_active']]
        inactive_team_ids = [item['id'] for item in teams if not item['is_active']]

        matched_users = _resolve_access_review_target_users(campaign_payload)
        target_rows = _build_access_review_target_rows(matched_users[:18], campaign_payload)
        matched_user_count = len(matched_users)
        privileged_count = sum(1 for user in matched_users if _is_privileged_user(user))
        warnings = []
        if campaign_payload['is_active'] and matched_user_count == 0:
            warnings.append('Chiến dịch đang hoạt động nhưng chưa chọn được tài khoản nào.')
        if campaign_payload['review_action'] in {'revoke_access', 'lock_account'} and matched_user_count > 10:
            warnings.append('Chiến dịch có tác động mạnh trên hơn 10 tài khoản, nên rà soát thủ công trước khi áp dụng.')
        if privileged_count and campaign_payload['review_action'] in {'revoke_access', 'lock_account'}:
            warnings.append('Chiến dịch đang tác động lên tài khoản đặc quyền theo hướng thu hồi/khóa.')
        if missing_role_ids or missing_team_ids:
            warnings.append('Chiến dịch đang tham chiếu vai trò/nhóm không tồn tại.')
        if inactive_role_ids or inactive_team_ids:
            warnings.append('Chiến dịch đang dùng vai trò/nhóm đã tạm ngưng hoạt động.')

        items.append({
            **campaign_payload,
            'scope_label': _get_access_review_scope_meta(campaign_payload['scope'])['label'],
            'review_action_label': _get_access_review_action_meta(campaign_payload['review_action'])['label'],
            'roles': roles,
            'teams': teams,
            'role_count': len(roles),
            'team_count': len(teams),
            'checklist_count': len(campaign_payload.get('checklist', [])),
            'matched_user_count': matched_user_count,
            'privileged_match_count': privileged_count,
            'preview_users': target_rows[:6],
            'missing_role_ids': missing_role_ids,
            'missing_team_ids': missing_team_ids,
            'inactive_role_ids': inactive_role_ids,
            'inactive_team_ids': inactive_team_ids,
            'has_findings': bool(warnings),
            'warnings': warnings,
        })
    return items


def _build_access_review_watchlist(campaign_rows):
    items = []
    for campaign in campaign_rows:
        if campaign['is_active'] and campaign['matched_user_count'] == 0:
            items.append({
                'severity': 'warning',
                'title': f"Campaign {campaign['name']} chua co target",
                'description': 'Nen dieu chinh scope, role, team hoac inactivity window de campaign co gia tri review.',
                'campaign_key': campaign['key'],
                'matched_user_count': campaign['matched_user_count'],
                'route': '/admin/access-reviews',
            })
        if campaign['missing_role_ids'] or campaign['missing_team_ids']:
            items.append({
                'severity': 'error',
                'title': f"Campaign {campaign['name']} dang tham chieu du lieu da mat",
                'description': 'Co role/team trong campaign khong con ton tai, can mo campaign va lam sach dependency.',
                'campaign_key': campaign['key'],
                'matched_user_count': campaign['matched_user_count'],
                'route': '/admin/access-reviews',
            })
        if campaign['review_action'] in {'revoke_access', 'lock_account'} and campaign['matched_user_count'] > 10:
            items.append({
                'severity': 'error',
                'title': f"Campaign {campaign['name']} co blast radius lon",
                'description': 'Tac dong pha huy dang vuot nguong an toan, nen preview va chon thu cong truoc khi apply.',
                'campaign_key': campaign['key'],
                'matched_user_count': campaign['matched_user_count'],
                'route': '/admin/access-reviews',
            })
        if campaign['privileged_match_count'] > 0 and campaign['review_action'] in {'revoke_access', 'lock_account'}:
            items.append({
                'severity': 'warning',
                'title': f"Campaign {campaign['name']} dang target privileged users",
                'description': 'Co tai khoan staff hoac RBAC manager nam trong dot review nay.',
                'campaign_key': campaign['key'],
                'matched_user_count': campaign['matched_user_count'],
                'route': '/admin/access-reviews',
            })
    return items[:10]


def _create_access_review_audit_log(request, actor, action, entity_type, entity_id, entity_id_str, entity_code, old_values, new_values, changed_fields):
    AuditLog.objects.create(
        user=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_id_str=str(entity_id_str or entity_id),
        entity_code=str(entity_code or ''),
        old_values=old_values,
        new_values=new_values,
        changed_fields=changed_fields,
        ip_address=_get_request_ip(request),
        user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
    )


def _build_access_review_activity_items(queryset, limit=20):
    safe_limit = max(1, min(int(limit or 20), 60))
    logs = list(queryset.order_by('-created_at', '-id')[:safe_limit])
    items = []
    for log in logs:
        entity_type = str(log.entity_type or '')
        if entity_type == 'UserAccessReviewCampaign':
            campaign_name = (
                ((log.new_values or {}).get('name') if isinstance(log.new_values, dict) else None)
                or ((log.old_values or {}).get('name') if isinstance(log.old_values, dict) else None)
                or str(log.entity_code or 'Campaign')
            )
            action_label = 'Tạo' if log.action == 'CREATE' else 'Cập nhật' if log.action == 'UPDATE' else 'Xóa'
            items.append({
                'id': log.id,
                'timestamp': log.created_at,
                'kind': 'campaign',
                'action': log.action,
                'summary': f'{action_label} chiến dịch {campaign_name}',
                'route': '/admin/access-reviews',
                'changed_fields': log.changed_fields or [],
                'entity_code': log.entity_code,
                'actor': {
                    'id': log.user_id,
                    'username': log.user.username if log.user else '',
                    'full_name': log.user.get_full_name() if log.user else '',
                },
                'old_values': log.old_values or {},
                'new_values': log.new_values or {},
            })
            continue

        new_values = log.new_values or {}
        review_action = str(new_values.get('review_action') or 'certify')
        campaign_name = str(new_values.get('campaign_name') or new_values.get('campaign_key') or 'campaign')
        summary_prefix = {
            'certify': 'Xác nhận quyền',
            'revoke_access': 'Thu hồi quyền',
            'lock_account': 'Khóa tài khoản',
        }.get(review_action, 'Rà soát truy cập')
        items.append({
            'id': log.id,
            'timestamp': log.created_at,
            'kind': 'review',
            'action': log.action,
            'summary': f'{summary_prefix} cho {log.entity_code or "user"} theo {campaign_name}',
            'route': '/admin/access-reviews',
            'changed_fields': log.changed_fields or [],
            'entity_code': log.entity_code,
            'actor': {
                'id': log.user_id,
                'username': log.user.username if log.user else '',
                'full_name': log.user.get_full_name() if log.user else '',
            },
            'old_values': log.old_values or {},
            'new_values': new_values,
        })
    return items


def _build_access_review_workspace_summary(campaign_rows, watchlist_items):
    dormant_cutoff = django_timezone.now() - timedelta(days=45)
    privileged_users = (
        _annotate_user_directory_queryset(
            User.objects.filter(is_superuser=False).prefetch_related('roles__permissions')
        )
        .filter(
            models.Q(is_staff=True)
            | models.Q(roles__permissions__resource='CORE', roles__permissions__action='MANAGE_RBAC')
        )
        .distinct()
        .count()
    )
    dormant_users = (
        _annotate_user_directory_queryset(User.objects.filter(is_superuser=False))
        .filter(models.Q(last_seen_at__isnull=True) | models.Q(last_seen_at__lt=dormant_cutoff))
        .distinct()
        .count()
    )
    return {
        'total_campaigns': len(campaign_rows),
        'active_campaigns': sum(1 for campaign in campaign_rows if campaign['is_active']),
        'campaigns_with_findings': sum(1 for campaign in campaign_rows if campaign['has_findings']),
        'review_queue': len(watchlist_items),
        'destructive_campaigns': sum(1 for campaign in campaign_rows if campaign['review_action'] in {'revoke_access', 'lock_account'}),
        'privileged_users': privileged_users,
        'dormant_users': dormant_users,
    }


def _get_access_exception_policy_entity_id(policy_key):
    return int(uuid.uuid5(uuid.NAMESPACE_DNS, f'erp-carton-access-exception-policy-{policy_key}').int % 1_000_000_000)


def _get_access_exception_request_entity_id(request_key):
    return int(uuid.uuid5(uuid.NAMESPACE_DNS, f'erp-carton-access-exception-request-{request_key}').int % 1_000_000_000)


def _serialize_access_exception_datetime(value):
    if not value:
        return ''
    if isinstance(value, str):
        return value
    try:
        return django_timezone.localtime(value).isoformat()
    except (AttributeError, TypeError, ValueError):
        try:
            return value.isoformat()
        except AttributeError:
            return str(value)


def _parse_access_exception_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = parse_datetime(str(value))
    if parsed is None:
        return None
    if django_timezone.is_naive(parsed):
        return django_timezone.make_aware(parsed, django_timezone.get_current_timezone())
    return parsed


def _make_json_safe(value):
    return json.loads(json.dumps(value, cls=DjangoJSONEncoder))


def _lookup_access_exception_policy_pack_raw(pack_key):
    normalized_key = str(pack_key or '').strip().lower()
    if not normalized_key:
        return None
    return next(
        (
            dict(item)
            for item in ACCESS_EXCEPTION_POLICY_PACKS
            if str(item.get('key') or '').strip().lower() == normalized_key
        ),
        None,
    )


def _serialize_access_exception_policy_storage(policy, apply_pack_defaults=True):
    payload = policy if isinstance(policy, dict) else {}
    pack_seed_key = str(payload.get('pack_key') or payload.get('key') or '').strip().lower()
    pack_defaults = _lookup_access_exception_policy_pack_raw(pack_seed_key) if apply_pack_defaults else None
    department_key = str(payload.get('department_key') or (pack_defaults or {}).get('department_key') or 'general').strip().lower()
    department_label = str(payload.get('department_label') or (pack_defaults or {}).get('department_label') or 'General governance').strip()
    preferred_team_tokens = []
    for value in payload.get('preferred_team_tokens', (pack_defaults or {}).get('preferred_team_tokens', [])):
        normalized = str(value or '').strip().upper()
        if normalized and normalized not in preferred_team_tokens:
            preferred_team_tokens.append(normalized)

    return {
        'key': str(payload.get('key') or ''),
        'pack_key': str(payload.get('pack_key') or ''),
        'name': str(payload.get('name') or ''),
        'description': str(payload.get('description') or ''),
        'is_active': bool(payload.get('is_active', True)),
        'tone': str(payload.get('tone') or 'blue'),
        'risk_level': str(payload.get('risk_level') or 'standard'),
        'approval_stage_count': max(1, min(int(payload.get('approval_stage_count') or 1), 2)),
        'approval_sla_hours': max(1, min(int(payload.get('approval_sla_hours') or 24), 168)),
        'stage_one_label': str(payload.get('stage_one_label') or 'Manager review')[:80],
        'stage_two_label': str(payload.get('stage_two_label') or '')[:80],
        'default_duration_days': int(payload.get('default_duration_days') or 7),
        'max_duration_days': int(payload.get('max_duration_days') or 30),
        'requires_approval': bool(payload.get('requires_approval', True)),
        'role_ids': [int(value) for value in payload.get('role_ids', [])],
        'team_ids': [int(value) for value in payload.get('team_ids', [])],
        'checklist': [str(item) for item in payload.get('checklist', [])],
        'department_key': department_key[:50],
        'department_label': department_label[:120],
        'preferred_team_tokens': preferred_team_tokens[:8],
        'routing_summary': str(payload.get('routing_summary') or (pack_defaults or {}).get('routing_summary') or 'Auto-route tu governance approver pool voi team matching co ban.')[:280],
        'stage_one_strategy_label': str(payload.get('stage_one_strategy_label') or (pack_defaults or {}).get('stage_one_strategy_label') or 'Approver gan voi team cua target')[:120],
        'stage_two_strategy_label': str(payload.get('stage_two_strategy_label') or (pack_defaults or {}).get('stage_two_strategy_label') or 'Approver doc lap cho stage 2')[:120],
        'require_independent_stage_two': bool(payload.get('require_independent_stage_two', (pack_defaults or {}).get('require_independent_stage_two', True))),
    }


def _load_access_exception_policies():
    setting = (
        Setting.objects
        .filter(key=USER_ACCESS_EXCEPTION_POLICIES_SETTING_KEY)
        .only('value')
        .first()
    )
    if setting is None or not str(setting.value or '').strip():
        return []
    try:
        raw_value = json.loads(setting.value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    if not isinstance(raw_value, list):
        return []

    policies = []
    for item in raw_value:
        if not isinstance(item, dict):
            continue
        serializer = AccessExceptionPolicySerializer(data=item)
        if serializer.is_valid():
            policies.append(_serialize_access_exception_policy_storage(serializer.validated_data))
    return policies


def _save_access_exception_policies(policies):
    serialized = [
        _serialize_access_exception_policy_storage(item)
        for item in policies
        if isinstance(item, dict)
    ]
    serialized.sort(key=lambda item: (not item.get('is_active', True), str(item.get('name') or '').lower(), str(item.get('key') or '').lower()))
    Setting.objects.update_or_create(
        key=USER_ACCESS_EXCEPTION_POLICIES_SETTING_KEY,
        defaults={
            'value': json.dumps(serialized, ensure_ascii=False),
            'data_type': 'json',
            'description': 'Admin-managed access exception policies for temporary user access approvals.',
            'is_active': True,
        },
    )
    return serialized


def _build_access_exception_policy_pack_rows():
    items = []
    for pack in ACCESS_EXCEPTION_POLICY_PACKS:
        payload = _serialize_access_exception_policy_storage(pack, apply_pack_defaults=False)
        items.append({
            'key': payload['pack_key'] or payload['key'],
            'name': payload['name'],
            'description': payload['description'],
            'tone': payload['tone'],
            'risk_level': payload['risk_level'],
            'requires_approval': payload['requires_approval'],
            'approval_stage_count': payload['approval_stage_count'],
            'approval_sla_hours': payload['approval_sla_hours'],
            'stage_one_label': payload['stage_one_label'],
            'stage_two_label': payload['stage_two_label'],
            'default_duration_days': payload['default_duration_days'],
            'max_duration_days': payload['max_duration_days'],
            'checklist': list(payload['checklist']),
            'department_key': payload['department_key'],
            'department_label': payload['department_label'],
            'preferred_team_tokens': list(payload['preferred_team_tokens']),
            'routing_summary': payload['routing_summary'],
            'stage_one_strategy_label': payload['stage_one_strategy_label'],
            'stage_two_strategy_label': payload['stage_two_strategy_label'],
            'require_independent_stage_two': payload['require_independent_stage_two'],
        })
    return items


def _get_access_exception_policy_pack(pack_key):
    raw_pack = _lookup_access_exception_policy_pack_raw(pack_key)
    if raw_pack is None:
        return None
    return _serialize_access_exception_policy_storage(raw_pack, apply_pack_defaults=False)


def _build_default_access_exception_routing_rules():
    seen_department_keys = set()
    items = []
    for pack in _build_access_exception_policy_pack_rows():
        department_key = str(pack.get('department_key') or 'general').strip().lower()
        if not department_key or department_key in seen_department_keys:
            continue
        seen_department_keys.add(department_key)
        items.append({
            'department_key': department_key,
            'department_label': str(pack.get('department_label') or 'General governance'),
            'pack_keys': sorted({
                str(candidate.get('key') or '')
                for candidate in _build_access_exception_policy_pack_rows()
                if str(candidate.get('department_key') or '').strip().lower() == department_key
            }),
            'is_active': True,
            'stage_one_mode': 'directory_then_team',
            'stage_two_mode': 'directory_then_independent' if int(pack.get('approval_stage_count') or 1) > 1 else '',
            'stage_one_primary_user_id': None,
            'stage_one_delegate_user_id': None,
            'stage_one_rotation_user_ids': [],
            'stage_two_primary_user_id': None,
            'stage_two_delegate_user_id': None,
            'stage_two_rotation_user_ids': [],
            'fallback_team_tokens': list(pack.get('preferred_team_tokens', [])),
            'notes': str(pack.get('routing_summary') or ''),
        })
    return items


def _serialize_access_exception_routing_rule_storage(rule, pack_rows=None):
    payload = rule if isinstance(rule, dict) else {}
    safe_pack_rows = list(pack_rows or _build_access_exception_policy_pack_rows())
    department_key = str(payload.get('department_key') or 'general').strip().lower()
    matching_pack_rows = [
        item
        for item in safe_pack_rows
        if str(item.get('department_key') or '').strip().lower() == department_key
    ]
    default_rule = next(
        (item for item in _build_default_access_exception_routing_rules() if item.get('department_key') == department_key),
        None,
    )
    fallback_team_tokens = []
    for value in payload.get('fallback_team_tokens', (default_rule or {}).get('fallback_team_tokens', [])):
        normalized = str(value or '').strip().upper()
        if normalized and normalized not in fallback_team_tokens:
            fallback_team_tokens.append(normalized)

    def normalize_user_ids(values):
        cleaned = []
        for value in values or []:
            try:
                normalized = int(value)
            except (TypeError, ValueError):
                continue
            if normalized > 0 and normalized not in cleaned:
                cleaned.append(normalized)
        return cleaned[:6]

    return {
        'department_key': department_key[:50],
        'department_label': str(payload.get('department_label') or (default_rule or {}).get('department_label') or 'General governance')[:120],
        'pack_keys': sorted({
            str(item.get('key') or '')
            for item in matching_pack_rows
            if str(item.get('key') or '').strip()
        } or set((default_rule or {}).get('pack_keys', []))),
        'is_active': bool(payload.get('is_active', True)),
        'stage_one_mode': str(payload.get('stage_one_mode') or (default_rule or {}).get('stage_one_mode') or 'directory_then_team')[:40],
        'stage_two_mode': str(payload.get('stage_two_mode') or (default_rule or {}).get('stage_two_mode') or '')[:40],
        'stage_one_primary_user_id': int(payload.get('stage_one_primary_user_id')) if payload.get('stage_one_primary_user_id') else None,
        'stage_one_delegate_user_id': int(payload.get('stage_one_delegate_user_id')) if payload.get('stage_one_delegate_user_id') else None,
        'stage_one_rotation_user_ids': normalize_user_ids(payload.get('stage_one_rotation_user_ids', (default_rule or {}).get('stage_one_rotation_user_ids', []))),
        'stage_two_primary_user_id': int(payload.get('stage_two_primary_user_id')) if payload.get('stage_two_primary_user_id') else None,
        'stage_two_delegate_user_id': int(payload.get('stage_two_delegate_user_id')) if payload.get('stage_two_delegate_user_id') else None,
        'stage_two_rotation_user_ids': normalize_user_ids(payload.get('stage_two_rotation_user_ids', (default_rule or {}).get('stage_two_rotation_user_ids', []))),
        'fallback_team_tokens': fallback_team_tokens[:8],
        'notes': str(payload.get('notes') or (default_rule or {}).get('notes') or '')[:280],
    }


def _load_access_exception_routing_rules():
    default_rules = _build_default_access_exception_routing_rules()
    setting = (
        Setting.objects
        .filter(key=USER_ACCESS_EXCEPTION_ROUTING_RULES_SETTING_KEY)
        .only('value')
        .first()
    )
    if setting is None or not str(setting.value or '').strip():
        return [
            _serialize_access_exception_routing_rule_storage(item)
            for item in default_rules
        ]
    try:
        raw_value = json.loads(setting.value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return [
            _serialize_access_exception_routing_rule_storage(item)
            for item in default_rules
        ]
    if not isinstance(raw_value, list):
        return [
            _serialize_access_exception_routing_rule_storage(item)
            for item in default_rules
        ]

    merged_rules = {
        item['department_key']: _serialize_access_exception_routing_rule_storage(item)
        for item in default_rules
    }
    for item in raw_value:
        if not isinstance(item, dict) or not item.get('department_key'):
            continue
        serialized = _serialize_access_exception_routing_rule_storage(item)
        merged_rules[serialized['department_key']] = serialized
    return sorted(merged_rules.values(), key=lambda item: (not item.get('is_active', True), str(item.get('department_label') or '').lower()))


def _save_access_exception_routing_rules(rules):
    serialized = [
        _serialize_access_exception_routing_rule_storage(item)
        for item in rules
        if isinstance(item, dict)
    ]
    deduped = {}
    for item in serialized:
        deduped[item['department_key']] = item
    final_rules = sorted(deduped.values(), key=lambda item: (not item.get('is_active', True), str(item.get('department_label') or '').lower()))
    Setting.objects.update_or_create(
        key=USER_ACCESS_EXCEPTION_ROUTING_RULES_SETTING_KEY,
        defaults={
            'value': json.dumps(final_rules, ensure_ascii=False),
            'data_type': 'json',
            'description': 'Department routing directory for access exception owner and delegate assignments.',
            'is_active': True,
        },
    )
    return final_rules


def _get_access_exception_routing_rule(department_key, routing_rules=None):
    normalized_key = str(department_key or '').strip().lower()
    if not normalized_key:
        return None
    safe_rules = list(routing_rules or _load_access_exception_routing_rules())
    return next((item for item in safe_rules if str(item.get('department_key') or '').strip().lower() == normalized_key), None)


def _build_access_exception_routing_rule_rows(routing_rules=None):
    safe_rules = list(routing_rules or _load_access_exception_routing_rules())
    user_ids = sorted({
        int(value)
        for rule in safe_rules
        for value in [
            rule.get('stage_one_primary_user_id'),
            rule.get('stage_one_delegate_user_id'),
            rule.get('stage_two_primary_user_id'),
            rule.get('stage_two_delegate_user_id'),
            *list(rule.get('stage_one_rotation_user_ids') or []),
            *list(rule.get('stage_two_rotation_user_ids') or []),
        ]
        if value
    })
    user_map = {
        user.id: user
        for user in _build_access_exception_approver_users(limit=max(40, len(user_ids) * 2 or 24))
        if user.id in set(user_ids)
    }
    rows = []
    for rule in safe_rules:
        stage_one_primary_user = user_map.get(rule.get('stage_one_primary_user_id'))
        stage_one_delegate_user = user_map.get(rule.get('stage_one_delegate_user_id'))
        stage_one_rotation_users = [
            user_map[user_id]
            for user_id in (rule.get('stage_one_rotation_user_ids') or [])
            if user_id in user_map
        ]
        stage_two_primary_user = user_map.get(rule.get('stage_two_primary_user_id'))
        stage_two_delegate_user = user_map.get(rule.get('stage_two_delegate_user_id'))
        stage_two_rotation_users = [
            user_map[user_id]
            for user_id in (rule.get('stage_two_rotation_user_ids') or [])
            if user_id in user_map
        ]
        rows.append({
            **rule,
            'stage_one_primary_approver': _serialize_access_exception_approver_reference(stage_one_primary_user),
            'stage_one_delegate_approver': _serialize_access_exception_approver_reference(stage_one_delegate_user),
            'stage_one_rotation_approvers': [
                _serialize_access_exception_approver_reference(user)
                for user in stage_one_rotation_users
            ],
            'stage_two_primary_approver': _serialize_access_exception_approver_reference(stage_two_primary_user),
            'stage_two_delegate_approver': _serialize_access_exception_approver_reference(stage_two_delegate_user),
            'stage_two_rotation_approvers': [
                _serialize_access_exception_approver_reference(user)
                for user in stage_two_rotation_users
            ],
            'configured_stage_one': bool(stage_one_primary_user or stage_one_delegate_user or stage_one_rotation_users),
            'configured_stage_two': bool(stage_two_primary_user or stage_two_delegate_user or stage_two_rotation_users),
        })
    return rows


def _serialize_access_exception_approver_availability_storage(entry):
    payload = entry if isinstance(entry, dict) else {}
    return {
        'user_id': int(payload.get('user_id') or 0),
        'is_out_of_office': bool(payload.get('is_out_of_office', True)),
        'starts_at': _serialize_access_exception_datetime(payload.get('starts_at')),
        'ends_at': _serialize_access_exception_datetime(payload.get('ends_at')),
        'backup_user_id': int(payload.get('backup_user_id')) if payload.get('backup_user_id') else None,
        'label': str(payload.get('label') or '')[:120],
        'notes': str(payload.get('notes') or '')[:280],
    }


def _load_access_exception_approver_availability():
    setting = (
        Setting.objects
        .filter(key=USER_ACCESS_EXCEPTION_APPROVER_AVAILABILITY_SETTING_KEY)
        .only('value')
        .first()
    )
    if setting is None or not str(setting.value or '').strip():
        return []
    try:
        raw_value = json.loads(setting.value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    if not isinstance(raw_value, list):
        return []

    items = {}
    for item in raw_value:
        serialized = _serialize_access_exception_approver_availability_storage(item)
        if serialized.get('user_id'):
            items[int(serialized['user_id'])] = serialized
    return sorted(
        items.values(),
        key=lambda item: (
            not bool(item.get('is_out_of_office')),
            str(item.get('label') or ''),
            int(item.get('user_id') or 0),
        ),
    )


def _save_access_exception_approver_availability(rows):
    serialized = []
    for item in rows:
        candidate = _serialize_access_exception_approver_availability_storage(item)
        if candidate.get('user_id'):
            serialized.append(candidate)
    deduped = {
        int(item['user_id']): item
        for item in serialized
    }
    final_rows = sorted(
        deduped.values(),
        key=lambda item: (
            not bool(item.get('is_out_of_office')),
            str(item.get('label') or ''),
            int(item.get('user_id') or 0),
        ),
    )
    Setting.objects.update_or_create(
        key=USER_ACCESS_EXCEPTION_APPROVER_AVAILABILITY_SETTING_KEY,
        defaults={
            'value': json.dumps(final_rows, ensure_ascii=False),
            'data_type': 'json',
            'description': 'Approver out-of-office coverage and backup assignments for access exception governance.',
            'is_active': True,
        },
    )
    return final_rows


def _is_access_exception_approver_out_of_office(entry, now=None):
    if not entry or not bool(entry.get('is_out_of_office', False)):
        return False
    current_time = now or django_timezone.now()
    starts_at = _parse_access_exception_datetime(entry.get('starts_at'))
    ends_at = _parse_access_exception_datetime(entry.get('ends_at'))
    if starts_at is not None and current_time < starts_at:
        return False
    if ends_at is not None and current_time > ends_at:
        return False
    return True


def _get_access_exception_approver_availability_map(availability_rows=None):
    safe_rows = list(availability_rows or _load_access_exception_approver_availability())
    return {
        int(item.get('user_id')): item
        for item in safe_rows
        if item.get('user_id')
    }


def _format_access_exception_availability_window(entry):
    starts_at = _parse_access_exception_datetime((entry or {}).get('starts_at'))
    ends_at = _parse_access_exception_datetime((entry or {}).get('ends_at'))
    if starts_at and ends_at:
        return (
            f"{django_timezone.localtime(starts_at).strftime('%d/%m %H:%M')} -> "
            f"{django_timezone.localtime(ends_at).strftime('%d/%m %H:%M')}"
        )
    if ends_at:
        return f"den {django_timezone.localtime(ends_at).strftime('%d/%m %H:%M')}"
    if starts_at:
        return f"tu {django_timezone.localtime(starts_at).strftime('%d/%m %H:%M')}"
    return 'khong gioi han'


def _get_access_exception_directory_stage_config(routing_rule, stage_level=1):
    prefix = 'stage_two' if int(stage_level or 1) > 1 else 'stage_one'
    return {
        'primary_user_id': int(routing_rule.get(f'{prefix}_primary_user_id') or 0) or None,
        'delegate_user_id': int(routing_rule.get(f'{prefix}_delegate_user_id') or 0) or None,
        'rotation_user_ids': [
            int(value)
            for value in (routing_rule.get(f'{prefix}_rotation_user_ids') or [])
            if value
        ],
    }


def _label_access_exception_resolution_kind(kind):
    mapping = {
        'primary': 'Primary owner',
        'delegate': 'Delegate coverage',
        'rotation': 'Rotation coverage',
        'backup': 'OOO backup coverage',
        'manual': 'Manual override',
        'fallback': 'Fallback routing',
    }
    return mapping.get(str(kind or '').strip().lower(), 'Governance routing')


def _build_access_exception_out_of_office_note(user, availability_entry):
    if user is None or not availability_entry:
        return ''
    label = str(availability_entry.get('label') or '').strip() or f'{user.get_full_name() or user.username} dang out-of-office'
    window_label = _format_access_exception_availability_window(availability_entry)
    return f'{label} ({window_label}).'


def _build_access_exception_simulated_absence_note(user):
    if user is None:
        return ''
    return f"{user.get_full_name() or user.username} duoc danh dau vang mat trong drill/simulation."


def _build_access_exception_approver_availability_rows(availability_rows=None, routing_rules=None, request_rows=None, approver_candidates=None):
    safe_rows = list(availability_rows or _load_access_exception_approver_availability())
    candidate_rows = list(approver_candidates or _build_access_exception_approver_candidate_rows(limit=40))
    candidate_map = {
        int(item.get('id') or 0): item
        for item in candidate_rows
        if int(item.get('id') or 0)
    }
    rule_rows = list(routing_rules or _build_access_exception_routing_rule_rows())
    request_items = list(request_rows or [])
    ownership_map = defaultdict(lambda: {
        'primary_departments': [],
        'delegate_departments': [],
        'rotation_departments': [],
    })
    for rule in rule_rows:
        department_label = str(rule.get('department_label') or rule.get('department_key') or 'General governance')
        stage_one_config = _get_access_exception_directory_stage_config(rule, stage_level=1)
        stage_two_config = _get_access_exception_directory_stage_config(rule, stage_level=2)
        for user_id in [stage_one_config.get('primary_user_id'), stage_two_config.get('primary_user_id')]:
            if user_id and department_label not in ownership_map[int(user_id)]['primary_departments']:
                ownership_map[int(user_id)]['primary_departments'].append(department_label)
        for user_id in [stage_one_config.get('delegate_user_id'), stage_two_config.get('delegate_user_id')]:
            if user_id and department_label not in ownership_map[int(user_id)]['delegate_departments']:
                ownership_map[int(user_id)]['delegate_departments'].append(department_label)
        rotation_user_ids = list(stage_one_config.get('rotation_user_ids') or []) + list(stage_two_config.get('rotation_user_ids') or [])
        for user_id in rotation_user_ids:
            if user_id and department_label not in ownership_map[int(user_id)]['rotation_departments']:
                ownership_map[int(user_id)]['rotation_departments'].append(department_label)

    impacted_counts = Counter(
        int((item.get('active_approver') or {}).get('id') or 0)
        for item in request_items
        if str(item.get('lifecycle_state') or '') == 'pending'
        and int((item.get('active_approver') or {}).get('id') or 0)
    )

    items = []
    for entry in safe_rows:
        user_id = int(entry.get('user_id') or 0)
        if not user_id:
            continue
        backup_user_id = int(entry.get('backup_user_id') or 0) or None
        candidate_row = candidate_map.get(user_id)
        backup_row = candidate_map.get(backup_user_id or 0)
        active_ooo = _is_access_exception_approver_out_of_office(entry)
        ownership = ownership_map.get(user_id, {})
        coverage_status = 'ready'
        if active_ooo and not backup_row and int(impacted_counts.get(user_id, 0) or 0) > 0:
            coverage_status = 'critical'
        elif active_ooo and not backup_row:
            coverage_status = 'warning'
        elif active_ooo:
            coverage_status = 'covered'
        items.append({
            **entry,
            'approver': _serialize_access_exception_approver_candidate_reference(candidate_row),
            'backup_approver': _serialize_access_exception_approver_candidate_reference(backup_row),
            'is_currently_out_of_office': active_ooo,
            'coverage_status': coverage_status,
            'coverage_status_label': {
                'covered': 'Covered',
                'warning': 'Needs backup',
                'critical': 'Impacted',
                'ready': 'Standby',
            }.get(coverage_status, 'Standby'),
            'window_label': _format_access_exception_availability_window(entry),
            'primary_departments': list(ownership.get('primary_departments') or []),
            'delegate_departments': list(ownership.get('delegate_departments') or []),
            'rotation_departments': list(ownership.get('rotation_departments') or []),
            'impacted_request_count': int(impacted_counts.get(user_id, 0) or 0),
        })
    items.sort(
        key=lambda item: (
            0 if item.get('coverage_status') == 'critical' else 1 if item.get('coverage_status') == 'warning' else 2,
            not bool(item.get('is_currently_out_of_office')),
            str((item.get('approver') or {}).get('full_name') or (item.get('approver') or {}).get('username') or ''),
        )
    )
    return items


def _build_access_exception_approver_availability_summary(availability_rows):
    return {
        'tracked_approvers': len(availability_rows),
        'out_of_office_approvers': sum(1 for item in availability_rows if item.get('is_currently_out_of_office')),
        'covered_out_of_office_approvers': sum(
            1
            for item in availability_rows
            if item.get('is_currently_out_of_office') and item.get('coverage_status') == 'covered'
        ),
        'out_of_office_coverage_gaps': sum(
            1
            for item in availability_rows
            if item.get('is_currently_out_of_office') and item.get('coverage_status') in {'warning', 'critical'}
        ),
        'impacted_requests': sum(int(item.get('impacted_request_count') or 0) for item in availability_rows),
    }


def _create_access_exception_approval_history(request_row, action, actor, comments='', level=None):
    from .models import ApprovalHistory

    row = _serialize_access_exception_request_storage(request_row)
    ApprovalHistory.objects.create(
        entity_type='UserAccessExceptionRequest',
        entity_id=_get_access_exception_request_entity_id(row.get('key')),
        entity_code=str(row.get('key') or ''),
        action=action,
        comments=str(comments or '')[:1000],
        user=actor,
        level=int(level or row.get('active_stage_level') or 1),
    )


def _get_access_exception_stage_approver_user(requester, primary_approver, secondary_approver_user_id=None):
    if secondary_approver_user_id:
        selected = next(
            (
                user
                for user in _build_access_exception_approver_users(limit=40)
                if user.id == int(secondary_approver_user_id)
            ),
            None,
        )
        if selected is not None:
            return selected

    excluded_ids = {
        int(value)
        for value in [getattr(requester, 'id', None), getattr(primary_approver, 'id', None)]
        if value
    }
    return next(
        (
            user
            for user in _build_access_exception_approver_users(limit=40)
            if user.id not in excluded_ids
        ),
        None,
    )


def _build_access_exception_stage_plan(policy, requester, stage_one_approver, stage_two_approver=None):
    policy_payload = _serialize_access_exception_policy_storage(policy)
    requires_approval = bool(policy_payload.get('requires_approval', True))
    if not requires_approval:
        return []

    items = [
        {
            'level': 1,
            'label': str(policy_payload.get('stage_one_label') or 'Manager review'),
            'approver_user_id': stage_one_approver.id if stage_one_approver is not None else None,
            'status': 'pending',
            'started_at': None,
            'decided_at': None,
            'decision': '',
            'decision_note': '',
        }
    ]
    if int(policy_payload.get('approval_stage_count') or 1) > 1:
        second_approver = stage_two_approver or _get_access_exception_stage_approver_user(requester, stage_one_approver)
        items.append({
            'level': 2,
            'label': str(policy_payload.get('stage_two_label') or 'Governance sign-off'),
            'approver_user_id': second_approver.id if second_approver is not None else None,
            'status': 'queued',
            'started_at': None,
            'decided_at': None,
            'decision': '',
            'decision_note': '',
        })
    return items


def _get_access_exception_stage_due_at(started_at, approval_sla_hours):
    started = _parse_access_exception_datetime(started_at) or django_timezone.now()
    return started + timedelta(hours=max(1, int(approval_sla_hours or 24)))


def _serialize_access_exception_request_storage(request_row):
    return {
        'key': str(request_row.get('key') or ''),
        'request_kind': str(request_row.get('request_kind') or 'grant'),
        'parent_request_key': str(request_row.get('parent_request_key') or ''),
        'renewed_by_request_key': str(request_row.get('renewed_by_request_key') or ''),
        'policy_pack_key': str(request_row.get('policy_pack_key') or ''),
        'policy_key': str(request_row.get('policy_key') or ''),
        'policy_name': str(request_row.get('policy_name') or ''),
        'policy_risk_level': str(request_row.get('policy_risk_level') or 'standard'),
        'policy_tone': str(request_row.get('policy_tone') or 'blue'),
        'requires_approval': bool(request_row.get('requires_approval', True)),
        'approval_stage_count': max(1, min(int(request_row.get('approval_stage_count') or 1), 2)),
        'approval_sla_hours': max(1, min(int(request_row.get('approval_sla_hours') or 24), 168)),
        'stage_one_label': str(request_row.get('stage_one_label') or 'Manager review')[:80],
        'stage_two_label': str(request_row.get('stage_two_label') or '')[:80],
        'routing_department_key': str(request_row.get('routing_department_key') or 'general')[:50],
        'routing_department_label': str(request_row.get('routing_department_label') or 'General governance')[:120],
        'routing_summary': str(request_row.get('routing_summary') or '')[:280],
        'routing_stage_one_strategy_label': str(request_row.get('routing_stage_one_strategy_label') or '')[:120],
        'routing_stage_two_strategy_label': str(request_row.get('routing_stage_two_strategy_label') or '')[:120],
        'routing_stage_one_source': str(request_row.get('routing_stage_one_source') or '')[:40],
        'routing_stage_two_source': str(request_row.get('routing_stage_two_source') or '')[:40],
        'routing_stage_one_resolution_kind': str(request_row.get('routing_stage_one_resolution_kind') or '')[:40],
        'routing_stage_two_resolution_kind': str(request_row.get('routing_stage_two_resolution_kind') or '')[:40],
        'routing_stage_one_resolution_label': str(request_row.get('routing_stage_one_resolution_label') or '')[:80],
        'routing_stage_two_resolution_label': str(request_row.get('routing_stage_two_resolution_label') or '')[:80],
        'routing_stage_one_coverage_note': str(request_row.get('routing_stage_one_coverage_note') or '')[:200],
        'routing_stage_two_coverage_note': str(request_row.get('routing_stage_two_coverage_note') or '')[:200],
        'routing_target_team_codes': [
            str(value or '').strip().upper()
            for value in request_row.get('routing_target_team_codes', [])
            if str(value or '').strip()
        ][:8],
        'auto_selected_stage_one': bool(request_row.get('auto_selected_stage_one', False)),
        'auto_selected_stage_two': bool(request_row.get('auto_selected_stage_two', False)),
        'user_id': int(request_row.get('user_id') or 0),
        'approver_user_id': int(request_row.get('approver_user_id')) if request_row.get('approver_user_id') else None,
        'stage_two_approver_user_id': int(request_row.get('stage_two_approver_user_id')) if request_row.get('stage_two_approver_user_id') else None,
        'active_approver_user_id': int(request_row.get('active_approver_user_id')) if request_row.get('active_approver_user_id') else None,
        'active_stage_level': max(1, min(int(request_row.get('active_stage_level') or 1), 2)),
        'requested_by_id': int(request_row.get('requested_by_id') or 0),
        'approved_by_id': int(request_row.get('approved_by_id')) if request_row.get('approved_by_id') else None,
        'rejected_by_id': int(request_row.get('rejected_by_id')) if request_row.get('rejected_by_id') else None,
        'revoked_by_id': int(request_row.get('revoked_by_id')) if request_row.get('revoked_by_id') else None,
        'duration_days': int(request_row.get('duration_days') or 7),
        'justification': str(request_row.get('justification') or ''),
        'ticket_ref': str(request_row.get('ticket_ref') or ''),
        'status': str(request_row.get('status') or 'pending'),
        'decision_note': str(request_row.get('decision_note') or ''),
        'requested_at': _serialize_access_exception_datetime(request_row.get('requested_at')),
        'approved_at': _serialize_access_exception_datetime(request_row.get('approved_at')),
        'rejected_at': _serialize_access_exception_datetime(request_row.get('rejected_at')),
        'revoked_at': _serialize_access_exception_datetime(request_row.get('revoked_at')),
        'renewed_at': _serialize_access_exception_datetime(request_row.get('renewed_at')),
        'approval_stage_started_at': _serialize_access_exception_datetime(request_row.get('approval_stage_started_at')),
        'approval_stage_due_at': _serialize_access_exception_datetime(request_row.get('approval_stage_due_at')),
        'sla_warning_stage_level': int(request_row.get('sla_warning_stage_level')) if request_row.get('sla_warning_stage_level') else None,
        'sla_warning_sent_at': _serialize_access_exception_datetime(request_row.get('sla_warning_sent_at')),
        'sla_escalation_stage_level': int(request_row.get('sla_escalation_stage_level')) if request_row.get('sla_escalation_stage_level') else None,
        'sla_escalation_sent_at': _serialize_access_exception_datetime(request_row.get('sla_escalation_sent_at')),
        'continuity_reroute_count': max(0, int(request_row.get('continuity_reroute_count') or 0)),
        'continuity_last_rerouted_at': _serialize_access_exception_datetime(request_row.get('continuity_last_rerouted_at')),
        'continuity_last_reroute_by_id': int(request_row.get('continuity_last_reroute_by_id')) if request_row.get('continuity_last_reroute_by_id') else None,
        'continuity_last_reroute_from_user_id': int(request_row.get('continuity_last_reroute_from_user_id')) if request_row.get('continuity_last_reroute_from_user_id') else None,
        'continuity_last_reroute_note': str(request_row.get('continuity_last_reroute_note') or '')[:500],
        'expires_at': _serialize_access_exception_datetime(request_row.get('expires_at')),
        'role_ids': [int(value) for value in request_row.get('role_ids', [])],
        'team_ids': [int(value) for value in request_row.get('team_ids', [])],
        'granted_role_ids': [int(value) for value in request_row.get('granted_role_ids', [])],
        'granted_team_ids': [int(value) for value in request_row.get('granted_team_ids', [])],
        'reminder_offsets_sent': [int(value) for value in request_row.get('reminder_offsets_sent', []) if str(value).strip()],
        'approval_stage_history': [
            {
                'level': max(1, min(int(item.get('level') or 1), 2)),
                'label': str(item.get('label') or '')[:80],
                'approver_user_id': int(item.get('approver_user_id')) if item.get('approver_user_id') else None,
                'status': str(item.get('status') or 'queued'),
                'started_at': _serialize_access_exception_datetime(item.get('started_at')),
                'decided_at': _serialize_access_exception_datetime(item.get('decided_at')),
                'decision': str(item.get('decision') or ''),
                'decision_note': str(item.get('decision_note') or '')[:1000],
            }
            for item in request_row.get('approval_stage_history', [])
            if isinstance(item, dict)
        ],
        'approval_task_id': int(request_row.get('approval_task_id')) if request_row.get('approval_task_id') else None,
        'approval_task_source_key': str(request_row.get('approval_task_source_key') or ''),
    }


def _load_access_exception_requests():
    setting = (
        Setting.objects
        .filter(key=USER_ACCESS_EXCEPTION_REQUESTS_SETTING_KEY)
        .only('value')
        .first()
    )
    if setting is None or not str(setting.value or '').strip():
        return []
    try:
        raw_value = json.loads(setting.value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    if not isinstance(raw_value, list):
        return []

    request_rows = []
    for item in raw_value:
        if isinstance(item, dict) and item.get('key') and item.get('policy_key') and item.get('user_id') and item.get('requested_by_id'):
            request_rows.append(_serialize_access_exception_request_storage(item))
    return request_rows


def _save_access_exception_requests(request_rows):
    serialized = [
        _serialize_access_exception_request_storage(item)
        for item in request_rows
        if isinstance(item, dict)
    ]
    serialized.sort(
        key=lambda item: (
            str(item.get('status') or '') not in {'pending', 'approved'},
            -int(_parse_access_exception_datetime(item.get('requested_at')).timestamp()) if _parse_access_exception_datetime(item.get('requested_at')) else 0,
            str(item.get('key') or ''),
        )
    )
    Setting.objects.update_or_create(
        key=USER_ACCESS_EXCEPTION_REQUESTS_SETTING_KEY,
        defaults={
            'value': json.dumps(serialized, ensure_ascii=False),
            'data_type': 'json',
            'description': 'Access exception requests and approval workflow state.',
            'is_active': True,
        },
    )
    return serialized


def _serialize_access_exception_automation_policy_storage(config):
    payload = config if isinstance(config, dict) else {}
    reminder_offsets_days = []
    for value in payload.get('reminder_offsets_days', []):
        try:
            reminder_offsets_days.append(max(1, min(int(value), 45)))
        except (TypeError, ValueError):
            continue
    reminder_offsets_days = sorted(set(reminder_offsets_days), reverse=True)
    if not reminder_offsets_days:
        reminder_offsets_days = [7, 3, 1]

    renewal_window_days = payload.get('renewal_window_days', 5)
    try:
        renewal_window_days = max(1, min(int(renewal_window_days), 30))
    except (TypeError, ValueError):
        renewal_window_days = 5

    approval_warning_window_hours = payload.get('approval_warning_window_hours', 6)
    try:
        approval_warning_window_hours = max(1, min(int(approval_warning_window_hours), 72))
    except (TypeError, ValueError):
        approval_warning_window_hours = 6

    approval_escalation_delay_hours = payload.get('approval_escalation_delay_hours', 2)
    try:
        approval_escalation_delay_hours = max(1, min(int(approval_escalation_delay_hours), 72))
    except (TypeError, ValueError):
        approval_escalation_delay_hours = 2

    continuity_drill_interval_days = payload.get('continuity_drill_interval_days', 7)
    try:
        continuity_drill_interval_days = max(1, min(int(continuity_drill_interval_days), 30))
    except (TypeError, ValueError):
        continuity_drill_interval_days = 7

    continuity_drill_warning_days = payload.get('continuity_drill_warning_days', 2)
    try:
        continuity_drill_warning_days = max(1, min(int(continuity_drill_warning_days), 14))
    except (TypeError, ValueError):
        continuity_drill_warning_days = 2
    continuity_drill_warning_days = min(continuity_drill_warning_days, continuity_drill_interval_days)

    return {
        'enabled': bool(payload.get('enabled', True)),
        'auto_revoke_expired': bool(payload.get('auto_revoke_expired', True)),
        'reminder_offsets_days': reminder_offsets_days,
        'renewal_window_days': renewal_window_days,
        'notify_target_user': bool(payload.get('notify_target_user', True)),
        'notify_requested_by': bool(payload.get('notify_requested_by', True)),
        'notify_approver': bool(payload.get('notify_approver', False)),
        'approval_warning_window_hours': approval_warning_window_hours,
        'approval_escalation_delay_hours': approval_escalation_delay_hours,
        'notify_requester_for_sla': bool(payload.get('notify_requester_for_sla', True)),
        'notify_active_approver_for_sla': bool(payload.get('notify_active_approver_for_sla', True)),
        'notify_directory_owners_for_sla': bool(payload.get('notify_directory_owners_for_sla', True)),
        'continuity_drill_enabled': bool(payload.get('continuity_drill_enabled', True)),
        'continuity_drill_interval_days': continuity_drill_interval_days,
        'continuity_drill_warning_days': continuity_drill_warning_days,
        'notify_directory_owners_for_continuity': bool(payload.get('notify_directory_owners_for_continuity', True)),
        'auto_prepare_playbooks': bool(payload.get('auto_prepare_playbooks', True)),
    }


def _load_access_exception_automation_policy():
    setting = (
        Setting.objects
        .filter(key=USER_ACCESS_EXCEPTION_AUTOMATION_SETTING_KEY)
        .only('value')
        .first()
    )
    if setting is None or not str(setting.value or '').strip():
        return _serialize_access_exception_automation_policy_storage({})
    try:
        raw_value = json.loads(setting.value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return _serialize_access_exception_automation_policy_storage({})
    return _serialize_access_exception_automation_policy_storage(raw_value)


def _save_access_exception_automation_policy(config):
    payload = _serialize_access_exception_automation_policy_storage(config)
    Setting.objects.update_or_create(
        key=USER_ACCESS_EXCEPTION_AUTOMATION_SETTING_KEY,
        defaults={
            'value': json.dumps(payload, ensure_ascii=False),
            'data_type': 'json',
            'description': 'Automation policy for access exception reminders and expiry cleanup.',
            'is_active': True,
        },
    )
    return payload


def _serialize_access_exception_continuity_drill_state_storage(payload):
    safe_payload = payload if isinstance(payload, dict) else {}
    department_state_raw = safe_payload.get('departments')
    department_state = {}
    if isinstance(department_state_raw, dict):
        for department_key, item in department_state_raw.items():
            normalized_key = str(department_key or '').strip().lower().replace(' ', '-').replace('_', '-')[:50]
            if not normalized_key or not isinstance(item, dict):
                continue
            department_state[normalized_key] = {
                'department_key': normalized_key,
                'department_label': str(item.get('department_label') or normalized_key.title())[:120],
                'last_drill_at': _serialize_access_exception_datetime(item.get('last_drill_at')),
                'last_status': str(item.get('last_status') or '')[:40],
                'impacted_requests': max(0, int(item.get('impacted_requests') or 0)),
                'ready_to_reroute': max(0, int(item.get('ready_to_reroute') or 0)),
                'needs_manual': max(0, int(item.get('needs_manual') or 0)),
                'tested_approver_ids': sorted({
                    int(value)
                    for value in (item.get('tested_approver_ids') or [])
                    if value
                })[:12],
                'notes': str(item.get('notes') or '')[:280],
            }
    return {
        'last_run_at': _serialize_access_exception_datetime(safe_payload.get('last_run_at')),
        'last_run_mode': str(safe_payload.get('last_run_mode') or 'manual')[:20],
        'departments': department_state,
    }


def _load_access_exception_continuity_drill_state():
    setting = (
        Setting.objects
        .filter(key=USER_ACCESS_EXCEPTION_CONTINUITY_DRILL_SETTING_KEY)
        .only('value')
        .first()
    )
    if setting is None or not str(setting.value or '').strip():
        return _serialize_access_exception_continuity_drill_state_storage({})
    try:
        raw_value = json.loads(setting.value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return _serialize_access_exception_continuity_drill_state_storage({})
    return _serialize_access_exception_continuity_drill_state_storage(raw_value)


def _save_access_exception_continuity_drill_state(payload):
    serialized = _serialize_access_exception_continuity_drill_state_storage(payload)
    Setting.objects.update_or_create(
        key=USER_ACCESS_EXCEPTION_CONTINUITY_DRILL_SETTING_KEY,
        defaults={
            'value': json.dumps(serialized, ensure_ascii=False),
            'data_type': 'json',
            'description': 'Continuity drill snapshots for access exception coverage and fallback routing.',
            'is_active': True,
        },
    )
    return serialized


def _get_access_exception_planned_expires_at(request_row):
    row = _serialize_access_exception_request_storage(request_row)
    requested_at = _parse_access_exception_datetime(row.get('requested_at')) or django_timezone.now()
    approved_at = _parse_access_exception_datetime(row.get('approved_at'))
    expires_at = _parse_access_exception_datetime(row.get('expires_at'))
    if expires_at is not None:
        return expires_at
    if approved_at is not None:
        return approved_at + timedelta(days=int(row.get('duration_days') or 7))
    return requested_at + timedelta(days=int(row.get('duration_days') or 7))


def _is_access_exception_request_in_force(request_row, now=None):
    row = _serialize_access_exception_request_storage(request_row)
    if str(row.get('status') or '') != 'approved':
        return False
    planned_expires_at = _get_access_exception_planned_expires_at(row)
    if planned_expires_at is None:
        return True
    return planned_expires_at > (now or django_timezone.now())


def _get_access_exception_protected_access_ids(request_rows, user_id, exclude_request_keys=None, now=None):
    exclude_keys = {str(value or '').strip().lower() for value in (exclude_request_keys or []) if str(value or '').strip()}
    protected_role_ids = set()
    protected_team_ids = set()
    for raw_row in request_rows:
        row = _serialize_access_exception_request_storage(raw_row)
        if int(row.get('user_id') or 0) != int(user_id or 0):
            continue
        if str(row.get('key') or '').lower() in exclude_keys:
            continue
        if not _is_access_exception_request_in_force(row, now=now):
            continue
        protected_role_ids.update(row.get('granted_role_ids') or row.get('role_ids') or [])
        protected_team_ids.update(row.get('granted_team_ids') or row.get('team_ids') or [])
    return {
        'role_ids': sorted(protected_role_ids),
        'team_ids': sorted(protected_team_ids),
    }


def _get_access_exception_removable_access_ids(request_row, request_rows, now=None):
    row = _serialize_access_exception_request_storage(request_row)
    protected_ids = _get_access_exception_protected_access_ids(
        request_rows=request_rows,
        user_id=row.get('user_id'),
        exclude_request_keys=[row.get('key')],
        now=now,
    )
    granted_role_ids = set(row.get('granted_role_ids') or row.get('role_ids') or [])
    granted_team_ids = set(row.get('granted_team_ids') or row.get('team_ids') or [])
    return {
        'role_ids': sorted(granted_role_ids - set(protected_ids.get('role_ids', []))),
        'team_ids': sorted(granted_team_ids - set(protected_ids.get('team_ids', []))),
    }


def _build_access_exception_notification_recipients(request_row, target_user, requester_user, approver_user, automation_policy):
    recipients = []
    if automation_policy.get('notify_target_user', True) and target_user is not None:
        recipients.append(target_user)
    if automation_policy.get('notify_requested_by', True) and requester_user is not None:
        recipients.append(requester_user)
    if automation_policy.get('notify_approver', False) and approver_user is not None:
        recipients.append(approver_user)

    unique_recipients = []
    seen_ids = set()
    for user in recipients:
        if user is None or user.id in seen_ids:
            continue
        seen_ids.add(user.id)
        unique_recipients.append(user)
    return unique_recipients


def _create_access_exception_notification(recipient, actor, request_key, notification_type, title, message):
    if recipient is None:
        return None
    return Notification.objects.create(
        recipient=recipient,
        notification_type=notification_type,
        title=title[:255],
        message=message,
        entity_type='UserAccessExceptionRequest',
        entity_id=_get_access_exception_request_entity_id(request_key),
        actor=actor,
    )


def _build_access_exception_sla_notification_recipients(request_row, requester_user, active_approver_user, routing_rule, automation_policy, user_map):
    recipients = []
    if automation_policy.get('notify_active_approver_for_sla', True) and active_approver_user is not None:
        recipients.append(active_approver_user)
    if automation_policy.get('notify_requester_for_sla', True) and requester_user is not None:
        recipients.append(requester_user)
    if automation_policy.get('notify_directory_owners_for_sla', True) and routing_rule is not None:
        current_stage = int(request_row.get('active_stage_level') or request_row.get('current_stage') or 1)
        directory_user_ids = [
            routing_rule.get('stage_two_primary_user_id'),
            routing_rule.get('stage_two_delegate_user_id'),
        ] if current_stage > 1 else [
            routing_rule.get('stage_one_primary_user_id'),
            routing_rule.get('stage_one_delegate_user_id'),
        ]
        for user_id in directory_user_ids:
            user = user_map.get(int(user_id or 0))
            if user is not None:
                recipients.append(user)

    unique_recipients = []
    seen_ids = set()
    for user in recipients:
        if user is None or int(user.id) in seen_ids:
            continue
        seen_ids.add(int(user.id))
        unique_recipients.append(user)
    return unique_recipients


def _revoke_access_exception_request_row(
    request_row,
    request_rows_storage,
    request_index,
    target_user,
    actor=None,
    request=None,
    note='',
    revoked_at=None,
):
    now = revoked_at or django_timezone.now()
    normalized_request_row = _serialize_access_exception_request_storage(request_row)
    old_snapshot_serialized = _serialize_access_exception_request_storage(dict(normalized_request_row))

    old_access = _build_user_access_snapshot(target_user)
    removable_access_ids = _get_access_exception_removable_access_ids(
        request_row=normalized_request_row,
        request_rows=request_rows_storage,
        now=now,
    )
    next_role_ids = sorted(set(old_access['role_ids']) - set(removable_access_ids.get('role_ids', [])))
    next_team_ids = sorted(set(old_access['team_ids']) - set(removable_access_ids.get('team_ids', [])))

    access_changed_fields = []
    if next_role_ids != old_access['role_ids']:
        target_user.roles.set(next_role_ids)
        access_changed_fields.append('roles')
    if next_team_ids != old_access['team_ids']:
        target_user.teams.set(next_team_ids)
        access_changed_fields.append('teams')

    refreshed_user = User.objects.prefetch_related('roles', 'teams').get(pk=target_user.id)
    new_access = _build_user_access_snapshot(refreshed_user)
    if access_changed_fields:
        _create_user_access_audit_log(
            request=request,
            actor=actor,
            target_user=refreshed_user,
            old_snapshot=old_access,
            new_snapshot=new_access,
            changed_fields=access_changed_fields,
            strategy='remove',
        )

    normalized_request_row['status'] = 'revoked'
    normalized_request_row['revoked_by_id'] = actor.id if actor is not None else None
    normalized_request_row['revoked_at'] = now
    if str(note or '').strip():
        normalized_request_row['decision_note'] = str(note or '').strip()
    request_rows_storage[request_index] = normalized_request_row
    saved_request_rows = _save_access_exception_requests(request_rows_storage)
    new_snapshot_serialized = _serialize_access_exception_request_storage(normalized_request_row)
    _create_access_exception_audit_log(
        request=request,
        actor=actor,
        action='REVOKE',
        entity_type='UserAccessExceptionRequest',
        entity_id=_get_access_exception_request_entity_id(normalized_request_row['key']),
        entity_id_str=normalized_request_row['key'],
        entity_code=refreshed_user.username,
        old_values=old_snapshot_serialized,
        new_values=new_snapshot_serialized,
        changed_fields=['status', 'revoked_by_id', 'revoked_at', 'decision_note'],
    )
    return {
        'saved_request_rows': saved_request_rows,
        'request_row': normalized_request_row,
        'target_user': refreshed_user,
        'removed_role_ids': removable_access_ids.get('role_ids', []),
        'removed_team_ids': removable_access_ids.get('team_ids', []),
    }


def _reroute_access_exception_request_row(
    request_row,
    request_rows_storage,
    request_index,
    actor,
    request=None,
    approver_user_id=None,
    note='',
):
    normalized_request_row = _serialize_access_exception_request_storage(request_row)
    if str(normalized_request_row.get('status') or '') != 'pending':
        raise ValueError('Chi co the reroute request dang pending.')

    current_stage_level = max(1, min(int(normalized_request_row.get('active_stage_level') or 1), int(normalized_request_row.get('approval_stage_count') or 1)))
    current_active_approver_id = int(normalized_request_row.get('active_approver_user_id') or 0)
    if not current_active_approver_id:
        raise ValueError('Request nay chua co active approver de reroute.')

    policy = next((item for item in _load_access_exception_policies() if item.get('key') == normalized_request_row.get('policy_key')), None)
    if policy is None:
        raise LookupError('Khong tim thay policy cua request.')

    target_user = User.objects.prefetch_related('roles', 'teams').filter(id=normalized_request_row['user_id']).first()
    if target_user is None:
        raise LookupError('Khong tim thay target user cua request.')
    requester_user = User.objects.prefetch_related('roles', 'teams').filter(id=normalized_request_row.get('requested_by_id')).first() or actor
    approver_candidates = _build_access_exception_approver_users(limit=40)

    if approver_user_id:
        next_approver = _find_access_exception_approver_user(approver_user_id, candidates=approver_candidates)
        routing_source = 'manual'
        resolution_kind = 'manual'
        resolution_label = _label_access_exception_resolution_kind('manual')
        coverage_note = str(note or '').strip()
    else:
        routing_plan = _build_access_exception_routing_plan(
            policy=policy,
            target_user=target_user,
            requester=requester_user,
            approver_candidates=approver_candidates,
        )
        next_approver = (
            routing_plan.get('selected_stage_two_user')
            if current_stage_level > 1 else routing_plan.get('selected_stage_one_user')
        )
        routing_source = (
            str(routing_plan.get('selected_stage_two_source') or '')
            if current_stage_level > 1 else str(routing_plan.get('selected_stage_one_source') or '')
        )
        resolution_kind = (
            str(routing_plan.get('selected_stage_two_resolution_kind') or '')
            if current_stage_level > 1 else str(routing_plan.get('selected_stage_one_resolution_kind') or '')
        )
        resolution_label = (
            str(routing_plan.get('selected_stage_two_resolution_label') or '')
            if current_stage_level > 1 else str(routing_plan.get('selected_stage_one_resolution_label') or '')
        )
        coverage_note = (
            str(routing_plan.get('selected_stage_two_coverage_note') or '')
            if current_stage_level > 1 else str(routing_plan.get('selected_stage_one_coverage_note') or '')
        )
    if next_approver is None:
        raise ValueError('Khong tim thay approver thay the hop le cho reroute.')
    if int(next_approver.id) == current_active_approver_id:
        raise ValueError('Approver thay the dang trung voi active approver hien tai.')
    if int(next_approver.id) == int(target_user.id):
        raise ValueError('Khong the reroute cho chinh target user.')
    if current_stage_level > 1 and int(normalized_request_row.get('approver_user_id') or 0) == int(next_approver.id):
        raise ValueError('Stage 2 approver can doc lap voi stage 1 approver.')

    old_snapshot_serialized = _serialize_access_exception_request_storage(dict(normalized_request_row))
    approval_stage_history = [
        {
            'level': max(1, min(int(item.get('level') or 1), 2)),
            'label': str(item.get('label') or '')[:80],
            'approver_user_id': int(item.get('approver_user_id')) if item.get('approver_user_id') else None,
            'status': str(item.get('status') or 'queued'),
            'started_at': item.get('started_at'),
            'decided_at': item.get('decided_at'),
            'decision': str(item.get('decision') or ''),
            'decision_note': str(item.get('decision_note') or '')[:1000],
        }
        for item in normalized_request_row.get('approval_stage_history', [])
        if isinstance(item, dict)
    ]
    stage_index = next(
        (
            index
            for index, item in enumerate(approval_stage_history)
            if int(item.get('level') or 1) == current_stage_level
        ),
        None,
    )
    if stage_index is None:
        raise ValueError('Khong tim thay approval stage dang active.')

    approval_stage_history[stage_index]['approver_user_id'] = next_approver.id
    normalized_request_row['approval_stage_history'] = approval_stage_history
    normalized_request_row['active_approver_user_id'] = next_approver.id
    if current_stage_level > 1:
        normalized_request_row['stage_two_approver_user_id'] = next_approver.id
        normalized_request_row['routing_stage_two_source'] = routing_source
        normalized_request_row['routing_stage_two_resolution_kind'] = resolution_kind
        normalized_request_row['routing_stage_two_resolution_label'] = resolution_label
        normalized_request_row['routing_stage_two_coverage_note'] = coverage_note
    else:
        normalized_request_row['approver_user_id'] = next_approver.id
        normalized_request_row['routing_stage_one_source'] = routing_source
        normalized_request_row['routing_stage_one_resolution_kind'] = resolution_kind
        normalized_request_row['routing_stage_one_resolution_label'] = resolution_label
        normalized_request_row['routing_stage_one_coverage_note'] = coverage_note
    normalized_request_row['continuity_reroute_count'] = int(normalized_request_row.get('continuity_reroute_count') or 0) + 1
    normalized_request_row['continuity_last_rerouted_at'] = django_timezone.now()
    normalized_request_row['continuity_last_reroute_by_id'] = actor.id if actor is not None else None
    normalized_request_row['continuity_last_reroute_from_user_id'] = current_active_approver_id
    normalized_request_row['continuity_last_reroute_note'] = (
        str(note or '').strip()
        or coverage_note
        or f'Rerouted stage {current_stage_level} approver.'
    )[:500]

    with transaction.atomic():
        if normalized_request_row.get('approval_task_id'):
            task = Task.objects.filter(id=normalized_request_row['approval_task_id']).first()
            if task is not None and task.status in {Task.STATUS_TODO, Task.STATUS_IN_PROGRESS}:
                task.assigned_to = next_approver
                if actor is not None:
                    task.assigned_by = actor
                    task.save(update_fields=['assigned_to', 'assigned_by', 'updated_at'])
                else:
                    task.save(update_fields=['assigned_to', 'updated_at'])
        request_rows_storage[request_index] = normalized_request_row
        saved_request_rows = _save_access_exception_requests(request_rows_storage)

    changed_fields = [
        'approval_stage_history',
        'active_approver_user_id',
        'continuity_reroute_count',
        'continuity_last_rerouted_at',
        'continuity_last_reroute_by_id',
        'continuity_last_reroute_from_user_id',
        'continuity_last_reroute_note',
    ]
    if current_stage_level > 1:
        changed_fields.extend([
            'stage_two_approver_user_id',
            'routing_stage_two_source',
            'routing_stage_two_resolution_kind',
            'routing_stage_two_resolution_label',
            'routing_stage_two_coverage_note',
        ])
    else:
        changed_fields.extend([
            'approver_user_id',
            'routing_stage_one_source',
            'routing_stage_one_resolution_kind',
            'routing_stage_one_resolution_label',
            'routing_stage_one_coverage_note',
        ])

    new_snapshot_serialized = _serialize_access_exception_request_storage(normalized_request_row)
    _create_access_exception_audit_log(
        request=request,
        actor=actor,
        action='UPDATE',
        entity_type='UserAccessExceptionRequest',
        entity_id=_get_access_exception_request_entity_id(normalized_request_row['key']),
        entity_id_str=normalized_request_row['key'],
        entity_code=target_user.username,
        old_values=old_snapshot_serialized,
        new_values=new_snapshot_serialized,
        changed_fields=changed_fields,
    )
    return {
        'saved_request_rows': saved_request_rows,
        'request_row': normalized_request_row,
        'target_user': target_user,
        'next_approver': next_approver,
        'routing_source': routing_source,
        'resolution_kind': resolution_kind,
        'resolution_label': resolution_label,
        'coverage_note': coverage_note,
    }


def _get_access_exception_risk_meta(risk_level):
    key = str(risk_level or 'standard')
    items = {
        'standard': {
            'label': 'Standard',
            'description': 'Ngoai le thong thuong cho nhu cau van hanh ngan han.',
            'severity': 'info',
        },
        'elevated': {
            'label': 'Elevated',
            'description': 'Can ly do ro rang va review ky vi co tac dong rong hon.',
            'severity': 'warning',
        },
        'critical': {
            'label': 'Critical',
            'description': 'Can ticket va approval chat che vi day la ngoai le rui ro cao.',
            'severity': 'error',
        },
    }
    return items.get(key, items['standard'])


def _get_access_exception_request_risk_meta(score):
    safe_score = max(0, min(int(score or 0), 100))
    if safe_score >= 80:
        return {
            'band': 'critical',
            'label': 'Critical',
            'severity': 'error',
        }
    if safe_score >= 60:
        return {
            'band': 'high',
            'label': 'High',
            'severity': 'error',
        }
    if safe_score >= 35:
        return {
            'band': 'guarded',
            'label': 'Guarded',
            'severity': 'warning',
        }
    return {
        'band': 'low',
        'label': 'Low',
        'severity': 'info',
    }


def _get_access_exception_policy_debt_meta(score):
    safe_score = max(0, min(int(score or 0), 100))
    if safe_score >= 75:
        return {
            'status': 'critical',
            'label': 'Critical debt',
            'severity': 'error',
        }
    if safe_score >= 40:
        return {
            'status': 'watch',
            'label': 'Debt watch',
            'severity': 'warning',
        }
    return {
        'status': 'healthy',
        'label': 'Healthy',
        'severity': 'success',
    }


def _build_access_exception_approver_users(limit=24):
    safe_limit = max(1, min(int(limit or 24), 60))
    candidates = []
    queryset = _annotate_user_directory_queryset(
        User.objects
        .filter(is_active=True)
        .prefetch_related('roles__permissions', 'teams')
        .order_by('-is_staff', 'first_name', 'last_name', 'username')
    )
    for user in queryset[:safe_limit * 4]:
        if getattr(user, 'is_locked', False):
            continue
        if not _can_manage_user_directory(user):
            continue
        candidates.append(user)
        if len(candidates) >= safe_limit:
            break
    return candidates


def _build_access_exception_approver_candidate_rows(limit=24):
    availability_map = _get_access_exception_approver_availability_map()
    items = []
    for user in _build_access_exception_approver_users(limit=limit):
        access_snapshot = _build_user_access_snapshot(user)
        availability_entry = availability_map.get(int(user.id))
        items.append({
            'id': user.id,
            'username': user.username,
            'full_name': user.get_full_name() or user.username,
            'email': user.email or '',
            'is_staff': bool(user.is_staff),
            'active_session_count': int(getattr(user, 'active_session_count', 0) or 0),
            'role_count': len(access_snapshot['roles']),
            'team_count': len(access_snapshot['teams']),
            'teams': access_snapshot['teams'],
            'is_out_of_office': _is_access_exception_approver_out_of_office(availability_entry),
            'availability_window': _format_access_exception_availability_window(availability_entry) if availability_entry else '',
            'availability_label': str((availability_entry or {}).get('label') or ''),
        })
    return items


def _serialize_access_exception_approver_reference(user):
    if user is None:
        return None
    team_rows = _serialize_onboarding_team_rows(_get_prefetched_user_relation_rows(user, 'teams'))
    availability_entry = _get_access_exception_approver_availability_map().get(int(user.id))
    return {
        'id': user.id,
        'username': user.username,
        'full_name': user.get_full_name() or user.username,
        'email': user.email or '',
        'team_count': len(team_rows),
        'teams': team_rows,
        'is_out_of_office': _is_access_exception_approver_out_of_office(availability_entry),
        'availability_label': str((availability_entry or {}).get('label') or ''),
        'availability_window': _format_access_exception_availability_window(availability_entry) if availability_entry else '',
    }


def _find_access_exception_approver_user(approver_user_id, candidates=None):
    if not approver_user_id:
        return None
    safe_candidates = list(candidates or _build_access_exception_approver_users(limit=40))
    try:
        target_id = int(approver_user_id)
    except (TypeError, ValueError):
        return None
    return next((user for user in safe_candidates if user.id == target_id), None)


def _match_access_exception_team_tokens(team_rows, preferred_tokens):
    normalized_tokens = [str(item or '').strip().upper() for item in preferred_tokens if str(item or '').strip()]
    if not normalized_tokens:
        return []
    matches = []
    for team in team_rows:
        haystacks = [
            str(getattr(team, 'code', '') or '').upper(),
            str(getattr(team, 'name', '') or '').upper(),
        ]
        if any(token in haystack for token in normalized_tokens for haystack in haystacks):
            matches.append(team)
    return matches


def _build_access_exception_candidate_pick(user, target_teams, requester, preferred_team_tokens, extra=None):
    if user is None:
        return None
    user_team_rows = _get_prefetched_user_relation_rows(user, 'teams')
    return {
        'user': user,
        'team_rows': user_team_rows,
        'shared_team_rows': [
            team
            for team in user_team_rows
            if any(int(team.id) == int(target_team['id']) for target_team in target_teams)
        ],
        'preferred_team_rows': _match_access_exception_team_tokens(
            user_team_rows,
            preferred_team_tokens,
        ),
        'requester_overlap': bool(getattr(requester, 'id', None) and int(user.id) == int(requester.id)),
        **(extra or {}),
    }


def _pick_access_exception_directory_candidate(directory_user_ids, candidates, target_user, requester, excluded_ids=None, preferred_team_tokens=None, avoid_shared_team=False, availability_rows=None, stage_level=1, unavailable_user_ids=None):
    safe_entries = []
    for index, value in enumerate(directory_user_ids or []):
        try:
            normalized = int(value)
        except (TypeError, ValueError):
            continue
        if any(item['user_id'] == normalized for item in safe_entries):
            continue
        safe_entries.append({
            'user_id': normalized,
            'resolution_kind': 'primary' if index == 0 else 'delegate' if index == 1 else 'rotation',
        })
    if not safe_entries:
        return None
    candidate_map = {int(user.id): user for user in candidates}
    availability_map = _get_access_exception_approver_availability_map(availability_rows)
    target_teams = _serialize_onboarding_team_rows(_get_prefetched_user_relation_rows(target_user, 'teams'))
    normalized_excluded_ids = {
        int(value)
        for value in (excluded_ids or set())
        if value
    }
    normalized_unavailable_ids = {
        int(value)
        for value in (unavailable_user_ids or set())
        if value
    }
    skipped_unavailable = []
    for entry in safe_entries:
        user_id = int(entry['user_id'])
        user = candidate_map.get(user_id)
        if user is None or int(user.id) in normalized_excluded_ids:
            continue
        if int(user.id) in normalized_unavailable_ids:
            skipped_unavailable.append(_build_access_exception_simulated_absence_note(user))
            continue
        availability_entry = availability_map.get(int(user.id))
        if _is_access_exception_approver_out_of_office(availability_entry):
            skipped_unavailable.append(_build_access_exception_out_of_office_note(user, availability_entry))
            backup_user_id = int((availability_entry or {}).get('backup_user_id') or 0)
            backup_user = candidate_map.get(backup_user_id)
            if (
                backup_user is not None
                and int(backup_user.id) not in normalized_excluded_ids
                and int(backup_user.id) not in normalized_unavailable_ids
            ):
                pick = _build_access_exception_candidate_pick(
                    user=backup_user,
                    target_teams=target_teams,
                    requester=requester,
                    preferred_team_tokens=preferred_team_tokens or [],
                    extra={
                        'resolution_kind': 'backup',
                        'resolution_label': _label_access_exception_resolution_kind('backup'),
                        'coverage_note': _build_access_exception_out_of_office_note(user, availability_entry),
                        'source_user_id': int(user.id),
                        'source_stage_level': int(stage_level or 1),
                    },
                )
                if avoid_shared_team and pick.get('shared_team_rows'):
                    continue
                return pick
            continue
        pick = _build_access_exception_candidate_pick(
            user=user,
            target_teams=target_teams,
            requester=requester,
            preferred_team_tokens=preferred_team_tokens or [],
            extra={
                'resolution_kind': entry['resolution_kind'],
                'resolution_label': _label_access_exception_resolution_kind(entry['resolution_kind']),
                'coverage_note': skipped_unavailable[0] if skipped_unavailable else '',
                'source_user_id': int(user.id),
                'source_stage_level': int(stage_level or 1),
            },
        )
        if avoid_shared_team and pick.get('shared_team_rows'):
            continue
        return pick
    return None


def _get_access_exception_routing_mode_sequence(mode, stage_level=1):
    normalized_mode = str(mode or '').strip().lower()
    if int(stage_level or 1) > 1:
        mapping = {
            'directory_then_independent': ['directory', 'independent-team', 'pool'],
            'independent_team_then_directory': ['independent-team', 'directory', 'pool'],
            'directory_only': ['directory'],
            'independent_team_match': ['independent-team', 'pool'],
            'governance_pool': ['pool'],
        }
        return mapping.get(normalized_mode, ['directory', 'independent-team', 'pool'])
    mapping = {
        'directory_then_team': ['directory', 'team-match', 'pool'],
        'team_then_directory': ['team-match', 'directory', 'pool'],
        'directory_only': ['directory'],
        'team_match': ['team-match', 'pool'],
        'governance_pool': ['pool'],
    }
    return mapping.get(normalized_mode, ['directory', 'team-match', 'pool'])


def _label_access_exception_routing_source(source_key):
    mapping = {
        'manual': 'Manual override',
        'directory': 'Department directory',
        'team-match': 'Team matching fallback',
        'independent-team': 'Independent team fallback',
        'pool': 'Governance pool fallback',
        'none': 'No approver resolved',
    }
    return mapping.get(str(source_key or '').strip().lower(), 'Governance routing')


def _pick_access_exception_routing_candidate(candidates, target_user, requester, excluded_ids=None, preferred_team_tokens=None, prefer_shared_team=False, avoid_shared_team=False, availability_rows=None, unavailable_user_ids=None):
    target_team_rows = _get_prefetched_user_relation_rows(target_user, 'teams')
    target_team_ids = {int(item.id) for item in target_team_rows}
    safe_preferred_tokens = [str(item or '').strip().upper() for item in (preferred_team_tokens or []) if str(item or '').strip()]
    availability_map = _get_access_exception_approver_availability_map(availability_rows)
    normalized_excluded_ids = {
        int(value)
        for value in (excluded_ids or set())
        if value
    }
    normalized_unavailable_ids = {
        int(value)
        for value in (unavailable_user_ids or set())
        if value
    }
    if getattr(target_user, 'id', None):
        normalized_excluded_ids.add(int(target_user.id))

    ranked_candidates = []
    for user in candidates:
        if int(user.id) in normalized_excluded_ids or int(user.id) in normalized_unavailable_ids:
            continue
        if _is_access_exception_approver_out_of_office(availability_map.get(int(user.id))):
            continue
        team_rows = _get_prefetched_user_relation_rows(user, 'teams')
        shared_team_rows = [team for team in team_rows if int(team.id) in target_team_ids]
        preferred_team_rows = _match_access_exception_team_tokens(team_rows, safe_preferred_tokens)
        ranking = (
            0 if (shared_team_rows if prefer_shared_team else not shared_team_rows or not avoid_shared_team) else 1,
            0 if preferred_team_rows else 1,
            0 if bool(getattr(user, 'is_staff', False)) else 1,
            -int(getattr(user, 'active_session_count', 0) or 0),
            str(user.get_full_name() or user.username or ''),
        )
        if avoid_shared_team and shared_team_rows:
            ranking = (
                1,
                0 if preferred_team_rows else 1,
                0 if bool(getattr(user, 'is_staff', False)) else 1,
                -int(getattr(user, 'active_session_count', 0) or 0),
                str(user.get_full_name() or user.username or ''),
            )
        ranked_candidates.append({
            'user': user,
            'team_rows': team_rows,
            'shared_team_rows': shared_team_rows,
            'preferred_team_rows': preferred_team_rows,
            'resolution_kind': 'fallback',
            'resolution_label': _label_access_exception_resolution_kind('fallback'),
            'coverage_note': '',
            'ranking': ranking,
            'requester_overlap': bool(getattr(requester, 'id', None) and int(user.id) == int(requester.id)),
        })

    ranked_candidates.sort(key=lambda item: item['ranking'])
    return ranked_candidates[0] if ranked_candidates else None


def _build_access_exception_routing_plan(policy, target_user, requester, explicit_stage_one_approver=None, explicit_stage_two_approver=None, approver_candidates=None, unavailable_user_ids=None):
    policy_payload = _serialize_access_exception_policy_storage(policy)
    requires_approval = bool(policy_payload.get('requires_approval', True))
    approval_stage_count = int(policy_payload.get('approval_stage_count') or 1) if requires_approval else 0
    candidates = list(approver_candidates or _build_access_exception_approver_users(limit=40))
    routing_rule = _get_access_exception_routing_rule(policy_payload.get('department_key'))
    availability_rows = _load_access_exception_approver_availability()
    target_teams = _serialize_onboarding_team_rows(_get_prefetched_user_relation_rows(target_user, 'teams'))
    effective_team_tokens = list((routing_rule or {}).get('fallback_team_tokens') or policy_payload.get('preferred_team_tokens', []))
    excluded_ids = {getattr(requester, 'id', None), getattr(target_user, 'id', None)}
    normalized_unavailable_user_ids = {
        int(value)
        for value in (unavailable_user_ids or set())
        if value
    }
    stage_one_pick = None
    stage_two_pick = None
    stage_one_source = 'none'
    stage_two_source = 'none'

    if requires_approval:
        if explicit_stage_one_approver is not None:
            stage_one_pick = _build_access_exception_candidate_pick(
                user=explicit_stage_one_approver,
                target_teams=target_teams,
                requester=requester,
                preferred_team_tokens=effective_team_tokens,
                extra={
                    'resolution_kind': 'manual',
                    'resolution_label': _label_access_exception_resolution_kind('manual'),
                    'coverage_note': '',
                },
            )
            stage_one_source = 'manual'
        else:
            stage_one_directory_ids = [
                (routing_rule or {}).get('stage_one_primary_user_id'),
                (routing_rule or {}).get('stage_one_delegate_user_id'),
                *list((routing_rule or {}).get('stage_one_rotation_user_ids') or []),
            ] if (routing_rule or {}).get('is_active', True) else []
            stage_one_mode = (routing_rule or {}).get('stage_one_mode') or 'team_match'
            for source in _get_access_exception_routing_mode_sequence(stage_one_mode, stage_level=1):
                if source == 'directory':
                    stage_one_pick = _pick_access_exception_directory_candidate(
                        directory_user_ids=stage_one_directory_ids,
                        candidates=candidates,
                        target_user=target_user,
                        requester=requester,
                        excluded_ids=excluded_ids,
                        preferred_team_tokens=effective_team_tokens,
                        avoid_shared_team=False,
                        availability_rows=availability_rows,
                        stage_level=1,
                        unavailable_user_ids=normalized_unavailable_user_ids,
                    )
                elif source == 'team-match':
                    stage_one_pick = _pick_access_exception_routing_candidate(
                        candidates=candidates,
                        target_user=target_user,
                        requester=requester,
                        excluded_ids=excluded_ids,
                        preferred_team_tokens=effective_team_tokens,
                        prefer_shared_team=bool(target_teams),
                        avoid_shared_team=False,
                        availability_rows=availability_rows,
                        unavailable_user_ids=normalized_unavailable_user_ids,
                    )
                else:
                    stage_one_pick = _pick_access_exception_routing_candidate(
                        candidates=candidates,
                        target_user=target_user,
                        requester=requester,
                        excluded_ids=excluded_ids,
                        preferred_team_tokens=[],
                        prefer_shared_team=False,
                        avoid_shared_team=False,
                        availability_rows=availability_rows,
                        unavailable_user_ids=normalized_unavailable_user_ids,
                    )
                if stage_one_pick is not None:
                    stage_one_source = source
                    break

    selected_stage_one = explicit_stage_one_approver or (stage_one_pick or {}).get('user')
    if selected_stage_one is not None:
        excluded_ids.add(int(selected_stage_one.id))

    if requires_approval and approval_stage_count > 1:
        if explicit_stage_two_approver is not None:
            stage_two_pick = _build_access_exception_candidate_pick(
                user=explicit_stage_two_approver,
                target_teams=target_teams,
                requester=requester,
                preferred_team_tokens=effective_team_tokens,
                extra={
                    'resolution_kind': 'manual',
                    'resolution_label': _label_access_exception_resolution_kind('manual'),
                    'coverage_note': '',
                },
            )
            stage_two_source = 'manual'
        else:
            stage_two_directory_ids = [
                (routing_rule or {}).get('stage_two_primary_user_id'),
                (routing_rule or {}).get('stage_two_delegate_user_id'),
                *list((routing_rule or {}).get('stage_two_rotation_user_ids') or []),
            ] if (routing_rule or {}).get('is_active', True) else []
            stage_two_mode = (routing_rule or {}).get('stage_two_mode') or 'independent_team_match'
            for source in _get_access_exception_routing_mode_sequence(stage_two_mode, stage_level=2):
                if source == 'directory':
                    stage_two_pick = _pick_access_exception_directory_candidate(
                        directory_user_ids=stage_two_directory_ids,
                        candidates=candidates,
                        target_user=target_user,
                        requester=requester,
                        excluded_ids=excluded_ids,
                        preferred_team_tokens=effective_team_tokens,
                        avoid_shared_team=bool(policy_payload.get('require_independent_stage_two', True)),
                        availability_rows=availability_rows,
                        stage_level=2,
                        unavailable_user_ids=normalized_unavailable_user_ids,
                    )
                elif source == 'independent-team':
                    stage_two_pick = _pick_access_exception_routing_candidate(
                        candidates=candidates,
                        target_user=target_user,
                        requester=requester,
                        excluded_ids=excluded_ids,
                        preferred_team_tokens=effective_team_tokens,
                        prefer_shared_team=False,
                        avoid_shared_team=bool(policy_payload.get('require_independent_stage_two', True)),
                        availability_rows=availability_rows,
                        unavailable_user_ids=normalized_unavailable_user_ids,
                    )
                else:
                    stage_two_pick = _pick_access_exception_routing_candidate(
                        candidates=candidates,
                        target_user=target_user,
                        requester=requester,
                        excluded_ids=excluded_ids,
                        preferred_team_tokens=[],
                        prefer_shared_team=False,
                        avoid_shared_team=bool(policy_payload.get('require_independent_stage_two', True)),
                        availability_rows=availability_rows,
                        unavailable_user_ids=normalized_unavailable_user_ids,
                    )
                if stage_two_pick is not None:
                    stage_two_source = source
                    break

    selected_stage_two = explicit_stage_two_approver or (stage_two_pick or {}).get('user')
    routing_warnings = []
    if requires_approval and not target_teams:
        routing_warnings.append('Target chua gan team ro rang, delegated routing se fallback sang governance pool.')
    if requires_approval and routing_rule is not None and not bool(routing_rule.get('is_active', True)):
        routing_warnings.append('Department routing directory dang tam dung, he thong fallback sang team matching/governance pool.')
    if requires_approval and routing_rule is not None and stage_one_source in {'team-match', 'pool'} and not (
        routing_rule.get('stage_one_primary_user_id') or routing_rule.get('stage_one_delegate_user_id')
    ):
        routing_warnings.append('Department routing directory chua gan stage 1 owner, dang fallback sang matching pool.')
    if requires_approval and approval_stage_count > 1 and routing_rule is not None and stage_two_source in {'independent-team', 'pool'} and not (
        routing_rule.get('stage_two_primary_user_id') or routing_rule.get('stage_two_delegate_user_id')
    ):
        routing_warnings.append('Department routing directory chua gan stage 2 owner, dang fallback sang matching pool.')
    if requires_approval and selected_stage_one is None:
        routing_warnings.append('Chua tim thay approver phu hop cho stage 1.')
    if requires_approval and approval_stage_count > 1 and selected_stage_two is None:
        routing_warnings.append('Chua tim thay approver doc lap cho stage 2.')
    if requires_approval and explicit_stage_one_approver is not None and getattr(requester, 'id', None) and int(explicit_stage_one_approver.id) == int(requester.id):
        routing_warnings.append('Stage 1 approver dang trung voi requester.')
    if requires_approval and approval_stage_count > 1 and selected_stage_one is not None and selected_stage_two is not None and int(selected_stage_one.id) == int(selected_stage_two.id):
        routing_warnings.append('Stage 2 approver dang trung voi stage 1 approver.')
    if requires_approval and approval_stage_count > 1 and stage_two_pick is not None and stage_two_pick.get('shared_team_rows') and policy_payload.get('require_independent_stage_two', True):
        routing_warnings.append('Stage 2 approver hien van cung team voi target, nen review lai de dam bao tach lop phe duyet.')
    if requires_approval and stage_one_pick is not None and str(stage_one_pick.get('coverage_note') or '').strip():
        routing_warnings.append(str(stage_one_pick.get('coverage_note') or ''))
    if requires_approval and approval_stage_count > 1 and stage_two_pick is not None and str(stage_two_pick.get('coverage_note') or '').strip():
        routing_warnings.append(str(stage_two_pick.get('coverage_note') or ''))

    return {
        'department_key': policy_payload.get('department_key') or 'general',
        'department_label': policy_payload.get('department_label') or 'General governance',
        'routing_summary': policy_payload.get('routing_summary') or '',
        'stage_one_strategy_label': policy_payload.get('stage_one_strategy_label') or 'Approver gan voi team cua target',
        'stage_two_strategy_label': policy_payload.get('stage_two_strategy_label') or '',
        'target_teams': target_teams,
        'preferred_team_tokens': list(effective_team_tokens),
        'routing_rule_active': bool((routing_rule or {}).get('is_active', True)),
        'routing_rule_notes': str((routing_rule or {}).get('notes') or ''),
        'routing_rule_pack_keys': list((routing_rule or {}).get('pack_keys', [])),
        'suggested_stage_one_approver': _serialize_access_exception_approver_reference((stage_one_pick or {}).get('user')),
        'suggested_stage_two_approver': _serialize_access_exception_approver_reference((stage_two_pick or {}).get('user')),
        'selected_stage_one_approver': _serialize_access_exception_approver_reference(selected_stage_one),
        'selected_stage_two_approver': _serialize_access_exception_approver_reference(selected_stage_two),
        'selected_stage_one_source': stage_one_source,
        'selected_stage_two_source': stage_two_source,
        'selected_stage_one_source_label': _label_access_exception_routing_source(stage_one_source),
        'selected_stage_two_source_label': _label_access_exception_routing_source(stage_two_source),
        'selected_stage_one_resolution_kind': str((stage_one_pick or {}).get('resolution_kind') or ('manual' if explicit_stage_one_approver is not None else '')),
        'selected_stage_two_resolution_kind': str((stage_two_pick or {}).get('resolution_kind') or ('manual' if explicit_stage_two_approver is not None else '')),
        'selected_stage_one_resolution_label': str((stage_one_pick or {}).get('resolution_label') or ('Manual override' if explicit_stage_one_approver is not None else '')),
        'selected_stage_two_resolution_label': str((stage_two_pick or {}).get('resolution_label') or ('Manual override' if explicit_stage_two_approver is not None else '')),
        'selected_stage_one_coverage_note': str((stage_one_pick or {}).get('coverage_note') or ''),
        'selected_stage_two_coverage_note': str((stage_two_pick or {}).get('coverage_note') or ''),
        'auto_selected_stage_one': bool(requires_approval and explicit_stage_one_approver is None and selected_stage_one is not None),
        'auto_selected_stage_two': bool(requires_approval and approval_stage_count > 1 and explicit_stage_two_approver is None and selected_stage_two is not None),
        'warnings': routing_warnings,
        'selected_stage_one_user': selected_stage_one,
        'selected_stage_two_user': selected_stage_two,
    }


def _serialize_access_exception_routing_plan(routing_plan):
    if not isinstance(routing_plan, dict):
        return None
    return {
        'department_key': str(routing_plan.get('department_key') or 'general')[:50],
        'department_label': str(routing_plan.get('department_label') or 'General governance')[:120],
        'routing_summary': str(routing_plan.get('routing_summary') or '')[:280],
        'stage_one_strategy_label': str(routing_plan.get('stage_one_strategy_label') or '')[:120],
        'stage_two_strategy_label': str(routing_plan.get('stage_two_strategy_label') or '')[:120],
        'routing_rule_active': bool(routing_plan.get('routing_rule_active', True)),
        'routing_rule_notes': str(routing_plan.get('routing_rule_notes') or '')[:280],
        'routing_rule_pack_keys': list(routing_plan.get('routing_rule_pack_keys', []))[:8],
        'target_teams': list(routing_plan.get('target_teams', [])),
        'preferred_team_tokens': list(routing_plan.get('preferred_team_tokens', []))[:8],
        'suggested_stage_one_approver': routing_plan.get('suggested_stage_one_approver'),
        'suggested_stage_two_approver': routing_plan.get('suggested_stage_two_approver'),
        'selected_stage_one_approver': routing_plan.get('selected_stage_one_approver'),
        'selected_stage_two_approver': routing_plan.get('selected_stage_two_approver'),
        'selected_stage_one_source': str(routing_plan.get('selected_stage_one_source') or 'none')[:40],
        'selected_stage_two_source': str(routing_plan.get('selected_stage_two_source') or 'none')[:40],
        'selected_stage_one_source_label': str(routing_plan.get('selected_stage_one_source_label') or '')[:80],
        'selected_stage_two_source_label': str(routing_plan.get('selected_stage_two_source_label') or '')[:80],
        'selected_stage_one_resolution_kind': str(routing_plan.get('selected_stage_one_resolution_kind') or '')[:40],
        'selected_stage_two_resolution_kind': str(routing_plan.get('selected_stage_two_resolution_kind') or '')[:40],
        'selected_stage_one_resolution_label': str(routing_plan.get('selected_stage_one_resolution_label') or '')[:80],
        'selected_stage_two_resolution_label': str(routing_plan.get('selected_stage_two_resolution_label') or '')[:80],
        'selected_stage_one_coverage_note': str(routing_plan.get('selected_stage_one_coverage_note') or '')[:200],
        'selected_stage_two_coverage_note': str(routing_plan.get('selected_stage_two_coverage_note') or '')[:200],
        'auto_selected_stage_one': bool(routing_plan.get('auto_selected_stage_one', False)),
        'auto_selected_stage_two': bool(routing_plan.get('auto_selected_stage_two', False)),
        'warnings': list(routing_plan.get('warnings', []))[:6],
    }


def _get_access_exception_approver_user(requester, approver_user_id=None):
    candidates = _build_access_exception_approver_users(limit=40)
    if approver_user_id:
        return next((user for user in candidates if user.id == int(approver_user_id)), None)
    preferred = next((user for user in candidates if user.id != requester.id), None)
    if preferred is not None:
        return preferred
    return next((user for user in candidates if user.id == requester.id), None)


def _create_access_exception_approval_task(request_key, target_user, approver, requested_by, policy, duration_days, stage_level=1, stage_label='Approval review'):
    source_key = f'access-exception-approval-{request_key}-s{int(stage_level or 1)}'
    existing_task = Task.objects.filter(source_key=source_key).first()
    if existing_task is not None:
        return existing_task

    risk_level = str(policy.get('risk_level') or 'standard')
    return Task.objects.create(
        entity_type='User',
        entity_id=target_user.id,
        entity_code=target_user.username,
        title=f'Phe duyet stage {int(stage_level or 1)} cho access exception cua {target_user.get_full_name() or target_user.username}',
        description=(
            f"{stage_label}: review exception policy {policy.get('name') or policy.get('key')} trong {int(duration_days or 0)} ngay "
            f"cho tai khoan {target_user.username}."
        ),
        assigned_to=approver,
        assigned_by=requested_by,
        priority=Task.PRIORITY_URGENT if risk_level == 'critical' else (Task.PRIORITY_HIGH if risk_level == 'elevated' else Task.PRIORITY_MEDIUM),
        is_blocking=False,
        tags=['access-exception', 'approval', risk_level],
        due_date=django_timezone.now().date() + timedelta(days=1 if risk_level == 'critical' else 2),
        source_key=source_key,
    )


def _close_access_exception_approval_task(task_id, close_mode='done'):
    if not task_id:
        return
    task = Task.objects.filter(id=task_id).first()
    if task is None:
        return
    if close_mode == 'done':
        if task.status != Task.STATUS_DONE:
            task.complete()
    else:
        if task.status not in {Task.STATUS_CANCELLED, Task.STATUS_DONE}:
            task.cancel()


def _build_access_exception_preview(policy, target_user, approver, requester, duration_days, justification='', ticket_ref='', stage_two_approver=None, routing_recommendation=None):
    policy_payload = _serialize_access_exception_policy_storage(policy)
    requires_approval = bool(policy_payload.get('requires_approval', True))
    approval_stage_count = int(policy_payload.get('approval_stage_count') or 1) if requires_approval else 0
    current_access = _build_user_access_snapshot(target_user)
    next_role_ids = sorted(set(current_access['role_ids']) | set(policy_payload.get('role_ids', [])))
    next_team_ids = sorted(set(current_access['team_ids']) | set(policy_payload.get('team_ids', [])))
    roles_after = _serialize_access_rows_for_ids(Role, next_role_ids)
    teams_after = _serialize_access_rows_for_ids(Team, next_team_ids)
    expires_at = django_timezone.now() + timedelta(days=int(duration_days or policy_payload.get('default_duration_days') or 7))
    already_has_full_access = set(next_role_ids) == set(current_access['role_ids']) and set(next_team_ids) == set(current_access['team_ids'])

    warnings = []
    if requires_approval and approver is None:
        warnings.append('Chua xac dinh duoc approver cho request nay.')
    elif requires_approval and approver.id == requester.id:
        warnings.append('Requester dang dong vai approver. Nen bo tri 4-eye review neu co the.')
    if requires_approval and approval_stage_count > 1 and stage_two_approver is None:
        warnings.append('Policy nay can stage 2 approver ro rang truoc khi submit.')
    elif requires_approval and approval_stage_count > 1 and stage_two_approver is not None and approver is not None and stage_two_approver.id == approver.id:
        warnings.append('Stage 2 approver dang trung voi approver stage 1. Nen tach rieng de dam bao governance.')
    if getattr(target_user, 'is_locked', False):
        warnings.append('Tai khoan dang bi khoa. Can review ly do truoc khi cap access ngoai le.')
    if not getattr(target_user, 'is_active', True):
        warnings.append('Tai khoan dang tam ngung. Ngoai le nay nen di kem ke hoach kich hoat lai tai khoan.')
    if already_has_full_access:
        warnings.append('Target da co san toan bo access trong policy nay.')
    if str(policy_payload.get('risk_level')) == 'critical' and not str(ticket_ref or '').strip():
        warnings.append('Critical exception can ticket ref de truy vet va kiem toan.')
    if str(justification or '').strip() and len(str(justification or '').strip()) < 12:
        warnings.append('Justification qua ngan, nen mo ta ro business need va thoi han.')
    serialized_routing_recommendation = _serialize_access_exception_routing_plan(routing_recommendation)
    for item in (serialized_routing_recommendation or {}).get('warnings', []):
        if item not in warnings:
            warnings.append(item)

    privileged_target = _is_privileged_user(target_user)
    preflight_checks = [
        {
            'key': 'approver',
            'title': 'Approver routing',
            'status': (
                'blocked'
                if requires_approval and approver is None
                else ('warning' if requires_approval and approver is not None and approver.id == requester.id else ('info' if not requires_approval else 'ready'))
            ),
            'description': (
                'Khong co approver hop le cho request nay.'
                if requires_approval and approver is None
                else (
                    'Requester dang tu review request cua chinh minh.'
                    if requires_approval and approver is not None and approver.id == requester.id
                    else ('Policy khong bat buoc approval rieng.' if not requires_approval else 'Approver da duoc xac dinh ro rang.')
                )
            ),
        },
        {
            'key': 'approval-path',
            'title': 'Approval path',
            'status': (
                'blocked'
                if requires_approval and approval_stage_count > 1 and stage_two_approver is None
                else (
                    'warning'
                    if requires_approval and approval_stage_count > 1 and stage_two_approver is not None and approver is not None and stage_two_approver.id == approver.id
                    else ('info' if not requires_approval else 'ready')
                )
            ),
            'description': (
                'Policy nay can it nhat 2 stage approver.'
                if requires_approval and approval_stage_count > 1 and stage_two_approver is None
                else (
                    'Stage 1 va stage 2 dang dung cung mot approver.'
                    if requires_approval and approval_stage_count > 1 and stage_two_approver is not None and approver is not None and stage_two_approver.id == approver.id
                    else (
                        'Policy khong bat buoc approval ladder.'
                        if not requires_approval
                        else f'Se di qua {approval_stage_count} stage approval theo policy.'
                    )
                )
            ),
        },
        {
            'key': 'duration',
            'title': 'Duration window',
            'status': 'warning' if int(duration_days or 0) > int(policy_payload.get('default_duration_days') or 0) else 'ready',
            'description': f'Exception du kien het han vao {django_timezone.localtime(expires_at).strftime("%d/%m/%Y %H:%M")}.',
        },
        {
            'key': 'access-delta',
            'title': 'Access delta',
            'status': 'info' if already_has_full_access else 'ready',
            'description': (
                'Target da co san access cua policy, request nay chu yeu mang tinh ghi nhan.'
                if already_has_full_access
                else f"Se bo sung {max(0, len(roles_after) - len(current_access['roles']))} role va {max(0, len(teams_after) - len(current_access['teams']))} team."
            ),
        },
        {
            'key': 'risk',
            'title': 'Risk posture',
            'status': 'warning' if privileged_target or policy_payload.get('risk_level') in {'elevated', 'critical'} else 'ready',
            'description': (
                'Target hoac policy nam trong nhom rui ro cao, can review ky truoc khi approve.'
                if privileged_target or policy_payload.get('risk_level') in {'elevated', 'critical'}
                else 'Ngoai le nam trong nguong rui ro co the quan tri duoc.'
            ),
        },
        {
            'key': 'evidence',
            'title': 'Evidence trail',
            'status': 'blocked' if (policy_payload.get('risk_level') == 'critical' and not str(ticket_ref or '').strip()) else ('warning' if not str(justification or '').strip() else 'ready'),
            'description': (
                'Critical exception can ticket ref de dam bao truy vet.'
                if (policy_payload.get('risk_level') == 'critical' and not str(ticket_ref or '').strip())
                else ('Nen bo sung business justification cho request.' if not str(justification or '').strip() else 'Da co thong tin truy vet co ban cho request.')
            ),
        },
    ]

    approval_path = []
    if requires_approval:
        approval_path.append({
            'level': 1,
            'label': str(policy_payload.get('stage_one_label') or 'Manager review'),
            'status': 'pending',
            'approver': (
                {
                    'id': approver.id,
                    'username': approver.username,
                    'full_name': approver.get_full_name() or approver.username,
                    'email': approver.email or '',
                }
                if approver is not None else None
            ),
        })
        if approval_stage_count > 1:
            approval_path.append({
                'level': 2,
                'label': str(policy_payload.get('stage_two_label') or 'Governance sign-off'),
                'status': 'queued',
                'approver': (
                    {
                        'id': stage_two_approver.id,
                        'username': stage_two_approver.username,
                        'full_name': stage_two_approver.get_full_name() or stage_two_approver.username,
                        'email': stage_two_approver.email or '',
                    }
                    if stage_two_approver is not None else None
                ),
            })

    return {
        'policy': policy_payload,
        'target_user': _build_onboarding_target_user_payload(target_user),
        'approver': (
            {
                'id': approver.id,
                'username': approver.username,
                'full_name': approver.get_full_name() or approver.username,
                'email': approver.email or '',
            }
            if approver is not None else None
        ),
        'stage_two_approver': (
            {
                'id': stage_two_approver.id,
                'username': stage_two_approver.username,
                'full_name': stage_two_approver.get_full_name() or stage_two_approver.username,
                'email': stage_two_approver.email or '',
            }
            if stage_two_approver is not None else None
        ),
        'requester': {
            'id': requester.id,
            'username': requester.username,
            'full_name': requester.get_full_name() or requester.username,
        },
        'duration_days': int(duration_days or policy_payload.get('default_duration_days') or 7),
        'expires_at': expires_at,
        'roles_before': current_access['roles'],
        'roles_after': roles_after,
        'teams_before': current_access['teams'],
        'teams_after': teams_after,
        'checklist': policy_payload.get('checklist', []),
        'approval_path': approval_path,
        'routing_recommendation': serialized_routing_recommendation,
        'preflight_checks': preflight_checks,
        'warnings': warnings,
        'summary': {
            'role_additions': max(0, len(roles_after) - len(current_access['roles'])),
            'team_additions': max(0, len(teams_after) - len(current_access['teams'])),
            'already_granted': already_has_full_access,
            'privileged_target': privileged_target,
            'approval_stage_count': approval_stage_count,
        },
    }


def _create_access_exception_audit_log(request, actor, action, entity_type, entity_id, entity_id_str, entity_code, old_values, new_values, changed_fields):
    AuditLog.objects.create(
        user=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_id_str=str(entity_id_str or entity_id),
        entity_code=str(entity_code or ''),
        old_values=_make_json_safe(old_values),
        new_values=_make_json_safe(new_values),
        changed_fields=changed_fields,
        ip_address=_get_request_ip(request) if request is not None else None,
        user_agent=((request.META.get('HTTP_USER_AGENT') or '')[:500] if request is not None else ''),
    )


def _build_access_exception_request_rows(request_rows, policy_rows):
    policy_map = {item['key']: item for item in policy_rows}
    all_user_ids = sorted({
        int(value)
        for row in request_rows
        for value in [
            row.get('user_id'),
            row.get('approver_user_id'),
            row.get('stage_two_approver_user_id'),
            row.get('active_approver_user_id'),
            row.get('requested_by_id'),
            row.get('approved_by_id'),
            row.get('rejected_by_id'),
            row.get('revoked_by_id'),
            row.get('continuity_last_reroute_by_id'),
            row.get('continuity_last_reroute_from_user_id'),
        ]
        if value
    } | {
        int(item.get('approver_user_id'))
        for row in request_rows
        for item in row.get('approval_stage_history', [])
        if isinstance(item, dict) and item.get('approver_user_id')
    })
    all_role_ids = sorted({role_id for row in request_rows for role_id in row.get('role_ids', [])})
    all_team_ids = sorted({team_id for row in request_rows for team_id in row.get('team_ids', [])})
    task_ids = [int(row['approval_task_id']) for row in request_rows if row.get('approval_task_id')]

    user_map = {
        user.id: user
        for user in User.objects.filter(id__in=all_user_ids).prefetch_related('roles__permissions', 'teams')
    }
    role_map = {row.id: row for row in _annotate_role_governance_queryset(Role.objects.filter(id__in=all_role_ids))}
    team_map = {row.id: row for row in _annotate_team_governance_queryset(Team.objects.filter(id__in=all_team_ids))}
    task_map = {task.id: task for task in Task.objects.filter(id__in=task_ids)}
    availability_map = _get_access_exception_approver_availability_map()

    now = django_timezone.now()
    expiring_cutoff = now + timedelta(days=3)
    items = []
    for raw_row in request_rows:
        row = _serialize_access_exception_request_storage(raw_row)
        requested_at = _parse_access_exception_datetime(row.get('requested_at')) or now
        approved_at = _parse_access_exception_datetime(row.get('approved_at'))
        renewed_at = _parse_access_exception_datetime(row.get('renewed_at'))
        expires_at = _parse_access_exception_datetime(row.get('expires_at'))
        approval_stage_started_at = _parse_access_exception_datetime(row.get('approval_stage_started_at'))
        approval_stage_due_at = _parse_access_exception_datetime(row.get('approval_stage_due_at'))
        policy_row = policy_map.get(row['policy_key'])
        target_user = user_map.get(row['user_id'])
        approver_user = user_map.get(row['approver_user_id']) if row.get('approver_user_id') else None
        stage_two_approver_user = user_map.get(row['stage_two_approver_user_id']) if row.get('stage_two_approver_user_id') else None
        active_approver_user = user_map.get(row['active_approver_user_id']) if row.get('active_approver_user_id') else None
        requester_user = user_map.get(row['requested_by_id'])
        approved_by_user = user_map.get(row['approved_by_id']) if row.get('approved_by_id') else None
        rejected_by_user = user_map.get(row['rejected_by_id']) if row.get('rejected_by_id') else None
        revoked_by_user = user_map.get(row['revoked_by_id']) if row.get('revoked_by_id') else None
        rerouted_by_user = user_map.get(row['continuity_last_reroute_by_id']) if row.get('continuity_last_reroute_by_id') else None
        reroute_from_user = user_map.get(row['continuity_last_reroute_from_user_id']) if row.get('continuity_last_reroute_from_user_id') else None
        task = task_map.get(row['approval_task_id']) if row.get('approval_task_id') else None
        approver_availability = availability_map.get(int(approver_user.id)) if approver_user is not None else None
        stage_two_approver_availability = availability_map.get(int(stage_two_approver_user.id)) if stage_two_approver_user is not None else None
        active_approver_availability = availability_map.get(int(active_approver_user.id)) if active_approver_user is not None else None

        roles = _serialize_onboarding_role_rows([role_map[role_id] for role_id in row.get('role_ids', []) if role_id in role_map])
        teams = _serialize_onboarding_team_rows([team_map[team_id] for team_id in row.get('team_ids', []) if team_id in team_map])
        planned_expires_at = _get_access_exception_planned_expires_at(row)
        active_stage_level = int(row.get('active_stage_level') or 1)
        approval_stage_count = int(row.get('approval_stage_count') or 1)
        is_stage_overdue = bool(
            str(row.get('status') or '') == 'pending'
            and approval_stage_due_at is not None
            and approval_stage_due_at <= now
        )
        approval_path = []
        for stage_item in row.get('approval_stage_history', []):
            approver_for_stage = user_map.get(stage_item.get('approver_user_id')) if stage_item.get('approver_user_id') else None
            approval_path.append({
                'level': int(stage_item.get('level') or 1),
                'label': str(stage_item.get('label') or ''),
                'status': str(stage_item.get('status') or 'queued'),
                'started_at': _parse_access_exception_datetime(stage_item.get('started_at')),
                'decided_at': _parse_access_exception_datetime(stage_item.get('decided_at')),
                'decision': str(stage_item.get('decision') or ''),
                'decision_note': str(stage_item.get('decision_note') or ''),
                'approver': (
                    {
                        'id': approver_for_stage.id,
                        'username': approver_for_stage.username,
                        'full_name': approver_for_stage.get_full_name() or approver_for_stage.username,
                        'email': approver_for_stage.email or '',
                    }
                    if approver_for_stage is not None else None
                ),
            })

        status = str(row.get('status') or 'pending')
        request_kind = str(row.get('request_kind') or 'grant')
        lifecycle_state = status
        status_label = status.replace('_', ' ').title()
        severity = 'info'
        if status == 'approved':
            if planned_expires_at and planned_expires_at < now:
                lifecycle_state = 'expired'
                status_label = 'Expired'
                severity = 'error'
            elif planned_expires_at and planned_expires_at <= expiring_cutoff:
                lifecycle_state = 'expiring'
                status_label = 'Expiring soon'
                severity = 'warning'
            else:
                lifecycle_state = 'active'
                status_label = 'Active'
                severity = 'success'
        elif status == 'pending':
            status_label = f'Pending stage {active_stage_level}'
            severity = 'error' if is_stage_overdue else ('warning' if requested_at <= now - timedelta(days=2) else 'info')
        elif status == 'rejected':
            status_label = 'Rejected'
        elif status == 'revoked':
            status_label = 'Revoked'
        elif status == 'renewed':
            lifecycle_state = 'renewed'
            status_label = 'Renewed'
            severity = 'success'

        current_access = _build_user_access_snapshot(target_user) if target_user is not None else {'role_ids': [], 'team_ids': []}
        granted_role_ids = row.get('granted_role_ids') or row.get('role_ids', [])
        granted_team_ids = row.get('granted_team_ids') or row.get('team_ids', [])
        access_still_present = bool(
            status == 'approved'
            and (
                set(granted_role_ids).intersection(set(current_access.get('role_ids', [])))
                or set(granted_team_ids).intersection(set(current_access.get('team_ids', [])))
            )
        )
        has_self_approval = bool(
            (row.get('requested_by_id') and row.get('requested_by_id') == row.get('approver_user_id'))
            or (row.get('requested_by_id') and row.get('requested_by_id') == row.get('approved_by_id'))
            or (row.get('requested_by_id') and row.get('requested_by_id') == row.get('stage_two_approver_user_id'))
        )
        active_approver_is_out_of_office = bool(
            active_approver_user is not None and _is_access_exception_approver_out_of_office(active_approver_availability)
        )
        policy_risk_level = str((policy_row or {}).get('risk_level') or row.get('policy_risk_level') or 'standard')
        risk_score = {
            'standard': 22,
            'elevated': 46,
            'critical': 68,
        }.get(policy_risk_level, 22)
        risk_reasons = []
        if request_kind == 'renewal':
            risk_score += 4
            risk_reasons.append('Renewal dang keo dai exception vuot qua cua so ban dau.')
        if status == 'pending':
            risk_score += 8
            risk_reasons.append('Request van dang mo trong approval queue.')
            if requested_at <= now - timedelta(hours=24):
                risk_score += 8
                risk_reasons.append('Request pending hon 24 gio nen can duoc chot som.')
            if is_stage_overdue:
                risk_score += 20
                risk_reasons.append('Approval stage da breach SLA.')
        if lifecycle_state == 'expiring':
            risk_score += 10
            risk_reasons.append('Exception dang sat han va can quyet dinh gia han hoac revoke.')
        if lifecycle_state == 'expired':
            risk_score += 6
            risk_reasons.append('Exception da het han va can dong vong doi.')
        if access_still_present and lifecycle_state == 'expired':
            risk_score += 24
            risk_reasons.append('Exception da het han nhung access van chua bi go.')
        elif access_still_present and lifecycle_state in {'active', 'expiring'} and planned_expires_at and planned_expires_at <= now + timedelta(days=1):
            risk_score += 6
            risk_reasons.append('Access van dang mo trong 24 gio cuoi cua exception window.')
        if has_self_approval:
            risk_score += 16
            risk_reasons.append('Requester dang trung voi approval path cua chinh request.')
        if active_approver_is_out_of_office:
            risk_score += 10
            risk_reasons.append('Approver hien tai dang duoc danh dau out of office.')
        if policy_risk_level == 'critical' and not bool((policy_row or {}).get('requires_approval', row.get('requires_approval', True))):
            risk_score += 12
            risk_reasons.append('Critical exception dang live ma khong co approval gate.')
        if not str(row.get('ticket_ref') or '').strip() and policy_risk_level in {'elevated', 'critical'}:
            risk_score += 8
            risk_reasons.append('Exception rui ro cao chua gan ticket ref.')
        blast_radius = int(len(granted_role_ids)) + int(len(granted_team_ids))
        if blast_radius >= 4:
            risk_score += 10
            risk_reasons.append('Exception dang mo rong tren nhieu role/team cung luc.')
        elif blast_radius >= 2:
            risk_score += 4
            risk_reasons.append('Exception tac dong hon mot be mat access.')
        default_duration_days = int((policy_row or {}).get('default_duration_days') or row.get('duration_days') or 0)
        actual_duration_days = int(row.get('duration_days') or 0)
        if default_duration_days and actual_duration_days > default_duration_days:
            risk_score += min(8, actual_duration_days - default_duration_days)
            risk_reasons.append('Duration dang vuot qua cua so mac dinh cua policy.')
        if policy_row is not None and not bool(policy_row.get('is_active', True)):
            risk_score += 10
            risk_reasons.append('Policy da tam dung nhung request van con mo.')
        risk_meta = _get_access_exception_request_risk_meta(risk_score)

        items.append({
            **row,
            'request_kind': request_kind,
            'request_kind_label': 'Renewal' if request_kind == 'renewal' else 'Grant',
            'status_label': status_label,
            'lifecycle_state': lifecycle_state,
            'severity': severity,
            'planned_expires_at': planned_expires_at,
            'renewed_at': renewed_at,
            'policy': {
                'key': row['policy_key'],
                'name': (policy_row or {}).get('name') or row.get('policy_name') or row['policy_key'],
                'risk_level': (policy_row or {}).get('risk_level') or row.get('policy_risk_level') or 'standard',
                'tone': (policy_row or {}).get('tone') or row.get('policy_tone') or 'blue',
                'is_active': (policy_row or {}).get('is_active', True),
            },
            'target_user': {
                'id': target_user.id if target_user is not None else row['user_id'],
                'username': target_user.username if target_user is not None else '',
                'full_name': target_user.get_full_name() or target_user.username if target_user is not None else '',
                'email': target_user.email or '' if target_user is not None else '',
                'is_active': bool(target_user.is_active) if target_user is not None else False,
                'is_locked': bool(target_user.is_locked) if target_user is not None else False,
                'role_count': len(current_access.get('role_ids', [])),
                'team_count': len(current_access.get('team_ids', [])),
            },
            'approver': (
                {
                    'id': approver_user.id,
                    'username': approver_user.username,
                    'full_name': approver_user.get_full_name() or approver_user.username,
                    'email': approver_user.email or '',
                    'is_out_of_office': _is_access_exception_approver_out_of_office(approver_availability),
                    'availability_label': str((approver_availability or {}).get('label') or ''),
                    'availability_window': _format_access_exception_availability_window(approver_availability) if approver_availability else '',
                }
                if approver_user is not None else None
            ),
            'requested_by': (
                {
                    'id': requester_user.id,
                    'username': requester_user.username,
                    'full_name': requester_user.get_full_name() or requester_user.username,
                }
                if requester_user is not None else None
            ),
            'approved_by': (
                {
                    'id': approved_by_user.id,
                    'username': approved_by_user.username,
                    'full_name': approved_by_user.get_full_name() or approved_by_user.username,
                }
                if approved_by_user is not None else None
            ),
            'rejected_by': (
                {
                    'id': rejected_by_user.id,
                    'username': rejected_by_user.username,
                    'full_name': rejected_by_user.get_full_name() or rejected_by_user.username,
                }
                if rejected_by_user is not None else None
            ),
            'revoked_by': (
                {
                    'id': revoked_by_user.id,
                    'username': revoked_by_user.username,
                    'full_name': revoked_by_user.get_full_name() or revoked_by_user.username,
                }
                if revoked_by_user is not None else None
            ),
            'stage_two_approver': (
                {
                    'id': stage_two_approver_user.id,
                    'username': stage_two_approver_user.username,
                    'full_name': stage_two_approver_user.get_full_name() or stage_two_approver_user.username,
                    'email': stage_two_approver_user.email or '',
                    'is_out_of_office': _is_access_exception_approver_out_of_office(stage_two_approver_availability),
                    'availability_label': str((stage_two_approver_availability or {}).get('label') or ''),
                    'availability_window': _format_access_exception_availability_window(stage_two_approver_availability) if stage_two_approver_availability else '',
                }
                if stage_two_approver_user is not None else None
            ),
            'active_approver': (
                {
                    'id': active_approver_user.id,
                    'username': active_approver_user.username,
                    'full_name': active_approver_user.get_full_name() or active_approver_user.username,
                    'email': active_approver_user.email or '',
                    'is_out_of_office': active_approver_is_out_of_office,
                    'availability_label': str((active_approver_availability or {}).get('label') or ''),
                    'availability_window': _format_access_exception_availability_window(active_approver_availability) if active_approver_availability else '',
                }
                if active_approver_user is not None else None
            ),
            'roles': roles,
            'teams': teams,
            'role_count': len(roles),
            'team_count': len(teams),
            'granted_role_count': len(granted_role_ids),
            'granted_team_count': len(granted_team_ids),
            'current_stage': active_stage_level,
            'total_stages': approval_stage_count,
            'current_stage_label': (
                str(row.get('stage_one_label') or 'Manager review')
                if active_stage_level == 1
                else str(row.get('stage_two_label') or 'Governance sign-off')
            ),
            'routing': {
                'department_key': str(row.get('routing_department_key') or 'general'),
                'department_label': str(row.get('routing_department_label') or 'General governance'),
                'summary': str(row.get('routing_summary') or ''),
                'stage_one_strategy_label': str(row.get('routing_stage_one_strategy_label') or ''),
                'stage_two_strategy_label': str(row.get('routing_stage_two_strategy_label') or ''),
                'stage_one_source': str(row.get('routing_stage_one_source') or ''),
                'stage_two_source': str(row.get('routing_stage_two_source') or ''),
                'stage_one_source_label': _label_access_exception_routing_source(row.get('routing_stage_one_source')),
                'stage_two_source_label': _label_access_exception_routing_source(row.get('routing_stage_two_source')),
                'stage_one_resolution_kind': str(row.get('routing_stage_one_resolution_kind') or ''),
                'stage_two_resolution_kind': str(row.get('routing_stage_two_resolution_kind') or ''),
                'stage_one_resolution_label': str(row.get('routing_stage_one_resolution_label') or ''),
                'stage_two_resolution_label': str(row.get('routing_stage_two_resolution_label') or ''),
                'stage_one_coverage_note': str(row.get('routing_stage_one_coverage_note') or ''),
                'stage_two_coverage_note': str(row.get('routing_stage_two_coverage_note') or ''),
                'target_team_codes': list(row.get('routing_target_team_codes', [])),
                'auto_selected_stage_one': bool(row.get('auto_selected_stage_one', False)),
                'auto_selected_stage_two': bool(row.get('auto_selected_stage_two', False)),
            },
            'continuity': {
                'reroute_count': int(row.get('continuity_reroute_count') or 0),
                'last_rerouted_at': _parse_access_exception_datetime(row.get('continuity_last_rerouted_at')),
                'last_reroute_note': str(row.get('continuity_last_reroute_note') or ''),
                'last_rerouted_by': (
                    {
                        'id': rerouted_by_user.id,
                        'username': rerouted_by_user.username,
                        'full_name': rerouted_by_user.get_full_name() or rerouted_by_user.username,
                    }
                    if rerouted_by_user is not None else None
                ),
                'last_reroute_from_approver': (
                    {
                        'id': reroute_from_user.id,
                        'username': reroute_from_user.username,
                        'full_name': reroute_from_user.get_full_name() or reroute_from_user.username,
                        'email': reroute_from_user.email or '',
                    }
                    if reroute_from_user is not None else None
                ),
            },
            'approval_stage_started_at': approval_stage_started_at,
            'approval_stage_due_at': approval_stage_due_at,
            'is_stage_overdue': is_stage_overdue,
            'approval_path': approval_path,
            'risk_score': max(0, min(int(risk_score or 0), 100)),
            'risk_band': str(risk_meta['band']),
            'risk_label': str(risk_meta['label']),
            'risk_severity': str(risk_meta['severity']),
            'risk_reasons': risk_reasons[:4],
            'approval_task': (
                {
                    'id': task.id,
                    'title': task.title,
                    'status': task.status,
                    'is_open': task.is_open,
                }
                if task is not None else None
            ),
            'has_self_approval': has_self_approval,
            'access_still_present': access_still_present,
            'has_open_renewal': False,
            'can_approve': status == 'pending',
            'can_reject': status == 'pending',
            'can_revoke': status == 'approved',
            'can_renew': status == 'approved' and not row.get('renewed_by_request_key'),
            'can_reroute': status == 'pending' and active_approver_user is not None,
        })
    open_child_counts = Counter(
        str(item.get('parent_request_key') or '')
        for item in items
        if str(item.get('parent_request_key') or '').strip()
        and item.get('lifecycle_state') in {'pending', 'active', 'expiring'}
    )
    for item in items:
        has_open_renewal = bool(open_child_counts.get(str(item.get('key') or ''), 0))
        item['has_open_renewal'] = has_open_renewal
        if has_open_renewal:
            item['can_renew'] = False
        if item.get('lifecycle_state') == 'expiring' and not has_open_renewal:
            next_risk_score = min(100, int(item.get('risk_score') or 0) + 10)
            next_risk_reasons = list(item.get('risk_reasons') or [])
            next_risk_reasons.append('Exception sap het han nhung chua co renewal cover.')
            next_risk_meta = _get_access_exception_request_risk_meta(next_risk_score)
            item['risk_score'] = next_risk_score
            item['risk_band'] = str(next_risk_meta['band'])
            item['risk_label'] = str(next_risk_meta['label'])
            item['risk_severity'] = str(next_risk_meta['severity'])
            item['risk_reasons'] = next_risk_reasons[:4]
    return items


def _build_access_exception_policy_rows(policies, request_rows=None):
    all_role_ids = sorted({role_id for policy in policies for role_id in policy.get('role_ids', [])})
    all_team_ids = sorted({team_id for policy in policies for team_id in policy.get('team_ids', [])})
    role_map = {row.id: row for row in _annotate_role_governance_queryset(Role.objects.filter(id__in=all_role_ids))}
    team_map = {row.id: row for row in _annotate_team_governance_queryset(Team.objects.filter(id__in=all_team_ids))}

    pending_counts = Counter()
    active_counts = Counter()
    expired_counts = Counter()
    stale_pending_counts = Counter()
    overdue_request_counts = Counter()
    expired_access_counts = Counter()
    self_approval_counts = Counter()
    high_risk_request_counts = Counter()
    critical_risk_request_counts = Counter()
    out_of_office_request_counts = Counter()
    unticketed_request_counts = Counter()
    expiring_without_renewal_counts = Counter()
    request_rows = request_rows or []
    stale_pending_cutoff = django_timezone.now() - timedelta(hours=48)
    for request_row in request_rows:
        policy_key = str(request_row.get('policy', {}).get('key') or request_row.get('policy_key') or '')
        if not policy_key:
            continue
        lifecycle_state = str(request_row.get('lifecycle_state') or '')
        if lifecycle_state == 'pending':
            pending_counts[policy_key] += 1
        elif lifecycle_state in {'active', 'expiring'}:
            active_counts[policy_key] += 1
        elif lifecycle_state == 'expired':
            expired_counts[policy_key] += 1
        requested_at = _parse_access_exception_datetime(request_row.get('requested_at'))
        if lifecycle_state == 'pending' and requested_at is not None and requested_at <= stale_pending_cutoff:
            stale_pending_counts[policy_key] += 1
        if bool(request_row.get('is_stage_overdue')):
            overdue_request_counts[policy_key] += 1
        if lifecycle_state == 'expired' and bool(request_row.get('access_still_present')):
            expired_access_counts[policy_key] += 1
        if bool(request_row.get('has_self_approval')):
            self_approval_counts[policy_key] += 1
        if int(request_row.get('risk_score') or 0) >= 60:
            high_risk_request_counts[policy_key] += 1
        if int(request_row.get('risk_score') or 0) >= 80:
            critical_risk_request_counts[policy_key] += 1
        if lifecycle_state == 'pending' and bool((request_row.get('active_approver') or {}).get('is_out_of_office')):
            out_of_office_request_counts[policy_key] += 1
        if not str(request_row.get('ticket_ref') or '').strip() and str(request_row.get('policy_risk_level') or (request_row.get('policy') or {}).get('risk_level') or 'standard') in {'elevated', 'critical'}:
            unticketed_request_counts[policy_key] += 1
        if lifecycle_state == 'expiring' and not bool(request_row.get('has_open_renewal')):
            expiring_without_renewal_counts[policy_key] += 1

    items = []
    approver_count = len(_build_access_exception_approver_users(limit=24))
    routing_rule_map = {
        item['department_key']: item
        for item in _load_access_exception_routing_rules()
    }
    for policy in policies:
        policy_payload = _serialize_access_exception_policy_storage(policy)
        routing_rule = routing_rule_map.get(policy_payload.get('department_key'))
        policy_role_ids = [role_id for role_id in policy_payload.get('role_ids', []) if role_id in role_map]
        policy_team_ids = [team_id for team_id in policy_payload.get('team_ids', []) if team_id in team_map]
        roles = _serialize_onboarding_role_rows([role_map[role_id] for role_id in policy_role_ids])
        teams = _serialize_onboarding_team_rows([team_map[team_id] for team_id in policy_team_ids])
        missing_role_ids = [role_id for role_id in policy_payload.get('role_ids', []) if role_id not in role_map]
        missing_team_ids = [team_id for team_id in policy_payload.get('team_ids', []) if team_id not in team_map]
        inactive_role_ids = [item['id'] for item in roles if not item['is_active']]
        inactive_team_ids = [item['id'] for item in teams if not item['is_active']]
        warnings = []
        if policy_payload['is_active'] and not roles and not teams:
            warnings.append('Policy dang hoat dong nhung khong con role/team hop le de cap.')
        if missing_role_ids or missing_team_ids:
            warnings.append('Policy dang tham chieu role/team khong ton tai.')
        if inactive_role_ids or inactive_team_ids:
            warnings.append('Policy dang dung role/team tam ngung hoat dong.')
        if policy_payload.get('risk_level') == 'critical' and not policy_payload.get('requires_approval'):
            warnings.append('Critical policy nen bat approval de dam bao 4-eye review.')
        if policy_payload.get('risk_level') == 'critical' and int(policy_payload.get('approval_stage_count') or 1) < 2:
            warnings.append('Critical policy nen di qua it nhat 2 stage approval de tang 4-eye control.')
        if policy_payload.get('requires_approval') and int(policy_payload.get('approval_stage_count') or 1) > 1 and not str(policy_payload.get('stage_two_label') or '').strip():
            warnings.append('Policy da bat multi-stage nhung chua dat ten stage 2 ro rang.')
        if policy_payload.get('requires_approval') and approver_count == 0:
            warnings.append('Chua co approver governance kha dung cho policy nay.')
        if policy_payload.get('requires_approval') and policy_payload.get('risk_level') in {'elevated', 'critical'} and routing_rule is not None:
            if not (routing_rule.get('stage_one_primary_user_id') or routing_rule.get('stage_one_delegate_user_id')):
                warnings.append('Department routing directory chua gan stage 1 owner/delegate cho policy nay.')
            if int(policy_payload.get('approval_stage_count') or 1) > 1 and not (
                routing_rule.get('stage_two_primary_user_id') or routing_rule.get('stage_two_delegate_user_id')
            ):
                warnings.append('Department routing directory chua gan stage 2 owner/delegate cho policy nay.')

        risk_meta = _get_access_exception_risk_meta(policy_payload.get('risk_level'))
        stale_pending_request_count = int(stale_pending_counts.get(policy_payload['key'], 0))
        overdue_request_count = int(overdue_request_counts.get(policy_payload['key'], 0))
        expired_access_request_count = int(expired_access_counts.get(policy_payload['key'], 0))
        self_approval_request_count = int(self_approval_counts.get(policy_payload['key'], 0))
        high_risk_request_count = int(high_risk_request_counts.get(policy_payload['key'], 0))
        critical_risk_request_count = int(critical_risk_request_counts.get(policy_payload['key'], 0))
        out_of_office_request_count = int(out_of_office_request_counts.get(policy_payload['key'], 0))
        unticketed_request_count = int(unticketed_request_counts.get(policy_payload['key'], 0))
        expiring_without_renewal_count = int(expiring_without_renewal_counts.get(policy_payload['key'], 0))
        policy_risk_score = {
            'standard': 28,
            'elevated': 54,
            'critical': 78,
        }.get(str(policy_payload.get('risk_level') or 'standard'), 28)
        policy_risk_score += min(12, (len(policy_role_ids) + len(policy_team_ids)) * 4)
        duration_spread = max(0, int(policy_payload.get('max_duration_days') or 0) - int(policy_payload.get('default_duration_days') or 0))
        if duration_spread > 0:
            policy_risk_score += min(8, duration_spread)
        policy_risk_score += min(10, int(active_counts.get(policy_payload['key'], 0)) * 2 + int(pending_counts.get(policy_payload['key'], 0)))
        policy_risk_score = max(0, min(int(policy_risk_score or 0), 100))

        debt_score = 0
        debt_reasons = []
        if policy_payload['is_active'] and not roles and not teams:
            debt_score += 34
            debt_reasons.append('Policy dang live nhung khong con role/team hop le de cap.')
        if missing_role_ids or missing_team_ids:
            debt_score += 28
            debt_reasons.append('Policy dang tham chieu role/team khong ton tai.')
        if inactive_role_ids or inactive_team_ids:
            debt_score += 18
            debt_reasons.append('Policy dang dung role/team da tam ngung hoat dong.')
        if policy_payload.get('risk_level') == 'critical' and not policy_payload.get('requires_approval'):
            debt_score += 42
            debt_reasons.append('Critical policy dang bo qua approval control.')
        if policy_payload.get('risk_level') == 'critical' and int(policy_payload.get('approval_stage_count') or 1) < 2:
            debt_score += 22
            debt_reasons.append('Critical policy chua dat four-eye review voi it nhat 2 stage.')
        if policy_payload.get('requires_approval') and int(policy_payload.get('approval_stage_count') or 1) > 1 and not str(policy_payload.get('stage_two_label') or '').strip():
            debt_score += 8
            debt_reasons.append('Multi-stage policy chua dat ten stage 2 ro rang.')
        if policy_payload.get('requires_approval') and approver_count == 0:
            debt_score += 18
            debt_reasons.append('Workspace chua co approver governance kha dung.')
        if policy_payload.get('risk_level') in {'elevated', 'critical'} and not list(policy_payload.get('checklist') or []):
            debt_score += 8
            debt_reasons.append('Policy rui ro cao chua co checklist governance.')
        if policy_payload.get('requires_approval') and policy_payload.get('risk_level') in {'elevated', 'critical'} and routing_rule is not None:
            if not (routing_rule.get('stage_one_primary_user_id') or routing_rule.get('stage_one_delegate_user_id')):
                debt_score += 12
                debt_reasons.append('Department routing directory chua gan owner/delegate stage 1.')
            if int(policy_payload.get('approval_stage_count') or 1) > 1 and not (
                routing_rule.get('stage_two_primary_user_id') or routing_rule.get('stage_two_delegate_user_id')
            ):
                debt_score += 12
                debt_reasons.append('Department routing directory chua gan owner/delegate stage 2.')
        if stale_pending_request_count:
            debt_score += min(24, stale_pending_request_count * 8)
            debt_reasons.append(f'Co {stale_pending_request_count} request pending qua 48 gio.')
        if overdue_request_count:
            debt_score += min(28, overdue_request_count * 10)
            debt_reasons.append(f'Co {overdue_request_count} request da breach approval SLA.')
        if expired_access_request_count:
            debt_score += min(32, expired_access_request_count * 12)
            debt_reasons.append(f'Co {expired_access_request_count} exception het han nhung access van con.')
        if self_approval_request_count:
            debt_score += min(24, self_approval_request_count * 10)
            debt_reasons.append(f'Co {self_approval_request_count} request co dau hieu self-approval.')
        if critical_risk_request_count:
            debt_score += min(18, critical_risk_request_count * 8)
            debt_reasons.append(f'Co {critical_risk_request_count} request dang o muc critical risk.')
        elif high_risk_request_count:
            debt_score += min(16, high_risk_request_count * 4)
            debt_reasons.append(f'Co {high_risk_request_count} request high-risk dang mo.')
        if out_of_office_request_count:
            debt_score += min(14, out_of_office_request_count * 6)
            debt_reasons.append(f'Co {out_of_office_request_count} request dang phu thuoc approver OOO.')
        if unticketed_request_count:
            debt_score += min(12, unticketed_request_count * 4)
            debt_reasons.append(f'Co {unticketed_request_count} request elevated/critical chua co ticket ref.')
        if expiring_without_renewal_count:
            debt_score += min(12, expiring_without_renewal_count * 4)
            debt_reasons.append(f'Co {expiring_without_renewal_count} exception sap het han nhung chua co renewal cover.')
        debt_score = max(0, min(int(debt_score or 0), 100))
        debt_meta = _get_access_exception_policy_debt_meta(debt_score)
        items.append({
            **policy_payload,
            'roles': roles,
            'teams': teams,
            'role_count': len(roles),
            'team_count': len(teams),
            'checklist_count': len(policy_payload.get('checklist', [])),
            'missing_role_ids': missing_role_ids,
            'missing_team_ids': missing_team_ids,
            'inactive_role_ids': inactive_role_ids,
            'inactive_team_ids': inactive_team_ids,
            'pending_request_count': int(pending_counts.get(policy_payload['key'], 0)),
            'active_request_count': int(active_counts.get(policy_payload['key'], 0)),
            'expired_request_count': int(expired_counts.get(policy_payload['key'], 0)),
            'stale_pending_request_count': stale_pending_request_count,
            'overdue_request_count': overdue_request_count,
            'expired_access_request_count': expired_access_request_count,
            'self_approval_request_count': self_approval_request_count,
            'high_risk_request_count': high_risk_request_count,
            'critical_risk_request_count': critical_risk_request_count,
            'out_of_office_request_count': out_of_office_request_count,
            'unticketed_request_count': unticketed_request_count,
            'expiring_without_renewal_count': expiring_without_renewal_count,
            'risk': {
                'label': risk_meta['label'],
                'description': risk_meta['description'],
                'severity': risk_meta['severity'],
            },
            'risk_score': policy_risk_score,
            'debt_score': debt_score,
            'debt_status': str(debt_meta['status']),
            'debt_label': str(debt_meta['label']),
            'debt_severity': str(debt_meta['severity']),
            'debt_reasons': debt_reasons[:4],
            'has_findings': bool(warnings or debt_score >= 40),
            'warnings': warnings,
        })
    return items


def _build_access_exception_guided_remediation_rows(policy_rows, request_rows, continuity_rows=None):
    continuity_map = {
        str(item.get('request_key') or ''): item
        for item in continuity_rows or []
        if str(item.get('status') or '') == 'ready-to-reroute'
        and str(item.get('request_key') or '').strip()
    }
    items = []

    for policy in policy_rows:
        if policy.get('is_active') and policy.get('risk_level') == 'critical' and not policy.get('requires_approval'):
            items.append({
                'id': f"policy-enable-approval:{policy['key']}",
                'kind': 'policy',
                'action_type': 'policy_enable_approval',
                'severity': 'error',
                'title': f"Bat approval gate cho {policy['name']}",
                'description': 'Critical policy dang live nhung chua bat approval workflow. Nen khoa lai bang approval gate ngay.',
                'action_label': 'Enable approval',
                'policy_key': policy['key'],
                'policy_name': policy['name'],
                'request_key': None,
                'request_status': '',
                'department_key': str(policy.get('department_key') or ''),
                'department_label': str(policy.get('department_label') or ''),
                'target_user': None,
                'suggested_approver': None,
                'suggested_source_label': '',
                'suggested_resolution_label': '',
                'suggested_note': 'Guided remediation bat approval gate cho critical policy.',
                'route': '/admin/access-exceptions',
                'score': int(policy.get('debt_score') or 0),
            })
        if policy.get('is_active') and policy.get('risk_level') == 'critical' and int(policy.get('approval_stage_count') or 1) < 2:
            items.append({
                'id': f"policy-upgrade-stage-two:{policy['key']}",
                'kind': 'policy',
                'action_type': 'policy_upgrade_stage_two',
                'severity': 'warning',
                'title': f"Nang {policy['name']} len 2-stage review",
                'description': 'Critical policy nen di qua 2-stage approval de giu four-eye control va governance sign-off.',
                'action_label': 'Upgrade to 2-stage',
                'policy_key': policy['key'],
                'policy_name': policy['name'],
                'request_key': None,
                'request_status': '',
                'department_key': str(policy.get('department_key') or ''),
                'department_label': str(policy.get('department_label') or ''),
                'target_user': None,
                'suggested_approver': None,
                'suggested_source_label': '',
                'suggested_resolution_label': '',
                'suggested_note': 'Guided remediation nang critical policy len 2-stage review.',
                'route': '/admin/access-exceptions',
                'score': int(policy.get('debt_score') or 0),
            })

    for request_row in request_rows:
        continuity_row = continuity_map.get(str(request_row.get('key') or ''))
        if request_row.get('lifecycle_state') == 'expired' and request_row.get('access_still_present') and request_row.get('can_revoke'):
            items.append({
                'id': f"request-revoke:{request_row['key']}",
                'kind': 'request',
                'action_type': 'request_revoke',
                'severity': 'error',
                'title': f"Thu hoi exception {request_row['key']}",
                'description': 'Exception da het han nhung access van con. Guided remediation co the revoke ngay de dua user ve baseline.',
                'action_label': 'Revoke now',
                'policy_key': str((request_row.get('policy') or {}).get('key') or request_row.get('policy_key') or ''),
                'policy_name': str((request_row.get('policy') or {}).get('name') or request_row.get('policy_name') or ''),
                'request_key': str(request_row.get('key') or ''),
                'request_status': str(request_row.get('status_label') or ''),
                'department_key': str((request_row.get('routing') or {}).get('department_key') or ''),
                'department_label': str((request_row.get('routing') or {}).get('department_label') or ''),
                'target_user': request_row.get('target_user') or None,
                'suggested_approver': None,
                'suggested_source_label': '',
                'suggested_resolution_label': '',
                'suggested_note': 'Guided remediation revoked expired exception because access was still present.',
                'route': '/admin/access-exceptions',
                'score': int(request_row.get('risk_score') or 0),
            })
        if continuity_row is not None and request_row.get('can_reroute') and continuity_row.get('suggested_approver'):
            items.append({
                'id': f"request-reroute:{request_row['key']}",
                'kind': 'request',
                'action_type': 'request_reroute',
                'severity': 'error' if int(request_row.get('risk_score') or 0) >= 80 else 'warning',
                'title': f"Reroute approval cho {request_row['key']}",
                'description': 'Pending request dang co continuity risk va he thong da tim thay approver thay the hop le.',
                'action_label': 'Reroute now',
                'policy_key': str((request_row.get('policy') or {}).get('key') or request_row.get('policy_key') or ''),
                'policy_name': str((request_row.get('policy') or {}).get('name') or request_row.get('policy_name') or ''),
                'request_key': str(request_row.get('key') or ''),
                'request_status': str(request_row.get('status_label') or ''),
                'department_key': str((request_row.get('routing') or {}).get('department_key') or ''),
                'department_label': str((request_row.get('routing') or {}).get('department_label') or ''),
                'target_user': request_row.get('target_user') or None,
                'suggested_approver': continuity_row.get('suggested_approver'),
                'suggested_source_label': str(continuity_row.get('suggested_source_label') or ''),
                'suggested_resolution_label': str(continuity_row.get('suggested_resolution_label') or ''),
                'suggested_note': (
                    str(continuity_row.get('suggested_coverage_note') or '')
                    or str(continuity_row.get('continuity_note') or '')
                    or 'Guided remediation rerouted request due to continuity risk.'
                ),
                'route': '/admin/access-exceptions',
                'score': int(request_row.get('risk_score') or 0),
            })

    severity_rank = {'error': 0, 'warning': 1, 'info': 2}
    items.sort(key=lambda item: (
        severity_rank.get(str(item.get('severity') or 'info'), 3),
        -int(item.get('score') or 0),
        str(item.get('title') or ''),
    ))
    return items


def _build_access_exception_guided_remediation_summary(items):
    return {
        'total_actions': len(items),
        'critical_actions': sum(1 for item in items if str(item.get('severity') or '') == 'error'),
        'policy_actions': sum(1 for item in items if str(item.get('kind') or '') == 'policy'),
        'request_actions': sum(1 for item in items if str(item.get('kind') or '') == 'request'),
    }


def _build_access_exception_sla_radar(request_rows, automation_policy, now=None):
    current_time = now or django_timezone.now()
    policy = _serialize_access_exception_automation_policy_storage(automation_policy)
    warning_window_hours = int(policy.get('approval_warning_window_hours') or 6)
    escalation_delay_hours = int(policy.get('approval_escalation_delay_hours') or 2)
    items = []
    tracked_pending = 0

    for request_row in request_rows:
        if str(request_row.get('lifecycle_state') or '') != 'pending':
            continue

        approval_stage_due_at = _parse_access_exception_datetime(request_row.get('approval_stage_due_at'))
        if approval_stage_due_at is None:
            continue

        tracked_pending += 1
        hours_to_due = (approval_stage_due_at - current_time).total_seconds() / 3600
        if hours_to_due > warning_window_hours:
            continue

        current_stage = int(request_row.get('current_stage') or request_row.get('active_stage_level') or 1)
        routing_payload = request_row.get('routing') or {}
        routing_source = (
            str(routing_payload.get('stage_two_source') or '')
            if current_stage > 1 else str(routing_payload.get('stage_one_source') or '')
        )
        routing_source_label = (
            str(routing_payload.get('stage_two_source_label') or '')
            if current_stage > 1 else str(routing_payload.get('stage_one_source_label') or '')
        ) or _label_access_exception_routing_source(routing_source)
        warning_sent = int(request_row.get('sla_warning_stage_level') or 0) == current_stage
        escalation_sent = int(request_row.get('sla_escalation_stage_level') or 0) == current_stage
        is_overdue = hours_to_due < 0
        hours_overdue = round(abs(hours_to_due), 1) if is_overdue else 0.0

        items.append({
            'request_key': str(request_row.get('key') or ''),
            'request_kind': str(request_row.get('request_kind') or 'grant'),
            'request_kind_label': str(request_row.get('request_kind_label') or 'Grant'),
            'policy': request_row.get('policy') or {},
            'target_user': request_row.get('target_user') or {},
            'department_key': str(routing_payload.get('department_key') or 'general'),
            'department_label': str(routing_payload.get('department_label') or 'General governance'),
            'stage_label': str(request_row.get('current_stage_label') or f'Stage {current_stage}'),
            'current_stage': current_stage,
            'total_stages': int(request_row.get('total_stages') or 1),
            'active_approver': request_row.get('active_approver') or request_row.get('approver') or None,
            'approval_stage_started_at': _parse_access_exception_datetime(request_row.get('approval_stage_started_at')),
            'approval_stage_due_at': approval_stage_due_at,
            'hours_to_due': round(hours_to_due, 1),
            'hours_overdue': hours_overdue,
            'status': 'overdue' if is_overdue else 'near-due',
            'severity': 'error' if is_overdue else 'warning',
            'routing_source': routing_source,
            'routing_source_label': routing_source_label,
            'warning_sent': warning_sent,
            'escalation_sent': escalation_sent,
            'warning_due': (not is_overdue) and hours_to_due <= warning_window_hours and not warning_sent,
            'escalation_due': is_overdue and hours_overdue >= float(escalation_delay_hours) and not escalation_sent,
        })

    items.sort(
        key=lambda item: (
            0 if item['status'] == 'overdue' else 1,
            -(float(item.get('hours_overdue') or 0.0)),
            float(item.get('hours_to_due') or 0.0),
            str(item.get('request_key') or ''),
        )
    )
    return {
        'generated_at': current_time,
        'warning_window_hours': warning_window_hours,
        'escalation_delay_hours': escalation_delay_hours,
        'summary': {
            'tracked_pending': tracked_pending,
            'near_due': sum(1 for item in items if item['status'] == 'near-due'),
            'overdue': sum(1 for item in items if item['status'] == 'overdue'),
            'warnings_due': sum(1 for item in items if item.get('warning_due')),
            'escalations_due': sum(1 for item in items if item.get('escalation_due')),
        },
        'items': items[:12],
    }


def _build_access_exception_routing_coverage_rows(policy_rows, request_rows, routing_rules=None, sla_radar=None):
    safe_rules = list(routing_rules or _build_access_exception_routing_rule_rows())
    radar_items = list((sla_radar or {}).get('items', [])) if isinstance(sla_radar, dict) else []
    department_map = {}

    def get_department_row(department_key, department_label):
        normalized_key = str(department_key or 'general').strip().lower() or 'general'
        row = department_map.get(normalized_key)
        if row is None:
            row = {
                'department_key': normalized_key,
                'department_label': str(department_label or normalized_key.title() or 'General governance'),
                'pack_keys': [],
                'active_policy_count': 0,
                'critical_policy_count': 0,
                'approval_policy_count': 0,
                'multi_stage_policy_count': 0,
                'pending_request_count': 0,
                'near_sla_request_count': 0,
                'overdue_request_count': 0,
                'fallback_request_count': 0,
                'warnings_due': 0,
                'escalations_due': 0,
                'stage_one_required': False,
                'stage_two_required': False,
                'stage_one_ready': False,
                'stage_two_ready': False,
                'stage_one_mode': '',
                'stage_two_mode': '',
                'routing_rule_active': True,
                'notes': '',
                'status': 'healthy',
                'warnings': [],
            }
            department_map[normalized_key] = row
        return row

    rule_map = {}
    for rule in safe_rules:
        department_row = get_department_row(rule.get('department_key'), rule.get('department_label'))
        department_row['pack_keys'] = list(dict.fromkeys([
            *department_row['pack_keys'],
            *list(rule.get('pack_keys') or []),
        ]))
        department_row['stage_one_ready'] = bool(rule.get('configured_stage_one'))
        department_row['stage_two_ready'] = bool(rule.get('configured_stage_two'))
        department_row['stage_one_mode'] = str(rule.get('stage_one_mode') or '')
        department_row['stage_two_mode'] = str(rule.get('stage_two_mode') or '')
        department_row['routing_rule_active'] = bool(rule.get('is_active', True))
        department_row['notes'] = str(rule.get('notes') or '')
        rule_map[str(rule.get('department_key') or '')] = rule

    for policy in policy_rows:
        if not policy.get('is_active'):
            continue
        department_row = get_department_row(policy.get('department_key'), policy.get('department_label'))
        department_row['active_policy_count'] += 1
        if policy.get('pack_key'):
            department_row['pack_keys'] = list(dict.fromkeys([
                *department_row['pack_keys'],
                str(policy.get('pack_key') or ''),
            ]))
        if policy.get('risk_level') == 'critical':
            department_row['critical_policy_count'] += 1
        if policy.get('requires_approval'):
            department_row['approval_policy_count'] += 1
            department_row['stage_one_required'] = True
        if policy.get('requires_approval') and int(policy.get('approval_stage_count') or 1) > 1:
            department_row['multi_stage_policy_count'] += 1
            department_row['stage_two_required'] = True

    for request_row in request_rows:
        routing_payload = request_row.get('routing') or {}
        department_row = get_department_row(routing_payload.get('department_key'), routing_payload.get('department_label'))
        if str(request_row.get('lifecycle_state') or '') == 'pending':
            department_row['pending_request_count'] += 1
            current_stage = int(request_row.get('current_stage') or 1)
            routing_source = (
                str(routing_payload.get('stage_two_source') or '')
                if current_stage > 1 else str(routing_payload.get('stage_one_source') or '')
            ).strip().lower()
            if routing_source in {'team-match', 'independent-team', 'pool', 'none'}:
                department_row['fallback_request_count'] += 1

    for radar_item in radar_items:
        department_row = get_department_row(radar_item.get('department_key'), radar_item.get('department_label'))
        if radar_item.get('status') == 'near-due':
            department_row['near_sla_request_count'] += 1
        if radar_item.get('status') == 'overdue':
            department_row['overdue_request_count'] += 1
        if radar_item.get('warning_due'):
            department_row['warnings_due'] += 1
        if radar_item.get('escalation_due'):
            department_row['escalations_due'] += 1

    rows = []
    for department_key, row in sorted(department_map.items(), key=lambda item: str(item[1].get('department_label') or item[0])):
        warnings = []
        stage_one_ready = bool(row['stage_one_ready']) or not row['stage_one_required']
        stage_two_ready = bool(row['stage_two_ready']) or not row['stage_two_required']
        if row['stage_one_required'] and not stage_one_ready:
            warnings.append('Missing stage 1 owner/delegate coverage.')
        if row['stage_two_required'] and not stage_two_ready:
            warnings.append('Missing stage 2 owner/delegate coverage.')
        if row['fallback_request_count'] > 0:
            warnings.append(f"{row['fallback_request_count']} pending request dang fallback sang team/pool.")
        if row['near_sla_request_count'] > 0:
            warnings.append(f"{row['near_sla_request_count']} request dang sat moc SLA.")
        if row['overdue_request_count'] > 0:
            warnings.append(f"{row['overdue_request_count']} request da vuot SLA.")

        status_name = 'healthy'
        if row['overdue_request_count'] > 0 or (
            row['critical_policy_count'] > 0 and ((row['stage_one_required'] and not stage_one_ready) or (row['stage_two_required'] and not stage_two_ready))
        ):
            status_name = 'error'
        elif warnings:
            status_name = 'warning'

        rows.append({
            **row,
            'department_key': department_key,
            'stage_one_ready': stage_one_ready,
            'stage_two_ready': stage_two_ready,
            'status': status_name,
            'warnings': warnings,
            'warning_count': len(warnings),
            'pack_keys': list(dict.fromkeys(row['pack_keys']))[:8],
        })
    return rows


def _build_access_exception_routing_coverage_summary(coverage_rows):
    return {
        'departments_total': len(coverage_rows),
        'departments_stage_one_ready': sum(1 for row in coverage_rows if row.get('stage_one_ready')),
        'departments_stage_two_ready': sum(1 for row in coverage_rows if row.get('stage_two_ready')),
        'departments_with_backlog': sum(1 for row in coverage_rows if int(row.get('pending_request_count') or 0) > 0),
        'departments_with_overdue': sum(1 for row in coverage_rows if int(row.get('overdue_request_count') or 0) > 0),
        'coverage_gaps': sum(
            1
            for row in coverage_rows
            if (row.get('stage_one_required') and not row.get('stage_one_ready'))
            or (row.get('stage_two_required') and not row.get('stage_two_ready'))
        ),
        'fallback_pending_requests': sum(int(row.get('fallback_request_count') or 0) for row in coverage_rows),
        'near_sla_requests': sum(int(row.get('near_sla_request_count') or 0) for row in coverage_rows),
    }


def _serialize_access_exception_approver_candidate_reference(candidate_row):
    if not candidate_row:
        return None
    return {
        'id': int(candidate_row.get('id') or 0),
        'username': str(candidate_row.get('username') or ''),
        'full_name': str(candidate_row.get('full_name') or candidate_row.get('username') or ''),
        'email': str(candidate_row.get('email') or ''),
        'team_count': int(candidate_row.get('team_count') or 0),
        'teams': list(candidate_row.get('teams') or []),
        'is_out_of_office': bool(candidate_row.get('is_out_of_office', False)),
        'availability_label': str(candidate_row.get('availability_label') or ''),
        'availability_window': str(candidate_row.get('availability_window') or ''),
    }


def _match_access_exception_team_tokens_from_dicts(team_rows, preferred_tokens):
    normalized_tokens = [str(item or '').strip().upper() for item in preferred_tokens if str(item or '').strip()]
    if not normalized_tokens:
        return []
    matches = []
    for team in team_rows or []:
        haystacks = [
            str(team.get('code') or '').upper(),
            str(team.get('name') or '').upper(),
        ]
        if any(token in haystack for token in normalized_tokens for haystack in haystacks):
            matches.append(team)
    return matches


def _build_access_exception_workload_tokens(department_label, routing_rule=None, coverage_row=None):
    seeded_tokens = [
        str(token or '').strip().upper()
        for token in (routing_rule or {}).get('fallback_team_tokens', [])
        if str(token or '').strip()
    ]
    if seeded_tokens:
        return list(dict.fromkeys(seeded_tokens))[:8]

    fallback_tokens = []
    for raw_value in [
        department_label,
        (coverage_row or {}).get('department_label'),
        (coverage_row or {}).get('department_key'),
    ]:
        for part in re.split(r'[^A-Za-z0-9]+', str(raw_value or '').upper()):
            if len(part) >= 3 and part not in fallback_tokens:
                fallback_tokens.append(part)
    return fallback_tokens[:8]


def _get_access_exception_capacity_status(load_score, pending_request_count, overdue_request_count, single_threaded_count):
    if int(overdue_request_count or 0) > 0 or int(pending_request_count or 0) >= 5 or int(single_threaded_count or 0) >= 2:
        return 'critical'
    if int(pending_request_count or 0) >= 3 or int(load_score or 0) >= 5 or int(single_threaded_count or 0) >= 1:
        return 'warning'
    return 'healthy'


def _build_access_exception_approver_capacity_rows(request_rows, routing_rules=None, coverage_rows=None, sla_radar=None, approver_candidates=None):
    candidate_rows = list(approver_candidates or _build_access_exception_approver_candidate_rows(limit=40))
    rule_rows = list(routing_rules or _build_access_exception_routing_rule_rows())
    coverage_map = {
        str(item.get('department_key') or ''): item
        for item in (coverage_rows or [])
    }
    radar_map = {
        str(item.get('request_key') or ''): item
        for item in list((sla_radar or {}).get('items', [])) if str(item.get('request_key') or '').strip()
    }
    rows_by_id = {}
    for candidate_row in candidate_rows:
        candidate_id = int(candidate_row.get('id') or 0)
        if not candidate_id:
            continue
        rows_by_id[candidate_id] = {
            'approver': _serialize_access_exception_approver_candidate_reference(candidate_row),
            'is_staff': bool(candidate_row.get('is_staff', False)),
            'active_session_count': int(candidate_row.get('active_session_count') or 0),
            'is_out_of_office': bool(candidate_row.get('is_out_of_office', False)),
            'availability_label': str(candidate_row.get('availability_label') or ''),
            'availability_window': str(candidate_row.get('availability_window') or ''),
            'role_count': int(candidate_row.get('role_count') or 0),
            'team_count': int(candidate_row.get('team_count') or 0),
            'teams': list(candidate_row.get('teams') or []),
            'pending_request_count': 0,
            'near_sla_request_count': 0,
            'overdue_request_count': 0,
            'stage_one_queue_count': 0,
            'stage_two_queue_count': 0,
            'primary_department_count': 0,
            'delegate_department_count': 0,
            'stage_one_primary_departments': [],
            'stage_two_primary_departments': [],
            'stage_one_delegate_departments': [],
            'stage_two_delegate_departments': [],
            'single_threaded_departments': [],
            'coverage_gap_departments': [],
            'pending_departments': [],
            'load_score': 0,
            'status': 'healthy',
            'warnings': [],
        }

    def append_department(row, field_name, department_label):
        label = str(department_label or '').strip()
        if not label:
            return
        if label not in row[field_name]:
            row[field_name].append(label)

    for rule in rule_rows:
        department_key = str(rule.get('department_key') or '')
        department_label = str(rule.get('department_label') or department_key.title() or 'General governance')
        coverage_row = coverage_map.get(department_key, {})

        stage_one_primary_id = int(rule.get('stage_one_primary_user_id') or 0)
        stage_one_delegate_id = int(rule.get('stage_one_delegate_user_id') or 0)
        stage_two_primary_id = int(rule.get('stage_two_primary_user_id') or 0)
        stage_two_delegate_id = int(rule.get('stage_two_delegate_user_id') or 0)

        if stage_one_primary_id in rows_by_id:
            row = rows_by_id[stage_one_primary_id]
            append_department(row, 'stage_one_primary_departments', department_label)
            row['primary_department_count'] += 1
            if coverage_row.get('stage_one_required') and not stage_one_delegate_id:
                append_department(row, 'single_threaded_departments', department_label)
            if coverage_row.get('stage_one_required') and not coverage_row.get('stage_one_ready'):
                append_department(row, 'coverage_gap_departments', department_label)
        if stage_one_delegate_id in rows_by_id:
            row = rows_by_id[stage_one_delegate_id]
            append_department(row, 'stage_one_delegate_departments', department_label)
            row['delegate_department_count'] += 1

        if stage_two_primary_id in rows_by_id:
            row = rows_by_id[stage_two_primary_id]
            append_department(row, 'stage_two_primary_departments', department_label)
            row['primary_department_count'] += 1
            if coverage_row.get('stage_two_required') and not stage_two_delegate_id:
                append_department(row, 'single_threaded_departments', department_label)
            if coverage_row.get('stage_two_required') and not coverage_row.get('stage_two_ready'):
                append_department(row, 'coverage_gap_departments', department_label)
        if stage_two_delegate_id in rows_by_id:
            row = rows_by_id[stage_two_delegate_id]
            append_department(row, 'stage_two_delegate_departments', department_label)
            row['delegate_department_count'] += 1

    for request_row in request_rows:
        if str(request_row.get('lifecycle_state') or '') != 'pending':
            continue
        active_approver = request_row.get('active_approver') or {}
        active_approver_id = int(active_approver.get('id') or 0)
        if active_approver_id not in rows_by_id:
            continue
        row = rows_by_id[active_approver_id]
        row['pending_request_count'] += 1
        if int(request_row.get('current_stage') or 1) > 1:
            row['stage_two_queue_count'] += 1
        else:
            row['stage_one_queue_count'] += 1
        append_department(row, 'pending_departments', (request_row.get('routing') or {}).get('department_label'))

        radar_item = radar_map.get(str(request_row.get('key') or ''))
        if radar_item is not None:
            if str(radar_item.get('status') or '') == 'overdue':
                row['overdue_request_count'] += 1
            else:
                row['near_sla_request_count'] += 1

    rows = []
    for candidate_id, row in rows_by_id.items():
        single_threaded_count = len(row['single_threaded_departments'])
        load_score = (
            int(row['pending_request_count'])
            + int(row['near_sla_request_count']) * 2
            + int(row['overdue_request_count']) * 3
            + max(0, int(row['primary_department_count']) - 1)
        )
        status_name = _get_access_exception_capacity_status(
            load_score=load_score,
            pending_request_count=row['pending_request_count'],
            overdue_request_count=row['overdue_request_count'],
            single_threaded_count=single_threaded_count,
        )
        if row['is_out_of_office'] and row['pending_request_count'] > 0:
            status_name = 'critical' if row['overdue_request_count'] > 0 else 'warning'
        warnings = []
        if row['overdue_request_count'] > 0:
            warnings.append(f"{row['overdue_request_count']} request dang overdue trong approval queue.")
        elif row['near_sla_request_count'] > 0:
            warnings.append(f"{row['near_sla_request_count']} request dang sat moc SLA.")
        if row['is_out_of_office']:
            availability_window = str(row.get('availability_window') or '').strip()
            availability_suffix = f" ({availability_window})" if availability_window else ''
            warnings.append(f"Approver dang out-of-office{availability_suffix}.")
        if row['pending_request_count'] >= 3:
            warnings.append(f"Pending load dang o muc {row['pending_request_count']} request.")
        if single_threaded_count > 0:
            warnings.append(f"{single_threaded_count} department dang single-threaded, chua co delegate backup.")
        if len(row['coverage_gap_departments']) > 0:
            warnings.append(f"{len(row['coverage_gap_departments'])} department owner nhung coverage van chua day du.")

        rows.append({
            **row,
            'approver_id': candidate_id,
            'load_score': load_score,
            'status': status_name,
            'warnings': warnings,
        })

    status_rank = {'critical': 0, 'warning': 1, 'healthy': 2}
    rows.sort(
        key=lambda item: (
            status_rank.get(str(item.get('status') or ''), 3),
            -int(item.get('overdue_request_count') or 0),
            -int(item.get('pending_request_count') or 0),
            str((item.get('approver') or {}).get('full_name') or (item.get('approver') or {}).get('username') or ''),
        )
    )
    return rows


def _build_access_exception_approver_capacity_summary(capacity_rows):
    return {
        'total_approvers': len(capacity_rows),
        'overloaded_approvers': sum(1 for row in capacity_rows if row.get('status') == 'critical'),
        'at_risk_approvers': sum(1 for row in capacity_rows if row.get('status') in {'critical', 'warning'}),
        'pending_assignments': sum(int(row.get('pending_request_count') or 0) for row in capacity_rows),
        'overdue_assignments': sum(int(row.get('overdue_request_count') or 0) for row in capacity_rows),
        'single_threaded_departments': sum(len(row.get('single_threaded_departments') or []) for row in capacity_rows),
        'coverage_gap_departments': sum(len(row.get('coverage_gap_departments') or []) for row in capacity_rows),
        'out_of_office_approvers': sum(1 for row in capacity_rows if row.get('is_out_of_office')),
    }


def _pick_access_exception_workload_candidate(capacity_rows, excluded_ids=None, preferred_tokens=None):
    normalized_excluded_ids = {
        int(value)
        for value in (excluded_ids or set())
        if value
    }
    status_rank = {'healthy': 0, 'warning': 1, 'critical': 2}
    candidates = []
    for row in capacity_rows:
        approver = row.get('approver') or {}
        approver_id = int(approver.get('id') or 0)
        if not approver_id or approver_id in normalized_excluded_ids or row.get('is_out_of_office'):
            continue
        team_matches = _match_access_exception_team_tokens_from_dicts(row.get('teams') or [], preferred_tokens or [])
        candidates.append({
            'row': row,
            'team_matches': team_matches,
            'ranking': (
                0 if team_matches else 1,
                status_rank.get(str(row.get('status') or ''), 3),
                int(row.get('pending_request_count') or 0),
                int(row.get('primary_department_count') or 0),
                -int(row.get('active_session_count') or 0),
                str(approver.get('full_name') or approver.get('username') or ''),
            ),
        })
    candidates.sort(key=lambda item: item['ranking'])
    return candidates[0] if candidates else None


def _build_access_exception_workload_recommendations(capacity_rows, coverage_rows, routing_rules=None):
    rule_map = {
        str(item.get('department_key') or ''): item
        for item in (routing_rules or [])
    }
    capacity_map = {
        int((item.get('approver') or {}).get('id') or 0): item
        for item in capacity_rows
        if int((item.get('approver') or {}).get('id') or 0)
    }
    seen_keys = set()
    recommendations = []

    def add_recommendation(payload):
        recommendation_id = str(payload.get('id') or '')
        if not recommendation_id or recommendation_id in seen_keys:
            return
        seen_keys.add(recommendation_id)
        recommendations.append(payload)

    for coverage_row in coverage_rows:
        department_key = str(coverage_row.get('department_key') or '')
        department_label = str(coverage_row.get('department_label') or department_key.title() or 'General governance')
        routing_rule = rule_map.get(department_key, {})
        preferred_tokens = _build_access_exception_workload_tokens(department_label, routing_rule=routing_rule, coverage_row=coverage_row)

        if coverage_row.get('stage_one_required') and not coverage_row.get('stage_one_ready'):
            candidate_pick = _pick_access_exception_workload_candidate(
                capacity_rows,
                excluded_ids={
                    routing_rule.get('stage_one_primary_user_id'),
                    routing_rule.get('stage_one_delegate_user_id'),
                },
                preferred_tokens=preferred_tokens,
            )
            add_recommendation({
                'id': f'assign-stage1-owner-{department_key}',
                'kind': 'assign-stage1-owner',
                'stage': 1,
                'severity': 'error' if int(coverage_row.get('critical_policy_count') or 0) > 0 else 'warning',
                'title': f'Gan stage 1 owner cho {department_label}',
                'description': 'Department nay dang co approval queue nhung routing directory stage 1 chua du owner/delegate.',
                'department_key': department_key,
                'department_label': department_label,
                'route': '/admin/access-exceptions',
                'current_owner': None,
                'recommended_primary_approver': (
                    (candidate_pick or {}).get('row', {}).get('approver')
                    if candidate_pick else None
                ),
                'recommended_delegate_approver': None,
                'rationale': 'Chon approver tai nhe hon va uu tien team co token phu hop voi department.',
                'action_label': 'Open routing',
            })

        if coverage_row.get('stage_two_required') and not coverage_row.get('stage_two_ready'):
            candidate_pick = _pick_access_exception_workload_candidate(
                capacity_rows,
                excluded_ids={
                    routing_rule.get('stage_two_primary_user_id'),
                    routing_rule.get('stage_two_delegate_user_id'),
                },
                preferred_tokens=preferred_tokens,
            )
            add_recommendation({
                'id': f'assign-stage2-owner-{department_key}',
                'kind': 'assign-stage2-owner',
                'stage': 2,
                'severity': 'error' if int(coverage_row.get('critical_policy_count') or 0) > 0 else 'warning',
                'title': f'Gan stage 2 owner cho {department_label}',
                'description': 'Multi-stage exception dang mo nhung stage 2 owner/delegate chua duoc gan trong routing directory.',
                'department_key': department_key,
                'department_label': department_label,
                'route': '/admin/access-exceptions',
                'current_owner': None,
                'recommended_primary_approver': (
                    (candidate_pick or {}).get('row', {}).get('approver')
                    if candidate_pick else None
                ),
                'recommended_delegate_approver': None,
                'rationale': 'Nen bo tri owner doc lap cho stage 2 de tranh bottleneck 4-eye review.',
                'action_label': 'Open routing',
            })

    for capacity_row in capacity_rows:
        if capacity_row.get('status') not in {'warning', 'critical'}:
            continue
        primary_departments = list(capacity_row.get('stage_one_primary_departments') or []) + list(capacity_row.get('stage_two_primary_departments') or [])
        if not primary_departments:
            continue

        target_department_label = (
            next(iter(capacity_row.get('single_threaded_departments') or []), '')
            or next(iter(primary_departments), '')
        )
        if not target_department_label:
            continue
        coverage_row = next((item for item in coverage_rows if item.get('department_label') == target_department_label), None)
        if coverage_row is None:
            continue
        department_key = str(coverage_row.get('department_key') or '')
        routing_rule = rule_map.get(department_key, {})
        preferred_tokens = _build_access_exception_workload_tokens(target_department_label, routing_rule=routing_rule, coverage_row=coverage_row)
        current_owner = capacity_row.get('approver')
        candidate_pick = _pick_access_exception_workload_candidate(
            capacity_rows,
            excluded_ids={
                (current_owner or {}).get('id'),
                routing_rule.get('stage_one_delegate_user_id'),
                routing_rule.get('stage_two_delegate_user_id'),
            },
            preferred_tokens=preferred_tokens,
        )
        add_recommendation({
            'id': f'add-delegate-{department_key}-{int((current_owner or {}).get("id") or 0)}',
            'kind': 'add-delegate',
            'stage': 1,
            'severity': 'error' if int(capacity_row.get('overdue_request_count') or 0) > 0 else 'warning',
            'title': f'Can bang tai cho {target_department_label}',
            'description': (
                f"{(current_owner or {}).get('full_name') or (current_owner or {}).get('username') or 'Approver'} "
                f"dang giu {int(capacity_row.get('pending_request_count') or 0)} pending request "
                f"va {int(capacity_row.get('overdue_request_count') or 0)} overdue."
            ),
            'department_key': department_key,
            'department_label': target_department_label,
            'route': '/admin/access-exceptions',
            'current_owner': current_owner,
            'recommended_primary_approver': None,
            'recommended_delegate_approver': (
                (candidate_pick or {}).get('row', {}).get('approver')
                if candidate_pick else None
            ),
            'rationale': 'Them delegate cho department co pending load cao de queue khong bi single-threaded.',
            'action_label': 'Open routing',
        })

    recommendations.sort(
        key=lambda item: (
            0 if item.get('severity') == 'error' else 1 if item.get('severity') == 'warning' else 2,
            str(item.get('department_label') or ''),
            str(item.get('title') or ''),
        )
    )
    return recommendations[:8]


def _build_access_exception_continuity_runbook_rows(request_rows, policy_rows, approver_candidates=None):
    pending_rows = [
        item
        for item in (request_rows or [])
        if str(item.get('lifecycle_state') or '') == 'pending'
        and int((item.get('active_approver') or {}).get('id') or 0)
    ]
    if not pending_rows:
        return []

    availability_map = _get_access_exception_approver_availability_map()
    impacted_rows = [
        item
        for item in pending_rows
        if _is_access_exception_approver_out_of_office(
            availability_map.get(int((item.get('active_approver') or {}).get('id') or 0))
        )
    ]
    if not impacted_rows:
        return []

    candidate_users = list(approver_candidates or _build_access_exception_approver_users(limit=40))
    user_ids = sorted({
        int(value)
        for item in impacted_rows
        for value in [
            (item.get('target_user') or {}).get('id'),
            (item.get('requested_by') or {}).get('id'),
            (item.get('active_approver') or {}).get('id'),
        ]
        if value
    })
    user_map = {
        user.id: user
        for user in User.objects.filter(id__in=user_ids).prefetch_related('roles__permissions', 'teams')
    }
    policy_map = {str(item.get('key') or ''): item for item in policy_rows if str(item.get('key') or '').strip()}
    items = []
    for request_row in impacted_rows:
        request_key = str(request_row.get('key') or '')
        current_stage = int(request_row.get('current_stage') or 1)
        policy_key = str((request_row.get('policy') or {}).get('key') or request_row.get('policy_key') or '')
        policy_row = policy_map.get(policy_key)
        target_user = user_map.get(int((request_row.get('target_user') or {}).get('id') or 0))
        requester_user = user_map.get(int((request_row.get('requested_by') or {}).get('id') or 0))
        active_approver_user = user_map.get(int((request_row.get('active_approver') or {}).get('id') or 0))
        availability_entry = availability_map.get(int((request_row.get('active_approver') or {}).get('id') or 0))
        routing_plan = None
        if policy_row is not None and target_user is not None and active_approver_user is not None:
            routing_plan = _build_access_exception_routing_plan(
                policy=policy_row,
                target_user=target_user,
                requester=requester_user or active_approver_user,
                approver_candidates=candidate_users,
            )

        suggested_user = (
            (routing_plan or {}).get('selected_stage_two_user')
            if current_stage > 1 else (routing_plan or {}).get('selected_stage_one_user')
        )
        suggested_source_label = (
            str((routing_plan or {}).get('selected_stage_two_source_label') or '')
            if current_stage > 1 else str((routing_plan or {}).get('selected_stage_one_source_label') or '')
        )
        suggested_resolution_label = (
            str((routing_plan or {}).get('selected_stage_two_resolution_label') or '')
            if current_stage > 1 else str((routing_plan or {}).get('selected_stage_one_resolution_label') or '')
        )
        suggested_coverage_note = (
            str((routing_plan or {}).get('selected_stage_two_coverage_note') or '')
            if current_stage > 1 else str((routing_plan or {}).get('selected_stage_one_coverage_note') or '')
        )
        is_ready_to_reroute = bool(
            suggested_user is not None
            and active_approver_user is not None
            and int(suggested_user.id) != int(active_approver_user.id)
        )
        items.append({
            'request_key': request_key,
            'department_key': str((request_row.get('routing') or {}).get('department_key') or 'general'),
            'department_label': str((request_row.get('routing') or {}).get('department_label') or 'General governance'),
            'current_stage': current_stage,
            'total_stages': int(request_row.get('total_stages') or 1),
            'stage_label': str(request_row.get('current_stage_label') or f'Stage {current_stage}'),
            'target_user': request_row.get('target_user') or {},
            'policy': request_row.get('policy') or {},
            'active_approver': _serialize_access_exception_approver_reference(active_approver_user),
            'availability_label': str((availability_entry or {}).get('label') or ''),
            'availability_window': _format_access_exception_availability_window(availability_entry),
            'continuity_note': _build_access_exception_out_of_office_note(active_approver_user, availability_entry),
            'suggested_approver': _serialize_access_exception_approver_reference(suggested_user),
            'suggested_source_label': suggested_source_label,
            'suggested_resolution_label': suggested_resolution_label,
            'suggested_coverage_note': suggested_coverage_note,
            'reroute_count': int((request_row.get('continuity') or {}).get('reroute_count') or 0),
            'last_rerouted_at': _parse_access_exception_datetime((request_row.get('continuity') or {}).get('last_rerouted_at')),
            'status': 'ready-to-reroute' if is_ready_to_reroute else 'needs-manual',
            'status_label': 'Sẵn sàng đổi tuyến' if is_ready_to_reroute else 'Cần người xử lý tay',
            'route': '/admin/access-exceptions',
        })
    items.sort(
        key=lambda item: (
            0 if item.get('status') == 'needs-manual' else 1,
            -int(item.get('current_stage') or 1),
            str(item.get('department_label') or ''),
            str(item.get('request_key') or ''),
        )
    )
    return items


def _build_access_exception_continuity_summary(runbook_rows):
    return {
        'impacted_requests': len(runbook_rows),
        'ready_to_reroute': sum(1 for item in runbook_rows if item.get('status') == 'ready-to-reroute'),
        'needs_manual': sum(1 for item in runbook_rows if item.get('status') == 'needs-manual'),
        'impacted_departments': len({
            str(item.get('department_key') or '')
            for item in runbook_rows
            if str(item.get('department_key') or '').strip()
        }),
    }


def _collect_access_exception_routing_rule_user_ids(rule):
    if not isinstance(rule, dict):
        return []
    collected = []
    for stage_level in (1, 2):
        stage_config = _get_access_exception_directory_stage_config(rule, stage_level=stage_level)
        for user_id in [
            stage_config.get('primary_user_id'),
            stage_config.get('delegate_user_id'),
            *list(stage_config.get('rotation_user_ids') or []),
        ]:
            try:
                normalized = int(user_id)
            except (TypeError, ValueError):
                continue
            if normalized and normalized not in collected:
                collected.append(normalized)
    return collected


def _build_access_exception_department_continuity_rows(coverage_rows, continuity_rows, availability_rows=None, drill_state=None, automation_policy=None):
    safe_coverage_rows = list(coverage_rows or [])
    safe_continuity_rows = list(continuity_rows or [])
    safe_availability_rows = list(availability_rows or [])
    safe_drill_state = _serialize_access_exception_continuity_drill_state_storage(drill_state or {})
    policy = _serialize_access_exception_automation_policy_storage(automation_policy or {})
    interval_days = int(policy.get('continuity_drill_interval_days') or 7)
    warning_days = int(policy.get('continuity_drill_warning_days') or 2)
    now = django_timezone.now()

    continuity_map = defaultdict(lambda: {
        'impacted_requests': 0,
        'ready_to_reroute': 0,
        'needs_manual': 0,
        'request_keys': [],
    })
    for item in safe_continuity_rows:
        department_key = str(item.get('department_key') or '').strip().lower()
        if not department_key:
            continue
        continuity_map[department_key]['impacted_requests'] += 1
        if item.get('status') == 'ready-to-reroute':
            continuity_map[department_key]['ready_to_reroute'] += 1
        if item.get('status') == 'needs-manual':
            continuity_map[department_key]['needs_manual'] += 1
        request_key = str(item.get('request_key') or '')
        if request_key and request_key not in continuity_map[department_key]['request_keys']:
            continuity_map[department_key]['request_keys'].append(request_key)

    label_to_key = {
        str(item.get('department_label') or '').strip(): str(item.get('department_key') or '').strip().lower()
        for item in safe_coverage_rows
        if str(item.get('department_label') or '').strip() and str(item.get('department_key') or '').strip()
    }
    ooo_department_map = defaultdict(lambda: {'count': 0, 'approver_names': []})
    for item in safe_availability_rows:
        if not item.get('is_currently_out_of_office'):
            continue
        approver = item.get('approver') or {}
        approver_label = str(approver.get('full_name') or approver.get('username') or '')
        department_labels = {
            str(value or '').strip()
            for value in [
                *(item.get('primary_departments') or []),
                *(item.get('delegate_departments') or []),
                *(item.get('rotation_departments') or []),
            ]
            if str(value or '').strip()
        }
        for department_label in department_labels:
            department_key = label_to_key.get(department_label)
            if not department_key:
                continue
            ooo_department_map[department_key]['count'] += 1
            if approver_label and approver_label not in ooo_department_map[department_key]['approver_names']:
                ooo_department_map[department_key]['approver_names'].append(approver_label)

    items = []
    for coverage_row in safe_coverage_rows:
        department_key = str(coverage_row.get('department_key') or '').strip().lower()
        if not department_key:
            continue
        department_label = str(coverage_row.get('department_label') or department_key.title() or 'General governance')
        continuity_entry = continuity_map.get(department_key, {})
        ooo_entry = ooo_department_map.get(department_key, {})
        drill_snapshot = (safe_drill_state.get('departments') or {}).get(department_key, {})
        last_drill_at = _parse_access_exception_datetime(drill_snapshot.get('last_drill_at'))
        days_since_last_drill = None
        if last_drill_at is not None:
            days_since_last_drill = max(0, int(math.floor((now - last_drill_at).total_seconds() / 86400)))

        impacted_requests = int(continuity_entry.get('impacted_requests') or 0)
        ready_to_reroute = int(continuity_entry.get('ready_to_reroute') or 0)
        needs_manual = int(continuity_entry.get('needs_manual') or 0)
        pending_request_count = int(coverage_row.get('pending_request_count') or 0)
        approval_policy_count = int(coverage_row.get('approval_policy_count') or 0)
        out_of_office_owner_count = int(ooo_entry.get('count') or 0)
        should_monitor = bool(
            approval_policy_count
            or pending_request_count
            or impacted_requests
            or out_of_office_owner_count
        )

        if not should_monitor:
            drill_status = 'standby'
        elif needs_manual > 0 and (last_drill_at is None or (days_since_last_drill or 0) >= max(1, warning_days)):
            drill_status = 'overdue'
        elif last_drill_at is None:
            drill_status = 'due'
        elif (days_since_last_drill or 0) >= interval_days:
            drill_status = 'overdue'
        elif (days_since_last_drill or 0) >= max(1, interval_days - warning_days):
            drill_status = 'due'
        else:
            drill_status = 'ready'

        preparedness_score = 100
        preparedness_score -= needs_manual * 25
        preparedness_score -= max(0, impacted_requests - ready_to_reroute) * 15
        preparedness_score -= out_of_office_owner_count * 5
        preparedness_score -= 10 if not coverage_row.get('stage_one_ready') else 0
        preparedness_score -= 10 if coverage_row.get('stage_two_required') and not coverage_row.get('stage_two_ready') else 0
        preparedness_score -= 20 if drill_status == 'overdue' else 10 if drill_status == 'due' else 0
        preparedness_score = max(0, preparedness_score)

        if needs_manual > 0:
            suggested_focus = 'Can manual continuity owner hoac delegate bo sung cho request dang bi anh huong.'
        elif not coverage_row.get('stage_one_ready'):
            suggested_focus = 'Gan stage 1 owner/delegate truoc khi queue approval tang tai.'
        elif coverage_row.get('stage_two_required') and not coverage_row.get('stage_two_ready'):
            suggested_focus = 'Bo tri stage 2 owner doc lap de drill khong bi tac o lop phe duyet thu hai.'
        elif drill_status in {'due', 'overdue'}:
            suggested_focus = 'Nen chay fallback drill de xac thuc auto-reroute va coverage path cua department.'
        elif out_of_office_owner_count > 0:
            suggested_focus = 'Department dang co owner vang mat, can theo doi backup va reroute queue.'
        else:
            suggested_focus = 'Continuity coverage dang on dinh.'

        items.append({
            'department_key': department_key,
            'department_label': department_label,
            'pending_request_count': pending_request_count,
            'impacted_request_count': impacted_requests,
            'ready_to_reroute_count': ready_to_reroute,
            'manual_gap_requests': needs_manual,
            'out_of_office_owner_count': out_of_office_owner_count,
            'out_of_office_owner_names': list(ooo_entry.get('approver_names') or [])[:6],
            'last_drill_at': last_drill_at,
            'days_since_last_drill': days_since_last_drill,
            'drill_status': drill_status,
            'drill_status_label': {
                'ready': 'Drill fresh',
                'due': 'Drill due',
                'overdue': 'Drill overdue',
                'standby': 'Standby',
            }.get(drill_status, 'Standby'),
            'preparedness_score': preparedness_score,
            'request_keys': list(continuity_entry.get('request_keys') or [])[:8],
            'critical_policy_count': int(coverage_row.get('critical_policy_count') or 0),
            'approval_policy_count': approval_policy_count,
            'stage_one_ready': bool(coverage_row.get('stage_one_ready')),
            'stage_two_ready': bool(coverage_row.get('stage_two_ready')),
            'stage_two_required': bool(coverage_row.get('stage_two_required')),
            'suggested_focus': suggested_focus,
            'route': '/admin/access-exceptions',
        })

    status_rank = {'overdue': 0, 'due': 1, 'ready': 2, 'standby': 3}
    items.sort(
        key=lambda item: (
            status_rank.get(str(item.get('drill_status') or ''), 4),
            -int(item.get('manual_gap_requests') or 0),
            -int(item.get('impacted_request_count') or 0),
            str(item.get('department_label') or ''),
        )
    )
    return items[:12]


def _build_access_exception_department_continuity_summary(analytics_rows):
    return {
        'departments_tracked': len(analytics_rows),
        'departments_due': sum(1 for item in analytics_rows if item.get('drill_status') == 'due'),
        'departments_overdue': sum(1 for item in analytics_rows if item.get('drill_status') == 'overdue'),
        'departments_ready': sum(1 for item in analytics_rows if item.get('drill_status') in {'ready', 'standby'}),
        'departments_with_manual_gap': sum(1 for item in analytics_rows if int(item.get('manual_gap_requests') or 0) > 0),
    }


def _build_access_exception_continuity_drill_preview(analytics_rows, automation_policy=None, now=None):
    policy = _serialize_access_exception_automation_policy_storage(automation_policy or {})
    current_time = now or django_timezone.now()
    items = []
    for row in analytics_rows or []:
        drill_status = str(row.get('drill_status') or '')
        if drill_status not in {'due', 'overdue'} and int(row.get('manual_gap_requests') or 0) <= 0:
            continue
        items.append({
            'id': f"drill-{row.get('department_key')}",
            'department_key': str(row.get('department_key') or ''),
            'department_label': str(row.get('department_label') or ''),
            'severity': 'error' if drill_status == 'overdue' or int(row.get('manual_gap_requests') or 0) > 0 else 'warning',
            'status': drill_status or 'due',
            'status_label': str(row.get('drill_status_label') or 'Drill due'),
            'pending_request_count': int(row.get('pending_request_count') or 0),
            'impacted_request_count': int(row.get('impacted_request_count') or 0),
            'ready_to_reroute_count': int(row.get('ready_to_reroute_count') or 0),
            'manual_gap_requests': int(row.get('manual_gap_requests') or 0),
            'out_of_office_owner_count': int(row.get('out_of_office_owner_count') or 0),
            'last_drill_at': row.get('last_drill_at'),
            'days_since_last_drill': row.get('days_since_last_drill'),
            'suggested_focus': str(row.get('suggested_focus') or ''),
            'route': '/admin/access-exceptions',
        })
    return {
        'generated_at': current_time,
        'summary': {
            'drills_due': len(items),
            'drills_overdue': sum(1 for item in items if item.get('status') == 'overdue'),
            'playbooks_prepared': len(items) if policy.get('auto_prepare_playbooks', True) else 0,
        },
        'items': items[:8],
    }


def _build_access_exception_absence_playbook_items(simulated_user_ids, impacted_request_rows, analytics_rows, availability_rows=None):
    availability_map = _get_access_exception_approver_availability_map(availability_rows)
    items = []
    seen_ids = set()

    def add_item(payload):
        item_id = str(payload.get('id') or '')
        if not item_id or item_id in seen_ids:
            return
        seen_ids.add(item_id)
        items.append(payload)

    for user_id in sorted(simulated_user_ids):
        availability_entry = availability_map.get(int(user_id))
        if availability_entry and availability_entry.get('backup_user_id'):
            continue
        user = User.objects.filter(id=user_id).first()
        user_label = user.get_full_name() or user.username if user is not None else f'user {user_id}'
        add_item({
            'id': f'seed-backup-{user_id}',
            'kind': 'seed-backup',
            'severity': 'warning',
            'title': f'Bo sung backup cho {user_label}',
            'description': 'Simulation phat hien approver nay chua co backup ro rang trong coverage desk.',
            'route': '/admin/access-exceptions',
            'department_key': '',
            'request_key': None,
            'action_label': 'Coverage desk',
        })

    for row in impacted_request_rows:
        request_key = str(row.get('request_key') or '')
        if row.get('status') == 'ready-to-reroute':
            add_item({
                'id': f'prestage-reroute-{request_key}',
                'kind': 'prestage-reroute',
                'severity': 'info',
                'title': f'Prestage reroute cho {request_key}',
                'description': f"Co the reroute sang {(row.get('suggested_approver') or {}).get('full_name') or (row.get('suggested_approver') or {}).get('username') or 'backup approver'} neu vang mat xay ra.",
                'route': '/admin/access-exceptions',
                'department_key': str(row.get('department_key') or ''),
                'request_key': request_key,
                'action_label': 'Open queue',
            })
        else:
            add_item({
                'id': f'manual-reroute-{request_key}',
                'kind': 'manual-reroute',
                'severity': 'error',
                'title': f'Request {request_key} can continuity owner',
                'description': 'Chua tim thay approver thay the hop le trong simulation, can bo sung delegate hoac routing owner.',
                'route': '/admin/access-exceptions',
                'department_key': str(row.get('department_key') or ''),
                'request_key': request_key,
                'action_label': 'Open routing',
            })

    for row in analytics_rows or []:
        if str(row.get('drill_status') or '') not in {'due', 'overdue'}:
            continue
        add_item({
            'id': f"run-drill-{row.get('department_key')}",
            'kind': 'run-drill',
            'severity': 'warning' if row.get('drill_status') == 'due' else 'error',
            'title': f"Chay fallback drill cho {row.get('department_label')}",
            'description': str(row.get('suggested_focus') or 'Can kiem tra continuity coverage va auto-reroute cho department nay.'),
            'route': '/admin/access-exceptions',
            'department_key': str(row.get('department_key') or ''),
            'request_key': None,
            'action_label': 'Run drill',
        })

    severity_rank = {'error': 0, 'warning': 1, 'info': 2}
    items.sort(key=lambda item: (severity_rank.get(str(item.get('severity') or ''), 3), str(item.get('title') or '')))
    return items[:12]


def _build_access_exception_absence_simulation(policy_rows, request_rows, routing_rules=None, approver_candidates=None, availability_rows=None, drill_state=None, approver_user_ids=None, department_key='', duration_hours=24):
    safe_department_key = str(department_key or '').strip().lower()
    rule_map = {
        str(item.get('department_key') or ''): item
        for item in (routing_rules or _build_access_exception_routing_rule_rows())
    }
    simulated_user_ids = {
        int(value)
        for value in (approver_user_ids or [])
        if value
    }
    if safe_department_key and not simulated_user_ids:
        simulated_user_ids.update(_collect_access_exception_routing_rule_user_ids(rule_map.get(safe_department_key)))

    candidate_users = list(approver_candidates or _build_access_exception_approver_users(limit=40))
    user_ids = set(simulated_user_ids)
    impacted_request_rows_raw = [
        item
        for item in (request_rows or [])
        if str(item.get('lifecycle_state') or '') == 'pending'
        and int((item.get('active_approver') or {}).get('id') or 0) in simulated_user_ids
        and (not safe_department_key or str((item.get('routing') or {}).get('department_key') or '') == safe_department_key)
    ]
    for row in impacted_request_rows_raw:
        user_ids.update({
            int(value)
            for value in [
                (row.get('target_user') or {}).get('id'),
                (row.get('requested_by') or {}).get('id'),
                (row.get('active_approver') or {}).get('id'),
            ]
            if value
        })
    user_map = {
        user.id: user
        for user in User.objects.filter(id__in=sorted(user_ids)).prefetch_related('roles__permissions', 'teams')
    }
    policy_map = {
        str(item.get('key') or ''): item
        for item in policy_rows or []
        if str(item.get('key') or '').strip()
    }
    impacted_rows = []
    impacted_departments = set()
    for request_row in impacted_request_rows_raw:
        current_stage = int(request_row.get('current_stage') or 1)
        target_user = user_map.get(int((request_row.get('target_user') or {}).get('id') or 0))
        requester_user = user_map.get(int((request_row.get('requested_by') or {}).get('id') or 0))
        active_approver_user = user_map.get(int((request_row.get('active_approver') or {}).get('id') or 0))
        policy_key = str((request_row.get('policy') or {}).get('key') or request_row.get('policy_key') or '')
        policy_row = policy_map.get(policy_key)
        routing_plan = None
        if policy_row is not None and target_user is not None:
            routing_plan = _build_access_exception_routing_plan(
                policy=policy_row,
                target_user=target_user,
                requester=requester_user or active_approver_user or target_user,
                approver_candidates=candidate_users,
                unavailable_user_ids=simulated_user_ids,
            )

        suggested_user = (
            (routing_plan or {}).get('selected_stage_two_user')
            if current_stage > 1 else (routing_plan or {}).get('selected_stage_one_user')
        )
        suggested_source_label = (
            str((routing_plan or {}).get('selected_stage_two_source_label') or '')
            if current_stage > 1 else str((routing_plan or {}).get('selected_stage_one_source_label') or '')
        )
        suggested_resolution_label = (
            str((routing_plan or {}).get('selected_stage_two_resolution_label') or '')
            if current_stage > 1 else str((routing_plan or {}).get('selected_stage_one_resolution_label') or '')
        )
        suggested_coverage_note = (
            str((routing_plan or {}).get('selected_stage_two_coverage_note') or '')
            if current_stage > 1 else str((routing_plan or {}).get('selected_stage_one_coverage_note') or '')
        )
        is_ready_to_reroute = bool(
            suggested_user is not None
            and active_approver_user is not None
            and int(suggested_user.id) != int(active_approver_user.id)
            and int(suggested_user.id) not in simulated_user_ids
        )
        department_key_value = str((request_row.get('routing') or {}).get('department_key') or 'general')
        impacted_departments.add(department_key_value)
        impacted_rows.append({
            'request_key': str(request_row.get('key') or ''),
            'department_key': department_key_value,
            'department_label': str((request_row.get('routing') or {}).get('department_label') or 'General governance'),
            'stage_label': str(request_row.get('current_stage_label') or f'Stage {current_stage}'),
            'current_stage': current_stage,
            'total_stages': int(request_row.get('total_stages') or 1),
            'target_user': request_row.get('target_user') or {},
            'policy': request_row.get('policy') or {},
            'active_approver': _serialize_access_exception_approver_reference(active_approver_user),
            'continuity_note': _build_access_exception_simulated_absence_note(active_approver_user),
            'suggested_approver': _serialize_access_exception_approver_reference(suggested_user),
            'suggested_source_label': suggested_source_label,
            'suggested_resolution_label': suggested_resolution_label,
            'suggested_coverage_note': suggested_coverage_note,
            'status': 'ready-to-reroute' if is_ready_to_reroute else 'needs-manual',
            'status_label': 'Sẵn sàng đổi tuyến' if is_ready_to_reroute else 'Cần người xử lý tay',
            'route': '/admin/access-exceptions',
        })

    impacted_rows.sort(
        key=lambda item: (
            0 if item.get('status') == 'needs-manual' else 1,
            str(item.get('department_label') or ''),
            str(item.get('request_key') or ''),
        )
    )
    continuity_analytics = _build_access_exception_department_continuity_rows(
        coverage_rows=[
            item
            for item in _build_access_exception_routing_coverage_rows(
                policy_rows=policy_rows,
                request_rows=request_rows,
                routing_rules=routing_rules,
                sla_radar=_build_access_exception_sla_radar(
                    request_rows=request_rows,
                    automation_policy=_load_access_exception_automation_policy(),
                ),
            )
            if not safe_department_key or str(item.get('department_key') or '') == safe_department_key or str(item.get('department_key') or '') in impacted_departments
        ],
        continuity_rows=impacted_rows,
        availability_rows=availability_rows,
        drill_state=drill_state,
        automation_policy=_load_access_exception_automation_policy(),
    )
    playbooks = _build_access_exception_absence_playbook_items(
        simulated_user_ids=simulated_user_ids,
        impacted_request_rows=impacted_rows,
        analytics_rows=continuity_analytics,
        availability_rows=availability_rows,
    )
    return {
        'generated_at': django_timezone.now(),
        'simulation_label': (
            f"Department {safe_department_key} | {int(duration_hours or 24)}h"
            if safe_department_key else f"{len(simulated_user_ids)} approver | {int(duration_hours or 24)}h"
        ),
        'department_key': safe_department_key,
        'duration_hours': max(1, int(duration_hours or 24)),
        'simulated_approvers': [
            _serialize_access_exception_approver_reference(user_map.get(user_id) or next((user for user in candidate_users if int(user.id) == int(user_id)), None))
            for user_id in sorted(simulated_user_ids)
            if (user_map.get(user_id) or next((user for user in candidate_users if int(user.id) == int(user_id)), None)) is not None
        ],
        'summary': {
            'impacted_requests': len(impacted_rows),
            'ready_to_reroute': sum(1 for item in impacted_rows if item.get('status') == 'ready-to-reroute'),
            'needs_manual': sum(1 for item in impacted_rows if item.get('status') == 'needs-manual'),
            'departments_impacted': len(impacted_departments),
            'playbooks_prepared': len(playbooks),
        },
        'impacted_requests': impacted_rows[:12],
        'continuity_analytics': continuity_analytics,
        'playbooks': playbooks,
    }


def _build_access_exception_watchlist(policy_rows, request_rows, coverage_rows=None, sla_radar=None, capacity_rows=None, availability_rows=None, continuity_rows=None, continuity_analytics=None, continuity_drill_preview=None):
    items = []
    now = django_timezone.now()
    stale_pending_cutoff = now - timedelta(hours=48)
    for policy in policy_rows:
        if policy['is_active'] and (policy['missing_role_ids'] or policy['missing_team_ids']):
            items.append({
                'severity': 'error',
                'title': f"Policy {policy['name']} dang tham chieu access da mat",
                'description': 'Can mo policy va lam sach role/team khong con ton tai de tranh cap access sai.',
                'route': '/admin/access-exceptions',
                'policy_key': policy['key'],
                'request_key': None,
                'lifecycle_state': 'policy-finding',
            })
        if policy['is_active'] and (policy['inactive_role_ids'] or policy['inactive_team_ids']):
            items.append({
                'severity': 'warning',
                'title': f"Policy {policy['name']} dang dung dependency tam ngung",
                'description': 'Role hoac team cua policy dang khong hoat dong, can review truoc khi tiep tuc cap ngoai le.',
                'route': '/admin/access-exceptions',
                'policy_key': policy['key'],
                'request_key': None,
                'lifecycle_state': 'policy-finding',
            })
        if policy['is_active'] and policy['risk_level'] == 'critical' and not policy['requires_approval']:
            items.append({
                'severity': 'error',
                'title': f"Policy {policy['name']} dang bo qua approval",
                'description': 'Critical exception nen luon di qua approval workflow de dam bao governance.',
                'route': '/admin/access-exceptions',
                'policy_key': policy['key'],
                'request_key': None,
                'lifecycle_state': 'policy-finding',
            })
        if policy.get('debt_status') == 'critical':
            items.append({
                'severity': 'error',
                'title': f"Policy {policy['name']} dang co governance debt cao",
                'description': (
                    f"Debt score {int(policy.get('debt_score') or 0)}/100. "
                    f"{(policy.get('debt_reasons') or ['Can review lai control, routing va queue pressure.'])[0]}"
                ),
                'route': '/admin/access-exceptions',
                'policy_key': policy['key'],
                'request_key': None,
                'lifecycle_state': 'policy-debt',
            })

    for request_row in request_rows:
        requested_at = _parse_access_exception_datetime(request_row.get('requested_at'))
        planned_expires_at = _parse_access_exception_datetime(request_row.get('planned_expires_at'))
        if request_row.get('lifecycle_state') == 'pending' and requested_at and requested_at <= stale_pending_cutoff:
            items.append({
                'severity': 'warning',
                'title': f"Request {request_row['key']} dang cho approval qua lau",
                'description': 'Request da pending hon 48 gio, nen chot approve/reject de tranh backlog governance.',
                'route': '/admin/access-exceptions',
                'policy_key': request_row.get('policy', {}).get('key') or request_row.get('policy_key'),
                'request_key': request_row['key'],
                'lifecycle_state': 'pending',
            })
        if request_row.get('lifecycle_state') == 'pending' and request_row.get('is_stage_overdue'):
            items.append({
                'severity': 'error',
                'title': f"Request {request_row['key']} da tre SLA o {request_row.get('current_stage_label') or 'approval stage'}",
                'description': (
                    f"Stage {int(request_row.get('current_stage') or 1)}/{int(request_row.get('total_stages') or 1)} "
                    f"qua han tu {django_timezone.localtime(_parse_access_exception_datetime(request_row.get('approval_stage_due_at'))).strftime('%d/%m/%Y %H:%M') if _parse_access_exception_datetime(request_row.get('approval_stage_due_at')) else 'khung SLA'}."
                ),
                'route': '/admin/access-exceptions',
                'policy_key': request_row.get('policy', {}).get('key') or request_row.get('policy_key'),
                'request_key': request_row['key'],
                'lifecycle_state': 'pending',
            })
        if request_row.get('lifecycle_state') == 'expiring':
            items.append({
                'severity': 'warning',
                'title': f"Exception cho {request_row['target_user']['full_name'] or request_row['target_user']['username']} sap het han",
                'description': (
                    f"Policy {request_row['policy']['name']} du kien het han vao "
                    f"{django_timezone.localtime(planned_expires_at).strftime('%d/%m/%Y %H:%M') if planned_expires_at else 'som'}."
                ),
                'route': '/admin/access-exceptions',
                'policy_key': request_row.get('policy', {}).get('key') or request_row.get('policy_key'),
                'request_key': request_row['key'],
                'lifecycle_state': 'expiring',
            })
        if request_row.get('lifecycle_state') == 'expired' and request_row.get('access_still_present'):
            items.append({
                'severity': 'error',
                'title': f"Exception {request_row['key']} da het han nhung access van con",
                'description': 'Nen revoke ngay de dua target ve baseline access sau khi exception ket thuc.',
                'route': '/admin/access-exceptions',
                'policy_key': request_row.get('policy', {}).get('key') or request_row.get('policy_key'),
                'request_key': request_row['key'],
                'lifecycle_state': 'expired',
            })
        if request_row.get('has_self_approval') and request_row.get('lifecycle_state') in {'pending', 'active', 'expiring'}:
            items.append({
                'severity': 'warning',
                'title': f"Request {request_row['key']} co dau hieu self-approval",
                'description': 'Requester dang nam trong luong phe duyet cua chinh request nay, nen review lai 4-eye control.',
                'route': '/admin/access-exceptions',
                'policy_key': request_row.get('policy', {}).get('key') or request_row.get('policy_key'),
                'request_key': request_row['key'],
                'lifecycle_state': str(request_row.get('lifecycle_state') or 'pending'),
            })
        if int(request_row.get('risk_score') or 0) >= 80:
            items.append({
                'severity': 'error',
                'title': f"Request {request_row['key']} dang o muc risk rat cao",
                'description': (
                    (request_row.get('risk_reasons') or ['Can review exception nay som de giam pressure governance.'])[0]
                ),
                'route': '/admin/access-exceptions',
                'policy_key': request_row.get('policy', {}).get('key') or request_row.get('policy_key'),
                'request_key': request_row['key'],
                'lifecycle_state': 'high-risk-request',
            })
    for coverage_row in coverage_rows or []:
        if coverage_row.get('stage_one_required') and not coverage_row.get('stage_one_ready'):
            items.append({
                'severity': 'error' if int(coverage_row.get('critical_policy_count') or 0) > 0 else 'warning',
                'title': f"{coverage_row.get('department_label') or coverage_row.get('department_key')} thieu stage 1 owner coverage",
                'description': 'Nen gan owner/delegate cho department routing directory de request khong phai fallback thu cong.',
                'route': '/admin/access-exceptions',
                'policy_key': None,
                'request_key': None,
                'lifecycle_state': 'coverage-gap',
            })
        if coverage_row.get('stage_two_required') and not coverage_row.get('stage_two_ready'):
            items.append({
                'severity': 'error' if int(coverage_row.get('critical_policy_count') or 0) > 0 else 'warning',
                'title': f"{coverage_row.get('department_label') or coverage_row.get('department_key')} thieu stage 2 owner coverage",
                'description': 'Multi-stage exception dang mo nhung stage 2 owner/delegate chua duoc gan trong routing directory.',
                'route': '/admin/access-exceptions',
                'policy_key': None,
                'request_key': None,
                'lifecycle_state': 'coverage-gap',
            })
    for radar_item in list((sla_radar or {}).get('items', []))[:4]:
        if radar_item.get('status') != 'near-due':
            continue
        items.append({
            'severity': 'warning',
            'title': f"Request {radar_item.get('request_key')} sap breach SLA",
            'description': (
                f"{radar_item.get('stage_label') or 'Approval stage'} cua "
                f"{(radar_item.get('target_user') or {}).get('full_name') or (radar_item.get('target_user') or {}).get('username') or radar_item.get('request_key')} "
                f"can review truoc {django_timezone.localtime(_parse_access_exception_datetime(radar_item.get('approval_stage_due_at'))).strftime('%d/%m/%Y %H:%M') if _parse_access_exception_datetime(radar_item.get('approval_stage_due_at')) else 'khung SLA'}."
            ),
            'route': '/admin/access-exceptions',
            'policy_key': (radar_item.get('policy') or {}).get('key'),
            'request_key': radar_item.get('request_key'),
            'lifecycle_state': 'sla-near-due',
        })
    for capacity_row in capacity_rows or []:
        if int(capacity_row.get('overdue_request_count') or 0) <= 0 and int(capacity_row.get('pending_request_count') or 0) < 4:
            continue
        approver = capacity_row.get('approver') or {}
        items.append({
            'severity': 'error' if int(capacity_row.get('overdue_request_count') or 0) > 0 else 'warning',
            'title': f"Approver {(approver.get('full_name') or approver.get('username') or 'governance owner')} dang qua tai",
            'description': (
                f"Dang giu {int(capacity_row.get('pending_request_count') or 0)} pending request, "
                f"{int(capacity_row.get('overdue_request_count') or 0)} overdue va "
                f"{len(capacity_row.get('single_threaded_departments') or [])} department chua co delegate backup."
            ),
            'route': '/admin/access-exceptions',
            'policy_key': None,
            'request_key': None,
            'lifecycle_state': 'approver-capacity',
        })
    for availability_row in availability_rows or []:
        if not availability_row.get('is_currently_out_of_office'):
            continue
        if availability_row.get('coverage_status') == 'covered':
            continue
        approver = availability_row.get('approver') or {}
        items.append({
            'severity': 'error' if availability_row.get('coverage_status') == 'critical' else 'warning',
            'title': f"Approver {(approver.get('full_name') or approver.get('username') or 'governance owner')} dang OOO",
            'description': (
                f"Chua co backup ro rang cho {int(availability_row.get('impacted_request_count') or 0)} request bi anh huong."
                if int(availability_row.get('impacted_request_count') or 0) > 0
                else 'Nen bo tri backup hoac rotation truoc khi queue tang tai.'
            ),
            'route': '/admin/access-exceptions',
            'policy_key': None,
            'request_key': None,
            'lifecycle_state': 'availability-gap',
        })
    for continuity_row in continuity_rows or []:
        if continuity_row.get('status') != 'needs-manual':
            continue
        items.append({
            'severity': 'error',
            'title': f"Request {continuity_row.get('request_key')} can reroute thu cong",
            'description': (
                f"{continuity_row.get('stage_label') or 'Approval stage'} dang bi anh huong boi approver vang mat "
                'nhung he thong chua tim thay backup hop le.'
            ),
            'route': '/admin/access-exceptions',
            'policy_key': (continuity_row.get('policy') or {}).get('key'),
            'request_key': continuity_row.get('request_key'),
            'lifecycle_state': 'continuity-gap',
        })
    for analytics_row in continuity_analytics or []:
        if str(analytics_row.get('drill_status') or '') not in {'due', 'overdue'}:
            continue
        items.append({
            'severity': 'error' if analytics_row.get('drill_status') == 'overdue' else 'warning',
            'title': f"{analytics_row.get('department_label')} can fallback drill",
            'description': (
                f"Department dang co preparedness score {int(analytics_row.get('preparedness_score') or 0)} "
                f"va {int(analytics_row.get('manual_gap_requests') or 0)} request can manual continuity."
            ),
            'route': '/admin/access-exceptions',
            'policy_key': None,
            'request_key': None,
            'lifecycle_state': 'continuity-drill',
        })
    for drill_item in list((continuity_drill_preview or {}).get('items', []))[:3]:
        if str(drill_item.get('status') or '') != 'overdue':
            continue
        items.append({
            'severity': 'error',
            'title': f"{drill_item.get('department_label')} dang overdue drill",
            'description': str(drill_item.get('suggested_focus') or 'Nen chay continuity drill de xac thuc fallback va reroute path.'),
            'route': '/admin/access-exceptions',
            'policy_key': None,
            'request_key': None,
            'lifecycle_state': 'continuity-drill-overdue',
        })
    return items[:12]


def _build_access_exception_workspace_summary(policy_rows, request_rows, watchlist_items, coverage_summary=None, sla_radar=None, capacity_summary=None, availability_summary=None, continuity_summary=None, continuity_analytics_summary=None, continuity_drill_preview=None, remediation_summary=None):
    summary = {
        'total_policies': len(policy_rows),
        'active_policies': sum(1 for policy in policy_rows if policy['is_active']),
        'critical_policies': sum(1 for policy in policy_rows if policy['risk_level'] == 'critical'),
        'requests_pending': sum(1 for row in request_rows if row['lifecycle_state'] == 'pending'),
        'requests_active': sum(1 for row in request_rows if row['lifecycle_state'] in {'active', 'expiring'}),
        'expiring_requests': sum(1 for row in request_rows if row['lifecycle_state'] == 'expiring'),
        'expired_requests': sum(1 for row in request_rows if row['lifecycle_state'] == 'expired'),
        'requests_with_access': sum(1 for row in request_rows if row['access_still_present']),
        'high_risk_requests': sum(1 for row in request_rows if int(row.get('risk_score') or 0) >= 60),
        'critical_risk_requests': sum(1 for row in request_rows if int(row.get('risk_score') or 0) >= 80),
        'policy_debt_watchlist': sum(1 for policy in policy_rows if str(policy.get('debt_status') or '') in {'watch', 'critical'}),
        'policy_debt_critical': sum(1 for policy in policy_rows if str(policy.get('debt_status') or '') == 'critical'),
        'review_queue': len(watchlist_items),
    }
    coverage_payload = coverage_summary or {}
    sla_summary = (sla_radar or {}).get('summary', {}) if isinstance(sla_radar, dict) else {}
    capacity_payload = capacity_summary or {}
    availability_payload = availability_summary or {}
    continuity_payload = continuity_summary or {}
    continuity_analytics_payload = continuity_analytics_summary or {}
    continuity_drill_payload = (continuity_drill_preview or {}).get('summary', {}) if isinstance(continuity_drill_preview, dict) else {}
    remediation_payload = remediation_summary or {}
    summary.update({
        'routing_departments': int(coverage_payload.get('departments_total') or 0),
        'routing_coverage_gaps': int(coverage_payload.get('coverage_gaps') or 0),
        'sla_requests_near_due': int(sla_summary.get('near_due') or 0),
        'sla_requests_overdue': int(sla_summary.get('overdue') or 0),
        'sla_escalations_due': int(sla_summary.get('escalations_due') or 0),
        'overloaded_approvers': int(capacity_payload.get('overloaded_approvers') or 0),
        'backup_gap_departments': int(capacity_payload.get('single_threaded_departments') or 0),
        'out_of_office_approvers': int(availability_payload.get('out_of_office_approvers') or 0),
        'out_of_office_coverage_gaps': int(availability_payload.get('out_of_office_coverage_gaps') or 0),
        'continuity_impacted_requests': int(continuity_payload.get('impacted_requests') or 0),
        'continuity_manual_reroutes': int(continuity_payload.get('needs_manual') or 0),
        'continuity_departments_due': int(continuity_analytics_payload.get('departments_due') or 0),
        'continuity_departments_overdue': int(continuity_analytics_payload.get('departments_overdue') or 0),
        'continuity_drills_due': int(continuity_drill_payload.get('drills_due') or 0),
        'continuity_playbooks_prepared': int(continuity_drill_payload.get('playbooks_prepared') or 0),
        'guided_remediation_actions': int(remediation_payload.get('total_actions') or 0),
        'guided_remediation_critical': int(remediation_payload.get('critical_actions') or 0),
    })
    return summary


def _get_access_exception_scheduler_status():
    try:
        from django_q.models import Schedule
    except Exception:
        return {
            'available': False,
            'enabled': False,
            'name': ACCESS_EXCEPTION_AUTOMATION_SCHEDULER_NAME,
            'interval_minutes': 30,
            'next_run': None,
            'schedule_id': None,
            'lock_active': cache.get(ACCESS_EXCEPTION_AUTOMATION_LOCK_KEY) is not None,
        }

    schedule = Schedule.objects.filter(name=ACCESS_EXCEPTION_AUTOMATION_SCHEDULER_NAME).first()
    if schedule is None:
        return {
            'available': True,
            'enabled': False,
            'name': ACCESS_EXCEPTION_AUTOMATION_SCHEDULER_NAME,
            'interval_minutes': 30,
            'next_run': None,
            'schedule_id': None,
            'lock_active': cache.get(ACCESS_EXCEPTION_AUTOMATION_LOCK_KEY) is not None,
        }
    return {
        'available': True,
        'enabled': bool(schedule.repeats != 0),
        'name': schedule.name,
        'interval_minutes': int(schedule.minutes or 30),
        'next_run': schedule.next_run,
        'schedule_id': schedule.id,
        'lock_active': cache.get(ACCESS_EXCEPTION_AUTOMATION_LOCK_KEY) is not None,
    }


def _build_access_exception_automation_preview(request_rows_storage, request_rows, automation_policy, now=None, scope='all'):
    safe_scope = str(scope or 'all')
    policy = _serialize_access_exception_automation_policy_storage(automation_policy)
    current_time = now or django_timezone.now()
    child_request_map = defaultdict(list)
    request_map = {str(item.get('key') or ''): item for item in request_rows}
    for item in request_rows:
        parent_request_key = str(item.get('parent_request_key') or '')
        if parent_request_key:
            child_request_map[parent_request_key].append(str(item.get('key') or ''))

    reminder_candidates = []
    expired_candidates = []
    renewal_candidates = []
    sla_radar = _build_access_exception_sla_radar(request_rows=request_rows, automation_policy=policy, now=current_time)
    sla_warning_candidates = []
    sla_escalation_candidates = []
    continuity_drill_preview = {'generated_at': current_time, 'summary': {'drills_due': 0, 'drills_overdue': 0, 'playbooks_prepared': 0}, 'items': []}
    reminder_offsets = list(policy.get('reminder_offsets_days', []))
    renewal_window_days = int(policy.get('renewal_window_days') or 5)

    for request_row in request_rows:
        request_key = str(request_row.get('key') or '')
        planned_expires_at = _parse_access_exception_datetime(request_row.get('planned_expires_at')) or _get_access_exception_planned_expires_at(request_row)
        if planned_expires_at is None:
            continue

        seconds_to_expiry = (planned_expires_at - current_time).total_seconds()
        days_to_expiry = int(math.ceil(seconds_to_expiry / 86400)) if seconds_to_expiry >= 0 else -int(math.ceil(abs(seconds_to_expiry) / 86400))
        open_child_requests = [
            request_map[child_key]
            for child_key in child_request_map.get(request_key, [])
            if child_key in request_map and request_map[child_key].get('lifecycle_state') in {'pending', 'active', 'expiring'}
        ]
        has_open_renewal = bool(open_child_requests)
        common_payload = {
            'request_key': request_key,
            'request_kind': str(request_row.get('request_kind') or 'grant'),
            'target_user': request_row.get('target_user') or {},
            'policy': request_row.get('policy') or {},
            'lifecycle_state': str(request_row.get('lifecycle_state') or ''),
            'status_label': str(request_row.get('status_label') or ''),
            'planned_expires_at': planned_expires_at,
            'days_to_expiry': days_to_expiry,
            'has_open_renewal': has_open_renewal,
            'renewed_by_request_key': str(request_row.get('renewed_by_request_key') or ''),
            'child_request_keys': [str(item.get('key') or '') for item in open_child_requests],
        }

        if safe_scope in {'all', 'reminders'} and str(request_row.get('status') or '') == 'approved' and request_row.get('lifecycle_state') in {'active', 'expiring'}:
            sent_offsets = {int(value) for value in request_row.get('reminder_offsets_sent', []) if value is not None}
            due_offsets = [
                offset
                for offset in reminder_offsets
                if seconds_to_expiry >= 0 and seconds_to_expiry <= offset * 86400 and offset not in sent_offsets
            ]
            if due_offsets:
                reminder_candidates.append({
                    **common_payload,
                    'severity': 'warning' if days_to_expiry <= 1 else 'info',
                    'reminder_offset_days': min(due_offsets),
                })

        if str(request_row.get('status') or '') == 'approved' and request_row.get('can_renew') and not has_open_renewal:
            if request_row.get('lifecycle_state') == 'expired' or (seconds_to_expiry >= 0 and days_to_expiry <= renewal_window_days):
                renewal_candidates.append({
                    **common_payload,
                    'severity': 'warning' if request_row.get('lifecycle_state') == 'expired' else 'info',
                })

        if safe_scope in {'all', 'expiry'} and request_row.get('lifecycle_state') == 'expired' and request_row.get('access_still_present'):
            expired_candidates.append({
                **common_payload,
                'severity': 'error',
                'access_still_present': True,
            })

    reminder_candidates.sort(key=lambda item: (_parse_access_exception_datetime(item.get('planned_expires_at')) or current_time, item.get('request_key') or ''))
    expired_candidates.sort(key=lambda item: (_parse_access_exception_datetime(item.get('planned_expires_at')) or current_time, item.get('request_key') or ''))
    renewal_candidates.sort(key=lambda item: (_parse_access_exception_datetime(item.get('planned_expires_at')) or current_time, item.get('request_key') or ''))
    if safe_scope in {'all', 'approvals'}:
        sla_warning_candidates = [item for item in sla_radar['items'] if item.get('warning_due')][:12]
        sla_escalation_candidates = [item for item in sla_radar['items'] if item.get('escalation_due')][:12]
    if safe_scope in {'all', 'continuity'}:
        routing_rule_rows = _build_access_exception_routing_rule_rows()
        availability_rows = _build_access_exception_approver_availability_rows(
            availability_rows=_load_access_exception_approver_availability(),
            routing_rules=routing_rule_rows,
            request_rows=request_rows,
            approver_candidates=_build_access_exception_approver_candidate_rows(limit=40),
        )
        policy_rows = _build_access_exception_policy_rows(_load_access_exception_policies(), request_rows=request_rows)
        continuity_runbook = _build_access_exception_continuity_runbook_rows(
            request_rows=request_rows,
            policy_rows=policy_rows,
        )
        continuity_analytics = _build_access_exception_department_continuity_rows(
            coverage_rows=_build_access_exception_routing_coverage_rows(
                policy_rows=policy_rows,
                request_rows=request_rows,
                routing_rules=routing_rule_rows,
                sla_radar=sla_radar,
            ),
            continuity_rows=continuity_runbook,
            availability_rows=availability_rows,
            drill_state=_load_access_exception_continuity_drill_state(),
            automation_policy=policy,
        )
        continuity_drill_preview = _build_access_exception_continuity_drill_preview(
            analytics_rows=continuity_analytics,
            automation_policy=policy,
            now=current_time,
        )

    return {
        'generated_at': current_time,
        'policy': policy,
        'scope': safe_scope,
        'summary': {
            'monitored_requests': sum(1 for row in request_rows if str(row.get('status') or '') == 'approved'),
            'reminders_due': len(reminder_candidates),
            'renewal_candidates': len(renewal_candidates),
            'expired_with_access': len(expired_candidates),
            'auto_revokes_due': len(expired_candidates) if policy.get('auto_revoke_expired', True) and safe_scope in {'all', 'expiry'} else 0,
            'sla_warnings_due': len(sla_warning_candidates),
            'sla_escalations_due': len(sla_escalation_candidates),
            'continuity_drills_due': int((continuity_drill_preview.get('summary') or {}).get('drills_due') or 0),
            'playbooks_prepared': int((continuity_drill_preview.get('summary') or {}).get('playbooks_prepared') or 0),
        },
        'reminder_candidates': reminder_candidates[:12],
        'expired_candidates': expired_candidates[:12],
        'renewal_candidates': renewal_candidates[:12],
        'sla_warning_candidates': sla_warning_candidates,
        'sla_escalation_candidates': sla_escalation_candidates,
        'continuity_drill_candidates': list(continuity_drill_preview.get('items') or []),
    }


def _run_access_exception_automation(automation_policy=None, actor=None, request=None, dry_run=False, scope='all', run_mode='manual'):
    policy = _serialize_access_exception_automation_policy_storage(automation_policy or _load_access_exception_automation_policy())
    now = django_timezone.now()
    raw_policies = _load_access_exception_policies()
    request_rows_storage = _load_access_exception_requests()
    policy_rows = _build_access_exception_policy_rows(raw_policies)
    request_rows = _build_access_exception_request_rows(request_rows_storage, policy_rows)
    preview = _build_access_exception_automation_preview(
        request_rows_storage=request_rows_storage,
        request_rows=request_rows,
        automation_policy=policy,
        now=now,
        scope=scope,
    )
    result = {
        'generated_at': preview['generated_at'],
        'policy': policy,
        'scope': preview['scope'],
        'summary': dict(preview['summary']),
        'reminder_candidates': list(preview['reminder_candidates']),
        'expired_candidates': list(preview['expired_candidates']),
        'renewal_candidates': list(preview['renewal_candidates']),
        'sla_warning_candidates': list(preview.get('sla_warning_candidates', [])),
        'sla_escalation_candidates': list(preview.get('sla_escalation_candidates', [])),
        'processed': {
            'run_mode': str(run_mode or 'manual'),
            'dry_run': bool(dry_run),
            'reminders_sent': 0,
            'notifications_created': 0,
            'requests_auto_revoked': 0,
            'sla_warnings_sent': 0,
            'sla_escalations_sent': 0,
            'continuity_drills_run': 0,
            'playbooks_prepared': 0,
            'revoked_request_keys': [],
            'reminded_request_keys': [],
            'sla_warning_request_keys': [],
            'sla_escalation_request_keys': [],
            'continuity_drill_department_keys': [],
        },
    }
    if dry_run:
        return result

    request_index_map = {
        str(item.get('key') or ''): index
        for index, item in enumerate(request_rows_storage)
        if str(item.get('key') or '').strip()
    }
    routing_rule_rows = _build_access_exception_routing_rule_rows()
    routing_rule_map = {
        str(item.get('department_key') or ''): item
        for item in routing_rule_rows
    }
    candidate_user_ids = sorted({
        int(item.get('user_id') or 0)
        for item in request_rows_storage
        if item.get('user_id')
    } | {
        int(item.get('requested_by_id') or 0)
        for item in request_rows_storage
        if item.get('requested_by_id')
    } | {
        int(item.get('approver_user_id') or 0)
        for item in request_rows_storage
        if item.get('approver_user_id')
    } | {
        int(item.get('active_approver_user_id') or 0)
        for item in request_rows_storage
        if item.get('active_approver_user_id')
    } | {
        int(item.get('stage_two_approver_user_id') or 0)
        for item in request_rows_storage
        if item.get('stage_two_approver_user_id')
    } | {
        int(user_id or 0)
        for rule in routing_rule_rows
        for user_id in _collect_access_exception_routing_rule_user_ids(rule)
        if user_id
    })
    user_map = {
        user.id: user
        for user in User.objects.filter(id__in=candidate_user_ids)
    }

    storage_dirty = False
    if scope in {'all', 'reminders'}:
        for candidate in preview['reminder_candidates']:
            request_key = str(candidate.get('request_key') or '')
            request_index = request_index_map.get(request_key)
            if request_index is None:
                continue
            request_row = _serialize_access_exception_request_storage(request_rows_storage[request_index])
            if str(request_row.get('status') or '') != 'approved':
                continue

            reminder_offset_days = int(candidate.get('reminder_offset_days') or 0)
            sent_offsets = set(int(value) for value in request_row.get('reminder_offsets_sent', []) if value is not None)
            if reminder_offset_days in sent_offsets:
                continue

            target_user = user_map.get(int(request_row.get('user_id') or 0))
            requester_user = user_map.get(int(request_row.get('requested_by_id') or 0))
            approver_user = user_map.get(int(request_row.get('approver_user_id') or 0)) if request_row.get('approver_user_id') else None
            recipients = _build_access_exception_notification_recipients(
                request_row=request_row,
                target_user=target_user,
                requester_user=requester_user,
                approver_user=approver_user,
                automation_policy=policy,
            )
            planned_expires_at = _parse_access_exception_datetime(candidate.get('planned_expires_at'))
            expiry_label = django_timezone.localtime(planned_expires_at).strftime('%d/%m/%Y %H:%M') if planned_expires_at else 'som'
            for recipient in recipients:
                _create_access_exception_notification(
                    recipient=recipient,
                    actor=actor,
                    request_key=request_key,
                    notification_type='due_date',
                    title=f"Access exception {request_key} sap het han",
                    message=(
                        f"Policy {(candidate.get('policy') or {}).get('name') or request_row.get('policy_name') or request_row.get('policy_key')} "
                        f"cho {(candidate.get('target_user') or {}).get('full_name') or (candidate.get('target_user') or {}).get('username') or request_row.get('key')} "
                        f"se het han vao {expiry_label}. Nen review renewal hoac thu hoi access."
                    ),
                )
                result['processed']['notifications_created'] += 1

            request_row['reminder_offsets_sent'] = sorted(sent_offsets | {reminder_offset_days}, reverse=True)
            request_rows_storage[request_index] = request_row
            storage_dirty = True
            result['processed']['reminders_sent'] += 1
            result['processed']['reminded_request_keys'].append(request_key)

    if scope in {'all', 'approvals'}:
        for candidate in preview.get('sla_warning_candidates', []):
            request_key = str(candidate.get('request_key') or '')
            request_index = request_index_map.get(request_key)
            if request_index is None:
                continue
            request_row = _serialize_access_exception_request_storage(request_rows_storage[request_index])
            if str(request_row.get('status') or '') != 'pending':
                continue

            current_stage = int(request_row.get('active_stage_level') or 1)
            if int(request_row.get('sla_warning_stage_level') or 0) == current_stage:
                continue

            requester_user = user_map.get(int(request_row.get('requested_by_id') or 0))
            active_approver_user = user_map.get(int(request_row.get('active_approver_user_id') or 0)) if request_row.get('active_approver_user_id') else None
            routing_rule = routing_rule_map.get(str(request_row.get('routing_department_key') or ''))
            recipients = _build_access_exception_sla_notification_recipients(
                request_row=request_row,
                requester_user=requester_user,
                active_approver_user=active_approver_user,
                routing_rule=routing_rule,
                automation_policy=policy,
                user_map=user_map,
            )
            due_label = django_timezone.localtime(_parse_access_exception_datetime(candidate.get('approval_stage_due_at'))).strftime('%d/%m/%Y %H:%M') if _parse_access_exception_datetime(candidate.get('approval_stage_due_at')) else 'khung SLA'
            for recipient in recipients:
                _create_access_exception_notification(
                    recipient=recipient,
                    actor=actor,
                    request_key=request_key,
                    notification_type='due_date',
                    title=f"Access exception {request_key} sap breach SLA",
                    message=(
                        f"{(candidate.get('stage_label') or 'Approval stage')} cua policy {(candidate.get('policy') or {}).get('name') or request_row.get('policy_name') or request_row.get('policy_key')} "
                        f"cho {(candidate.get('target_user') or {}).get('full_name') or (candidate.get('target_user') or {}).get('username') or request_key} can duoc xu ly truoc {due_label}."
                    ),
                )
                result['processed']['notifications_created'] += 1

            request_row['sla_warning_stage_level'] = current_stage
            request_row['sla_warning_sent_at'] = now
            request_rows_storage[request_index] = request_row
            storage_dirty = True
            result['processed']['sla_warnings_sent'] += 1
            result['processed']['sla_warning_request_keys'].append(request_key)

        for candidate in preview.get('sla_escalation_candidates', []):
            request_key = str(candidate.get('request_key') or '')
            request_index = request_index_map.get(request_key)
            if request_index is None:
                continue
            request_row = _serialize_access_exception_request_storage(request_rows_storage[request_index])
            if str(request_row.get('status') or '') != 'pending':
                continue

            current_stage = int(request_row.get('active_stage_level') or 1)
            if int(request_row.get('sla_escalation_stage_level') or 0) == current_stage:
                continue

            requester_user = user_map.get(int(request_row.get('requested_by_id') or 0))
            active_approver_user = user_map.get(int(request_row.get('active_approver_user_id') or 0)) if request_row.get('active_approver_user_id') else None
            routing_rule = routing_rule_map.get(str(request_row.get('routing_department_key') or ''))
            recipients = _build_access_exception_sla_notification_recipients(
                request_row=request_row,
                requester_user=requester_user,
                active_approver_user=active_approver_user,
                routing_rule=routing_rule,
                automation_policy=policy,
                user_map=user_map,
            )
            for recipient in recipients:
                _create_access_exception_notification(
                    recipient=recipient,
                    actor=actor,
                    request_key=request_key,
                    notification_type='system',
                    title=f"Access exception {request_key} da tre SLA",
                    message=(
                        f"{(candidate.get('stage_label') or 'Approval stage')} cua {(candidate.get('policy') or {}).get('name') or request_row.get('policy_name') or request_row.get('policy_key')} "
                        f"cho {(candidate.get('target_user') or {}).get('full_name') or (candidate.get('target_user') or {}).get('username') or request_key} "
                        f"da tre {int(math.ceil(float(candidate.get('hours_overdue') or 0)))} gio. Can escalate de dong queue governance."
                    ),
                )
                result['processed']['notifications_created'] += 1

            request_row['sla_escalation_stage_level'] = current_stage
            request_row['sla_escalation_sent_at'] = now
            request_rows_storage[request_index] = request_row
            storage_dirty = True
            result['processed']['sla_escalations_sent'] += 1
            result['processed']['sla_escalation_request_keys'].append(request_key)

    if scope in {'all', 'continuity'} and policy.get('continuity_drill_enabled', True):
        continuity_drill_state = _load_access_exception_continuity_drill_state()
        for candidate in preview.get('continuity_drill_candidates', []):
            department_key = str(candidate.get('department_key') or '')
            if not department_key:
                continue
            continuity_drill_state.setdefault('departments', {})
            continuity_drill_state['departments'][department_key] = {
                'department_key': department_key,
                'department_label': str(candidate.get('department_label') or department_key.title()),
                'last_drill_at': now,
                'last_status': str(candidate.get('status') or 'due'),
                'impacted_requests': int(candidate.get('impacted_request_count') or 0),
                'ready_to_reroute': int(candidate.get('ready_to_reroute_count') or 0),
                'needs_manual': int(candidate.get('manual_gap_requests') or 0),
                'tested_approver_ids': [],
                'notes': str(candidate.get('suggested_focus') or ''),
            }
            continuity_drill_state['last_run_at'] = now
            continuity_drill_state['last_run_mode'] = str(run_mode or 'manual')
            result['processed']['continuity_drills_run'] += 1
            result['processed']['continuity_drill_department_keys'].append(department_key)
            if candidate.get('severity') not in {'warning', 'error'}:
                continue
            if not policy.get('notify_directory_owners_for_continuity', True):
                continue
            routing_rule = routing_rule_map.get(department_key)
            if not routing_rule:
                continue
            recipient_ids = _collect_access_exception_routing_rule_user_ids(routing_rule)
            for recipient_id in recipient_ids:
                recipient = user_map.get(int(recipient_id or 0))
                if recipient is None:
                    continue
                _create_access_exception_notification(
                    recipient=recipient,
                    actor=actor,
                    request_key=department_key,
                    notification_type='system',
                    title=f"Continuity drill due cho {candidate.get('department_label')}",
                    message=(
                        f"Department {candidate.get('department_label')} dang o trang thai {candidate.get('status_label') or candidate.get('status')}. "
                        f"{candidate.get('suggested_focus') or 'Can review fallback coverage va reroute path.'}"
                    ),
                )
                result['processed']['notifications_created'] += 1
        _save_access_exception_continuity_drill_state(continuity_drill_state)
        result['processed']['playbooks_prepared'] = int(preview.get('summary', {}).get('playbooks_prepared') or 0)

    if storage_dirty:
        request_rows_storage = _save_access_exception_requests(request_rows_storage)
        request_index_map = {
            str(item.get('key') or ''): index
            for index, item in enumerate(request_rows_storage)
            if str(item.get('key') or '').strip()
        }

    if scope in {'all', 'expiry'} and policy.get('auto_revoke_expired', True):
        for candidate in preview['expired_candidates']:
            request_key = str(candidate.get('request_key') or '')
            request_index = request_index_map.get(request_key)
            if request_index is None:
                continue
            request_row = _serialize_access_exception_request_storage(request_rows_storage[request_index])
            if str(request_row.get('status') or '') != 'approved':
                continue

            target_user = User.objects.prefetch_related('roles', 'teams').filter(id=request_row['user_id']).first()
            if target_user is None:
                continue

            revoke_result = _revoke_access_exception_request_row(
                request_row=request_row,
                request_rows_storage=request_rows_storage,
                request_index=request_index,
                target_user=target_user,
                actor=actor,
                request=request,
                note='Auto-revoked after expiry by automation.',
                revoked_at=now,
            )
            request_rows_storage = revoke_result['saved_request_rows']
            request_index_map = {
                str(item.get('key') or ''): index
                for index, item in enumerate(request_rows_storage)
                if str(item.get('key') or '').strip()
            }
            result['processed']['requests_auto_revoked'] += 1
            result['processed']['revoked_request_keys'].append(request_key)

            target_user_refreshed = revoke_result['target_user']
            requester_user = user_map.get(int(request_row.get('requested_by_id') or 0))
            approver_user = user_map.get(int(request_row.get('approver_user_id') or 0)) if request_row.get('approver_user_id') else None
            recipients = _build_access_exception_notification_recipients(
                request_row=request_row,
                target_user=target_user_refreshed,
                requester_user=requester_user,
                approver_user=approver_user,
                automation_policy=policy,
            )
            for recipient in recipients:
                _create_access_exception_notification(
                    recipient=recipient,
                    actor=actor,
                    request_key=request_key,
                    notification_type='system',
                    title=f"Access exception {request_key} da bi thu hoi",
                    message=(
                        f"Automation da thu hoi exception cho {(candidate.get('target_user') or {}).get('full_name') or (candidate.get('target_user') or {}).get('username') or target_user_refreshed.username} "
                        f"sau khi policy {(candidate.get('policy') or {}).get('name') or request_row.get('policy_name') or request_row.get('policy_key')} het han."
                    ),
                )
                result['processed']['notifications_created'] += 1

    return result


def run_access_exception_automation_job(lock_timeout_sec: int = 240) -> dict:
    policy = _load_access_exception_automation_policy()
    if not policy.get('enabled', True):
        result = {
            'status': 'SKIPPED_DISABLED',
            'message': 'Access exception automation is disabled.',
            'generated_at': django_timezone.now().isoformat(),
            'policy': policy,
            'processed': {
                'run_mode': 'scheduled',
                'dry_run': False,
                'reminders_sent': 0,
                'notifications_created': 0,
                'requests_auto_revoked': 0,
                'sla_warnings_sent': 0,
                'sla_escalations_sent': 0,
                'continuity_drills_run': 0,
                'playbooks_prepared': 0,
                'revoked_request_keys': [],
                'reminded_request_keys': [],
                'sla_warning_request_keys': [],
                'sla_escalation_request_keys': [],
                'continuity_drill_department_keys': [],
            },
            'summary': {
                'monitored_requests': 0,
                'reminders_due': 0,
                'renewal_candidates': 0,
                'expired_with_access': 0,
                'auto_revokes_due': 0,
                'sla_warnings_due': 0,
                'sla_escalations_due': 0,
                'continuity_drills_due': 0,
                'playbooks_prepared': 0,
            },
        }
        AuditLog.objects.create(
            user=None,
            action='UPDATE',
            entity_type='UserAccessExceptionAutomation',
            entity_id=0,
            entity_id_str='global',
            entity_code='ACCESS_EXCEPTION_AUTOMATION_JOB',
            old_values={},
            new_values=result,
            changed_fields=['status'],
        )
        return result

    if cache.get(ACCESS_EXCEPTION_AUTOMATION_LOCK_KEY) is not None:
        result = {
            'status': 'SKIPPED_LOCKED',
            'message': 'Access exception automation job is already running.',
            'generated_at': django_timezone.now().isoformat(),
            'policy': policy,
            'processed': {
                'run_mode': 'scheduled',
                'dry_run': False,
                'reminders_sent': 0,
                'notifications_created': 0,
                'requests_auto_revoked': 0,
                'sla_warnings_sent': 0,
                'sla_escalations_sent': 0,
                'continuity_drills_run': 0,
                'playbooks_prepared': 0,
                'revoked_request_keys': [],
                'reminded_request_keys': [],
                'sla_warning_request_keys': [],
                'sla_escalation_request_keys': [],
                'continuity_drill_department_keys': [],
            },
            'summary': {
                'monitored_requests': 0,
                'reminders_due': 0,
                'renewal_candidates': 0,
                'expired_with_access': 0,
                'auto_revokes_due': 0,
                'sla_warnings_due': 0,
                'sla_escalations_due': 0,
                'continuity_drills_due': 0,
                'playbooks_prepared': 0,
            },
        }
        AuditLog.objects.create(
            user=None,
            action='UPDATE',
            entity_type='UserAccessExceptionAutomation',
            entity_id=0,
            entity_id_str='global',
            entity_code='ACCESS_EXCEPTION_AUTOMATION_JOB',
            old_values={},
            new_values=result,
            changed_fields=['status'],
        )
        return result

    started_at = time.perf_counter()
    cache.set(ACCESS_EXCEPTION_AUTOMATION_LOCK_KEY, True, timeout=max(60, int(lock_timeout_sec or 240)))
    try:
        run_result = _run_access_exception_automation(
            automation_policy=policy,
            actor=None,
            request=None,
            dry_run=False,
            scope='all',
            run_mode='scheduled',
        )
        duration_ms = int((time.perf_counter() - started_at) * 1000)
        payload = {
            **run_result,
            'status': 'SUCCESS',
            'duration_ms': duration_ms,
        }
        AuditLog.objects.create(
            user=None,
            action='UPDATE',
            entity_type='UserAccessExceptionAutomation',
            entity_id=0,
            entity_id_str='global',
            entity_code='ACCESS_EXCEPTION_AUTOMATION_JOB',
            old_values={},
            new_values=payload,
            changed_fields=['status', 'duration_ms'],
        )
        return payload
    except Exception as exc:
        duration_ms = int((time.perf_counter() - started_at) * 1000)
        payload = {
            'status': 'FAILED',
            'message': str(exc)[:500],
            'generated_at': django_timezone.now().isoformat(),
            'policy': policy,
            'duration_ms': duration_ms,
        }
        AuditLog.objects.create(
            user=None,
            action='UPDATE',
            entity_type='UserAccessExceptionAutomation',
            entity_id=0,
            entity_id_str='global',
            entity_code='ACCESS_EXCEPTION_AUTOMATION_JOB',
            old_values={},
            new_values=payload,
            changed_fields=['status', 'message', 'duration_ms'],
        )
        raise
    finally:
        cache.delete(ACCESS_EXCEPTION_AUTOMATION_LOCK_KEY)


def _build_access_exception_activity_items(queryset, limit=20):
    safe_limit = max(1, min(int(limit or 20), 60))
    logs = list(queryset.order_by('-created_at', '-id')[:safe_limit])
    items = []
    for log in logs:
        if str(log.entity_type or '') == 'UserAccessExceptionAutomation':
            payload = log.new_values or {}
            entity_code = str(log.entity_code or '')
            summary_payload = payload.get('summary', {}) if isinstance(payload, dict) else {}
            if entity_code == 'ACCESS_EXCEPTION_AUTOMATION_POLICY':
                reminder_offsets = ', '.join(str(item) for item in (payload.get('reminder_offsets_days') or [])[:3]) or '7, 3, 1'
                summary = (
                    f"Cập nhật chính sách tự động hóa | nhắc {reminder_offsets} ngày"
                    f" | cửa sổ gia hạn {int(payload.get('renewal_window_days', 0) or 0)} ngày"
                )
                if bool(payload.get('continuity_drill_enabled')):
                    summary += (
                        f" | continuity drill mỗi {int(payload.get('continuity_drill_interval_days', 0) or 0)} ngày"
                    )
                items.append({
                    'id': log.id,
                    'timestamp': log.created_at,
                    'kind': 'automation',
                    'action': 'SAVE_AUTOMATION_POLICY',
                    'summary': summary,
                    'route': '/admin/access-exceptions',
                    'changed_fields': log.changed_fields or [],
                    'entity_code': log.entity_code,
                    'actor': {
                        'id': log.user_id,
                        'username': log.user.username if log.user else '',
                        'full_name': log.user.get_full_name() if log.user else '',
                    },
                    'old_values': log.old_values or {},
                    'new_values': payload,
                })
                continue
            if entity_code == 'ACCESS_EXCEPTION_AUTOMATION_SCHEDULER':
                enabled = bool(payload.get('enabled'))
                interval_minutes = int(payload.get('interval_minutes', 0) or 0)
                summary = (
                    f"{'Bật' if enabled else 'Tạm dừng'} bộ lập lịch tự động hóa"
                    f" mỗi {interval_minutes} phút"
                )
                if payload.get('next_run'):
                    summary += f" | lần chạy tới {payload.get('next_run')}"
                items.append({
                    'id': log.id,
                    'timestamp': log.created_at,
                    'kind': 'automation',
                    'action': 'SAVE_SCHEDULER_STATUS',
                    'summary': summary,
                    'route': '/admin/access-exceptions',
                    'changed_fields': log.changed_fields or [],
                    'entity_code': log.entity_code,
                    'actor': {
                        'id': log.user_id,
                        'username': log.user.username if log.user else '',
                        'full_name': log.user.get_full_name() if log.user else '',
                    },
                    'old_values': log.old_values or {},
                    'new_values': payload,
                })
                continue
            processed_payload = payload.get('processed', {}) if isinstance(payload, dict) else {}
            reminder_count = int(processed_payload.get('reminders_sent', 0) or 0)
            revoke_count = int(processed_payload.get('requests_auto_revoked', 0) or 0)
            sla_warning_count = int(processed_payload.get('sla_warnings_sent', 0) or 0)
            sla_escalation_count = int(processed_payload.get('sla_escalations_sent', 0) or 0)
            continuity_drill_count = int(processed_payload.get('continuity_drills_run', 0) or 0)
            summary = (
                f"Automation {str(processed_payload.get('run_mode') or 'manual')} "
                f"nhac {reminder_count} va revoke {revoke_count} request"
            )
            if sla_warning_count or sla_escalation_count:
                summary += f", SLA ping {sla_warning_count} va escalate {sla_escalation_count}"
            if continuity_drill_count:
                summary += f", continuity drill {continuity_drill_count} department"
            items.append({
                'id': log.id,
                'timestamp': log.created_at,
                'kind': 'automation',
                'action': 'RUN_AUTOMATION',
                'summary': summary,
                'route': '/admin/access-exceptions',
                'changed_fields': log.changed_fields or [],
                'entity_code': log.entity_code,
                'actor': {
                    'id': log.user_id,
                    'username': log.user.username if log.user else '',
                    'full_name': log.user.get_full_name() if log.user else '',
                },
                'old_values': log.old_values or {},
                'new_values': {
                    **payload,
                    'summary': summary_payload,
                },
            })
            continue

        if str(log.entity_type or '') == 'UserAccessExceptionSimulation':
            payload = log.new_values or {}
            summary_payload = payload.get('summary', {}) if isinstance(payload, dict) else {}
            items.append({
                'id': log.id,
                'timestamp': log.created_at,
                'kind': 'simulation',
                'action': log.action,
                'summary': (
                    f"Absence simulation anh huong {int(summary_payload.get('impacted_requests') or 0)} request "
                    f"va tao {int(summary_payload.get('playbooks_prepared') or 0)} playbook"
                ),
                'route': '/admin/access-exceptions',
                'changed_fields': log.changed_fields or [],
                'entity_code': log.entity_code,
                'actor': {
                    'id': log.user_id,
                    'username': log.user.username if log.user else '',
                    'full_name': log.user.get_full_name() if log.user else '',
                },
                'old_values': log.old_values or {},
                'new_values': payload,
            })
            continue

        if str(log.entity_type or '') == 'UserAccessExceptionRemediation':
            payload = log.new_values or {}
            items.append({
                'id': log.id,
                'timestamp': log.created_at,
                'kind': 'remediation',
                'action': log.action,
                'summary': str(payload.get('summary') or f"Applied remediation {payload.get('action_type') or log.entity_code or log.id}"),
                'route': '/admin/access-exceptions',
                'changed_fields': log.changed_fields or [],
                'entity_code': log.entity_code,
                'actor': {
                    'id': log.user_id,
                    'username': log.user.username if log.user else '',
                    'full_name': log.user.get_full_name() if log.user else '',
                },
                'old_values': log.old_values or {},
                'new_values': payload,
            })
            continue

        if str(log.entity_type or '') == 'UserAccessExceptionRoutingRule':
            department_label = (
                ((log.new_values or {}).get('department_label') if isinstance(log.new_values, dict) else None)
                or ((log.old_values or {}).get('department_label') if isinstance(log.old_values, dict) else None)
                or str(log.entity_code or 'routing-rule')
            )
            action_label = {
                'CREATE': 'Tao',
                'UPDATE': 'Cap nhat',
            }.get(log.action, log.action.title())
            items.append({
                'id': log.id,
                'timestamp': log.created_at,
                'kind': 'routing-rule',
                'action': log.action,
                'summary': f'{action_label} danh bạ định tuyến cho {department_label}',
                'route': '/admin/access-exceptions',
                'changed_fields': log.changed_fields or [],
                'entity_code': log.entity_code,
                'actor': {
                    'id': log.user_id,
                    'username': log.user.username if log.user else '',
                    'full_name': log.user.get_full_name() if log.user else '',
                },
                'old_values': log.old_values or {},
                'new_values': log.new_values or {},
            })
            continue

        if str(log.entity_type or '') == 'UserAccessExceptionApproverAvailability':
            new_approver = (
                (log.new_values or {}).get('approver')
                if isinstance(log.new_values, dict)
                else None
            )
            old_approver = (
                (log.old_values or {}).get('approver')
                if isinstance(log.old_values, dict)
                else None
            )
            approver_label = (
                (new_approver.get('full_name') if isinstance(new_approver, dict) else None)
                or (old_approver.get('full_name') if isinstance(old_approver, dict) else None)
                or str(log.entity_code or 'approver')
            )
            action_label = {
                'CREATE': 'Tao',
                'UPDATE': 'Cap nhat',
            }.get(log.action, log.action.title())
            items.append({
                'id': log.id,
                'timestamp': log.created_at,
                'kind': 'availability',
                'action': log.action,
                'summary': f'{action_label} độ phủ khi vắng mặt cho {approver_label}',
                'route': '/admin/access-exceptions',
                'changed_fields': log.changed_fields or [],
                'entity_code': log.entity_code,
                'actor': {
                    'id': log.user_id,
                    'username': log.user.username if log.user else '',
                    'full_name': log.user.get_full_name() if log.user else '',
                },
                'old_values': log.old_values or {},
                'new_values': log.new_values or {},
            })
            continue

        if str(log.entity_type or '') == 'UserAccessExceptionPolicy':
            policy_name = (
                ((log.new_values or {}).get('name') if isinstance(log.new_values, dict) else None)
                or ((log.old_values or {}).get('name') if isinstance(log.old_values, dict) else None)
                or str(log.entity_code or 'policy')
            )
            action_label = {
                'CREATE': 'Tao',
                'UPDATE': 'Cap nhat',
                'DELETE': 'Xoa',
            }.get(log.action, log.action.title())
            items.append({
                'id': log.id,
                'timestamp': log.created_at,
                'kind': 'policy',
                'action': log.action,
                'summary': f'{action_label} chính sách ngoại lệ truy cập {policy_name}',
                'route': '/admin/access-exceptions',
                'changed_fields': log.changed_fields or [],
                'entity_code': log.entity_code,
                'actor': {
                    'id': log.user_id,
                    'username': log.user.username if log.user else '',
                    'full_name': log.user.get_full_name() if log.user else '',
                },
                'old_values': log.old_values or {},
                'new_values': log.new_values or {},
            })
            continue

        new_values = log.new_values or {}
        old_values = log.old_values or {}
        policy_name = str(new_values.get('policy_name') or new_values.get('policy_key') or log.entity_code or 'request')
        action_label = {
            'CREATE': 'Gửi yêu cầu',
            'APPROVE': 'Phê duyệt yêu cầu',
            'REJECT': 'Từ chối yêu cầu',
            'REVOKE': 'Thu hồi ngoại lệ',
            'UPDATE': 'Cập nhật yêu cầu',
        }.get(log.action, log.action.title())
        summary = f'{action_label} cho {log.entity_code or "request"} theo {policy_name}'
        if log.action == 'UPDATE':
            previous_stage = int(old_values.get('active_stage_level') or 1) if isinstance(old_values, dict) else 1
            current_stage = int(new_values.get('active_stage_level') or previous_stage) if isinstance(new_values, dict) else previous_stage
            if current_stage > previous_stage and str(new_values.get('status') or '') == 'pending':
                summary = (
                    f'Chuyển yêu cầu {log.entity_code or "request"} sang chặng {current_stage} '
                    f'theo {policy_name}'
                )
            elif isinstance(old_values, dict) and isinstance(new_values, dict) and (
                old_values.get('active_approver_user_id') != new_values.get('active_approver_user_id')
                and str(new_values.get('status') or '') == 'pending'
            ):
                summary = f'Đổi tuyến người duyệt cho {log.entity_code or "request"} theo {policy_name}'
        items.append({
            'id': log.id,
            'timestamp': log.created_at,
            'kind': 'request',
            'action': log.action,
            'summary': summary,
            'route': '/admin/access-exceptions',
            'changed_fields': log.changed_fields or [],
            'entity_code': log.entity_code,
            'actor': {
                'id': log.user_id,
                'username': log.user.username if log.user else '',
                'full_name': log.user.get_full_name() if log.user else '',
            },
            'old_values': old_values,
            'new_values': new_values,
        })
    return items


def _normalize_username_candidate(value):
    normalized = unicodedata.normalize('NFKD', str(value or '').strip().lower())
    ascii_only = normalized.encode('ascii', 'ignore').decode('ascii')
    cleaned = re.sub(r'[^a-z0-9._-]+', '.', ascii_only)
    cleaned = re.sub(r'\.+', '.', cleaned).strip('.')
    return cleaned[:150]


def _username_exists(username):
    if not username:
        return False
    return User.objects.filter(username__iexact=str(username).strip()).exists()


def _email_exists(email):
    normalized = str(email or '').strip().lower()
    if not normalized:
        return False
    return User.objects.filter(email__iexact=normalized).exists()


def _build_username_suggestions(username, first_name='', last_name=''):
    base_candidates = []
    for candidate in [
        username,
        '.'.join(part for part in [first_name, last_name] if str(part or '').strip()),
        ''.join(part for part in [first_name, last_name] if str(part or '').strip()),
    ]:
        normalized = _normalize_username_candidate(candidate)
        if normalized and normalized not in base_candidates:
            base_candidates.append(normalized)

    suggestions = []
    for base in base_candidates or ['user']:
        if not _username_exists(base) and base not in suggestions:
            suggestions.append(base)
        suffix = 1
        while len(suggestions) < 6 and suffix <= 20:
            candidate = f'{base}{suffix:02d}'
            if candidate not in suggestions and not _username_exists(candidate):
                suggestions.append(candidate)
            suffix += 1
        if len(suggestions) >= 6:
            break
    return suggestions[:6]


def _generate_temporary_password(length=14):
    letters = string.ascii_letters
    digits = string.digits
    symbols = '!@#$%^&*'
    alphabet = letters + digits + symbols
    for _ in range(20):
        candidate = ''.join(secrets.choice(alphabet) for _ in range(max(12, int(length or 14))))
        if (
            any(ch in letters for ch in candidate)
            and any(ch in digits for ch in candidate)
            and any(ch in symbols for ch in candidate)
        ):
            return candidate
    return f'Carton!{secrets.randbelow(900000) + 100000}'


def _build_onboarding_task_context_from_profile(profile, roles_after, teams_after):
    username = str(profile.get('username') or '')
    full_name = str(profile.get('full_name') or '').strip() or username
    return {
        'entity_code': username,
        'entity_type': 'User',
        'trigger': 'MANUAL',
        'user_name': full_name,
        'full_name': full_name,
        'username': username,
        'email': str(profile.get('email') or ''),
        'role_names': ', '.join(item['name'] or item['code'] for item in roles_after),
        'team_names': ', '.join(item['name'] or item['code'] for item in teams_after),
    }


def _resolve_provisioning_access_ids(direct_ids, preset_ids):
    return sorted({int(value) for value in list(direct_ids or []) + list(preset_ids or [])})


def _build_security_task_preview(username, full_name, include_security_task=True):
    if not include_security_task:
        return None
    display_name = str(full_name or username or 'nguoi dung')
    return {
        'title': f'Doi mat khau tam thoi cho {display_name}',
        'description': 'Dang nhap lan dau, doi mat khau tam thoi va xac nhan thong tin bao mat co ban.',
        'priority': Task.PRIORITY_HIGH,
        'is_blocking': False,
        'assigned_to': str(username or ''),
        'due_date': (django_timezone.now().date() + timedelta(days=1)).isoformat(),
        'source_key': f'provision-security-{str(username or "").lower()}',
        'would_skip': False,
    }


def _preview_onboarding_tasks_for_profile(profile, preset, roles_after, teams_after):
    from .workflow_services import _interpolate

    template_ids = preset.get('workflow_template_ids', [])
    templates = list(
        WorkflowTaskTemplate.objects
        .filter(id__in=template_ids)
        .order_by('sort_order', 'id')
    )
    template_map = {template.id: template for template in templates}
    ordered_templates = [template_map[template_id] for template_id in template_ids if template_id in template_map]
    context = _build_onboarding_task_context_from_profile(profile, roles_after, teams_after)
    today = django_timezone.now().date()
    preview_items = []
    previous_source_key = None
    for template in ordered_templates:
        source_key = f"ob-preview-{preset['key']}-{template.id}-{profile.get('username')}"
        preview_items.append({
            'template_id': template.id,
            'template_title': str(template.title_template or ''),
            'entity_type': str(template.entity_type or ''),
            'trigger': str(template.trigger or ''),
            'title': _interpolate(template.title_template, context),
            'description': _interpolate(template.description_template, context),
            'priority': str(template.priority or ''),
            'is_blocking': bool(template.is_blocking),
            'assigned_to': str(profile.get('username') or '') if preset.get('task_owner_mode') == 'target_user' else None,
            'due_date': (today + timedelta(days=template.due_in_days)).isoformat() if template.due_in_days else None,
            'source_key': source_key,
            'depends_on_source_key': previous_source_key if template.depends_on_previous else None,
            'would_skip': False,
        })
        previous_source_key = source_key
    return preview_items


def _create_password_rotation_task(user, assigned_by):
    source_key = f'provision-security-user-{user.id}'
    existing_task = Task.objects.filter(source_key=source_key).first()
    if existing_task is not None:
        return None, {
            'id': existing_task.id,
            'title': existing_task.title,
            'source_key': existing_task.source_key,
        }

    task = Task.objects.create(
        entity_type='User',
        entity_id=user.id,
        entity_code=user.username,
        title=f'Doi mat khau tam thoi cho {user.get_full_name() or user.username}',
        description='Dang nhap lan dau va thay doi mat khau tam thoi de kich hoat tai khoan theo chuan an toan.',
        assigned_to=user,
        assigned_by=assigned_by,
        priority=Task.PRIORITY_HIGH,
        is_blocking=False,
        tags=['onboarding', 'security', 'password-rotation'],
        due_date=django_timezone.now().date() + timedelta(days=1),
        source_key=source_key,
    )
    return {
        'id': task.id,
        'title': task.title,
        'source_key': task.source_key,
    }, None


def _build_user_provisioning_workspace_summary(preset_rows, watchlist_items=None):
    recent_cutoff = django_timezone.now() - timedelta(days=30)
    watchlist_items = watchlist_items or []
    return {
        'active_presets': sum(1 for preset in preset_rows if preset['is_active']),
        'ready_presets': sum(1 for preset in preset_rows if preset['is_active'] and not preset['has_issues']),
        'active_roles': Role.objects.filter(is_active=True, deleted_at__isnull=True).count(),
        'active_teams': Team.objects.filter(is_active=True, deleted_at__isnull=True).count(),
        'users_created_30d': User.objects.filter(date_joined__gte=recent_cutoff).count(),
        'locked_users_30d': User.objects.filter(date_joined__gte=recent_cutoff, is_locked=True).count(),
        'provisioned_30d': AuditLog.objects.filter(entity_type='UserProvisioning', created_at__gte=recent_cutoff).count(),
        'onboarding_rollouts_30d': AuditLog.objects.filter(entity_type='UserOnboarding', created_at__gte=recent_cutoff).count(),
        'attention_accounts': sum(1 for item in watchlist_items if item['state'] != 'ready'),
        'security_followups': sum(1 for item in watchlist_items if item['state'] == 'security-followup'),
        'onboarding_in_flight': sum(1 for item in watchlist_items if item['state'] == 'onboarding-in-flight'),
        'access_gaps': sum(1 for item in watchlist_items if item['state'] == 'access-gap'),
    }


def _build_user_provisioning_activity_items(queryset, limit=20):
    safe_limit = max(1, min(int(limit or 20), 60))
    logs = list(queryset.order_by('-created_at', '-id')[:safe_limit])
    items = []
    for log in logs:
        new_values = log.new_values or {}
        credentials = new_values.get('credentials', {}) if isinstance(new_values, dict) else {}
        provisioning = new_values.get('provisioning', {}) if isinstance(new_values, dict) else {}
        items.append({
            'id': log.id,
            'timestamp': log.created_at,
            'summary': f"Cấp tài khoản {log.entity_code}",
            'route': '/admin/user-provisioning',
            'changed_fields': log.changed_fields or [],
            'entity_code': log.entity_code,
            'actor': {
                'id': log.user_id,
                'username': log.user.username if log.user else '',
                'full_name': log.user.get_full_name() if log.user else '',
            },
            'credentials': {
                'password_mode': credentials.get('password_mode') or 'generated',
                'must_rotate_password': credentials.get('must_rotate_password', True),
            },
            'provisioning': {
                'preset_key': provisioning.get('preset_key') or '',
                'roles_count': len(provisioning.get('roles', [])),
                'teams_count': len(provisioning.get('teams', [])),
                'tasks_created_count': provisioning.get('tasks_created_count', 0),
                'security_task_created': provisioning.get('security_task_created', False),
            },
        })
    return items


def _build_user_provisioning_watchlist(limit=10):
    safe_limit = max(1, min(int(limit or 10), 24))
    recent_cutoff = django_timezone.now() - timedelta(days=30)
    users = list(
        User.objects
        .filter(date_joined__gte=recent_cutoff)
        .prefetch_related('roles', 'teams')
        .order_by('-date_joined', '-id')[:safe_limit]
    )
    if not users:
        return []

    user_ids = [user.id for user in users]
    task_rows = list(
        Task.objects
        .filter(entity_type='User', entity_id__in=user_ids)
        .values('entity_id', 'status', 'source_key')
    )
    task_map = defaultdict(list)
    for row in task_rows:
        task_map[int(row['entity_id'])].append(row)

    log_map = {}
    logs = (
        AuditLog.objects
        .filter(entity_type='UserProvisioning', entity_id__in=user_ids)
        .select_related('user')
        .order_by('-created_at', '-id')
    )
    for log in logs:
        log_map.setdefault(log.entity_id, log)

    open_statuses = {Task.STATUS_TODO, Task.STATUS_IN_PROGRESS}
    items = []
    for user in users:
        role_count = user.roles.count()
        team_count = user.teams.count()
        rows = task_map.get(user.id, [])
        open_rows = [row for row in rows if row.get('status') in open_statuses]
        security_source_key = f'provision-security-user-{user.id}'
        has_security_followup = any((row.get('source_key') or '') == security_source_key for row in open_rows)
        onboarding_open_task_count = sum(1 for row in open_rows if str(row.get('source_key') or '').startswith('ob-'))
        onboarding_done_task_count = sum(
            1
            for row in rows
            if str(row.get('source_key') or '').startswith('ob-') and row.get('status') == Task.STATUS_DONE
        )
        provisioning_log = log_map.get(user.id)
        provisioning = provisioning_log.new_values.get('provisioning', {}) if provisioning_log and isinstance(provisioning_log.new_values, dict) else {}
        preset_key = str(provisioning.get('preset_key') or '')
        if role_count == 0 or team_count == 0:
            state = 'access-gap'
            state_label = 'Thiếu quyền truy cập'
            severity = 'warning'
            summary = 'Tài khoản mới chưa đủ vai trò hoặc nhóm để vào line vận hành.'
        elif has_security_followup:
            state = 'security-followup'
            state_label = 'Theo dõi bảo mật'
            severity = 'error'
            summary = 'Còn đầu việc đổi mật khẩu tạm thời, cần đóng lại khi người dùng đăng nhập lần đầu.'
        elif onboarding_open_task_count > 0:
            state = 'onboarding-in-flight'
            state_label = 'Tiếp nhận đang chạy'
            severity = 'info'
            summary = 'Gói tiếp nhận đang chạy, vẫn còn đầu việc mở cần theo dõi.'
        else:
            state = 'ready'
            state_label = 'Sẵn sàng'
            severity = 'success'
            summary = 'Tài khoản đã sẵn sàng vận hành và không còn đầu việc theo dõi đang mở.'

        items.append({
            'id': user.id,
            'username': user.username,
            'full_name': user.get_full_name() or user.username,
            'email': user.email or '',
            'date_joined': user.date_joined,
            'state': state,
            'state_label': state_label,
            'severity': severity,
            'summary': summary,
            'route': '/admin/user-provisioning',
            'preset_key': preset_key,
            'is_provisioned': provisioning_log is not None,
            'role_count': role_count,
            'team_count': team_count,
            'open_task_count': len(open_rows),
            'onboarding_open_task_count': onboarding_open_task_count,
            'onboarding_done_task_count': onboarding_done_task_count,
            'has_security_followup': has_security_followup,
        })
    return items


def _build_user_provisioning_preflight_checks(
    *,
    username_available,
    email_available,
    roles_after,
    teams_after,
    task_preview,
    security_task_preview,
    preset,
    create_tasks,
    include_security_task,
):
    checks = []
    checks.append({
        'key': 'identity',
        'title': 'Identity availability',
        'status': 'blocked' if (not username_available or not email_available) else 'ready',
        'description': (
            'Username hoac email dang bi trung trong he thong.'
            if (not username_available or not email_available)
            else 'Username va email co the cap ngay.'
        ),
    })
    checks.append({
        'key': 'access',
        'title': 'Access coverage',
        'status': 'warning' if (not roles_after or not teams_after) else 'ready',
        'description': (
            'Nen gan it nhat 1 role va 1 team de user vao dung luong nghiep vu.'
            if (not roles_after or not teams_after)
            else f"Da resolve {len(roles_after)} role va {len(teams_after)} team."
        ),
    })
    checks.append({
        'key': 'preset',
        'title': 'Preset readiness',
        'status': 'warning' if (preset and preset.get('has_issues')) else ('ready' if preset else 'info'),
        'description': (
            'Preset dang co dependency can review truoc khi apply.'
            if (preset and preset.get('has_issues'))
            else (f"Preset {preset.get('name')} da san sang." if preset else 'Khong dung preset, se cap access thu cong.')
        ),
    })
    checks.append({
        'key': 'workflow',
        'title': 'Workflow rollout',
        'status': 'warning' if (create_tasks and preset and not task_preview) else ('ready' if task_preview else 'info'),
        'description': (
            f"Se tao {len(task_preview)} onboarding task."
            if task_preview
            else ('Khong co workflow task nao trong package hien tai.' if create_tasks else 'Admin da tat tu dong tao onboarding task.')
        ),
    })
    checks.append({
        'key': 'security',
        'title': 'Theo dõi bảo mật',
        'status': 'ready' if security_task_preview else ('info' if not include_security_task else 'warning'),
        'description': (
            'Da len lich task doi mat khau tam thoi cho user.'
            if security_task_preview
            else ('Khong tao security task theo cau hinh hien tai.' if not include_security_task else 'Nen tao security task de chot buoc doi mat khau.')
        ),
    })
    return checks


def _build_user_lifecycle_candidate_rows(limit=120, exclude_user_id=None):
    safe_limit = max(1, min(int(limit or 120), 240))
    users = (
        User.objects
        .exclude(id=exclude_user_id) if exclude_user_id else User.objects.all()
    )
    users = list(
        _annotate_user_directory_queryset(
            users.filter(is_superuser=False).prefetch_related('roles', 'teams')
        )
        .order_by('-is_active', '-is_locked', 'first_name', 'last_name', 'username')[:safe_limit]
    )
    if not users:
        return []

    user_ids = [user.id for user in users]
    task_rows = (
        Task.objects
        .filter(assigned_to_id__in=user_ids, status__in=[Task.STATUS_TODO, Task.STATUS_IN_PROGRESS])
        .values('assigned_to_id')
        .annotate(
            open_task_count=Count('id'),
            blocking_task_count=Count('id', filter=models.Q(is_blocking=True)),
            overdue_task_count=Count('id', filter=models.Q(due_date__lt=django_timezone.now().date())),
        )
    )
    task_map = {int(row['assigned_to_id']): row for row in task_rows}
    rows = []
    for user in users:
        role_rows = _get_prefetched_user_relation_rows(user, 'roles')
        team_rows = _get_prefetched_user_relation_rows(user, 'teams')
        task_summary = task_map.get(user.id, {})
        rows.append({
            'id': user.id,
            'username': user.username,
            'full_name': user.get_full_name() or user.username,
            'email': user.email or '',
            'is_active': bool(user.is_active),
            'is_locked': bool(user.is_locked),
            'active_session_count': int(getattr(user, 'active_session_count', 0) or 0),
            'role_count': len(role_rows),
            'team_count': len(team_rows),
            'open_task_count': int(task_summary.get('open_task_count', 0) or 0),
            'blocking_task_count': int(task_summary.get('blocking_task_count', 0) or 0),
            'overdue_task_count': int(task_summary.get('overdue_task_count', 0) or 0),
            'last_seen_at': getattr(user, 'last_seen_at', None),
        })
    return rows


def _build_user_offboarding_watchlist(limit=10, exclude_user_id=None):
    safe_limit = max(1, min(int(limit or 10), 24))
    dormant_cutoff = django_timezone.now() - timedelta(days=45)
    candidates = _build_user_lifecycle_candidate_rows(limit=safe_limit * 6, exclude_user_id=exclude_user_id)
    items = []
    for user in candidates:
        last_seen_at = user.get('last_seen_at')
        should_include = (
            int(user.get('active_session_count', 0) or 0) > 0
            or int(user.get('open_task_count', 0) or 0) > 0
            or not bool(user.get('is_active', True))
            or bool(user.get('is_locked', False))
            or last_seen_at is None
            or last_seen_at < dormant_cutoff
        )
        if not should_include:
            continue

        role_count = int(user.get('role_count', 0) or 0)
        team_count = int(user.get('team_count', 0) or 0)
        active_session_count = int(user.get('active_session_count', 0) or 0)
        open_task_count = int(user.get('open_task_count', 0) or 0)
        if active_session_count > 0:
            state = 'session-cleanup'
            state_label = 'Dọn phiên đăng nhập'
            severity = 'error'
            summary = 'Tài khoản đang có phiên mở, cần đóng trước khi kết thúc vòng đời.'
        elif open_task_count > 0:
            state = 'task-handoff'
            state_label = 'Bàn giao đầu việc'
            severity = 'warning'
            summary = 'Còn đầu việc đang mở cần bàn giao cho người phụ trách mới.'
        elif role_count > 0 or team_count > 0:
            state = 'access-retained'
            state_label = 'Còn giữ quyền'
            severity = 'warning'
            summary = 'Tài khoản đã dormant/locked nhưng vẫn đang giữ vai trò hoặc nhóm.'
        else:
            state = 'ready'
            state_label = 'Sẵn sàng'
            severity = 'success'
            summary = 'Không còn phiên, đầu việc hay quyền tồn đọng cần dọn.'

        items.append({
            'id': user['id'],
            'username': user['username'],
            'full_name': user['full_name'],
            'email': user['email'],
            'state': state,
            'state_label': state_label,
            'severity': severity,
            'summary': summary,
            'active_session_count': active_session_count,
            'open_task_count': open_task_count,
            'role_count': role_count,
            'team_count': team_count,
            'is_active': bool(user['is_active']),
            'is_locked': bool(user['is_locked']),
            'last_seen_at': user.get('last_seen_at'),
            'route': '/admin/user-lifecycle',
        })
    return items[:safe_limit]


def _build_user_offboarding_workspace_summary(watchlist_items, candidate_rows):
    return {
        'candidate_users': len(candidate_rows),
        'review_queue': len(watchlist_items),
        'session_cleanup': sum(1 for item in watchlist_items if item['state'] == 'session-cleanup'),
        'task_handoffs': sum(1 for item in watchlist_items if item['state'] == 'task-handoff'),
        'access_retained': sum(1 for item in watchlist_items if item['state'] == 'access-retained'),
        'ready_accounts': sum(1 for item in watchlist_items if item['state'] == 'ready'),
    }


def _build_user_offboarding_preflight_checks(
    *,
    is_self_target,
    is_superuser_target,
    active_session_count,
    open_task_count,
    role_count,
    team_count,
    transfer_target,
    deactivate_account,
    lock_account,
    revoke_access,
    revoke_sessions,
):
    checks = []
    checks.append({
        'key': 'target',
        'title': 'Safe target',
        'status': 'blocked' if (is_self_target or is_superuser_target) else 'ready',
        'description': (
            'Khong the offboard chinh tai khoan dang thao tac hoac superuser he thong.'
            if (is_self_target or is_superuser_target)
            else 'Target hop le de chay lifecycle cleanup.'
        ),
    })
    checks.append({
        'key': 'task_handoff',
        'title': 'Bàn giao đầu việc',
        'status': 'blocked' if (open_task_count > 0 and transfer_target is None) else ('ready' if open_task_count > 0 else 'info'),
        'description': (
            f'Can ban giao {open_task_count} task dang mo truoc khi offboard.'
            if (open_task_count > 0 and transfer_target is None)
            else (f'Da chon owner moi cho {open_task_count} task dang mo.' if open_task_count > 0 else 'Khong co task dang mo can ban giao.')
        ),
    })
    checks.append({
        'key': 'session_cleanup',
        'title': 'Dọn phiên đăng nhập',
        'status': 'warning' if (active_session_count > 0 and not revoke_sessions) else ('ready' if active_session_count > 0 else 'info'),
        'description': (
            f'Con {active_session_count} session dang mo. Nen revoke de dong truy cap ngay.'
            if (active_session_count > 0 and not revoke_sessions)
            else (f'Se revoke {active_session_count} session dang mo.' if active_session_count > 0 else 'Khong co session dang mo.')
        ),
    })
    checks.append({
        'key': 'access_cleanup',
        'title': 'Access cleanup',
        'status': 'warning' if ((role_count > 0 or team_count > 0) and not revoke_access) else ('ready' if (role_count > 0 or team_count > 0) else 'info'),
        'description': (
            f'Tai khoan dang giu {role_count} role va {team_count} team. Nen revoke khi offboarding.'
            if ((role_count > 0 or team_count > 0) and not revoke_access)
            else (f'Se revoke {role_count} role va {team_count} team.' if (role_count > 0 or team_count > 0) else 'Khong co access can thu hoi.')
        ),
    })
    checks.append({
        'key': 'account_state',
        'title': 'Account state',
        'status': 'warning' if (not deactivate_account or not lock_account) else 'ready',
        'description': (
            'Nen deactivate va lock account de khoa vong doi hoan toan.'
            if (not deactivate_account or not lock_account)
            else 'Account se bi deactivate va lock ngay sau khi apply.'
        ),
    })
    return checks


def _build_user_offboarding_activity_items(queryset, limit=20):
    safe_limit = max(1, min(int(limit or 20), 60))
    logs = list(queryset.order_by('-created_at', '-id')[:safe_limit])
    items = []
    for log in logs:
        new_values = log.new_values or {}
        cleanup = new_values.get('cleanup', {}) if isinstance(new_values, dict) else {}
        account_state = new_values.get('account_state', {}) if isinstance(new_values, dict) else {}
        items.append({
            'id': log.id,
            'timestamp': log.created_at,
            'summary': f"Lifecycle cleanup cho {log.entity_code}",
            'route': '/admin/user-lifecycle',
            'entity_code': log.entity_code,
            'changed_fields': log.changed_fields or [],
            'actor': {
                'id': log.user_id,
                'username': log.user.username if log.user else '',
                'full_name': log.user.get_full_name() if log.user else '',
            },
            'cleanup': {
                'tasks_transferred_count': int(cleanup.get('tasks_transferred_count', 0) or 0),
                'sessions_revoked_count': int(cleanup.get('sessions_revoked_count', 0) or 0),
                'revoke_access': bool(cleanup.get('revoke_access', False)),
                'transfer_target_username': str(cleanup.get('transfer_target_username') or ''),
            },
            'account_state': {
                'is_active': bool(account_state.get('is_active', False)),
                'is_locked': bool(account_state.get('is_locked', False)),
            },
        })
    return items


def _get_workflow_scheduler_job_status_payload(job_name=WORKFLOW_SCHEDULER_JOB_NAME):
    lock_active = cache.get('workflow_automation_scheduler_job_lock') is not None
    try:
        from django_q.models import Schedule
    except Exception:
        return {
            'enabled': False,
            'name': job_name,
            'interval_minutes': 5,
            'next_run': None,
            'schedule_id': None,
            'lock_active': lock_active,
        }

    schedule = Schedule.objects.filter(name=job_name).first()
    if not schedule:
        return {
            'enabled': False,
            'name': job_name,
            'interval_minutes': 5,
            'next_run': None,
            'schedule_id': None,
            'lock_active': lock_active,
        }
    return {
        'enabled': bool(schedule.repeats != 0),
        'name': schedule.name,
        'interval_minutes': int(schedule.minutes or 5),
        'next_run': schedule.next_run,
        'schedule_id': schedule.id,
        'lock_active': lock_active,
    }


def _get_workflow_scheduler_health_payload(hours=24, job_name=WORKFLOW_SCHEDULER_JOB_NAME):
    from .workflow_services import get_scheduler_policy

    safe_hours = max(1, min(int(hours or 24), 168))
    since_dt = django_timezone.now() - timedelta(hours=safe_hours)

    logs = list(
        AuditLog.objects
        .filter(entity_type='WorkflowAutomationJob')
        .order_by('-created_at', '-id')[:300]
    )
    recent_logs = [log for log in logs if log.created_at and log.created_at >= since_dt]

    status_counts = {'SUCCESS': 0, 'FAILED': 0, 'SKIPPED_LOCKED': 0}
    durations = []
    recent_errors = []
    for log in recent_logs:
        payload = log.new_values or {}
        status_value = str(payload.get('status') or '').upper()
        if status_value in status_counts:
            status_counts[status_value] += 1
        if status_value == 'SUCCESS':
            duration = payload.get('duration_ms')
            if isinstance(duration, (int, float)):
                durations.append(int(duration))
        if status_value == 'FAILED':
            recent_errors.append({
                'created_at': log.created_at,
                'message': str(payload.get('message') or ''),
            })

    last_status = ''
    last_run_at = None
    if logs:
        payload = logs[0].new_values or {}
        last_status = str(payload.get('status') or '').upper()
        last_run_at = logs[0].created_at

    consecutive_failures = 0
    for log in logs:
        status_value = str((log.new_values or {}).get('status') or '').upper()
        if status_value == 'FAILED':
            consecutive_failures += 1
            continue
        if status_value == 'SUCCESS':
            break

    avg_success_duration_ms = int(sum(durations) / len(durations)) if durations else 0
    scheduler_enabled = None
    try:
        from django_q.models import Schedule
        schedule = Schedule.objects.filter(name=job_name).first()
        scheduler_enabled = bool(schedule and schedule.repeats != 0)
    except Exception:
        scheduler_enabled = None

    policy = get_scheduler_policy()
    failure_threshold = int(policy.get('failure_threshold') or 3)
    latest_error_msg = recent_errors[0]['message'] if recent_errors else ''
    recommended_actions = []
    if status_counts['FAILED'] > 0:
        recommended_actions.append('Kiểm tra chi tiết lỗi gần nhất trong timeline sự cố.')
    if 'lock' in latest_error_msg.lower():
        recommended_actions.append('Dùng nút khôi phục scheduler với tùy chọn xóa lock.')
    if consecutive_failures >= failure_threshold:
        recommended_actions.append('Scheduler đã/tới ngưỡng tự tắt. Khôi phục sau khi xử lý root-cause.')
    if status_counts['FAILED'] > 0 and avg_success_duration_ms > 0:
        recommended_actions.append('Cân nhắc tăng chu kỳ job scheduler để giảm tải tức thời.')

    return {
        'hours_window': safe_hours,
        'status_counts': status_counts,
        'last_status': last_status,
        'last_run_at': last_run_at,
        'consecutive_failures': consecutive_failures,
        'failure_threshold': failure_threshold,
        'auto_disabled': consecutive_failures >= failure_threshold and scheduler_enabled is False,
        'scheduler_enabled': scheduler_enabled,
        'avg_success_duration_ms': avg_success_duration_ms,
        'recent_errors': recent_errors[:5],
        'lock_active': cache.get('workflow_automation_scheduler_job_lock') is not None,
        'recommended_actions': recommended_actions,
    }


def _get_workflow_scheduler_incidents_payload(status_filter='ALL', limit=30):
    safe_limit = max(1, min(int(limit or 30), 200))
    filter_value = str(status_filter or 'ALL').strip().upper()
    logs = (
        AuditLog.objects
        .select_related('user')
        .filter(entity_type='WorkflowAutomationJob')
        .order_by('-created_at', '-id')
    )
    items = []
    for log in logs[: max(safe_limit * 3, safe_limit)]:
        payload = log.new_values or {}
        status_value = str(payload.get('status') or '').upper()
        if filter_value != 'ALL' and status_value != filter_value:
            continue
        event_type = 'JOB_RUN'
        changed_fields = log.changed_fields or []
        if 'recover' in changed_fields:
            event_type = 'RECOVERY'
        elif 'policy_update' in changed_fields:
            event_type = 'POLICY_UPDATE'
        elif 'policy_preset' in changed_fields:
            event_type = 'POLICY_PRESET'
        elif str(payload.get('run_mode') or '').upper() == 'MANUAL_SIMULATION':
            event_type = 'SIMULATION'
        items.append({
            'id': log.id,
            'status': status_value,
            'event_type': event_type,
            'actor': log.user.username if log.user else '',
            'message': str(payload.get('message') or ''),
            'run_mode': str(payload.get('run_mode') or ''),
            'duration_ms': int(payload.get('duration_ms') or 0),
            'policy_diff': {
                'old_failure_threshold': (log.old_values or {}).get('failure_threshold'),
                'new_failure_threshold': payload.get('failure_threshold'),
            },
            'created_at': log.created_at,
        })
        if len(items) >= safe_limit:
            break
    return {'items': items, 'total': len(items)}


def _get_role_module_permission_history_meta_payload():
    user_ids = list(
        AuditLog.objects
        .filter(entity_type='RoleModulePermission', user_id__isnull=False)
        .order_by()
        .values_list('user_id', flat=True)
        .distinct()[:200]
    )
    users = list(
        User.objects
        .filter(id__in=user_ids)
        .order_by('username')
        .values('id', 'username', 'first_name', 'last_name')
    )
    user_items = [
        {
            'id': int(row['id']),
            'username': row['username'],
            'full_name': f"{row['first_name']} {row['last_name']}".strip(),
        }
        for row in users
    ]

    recent_cutoff = django_timezone.now() - timedelta(hours=24)
    recent_logs = list(
        AuditLog.objects
        .filter(entity_type='RoleModulePermission', created_at__gte=recent_cutoff)
        .select_related('user')
        .order_by('-created_at', '-id')
    )
    recent_actor_counts = {}
    for row in recent_logs:
        actor_key = row.user_id or 0
        current = recent_actor_counts.get(actor_key)
        if current is None:
            current = {'events_24h': 0, 'role_changes_24h': 0}
            recent_actor_counts[actor_key] = current
        current['events_24h'] += 1
        new_items = (row.new_values or {}).get('items') if isinstance(row.new_values, dict) else []
        if isinstance(new_items, list):
            current['role_changes_24h'] += len([item for item in new_items if isinstance(item, dict)])
    anomalies_24h_count = len([
        actor for actor in recent_actor_counts.values()
        if int(actor['events_24h']) >= 10 or int(actor['role_changes_24h']) >= 20
    ])
    return {
        'users': user_items,
        'changed_types': [
            {'value': row['changed_type'], 'label': row['label']}
            for row in MODULE_PERMISSION_FIELDS
        ],
        'anomalies_24h_count': anomalies_24h_count,
    }


def _build_access_exception_workspace_payload(activity_limit=8):
    raw_policies = _load_access_exception_policies()
    automation_policy = _load_access_exception_automation_policy()
    raw_request_rows = _load_access_exception_requests()
    availability_rows_storage = _load_access_exception_approver_availability()
    approver_candidate_rows = _build_access_exception_approver_candidate_rows(limit=40)
    routing_rule_rows = _build_access_exception_routing_rule_rows()
    base_policy_rows = _build_access_exception_policy_rows(raw_policies)
    request_rows = _build_access_exception_request_rows(raw_request_rows, base_policy_rows)
    policy_rows = _build_access_exception_policy_rows(raw_policies, request_rows=request_rows)
    sla_radar = _build_access_exception_sla_radar(request_rows=request_rows, automation_policy=automation_policy)
    routing_coverage = _build_access_exception_routing_coverage_rows(
        policy_rows=policy_rows,
        request_rows=request_rows,
        routing_rules=routing_rule_rows,
        sla_radar=sla_radar,
    )
    routing_coverage_summary = _build_access_exception_routing_coverage_summary(routing_coverage)
    approver_capacity = _build_access_exception_approver_capacity_rows(
        request_rows=request_rows,
        routing_rules=routing_rule_rows,
        coverage_rows=routing_coverage,
        sla_radar=sla_radar,
        approver_candidates=approver_candidate_rows,
    )
    approver_capacity_summary = _build_access_exception_approver_capacity_summary(approver_capacity)
    workload_recommendations = _build_access_exception_workload_recommendations(
        capacity_rows=approver_capacity,
        coverage_rows=routing_coverage,
        routing_rules=routing_rule_rows,
    )
    availability_rows = _build_access_exception_approver_availability_rows(
        availability_rows=availability_rows_storage,
        routing_rules=routing_rule_rows,
        request_rows=request_rows,
        approver_candidates=approver_candidate_rows,
    )
    availability_summary = _build_access_exception_approver_availability_summary(availability_rows)
    continuity_runbook = _build_access_exception_continuity_runbook_rows(
        request_rows=request_rows,
        policy_rows=policy_rows,
    )
    continuity_summary = _build_access_exception_continuity_summary(continuity_runbook)
    continuity_analytics = _build_access_exception_department_continuity_rows(
        coverage_rows=routing_coverage,
        continuity_rows=continuity_runbook,
        availability_rows=availability_rows,
        drill_state=_load_access_exception_continuity_drill_state(),
        automation_policy=automation_policy,
    )
    continuity_analytics_summary = _build_access_exception_department_continuity_summary(continuity_analytics)
    continuity_drill_preview = _build_access_exception_continuity_drill_preview(
        analytics_rows=continuity_analytics,
        automation_policy=automation_policy,
    )
    guided_remediation = _build_access_exception_guided_remediation_rows(
        policy_rows=policy_rows,
        request_rows=request_rows,
        continuity_rows=continuity_runbook,
    )
    guided_remediation_summary = _build_access_exception_guided_remediation_summary(guided_remediation)
    watchlist_items = _build_access_exception_watchlist(
        policy_rows,
        request_rows,
        coverage_rows=routing_coverage,
        sla_radar=sla_radar,
        capacity_rows=approver_capacity,
        availability_rows=availability_rows,
        continuity_rows=continuity_runbook,
        continuity_analytics=continuity_analytics,
        continuity_drill_preview=continuity_drill_preview,
    )
    activity_queryset = AuditLog.objects.filter(
        entity_type__in=['UserAccessExceptionPolicy', 'UserAccessExceptionRoutingRule', 'UserAccessExceptionApproverAvailability', 'UserAccessExceptionRequest', 'UserAccessExceptionAutomation', 'UserAccessExceptionSimulation', 'UserAccessExceptionRemediation']
    ).select_related('user')
    role_rows = _serialize_onboarding_role_rows(_annotate_role_governance_queryset(Role.objects.all()))
    team_rows = _serialize_onboarding_team_rows(_annotate_team_governance_queryset(Team.objects.all()))
    return {
        'summary': _build_access_exception_workspace_summary(
            policy_rows,
            request_rows,
            watchlist_items,
            coverage_summary=routing_coverage_summary,
            sla_radar=sla_radar,
            capacity_summary=approver_capacity_summary,
            availability_summary=availability_summary,
            continuity_summary=continuity_summary,
            continuity_analytics_summary=continuity_analytics_summary,
            continuity_drill_preview=continuity_drill_preview,
            remediation_summary=guided_remediation_summary,
        ),
        'policies': policy_rows,
        'policy_packs': _build_access_exception_policy_pack_rows(),
        'routing_rules': routing_rule_rows,
        'routing_coverage_summary': routing_coverage_summary,
        'routing_coverage': routing_coverage,
        'approver_capacity_summary': approver_capacity_summary,
        'approver_capacity': approver_capacity,
        'approver_availability_summary': availability_summary,
        'approver_availability': availability_rows,
        'workload_recommendations': workload_recommendations,
        'requests': request_rows,
        'sla_radar': sla_radar,
        'continuity_summary': continuity_summary,
        'continuity_runbook': continuity_runbook,
        'continuity_analytics_summary': continuity_analytics_summary,
        'continuity_analytics': continuity_analytics,
        'continuity_drill_preview': continuity_drill_preview,
        'guided_remediation_summary': guided_remediation_summary,
        'guided_remediation': guided_remediation,
        'watchlist': watchlist_items,
        'roles': role_rows,
        'teams': team_rows,
        'approver_candidates': approver_candidate_rows,
        'automation_policy': automation_policy,
        'scheduler_status': _get_access_exception_scheduler_status(),
        'automation_preview': _build_access_exception_automation_preview(
            request_rows_storage=raw_request_rows,
            request_rows=request_rows,
            automation_policy=automation_policy,
            scope='all',
        ),
        'recent_activity': _build_access_exception_activity_items(activity_queryset, limit=activity_limit),
    }


def _approval_audit_label(action_key):
    normalized = str(action_key or '').upper()
    return {
        'SUBMIT': 'Gửi duyệt',
        'RESUBMIT': 'Gửi lại',
        'APPROVE': 'Đã duyệt',
        'APPROVE_L1': 'Duyệt cấp 1',
        'APPROVE_L2': 'Duyệt cấp 2',
        'REJECT': 'Từ chối',
        'REVOKE': 'Thu hồi',
    }.get(normalized, normalized or 'Cập nhật')


def _approval_audit_actor_label(user):
    if not user:
        return 'Hệ thống'
    full_name = ''
    try:
        full_name = user.get_full_name()
    except Exception:
        full_name = ''
    return full_name or getattr(user, 'username', '') or 'Hệ thống'


ADMIN_AUDIT_DOMAIN_CONFIG = {
    'finance': {'label': 'Tài chính', 'route': '/advance-transactions'},
    'workforce': {'label': 'Nhân sự', 'route': '/salary-advance'},
    'purchasing': {'label': 'Mua hàng', 'route': '/purchase-orders'},
    'production': {'label': 'Sản xuất', 'route': '/production-orders'},
    'governance': {'label': 'Kiểm soát truy cập', 'route': '/admin/access-governance'},
    'workflow': {'label': 'Workflow', 'route': '/workflow-analytics'},
}


ADMIN_AUDIT_ENTITY_LABELS = {
    'AdvanceTransaction': 'Tạm ứng',
    'FinanceAdvanceApproval': 'Duyệt tạm ứng',
    'SalaryAdvanceRecord': 'Hồ sơ ứng lương',
    'WorkforceSalaryAdvanceApproval': 'Duyệt ứng lương',
    'PurchaseOrder': 'Đơn mua',
    'PurchaseRequest': 'Yêu cầu mua',
    'PurchaseReceipt': 'Phiếu nhập mua',
    'PurchaseReturn': 'Phiếu trả hàng mua',
    'Supplier': 'Nhà cung cấp',
    'ProductionOrder': 'Lệnh sản xuất',
    'ProductionIssue': 'Phiếu cấp vật tư',
    'ProductionReceipt': 'Phiếu nhập thành phẩm',
    'WorkflowAutomationJob': 'Bộ lập lịch workflow',
    'WorkflowTaskTemplate': 'Mẫu nhiệm vụ workflow',
    'RoleModulePermission': 'Phân quyền phân hệ',
    'Role': 'Vai trò',
    'Team': 'Nhóm',
    'UserAccess': 'Truy cập người dùng',
    'UserProvisioning': 'Cấp tài khoản',
    'UserOffboarding': 'Kết thúc vòng đời',
    'UserOnboarding': 'Onboarding',
    'UserOnboardingPreset': 'Preset onboarding',
    'UserAccessExceptionRequest': 'Yêu cầu ngoại lệ truy cập',
    'UserAccessExceptionPolicy': 'Chính sách ngoại lệ truy cập',
    'UserAccessReviewCampaign': 'Chiến dịch review truy cập',
}


ADMIN_AUDIT_SENSITIVE_ACTIONS = {
    'DELETE',
    'DEACTIVATE',
    'LOCK',
    'REJECT',
    'REVOKE',
    'CANCEL',
    'VOID',
    'ROLLBACK',
    'SIMULATE',
}


ADMIN_AUDIT_SENSITIVE_FIELDS = {
    'module_permissions',
    'permissions',
    'permission_ids',
    'roles',
    'role_ids',
    'teams',
    'team_ids',
    'approval_status',
    'rejection_reason',
    'cancel_reason',
    'must_rotate_password',
    'password_mode',
    'is_active',
    'recover',
    'policy_update',
}


def _can_view_admin_audit(user):
    return _can_view_admin_observability(user)


def _resolve_admin_audit_domain_and_route(entity_type):
    normalized = str(entity_type or '')
    if normalized.startswith('Finance') or normalized in {
        'AdvanceTransaction',
        'CashTransaction',
        'CashAccount',
        'AccountsReceivable',
        'AccountsPayable',
        'BankReconciliation',
        'BudgetPlan',
    }:
        return 'finance', '/advance-transactions'
    if normalized.startswith('Workforce') or normalized in {
        'SalaryAdvanceRecord',
        'PayrollRecord',
        'AttendanceRecord',
        'BonusPenaltyRecord',
        'Employee',
    }:
        return 'workforce', '/salary-advance'
    if normalized.startswith('Purchase') or normalized in {
        'Supplier',
        'MaterialPurchasePrice',
    }:
        if normalized == 'PurchaseRequest':
            return 'purchasing', '/purchase-requests'
        return 'purchasing', '/purchase-orders'
    if normalized.startswith('Production'):
        return 'production', '/production-orders'
    if normalized.startswith('Workflow'):
        if normalized == 'WorkflowTaskTemplate':
            return 'workflow', '/workflow-task-templates'
        return 'workflow', '/workflow-analytics'
    if normalized == 'RoleModulePermission':
        return 'governance', '/admin/module-permissions-history'
    if normalized in {'Role', 'Team'}:
        return 'governance', '/admin/roles-teams'
    if normalized.startswith('UserAccessException'):
        return 'governance', '/admin/access-exceptions'
    if normalized.startswith('UserAccessReview'):
        return 'governance', '/admin/access-reviews'
    if normalized == 'UserProvisioning':
        return 'governance', '/admin/user-provisioning'
    if normalized == 'UserOffboarding':
        return 'governance', '/admin/user-lifecycle'
    if normalized.startswith('UserOnboarding'):
        return 'governance', '/admin/onboarding-studio'
    if normalized == 'UserAccess':
        return 'governance', '/admin/users'
    return None, None


def _admin_audit_action_label(log):
    action = str(log.action or '').upper()
    entity_type = str(log.entity_type or '')
    payload = log.new_values or {}
    changed_fields = {str(field) for field in (log.changed_fields or [])}
    if entity_type == 'WorkflowAutomationJob':
        status_value = str(payload.get('status') or '').upper()
        if status_value == 'FAILED':
            return 'Job thất bại'
        if status_value == 'SKIPPED_LOCKED':
            return 'Job bị khóa'
        if 'recover' in changed_fields:
            return 'Khôi phục scheduler'
        if action == 'RUN':
            return 'Chạy workflow'
    return {
        'CREATE': 'Tạo mới',
        'UPDATE': 'Cập nhật',
        'DELETE': 'Xóa',
        'DEACTIVATE': 'Tạm dừng',
        'ACTIVATE': 'Kích hoạt',
        'LOCK': 'Khóa',
        'SUBMIT': 'Gửi duyệt',
        'RESUBMIT': 'Gửi lại',
        'APPROVE': 'Phê duyệt',
        'APPROVE_L1': 'Duyệt cấp 1',
        'APPROVE_L2': 'Duyệt cấp 2',
        'REJECT': 'Từ chối',
        'REVOKE': 'Thu hồi',
        'CANCEL': 'Hủy',
        'ROLLBACK': 'Hoàn nguyên',
        'RUN': 'Thực thi',
        'PROVISION': 'Cấp tài khoản',
        'OFFBOARD': 'Kết thúc vòng đời',
    }.get(action, action or 'Cập nhật')


def _admin_audit_entity_label(entity_type):
    normalized = str(entity_type or '')
    return ADMIN_AUDIT_ENTITY_LABELS.get(normalized, normalized or 'Đối tượng')


def _admin_audit_actor_label(user):
    return _approval_audit_actor_label(user)


def _admin_audit_comments(log):
    payload = log.new_values or {}
    old_values = log.old_values or {}
    for key in ['message', 'rejection_reason', 'cancel_reason', 'notes', 'note', 'summary']:
        value = payload.get(key)
        if value:
            return str(value)
    for key in ['message', 'notes', 'note']:
        value = old_values.get(key)
        if value:
            return str(value)
    return ''


def _admin_audit_severity(log):
    action = str(log.action or '').upper()
    entity_type = str(log.entity_type or '')
    changed_fields = {str(field) for field in (log.changed_fields or [])}
    payload = log.new_values or {}
    if entity_type == 'WorkflowAutomationJob':
        status_value = str(payload.get('status') or '').upper()
        if status_value == 'FAILED':
            return 'error'
        if status_value == 'SKIPPED_LOCKED':
            return 'warning'
        return 'info'
    if action in ADMIN_AUDIT_SENSITIVE_ACTIONS:
        return 'error'
    if changed_fields.intersection(ADMIN_AUDIT_SENSITIVE_FIELDS):
        return 'warning'
    if action in {'APPROVE', 'APPROVE_L1', 'APPROVE_L2', 'SUBMIT', 'RESUBMIT', 'UPDATE'}:
        return 'warning'
    if action in {'ACTIVATE', 'RECOVER'}:
        return 'success'
    return 'info'


def _serialize_admin_audit_activity_item(log):
    domain, route = _resolve_admin_audit_domain_and_route(log.entity_type)
    if not domain or not route:
        return None
    action_label = _admin_audit_action_label(log)
    entity_label = _admin_audit_entity_label(log.entity_type)
    if str(log.entity_type or '') in {'UserAccessExceptionRequest', 'UserAccessExceptionPolicy'}:
        entity_code = str(log.entity_id_str or log.entity_code or log.entity_id or '')
    else:
        entity_code = str(log.entity_code or log.entity_id_str or log.entity_id or '')
    summary = f'{entity_label} {entity_code}'.strip()
    if action_label:
        summary = f'{summary} - {action_label}' if summary else action_label
    return {
        'id': f'audit-{log.id}',
        'domain': domain,
        'severity': _admin_audit_severity(log),
        'action': str(log.action or '').upper(),
        'action_label': action_label,
        'entity_type': str(log.entity_type or ''),
        'entity_id': int(log.entity_id) if log.entity_id is not None else None,
        'entity_id_str': str(log.entity_id_str or ''),
        'entity_code': entity_code,
        'summary': summary,
        'comments': _admin_audit_comments(log),
        'actor_label': _admin_audit_actor_label(log.user),
        'actor_username': getattr(log.user, 'username', '') if log.user else '',
        'created_at': log.created_at,
        'route': route,
        'changed_fields': [str(field) for field in (log.changed_fields or [])],
    }


def _get_admin_audit_allowed_domains(user):
    domains = []
    if _can_manage_finance_data(user):
        domains.append('finance')
    if _can_manage_workforce_data(user):
        domains.append('workforce')
    if _can_manage_purchasing_data(user):
        domains.append('purchasing')
    if _can_manage_production_data(user):
        domains.append('production')
    if _can_access_governance_hub(user) or _can_manage_user_directory(user):
        domains.append('governance')
    if _can_view_workflow(user) or _can_manage_workflow(user):
        domains.append('workflow')
    return domains


def _build_admin_audit_workspace_payload(user, hours=24, limit=24):
    safe_hours = max(1, min(int(hours or 24), 168))
    safe_limit = max(5, min(int(limit or 24), 120))
    cutoff = django_timezone.now() - timedelta(hours=safe_hours)
    allowed_domains = _get_admin_audit_allowed_domains(user)
    today = django_timezone.localdate()
    domain_stats = {
        key: {
            'events_24h': 0,
            'sensitive_events_24h': 0,
            'high_severity_events_24h': 0,
            'actor_ids': set(),
            'last_event_at': None,
        }
        for key in allowed_domains
    }
    actor_stats = {}
    entity_stats = {}
    recent_items = []
    timeline_7d = {}
    for offset in range(6, -1, -1):
        bucket_date = today - timedelta(days=offset)
        timeline_7d[bucket_date.isoformat()] = {
            'date': bucket_date.isoformat(),
            'total_events': 0,
            'sensitive_events': 0,
            'high_severity_events': 0,
        }

    queryset = (
        AuditLog.objects
        .filter(created_at__gte=cutoff)
        .select_related('user')
        .order_by('-created_at', '-id')[: max(safe_limit * 12, 320)]
    )
    for log in queryset:
        item = _serialize_admin_audit_activity_item(log)
        if not item or item['domain'] not in domain_stats:
            continue
        stats = domain_stats[item['domain']]
        stats['events_24h'] += 1
        if item['severity'] in {'warning', 'error'}:
            stats['sensitive_events_24h'] += 1
        if item['severity'] == 'error':
            stats['high_severity_events_24h'] += 1
        if log.user_id:
            stats['actor_ids'].add(int(log.user_id))
        if log.created_at and (stats['last_event_at'] is None or log.created_at > stats['last_event_at']):
            stats['last_event_at'] = log.created_at

        actor_key = int(log.user_id) if log.user_id else 0
        actor_row = actor_stats.get(actor_key)
        if actor_row is None:
            actor_row = {
                'actor_id': int(log.user_id) if log.user_id else None,
                'username': getattr(log.user, 'username', '') if log.user else '',
                'full_name': _admin_audit_actor_label(log.user),
                'event_count': 0,
                'sensitive_event_count': 0,
                'high_severity_event_count': 0,
                'domains': set(),
                'last_event_at': None,
            }
            actor_stats[actor_key] = actor_row
        actor_row['event_count'] += 1
        if item['severity'] in {'warning', 'error'}:
            actor_row['sensitive_event_count'] += 1
        if item['severity'] == 'error':
            actor_row['high_severity_event_count'] += 1
        actor_row['domains'].add(item['domain'])
        if log.created_at and (actor_row['last_event_at'] is None or log.created_at > actor_row['last_event_at']):
            actor_row['last_event_at'] = log.created_at

        entity_identity = (
            item['entity_id_str']
            or item['entity_code']
            or str(item['entity_id'] or '')
            or item['entity_type']
        )
        entity_key = '|'.join([
            item['domain'],
            item['entity_type'],
            str(entity_identity),
        ])
        entity_row = entity_stats.get(entity_key)
        if entity_row is None:
            entity_row = {
                'key': entity_key,
                'domain': item['domain'],
                'entity_type': item['entity_type'],
                'entity_id': item['entity_id'],
                'entity_id_str': item['entity_id_str'],
                'entity_code': item['entity_code'],
                'summary': item['summary'],
                'route': item['route'],
                'event_count': 0,
                'sensitive_event_count': 0,
                'high_severity_event_count': 0,
                'last_event_at': None,
                'last_actor_label': '',
                'latest_action_label': '',
            }
            entity_stats[entity_key] = entity_row
        entity_row['event_count'] += 1
        if item['severity'] in {'warning', 'error'}:
            entity_row['sensitive_event_count'] += 1
        if item['severity'] == 'error':
            entity_row['high_severity_event_count'] += 1
        if log.created_at and (entity_row['last_event_at'] is None or log.created_at > entity_row['last_event_at']):
            entity_row['last_event_at'] = log.created_at
            entity_row['last_actor_label'] = item['actor_label']
            entity_row['latest_action_label'] = item['action_label']

        if log.created_at:
            bucket = timeline_7d.get(django_timezone.localtime(log.created_at).date().isoformat())
            if bucket is not None:
                bucket['total_events'] += 1
                if item['severity'] in {'warning', 'error'}:
                    bucket['sensitive_events'] += 1
                if item['severity'] == 'error':
                    bucket['high_severity_events'] += 1

        if len(recent_items) < safe_limit:
            recent_items.append(item)

    domains = []
    total_events = 0
    sensitive_events = 0
    high_severity_events = 0
    for domain in allowed_domains:
        config = ADMIN_AUDIT_DOMAIN_CONFIG[domain]
        stats = domain_stats.get(domain, {})
        total_events += int(stats.get('events_24h') or 0)
        sensitive_events += int(stats.get('sensitive_events_24h') or 0)
        high_severity_events += int(stats.get('high_severity_events_24h') or 0)
        domains.append({
            'domain': domain,
            'label': config['label'],
            'events_24h': int(stats.get('events_24h') or 0),
            'sensitive_events_24h': int(stats.get('sensitive_events_24h') or 0),
            'high_severity_events_24h': int(stats.get('high_severity_events_24h') or 0),
            'actors_24h': len(stats.get('actor_ids') or set()),
            'last_event_at': stats.get('last_event_at'),
            'route': config['route'],
        })

    top_actors = sorted(
        [
            {
                'actor_id': row['actor_id'],
                'username': row['username'],
                'full_name': row['full_name'],
                'event_count': int(row['event_count']),
                'sensitive_event_count': int(row['sensitive_event_count']),
                'high_severity_event_count': int(row['high_severity_event_count']),
                'domains': sorted(row['domains']),
                'last_event_at': row['last_event_at'],
            }
            for row in actor_stats.values()
        ],
        key=lambda row: (
            row['high_severity_event_count'],
            row['sensitive_event_count'],
            row['event_count'],
            row['last_event_at'] or django_timezone.make_aware(datetime.min),
        ),
        reverse=True,
    )[:10]

    hot_entities = sorted(
        [
            {
                'key': row['key'],
                'domain': row['domain'],
                'entity_type': row['entity_type'],
                'entity_id': row['entity_id'],
                'entity_id_str': row['entity_id_str'],
                'entity_code': row['entity_code'],
                'summary': row['summary'],
                'route': row['route'],
                'event_count': int(row['event_count']),
                'sensitive_event_count': int(row['sensitive_event_count']),
                'high_severity_event_count': int(row['high_severity_event_count']),
                'last_event_at': row['last_event_at'],
                'last_actor_label': row['last_actor_label'],
                'latest_action_label': row['latest_action_label'],
            }
            for row in entity_stats.values()
        ],
        key=lambda row: (
            row['high_severity_event_count'],
            row['sensitive_event_count'],
            row['event_count'],
            row['last_event_at'] or django_timezone.make_aware(datetime.min),
        ),
        reverse=True,
    )[:12]

    return {
        'hours_window': safe_hours,
        'total_events': total_events,
        'sensitive_events': sensitive_events,
        'high_severity_events': high_severity_events,
        'domains': domains,
        'top_actors': top_actors,
        'hot_entities': hot_entities,
        'timeline_7d': list(timeline_7d.values()),
        'recent_activity': recent_items,
        'retention_policy': _get_admin_audit_retention_policy_payload(),
        'export_options': _get_admin_audit_export_options_payload(),
        'incident_response': _get_admin_audit_incident_response_payload(),
        'generated_at': django_timezone.now(),
    }


def _get_admin_audit_retention_policy_payload():
    retention_days = int(getattr(settings, 'AUDIT_LOG_RETENTION_DAYS', 0) or 0)
    now = django_timezone.now()
    oldest_log = AuditLog.objects.order_by('created_at', 'id').only('created_at').first()
    expired_count = 0
    if retention_days > 0:
        expired_cutoff = now - timedelta(days=retention_days)
        expired_count = AuditLog.objects.filter(created_at__lt=expired_cutoff).count()
    return {
        'retention_days': retention_days,
        'total_events': int(AuditLog.objects.count()),
        'expired_events': int(expired_count),
        'oldest_event_at': getattr(oldest_log, 'created_at', None),
        'purge_recommended': bool(expired_count > 0),
        'last_run': get_latest_audit_retention_run_payload(),
        'recommended_command': 'python manage.py purge_audit_logs --dry-run --json',
    }


def _get_admin_audit_export_options_payload():
    return {
        'formats': ['csv', 'json'],
        'max_rows': int(getattr(settings, 'AUDIT_EXPORT_MAX_ROWS', 0) or 0),
    }


def _get_admin_audit_incident_response_payload():
    return {
        'runbook_url': str(getattr(settings, 'INCIDENT_RUNBOOK_URL', '') or ''),
        'contacts': list(getattr(settings, 'INCIDENT_CONTACT_EMAILS', []) or []),
        'bundle_command': 'python manage.py go_live_handoff --json',
    }


def _collect_admin_audit_activity_items(user, *, hours=24, limit=100, domain_filter='ALL'):
    safe_hours = max(1, min(int(hours or 24), 168))
    safe_limit = max(1, min(int(limit or 100), int(getattr(settings, 'AUDIT_EXPORT_MAX_ROWS', 5000) or 5000)))
    cutoff = django_timezone.now() - timedelta(hours=safe_hours)
    allowed_domains = set(_get_admin_audit_allowed_domains(user))
    normalized_domain = str(domain_filter or 'ALL').strip().lower()
    if normalized_domain not in {'', 'all'}:
        if normalized_domain in allowed_domains:
            allowed_domains = {normalized_domain}
        else:
            allowed_domains = set()

    queryset = (
        AuditLog.objects
        .filter(created_at__gte=cutoff)
        .select_related('user')
        .order_by('-created_at', '-id')[: max(safe_limit * 12, 320)]
    )
    items = []
    for log in queryset:
        item = _serialize_admin_audit_activity_item(log)
        if not item or item['domain'] not in allowed_domains:
            continue
        items.append(item)
        if len(items) >= safe_limit:
            break
    return items


def _build_finance_approval_audit_activity_items(*, cutoff, limit=10):
    from finance.models import AdvanceTransaction

    items = []
    logs = (
        AuditLog.objects
        .filter(entity_type='FinanceAdvanceApproval', created_at__gte=cutoff)
        .select_related('user')
        .order_by('-created_at', '-id')[: max(limit * 4, limit)]
    )
    for log in logs:
        old_values = log.old_values or {}
        new_values = log.new_values or {}
        changed_fields = {str(field) for field in (log.changed_fields or [])}
        old_status = str(old_values.get('approval_status') or '').upper()
        new_status = str(new_values.get('approval_status') or '').upper()
        action = ''
        if new_status == AdvanceTransaction.APPROVAL_PENDING_L1:
            action = 'RESUBMIT' if old_status == AdvanceTransaction.APPROVAL_REJECTED else 'SUBMIT'
        elif new_status == AdvanceTransaction.APPROVAL_PENDING_L2:
            action = 'APPROVE_L1' if 'approved_level1_at' in changed_fields else 'APPROVE'
        elif new_status == AdvanceTransaction.APPROVAL_APPROVED:
            action = 'APPROVE_L2' if 'approved_level2_at' in changed_fields else 'APPROVE'
        elif new_status == AdvanceTransaction.APPROVAL_REJECTED:
            action = 'REJECT'
        if not action:
            continue
        entity_code = str(log.entity_code or new_values.get('code') or old_values.get('code') or f'TA-{log.entity_id}')
        comments = str(new_values.get('rejection_reason') or new_values.get('notes') or '').strip()
        label = _approval_audit_label(action)
        summary = f'Phiếu {entity_code} đã {label.lower()}'
        if action == 'APPROVE_L1':
            summary = f'Phiếu {entity_code} đã duyệt cấp 1'
        elif action == 'APPROVE_L2':
            summary = f'Phiếu {entity_code} đã duyệt cấp 2'
        items.append({
            'id': f'finance-{log.id}',
            'domain': 'finance',
            'action': action,
            'action_label': label,
            'entity_id': int(log.entity_id) if log.entity_id is not None else None,
            'entity_code': entity_code,
            'summary': summary,
            'comments': comments,
            'actor_label': _approval_audit_actor_label(log.user),
            'created_at': log.created_at,
            'route': '/advance-transactions',
        })
        if len(items) >= limit:
            break
    return items


def _build_workforce_approval_audit_activity_items(*, cutoff, limit=10):
    from workforce.models import SalaryAdvanceRecord

    items = []
    logs = (
        AuditLog.objects
        .filter(entity_type='WorkforceSalaryAdvanceApproval', created_at__gte=cutoff)
        .select_related('user')
        .order_by('-created_at', '-id')[: max(limit * 4, limit)]
    )
    for log in logs:
        old_values = log.old_values or {}
        new_values = log.new_values or {}
        changed_fields = {str(field) for field in (log.changed_fields or [])}
        old_status = str(old_values.get('approval_status') or '').upper()
        new_status = str(new_values.get('approval_status') or '').upper()
        action = ''
        if new_status == SalaryAdvanceRecord.APPROVAL_PENDING_L1:
            action = 'RESUBMIT' if old_status == SalaryAdvanceRecord.APPROVAL_REJECTED else 'SUBMIT'
        elif new_status == SalaryAdvanceRecord.APPROVAL_PENDING_L2:
            action = 'APPROVE_L1' if 'approved_level1_at' in changed_fields else 'APPROVE'
        elif new_status == SalaryAdvanceRecord.APPROVAL_APPROVED:
            action = 'APPROVE_L2' if 'approved_level2_at' in changed_fields else 'APPROVE'
        elif new_status == SalaryAdvanceRecord.APPROVAL_REJECTED:
            action = 'REJECT'
        if not action:
            continue
        entity_code = str(log.entity_code or new_values.get('code') or f'UL-{log.entity_id}')
        comments = str(new_values.get('rejection_reason') or new_values.get('notes') or '').strip()
        label = _approval_audit_label(action)
        summary = f'Hồ sơ {entity_code} đã {label.lower()}'
        if action == 'APPROVE_L1':
            summary = f'Hồ sơ {entity_code} đã duyệt cấp 1'
        elif action == 'APPROVE_L2':
            summary = f'Hồ sơ {entity_code} đã duyệt cấp 2'
        items.append({
            'id': f'workforce-{log.id}',
            'domain': 'workforce',
            'action': action,
            'action_label': label,
            'entity_id': int(log.entity_id) if log.entity_id is not None else None,
            'entity_code': entity_code,
            'summary': summary,
            'comments': comments,
            'actor_label': _approval_audit_actor_label(log.user),
            'created_at': log.created_at,
            'route': '/salary-advance',
        })
        if len(items) >= limit:
            break
    return items


def _build_generic_approval_history_activity_items(*, entity_types, domain, route_map, cutoff, limit=10):
    items = []
    rows = (
        ApprovalHistory.objects
        .filter(entity_type__in=entity_types, created_at__gte=cutoff)
        .select_related('user')
        .order_by('-created_at', '-id')[: max(limit * 4, limit)]
    )
    for row in rows:
        label = _approval_audit_label(row.action)
        items.append({
            'id': f'{domain}-{row.id}',
            'domain': domain,
            'action': row.action,
            'action_label': label,
            'entity_id': int(row.entity_id) if row.entity_id is not None else None,
            'entity_code': str(row.entity_code or row.entity_id),
            'summary': f'{row.entity_code or row.entity_type} đã {label.lower()}',
            'comments': row.comments or '',
            'actor_label': _approval_audit_actor_label(row.user),
            'created_at': row.created_at,
            'route': route_map.get(row.entity_type) or next(iter(route_map.values())),
        })
        if len(items) >= limit:
            break
    return items


def _initialize_approval_timeline_buckets(days=7):
    total_days = max(int(days or 7), 1)
    today = django_timezone.localdate()
    start_day = today - timedelta(days=total_days - 1)
    buckets = {}
    cursor = start_day
    while cursor <= today:
        buckets[cursor.isoformat()] = {
            'date': cursor.isoformat(),
            'submitted': 0,
            'approved': 0,
            'rejected': 0,
        }
        cursor += timedelta(days=1)
    return buckets


def _bump_approval_timeline_bucket(timeline_buckets, day_value, *, submitted=0, approved=0, rejected=0):
    if not day_value:
        return
    day_key = day_value.isoformat() if hasattr(day_value, 'isoformat') else str(day_value)
    bucket = timeline_buckets.get(day_key)
    if not bucket:
        return
    bucket['submitted'] += int(submitted or 0)
    bucket['approved'] += int(approved or 0)
    bucket['rejected'] += int(rejected or 0)


def _approval_queue_priority_band(priority_score, age_days):
    safe_priority = int(priority_score or 0)
    safe_age = int(age_days or 0)
    if safe_priority >= 88 or safe_age >= 5:
        return 'critical'
    if safe_priority >= 74 or safe_age >= 2:
        return 'high'
    return 'normal'


def _build_approval_queue_row(
    *,
    row_id,
    domain,
    entity_id,
    entity_code,
    title,
    amount_label,
    status_label,
    aging_hint,
    age_days,
    priority_score,
    route,
    status_action,
    is_multilevel=False,
):
    safe_age = int(age_days or 0)
    safe_priority = int(priority_score or 0)
    return {
        'id': str(row_id),
        'domain': str(domain or ''),
        'entity_id': int(entity_id) if entity_id is not None else None,
        'entity_code': str(entity_code or ''),
        'title': str(title or ''),
        'amount_label': str(amount_label or ''),
        'status_label': str(status_label or ''),
        'aging_hint': str(aging_hint or ''),
        'age_days': safe_age,
        'priority_score': safe_priority,
        'priority_band': _approval_queue_priority_band(safe_priority, safe_age),
        'is_multilevel': bool(is_multilevel),
        'route': str(route or ''),
        'status_action': str(status_action or ''),
    }


def _build_approval_queue_summary(queue_rows):
    domain_pending_counts = {
        'finance': 0,
        'workforce': 0,
        'purchasing': 0,
        'production': 0,
    }
    priority_band_counts = {
        'critical': 0,
        'high': 0,
        'normal': 0,
    }
    stale_queue_count = 0
    multi_level_queue_count = 0
    for row in queue_rows:
        domain = str(row.get('domain') or '')
        if domain in domain_pending_counts:
            domain_pending_counts[domain] += 1
        priority_band = str(row.get('priority_band') or 'normal')
        if priority_band in priority_band_counts:
            priority_band_counts[priority_band] += 1
        if int(row.get('age_days') or 0) >= 2:
            stale_queue_count += 1
        if bool(row.get('is_multilevel')):
            multi_level_queue_count += 1
    return {
        'total_pending': len(queue_rows),
        'critical_queue_count': priority_band_counts['critical'],
        'stale_queue_count': stale_queue_count,
        'multi_level_queue_count': multi_level_queue_count,
        'domain_pending_counts': domain_pending_counts,
        'priority_band_counts': priority_band_counts,
    }


def _build_admin_observability_workspace_payload(user, hours=24, incident_limit=12, activity_limit=10):
    can_view_ops = _can_view_operations_log(user)
    can_view_workflow = _can_view_workflow(user)
    can_manage_workflow = _can_manage_workflow(user)
    can_manage_user_directory = _can_manage_user_directory(user)
    can_view_rbac_audit = _can_view_rbac_audit(user)
    can_manage_module_permissions = _can_manage_module_permissions(user)
    can_simulate_scheduler_failure = bool(
        user
        and getattr(user, 'is_authenticated', False)
        and (getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False))
    )

    workflow_section = {
        'job_status': None,
        'health': None,
        'incidents': {'items': [], 'total': 0},
    }
    if can_view_workflow:
        workflow_section = {
            'job_status': _get_workflow_scheduler_job_status_payload(),
            'health': _get_workflow_scheduler_health_payload(hours=hours),
            'incidents': _get_workflow_scheduler_incidents_payload(status_filter='ALL', limit=incident_limit),
        }

    access_exception_section = {
        'summary': None,
        'scheduler_status': None,
        'automation_policy': None,
        'recent_activity': [],
    }
    access_review_section = {'recent_activity': []}
    provisioning_section = {'recent_activity': []}
    offboarding_section = {'recent_activity': []}
    if can_manage_user_directory:
        access_exception_workspace = _build_access_exception_workspace_payload(activity_limit=activity_limit)
        access_review_activity_queryset = AuditLog.objects.filter(
            entity_type__in=['UserAccessReviewCampaign', 'UserAccessReview']
        ).select_related('user')
        provisioning_activity_queryset = AuditLog.objects.filter(entity_type='UserProvisioning').select_related('user')
        offboarding_activity_queryset = AuditLog.objects.filter(entity_type='UserOffboarding').select_related('user')

        access_exception_section = {
            'summary': access_exception_workspace['summary'],
            'scheduler_status': access_exception_workspace['scheduler_status'],
            'automation_policy': access_exception_workspace['automation_policy'],
            'recent_activity': access_exception_workspace['recent_activity'],
        }
        access_review_section = {
            'recent_activity': _build_access_review_activity_items(access_review_activity_queryset, limit=activity_limit),
        }
        provisioning_section = {
            'recent_activity': _build_user_provisioning_activity_items(provisioning_activity_queryset, limit=activity_limit),
        }
        offboarding_section = {
            'recent_activity': _build_user_offboarding_activity_items(offboarding_activity_queryset, limit=activity_limit),
        }

    governance_section = {
        'recent_activity': [],
        'rbac_history_meta': None,
    }
    if can_manage_module_permissions:
        governance_activity_queryset = AuditLog.objects.filter(
            entity_type__in=['Role', 'Team', 'UserAccess', 'RoleModulePermission']
        ).select_related('user')
        governance_section['recent_activity'] = _build_governance_activity_items(
            governance_activity_queryset,
            limit=activity_limit,
        )
    if can_view_rbac_audit:
        governance_section['rbac_history_meta'] = _get_role_module_permission_history_meta_payload()

    def _limit_owner_team_queryset(queryset, *, owner_field='owner', team_field='team_id'):
        if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
            return queryset
        team_ids = []
        try:
            if getattr(user, 'teams', None):
                team_ids = list(user.teams.values_list('id', flat=True))
        except Exception:
            team_ids = []
        owner_lookup = owner_field
        owner_isnull_lookup = f'{owner_field}__isnull'
        if team_ids:
            return queryset.filter(
                models.Q(**{owner_lookup: user})
                | models.Q(**{f'{team_field}__in': team_ids})
                | models.Q(**{owner_isnull_lookup: True})
            )
        return queryset.filter(
            models.Q(**{owner_lookup: user})
            | models.Q(**{owner_isnull_lookup: True})
        )

    business_flows = {
        'finance': None,
        'workforce': None,
        'purchasing': None,
        'production': None,
    }
    approval_audit_domains = []
    approval_audit_recent_activity = []
    approval_audit_queue_rows = []
    approval_timeline_buckets = _initialize_approval_timeline_buckets(days=7)
    approval_cutoff = django_timezone.now() - timedelta(days=7)

    if _can_manage_finance_data(user):
        from finance.models import AdvanceTransaction
        from finance.reminders import build_finance_approval_sla_overview, build_overdue_snapshot

        pending_l1_qs = AdvanceTransaction.objects.filter(
            approval_status=AdvanceTransaction.APPROVAL_PENDING_L1,
            is_active=True,
        ).select_related('submitted_by').order_by('-advance_date', '-id')
        pending_l2_qs = AdvanceTransaction.objects.filter(
            approval_status=AdvanceTransaction.APPROVAL_PENDING_L2,
            is_active=True,
        ).select_related('submitted_by').order_by('-advance_date', '-id')
        queue_items = []
        for adv in list(pending_l1_qs[:6]) + list(pending_l2_qs[:6]):
            queue_items.append({
                'id': int(adv.id),
                'code': adv.code,
                'recipient_name': adv.recipient_name,
                'amount': str(adv.amount),
                'advance_date': adv.advance_date.isoformat() if adv.advance_date else '',
                'approval_status': adv.approval_status,
                'required_approval_level': int(adv.required_approval_level or 1),
            })
            waiting_anchor = adv.submitted_at or adv.advance_date
            waiting_date = waiting_anchor.date() if hasattr(waiting_anchor, 'date') else waiting_anchor
            approval_audit_queue_rows.append(_build_approval_queue_row(
                row_id=f'finance-{adv.id}',
                domain='finance',
                entity_id=adv.id,
                entity_code=adv.code,
                title=adv.recipient_name or adv.code,
                amount_label=str(adv.amount),
                status_label='Chờ duyệt cấp 2' if int(adv.required_approval_level or 1) > 1 else 'Chờ duyệt cấp 1',
                aging_hint=f"Ngày tạm ứng {adv.advance_date.isoformat() if adv.advance_date else '-'}",
                age_days=max((django_timezone.localdate() - waiting_date).days, 0) if waiting_date else 0,
                priority_score=90 if int(adv.required_approval_level or 1) > 1 else 80,
                route='/advance-transactions',
                status_action=adv.approval_status,
                is_multilevel=int(adv.required_approval_level or 1) > 1,
            ))
        business_flows['finance'] = {
            'queue': {
                'pending_l1_count': int(pending_l1_qs.count()),
                'pending_l2_count': int(pending_l2_qs.count()),
                'items': queue_items,
            },
            'sla': build_finance_approval_sla_overview(),
            'overdue_snapshot_90d': build_overdue_snapshot(as_of=django_timezone.localdate(), threshold_days=90),
        }
        approved_qs = AdvanceTransaction.objects.filter(is_active=True).filter(
            models.Q(approved_level2_at__gte=approval_cutoff)
            | models.Q(required_approval_level__lte=1, approved_level1_at__gte=approval_cutoff)
        )
        rejected_qs = AdvanceTransaction.objects.filter(is_active=True, rejected_at__gte=approval_cutoff)
        approval_audit_domains.append({
            'domain': 'finance',
            'label': 'Tài chính',
            'pending_now': int(pending_l1_qs.count() + pending_l2_qs.count()),
            'submitted_7d': int(AdvanceTransaction.objects.filter(is_active=True, submitted_at__gte=approval_cutoff).count()),
            'approved_7d': int(approved_qs.count()),
            'rejected_7d': int(rejected_qs.count()),
            'last_event_at': max(
                [
                    value for value in [
                        AdvanceTransaction.objects.filter(is_active=True).aggregate(ts=models.Max('submitted_at')).get('ts'),
                        AdvanceTransaction.objects.filter(is_active=True).aggregate(ts=models.Max('approved_level1_at')).get('ts'),
                        AdvanceTransaction.objects.filter(is_active=True).aggregate(ts=models.Max('approved_level2_at')).get('ts'),
                        AdvanceTransaction.objects.filter(is_active=True).aggregate(ts=models.Max('rejected_at')).get('ts'),
                    ]
                    if value
                ],
                default=None,
            ),
            'route': '/advance-transactions',
        })
        approval_audit_recent_activity.extend(
            _build_finance_approval_audit_activity_items(cutoff=approval_cutoff, limit=activity_limit)
        )
        for row in (
            AdvanceTransaction.objects
            .filter(is_active=True, submitted_at__gte=approval_cutoff)
            .annotate(day=TruncDate('submitted_at'))
            .values('day')
            .annotate(total=Count('id'))
        ):
            _bump_approval_timeline_bucket(approval_timeline_buckets, row['day'], submitted=row['total'])
        for row in (
            approved_qs
            .annotate(day=TruncDate(Coalesce('approved_level2_at', 'approved_level1_at')))
            .values('day')
            .annotate(total=Count('id'))
        ):
            _bump_approval_timeline_bucket(approval_timeline_buckets, row['day'], approved=row['total'])
        for row in (
            rejected_qs
            .annotate(day=TruncDate('rejected_at'))
            .values('day')
            .annotate(total=Count('id'))
        ):
            _bump_approval_timeline_bucket(approval_timeline_buckets, row['day'], rejected=row['total'])

    if _can_manage_workforce_data(user):
        from workforce.models import SalaryAdvanceRecord
        from workforce.reminders import build_salary_advance_approval_sla_overview

        pending_l1_qs = SalaryAdvanceRecord.objects.filter(
            approval_status=SalaryAdvanceRecord.APPROVAL_PENDING_L1,
            is_active=True,
        ).select_related('employee', 'submitted_by').order_by('-advance_date', '-id')
        pending_l2_qs = SalaryAdvanceRecord.objects.filter(
            approval_status=SalaryAdvanceRecord.APPROVAL_PENDING_L2,
            is_active=True,
        ).select_related('employee', 'submitted_by').order_by('-advance_date', '-id')
        queue_items = []
        for row in list(pending_l1_qs[:6]) + list(pending_l2_qs[:6]):
            queue_items.append({
                'id': int(row.id),
                'employee_code': row.employee.code if row.employee_id else '',
                'employee_name': row.employee.name if row.employee_id else '',
                'amount': str(row.amount),
                'month': row.month,
                'approval_status': row.approval_status,
                'required_approval_level': int(row.required_approval_level or 1),
            })
            waiting_anchor = row.submitted_at or row.advance_date
            waiting_date = waiting_anchor.date() if hasattr(waiting_anchor, 'date') else waiting_anchor
            approval_audit_queue_rows.append(_build_approval_queue_row(
                row_id=f'workforce-{row.id}',
                domain='workforce',
                entity_id=row.id,
                entity_code=row.employee.code if row.employee_id else str(row.id),
                title=row.employee.name if row.employee_id else 'Ứng lương',
                amount_label=str(row.amount),
                status_label='Chờ duyệt L2' if int(row.required_approval_level or 1) > 1 else 'Chờ duyệt L1',
                aging_hint=f'Kỳ lương {row.month}',
                age_days=max((django_timezone.localdate() - waiting_date).days, 0) if waiting_date else 0,
                priority_score=88 if int(row.required_approval_level or 1) > 1 else 76,
                route='/salary-advance',
                status_action=row.approval_status,
                is_multilevel=int(row.required_approval_level or 1) > 1,
            ))
        business_flows['workforce'] = {
            'queue': {
                'pending_l1_count': int(pending_l1_qs.count()),
                'pending_l2_count': int(pending_l2_qs.count()),
                'items': queue_items,
            },
            'sla': build_salary_advance_approval_sla_overview(),
        }
        approved_qs = SalaryAdvanceRecord.objects.filter(is_active=True).filter(
            models.Q(approved_level2_at__gte=approval_cutoff)
            | models.Q(required_approval_level__lte=1, approved_level1_at__gte=approval_cutoff)
        )
        rejected_qs = SalaryAdvanceRecord.objects.filter(is_active=True, rejected_at__gte=approval_cutoff)
        approval_audit_domains.append({
            'domain': 'workforce',
            'label': 'Nhân sự',
            'pending_now': int(pending_l1_qs.count() + pending_l2_qs.count()),
            'submitted_7d': int(SalaryAdvanceRecord.objects.filter(is_active=True, submitted_at__gte=approval_cutoff).count()),
            'approved_7d': int(approved_qs.count()),
            'rejected_7d': int(rejected_qs.count()),
            'last_event_at': max(
                [
                    value for value in [
                        SalaryAdvanceRecord.objects.filter(is_active=True).aggregate(ts=models.Max('submitted_at')).get('ts'),
                        SalaryAdvanceRecord.objects.filter(is_active=True).aggregate(ts=models.Max('approved_level1_at')).get('ts'),
                        SalaryAdvanceRecord.objects.filter(is_active=True).aggregate(ts=models.Max('approved_level2_at')).get('ts'),
                        SalaryAdvanceRecord.objects.filter(is_active=True).aggregate(ts=models.Max('rejected_at')).get('ts'),
                    ]
                    if value
                ],
                default=None,
            ),
            'route': '/salary-advance',
        })
        approval_audit_recent_activity.extend(
            _build_workforce_approval_audit_activity_items(cutoff=approval_cutoff, limit=activity_limit)
        )
        for row in (
            SalaryAdvanceRecord.objects
            .filter(is_active=True, submitted_at__gte=approval_cutoff)
            .annotate(day=TruncDate('submitted_at'))
            .values('day')
            .annotate(total=Count('id'))
        ):
            _bump_approval_timeline_bucket(approval_timeline_buckets, row['day'], submitted=row['total'])
        for row in (
            approved_qs
            .annotate(day=TruncDate(Coalesce('approved_level2_at', 'approved_level1_at')))
            .values('day')
            .annotate(total=Count('id'))
        ):
            _bump_approval_timeline_bucket(approval_timeline_buckets, row['day'], approved=row['total'])
        for row in (
            rejected_qs
            .annotate(day=TruncDate('rejected_at'))
            .values('day')
            .annotate(total=Count('id'))
        ):
            _bump_approval_timeline_bucket(approval_timeline_buckets, row['day'], rejected=row['total'])

    if _can_manage_purchasing_data(user):
        from purchasing.models import PurchaseOrder, PurchaseOrderStatus, PurchaseRequest, PurchaseRequestStatus

        purchase_order_qs = _limit_owner_team_queryset(
            PurchaseOrder.objects.select_related('supplier', 'owner', 'team'),
            owner_field='owner',
            team_field='team_id',
        )
        today = django_timezone.localdate()
        open_receipt_qs = purchase_order_qs.filter(
            status__in=[PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.PARTIAL_RECEIVED],
        )
        open_value = purchase_order_qs.filter(
            status__in=[PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.PARTIAL_RECEIVED],
        ).aggregate(total=models.Sum('total')).get('total') or 0
        purchase_request_qs = PurchaseRequest.objects.select_related('requested_by')

        business_flows['purchasing'] = {
            'order_summary': {
                'total_orders': int(purchase_order_qs.count()),
                'draft_count': int(purchase_order_qs.filter(status=PurchaseOrderStatus.DRAFT).count()),
                'submitted_count': int(purchase_order_qs.filter(status=PurchaseOrderStatus.SUBMITTED).count()),
                'approved_count': int(purchase_order_qs.filter(status=PurchaseOrderStatus.APPROVED).count()),
                'partial_received_count': int(purchase_order_qs.filter(status=PurchaseOrderStatus.PARTIAL_RECEIVED).count()),
                'received_count': int(purchase_order_qs.filter(status=PurchaseOrderStatus.RECEIVED).count()),
                'cancelled_count': int(purchase_order_qs.filter(status=PurchaseOrderStatus.CANCELLED).count()),
                'pending_approval_count': int(purchase_order_qs.filter(status=PurchaseOrderStatus.SUBMITTED).count()),
                'waiting_receipt_count': int(open_receipt_qs.count()),
                'overdue_receipt_count': int(open_receipt_qs.filter(expected_receipt_date__lt=today).count()),
                'open_value': str(open_value),
            },
            'request_summary': {
                'total_requests': int(purchase_request_qs.count()),
                'draft_count': int(purchase_request_qs.filter(status=PurchaseRequestStatus.DRAFT).count()),
                'submitted_count': int(purchase_request_qs.filter(status=PurchaseRequestStatus.SUBMITTED).count()),
                'approved_count': int(purchase_request_qs.filter(status=PurchaseRequestStatus.APPROVED).count()),
                'rejected_count': int(purchase_request_qs.filter(status=PurchaseRequestStatus.REJECTED).count()),
            },
            'recent_orders': [
                {
                    'id': int(order.id),
                    'code': order.code,
                    'status': order.status,
                    'supplier_name': order.supplier.name if order.supplier_id else '',
                    'expected_receipt_date': order.expected_receipt_date.isoformat() if order.expected_receipt_date else None,
                    'total': str(order.total),
                    'owner_name': order.owner.get_full_name() or order.owner.username if order.owner_id else '',
                }
                for order in purchase_order_qs.order_by('-order_date', '-id')[:5]
            ],
            'recent_requests': [
                {
                    'id': int(request_row.id),
                    'code': request_row.code,
                    'status': request_row.status,
                    'request_date': request_row.request_date.isoformat() if request_row.request_date else None,
                    'requester_name': request_row.requested_by.get_full_name() or request_row.requested_by.username if request_row.requested_by_id else '',
                    'line_count': int(request_row.lines.count()),
                }
                for request_row in purchase_request_qs.prefetch_related('lines').order_by('-request_date', '-id')[:5]
            ],
        }
        for order in purchase_order_qs.filter(status=PurchaseOrderStatus.SUBMITTED).order_by('order_date', 'id')[:6]:
            waiting_date = order.order_date or order.created_at.date()
            approval_audit_queue_rows.append(_build_approval_queue_row(
                row_id=f'purchase-order-{order.id}',
                domain='purchasing',
                entity_id=order.id,
                entity_code=order.code,
                title=order.supplier.name if order.supplier_id else 'Đơn mua chờ duyệt',
                amount_label=str(order.total),
                status_label='Đơn mua chờ duyệt',
                aging_hint=f"Hạn nhận {order.expected_receipt_date.isoformat() if order.expected_receipt_date else '-'}",
                age_days=max((django_timezone.localdate() - waiting_date).days, 0) if waiting_date else 0,
                priority_score=74,
                route='/purchase-orders',
                status_action=order.status,
            ))
        for request_row in purchase_request_qs.filter(status=PurchaseRequestStatus.SUBMITTED).order_by('request_date', 'id')[:6]:
            waiting_date = request_row.request_date or request_row.created_at.date()
            approval_audit_queue_rows.append(_build_approval_queue_row(
                row_id=f'purchase-request-{request_row.id}',
                domain='purchasing',
                entity_id=request_row.id,
                entity_code=request_row.code,
                title=request_row.requested_by.get_full_name() or request_row.requested_by.username if request_row.requested_by_id else 'Yêu cầu mua',
                amount_label=str(request_row.lines.count()),
                status_label='Yêu cầu mua chờ duyệt',
                aging_hint=f"Ngày tạo {request_row.request_date.isoformat() if request_row.request_date else '-'}",
                age_days=max((django_timezone.localdate() - waiting_date).days, 0) if waiting_date else 0,
                priority_score=70,
                route='/purchase-requests',
                status_action=request_row.status,
            ))
        approval_queryset = ApprovalHistory.objects.filter(
            entity_type__in=['PurchaseOrder', 'PurchaseRequest'],
            created_at__gte=approval_cutoff,
        )
        last_event_at = approval_queryset.aggregate(ts=models.Max('created_at')).get('ts')
        approval_audit_domains.append({
            'domain': 'purchasing',
            'label': 'Mua hàng',
            'pending_now': int(
                business_flows['purchasing']['order_summary']['pending_approval_count']
                + business_flows['purchasing']['request_summary']['submitted_count']
            ),
            'submitted_7d': int(approval_queryset.filter(action__in=['SUBMIT', 'RESUBMIT']).count()),
            'approved_7d': int(approval_queryset.filter(action='APPROVE').count()),
            'rejected_7d': int(approval_queryset.filter(action='REJECT').count()),
            'last_event_at': last_event_at,
            'route': '/purchase-requests',
        })
        approval_audit_recent_activity.extend(
            _build_generic_approval_history_activity_items(
                entity_types=['PurchaseOrder', 'PurchaseRequest'],
                domain='purchasing',
                route_map={
                    'PurchaseOrder': '/purchase-orders',
                    'PurchaseRequest': '/purchase-requests',
                },
                cutoff=approval_cutoff,
                limit=activity_limit,
            )
        )
        for row in (
            approval_queryset
            .annotate(day=TruncDate('created_at'))
            .values('day', 'action')
            .annotate(total=Count('id'))
        ):
            action = str(row['action'] or '').upper()
            _bump_approval_timeline_bucket(
                approval_timeline_buckets,
                row['day'],
                submitted=row['total'] if action in {'SUBMIT', 'RESUBMIT'} else 0,
                approved=row['total'] if action.startswith('APPROVE') else 0,
                rejected=row['total'] if action == 'REJECT' else 0,
            )

    if _can_manage_production_data(user):
        from production.models import ProductionOperation, ProductionOperationStatus, ProductionOrder, ProductionOrderStatus

        production_qs = _limit_owner_team_queryset(
            ProductionOrder.objects.select_related('product', 'owner', 'team'),
            owner_field='owner',
            team_field='team_id',
        )
        today = django_timezone.localdate()
        active_qs = production_qs.filter(status__in=[ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS])
        planned_total_active = Decimal(str(active_qs.aggregate(total=models.Sum('planned_qty')).get('total') or 0))
        produced_total_active = Decimal(str(active_qs.aggregate(total=models.Sum('produced_qty')).get('total') or 0))
        ready_operation_count = ProductionOperation.objects.filter(
            production_order_id__in=active_qs.values('id'),
            status=ProductionOperationStatus.READY,
        ).count()

        business_flows['production'] = {
            'order_summary': {
                'total_orders': int(production_qs.count()),
                'draft_count': int(production_qs.filter(status=ProductionOrderStatus.DRAFT).count()),
                'submitted_count': int(production_qs.filter(status=ProductionOrderStatus.SUBMITTED).count()),
                'approved_count': int(production_qs.filter(status=ProductionOrderStatus.APPROVED).count()),
                'released_count': int(production_qs.filter(status=ProductionOrderStatus.RELEASED).count()),
                'in_progress_count': int(production_qs.filter(status=ProductionOrderStatus.IN_PROGRESS).count()),
                'completed_count': int(production_qs.filter(status=ProductionOrderStatus.COMPLETED).count()),
                'cancelled_count': int(production_qs.filter(status=ProductionOrderStatus.CANCELLED).count()),
                'pending_approval_count': int(production_qs.filter(status=ProductionOrderStatus.SUBMITTED).count()),
                'active_count': int(active_qs.count()),
                'overdue_plan_count': int(
                    production_qs.filter(
                        status__in=[ProductionOrderStatus.APPROVED, ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS],
                        planned_end_date__lt=today,
                    ).count()
                ),
                'active_remaining_qty': str(
                    planned_total_active - produced_total_active if planned_total_active > produced_total_active else Decimal('0')
                ),
                'ready_operation_count': int(ready_operation_count),
            },
            'recent_orders': [
                {
                    'id': int(order.id),
                    'code': order.code,
                    'status': order.status,
                    'product_name': order.product.name if order.product_id else '',
                    'planned_end_date': order.planned_end_date.isoformat() if order.planned_end_date else None,
                    'planned_qty': str(order.planned_qty),
                    'produced_qty': str(order.produced_qty),
                    'owner_name': order.owner.get_full_name() or order.owner.username if order.owner_id else '',
                }
                for order in production_qs.order_by('-order_date', '-id')[:5]
            ],
        }
        for order in production_qs.filter(status=ProductionOrderStatus.SUBMITTED).order_by('order_date', 'id')[:6]:
            waiting_date = order.order_date or order.created_at.date()
            approval_audit_queue_rows.append(_build_approval_queue_row(
                row_id=f'production-{order.id}',
                domain='production',
                entity_id=order.id,
                entity_code=order.code,
                title=order.product.name if order.product_id else (order.product_code or 'Lệnh sản xuất'),
                amount_label=str(order.planned_qty),
                status_label='Lệnh sản xuất chờ duyệt',
                aging_hint=f"Hạn kế hoạch {order.planned_end_date.isoformat() if order.planned_end_date else '-'}",
                age_days=max((django_timezone.localdate() - waiting_date).days, 0) if waiting_date else 0,
                priority_score=72,
                route='/production-orders',
                status_action=order.status,
            ))
        approval_queryset = ApprovalHistory.objects.filter(
            entity_type='ProductionOrder',
            created_at__gte=approval_cutoff,
        )
        approval_audit_domains.append({
            'domain': 'production',
            'label': 'Sản xuất',
            'pending_now': int(business_flows['production']['order_summary']['pending_approval_count']),
            'submitted_7d': int(approval_queryset.filter(action__in=['SUBMIT', 'RESUBMIT']).count()),
            'approved_7d': int(approval_queryset.filter(action='APPROVE').count()),
            'rejected_7d': int(approval_queryset.filter(action='REJECT').count()),
            'last_event_at': approval_queryset.aggregate(ts=models.Max('created_at')).get('ts'),
            'route': '/production-orders',
        })
        approval_audit_recent_activity.extend(
            _build_generic_approval_history_activity_items(
                entity_types=['ProductionOrder'],
                domain='production',
                route_map={'ProductionOrder': '/production-orders'},
                cutoff=approval_cutoff,
                limit=activity_limit,
            )
        )
        for row in (
            approval_queryset
            .annotate(day=TruncDate('created_at'))
            .values('day', 'action')
            .annotate(total=Count('id'))
        ):
            action = str(row['action'] or '').upper()
            _bump_approval_timeline_bucket(
                approval_timeline_buckets,
                row['day'],
                submitted=row['total'] if action in {'SUBMIT', 'RESUBMIT'} else 0,
                approved=row['total'] if action.startswith('APPROVE') else 0,
                rejected=row['total'] if action == 'REJECT' else 0,
            )

    approval_audit_recent_activity = sorted(
        approval_audit_recent_activity,
        key=lambda item: parse_datetime(str(item['created_at'])) if isinstance(item.get('created_at'), str) else item.get('created_at') or django_timezone.make_aware(datetime.min),
        reverse=True,
    )[: max(activity_limit * 2, activity_limit)]
    approval_audit_queue_rows = sorted(
        approval_audit_queue_rows,
        key=lambda item: (int(item.get('priority_score') or 0), int(item.get('age_days') or 0)),
        reverse=True,
    )
    approval_audit_queue_summary = _build_approval_queue_summary(approval_audit_queue_rows)
    approval_audit_hot_items = approval_audit_queue_rows[:12]
    approval_audit_queue_rows = approval_audit_queue_rows[:24]
    audit_spotlight = _build_admin_audit_workspace_payload(
        user,
        hours=max(hours, 24),
        limit=max(activity_limit * 2, 12),
    )

    return {
        'capabilities': {
            'can_view_operations_log': can_view_ops,
            'can_view_workflow': can_view_workflow,
            'can_manage_workflow': can_manage_workflow,
            'can_simulate_scheduler_failure': can_simulate_scheduler_failure,
            'can_manage_user_directory': can_manage_user_directory,
            'can_view_rbac_audit': can_view_rbac_audit,
            'can_manage_module_permissions': can_manage_module_permissions,
        },
        'health': _compose_health(include_extended=True),
        'monitoring': _get_admin_monitoring_payload(hours=hours),
        'workflow': workflow_section,
        'access_exception': access_exception_section,
        'access_review': access_review_section,
        'provisioning': provisioning_section,
        'offboarding': offboarding_section,
        'governance': governance_section,
        'business_flows': business_flows,
        'approval_audit': {
            'domains': approval_audit_domains,
            'recent_activity': approval_audit_recent_activity,
            'hot_items': approval_audit_hot_items,
            'queue_rows': approval_audit_queue_rows,
            'queue_summary': approval_audit_queue_summary,
            'timeline_7d': list(approval_timeline_buckets.values()),
        },
        'audit_spotlight': audit_spotlight,
        'generated_at': django_timezone.now(),
    }


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer

    def get_permissions(self):
        if self.action in {
            'me', 'change_password', 'account_hub', 'activity_feed',
            'list', 'access_surface_matrix',
            'directory', 'directory_summary', 'access_activity', 'access_profile', 'bulk_access', 'bulk_activate', 'bulk_lock',
            'onboarding_studio', 'onboarding_presets', 'onboarding_presets_delete', 'onboarding_preview', 'apply_onboarding_preset', 'onboarding_activity',
            'access_review_workspace', 'access_review_campaigns', 'access_review_campaigns_delete', 'access_review_preview', 'apply_access_review', 'access_review_activity',
            'access_exception_workspace', 'access_exception_routing_rules', 'access_exception_approver_availability', 'access_exception_policies', 'access_exception_policies_delete', 'access_exception_preview',
            'access_exception_requests', 'access_exception_renewals', 'access_exception_decide', 'access_exception_reroute', 'access_exception_revoke',
            'access_exception_activity', 'access_exception_automation_policy', 'access_exception_automation_preview',
            'access_exception_run_automation', 'access_exception_scheduler_status', 'access_exception_absence_simulation', 'access_exception_guided_remediation',
            'save_access_exception_automation_policy', 'save_access_exception_scheduler_status',
            'admin_observability_workspace', 'admin_observability_alert_drill', 'admin_observability_go_live_handoff',
            'admin_observability_alert_readiness',
            'admin_observability_release_cleanup_preview', 'admin_observability_release_lockfile', 'admin_observability_performance_drilldown',
            'admin_audit_workspace', 'admin_audit_retention_preview', 'admin_audit_export',
            'access_governance_surface_audit',
            'provisioning_workspace', 'provisioning_preview', 'provision_user', 'provisioning_activity',
            'offboarding_workspace', 'offboarding_preview', 'offboard_user', 'offboarding_activity',
        }:
            return [IsAuthenticated()]
        return [IsAdminUser()]

    def get_serializer_class(self):
        if self.action == 'list':
            return UserMentionSerializer
        return super().get_serializer_class()

    def _ensure_manage_user_directory_permission(self, user):
        if not _can_manage_user_directory(user):
            raise PermissionDenied('Ban khong co quyen quan tri nguoi dung.')

    def _base_user_queryset(self):
        return User.objects.prefetch_related('roles', 'teams').all()

    def _get_directory_user_instance(self, user_id):
        return (
            _annotate_user_directory_queryset(self._base_user_queryset())
            .filter(pk=user_id)
            .first()
        )

    def _apply_common_user_filters(self, queryset):
        search = (self.request.query_params.get('search') or self.request.query_params.get('q') or '').strip()
        if search:
            queryset = queryset.filter(
                models.Q(username__icontains=search)
                | models.Q(first_name__icontains=search)
                | models.Q(last_name__icontains=search)
                | models.Q(email__icontains=search)
                | models.Q(phone__icontains=search)
            )
        role_id = self.request.query_params.get('role')
        if role_id:
            queryset = queryset.filter(roles__id=role_id)
        team_id = self.request.query_params.get('team')
        if team_id:
            queryset = queryset.filter(teams__id=team_id)
        is_active = _parse_query_bool(self.request.query_params.get('is_active'))
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active)
        return queryset.distinct()

    def get_queryset(self):
        queryset = self._base_user_queryset().order_by('first_name', 'last_name', 'username')
        return self._apply_common_user_filters(queryset)

    def _get_directory_queryset(self):
        queryset = _annotate_user_directory_queryset(self._base_user_queryset())
        queryset = self._apply_common_user_filters(queryset)

        is_locked = _parse_query_bool(self.request.query_params.get('is_locked'))
        if is_locked is not None:
            queryset = queryset.filter(is_locked=is_locked)

        session_state = str(self.request.query_params.get('session_state') or '').strip().lower()
        if session_state == 'online':
            queryset = queryset.filter(active_session_count__gt=0)
        elif session_state == 'offline':
            queryset = queryset.filter(active_session_count=0)

        dormant_cutoff = django_timezone.now() - timedelta(days=30)
        attention = str(self.request.query_params.get('attention') or '').strip().lower()
        if attention == 'locked':
            queryset = queryset.filter(is_locked=True)
        elif attention == 'inactive':
            queryset = queryset.filter(is_active=False)
        elif attention == 'unassigned':
            queryset = queryset.filter(models.Q(roles__isnull=True) | models.Q(teams__isnull=True))
        elif attention == 'dormant':
            queryset = queryset.filter(models.Q(last_seen_at__isnull=True) | models.Q(last_seen_at__lt=dormant_cutoff))
        elif attention == 'review':
            queryset = queryset.filter(
                models.Q(is_locked=True)
                | models.Q(is_active=False)
                | models.Q(roles__isnull=True)
                | models.Q(teams__isnull=True)
                | models.Q(last_seen_at__isnull=True)
                | models.Q(last_seen_at__lt=dormant_cutoff)
            )

        return queryset.order_by('-is_locked', 'is_active', '-active_session_count', 'first_name', 'last_name', 'username').distinct()

    @action(detail=False, methods=['get', 'patch'], url_path='me')
    def me(self, request):
        if request.method == 'PATCH':
            update_serializer = CurrentUserUpdateSerializer(
                request.user,
                data=request.data,
                partial=True,
                context={'request': request},
            )
            update_serializer.is_valid(raise_exception=True)
            update_serializer.save()

        serializer = self.get_serializer(request.user, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def change_password(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={'user': request.user})
        serializer.is_valid(raise_exception=True)

        current_password = serializer.validated_data['current_password']
        if not request.user.check_password(current_password):
            return Response(
                {'current_password': ['Mật khẩu hiện tại không đúng.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        new_password = serializer.validated_data['new_password']
        validate_password(new_password, user=request.user)
        request.user.set_password(new_password)
        request.user.save(update_fields=['password'])

        current_session_id = _get_current_session_identifier(request)
        revoked_count = 0
        session_qs = UserSession.objects.filter(user=request.user, is_active=True)
        if current_session_id:
            revoked_count = session_qs.exclude(session_key=str(current_session_id)).update(
                is_active=False,
                logout_at=django_timezone.now(),
            )
        else:
            revoked_count = session_qs.update(
                is_active=False,
                logout_at=django_timezone.now(),
            )

        return Response({'success': True, 'revoked_sessions': revoked_count})

    @action(detail=False, methods=['get'], url_path='account_hub')
    def account_hub(self, request):
        user = (
            User.objects
            .prefetch_related('teams', 'roles__permissions')
            .get(pk=request.user.pk)
        )
        current_session_id = _get_current_session_identifier(request)
        current_session = None
        if current_session_id:
            current_session = (
                UserSession.objects
                .filter(user=user, session_key=str(current_session_id))
                .order_by('-is_active', '-last_active')
                .first()
            )
        data = {
            'profile_completion': _get_profile_completion(user),
            'security': _get_security_summary(user, current_session=current_session),
            'work_summary': _get_work_summary(user),
            'notification_summary': _get_notification_summary(user),
            'access_summary': _get_access_summary(user),
            'activity_preview': _build_account_activity_items(user, limit=8, kind='all'),
        }
        return Response(data)

    @action(detail=False, methods=['get'], url_path='activity_feed')
    def activity_feed(self, request):
        try:
            limit = int(request.query_params.get('limit') or 20)
        except (TypeError, ValueError):
            return Response({'error': 'limit phai la so nguyen.'}, status=status.HTTP_400_BAD_REQUEST)
        kind = request.query_params.get('kind') or 'all'
        items = _build_account_activity_items(request.user, limit=limit, kind=kind)
        return Response({
            'items': items,
            'total': len(items),
            'kind': str(kind or 'all').strip().lower(),
        })

    @action(detail=False, methods=['get'], url_path='access_surface_matrix')
    def access_surface_matrix(self, request):
        target_user = request.user
        target_user_id = request.query_params.get('user_id')
        if target_user_id not in (None, ''):
            try:
                target_user_id_int = int(target_user_id)
            except (TypeError, ValueError):
                return Response({'error': 'user_id khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
            if target_user_id_int != request.user.id:
                self._ensure_manage_user_directory_permission(request.user)
            target_user = self._base_user_queryset().filter(pk=target_user_id_int).first()
            if target_user is None:
                return Response({'error': 'Khong tim thay nguoi dung.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(_build_access_surface_matrix_payload(target_user))

    @action(detail=False, methods=['get'], url_path='directory')
    def directory(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        queryset = self._get_directory_queryset()
        page = self.paginate_queryset(queryset)
        serializer = UserDirectorySerializer(page if page is not None else queryset, many=True, context={'request': request})
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='directory_summary')
    def directory_summary(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        queryset = self._get_directory_queryset()
        dormant_cutoff = django_timezone.now() - timedelta(days=30)
        attention_query = (
            models.Q(is_locked=True)
            | models.Q(is_active=False)
            | models.Q(roles__isnull=True)
            | models.Q(teams__isnull=True)
            | models.Q(last_seen_at__isnull=True)
            | models.Q(last_seen_at__lt=dormant_cutoff)
        )

        totals = queryset.aggregate(
            total_users=Count('id', distinct=True),
            active_users=Count('id', filter=models.Q(is_active=True), distinct=True),
            inactive_users=Count('id', filter=models.Q(is_active=False), distinct=True),
            locked_users=Count('id', filter=models.Q(is_locked=True), distinct=True),
            staff_users=Count('id', filter=models.Q(is_staff=True), distinct=True),
            online_users=Count('id', filter=models.Q(active_session_count__gt=0), distinct=True),
            dormant_users=Count(
                'id',
                filter=models.Q(last_seen_at__isnull=True) | models.Q(last_seen_at__lt=dormant_cutoff),
                distinct=True,
            ),
            without_role_users=Count('id', filter=models.Q(roles__isnull=True), distinct=True),
            without_team_users=Count('id', filter=models.Q(teams__isnull=True), distinct=True),
            attention_users=Count('id', filter=attention_query, distinct=True),
        )

        role_breakdown = list(
            Role.objects
            .filter(users__in=queryset, deleted_at__isnull=True)
            .annotate(user_count=Count('users', filter=models.Q(users__in=queryset), distinct=True))
            .filter(user_count__gt=0)
            .order_by('-user_count', 'name', 'code')
            .values('id', 'code', 'name', 'user_count')[:6]
        )
        team_breakdown = list(
            Team.objects
            .filter(users__in=queryset, deleted_at__isnull=True)
            .annotate(user_count=Count('users', filter=models.Q(users__in=queryset), distinct=True))
            .filter(user_count__gt=0)
            .order_by('-user_count', 'name', 'code')
            .values('id', 'code', 'name', 'user_count')[:6]
        )
        focus_items = _build_user_directory_attention_preview(queryset.filter(attention_query), limit=6)

        return Response({
            **totals,
            'role_breakdown': role_breakdown,
            'team_breakdown': team_breakdown,
            'focus_items': focus_items,
        })

    @action(detail=False, methods=['get'], url_path='access_activity')
    def access_activity(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        try:
            limit = int(request.query_params.get('limit') or 10)
        except (TypeError, ValueError):
            return Response({'error': 'limit phai la so nguyen.'}, status=status.HTTP_400_BAD_REQUEST)

        queryset = AuditLog.objects.filter(entity_type='UserAccess').select_related('user')
        user_id_raw = request.query_params.get('user_id')
        if user_id_raw not in (None, ''):
            try:
                user_id = int(user_id_raw)
            except (TypeError, ValueError):
                return Response({'error': 'user_id khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
            queryset = queryset.filter(entity_id=user_id)

        total = queryset.count()
        items = _build_user_access_activity_items(queryset, limit=limit)
        return Response({
            'items': items,
            'total': total,
        })

    @action(detail=True, methods=['post'], url_path='access_profile')
    def access_profile(self, request, pk=None):
        self._ensure_manage_user_directory_permission(request.user)
        try:
            target_user = self._base_user_queryset().get(pk=pk)
        except User.DoesNotExist:
            return Response({'error': 'Khong tim thay nguoi dung.'}, status=status.HTTP_404_NOT_FOUND)

        if target_user.id == request.user.id:
            return Response({'error': 'Khong the tu thay doi vai tro hoac nhom cua chinh minh qua command center.'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = AdminUserAccessUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        role_ids_provided = 'role_ids' in request.data
        team_ids_provided = 'team_ids' in request.data
        validated = serializer.validated_data

        old_snapshot = _build_user_access_snapshot(target_user)
        changed_fields = []

        with transaction.atomic():
            if role_ids_provided:
                next_role_ids = validated.get('role_ids', [])
                if next_role_ids != old_snapshot['role_ids']:
                    target_user.roles.set(next_role_ids)
                    changed_fields.append('roles')
            if team_ids_provided:
                next_team_ids = validated.get('team_ids', [])
                if next_team_ids != old_snapshot['team_ids']:
                    target_user.teams.set(next_team_ids)
                    changed_fields.append('teams')

        updated_user = self._get_directory_user_instance(target_user.id)
        if updated_user is None:
            return Response({'error': 'Khong tim thay nguoi dung sau khi cap nhat.'}, status=status.HTTP_404_NOT_FOUND)
        new_snapshot = _build_user_access_snapshot(updated_user)

        if changed_fields:
            _create_user_access_audit_log(
                request=request,
                actor=request.user,
                target_user=updated_user,
                old_snapshot=old_snapshot,
                new_snapshot=new_snapshot,
                changed_fields=changed_fields,
                strategy='replace',
            )

        return Response({
            'success': True,
            'changed_fields': changed_fields,
            'user': UserDirectorySerializer(updated_user, context={'request': request}).data,
            'access_snapshot': new_snapshot,
        })

    @action(detail=False, methods=['post'], url_path='bulk_access')
    def bulk_access(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = BulkUserAccessUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        validated = serializer.validated_data
        role_ids_provided = 'role_ids' in request.data
        team_ids_provided = 'team_ids' in request.data
        strategy = validated.get('strategy') or 'add'
        ids = validated['ids']
        target_ids = [value for value in ids if value != request.user.id]
        skipped_self = len(ids) - len(target_ids)
        if not target_ids:
            return Response({'success': True, 'count': 0, 'skipped_self': skipped_self, 'strategy': strategy})

        users = list(self._base_user_queryset().filter(id__in=target_ids))
        if not users:
            return Response({'success': True, 'count': 0, 'skipped_self': skipped_self, 'strategy': strategy})

        role_ids_input = validated.get('role_ids', [])
        team_ids_input = validated.get('team_ids', [])
        updated_count = 0

        with transaction.atomic():
            for user in users:
                old_snapshot = _build_user_access_snapshot(user)
                changed_fields = []

                if role_ids_provided:
                    current_role_ids = set(old_snapshot['role_ids'])
                    incoming_role_ids = set(role_ids_input)
                    if strategy == 'add':
                        next_role_ids = sorted(current_role_ids | incoming_role_ids)
                    elif strategy == 'remove':
                        next_role_ids = sorted(current_role_ids - incoming_role_ids)
                    else:
                        next_role_ids = sorted(incoming_role_ids)
                    if next_role_ids != old_snapshot['role_ids']:
                        user.roles.set(next_role_ids)
                        changed_fields.append('roles')

                if team_ids_provided:
                    current_team_ids = set(old_snapshot['team_ids'])
                    incoming_team_ids = set(team_ids_input)
                    if strategy == 'add':
                        next_team_ids = sorted(current_team_ids | incoming_team_ids)
                    elif strategy == 'remove':
                        next_team_ids = sorted(current_team_ids - incoming_team_ids)
                    else:
                        next_team_ids = sorted(incoming_team_ids)
                    if next_team_ids != old_snapshot['team_ids']:
                        user.teams.set(next_team_ids)
                        changed_fields.append('teams')

                if not changed_fields:
                    continue

                refreshed_user = self._base_user_queryset().get(pk=user.id)
                new_snapshot = _build_user_access_snapshot(refreshed_user)
                _create_user_access_audit_log(
                    request=request,
                    actor=request.user,
                    target_user=refreshed_user,
                    old_snapshot=old_snapshot,
                    new_snapshot=new_snapshot,
                    changed_fields=changed_fields,
                    strategy=strategy,
                )
                updated_count += 1

        return Response({
            'success': True,
            'count': updated_count,
            'skipped_self': skipped_self,
            'strategy': strategy,
        })

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        """Bulk activate/deactivate users"""
        self._ensure_manage_user_directory_permission(request.user)
        raw_ids = request.data.get('ids', [])
        is_active = _parse_query_bool(request.data.get('is_active'))
        if is_active is None:
            is_active = bool(request.data.get('is_active', True))
        try:
            ids = sorted({int(value) for value in raw_ids if str(value).strip()})
        except (TypeError, ValueError):
            return Response({"error": "Danh sach IDs khong hop le"}, status=400)
        if not ids:
            return Response({"error": "No IDs provided"}, status=400)
        target_ids = [value for value in ids if value != request.user.id]
        skipped_self = len(ids) - len(target_ids)
        count = 0
        if target_ids:
            count = User.objects.filter(id__in=target_ids).update(is_active=is_active)
        return Response({"success": True, "count": count, "skipped_self": skipped_self})

    @action(detail=False, methods=['post'])
    def bulk_lock(self, request):
        """Bulk lock/unlock users"""
        self._ensure_manage_user_directory_permission(request.user)
        raw_ids = request.data.get('ids', [])
        is_locked = _parse_query_bool(request.data.get('is_locked'))
        if is_locked is None:
            is_locked = bool(request.data.get('is_locked', True))
        try:
            ids = sorted({int(value) for value in raw_ids if str(value).strip()})
        except (TypeError, ValueError):
            return Response({"error": "Danh sach IDs khong hop le"}, status=400)
        if not ids:
            return Response({"error": "No IDs provided"}, status=400)
        target_ids = [value for value in ids if value != request.user.id]
        skipped_self = len(ids) - len(target_ids)
        count = 0
        if target_ids:
            lock_changed_at = django_timezone.now()
            update_payload = {
                'is_locked': is_locked,
                'locked_at': lock_changed_at if is_locked else None,
                'locked_by': request.user if is_locked else None,
            }
            count = User.objects.filter(id__in=target_ids).update(**update_payload)
            if is_locked:
                UserSession.objects.filter(user_id__in=target_ids, is_active=True).update(
                    is_active=False,
                    logout_at=lock_changed_at,
                )
        return Response({"success": True, "count": count, "skipped_self": skipped_self})

    @action(detail=False, methods=['get'], url_path='onboarding_studio')
    def onboarding_studio(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        preset_rows = _build_onboarding_preset_rows(_load_onboarding_presets())
        activity_queryset = AuditLog.objects.filter(entity_type__in=['UserOnboardingPreset', 'UserOnboarding']).select_related('user')
        return Response({
            'summary': _build_onboarding_studio_summary(preset_rows),
            'presets': preset_rows,
            'watchlist': _build_onboarding_watchlist(preset_rows),
            'notification_type_options': _build_onboarding_notification_type_options(),
            'recent_activity': _build_onboarding_activity_items(activity_queryset, limit=8),
        })

    @action(detail=False, methods=['post'], url_path='onboarding_presets')
    def onboarding_presets(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = OnboardingPresetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        preset_payload = _serialize_onboarding_preset_storage(serializer.validated_data)
        existing_presets = _load_onboarding_presets()
        previous_preset = next((item for item in existing_presets if item.get('key') == preset_payload['key']), None)
        next_presets = [item for item in existing_presets if item.get('key') != preset_payload['key']]
        next_presets.append(preset_payload)
        saved_presets = _save_onboarding_presets(next_presets)
        saved_preset = next((item for item in saved_presets if item.get('key') == preset_payload['key']), preset_payload)
        changed_fields = _get_snapshot_changed_fields(previous_preset or {}, saved_preset)
        action_name = 'UPDATE' if previous_preset else 'CREATE'
        _create_onboarding_audit_log(
            request=request,
            actor=request.user,
            action=action_name,
            entity_type='UserOnboardingPreset',
            entity_id=_get_onboarding_preset_entity_id(saved_preset['key']),
            entity_id_str=saved_preset['key'],
            entity_code=saved_preset['key'],
            old_values=previous_preset or {},
            new_values=saved_preset,
            changed_fields=changed_fields or list(saved_preset.keys()),
        )
        enriched_preset = next(
            (item for item in _build_onboarding_preset_rows(saved_presets) if item.get('key') == saved_preset['key']),
            saved_preset,
        )
        return Response({
            'success': True,
            'preset': enriched_preset,
            'action': action_name,
        }, status=status.HTTP_201_CREATED if action_name == 'CREATE' else status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='onboarding_presets_delete')
    def onboarding_presets_delete(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        preset_key = str(request.data.get('key') or '').strip().lower()
        if not preset_key:
            return Response({'error': 'Can cung cap key cua preset.'}, status=status.HTTP_400_BAD_REQUEST)
        existing_presets = _load_onboarding_presets()
        previous_preset = next((item for item in existing_presets if item.get('key') == preset_key), None)
        if previous_preset is None:
            return Response({'error': 'Khong tim thay preset.'}, status=status.HTTP_404_NOT_FOUND)
        next_presets = [item for item in existing_presets if item.get('key') != preset_key]
        _save_onboarding_presets(next_presets)
        _create_onboarding_audit_log(
            request=request,
            actor=request.user,
            action='DELETE',
            entity_type='UserOnboardingPreset',
            entity_id=_get_onboarding_preset_entity_id(preset_key),
            entity_id_str=preset_key,
            entity_code=preset_key,
            old_values=previous_preset,
            new_values={},
            changed_fields=list(previous_preset.keys()),
        )
        return Response({'success': True, 'key': preset_key})

    @action(detail=False, methods=['post'], url_path='onboarding_preview')
    def onboarding_preview(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = OnboardingPresetPreviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        preset_key = validated['preset_key']
        preset = next((item for item in _load_onboarding_presets() if item.get('key') == preset_key), None)
        if preset is None:
            return Response({'error': 'Khong tim thay preset.'}, status=status.HTTP_404_NOT_FOUND)
        user_id = validated.get('user_id')
        if not user_id:
            return Response({'error': 'Can chon nguoi dung de preview.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            target_user = self._base_user_queryset().get(pk=user_id)
        except User.DoesNotExist:
            return Response({'error': 'Khong tim thay nguoi dung.'}, status=status.HTTP_404_NOT_FOUND)

        access_strategy = str(validated.get('access_strategy') or preset.get('access_strategy') or 'merge')
        current_access = _build_user_access_snapshot(target_user)
        next_role_ids = _resolve_onboarding_access_ids(current_access['role_ids'], preset.get('role_ids', []), access_strategy)
        next_team_ids = _resolve_onboarding_access_ids(current_access['team_ids'], preset.get('team_ids', []), access_strategy)
        roles_after = _serialize_access_rows_for_ids(Role, next_role_ids)
        teams_after = _serialize_access_rows_for_ids(Team, next_team_ids)
        notification_before = _get_user_notification_preference_snapshot(target_user)
        notification_after = _build_onboarding_notification_snapshot(preset, notification_before)
        task_preview = _preview_onboarding_tasks_for_user(target_user, preset, roles_after, teams_after)

        return Response({
            'preset': next((item for item in _build_onboarding_preset_rows([preset]) if item.get('key') == preset_key), _serialize_onboarding_preset_storage(preset)),
            'target_user': _build_onboarding_target_user_payload(target_user),
            'access_strategy': access_strategy,
            'roles_before': current_access['roles'],
            'roles_after': roles_after,
            'teams_before': current_access['teams'],
            'teams_after': teams_after,
            'notification_before': notification_before,
            'notification_after': notification_after,
            'checklist': preset.get('checklist', []),
            'task_preview': task_preview,
            'summary': {
                'role_additions': max(0, len(roles_after) - len(current_access['roles'])),
                'team_additions': max(0, len(teams_after) - len(current_access['teams'])),
                'task_total': len(task_preview),
                'task_existing': sum(1 for item in task_preview if item['would_skip']),
                'task_new': sum(1 for item in task_preview if not item['would_skip']),
            },
        })

    @action(detail=False, methods=['post'], url_path='apply_onboarding_preset')
    def apply_onboarding_preset(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = ApplyOnboardingPresetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        preset_key = validated['preset_key']
        preset = next((item for item in _load_onboarding_presets() if item.get('key') == preset_key), None)
        if preset is None:
            return Response({'error': 'Khong tim thay preset.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            target_user = self._base_user_queryset().get(pk=validated['user_id'])
        except User.DoesNotExist:
            return Response({'error': 'Khong tim thay nguoi dung.'}, status=status.HTTP_404_NOT_FOUND)

        if target_user.id == request.user.id:
            return Response({'error': 'Khong the tu apply onboarding preset cho chinh minh.'}, status=status.HTTP_400_BAD_REQUEST)

        access_strategy = str(validated.get('access_strategy') or preset.get('access_strategy') or 'merge')
        old_access = _build_user_access_snapshot(target_user)
        notification_before = _get_user_notification_preference_snapshot(target_user)
        next_role_ids = _resolve_onboarding_access_ids(old_access['role_ids'], preset.get('role_ids', []), access_strategy)
        next_team_ids = _resolve_onboarding_access_ids(old_access['team_ids'], preset.get('team_ids', []), access_strategy)

        created_tasks = []
        skipped_tasks = []
        changed_fields = []

        with transaction.atomic():
            if next_role_ids != old_access['role_ids']:
                target_user.roles.set(next_role_ids)
                changed_fields.append('roles')
            if next_team_ids != old_access['team_ids']:
                target_user.teams.set(next_team_ids)
                changed_fields.append('teams')

            notification_after = _build_onboarding_notification_snapshot(preset, notification_before)
            if notification_after != notification_before:
                preference, _created = UserPreferences.objects.get_or_create(
                    user=target_user,
                    page='account-center',
                    defaults={'config': {}},
                )
                config = preference.config if isinstance(preference.config, dict) else {}
                config = {**config, **notification_after}
                preference.config = config
                preference.save(update_fields=['config', 'updated_at'])
                changed_fields.append('notification_preferences')

            refreshed_user = self._base_user_queryset().get(pk=target_user.id)
            new_access = _build_user_access_snapshot(refreshed_user)
            roles_after = new_access['roles']
            teams_after = new_access['teams']
            if validated.get('create_tasks', True):
                created_tasks, skipped_tasks = _create_onboarding_tasks_for_user(
                    refreshed_user,
                    preset,
                    roles_after,
                    teams_after,
                    triggered_by=request.user,
                )
                if created_tasks:
                    changed_fields.append('tasks')

        refreshed_user = self._base_user_queryset().get(pk=target_user.id)
        new_access = _build_user_access_snapshot(refreshed_user)
        notification_after = _get_user_notification_preference_snapshot(refreshed_user)
        payload_before = {
            'preset_key': preset_key,
            'preset_name': preset.get('name'),
            'access_strategy': access_strategy,
            'roles': old_access['roles'],
            'teams': old_access['teams'],
            'notification_preferences': notification_before,
        }
        payload_after = {
            'preset_key': preset_key,
            'preset_name': preset.get('name'),
            'access_strategy': access_strategy,
            'roles': new_access['roles'],
            'teams': new_access['teams'],
            'notification_preferences': notification_after,
            'checklist': preset.get('checklist', []),
            'tasks_created': created_tasks,
            'tasks_skipped': skipped_tasks,
            'tasks_created_count': len(created_tasks),
            'tasks_skipped_count': len(skipped_tasks),
        }
        final_changed_fields = list(dict.fromkeys(changed_fields or ['preset_key']))
        _create_onboarding_audit_log(
            request=request,
            actor=request.user,
            action='UPDATE',
            entity_type='UserOnboarding',
            entity_id=refreshed_user.id,
            entity_id_str=refreshed_user.username,
            entity_code=refreshed_user.username,
            old_values=payload_before,
            new_values=payload_after,
            changed_fields=final_changed_fields,
        )

        return Response({
            'success': True,
            'preset_key': preset_key,
            'access_strategy': access_strategy,
            'changed_fields': final_changed_fields,
            'user': _build_onboarding_target_user_payload(refreshed_user),
            'roles_before': old_access['roles'],
            'roles_after': new_access['roles'],
            'teams_before': old_access['teams'],
            'teams_after': new_access['teams'],
            'notification_before': notification_before,
            'notification_after': notification_after,
            'checklist': preset.get('checklist', []),
            'tasks_created': created_tasks,
            'tasks_skipped': skipped_tasks,
        })

    @action(detail=False, methods=['get'], url_path='onboarding_activity')
    def onboarding_activity(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        try:
            limit = int(request.query_params.get('limit') or 20)
        except (TypeError, ValueError):
            return Response({'error': 'limit phai la so nguyen.'}, status=status.HTTP_400_BAD_REQUEST)
        activity_queryset = AuditLog.objects.filter(entity_type__in=['UserOnboardingPreset', 'UserOnboarding']).select_related('user')
        return Response({
            'items': _build_onboarding_activity_items(activity_queryset, limit=limit),
            'total': activity_queryset.count(),
        })

    @action(detail=False, methods=['get'], url_path='access_review_workspace')
    def access_review_workspace(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        campaign_rows = _build_access_review_campaign_rows(_load_access_review_campaigns())
        watchlist_items = _build_access_review_watchlist(campaign_rows)
        activity_queryset = AuditLog.objects.filter(
            entity_type__in=['UserAccessReviewCampaign', 'UserAccessReview']
        ).select_related('user')
        role_rows = _serialize_onboarding_role_rows(_annotate_role_governance_queryset(Role.objects.all()))
        team_rows = _serialize_onboarding_team_rows(_annotate_team_governance_queryset(Team.objects.all()))
        return Response({
            'summary': _build_access_review_workspace_summary(campaign_rows, watchlist_items),
            'campaigns': campaign_rows,
            'watchlist': watchlist_items,
            'scope_options': _build_access_review_scope_options(),
            'action_options': _build_access_review_action_options(),
            'roles': role_rows,
            'teams': team_rows,
            'recent_activity': _build_access_review_activity_items(activity_queryset, limit=8),
        })

    @action(detail=False, methods=['post'], url_path='access_review_campaigns')
    def access_review_campaigns(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = AccessReviewCampaignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        campaign_payload = _serialize_access_review_campaign_storage(serializer.validated_data)
        existing_campaigns = _load_access_review_campaigns()
        previous_campaign = next((item for item in existing_campaigns if item.get('key') == campaign_payload['key']), None)
        next_campaigns = [item for item in existing_campaigns if item.get('key') != campaign_payload['key']]
        next_campaigns.append(campaign_payload)
        saved_campaigns = _save_access_review_campaigns(next_campaigns)
        saved_campaign = next((item for item in saved_campaigns if item.get('key') == campaign_payload['key']), campaign_payload)
        action_name = 'UPDATE' if previous_campaign else 'CREATE'
        changed_fields = _get_snapshot_changed_fields(previous_campaign or {}, saved_campaign) or list(saved_campaign.keys())
        _create_access_review_audit_log(
            request=request,
            actor=request.user,
            action=action_name,
            entity_type='UserAccessReviewCampaign',
            entity_id=_get_access_review_campaign_entity_id(saved_campaign['key']),
            entity_id_str=saved_campaign['key'],
            entity_code=saved_campaign['key'],
            old_values=previous_campaign or {},
            new_values=saved_campaign,
            changed_fields=changed_fields,
        )
        enriched_campaign = next(
            (item for item in _build_access_review_campaign_rows(saved_campaigns) if item.get('key') == saved_campaign['key']),
            saved_campaign,
        )
        return Response({
            'success': True,
            'campaign': enriched_campaign,
            'action': action_name,
        }, status=status.HTTP_201_CREATED if action_name == 'CREATE' else status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='access_review_campaigns_delete')
    def access_review_campaigns_delete(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        campaign_key = str(request.data.get('key') or '').strip().lower()
        if not campaign_key:
            return Response({'error': 'Cần cung cấp khóa của chiến dịch.'}, status=status.HTTP_400_BAD_REQUEST)
        existing_campaigns = _load_access_review_campaigns()
        previous_campaign = next((item for item in existing_campaigns if item.get('key') == campaign_key), None)
        if previous_campaign is None:
            return Response({'error': 'Không tìm thấy chiến dịch.'}, status=status.HTTP_404_NOT_FOUND)
        _save_access_review_campaigns([item for item in existing_campaigns if item.get('key') != campaign_key])
        _create_access_review_audit_log(
            request=request,
            actor=request.user,
            action='DELETE',
            entity_type='UserAccessReviewCampaign',
            entity_id=_get_access_review_campaign_entity_id(campaign_key),
            entity_id_str=campaign_key,
            entity_code=campaign_key,
            old_values=previous_campaign,
            new_values={},
            changed_fields=list(previous_campaign.keys()),
        )
        return Response({'success': True, 'key': campaign_key})

    @action(detail=False, methods=['post'], url_path='access_review_preview')
    def access_review_preview(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = AccessReviewPreviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        campaign_key = validated['campaign_key']
        campaign = next((item for item in _load_access_review_campaigns() if item.get('key') == campaign_key), None)
        if campaign is None:
            return Response({'error': 'Không tìm thấy chiến dịch.'}, status=status.HTTP_404_NOT_FOUND)

        selected_user_ids = validated.get('selected_user_ids') or []
        matched_users = _resolve_access_review_target_users(campaign, selected_user_ids=selected_user_ids)
        protected_users = [user for user in matched_users if int(user.id) == int(request.user.id) or bool(getattr(user, 'is_superuser', False))]
        target_users = [user for user in matched_users if user not in protected_users]
        campaign_row = next(
            (item for item in _build_access_review_campaign_rows([campaign]) if item.get('key') == campaign_key),
            _serialize_access_review_campaign_storage(campaign),
        )
        target_rows = _build_access_review_target_rows(target_users, campaign)
        skipped_rows = _build_access_review_target_rows(protected_users, campaign)
        manual_selection = bool(selected_user_ids)
        warnings = []
        if skipped_rows:
            warnings.append('Đợt rà soát đã bỏ qua tài khoản đang thao tác để tránh tự khóa hoặc tự thu hồi quyền.')
        if campaign_row.get('review_action') in {'revoke_access', 'lock_account'} and len(target_rows) > 10 and not manual_selection:
            warnings.append('Chiến dịch có phạm vi tác động lớn hơn 10 tài khoản. Hãy chọn thủ công trước khi áp dụng.')
        if campaign_row.get('review_action') == 'revoke_access' and any(item['role_count'] == 0 and item['team_count'] == 0 for item in target_rows):
            warnings.append('Một số tài khoản không còn vai trò/nhóm để thu hồi, đợt rà soát này chủ yếu mang tính xác nhận.')
        return Response({
            'campaign': campaign_row,
            'selection_mode': 'manual' if manual_selection else 'campaign',
            'selected_user_ids': [item['id'] for item in target_rows],
            'target_users': target_rows,
            'skipped_users': skipped_rows,
            'summary': _build_access_review_preview_summary(target_rows, skipped_rows, campaign_row.get('review_action')),
            'preflight_checks': _build_access_review_preflight_checks(campaign_row, target_rows, skipped_rows, manual_selection=manual_selection),
            'manual_selection_required': bool(campaign_row.get('review_action') in {'revoke_access', 'lock_account'} and len(target_rows) > 10 and not manual_selection),
            'warnings': warnings,
        })

    @action(detail=False, methods=['post'], url_path='apply_access_review')
    def apply_access_review(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = ApplyAccessReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        campaign_key = validated['campaign_key']
        campaign = next((item for item in _load_access_review_campaigns() if item.get('key') == campaign_key), None)
        if campaign is None:
            return Response({'error': 'Không tìm thấy chiến dịch.'}, status=status.HTTP_404_NOT_FOUND)

        selected_user_ids = validated.get('selected_user_ids') or []
        matched_users = _resolve_access_review_target_users(campaign, selected_user_ids=selected_user_ids)
        protected_users = [user for user in matched_users if int(user.id) == int(request.user.id) or bool(getattr(user, 'is_superuser', False))]
        target_users = [user for user in matched_users if user not in protected_users]
        review_action = str(campaign.get('review_action') or 'certify')
        manual_selection = bool(selected_user_ids)

        if not target_users:
            return Response({'error': 'Không có tài khoản hợp lệ để áp dụng chiến dịch.'}, status=status.HTTP_400_BAD_REQUEST)
        if review_action in {'revoke_access', 'lock_account'} and len(target_users) > 10 and not manual_selection:
            return Response({
                'error': 'Chiến dịch có phạm vi tác động lớn. Hãy chọn thủ công đối tượng trước khi áp dụng.',
                'manual_selection_required': True,
            }, status=status.HTTP_400_BAD_REQUEST)

        applied_user_ids = []
        skipped_user_ids = [user.id for user in protected_users]
        access_revoked_users = 0
        accounts_locked = 0
        certified_users = 0
        note = str(validated.get('note') or '').strip()

        with transaction.atomic():
            for user in target_users:
                old_snapshot_user = self._get_directory_user_instance(user.id) or user
                old_access = _build_user_access_snapshot(old_snapshot_user)
                old_account_state = {
                    'is_active': bool(old_snapshot_user.is_active),
                    'is_locked': bool(old_snapshot_user.is_locked),
                    'active_session_count': int(getattr(old_snapshot_user, 'active_session_count', 0) or 0),
                }
                changed_fields = ['review_action']

                if review_action == 'revoke_access':
                    if old_access['roles']:
                        changed_fields.append('roles')
                    if old_access['teams']:
                        changed_fields.append('teams')
                    if old_access['roles'] or old_access['teams']:
                        user.roles.clear()
                        user.teams.clear()
                        access_revoked_users += 1
                elif review_action == 'lock_account':
                    if not user.is_locked:
                        lock_changed_at = django_timezone.now()
                        user.is_locked = True
                        user.locked_at = lock_changed_at
                        user.locked_by = request.user
                        user.save(update_fields=['is_locked', 'locked_at', 'locked_by'])
                        UserSession.objects.filter(user_id=user.id, is_active=True).update(
                            is_active=False,
                            logout_at=lock_changed_at,
                        )
                        accounts_locked += 1
                        changed_fields.append('account_state')
                else:
                    certified_users += 1

                refreshed_user = self._get_directory_user_instance(user.id) or self._base_user_queryset().prefetch_related('roles', 'teams').get(pk=user.id)
                new_access = _build_user_access_snapshot(refreshed_user)
                new_account_state = {
                    'is_active': bool(refreshed_user.is_active),
                    'is_locked': bool(refreshed_user.is_locked),
                    'active_session_count': int(getattr(refreshed_user, 'active_session_count', 0) or 0),
                }

                if review_action == 'revoke_access' and (old_access['roles'] or old_access['teams']):
                    access_changed_fields = []
                    if old_access['roles']:
                        access_changed_fields.append('roles')
                    if old_access['teams']:
                        access_changed_fields.append('teams')
                    _create_user_access_audit_log(
                        request=request,
                        actor=request.user,
                        target_user=refreshed_user,
                        old_snapshot=old_access,
                        new_snapshot=new_access,
                        changed_fields=access_changed_fields,
                        strategy='replace',
                    )

                _create_access_review_audit_log(
                    request=request,
                    actor=request.user,
                    action='UPDATE',
                    entity_type='UserAccessReview',
                    entity_id=refreshed_user.id,
                    entity_id_str=refreshed_user.username,
                    entity_code=refreshed_user.username,
                    old_values={
                        'campaign_key': campaign_key,
                        'campaign_name': campaign.get('name'),
                        'review_action': review_action,
                        'note': note,
                        'access': old_access,
                        'account_state': old_account_state,
                    },
                    new_values={
                        'campaign_key': campaign_key,
                        'campaign_name': campaign.get('name'),
                        'review_action': review_action,
                        'note': note,
                        'access': new_access,
                        'account_state': new_account_state,
                    },
                    changed_fields=list(dict.fromkeys(changed_fields)),
                )
                applied_user_ids.append(refreshed_user.id)

        final_users = list(
            _annotate_user_directory_queryset(
                self._base_user_queryset()
                .filter(id__in=applied_user_ids)
                .prefetch_related('roles__permissions', 'teams')
            )
        )
        final_rows_by_id = {item['id']: item for item in _build_access_review_target_rows(final_users, campaign)}
        affected_users = [final_rows_by_id[user_id] for user_id in applied_user_ids if user_id in final_rows_by_id]
        campaign_row = next(
            (item for item in _build_access_review_campaign_rows([campaign]) if item.get('key') == campaign_key),
            _serialize_access_review_campaign_storage(campaign),
        )
        return Response({
            'success': True,
            'campaign': campaign_row,
            'applied_user_ids': applied_user_ids,
            'skipped_user_ids': skipped_user_ids,
            'affected_users': affected_users,
            'summary': {
                'processed_users': len(applied_user_ids),
                'skipped_users': len(skipped_user_ids),
                'certified_users': certified_users if review_action == 'certify' else len(applied_user_ids),
                'access_revoked_users': access_revoked_users,
                'accounts_locked': accounts_locked,
            },
            'note': note,
        })

    @action(detail=False, methods=['get'], url_path='access_review_activity')
    def access_review_activity(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        try:
            limit = int(request.query_params.get('limit') or 20)
        except (TypeError, ValueError):
            return Response({'error': 'limit phai la so nguyen.'}, status=status.HTTP_400_BAD_REQUEST)
        queryset = AuditLog.objects.filter(
            entity_type__in=['UserAccessReviewCampaign', 'UserAccessReview']
        ).select_related('user')
        return Response({
            'items': _build_access_review_activity_items(queryset, limit=limit),
            'total': queryset.count(),
        })

    @action(detail=False, methods=['get'], url_path='access_exception_workspace')
    def access_exception_workspace(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        return Response(_build_access_exception_workspace_payload(activity_limit=8))

    @action(detail=False, methods=['get', 'post'], url_path='access_exception_routing_rules')
    def access_exception_routing_rules(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        if request.method.lower() == 'get':
            rules = _build_access_exception_routing_rule_rows()
            return Response({'items': rules, 'total': len(rules)})

        serializer = AccessExceptionRoutingRuleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rule_payload = _serialize_access_exception_routing_rule_storage(serializer.validated_data)
        existing_rules = _load_access_exception_routing_rules()
        previous_rule = next(
            (item for item in existing_rules if item.get('department_key') == rule_payload['department_key']),
            None,
        )
        next_rules = [item for item in existing_rules if item.get('department_key') != rule_payload['department_key']]
        next_rules.append(rule_payload)
        saved_rules = _save_access_exception_routing_rules(next_rules)
        enriched_rule = next(
            (
                item
                for item in _build_access_exception_routing_rule_rows(saved_rules)
                if item.get('department_key') == rule_payload['department_key']
            ),
            rule_payload,
        )
        _create_access_exception_audit_log(
            request=request,
            actor=request.user,
            action='UPDATE' if previous_rule is not None else 'CREATE',
            entity_type='UserAccessExceptionRoutingRule',
            entity_id=_get_access_exception_policy_entity_id(rule_payload['department_key']),
            entity_id_str=rule_payload['department_key'],
            entity_code=rule_payload['department_label'],
            old_values=previous_rule or {},
            new_values=enriched_rule,
            changed_fields=sorted({
                *list((previous_rule or {}).keys()),
                *list(enriched_rule.keys()),
            }),
        )
        return Response({
            'success': True,
            'rule': enriched_rule,
            'action': 'UPDATE' if previous_rule is not None else 'CREATE',
        })

    @action(detail=False, methods=['get', 'post'], url_path='access_exception_approver_availability')
    def access_exception_approver_availability(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        if request.method.lower() == 'get':
            approver_rows = _build_access_exception_approver_availability_rows()
            return Response({
                'items': approver_rows,
                'summary': _build_access_exception_approver_availability_summary(approver_rows),
                'total': len(approver_rows),
            })

        serializer = AccessExceptionApproverAvailabilitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = _serialize_access_exception_approver_availability_storage(serializer.validated_data)
        existing_rows = _load_access_exception_approver_availability()
        previous_row = next((item for item in existing_rows if int(item.get('user_id') or 0) == int(payload['user_id'])), None)
        next_rows = [item for item in existing_rows if int(item.get('user_id') or 0) != int(payload['user_id'])]
        next_rows.append(payload)
        saved_rows = _save_access_exception_approver_availability(next_rows)
        enriched_row = next(
            (
                item
                for item in _build_access_exception_approver_availability_rows(availability_rows=saved_rows)
                if int(item.get('user_id') or 0) == int(payload['user_id'])
            ),
            payload,
        )
        approver_label = (
            ((enriched_row.get('approver') or {}).get('full_name'))
            or ((enriched_row.get('approver') or {}).get('username'))
            or str(payload['user_id'])
        )
        _create_access_exception_audit_log(
            request=request,
            actor=request.user,
            action='UPDATE' if previous_row is not None else 'CREATE',
            entity_type='UserAccessExceptionApproverAvailability',
            entity_id=int(payload['user_id']),
            entity_id_str=str(payload['user_id']),
            entity_code=approver_label,
            old_values=previous_row or {},
            new_values=enriched_row,
            changed_fields=sorted({
                *list((previous_row or {}).keys()),
                *list(enriched_row.keys()),
            }),
        )
        return Response({
            'success': True,
            'availability': enriched_row,
            'action': 'UPDATE' if previous_row is not None else 'CREATE',
        })

    @action(detail=False, methods=['post'], url_path='access_exception_policies')
    def access_exception_policies(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = AccessExceptionPolicySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        policy_payload = _serialize_access_exception_policy_storage(serializer.validated_data)
        existing_policies = _load_access_exception_policies()
        previous_policy = next((item for item in existing_policies if item.get('key') == policy_payload['key']), None)
        next_policies = [item for item in existing_policies if item.get('key') != policy_payload['key']]
        next_policies.append(policy_payload)
        saved_policies = _save_access_exception_policies(next_policies)
        request_rows = _build_access_exception_request_rows(
            _load_access_exception_requests(),
            _build_access_exception_policy_rows(saved_policies),
        )
        enriched_policy = next(
            (
                item
                for item in _build_access_exception_policy_rows(saved_policies, request_rows=request_rows)
                if item.get('key') == policy_payload['key']
            ),
            policy_payload,
        )
        action_name = 'UPDATE' if previous_policy else 'CREATE'
        changed_fields = _get_snapshot_changed_fields(previous_policy or {}, policy_payload) or list(policy_payload.keys())
        _create_access_exception_audit_log(
            request=request,
            actor=request.user,
            action=action_name,
            entity_type='UserAccessExceptionPolicy',
            entity_id=_get_access_exception_policy_entity_id(policy_payload['key']),
            entity_id_str=policy_payload['key'],
            entity_code=policy_payload['key'],
            old_values=previous_policy or {},
            new_values=policy_payload,
            changed_fields=changed_fields,
        )
        return Response({
            'success': True,
            'policy': enriched_policy,
            'action': action_name,
        }, status=status.HTTP_201_CREATED if action_name == 'CREATE' else status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='access_exception_policies_delete')
    def access_exception_policies_delete(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        policy_key = str(request.data.get('key') or '').strip().lower()
        if not policy_key:
            return Response({'error': 'Can cung cap key cua policy.'}, status=status.HTTP_400_BAD_REQUEST)

        existing_policies = _load_access_exception_policies()
        previous_policy = next((item for item in existing_policies if item.get('key') == policy_key), None)
        if previous_policy is None:
            return Response({'error': 'Khong tim thay policy.'}, status=status.HTTP_404_NOT_FOUND)

        request_rows = _build_access_exception_request_rows(
            _load_access_exception_requests(),
            _build_access_exception_policy_rows(existing_policies),
        )
        has_open_requests = any(
            row.get('policy', {}).get('key') == policy_key
            and row.get('lifecycle_state') in {'pending', 'active', 'expiring'}
            for row in request_rows
        )
        if has_open_requests:
            return Response({
                'error': 'Policy dang co exception request mo, khong the xoa luc nay.',
            }, status=status.HTTP_400_BAD_REQUEST)

        _save_access_exception_policies([item for item in existing_policies if item.get('key') != policy_key])
        _create_access_exception_audit_log(
            request=request,
            actor=request.user,
            action='DELETE',
            entity_type='UserAccessExceptionPolicy',
            entity_id=_get_access_exception_policy_entity_id(policy_key),
            entity_id_str=policy_key,
            entity_code=policy_key,
            old_values=previous_policy,
            new_values={},
            changed_fields=list(previous_policy.keys()),
        )
        return Response({'success': True, 'key': policy_key})

    @action(detail=False, methods=['post'], url_path='access_exception_preview')
    def access_exception_preview(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = AccessExceptionPreviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        policy_key = validated['policy_key']
        policy = next((item for item in _load_access_exception_policies() if item.get('key') == policy_key), None)
        if policy is None:
            return Response({'error': 'Khong tim thay policy.'}, status=status.HTTP_404_NOT_FOUND)
        if not policy.get('is_active', True):
            return Response({'error': 'Policy dang tam dung.'}, status=status.HTTP_400_BAD_REQUEST)

        target_user = self._base_user_queryset().filter(id=validated['user_id']).first()
        if target_user is None:
            return Response({'error': 'Khong tim thay nguoi dung.'}, status=status.HTTP_404_NOT_FOUND)

        approver_candidates = _build_access_exception_approver_users(limit=40)
        explicit_stage_one_approver = _find_access_exception_approver_user(
            validated.get('approver_user_id'),
            candidates=approver_candidates,
        )
        if validated.get('approver_user_id') and explicit_stage_one_approver is None:
            return Response({'error': 'Approver khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
        explicit_stage_two_approver = _find_access_exception_approver_user(
            validated.get('stage_two_approver_user_id'),
            candidates=approver_candidates,
        )
        if validated.get('stage_two_approver_user_id') and explicit_stage_two_approver is None:
            return Response({'error': 'Stage 2 approver khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
        availability_map = _get_access_exception_approver_availability_map()
        if explicit_stage_one_approver is not None and _is_access_exception_approver_out_of_office(availability_map.get(int(explicit_stage_one_approver.id))):
            return Response({'error': 'Stage 1 approver dang out-of-office, hay de he thong auto-route hoac chon backup kha dung.'}, status=status.HTTP_400_BAD_REQUEST)
        if explicit_stage_two_approver is not None and _is_access_exception_approver_out_of_office(availability_map.get(int(explicit_stage_two_approver.id))):
            return Response({'error': 'Stage 2 approver dang out-of-office, hay de he thong auto-route hoac chon backup kha dung.'}, status=status.HTTP_400_BAD_REQUEST)
        routing_plan = _build_access_exception_routing_plan(
            policy=policy,
            target_user=target_user,
            requester=request.user,
            explicit_stage_one_approver=explicit_stage_one_approver,
            explicit_stage_two_approver=explicit_stage_two_approver,
            approver_candidates=approver_candidates,
        )
        approver = routing_plan.get('selected_stage_one_user')
        stage_two_approver = routing_plan.get('selected_stage_two_user')

        duration_days = int(validated.get('duration_days') or policy.get('default_duration_days') or 7)
        max_duration_days = int(policy.get('max_duration_days') or duration_days)
        if duration_days > max_duration_days:
            return Response({'error': 'Duration vuot qua gioi han cua policy.'}, status=status.HTTP_400_BAD_REQUEST)

        preview_payload = _build_access_exception_preview(
            policy=policy,
            target_user=target_user,
            approver=approver,
            requester=request.user,
            duration_days=duration_days,
            justification=str(validated.get('justification') or ''),
            ticket_ref=str(validated.get('ticket_ref') or ''),
            stage_two_approver=stage_two_approver,
            routing_recommendation=routing_plan,
        )
        if getattr(target_user, 'is_superuser', False):
            preview_payload['warnings'].append('Khong nen mo access exception cho superuser tu governance desk nay.')
        preview_payload['expires_at'] = _serialize_access_exception_datetime(preview_payload.get('expires_at'))
        preview_payload['justification'] = str(validated.get('justification') or '')
        preview_payload['ticket_ref'] = str(validated.get('ticket_ref') or '')
        preview_payload['can_submit_request'] = not any(
            item.get('status') == 'blocked' for item in preview_payload.get('preflight_checks', [])
        )
        return Response(preview_payload)

    @action(detail=False, methods=['post'], url_path='access_exception_requests')
    def access_exception_requests(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = CreateAccessExceptionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        policy_key = validated['policy_key']
        existing_policies = _load_access_exception_policies()
        policy = next((item for item in existing_policies if item.get('key') == policy_key), None)
        if policy is None:
            return Response({'error': 'Khong tim thay policy.'}, status=status.HTTP_404_NOT_FOUND)
        if not policy.get('is_active', True):
            return Response({'error': 'Policy dang tam dung.'}, status=status.HTTP_400_BAD_REQUEST)

        target_user = self._base_user_queryset().filter(id=validated['user_id']).first()
        if target_user is None:
            return Response({'error': 'Khong tim thay nguoi dung.'}, status=status.HTTP_404_NOT_FOUND)
        if getattr(target_user, 'is_superuser', False):
            return Response({'error': 'Khong ho tro mo access exception cho superuser.'}, status=status.HTTP_400_BAD_REQUEST)

        approver_candidates = _build_access_exception_approver_users(limit=40)
        explicit_stage_one_approver = _find_access_exception_approver_user(
            validated.get('approver_user_id'),
            candidates=approver_candidates,
        )
        if validated.get('approver_user_id') and explicit_stage_one_approver is None:
            return Response({'error': 'Approver khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
        explicit_stage_two_approver = _find_access_exception_approver_user(
            validated.get('stage_two_approver_user_id'),
            candidates=approver_candidates,
        )
        if validated.get('stage_two_approver_user_id') and explicit_stage_two_approver is None:
            return Response({'error': 'Stage 2 approver khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
        availability_map = _get_access_exception_approver_availability_map()
        if explicit_stage_one_approver is not None and _is_access_exception_approver_out_of_office(availability_map.get(int(explicit_stage_one_approver.id))):
            return Response({'error': 'Stage 1 approver dang out-of-office, hay de he thong auto-route hoac chon backup kha dung.'}, status=status.HTTP_400_BAD_REQUEST)
        if explicit_stage_two_approver is not None and _is_access_exception_approver_out_of_office(availability_map.get(int(explicit_stage_two_approver.id))):
            return Response({'error': 'Stage 2 approver dang out-of-office, hay de he thong auto-route hoac chon backup kha dung.'}, status=status.HTTP_400_BAD_REQUEST)
        routing_plan = _build_access_exception_routing_plan(
            policy=policy,
            target_user=target_user,
            requester=request.user,
            explicit_stage_one_approver=explicit_stage_one_approver,
            explicit_stage_two_approver=explicit_stage_two_approver,
            approver_candidates=approver_candidates,
        )
        approver = routing_plan.get('selected_stage_one_user')
        stage_two_approver = routing_plan.get('selected_stage_two_user')

        duration_days = int(validated.get('duration_days') or policy.get('default_duration_days') or 7)
        max_duration_days = int(policy.get('max_duration_days') or duration_days)
        if duration_days > max_duration_days:
            return Response({'error': 'Duration vuot qua gioi han cua policy.'}, status=status.HTTP_400_BAD_REQUEST)

        ticket_ref = str(validated.get('ticket_ref') or '').strip()
        if str(policy.get('risk_level') or 'standard') == 'critical' and not ticket_ref:
            return Response({'error': 'Critical exception can ticket ref.'}, status=status.HTTP_400_BAD_REQUEST)
        if policy.get('requires_approval', True) and approver is None:
            return Response({'error': 'Request nay can approver hop le hoac delegated routing kha dung truoc khi submit.'}, status=status.HTTP_400_BAD_REQUEST)
        if policy.get('requires_approval', True) and int(policy.get('approval_stage_count') or 1) > 1 and stage_two_approver is None:
            return Response({'error': 'Request nay can stage 2 approver hop le hoac delegated routing stage 2 truoc khi submit.'}, status=status.HTTP_400_BAD_REQUEST)

        base_policy_rows = _build_access_exception_policy_rows(existing_policies)
        existing_request_rows = _build_access_exception_request_rows(_load_access_exception_requests(), base_policy_rows)
        duplicate_request = next(
            (
                item
                for item in existing_request_rows
                if item.get('policy', {}).get('key') == policy_key
                and int(item.get('target_user', {}).get('id') or 0) == int(target_user.id)
                and item.get('lifecycle_state') in {'pending', 'active', 'expiring'}
            ),
            None,
        )
        if duplicate_request is not None:
            return Response({
                'error': 'Da ton tai access exception dang mo cho user va policy nay.',
                'request_key': duplicate_request['key'],
            }, status=status.HTTP_400_BAD_REQUEST)

        preview_payload = _build_access_exception_preview(
            policy=policy,
            target_user=target_user,
            approver=approver,
            requester=request.user,
            duration_days=duration_days,
            justification=str(validated.get('justification') or ''),
            ticket_ref=ticket_ref,
            stage_two_approver=stage_two_approver,
            routing_recommendation=routing_plan,
        )
        if any(
            item.get('status') == 'blocked'
            and item.get('key') in {'approver', 'approval-path', 'evidence'}
            for item in preview_payload.get('preflight_checks', [])
        ):
            return Response({'error': 'Request chua dat preflight toi thieu de submit.'}, status=status.HTTP_400_BAD_REQUEST)

        request_rows_storage = _load_access_exception_requests()
        approval_stage_history = []
        active_stage_started_at = None
        active_stage_due_at = None
        active_approver_user_id = None
        active_stage_level = 1
        if policy.get('requires_approval', True):
            approval_stage_history = _build_access_exception_stage_plan(policy, request.user, approver, stage_two_approver)
            if approval_stage_history:
                approval_stage_history[0]['status'] = 'pending'
                approval_stage_history[0]['started_at'] = now = django_timezone.now()
                active_stage_started_at = now
                active_stage_due_at = _get_access_exception_stage_due_at(now, policy.get('approval_sla_hours'))
                active_approver_user_id = approval_stage_history[0].get('approver_user_id')
            else:
                now = django_timezone.now()
        else:
            now = django_timezone.now()
        request_key = f'exception-{uuid.uuid4().hex[:10]}'
        request_row = {
            'key': request_key,
            'request_kind': 'grant',
            'parent_request_key': '',
            'renewed_by_request_key': '',
            'policy_pack_key': str(policy.get('pack_key') or ''),
            'policy_key': policy['key'],
            'policy_name': policy.get('name') or policy['key'],
            'policy_risk_level': policy.get('risk_level') or 'standard',
            'policy_tone': policy.get('tone') or 'blue',
            'requires_approval': bool(policy.get('requires_approval', True)),
            'approval_stage_count': int(policy.get('approval_stage_count') or 1),
            'approval_sla_hours': int(policy.get('approval_sla_hours') or 24),
            'stage_one_label': str(policy.get('stage_one_label') or 'Manager review'),
            'stage_two_label': str(policy.get('stage_two_label') or ''),
            'routing_department_key': str(routing_plan.get('department_key') or 'general'),
            'routing_department_label': str(routing_plan.get('department_label') or 'General governance'),
            'routing_summary': str(routing_plan.get('routing_summary') or ''),
            'routing_stage_one_strategy_label': str(routing_plan.get('stage_one_strategy_label') or ''),
            'routing_stage_two_strategy_label': str(routing_plan.get('stage_two_strategy_label') or ''),
            'routing_stage_one_source': str(routing_plan.get('selected_stage_one_source') or ''),
            'routing_stage_two_source': str(routing_plan.get('selected_stage_two_source') or ''),
            'routing_stage_one_resolution_kind': str(routing_plan.get('selected_stage_one_resolution_kind') or ''),
            'routing_stage_two_resolution_kind': str(routing_plan.get('selected_stage_two_resolution_kind') or ''),
            'routing_stage_one_resolution_label': str(routing_plan.get('selected_stage_one_resolution_label') or ''),
            'routing_stage_two_resolution_label': str(routing_plan.get('selected_stage_two_resolution_label') or ''),
            'routing_stage_one_coverage_note': str(routing_plan.get('selected_stage_one_coverage_note') or ''),
            'routing_stage_two_coverage_note': str(routing_plan.get('selected_stage_two_coverage_note') or ''),
            'routing_target_team_codes': [
                str(item.get('code') or '').strip().upper()
                for item in routing_plan.get('target_teams', [])
                if str(item.get('code') or '').strip()
            ],
            'auto_selected_stage_one': bool(routing_plan.get('auto_selected_stage_one', False)),
            'auto_selected_stage_two': bool(routing_plan.get('auto_selected_stage_two', False)),
            'user_id': target_user.id,
            'approver_user_id': approver.id if approver is not None and policy.get('requires_approval', True) else None,
            'stage_two_approver_user_id': stage_two_approver.id if stage_two_approver is not None and int(policy.get('approval_stage_count') or 1) > 1 else None,
            'active_approver_user_id': active_approver_user_id,
            'active_stage_level': active_stage_level,
            'requested_by_id': request.user.id,
            'approved_by_id': None,
            'rejected_by_id': None,
            'revoked_by_id': None,
            'duration_days': duration_days,
            'justification': str(validated.get('justification') or '').strip(),
            'ticket_ref': ticket_ref,
            'status': 'pending' if policy.get('requires_approval', True) else 'approved',
            'decision_note': '',
            'requested_at': now,
            'approved_at': None,
            'rejected_at': None,
            'revoked_at': None,
            'renewed_at': None,
            'approval_stage_started_at': active_stage_started_at,
            'approval_stage_due_at': active_stage_due_at,
            'continuity_reroute_count': 0,
            'continuity_last_rerouted_at': None,
            'continuity_last_reroute_by_id': None,
            'continuity_last_reroute_from_user_id': None,
            'continuity_last_reroute_note': '',
            'expires_at': None,
            'role_ids': list(policy.get('role_ids', [])),
            'team_ids': list(policy.get('team_ids', [])),
            'granted_role_ids': [],
            'granted_team_ids': [],
            'reminder_offsets_sent': [],
            'approval_stage_history': approval_stage_history,
            'approval_task_id': None,
            'approval_task_source_key': '',
        }

        created_snapshot = _serialize_access_exception_request_storage(request_row)
        created_snapshot_for_audit = {**created_snapshot}

        with transaction.atomic():
            if policy.get('requires_approval', True):
                task = _create_access_exception_approval_task(
                    request_key=request_key,
                    target_user=target_user,
                    approver=approver,
                    requested_by=request.user,
                    policy=policy,
                    duration_days=duration_days,
                    stage_level=1,
                    stage_label=str(request_row.get('stage_one_label') or 'Manager review'),
                )
                request_row['approval_task_id'] = task.id
                request_row['approval_task_source_key'] = task.source_key or ''
                created_snapshot_for_audit = _serialize_access_exception_request_storage(request_row)
                _create_access_exception_approval_history(
                    request_row=request_row,
                    action='SUBMIT',
                    actor=request.user,
                    comments=request_row.get('justification') or '',
                    level=1,
                )
            else:
                old_access = _build_user_access_snapshot(target_user)
                next_role_ids = sorted(set(old_access['role_ids']) | set(policy.get('role_ids', [])))
                next_team_ids = sorted(set(old_access['team_ids']) | set(policy.get('team_ids', [])))
                changed_fields = []
                granted_role_ids = sorted(set(next_role_ids) - set(old_access['role_ids']))
                granted_team_ids = sorted(set(next_team_ids) - set(old_access['team_ids']))
                if next_role_ids != old_access['role_ids']:
                    target_user.roles.set(next_role_ids)
                    changed_fields.append('roles')
                if next_team_ids != old_access['team_ids']:
                    target_user.teams.set(next_team_ids)
                    changed_fields.append('teams')

                refreshed_user = self._base_user_queryset().prefetch_related('roles', 'teams').get(pk=target_user.id)
                new_access = _build_user_access_snapshot(refreshed_user)
                if changed_fields:
                    _create_user_access_audit_log(
                        request=request,
                        actor=request.user,
                        target_user=refreshed_user,
                        old_snapshot=old_access,
                        new_snapshot=new_access,
                        changed_fields=changed_fields,
                        strategy='add',
                    )
                request_row['approved_by_id'] = request.user.id
                request_row['approved_at'] = now
                request_row['expires_at'] = now + timedelta(days=duration_days)
                request_row['granted_role_ids'] = granted_role_ids
                request_row['granted_team_ids'] = granted_team_ids
                created_snapshot_for_audit = _serialize_access_exception_request_storage(request_row)

            request_rows_storage.append(request_row)
            saved_request_rows = _save_access_exception_requests(request_rows_storage)

        _create_access_exception_audit_log(
            request=request,
            actor=request.user,
            action='CREATE',
            entity_type='UserAccessExceptionRequest',
            entity_id=_get_access_exception_request_entity_id(request_key),
            entity_id_str=request_key,
            entity_code=target_user.username,
            old_values={},
            new_values=created_snapshot_for_audit,
            changed_fields=list(created_snapshot_for_audit.keys()),
        )
        if not policy.get('requires_approval', True):
            _create_access_exception_audit_log(
                request=request,
                actor=request.user,
                action='APPROVE',
                entity_type='UserAccessExceptionRequest',
                entity_id=_get_access_exception_request_entity_id(request_key),
                entity_id_str=request_key,
                entity_code=target_user.username,
                old_values=created_snapshot,
                new_values=created_snapshot_for_audit,
                changed_fields=['status', 'approved_by_id', 'approved_at', 'expires_at', 'granted_role_ids', 'granted_team_ids'],
            )

        final_policy_rows = _build_access_exception_policy_rows(existing_policies)
        final_request_rows = _build_access_exception_request_rows(saved_request_rows, final_policy_rows)
        final_request = next((item for item in final_request_rows if item.get('key') == request_key), created_snapshot_for_audit)
        return Response({
            'success': True,
            'request': final_request,
            'action': 'CREATE',
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='access_exception_renewals')
    def access_exception_renewals(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = CreateAccessExceptionRenewalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        request_rows_storage = _load_access_exception_requests()
        parent_request_key = validated['request_key']
        parent_request_index = next((index for index, item in enumerate(request_rows_storage) if item.get('key') == parent_request_key), None)
        if parent_request_index is None:
            return Response({'error': 'Khong tim thay request goc de renewal.'}, status=status.HTTP_404_NOT_FOUND)

        parent_request_row = _serialize_access_exception_request_storage(request_rows_storage[parent_request_index])
        if str(parent_request_row.get('status') or '') != 'approved':
            return Response({'error': 'Chi co the renewal request da duoc approve.'}, status=status.HTTP_400_BAD_REQUEST)
        if str(parent_request_row.get('renewed_by_request_key') or '').strip():
            return Response({'error': 'Request nay da co renewal dang mo hoac da duoc gia han.'}, status=status.HTTP_400_BAD_REQUEST)

        existing_policies = _load_access_exception_policies()
        policy = next((item for item in existing_policies if item.get('key') == parent_request_row.get('policy_key')), None)
        if policy is None:
            return Response({'error': 'Khong tim thay policy cho request goc.'}, status=status.HTTP_404_NOT_FOUND)
        if not policy.get('is_active', True):
            return Response({'error': 'Policy dang tam dung, khong the renewal luc nay.'}, status=status.HTTP_400_BAD_REQUEST)

        target_user = self._base_user_queryset().filter(id=parent_request_row['user_id']).first()
        if target_user is None:
            return Response({'error': 'Khong tim thay nguoi dung.'}, status=status.HTTP_404_NOT_FOUND)
        if getattr(target_user, 'is_superuser', False):
            return Response({'error': 'Khong ho tro renewal exception cho superuser.'}, status=status.HTTP_400_BAD_REQUEST)

        approver_candidates = _build_access_exception_approver_users(limit=40)
        explicit_stage_one_approver = _find_access_exception_approver_user(
            validated.get('approver_user_id'),
            candidates=approver_candidates,
        )
        if validated.get('approver_user_id') and explicit_stage_one_approver is None:
            return Response({'error': 'Approver khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
        explicit_stage_two_approver = _find_access_exception_approver_user(
            validated.get('stage_two_approver_user_id'),
            candidates=approver_candidates,
        )
        if validated.get('stage_two_approver_user_id') and explicit_stage_two_approver is None:
            return Response({'error': 'Stage 2 approver khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
        availability_map = _get_access_exception_approver_availability_map()
        if explicit_stage_one_approver is not None and _is_access_exception_approver_out_of_office(availability_map.get(int(explicit_stage_one_approver.id))):
            return Response({'error': 'Stage 1 approver dang out-of-office, hay de he thong auto-route hoac chon backup kha dung.'}, status=status.HTTP_400_BAD_REQUEST)
        if explicit_stage_two_approver is not None and _is_access_exception_approver_out_of_office(availability_map.get(int(explicit_stage_two_approver.id))):
            return Response({'error': 'Stage 2 approver dang out-of-office, hay de he thong auto-route hoac chon backup kha dung.'}, status=status.HTTP_400_BAD_REQUEST)
        routing_plan = _build_access_exception_routing_plan(
            policy=policy,
            target_user=target_user,
            requester=request.user,
            explicit_stage_one_approver=explicit_stage_one_approver,
            explicit_stage_two_approver=explicit_stage_two_approver,
            approver_candidates=approver_candidates,
        )
        approver = routing_plan.get('selected_stage_one_user')
        stage_two_approver = routing_plan.get('selected_stage_two_user')

        duration_days = int(validated.get('duration_days') or policy.get('default_duration_days') or parent_request_row.get('duration_days') or 7)
        max_duration_days = int(policy.get('max_duration_days') or duration_days)
        if duration_days > max_duration_days:
            return Response({'error': 'Duration vuot qua gioi han cua policy.'}, status=status.HTTP_400_BAD_REQUEST)

        ticket_ref = str(validated.get('ticket_ref') or '').strip()
        if str(policy.get('risk_level') or 'standard') == 'critical' and not ticket_ref:
            return Response({'error': 'Critical exception can ticket ref.'}, status=status.HTTP_400_BAD_REQUEST)
        if policy.get('requires_approval', True) and approver is None:
            return Response({'error': 'Renewal nay can approver hop le hoac delegated routing kha dung truoc khi submit.'}, status=status.HTTP_400_BAD_REQUEST)
        if policy.get('requires_approval', True) and int(policy.get('approval_stage_count') or 1) > 1 and stage_two_approver is None:
            return Response({'error': 'Renewal nay can stage 2 approver hop le hoac delegated routing stage 2 truoc khi submit.'}, status=status.HTTP_400_BAD_REQUEST)

        base_policy_rows = _build_access_exception_policy_rows(existing_policies)
        existing_request_rows = _build_access_exception_request_rows(request_rows_storage, base_policy_rows)
        duplicate_renewal = next(
            (
                item
                for item in existing_request_rows
                if str(item.get('parent_request_key') or '') == parent_request_key
                and item.get('lifecycle_state') in {'pending', 'active', 'expiring'}
            ),
            None,
        )
        if duplicate_renewal is not None:
            return Response({
                'error': 'Da ton tai renewal dang mo cho request nay.',
                'request_key': duplicate_renewal['key'],
            }, status=status.HTTP_400_BAD_REQUEST)

        preview_payload = _build_access_exception_preview(
            policy=policy,
            target_user=target_user,
            approver=approver,
            requester=request.user,
            duration_days=duration_days,
            justification=str(validated.get('justification') or ''),
            ticket_ref=ticket_ref,
            stage_two_approver=stage_two_approver,
            routing_recommendation=routing_plan,
        )
        if any(
            item.get('status') == 'blocked'
            and item.get('key') in {'approver', 'approval-path', 'evidence'}
            for item in preview_payload.get('preflight_checks', [])
        ):
            return Response({'error': 'Renewal chua dat preflight toi thieu de submit.'}, status=status.HTTP_400_BAD_REQUEST)

        request_key = f'exception-{uuid.uuid4().hex[:10]}'
        now = django_timezone.now()
        approval_stage_history = []
        active_stage_started_at = None
        active_stage_due_at = None
        active_approver_user_id = None
        if policy.get('requires_approval', True):
            approval_stage_history = _build_access_exception_stage_plan(policy, request.user, approver, stage_two_approver)
            if approval_stage_history:
                approval_stage_history[0]['status'] = 'pending'
                approval_stage_history[0]['started_at'] = now
                active_stage_started_at = now
                active_stage_due_at = _get_access_exception_stage_due_at(now, policy.get('approval_sla_hours'))
                active_approver_user_id = approval_stage_history[0].get('approver_user_id')
        request_row = {
            'key': request_key,
            'request_kind': 'renewal',
            'parent_request_key': parent_request_key,
            'renewed_by_request_key': '',
            'policy_pack_key': str(policy.get('pack_key') or ''),
            'policy_key': policy['key'],
            'policy_name': policy.get('name') or policy['key'],
            'policy_risk_level': policy.get('risk_level') or 'standard',
            'policy_tone': policy.get('tone') or 'blue',
            'requires_approval': bool(policy.get('requires_approval', True)),
            'approval_stage_count': int(policy.get('approval_stage_count') or 1),
            'approval_sla_hours': int(policy.get('approval_sla_hours') or 24),
            'stage_one_label': str(policy.get('stage_one_label') or 'Manager review'),
            'stage_two_label': str(policy.get('stage_two_label') or ''),
            'routing_department_key': str(routing_plan.get('department_key') or 'general'),
            'routing_department_label': str(routing_plan.get('department_label') or 'General governance'),
            'routing_summary': str(routing_plan.get('routing_summary') or ''),
            'routing_stage_one_strategy_label': str(routing_plan.get('stage_one_strategy_label') or ''),
            'routing_stage_two_strategy_label': str(routing_plan.get('stage_two_strategy_label') or ''),
            'routing_stage_one_source': str(routing_plan.get('selected_stage_one_source') or ''),
            'routing_stage_two_source': str(routing_plan.get('selected_stage_two_source') or ''),
            'routing_stage_one_resolution_kind': str(routing_plan.get('selected_stage_one_resolution_kind') or ''),
            'routing_stage_two_resolution_kind': str(routing_plan.get('selected_stage_two_resolution_kind') or ''),
            'routing_stage_one_resolution_label': str(routing_plan.get('selected_stage_one_resolution_label') or ''),
            'routing_stage_two_resolution_label': str(routing_plan.get('selected_stage_two_resolution_label') or ''),
            'routing_stage_one_coverage_note': str(routing_plan.get('selected_stage_one_coverage_note') or ''),
            'routing_stage_two_coverage_note': str(routing_plan.get('selected_stage_two_coverage_note') or ''),
            'routing_target_team_codes': [
                str(item.get('code') or '').strip().upper()
                for item in routing_plan.get('target_teams', [])
                if str(item.get('code') or '').strip()
            ],
            'auto_selected_stage_one': bool(routing_plan.get('auto_selected_stage_one', False)),
            'auto_selected_stage_two': bool(routing_plan.get('auto_selected_stage_two', False)),
            'user_id': target_user.id,
            'approver_user_id': approver.id if approver is not None and policy.get('requires_approval', True) else None,
            'stage_two_approver_user_id': stage_two_approver.id if stage_two_approver is not None and int(policy.get('approval_stage_count') or 1) > 1 else None,
            'active_approver_user_id': active_approver_user_id,
            'active_stage_level': 1,
            'requested_by_id': request.user.id,
            'approved_by_id': None,
            'rejected_by_id': None,
            'revoked_by_id': None,
            'duration_days': duration_days,
            'justification': str(validated.get('justification') or '').strip(),
            'ticket_ref': ticket_ref,
            'status': 'pending' if policy.get('requires_approval', True) else 'approved',
            'decision_note': '',
            'requested_at': now,
            'approved_at': None,
            'rejected_at': None,
            'revoked_at': None,
            'renewed_at': None,
            'approval_stage_started_at': active_stage_started_at,
            'approval_stage_due_at': active_stage_due_at,
            'continuity_reroute_count': 0,
            'continuity_last_rerouted_at': None,
            'continuity_last_reroute_by_id': None,
            'continuity_last_reroute_from_user_id': None,
            'continuity_last_reroute_note': '',
            'expires_at': None,
            'role_ids': list(policy.get('role_ids', [])),
            'team_ids': list(policy.get('team_ids', [])),
            'granted_role_ids': [],
            'granted_team_ids': [],
            'reminder_offsets_sent': [],
            'approval_stage_history': approval_stage_history,
            'approval_task_id': None,
            'approval_task_source_key': '',
        }

        created_snapshot = _serialize_access_exception_request_storage(request_row)
        created_snapshot_for_audit = {**created_snapshot}
        parent_audit_payload = None

        with transaction.atomic():
            if policy.get('requires_approval', True):
                task = _create_access_exception_approval_task(
                    request_key=request_key,
                    target_user=target_user,
                    approver=approver,
                    requested_by=request.user,
                    policy=policy,
                    duration_days=duration_days,
                    stage_level=1,
                    stage_label=str(request_row.get('stage_one_label') or 'Manager review'),
                )
                request_row['approval_task_id'] = task.id
                request_row['approval_task_source_key'] = task.source_key or ''
                created_snapshot_for_audit = _serialize_access_exception_request_storage(request_row)
                _create_access_exception_approval_history(
                    request_row=request_row,
                    action='SUBMIT',
                    actor=request.user,
                    comments=request_row.get('justification') or '',
                    level=1,
                )
            else:
                old_access = _build_user_access_snapshot(target_user)
                protected_access_ids = _get_access_exception_protected_access_ids(
                    request_rows=request_rows_storage,
                    user_id=target_user.id,
                    exclude_request_keys=[parent_request_key],
                    now=now,
                )
                parent_granted_role_ids = set(parent_request_row.get('granted_role_ids') or parent_request_row.get('role_ids') or [])
                parent_granted_team_ids = set(parent_request_row.get('granted_team_ids') or parent_request_row.get('team_ids') or [])
                baseline_role_ids = sorted(set(old_access['role_ids']) - (parent_granted_role_ids - set(protected_access_ids.get('role_ids', []))))
                baseline_team_ids = sorted(set(old_access['team_ids']) - (parent_granted_team_ids - set(protected_access_ids.get('team_ids', []))))
                next_role_ids = sorted(set(baseline_role_ids) | set(policy.get('role_ids', [])))
                next_team_ids = sorted(set(baseline_team_ids) | set(policy.get('team_ids', [])))
                granted_role_ids = sorted(set(next_role_ids) - set(baseline_role_ids))
                granted_team_ids = sorted(set(next_team_ids) - set(baseline_team_ids))
                changed_fields = []
                if next_role_ids != old_access['role_ids']:
                    target_user.roles.set(next_role_ids)
                    changed_fields.append('roles')
                if next_team_ids != old_access['team_ids']:
                    target_user.teams.set(next_team_ids)
                    changed_fields.append('teams')

                refreshed_user = self._base_user_queryset().prefetch_related('roles', 'teams').get(pk=target_user.id)
                new_access = _build_user_access_snapshot(refreshed_user)
                if changed_fields:
                    _create_user_access_audit_log(
                        request=request,
                        actor=request.user,
                        target_user=refreshed_user,
                        old_snapshot=old_access,
                        new_snapshot=new_access,
                        changed_fields=changed_fields,
                        strategy='add',
                    )

                parent_old_snapshot = dict(parent_request_row)
                parent_request_row['status'] = 'renewed'
                parent_request_row['renewed_by_request_key'] = request_key
                parent_request_row['renewed_at'] = now
                request_rows_storage[parent_request_index] = parent_request_row
                parent_audit_payload = {
                    'request_key': parent_request_key,
                    'entity_code': refreshed_user.username,
                    'old_values': _serialize_access_exception_request_storage(parent_old_snapshot),
                    'new_values': _serialize_access_exception_request_storage(parent_request_row),
                    'changed_fields': ['status', 'renewed_by_request_key', 'renewed_at'],
                }

                request_row['approved_by_id'] = request.user.id
                request_row['approved_at'] = now
                request_row['expires_at'] = now + timedelta(days=duration_days)
                request_row['granted_role_ids'] = granted_role_ids
                request_row['granted_team_ids'] = granted_team_ids
                created_snapshot_for_audit = _serialize_access_exception_request_storage(request_row)

            request_rows_storage.append(request_row)
            saved_request_rows = _save_access_exception_requests(request_rows_storage)

        _create_access_exception_audit_log(
            request=request,
            actor=request.user,
            action='CREATE',
            entity_type='UserAccessExceptionRequest',
            entity_id=_get_access_exception_request_entity_id(request_key),
            entity_id_str=request_key,
            entity_code=target_user.username,
            old_values={},
            new_values=created_snapshot_for_audit,
            changed_fields=list(created_snapshot_for_audit.keys()),
        )
        if not policy.get('requires_approval', True):
            _create_access_exception_audit_log(
                request=request,
                actor=request.user,
                action='APPROVE',
                entity_type='UserAccessExceptionRequest',
                entity_id=_get_access_exception_request_entity_id(request_key),
                entity_id_str=request_key,
                entity_code=target_user.username,
                old_values=created_snapshot,
                new_values=created_snapshot_for_audit,
                changed_fields=['status', 'approved_by_id', 'approved_at', 'expires_at', 'granted_role_ids', 'granted_team_ids'],
            )
            if parent_audit_payload is not None:
                _create_access_exception_audit_log(
                    request=request,
                    actor=request.user,
                    action='UPDATE',
                    entity_type='UserAccessExceptionRequest',
                    entity_id=_get_access_exception_request_entity_id(parent_audit_payload['request_key']),
                    entity_id_str=parent_audit_payload['request_key'],
                    entity_code=parent_audit_payload['entity_code'],
                    old_values=parent_audit_payload['old_values'],
                    new_values=parent_audit_payload['new_values'],
                    changed_fields=parent_audit_payload['changed_fields'],
                )

        final_policy_rows = _build_access_exception_policy_rows(existing_policies)
        final_request_rows = _build_access_exception_request_rows(saved_request_rows, final_policy_rows)
        final_request = next((item for item in final_request_rows if item.get('key') == request_key), created_snapshot_for_audit)
        return Response({
            'success': True,
            'request': final_request,
            'action': 'CREATE',
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='access_exception_decide')
    def access_exception_decide(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = DecisionAccessExceptionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        request_key = validated['request_key']
        request_rows_storage = _load_access_exception_requests()
        request_index = next((index for index, item in enumerate(request_rows_storage) if item.get('key') == request_key), None)
        if request_index is None:
            return Response({'error': 'Khong tim thay request.'}, status=status.HTTP_404_NOT_FOUND)

        request_row = _serialize_access_exception_request_storage(request_rows_storage[request_index])
        if str(request_row.get('status') or 'pending') != 'pending':
            return Response({'error': 'Chi co the approve/reject request dang pending.'}, status=status.HTTP_400_BAD_REQUEST)

        note = str(validated.get('note') or '').strip()
        decision = str(validated['decision'] or 'approve')
        old_snapshot = dict(request_row)
        old_snapshot_serialized = _serialize_access_exception_request_storage(old_snapshot)
        now = django_timezone.now()
        parent_audit_payload = None
        response_action = decision.upper()

        approval_stage_count = max(1, min(int(request_row.get('approval_stage_count') or 1), 2))
        current_stage_level = max(1, min(int(request_row.get('active_stage_level') or 1), approval_stage_count))
        approval_stage_history = [
            {
                'level': max(1, min(int(item.get('level') or 1), 2)),
                'label': str(item.get('label') or '')[:80],
                'approver_user_id': int(item.get('approver_user_id')) if item.get('approver_user_id') else None,
                'status': str(item.get('status') or 'queued'),
                'started_at': item.get('started_at'),
                'decided_at': item.get('decided_at'),
                'decision': str(item.get('decision') or ''),
                'decision_note': str(item.get('decision_note') or '')[:1000],
            }
            for item in request_row.get('approval_stage_history', [])
            if isinstance(item, dict)
        ]
        if not approval_stage_history and request_row.get('requires_approval', True):
            approval_stage_history = [
                {
                    'level': 1,
                    'label': str(request_row.get('stage_one_label') or 'Manager review'),
                    'approver_user_id': request_row.get('approver_user_id'),
                    'status': 'pending',
                    'started_at': request_row.get('approval_stage_started_at') or request_row.get('requested_at'),
                    'decided_at': None,
                    'decision': '',
                    'decision_note': '',
                }
            ]
            if approval_stage_count > 1:
                approval_stage_history.append({
                    'level': 2,
                    'label': str(request_row.get('stage_two_label') or 'Governance sign-off'),
                    'approver_user_id': request_row.get('stage_two_approver_user_id'),
                    'status': 'queued',
                    'started_at': None,
                    'decided_at': None,
                    'decision': '',
                    'decision_note': '',
                })

        current_stage_index = next(
            (
                index
                for index, item in enumerate(approval_stage_history)
                if int(item.get('level') or 1) == current_stage_level
            ),
            0 if approval_stage_history else None,
        )

        with transaction.atomic():
            if decision == 'approve':
                target_user = self._base_user_queryset().filter(id=request_row['user_id']).first()
                if target_user is None:
                    return Response({'error': 'Khong tim thay nguoi dung.'}, status=status.HTTP_404_NOT_FOUND)
                if getattr(target_user, 'is_superuser', False):
                    return Response({'error': 'Khong ho tro approve exception cho superuser.'}, status=status.HTTP_400_BAD_REQUEST)

                if current_stage_index is not None and current_stage_index < len(approval_stage_history):
                    approval_stage_history[current_stage_index]['status'] = 'approved'
                    approval_stage_history[current_stage_index]['decided_at'] = now
                    approval_stage_history[current_stage_index]['decision'] = 'approve'
                    approval_stage_history[current_stage_index]['decision_note'] = note

                if bool(request_row.get('requires_approval', True)) and current_stage_level < approval_stage_count:
                    next_stage_level = current_stage_level + 1
                    next_stage_index = next(
                        (
                            index
                            for index, item in enumerate(approval_stage_history)
                            if int(item.get('level') or 1) == next_stage_level
                        ),
                        None,
                    )
                    if next_stage_index is None:
                        return Response({'error': 'Khong tim thay stage tiep theo cho request nay.'}, status=status.HTTP_400_BAD_REQUEST)

                    next_stage_user_id = approval_stage_history[next_stage_index].get('approver_user_id')
                    next_stage_approver = self._base_user_queryset().filter(id=next_stage_user_id).first() if next_stage_user_id else None
                    if next_stage_approver is None:
                        return Response({'error': 'Stage approver tiep theo khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)

                    approval_stage_history[next_stage_index]['status'] = 'pending'
                    approval_stage_history[next_stage_index]['started_at'] = now
                    approval_stage_history[next_stage_index]['decided_at'] = None
                    approval_stage_history[next_stage_index]['decision'] = ''
                    approval_stage_history[next_stage_index]['decision_note'] = ''

                    _close_access_exception_approval_task(request_row.get('approval_task_id'), close_mode='done')
                    next_stage_task = _create_access_exception_approval_task(
                        request_key=request_key,
                        target_user=target_user,
                        approver=next_stage_approver,
                        requested_by=request.user,
                        policy={
                            'key': request_row.get('policy_key'),
                            'name': request_row.get('policy_name'),
                            'tone': request_row.get('policy_tone'),
                            'risk_level': request_row.get('policy_risk_level'),
                        },
                        duration_days=int(request_row.get('duration_days') or 7),
                        stage_level=next_stage_level,
                        stage_label=str(approval_stage_history[next_stage_index].get('label') or f'Stage {next_stage_level} review'),
                    )

                    request_row['approval_stage_history'] = approval_stage_history
                    request_row['active_stage_level'] = next_stage_level
                    request_row['active_approver_user_id'] = next_stage_approver.id
                    request_row['approval_stage_started_at'] = now
                    request_row['approval_stage_due_at'] = _get_access_exception_stage_due_at(now, request_row.get('approval_sla_hours'))
                    request_row['approval_task_id'] = next_stage_task.id
                    request_row['approval_task_source_key'] = next_stage_task.source_key or ''
                    request_row['decision_note'] = note

                    changed_fields = [
                        'active_stage_level',
                        'active_approver_user_id',
                        'approval_stage_started_at',
                        'approval_stage_due_at',
                        'approval_stage_history',
                        'approval_task_id',
                        'approval_task_source_key',
                        'decision_note',
                    ]
                    request_rows_storage[request_index] = request_row
                    saved_request_rows = _save_access_exception_requests(request_rows_storage)
                    new_snapshot_serialized = _serialize_access_exception_request_storage(request_row)
                    _create_access_exception_approval_history(
                        request_row=request_row,
                        action='APPROVE',
                        actor=request.user,
                        comments=note,
                        level=current_stage_level,
                    )
                    _create_access_exception_audit_log(
                        request=request,
                        actor=request.user,
                        action='UPDATE',
                        entity_type='UserAccessExceptionRequest',
                        entity_id=_get_access_exception_request_entity_id(request_key),
                        entity_id_str=request_key,
                        entity_code=str(target_user.username),
                        old_values=old_snapshot_serialized,
                        new_values=new_snapshot_serialized,
                        changed_fields=changed_fields,
                    )
                    response_action = 'UPDATE'
                else:
                    old_access = _build_user_access_snapshot(target_user)
                    baseline_role_ids = list(old_access['role_ids'])
                    baseline_team_ids = list(old_access['team_ids'])
                    request_kind = str(request_row.get('request_kind') or 'grant')
                    if request_kind == 'renewal':
                        parent_request_key = str(request_row.get('parent_request_key') or '')
                        parent_request_index = next((index for index, item in enumerate(request_rows_storage) if item.get('key') == parent_request_key), None)
                        if parent_request_index is None:
                            return Response({'error': 'Khong tim thay request goc de gia han.'}, status=status.HTTP_400_BAD_REQUEST)

                        parent_request_row = _serialize_access_exception_request_storage(request_rows_storage[parent_request_index])
                        if str(parent_request_row.get('status') or '') != 'approved':
                            return Response({'error': 'Chi co the gia han request goc da duoc approve.'}, status=status.HTTP_400_BAD_REQUEST)
                        if int(parent_request_row.get('user_id') or 0) != int(target_user.id):
                            return Response({'error': 'Request renewal khong khop voi target user.'}, status=status.HTTP_400_BAD_REQUEST)
                        if str(parent_request_row.get('policy_key') or '') != str(request_row.get('policy_key') or ''):
                            return Response({'error': 'Request renewal phai giu cung policy voi request goc.'}, status=status.HTTP_400_BAD_REQUEST)
                        if str(parent_request_row.get('renewed_by_request_key') or '').strip():
                            return Response({'error': 'Request goc da duoc renewal truoc do.'}, status=status.HTTP_400_BAD_REQUEST)

                        protected_access_ids = _get_access_exception_protected_access_ids(
                            request_rows=request_rows_storage,
                            user_id=target_user.id,
                            exclude_request_keys=[parent_request_key],
                            now=now,
                        )
                        parent_granted_role_ids = set(parent_request_row.get('granted_role_ids') or parent_request_row.get('role_ids') or [])
                        parent_granted_team_ids = set(parent_request_row.get('granted_team_ids') or parent_request_row.get('team_ids') or [])
                        baseline_role_ids = sorted(set(old_access['role_ids']) - (parent_granted_role_ids - set(protected_access_ids.get('role_ids', []))))
                        baseline_team_ids = sorted(set(old_access['team_ids']) - (parent_granted_team_ids - set(protected_access_ids.get('team_ids', []))))

                        parent_old_snapshot = dict(parent_request_row)
                        parent_request_row['status'] = 'renewed'
                        parent_request_row['renewed_by_request_key'] = request_row['key']
                        parent_request_row['renewed_at'] = now
                        request_rows_storage[parent_request_index] = parent_request_row
                        parent_audit_payload = {
                            'request_key': parent_request_key,
                            'entity_code': str(target_user.username),
                            'old_values': _serialize_access_exception_request_storage(parent_old_snapshot),
                            'new_values': _serialize_access_exception_request_storage(parent_request_row),
                            'changed_fields': ['status', 'renewed_by_request_key', 'renewed_at'],
                        }

                    next_role_ids = sorted(set(baseline_role_ids) | set(request_row.get('role_ids', [])))
                    next_team_ids = sorted(set(baseline_team_ids) | set(request_row.get('team_ids', [])))
                    granted_role_ids = sorted(set(next_role_ids) - set(baseline_role_ids))
                    granted_team_ids = sorted(set(next_team_ids) - set(baseline_team_ids))
                    access_changed_fields = []
                    if next_role_ids != old_access['role_ids']:
                        target_user.roles.set(next_role_ids)
                        access_changed_fields.append('roles')
                    if next_team_ids != old_access['team_ids']:
                        target_user.teams.set(next_team_ids)
                        access_changed_fields.append('teams')

                    refreshed_user = self._base_user_queryset().prefetch_related('roles', 'teams').get(pk=target_user.id)
                    new_access = _build_user_access_snapshot(refreshed_user)
                    if access_changed_fields:
                        _create_user_access_audit_log(
                            request=request,
                            actor=request.user,
                            target_user=refreshed_user,
                            old_snapshot=old_access,
                            new_snapshot=new_access,
                            changed_fields=access_changed_fields,
                            strategy='add',
                        )

                    request_row['approval_stage_history'] = approval_stage_history
                    request_row['status'] = 'approved'
                    request_row['approved_by_id'] = request.user.id
                    request_row['approved_at'] = now
                    request_row['decision_note'] = note
                    request_row['approval_stage_started_at'] = None
                    request_row['approval_stage_due_at'] = None
                    request_row['active_approver_user_id'] = None
                    request_row['expires_at'] = now + timedelta(days=int(request_row.get('duration_days') or 7))
                    request_row['granted_role_ids'] = granted_role_ids
                    request_row['granted_team_ids'] = granted_team_ids
                    _close_access_exception_approval_task(request_row.get('approval_task_id'), close_mode='done')
                    changed_fields = [
                        'status',
                        'approved_by_id',
                        'approved_at',
                        'decision_note',
                        'approval_stage_started_at',
                        'approval_stage_due_at',
                        'active_approver_user_id',
                        'approval_stage_history',
                        'expires_at',
                        'granted_role_ids',
                        'granted_team_ids',
                    ]
                    request_rows_storage[request_index] = request_row
                    saved_request_rows = _save_access_exception_requests(request_rows_storage)
                    new_snapshot_serialized = _serialize_access_exception_request_storage(request_row)
                    _create_access_exception_approval_history(
                        request_row=request_row,
                        action='APPROVE',
                        actor=request.user,
                        comments=note,
                        level=current_stage_level,
                    )
                    _create_access_exception_audit_log(
                        request=request,
                        actor=request.user,
                        action='APPROVE',
                        entity_type='UserAccessExceptionRequest',
                        entity_id=_get_access_exception_request_entity_id(request_key),
                        entity_id_str=request_key,
                        entity_code=refreshed_user.username,
                        old_values=old_snapshot_serialized,
                        new_values=new_snapshot_serialized,
                        changed_fields=changed_fields,
                    )
                    if parent_audit_payload is not None:
                        _create_access_exception_audit_log(
                            request=request,
                            actor=request.user,
                            action='UPDATE',
                            entity_type='UserAccessExceptionRequest',
                            entity_id=_get_access_exception_request_entity_id(parent_audit_payload['request_key']),
                            entity_id_str=parent_audit_payload['request_key'],
                            entity_code=parent_audit_payload['entity_code'],
                            old_values=parent_audit_payload['old_values'],
                            new_values=parent_audit_payload['new_values'],
                            changed_fields=parent_audit_payload['changed_fields'],
                        )
            else:
                if current_stage_index is not None and current_stage_index < len(approval_stage_history):
                    approval_stage_history[current_stage_index]['status'] = 'rejected'
                    approval_stage_history[current_stage_index]['decided_at'] = now
                    approval_stage_history[current_stage_index]['decision'] = 'reject'
                    approval_stage_history[current_stage_index]['decision_note'] = note
                request_row['status'] = 'rejected'
                request_row['rejected_by_id'] = request.user.id
                request_row['rejected_at'] = now
                request_row['decision_note'] = note
                request_row['approval_stage_history'] = approval_stage_history
                request_row['approval_stage_started_at'] = None
                request_row['approval_stage_due_at'] = None
                request_row['active_approver_user_id'] = None
                _close_access_exception_approval_task(request_row.get('approval_task_id'), close_mode='cancel')
                changed_fields = [
                    'status',
                    'rejected_by_id',
                    'rejected_at',
                    'decision_note',
                    'approval_stage_history',
                    'approval_stage_started_at',
                    'approval_stage_due_at',
                    'active_approver_user_id',
                ]
                request_rows_storage[request_index] = request_row
                saved_request_rows = _save_access_exception_requests(request_rows_storage)
                new_snapshot_serialized = _serialize_access_exception_request_storage(request_row)
                _create_access_exception_approval_history(
                    request_row=request_row,
                    action='REJECT',
                    actor=request.user,
                    comments=note,
                    level=current_stage_level,
                )
                _create_access_exception_audit_log(
                    request=request,
                    actor=request.user,
                    action='REJECT',
                    entity_type='UserAccessExceptionRequest',
                    entity_id=_get_access_exception_request_entity_id(request_key),
                    entity_id_str=request_key,
                    entity_code=str(request_row.get('policy_name') or request_key),
                    old_values=old_snapshot_serialized,
                    new_values=new_snapshot_serialized,
                    changed_fields=changed_fields,
                )

        policy_rows = _build_access_exception_policy_rows(_load_access_exception_policies())
        final_request_rows = _build_access_exception_request_rows(saved_request_rows, policy_rows)
        final_request = next((item for item in final_request_rows if item.get('key') == request_key), request_row)
        return Response({
            'success': True,
            'request': final_request,
            'action': response_action,
        })

    @action(detail=False, methods=['post'], url_path='access_exception_reroute')
    def access_exception_reroute(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = RerouteAccessExceptionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        request_key = validated['request_key']
        request_rows_storage = _load_access_exception_requests()
        request_index = next((index for index, item in enumerate(request_rows_storage) if item.get('key') == request_key), None)
        if request_index is None:
            return Response({'error': 'Khong tim thay access exception request.'}, status=status.HTTP_404_NOT_FOUND)

        request_row = _serialize_access_exception_request_storage(request_rows_storage[request_index])
        if str(request_row.get('status') or '') != 'pending':
            return Response({'error': 'Chi co the reroute request dang pending.'}, status=status.HTTP_400_BAD_REQUEST)
        current_stage_level = max(1, min(int(request_row.get('active_stage_level') or 1), int(request_row.get('approval_stage_count') or 1)))
        current_active_approver_id = int(request_row.get('active_approver_user_id') or 0)
        if not current_active_approver_id:
            return Response({'error': 'Request nay chua co active approver de reroute.'}, status=status.HTTP_400_BAD_REQUEST)

        policy = next((item for item in _load_access_exception_policies() if item.get('key') == request_row.get('policy_key')), None)
        if policy is None:
            return Response({'error': 'Khong tim thay policy cua request.'}, status=status.HTTP_404_NOT_FOUND)

        target_user = self._base_user_queryset().filter(id=request_row['user_id']).first()
        if target_user is None:
            return Response({'error': 'Khong tim thay target user cua request.'}, status=status.HTTP_404_NOT_FOUND)
        requester_user = self._base_user_queryset().filter(id=request_row.get('requested_by_id')).first() or request.user
        approver_candidates = _build_access_exception_approver_users(limit=40)

        if validated.get('approver_user_id'):
            next_approver = _find_access_exception_approver_user(validated.get('approver_user_id'), candidates=approver_candidates)
            routing_source = 'manual'
            resolution_kind = 'manual'
            resolution_label = _label_access_exception_resolution_kind('manual')
            coverage_note = str(validated.get('note') or '').strip()
        else:
            routing_plan = _build_access_exception_routing_plan(
                policy=policy,
                target_user=target_user,
                requester=requester_user,
                approver_candidates=approver_candidates,
            )
            next_approver = (
                routing_plan.get('selected_stage_two_user')
                if current_stage_level > 1 else routing_plan.get('selected_stage_one_user')
            )
            routing_source = (
                str(routing_plan.get('selected_stage_two_source') or '')
                if current_stage_level > 1 else str(routing_plan.get('selected_stage_one_source') or '')
            )
            resolution_kind = (
                str(routing_plan.get('selected_stage_two_resolution_kind') or '')
                if current_stage_level > 1 else str(routing_plan.get('selected_stage_one_resolution_kind') or '')
            )
            resolution_label = (
                str(routing_plan.get('selected_stage_two_resolution_label') or '')
                if current_stage_level > 1 else str(routing_plan.get('selected_stage_one_resolution_label') or '')
            )
            coverage_note = (
                str(routing_plan.get('selected_stage_two_coverage_note') or '')
                if current_stage_level > 1 else str(routing_plan.get('selected_stage_one_coverage_note') or '')
            )
        if next_approver is None:
            return Response({'error': 'Khong tim thay approver thay the hop le cho reroute.'}, status=status.HTTP_400_BAD_REQUEST)
        if int(next_approver.id) == current_active_approver_id:
            return Response({'error': 'Approver thay the dang trung voi active approver hien tai.'}, status=status.HTTP_400_BAD_REQUEST)
        if int(next_approver.id) == int(target_user.id):
            return Response({'error': 'Khong the reroute cho chinh target user.'}, status=status.HTTP_400_BAD_REQUEST)
        if current_stage_level > 1 and int(request_row.get('approver_user_id') or 0) == int(next_approver.id):
            return Response({'error': 'Stage 2 approver can doc lap voi stage 1 approver.'}, status=status.HTTP_400_BAD_REQUEST)

        old_snapshot_serialized = _serialize_access_exception_request_storage(dict(request_row))
        approval_stage_history = [
            {
                'level': max(1, min(int(item.get('level') or 1), 2)),
                'label': str(item.get('label') or '')[:80],
                'approver_user_id': int(item.get('approver_user_id')) if item.get('approver_user_id') else None,
                'status': str(item.get('status') or 'queued'),
                'started_at': item.get('started_at'),
                'decided_at': item.get('decided_at'),
                'decision': str(item.get('decision') or ''),
                'decision_note': str(item.get('decision_note') or '')[:1000],
            }
            for item in request_row.get('approval_stage_history', [])
            if isinstance(item, dict)
        ]
        stage_index = next(
            (
                index
                for index, item in enumerate(approval_stage_history)
                if int(item.get('level') or 1) == current_stage_level
            ),
            None,
        )
        if stage_index is None:
            return Response({'error': 'Khong tim thay approval stage dang active.'}, status=status.HTTP_400_BAD_REQUEST)

        approval_stage_history[stage_index]['approver_user_id'] = next_approver.id
        request_row['approval_stage_history'] = approval_stage_history
        request_row['active_approver_user_id'] = next_approver.id
        if current_stage_level > 1:
            request_row['stage_two_approver_user_id'] = next_approver.id
            request_row['routing_stage_two_source'] = routing_source
            request_row['routing_stage_two_resolution_kind'] = resolution_kind
            request_row['routing_stage_two_resolution_label'] = resolution_label
            request_row['routing_stage_two_coverage_note'] = coverage_note
        else:
            request_row['approver_user_id'] = next_approver.id
            request_row['routing_stage_one_source'] = routing_source
            request_row['routing_stage_one_resolution_kind'] = resolution_kind
            request_row['routing_stage_one_resolution_label'] = resolution_label
            request_row['routing_stage_one_coverage_note'] = coverage_note
        request_row['continuity_reroute_count'] = int(request_row.get('continuity_reroute_count') or 0) + 1
        request_row['continuity_last_rerouted_at'] = django_timezone.now()
        request_row['continuity_last_reroute_by_id'] = request.user.id
        request_row['continuity_last_reroute_from_user_id'] = current_active_approver_id
        request_row['continuity_last_reroute_note'] = (
            str(validated.get('note') or '').strip()
            or coverage_note
            or f'Rerouted stage {current_stage_level} approver.'
        )[:500]

        with transaction.atomic():
            if request_row.get('approval_task_id'):
                task = Task.objects.filter(id=request_row['approval_task_id']).first()
                if task is not None and task.status in {Task.STATUS_TODO, Task.STATUS_IN_PROGRESS}:
                    task.assigned_to = next_approver
                    task.assigned_by = request.user
                    task.save(update_fields=['assigned_to', 'assigned_by', 'updated_at'])
            request_rows_storage[request_index] = request_row
            saved_request_rows = _save_access_exception_requests(request_rows_storage)

        new_snapshot_serialized = _serialize_access_exception_request_storage(request_row)
        changed_fields = [
            'approval_stage_history',
            'active_approver_user_id',
            'continuity_reroute_count',
            'continuity_last_rerouted_at',
            'continuity_last_reroute_by_id',
            'continuity_last_reroute_from_user_id',
            'continuity_last_reroute_note',
        ]
        if current_stage_level > 1:
            changed_fields.extend([
                'stage_two_approver_user_id',
                'routing_stage_two_source',
                'routing_stage_two_resolution_kind',
                'routing_stage_two_resolution_label',
                'routing_stage_two_coverage_note',
            ])
        else:
            changed_fields.extend([
                'approver_user_id',
                'routing_stage_one_source',
                'routing_stage_one_resolution_kind',
                'routing_stage_one_resolution_label',
                'routing_stage_one_coverage_note',
            ])

        _create_access_exception_audit_log(
            request=request,
            actor=request.user,
            action='UPDATE',
            entity_type='UserAccessExceptionRequest',
            entity_id=_get_access_exception_request_entity_id(request_key),
            entity_id_str=request_key,
            entity_code=target_user.username,
            old_values=old_snapshot_serialized,
            new_values=new_snapshot_serialized,
            changed_fields=changed_fields,
        )

        policy_rows = _build_access_exception_policy_rows(_load_access_exception_policies())
        final_request_rows = _build_access_exception_request_rows(saved_request_rows, policy_rows)
        final_request = next((item for item in final_request_rows if item.get('key') == request_key), request_row)
        return Response({
            'success': True,
            'request': final_request,
            'action': 'UPDATE',
        })

    @action(detail=False, methods=['post'], url_path='access_exception_revoke')
    def access_exception_revoke(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = RevokeAccessExceptionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        request_key = validated['request_key']
        request_rows_storage = _load_access_exception_requests()
        request_index = next((index for index, item in enumerate(request_rows_storage) if item.get('key') == request_key), None)
        if request_index is None:
            return Response({'error': 'Khong tim thay request.'}, status=status.HTTP_404_NOT_FOUND)

        request_row = _serialize_access_exception_request_storage(request_rows_storage[request_index])
        if str(request_row.get('status') or '') != 'approved':
            return Response({'error': 'Chi co the revoke request da duoc approve.'}, status=status.HTTP_400_BAD_REQUEST)

        target_user = self._base_user_queryset().filter(id=request_row['user_id']).first()
        if target_user is None:
            return Response({'error': 'Khong tim thay nguoi dung.'}, status=status.HTTP_404_NOT_FOUND)

        with transaction.atomic():
            revoke_result = _revoke_access_exception_request_row(
                request_row=request_row,
                request_rows_storage=request_rows_storage,
                request_index=request_index,
                target_user=target_user,
                actor=request.user,
                request=request,
                note=str(validated.get('note') or '').strip(),
            )
            saved_request_rows = revoke_result['saved_request_rows']
            request_row = revoke_result['request_row']

        policy_rows = _build_access_exception_policy_rows(_load_access_exception_policies())
        final_request_rows = _build_access_exception_request_rows(saved_request_rows, policy_rows)
        final_request = next((item for item in final_request_rows if item.get('key') == request_key), request_row)
        return Response({
            'success': True,
            'request': final_request,
            'action': 'REVOKE',
        })

    @action(detail=False, methods=['get'], url_path='access_exception_activity')
    def access_exception_activity(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        try:
            limit = int(request.query_params.get('limit') or 20)
        except (TypeError, ValueError):
            return Response({'error': 'limit phai la so nguyen.'}, status=status.HTTP_400_BAD_REQUEST)
        queryset = AuditLog.objects.filter(
            entity_type__in=['UserAccessExceptionPolicy', 'UserAccessExceptionRoutingRule', 'UserAccessExceptionApproverAvailability', 'UserAccessExceptionRequest', 'UserAccessExceptionAutomation', 'UserAccessExceptionSimulation', 'UserAccessExceptionRemediation']
        ).select_related('user')
        return Response({
            'items': _build_access_exception_activity_items(queryset, limit=limit),
            'total': queryset.count(),
        })

    @action(detail=False, methods=['post'], url_path='access_exception_absence_simulation')
    def access_exception_absence_simulation(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = AccessExceptionAbsenceSimulationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        raw_policies = _load_access_exception_policies()
        raw_requests = _load_access_exception_requests()
        routing_rules = _build_access_exception_routing_rule_rows()
        base_policy_rows = _build_access_exception_policy_rows(raw_policies)
        request_rows = _build_access_exception_request_rows(raw_requests, base_policy_rows)
        policy_rows = _build_access_exception_policy_rows(raw_policies, request_rows=request_rows)
        availability_rows = _build_access_exception_approver_availability_rows(
            availability_rows=_load_access_exception_approver_availability(),
            routing_rules=routing_rules,
            request_rows=request_rows,
            approver_candidates=_build_access_exception_approver_candidate_rows(limit=40),
        )
        simulation = _build_access_exception_absence_simulation(
            policy_rows=policy_rows,
            request_rows=request_rows,
            routing_rules=routing_rules,
            approver_candidates=_build_access_exception_approver_users(limit=40),
            availability_rows=availability_rows,
            drill_state=_load_access_exception_continuity_drill_state(),
            approver_user_ids=validated.get('approver_user_ids') or [],
            department_key=validated.get('department_key') or '',
            duration_hours=validated.get('duration_hours') or 24,
        )
        _create_access_exception_audit_log(
            request=request,
            actor=request.user,
            action='CREATE',
            entity_type='UserAccessExceptionSimulation',
            entity_id=0,
            entity_id_str=str(validated.get('department_key') or 'absence-simulation'),
            entity_code='ACCESS_EXCEPTION_ABSENCE_SIMULATION',
            old_values={},
            new_values=simulation,
            changed_fields=['summary', 'simulated_approvers', 'department_key', 'duration_hours'],
        )
        return Response(simulation)

    @action(detail=False, methods=['post'], url_path='access_exception_guided_remediation')
    def access_exception_guided_remediation(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = AccessExceptionGuidedRemediationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        action_type = str(validated.get('action_type') or '')
        note = str(validated.get('note') or '').strip()

        if action_type.startswith('policy_'):
            policy_key = str(validated.get('policy_key') or '')
            existing_policies = _load_access_exception_policies()
            previous_policy = next((item for item in existing_policies if item.get('key') == policy_key), None)
            if previous_policy is None:
                return Response({'error': 'Khong tim thay policy.'}, status=status.HTTP_404_NOT_FOUND)

            policy_payload = _serialize_access_exception_policy_storage(previous_policy)
            if action_type == 'policy_enable_approval':
                policy_payload['requires_approval'] = True
                if not str(policy_payload.get('stage_one_label') or '').strip():
                    policy_payload['stage_one_label'] = 'Manager review'
                summary = f'Khắc phục được gợi ý đã bật cổng phê duyệt cho chính sách {policy_key}.'
            elif action_type == 'policy_upgrade_stage_two':
                policy_payload['requires_approval'] = True
                policy_payload['approval_stage_count'] = 2
                if not str(policy_payload.get('stage_one_label') or '').strip():
                    policy_payload['stage_one_label'] = 'Manager review'
                if not str(policy_payload.get('stage_two_label') or '').strip():
                    policy_payload['stage_two_label'] = 'Governance sign-off'
                summary = f'Khắc phục được gợi ý đã nâng chính sách {policy_key} lên rà soát 2 chặng.'
            else:
                return Response({'error': 'Action remediation khong hop le cho policy.'}, status=status.HTTP_400_BAD_REQUEST)

            next_policies = [item for item in existing_policies if item.get('key') != policy_key]
            next_policies.append(policy_payload)
            saved_policies = _save_access_exception_policies(next_policies)
            request_rows = _build_access_exception_request_rows(
                _load_access_exception_requests(),
                _build_access_exception_policy_rows(saved_policies),
            )
            enriched_policy = next(
                (
                    item
                    for item in _build_access_exception_policy_rows(saved_policies, request_rows=request_rows)
                    if item.get('key') == policy_key
                ),
                policy_payload,
            )
            _create_access_exception_audit_log(
                request=request,
                actor=request.user,
                action='UPDATE',
                entity_type='UserAccessExceptionPolicy',
                entity_id=_get_access_exception_policy_entity_id(policy_key),
                entity_id_str=policy_key,
                entity_code=policy_key,
                old_values=previous_policy,
                new_values=policy_payload,
                changed_fields=_get_snapshot_changed_fields(previous_policy, policy_payload) or list(policy_payload.keys()),
            )
            _create_access_exception_audit_log(
                request=request,
                actor=request.user,
                action='APPLY',
                entity_type='UserAccessExceptionRemediation',
                entity_id=_get_access_exception_policy_entity_id(policy_key),
                entity_id_str=f'{action_type}:{policy_key}',
                entity_code='ACCESS_EXCEPTION_GUIDED_REMEDIATION',
                old_values={},
                new_values={
                    'action_type': action_type,
                    'policy_key': policy_key,
                    'summary': summary,
                    'note': note,
                },
                changed_fields=['action_type', 'policy_key', 'summary'],
            )
            return Response({
                'success': True,
                'action_type': action_type,
                'policy': enriched_policy,
                'action': 'UPDATE',
                'message': summary,
            })

        request_key = str(validated.get('request_key') or '')
        request_rows_storage = _load_access_exception_requests()
        request_index = next((index for index, item in enumerate(request_rows_storage) if item.get('key') == request_key), None)
        if request_index is None:
            return Response({'error': 'Khong tim thay request.'}, status=status.HTTP_404_NOT_FOUND)

        request_row = _serialize_access_exception_request_storage(request_rows_storage[request_index])
        if action_type == 'request_revoke':
            target_user = self._base_user_queryset().filter(id=request_row['user_id']).first()
            if target_user is None:
                return Response({'error': 'Khong tim thay nguoi dung.'}, status=status.HTTP_404_NOT_FOUND)
            with transaction.atomic():
                revoke_result = _revoke_access_exception_request_row(
                    request_row=request_row,
                    request_rows_storage=request_rows_storage,
                    request_index=request_index,
                    target_user=target_user,
                    actor=request.user,
                    request=request,
                    note=note or 'Guided remediation revoked expired exception because access was still present.',
                )
                saved_request_rows = revoke_result['saved_request_rows']
                request_row = revoke_result['request_row']
            action_name = 'REVOKE'
            summary = f'Khắc phục được gợi ý đã thu hồi yêu cầu {request_key}.'
        elif action_type == 'request_reroute':
            try:
                reroute_result = _reroute_access_exception_request_row(
                    request_row=request_row,
                    request_rows_storage=request_rows_storage,
                    request_index=request_index,
                    actor=request.user,
                    request=request,
                    note=note or 'Guided remediation rerouted pending request based on continuity guidance.',
                )
            except LookupError as exc:
                return Response({'error': str(exc)}, status=status.HTTP_404_NOT_FOUND)
            except ValueError as exc:
                return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            saved_request_rows = reroute_result['saved_request_rows']
            request_row = reroute_result['request_row']
            action_name = 'UPDATE'
            summary = f'Khắc phục được gợi ý đã đổi tuyến yêu cầu {request_key}.'
        else:
            return Response({'error': 'Action remediation khong hop le cho request.'}, status=status.HTTP_400_BAD_REQUEST)

        policy_rows = _build_access_exception_policy_rows(_load_access_exception_policies())
        final_request_rows = _build_access_exception_request_rows(saved_request_rows, policy_rows)
        final_request = next((item for item in final_request_rows if item.get('key') == request_key), request_row)
        _create_access_exception_audit_log(
            request=request,
            actor=request.user,
            action='APPLY',
            entity_type='UserAccessExceptionRemediation',
            entity_id=_get_access_exception_request_entity_id(request_key),
            entity_id_str=f'{action_type}:{request_key}',
            entity_code='ACCESS_EXCEPTION_GUIDED_REMEDIATION',
            old_values={},
            new_values={
                'action_type': action_type,
                'request_key': request_key,
                'summary': summary,
                'note': note,
            },
            changed_fields=['action_type', 'request_key', 'summary'],
        )
        return Response({
            'success': True,
            'action_type': action_type,
            'request': final_request,
            'action': action_name,
            'message': summary,
        })

    @action(detail=False, methods=['get'], url_path='access_exception_automation_policy')
    def access_exception_automation_policy(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        return Response(_load_access_exception_automation_policy())

    @access_exception_automation_policy.mapping.post
    def save_access_exception_automation_policy(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = AccessExceptionAutomationPolicySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        previous_policy = _load_access_exception_automation_policy()
        policy = _save_access_exception_automation_policy(serializer.validated_data)
        _create_access_exception_audit_log(
            request=request,
            actor=request.user,
            action='UPDATE',
            entity_type='UserAccessExceptionAutomation',
            entity_id=0,
            entity_id_str='policy',
            entity_code='ACCESS_EXCEPTION_AUTOMATION_POLICY',
            old_values=previous_policy,
            new_values=policy,
            changed_fields=_get_snapshot_changed_fields(previous_policy, policy) or list(policy.keys()),
        )
        return Response({
            'success': True,
            'policy': policy,
        })

    @action(detail=False, methods=['post'], url_path='access_exception_automation_preview')
    def access_exception_automation_preview(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = AccessExceptionAutomationRunSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        result = _run_access_exception_automation(
            automation_policy=_load_access_exception_automation_policy(),
            actor=request.user,
            request=request,
            dry_run=True,
            scope=validated.get('scope') or 'all',
            run_mode='manual-preview',
        )
        result['scheduler_status'] = _get_access_exception_scheduler_status()
        return Response(result)

    @action(detail=False, methods=['post'], url_path='access_exception_run_automation')
    def access_exception_run_automation(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = AccessExceptionAutomationRunSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        result = _run_access_exception_automation(
            automation_policy=_load_access_exception_automation_policy(),
            actor=request.user,
            request=request,
            dry_run=bool(validated.get('dry_run', False)),
            scope=validated.get('scope') or 'all',
            run_mode='manual',
        )
        _create_access_exception_audit_log(
            request=request,
            actor=request.user,
            action='UPDATE',
            entity_type='UserAccessExceptionAutomation',
            entity_id=0,
            entity_id_str='manual-run',
            entity_code='ACCESS_EXCEPTION_AUTOMATION_JOB',
            old_values={},
            new_values={
                **result,
                'status': 'SUCCESS',
            },
            changed_fields=['status', 'scope', 'processed'],
        )
        result['scheduler_status'] = _get_access_exception_scheduler_status()
        return Response(result)

    @action(detail=False, methods=['get'], url_path='access_exception_scheduler_status')
    def access_exception_scheduler_status(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        return Response(_get_access_exception_scheduler_status())

    @access_exception_scheduler_status.mapping.post
    def save_access_exception_scheduler_status(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        try:
            from django_q.models import Schedule
        except Exception:
            return Response({'error': 'Django Q chua san sang.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        previous_status = _get_access_exception_scheduler_status()
        raw_enabled = request.data.get('enabled')
        enabled = True if raw_enabled is None else str(raw_enabled).strip().lower() in {'1', 'true', 'yes', 'on'}
        try:
            interval_minutes = int(request.data.get('interval_minutes') or 30)
        except (TypeError, ValueError):
            return Response({'error': 'interval_minutes phai la so nguyen.'}, status=status.HTTP_400_BAD_REQUEST)
        interval_minutes = max(5, min(interval_minutes, 120))

        schedule, _created = Schedule.objects.get_or_create(
            name=ACCESS_EXCEPTION_AUTOMATION_SCHEDULER_NAME,
            defaults={
                'func': 'core.views.run_access_exception_automation_job',
                'schedule_type': Schedule.MINUTES,
                'minutes': interval_minutes,
                'repeats': -1,
                'next_run': django_timezone.now(),
                'cluster': 'default',
            },
        )
        schedule.func = 'core.views.run_access_exception_automation_job'
        schedule.schedule_type = Schedule.MINUTES
        schedule.minutes = interval_minutes
        schedule.repeats = -1 if enabled else 0
        if enabled and not schedule.next_run:
            schedule.next_run = django_timezone.now()
        schedule.save()
        current_status = _get_access_exception_scheduler_status()
        _create_access_exception_audit_log(
            request=request,
            actor=request.user,
            action='UPDATE',
            entity_type='UserAccessExceptionAutomation',
            entity_id=0,
            entity_id_str='scheduler',
            entity_code='ACCESS_EXCEPTION_AUTOMATION_SCHEDULER',
            old_values=previous_status,
            new_values=current_status,
            changed_fields=_get_snapshot_changed_fields(previous_status, current_status) or ['enabled', 'interval_minutes'],
        )
        return Response({
            'success': True,
            **current_status,
        })

    @action(detail=False, methods=['get'], url_path='provisioning_workspace')
    def provisioning_workspace(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        preset_rows = [preset for preset in _build_onboarding_preset_rows(_load_onboarding_presets()) if preset.get('is_active')]
        activity_queryset = AuditLog.objects.filter(entity_type='UserProvisioning').select_related('user')
        watchlist_items = _build_user_provisioning_watchlist(limit=10)
        return Response({
            'summary': _build_user_provisioning_workspace_summary(preset_rows, watchlist_items=watchlist_items),
            'presets': preset_rows,
            'watchlist': watchlist_items,
            'recent_activity': _build_user_provisioning_activity_items(activity_queryset, limit=8),
            'credential_policy': {
                'default_password_mode': 'generated',
                'minimum_password_hint': 'Mật khẩu tạm thời nên có chữ, số và ký tự đặc biệt.',
                'secure_share_hint': 'Chỉ hiển thị mật khẩu một lần sau khi tạo tài khoản.',
                'rotation_deadline_days': 1,
                'recommended_share_channels': ['Password manager', 'Voice call', 'Secure chat'],
            },
        })

    @action(detail=False, methods=['post'], url_path='provisioning_preview')
    def provisioning_preview(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = UserProvisionPreviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        normalized_username = _normalize_username_candidate(validated.get('username'))
        if not normalized_username:
            return Response({'error': 'Tên đăng nhập không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

        email = str(validated.get('email') or '').strip().lower()
        preset_key = str(validated.get('preset_key') or '').strip().lower()
        preset = None
        if preset_key:
            preset = next((item for item in _load_onboarding_presets() if item.get('key') == preset_key and item.get('is_active')), None)
            if preset is None:
                return Response({'error': 'Mẫu tiếp nhận không tồn tại hoặc đang tạm ngưng.'}, status=status.HTTP_400_BAD_REQUEST)

        role_ids = _resolve_provisioning_access_ids(validated.get('role_ids', []), preset.get('role_ids', []) if preset else [])
        team_ids = _resolve_provisioning_access_ids(validated.get('team_ids', []), preset.get('team_ids', []) if preset else [])
        roles_after = _serialize_access_rows_for_ids(Role, role_ids)
        teams_after = _serialize_access_rows_for_ids(Team, team_ids)

        full_name = f"{validated.get('first_name', '')} {validated.get('last_name', '')}".strip() or normalized_username
        profile = {
            'username': normalized_username,
            'email': email,
            'full_name': full_name,
        }
        notification_default = {
            'email_notifications_enabled': True,
            'email_notification_types': sorted(ACCOUNT_IMPORTANT_NOTIFICATION_TYPES),
        }
        notification_after = _build_onboarding_notification_snapshot(preset, notification_default) if preset else notification_default
        task_preview = _preview_onboarding_tasks_for_profile(profile, preset, roles_after, teams_after) if (preset and validated.get('create_tasks', True)) else []
        security_task_preview = _build_security_task_preview(
            normalized_username,
            full_name,
            include_security_task=validated.get('include_security_task', True),
        )

        username_available = not _username_exists(normalized_username)
        email_available = not _email_exists(email) if email else True
        warnings = []
        if not username_available:
            warnings.append('Tên đăng nhập đã tồn tại. Hãy dùng một gợi ý khác.')
        if email and not email_available:
            warnings.append('Email đã tồn tại trong hệ thống.')
        if preset and preset.get('has_issues'):
            warnings.append('Mẫu tiếp nhận đang có phụ thuộc cần rà soát.')
        if not roles_after:
            warnings.append('Tài khoản chưa được gán vai trò nào.')
        if not teams_after:
            warnings.append('Tài khoản chưa được gán nhóm nào.')
        if not task_preview and not security_task_preview:
            warnings.append('Gói cấp tài khoản hiện tại không tạo đầu việc theo dõi nào.')

        return Response({
            'profile': {
                'username': normalized_username,
                'email': email,
                'first_name': validated.get('first_name', ''),
                'last_name': validated.get('last_name', ''),
                'full_name': full_name,
                'phone': validated.get('phone', ''),
                'is_active': bool(validated.get('is_active', True)),
                'is_staff': bool(validated.get('is_staff', False)),
            },
            'availability': {
                'username_available': username_available,
                'email_available': email_available,
                'username_suggestions': _build_username_suggestions(
                    normalized_username,
                    validated.get('first_name', ''),
                    validated.get('last_name', ''),
                ),
            },
            'preset': next((item for item in _build_onboarding_preset_rows([preset]) if item.get('key') == preset_key), None) if preset else None,
            'roles': roles_after,
            'teams': teams_after,
            'notification_plan': notification_after,
            'task_preview': task_preview,
            'security_task_preview': security_task_preview,
            'summary': {
                'role_count': len(roles_after),
                'team_count': len(teams_after),
                'task_total': len(task_preview) + (1 if security_task_preview else 0),
                'workflow_task_total': len(task_preview),
                'security_task_total': 1 if security_task_preview else 0,
                'create_tasks': bool(validated.get('create_tasks', True)),
            },
            'preflight_checks': _build_user_provisioning_preflight_checks(
                username_available=username_available,
                email_available=email_available,
                roles_after=roles_after,
                teams_after=teams_after,
                task_preview=task_preview,
                security_task_preview=security_task_preview,
                preset=preset,
                create_tasks=bool(validated.get('create_tasks', True)),
                include_security_task=bool(validated.get('include_security_task', True)),
            ),
            'warnings': warnings,
        })

    @action(detail=False, methods=['post'], url_path='provision_user')
    def provision_user(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = CreateProvisionedUserSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        normalized_username = _normalize_username_candidate(validated.get('username'))
        if not normalized_username:
            return Response({'error': 'Tên đăng nhập không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
        if _username_exists(normalized_username):
            return Response({
                'error': 'Tên đăng nhập đã tồn tại.',
                'username_suggestions': _build_username_suggestions(
                    normalized_username,
                    validated.get('first_name', ''),
                    validated.get('last_name', ''),
                ),
            }, status=status.HTTP_400_BAD_REQUEST)

        email = str(validated.get('email') or '').strip().lower()
        if email and _email_exists(email):
            return Response({'error': 'Email đã tồn tại.'}, status=status.HTTP_400_BAD_REQUEST)

        preset_key = str(validated.get('preset_key') or '').strip().lower()
        preset = None
        if preset_key:
            preset = next((item for item in _load_onboarding_presets() if item.get('key') == preset_key and item.get('is_active')), None)
            if preset is None:
                return Response({'error': 'Mẫu tiếp nhận không tồn tại hoặc đang tạm ngưng.'}, status=status.HTTP_400_BAD_REQUEST)

        role_ids = _resolve_provisioning_access_ids(validated.get('role_ids', []), preset.get('role_ids', []) if preset else [])
        team_ids = _resolve_provisioning_access_ids(validated.get('team_ids', []), preset.get('team_ids', []) if preset else [])
        password_mode = str(validated.get('password_mode') or 'generated')
        temporary_password = validated.get('temporary_password') if password_mode == 'custom' else _generate_temporary_password()
        provisional_user = User(
            username=normalized_username,
            email=email,
            first_name=validated.get('first_name', ''),
            last_name=validated.get('last_name', ''),
        )
        validate_password(temporary_password, user=provisional_user)

        created_tasks = []
        skipped_tasks = []
        security_task_created = None
        security_task_skipped = None

        with transaction.atomic():
            user = User.objects.create_user(
                username=normalized_username,
                email=email,
                password=temporary_password,
                first_name=validated.get('first_name', ''),
                last_name=validated.get('last_name', ''),
                phone=validated.get('phone', ''),
                is_active=bool(validated.get('is_active', True)),
                is_staff=bool(validated.get('is_staff', False)),
            )
            if role_ids:
                user.roles.set(role_ids)
            if team_ids:
                user.teams.set(team_ids)

            refreshed_user = self._base_user_queryset().get(pk=user.id)
            old_access = {
                'roles': [],
                'role_ids': [],
                'teams': [],
                'team_ids': [],
            }
            new_access = _build_user_access_snapshot(refreshed_user)

            notification_before = {
                'email_notifications_enabled': True,
                'email_notification_types': sorted(ACCOUNT_IMPORTANT_NOTIFICATION_TYPES),
            }
            notification_after = notification_before
            onboarding_changed_fields = []
            if preset:
                notification_after = _build_onboarding_notification_snapshot(preset, notification_before)
                if notification_after != notification_before:
                    UserPreferences.objects.update_or_create(
                        user=refreshed_user,
                        page='account-center',
                        defaults={'config': notification_after},
                    )
                    onboarding_changed_fields.append('notification_preferences')
                if validated.get('create_tasks', True):
                    created_tasks, skipped_tasks = _create_onboarding_tasks_for_user(
                        refreshed_user,
                        preset,
                        new_access['roles'],
                        new_access['teams'],
                        triggered_by=request.user,
                    )
                    if created_tasks:
                        onboarding_changed_fields.append('tasks')

            if validated.get('include_security_task', True):
                security_task_created, security_task_skipped = _create_password_rotation_task(refreshed_user, request.user)

            access_changed_fields = []
            if new_access['roles']:
                access_changed_fields.append('roles')
            if new_access['teams']:
                access_changed_fields.append('teams')
            if access_changed_fields:
                _create_user_access_audit_log(
                    request=request,
                    actor=request.user,
                    target_user=refreshed_user,
                    old_snapshot=old_access,
                    new_snapshot=new_access,
                    changed_fields=access_changed_fields,
                    strategy='replace',
                )

            if preset:
                preset_changed_fields = list(dict.fromkeys(
                    (['roles'] if new_access['roles'] else [])
                    + (['teams'] if new_access['teams'] else [])
                    + onboarding_changed_fields
                )) or ['preset_key']
                _create_onboarding_audit_log(
                    request=request,
                    actor=request.user,
                    action='UPDATE',
                    entity_type='UserOnboarding',
                    entity_id=refreshed_user.id,
                    entity_id_str=refreshed_user.username,
                    entity_code=refreshed_user.username,
                    old_values={
                        'preset_key': preset_key,
                        'preset_name': preset.get('name'),
                        'roles': [],
                        'teams': [],
                        'notification_preferences': notification_before,
                    },
                    new_values={
                        'preset_key': preset_key,
                        'preset_name': preset.get('name'),
                        'roles': new_access['roles'],
                        'teams': new_access['teams'],
                        'notification_preferences': notification_after,
                        'tasks_created': created_tasks,
                        'tasks_skipped': skipped_tasks,
                        'tasks_created_count': len(created_tasks),
                        'tasks_skipped_count': len(skipped_tasks),
                    },
                    changed_fields=preset_changed_fields,
                )

            provisioning_changed_fields = ['profile']
            if new_access['roles']:
                provisioning_changed_fields.append('roles')
            if new_access['teams']:
                provisioning_changed_fields.append('teams')
            if preset:
                provisioning_changed_fields.append('preset')
            if created_tasks:
                provisioning_changed_fields.append('tasks')
            if security_task_created:
                provisioning_changed_fields.append('security_task')
            if notification_after != notification_before:
                provisioning_changed_fields.append('notification_preferences')

            _create_onboarding_audit_log(
                request=request,
                actor=request.user,
                action='CREATE',
                entity_type='UserProvisioning',
                entity_id=refreshed_user.id,
                entity_id_str=refreshed_user.username,
                entity_code=refreshed_user.username,
                old_values={},
                new_values={
                    'profile': {
                        'username': refreshed_user.username,
                        'email': refreshed_user.email,
                        'first_name': refreshed_user.first_name,
                        'last_name': refreshed_user.last_name,
                        'phone': refreshed_user.phone,
                        'is_active': refreshed_user.is_active,
                        'is_staff': refreshed_user.is_staff,
                    },
                    'credentials': {
                        'password_mode': password_mode,
                        'must_rotate_password': True,
                    },
                    'provisioning': {
                        'preset_key': preset_key,
                        'preset_name': preset.get('name') if preset else '',
                        'roles': new_access['roles'],
                        'teams': new_access['teams'],
                        'tasks_created_count': len(created_tasks),
                        'security_task_created': bool(security_task_created),
                    },
                },
                changed_fields=list(dict.fromkeys(provisioning_changed_fields)),
            )

        created_user = self._get_directory_user_instance(user.id) or self._base_user_queryset().get(pk=user.id)
        return Response({
            'success': True,
            'user': UserDirectorySerializer(created_user, context={'request': request}).data,
            'credentials': {
                'username': normalized_username,
                'temporary_password': temporary_password,
                'password_mode': password_mode,
                'must_rotate_password': True,
                'secure_share_hint': 'Chỉ hiển thị mật khẩu một lần. Hãy chuyển qua kênh an toàn và yêu cầu đổi mật khẩu sau lần đăng nhập đầu tiên.',
            },
            'preset': next((item for item in _build_onboarding_preset_rows([preset]) if item.get('key') == preset_key), None) if preset else None,
            'roles': new_access['roles'],
            'teams': new_access['teams'],
            'notification_plan': notification_after,
            'tasks_created': created_tasks,
            'tasks_skipped': skipped_tasks,
            'security_task_created': security_task_created,
            'security_task_skipped': security_task_skipped,
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='provisioning_activity')
    def provisioning_activity(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        try:
            limit = int(request.query_params.get('limit') or 20)
        except (TypeError, ValueError):
            return Response({'error': 'limit phai la so nguyen.'}, status=status.HTTP_400_BAD_REQUEST)
        queryset = AuditLog.objects.filter(entity_type='UserProvisioning').select_related('user')
        return Response({
            'items': _build_user_provisioning_activity_items(queryset, limit=limit),
            'total': queryset.count(),
        })

    @action(detail=False, methods=['get'], url_path='offboarding_workspace')
    def offboarding_workspace(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        candidate_rows = _build_user_lifecycle_candidate_rows(limit=160, exclude_user_id=request.user.id)
        watchlist_items = _build_user_offboarding_watchlist(limit=10, exclude_user_id=request.user.id)
        activity_queryset = AuditLog.objects.filter(entity_type='UserOffboarding').select_related('user')
        return Response({
            'summary': _build_user_offboarding_workspace_summary(watchlist_items, candidate_rows),
            'candidates': candidate_rows,
            'watchlist': watchlist_items,
            'recent_activity': _build_user_offboarding_activity_items(activity_queryset, limit=8),
            'policy': {
                'require_task_handoff': True,
                'default_deactivate_account': True,
                'default_lock_account': True,
                'default_revoke_access': True,
                'default_revoke_sessions': True,
            },
        })

    @action(detail=False, methods=['post'], url_path='offboarding_preview')
    def offboarding_preview(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = UserOffboardingPreviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        if int(validated['user_id']) == int(request.user.id):
            is_self_target = True
        else:
            is_self_target = False

        user = self._get_directory_user_instance(validated['user_id'])
        if user is None:
            return Response({'error': 'Người dùng không tồn tại.'}, status=status.HTTP_404_NOT_FOUND)

        transfer_target = None
        transfer_target_id = validated.get('transfer_task_owner_id')
        if transfer_target_id:
            transfer_target = self._base_user_queryset().filter(id=transfer_target_id, is_active=True).first()
            if transfer_target is None:
                return Response({'error': 'Người nhận bàn giao không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

        access_snapshot = _build_user_access_snapshot(user)
        open_tasks = Task.objects.filter(
            assigned_to_id=user.id,
            status__in=[Task.STATUS_TODO, Task.STATUS_IN_PROGRESS],
        )
        open_task_count = open_tasks.count()
        blocking_task_count = open_tasks.filter(is_blocking=True).count()
        overdue_task_count = open_tasks.filter(due_date__lt=django_timezone.now().date()).count()
        active_session_count = int(getattr(user, 'active_session_count', 0) or 0)

        warnings = []
        if is_self_target:
            warnings.append('Không thể kết thúc vòng đời chính tài khoản đang thao tác.')
        if getattr(user, 'is_superuser', False):
            warnings.append('Không nên kết thúc vòng đời superuser hệ thống từ màn này.')
        if open_task_count > 0 and transfer_target is None:
            warnings.append('Cần chọn người nhận bàn giao cho các đầu việc đang mở.')
        if active_session_count > 0 and not validated.get('revoke_sessions', True):
            warnings.append('Tài khoản vẫn còn phiên đang mở nếu không thu hồi phiên.')
        if (access_snapshot['roles'] or access_snapshot['teams']) and not validated.get('revoke_access', True):
            warnings.append('Tài khoản sẽ tiếp tục giữ vai trò/nhóm nếu không thu hồi quyền.')

        return Response({
            'user': UserDirectorySerializer(user, context={'request': request}).data,
            'access': {
                'roles': access_snapshot['roles'],
                'teams': access_snapshot['teams'],
                'role_count': len(access_snapshot['roles']),
                'team_count': len(access_snapshot['teams']),
            },
            'sessions': {
                'active_session_count': active_session_count,
                'last_seen_at': getattr(user, 'last_seen_at', None),
                'last_login_at': getattr(user, 'last_login_at', None),
                'last_seen_ip': getattr(user, 'last_seen_ip', None),
            },
            'tasks': {
                'open_task_count': open_task_count,
                'blocking_task_count': blocking_task_count,
                'overdue_task_count': overdue_task_count,
            },
            'transfer_target': (
                {
                    'id': transfer_target.id,
                    'username': transfer_target.username,
                    'full_name': transfer_target.get_full_name() or transfer_target.username,
                }
                if transfer_target is not None else None
            ),
            'actions': {
                'deactivate_account': bool(validated.get('deactivate_account', True)),
                'lock_account': bool(validated.get('lock_account', True)),
                'revoke_access': bool(validated.get('revoke_access', True)),
                'revoke_sessions': bool(validated.get('revoke_sessions', True)),
                'transfer_open_tasks': transfer_target is not None,
            },
            'preflight_checks': _build_user_offboarding_preflight_checks(
                is_self_target=is_self_target,
                is_superuser_target=bool(getattr(user, 'is_superuser', False)),
                active_session_count=active_session_count,
                open_task_count=open_task_count,
                role_count=len(access_snapshot['roles']),
                team_count=len(access_snapshot['teams']),
                transfer_target=transfer_target,
                deactivate_account=bool(validated.get('deactivate_account', True)),
                lock_account=bool(validated.get('lock_account', True)),
                revoke_access=bool(validated.get('revoke_access', True)),
                revoke_sessions=bool(validated.get('revoke_sessions', True)),
            ),
            'warnings': warnings,
        })

    @action(detail=False, methods=['post'], url_path='offboard_user')
    def offboard_user(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        serializer = ApplyUserOffboardingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        if int(validated['user_id']) == int(request.user.id):
            return Response({'error': 'Không thể kết thúc vòng đời chính tài khoản đang thao tác.'}, status=status.HTTP_400_BAD_REQUEST)

        user = self._base_user_queryset().filter(id=validated['user_id']).first()
        if user is None:
            return Response({'error': 'Người dùng không tồn tại.'}, status=status.HTTP_404_NOT_FOUND)
        if getattr(user, 'is_superuser', False):
            return Response({'error': 'Không hỗ trợ kết thúc vòng đời superuser từ màn này.'}, status=status.HTTP_400_BAD_REQUEST)

        transfer_target = None
        transfer_target_id = validated.get('transfer_task_owner_id')
        if transfer_target_id:
            transfer_target = self._base_user_queryset().filter(id=transfer_target_id, is_active=True).first()
            if transfer_target is None:
                return Response({'error': 'Người nhận bàn giao không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

        open_tasks_queryset = Task.objects.filter(
            assigned_to_id=user.id,
            status__in=[Task.STATUS_TODO, Task.STATUS_IN_PROGRESS],
        )
        open_task_count = open_tasks_queryset.count()
        if open_task_count > 0 and transfer_target is None:
            return Response({'error': 'Cần chọn người nhận bàn giao cho các đầu việc đang mở.'}, status=status.HTTP_400_BAD_REQUEST)

        old_user_snapshot = self._get_directory_user_instance(user.id) or self._base_user_queryset().get(pk=user.id)
        old_access = _build_user_access_snapshot(old_user_snapshot)
        active_session_count = int(getattr(old_user_snapshot, 'active_session_count', 0) or 0)

        tasks_transferred_count = 0
        sessions_revoked_count = 0

        with transaction.atomic():
            if transfer_target is not None and open_task_count > 0:
                tasks_transferred_count = open_tasks_queryset.update(
                    assigned_to=transfer_target,
                    updated_at=django_timezone.now(),
                )

            if validated.get('revoke_sessions', True):
                sessions_revoked_count = UserSession.objects.filter(user=user, is_active=True).update(
                    is_active=False,
                    logout_at=django_timezone.now(),
                )

            if validated.get('revoke_access', True):
                user.roles.clear()
                user.teams.clear()

            update_fields = []
            if validated.get('deactivate_account', True) and user.is_active:
                user.is_active = False
                update_fields.append('is_active')
            if validated.get('lock_account', True) and not user.is_locked:
                user.is_locked = True
                user.locked_at = django_timezone.now()
                user.locked_by = request.user
                update_fields.extend(['is_locked', 'locked_at', 'locked_by'])
            if update_fields:
                user.save(update_fields=list(dict.fromkeys(update_fields)))

            refreshed_user = self._get_directory_user_instance(user.id) or self._base_user_queryset().get(pk=user.id)
            new_access = _build_user_access_snapshot(refreshed_user)

            if validated.get('revoke_access', True) and (old_access['roles'] or old_access['teams']):
                changed_fields = []
                if old_access['roles']:
                    changed_fields.append('roles')
                if old_access['teams']:
                    changed_fields.append('teams')
                _create_user_access_audit_log(
                    request=request,
                    actor=request.user,
                    target_user=refreshed_user,
                    old_snapshot=old_access,
                    new_snapshot=new_access,
                    changed_fields=changed_fields,
                    strategy='replace',
                )

            _create_onboarding_audit_log(
                request=request,
                actor=request.user,
                action='UPDATE',
                entity_type='UserOffboarding',
                entity_id=refreshed_user.id,
                entity_id_str=refreshed_user.username,
                entity_code=refreshed_user.username,
                old_values={
                    'account_state': {
                        'is_active': old_user_snapshot.is_active,
                        'is_locked': old_user_snapshot.is_locked,
                        'active_session_count': active_session_count,
                    },
                    'access': {
                        'roles': old_access['roles'],
                        'teams': old_access['teams'],
                    },
                },
                new_values={
                    'account_state': {
                        'is_active': refreshed_user.is_active,
                        'is_locked': refreshed_user.is_locked,
                    },
                    'cleanup': {
                        'tasks_transferred_count': tasks_transferred_count,
                        'sessions_revoked_count': sessions_revoked_count,
                        'revoke_access': bool(validated.get('revoke_access', True)),
                        'transfer_target_username': transfer_target.username if transfer_target is not None else '',
                    },
                    'access': {
                        'roles': new_access['roles'],
                        'teams': new_access['teams'],
                    },
                },
                changed_fields=[
                    'account_state',
                    'sessions' if sessions_revoked_count else 'sessions_skipped',
                    'tasks' if tasks_transferred_count else 'tasks_skipped',
                    'access' if validated.get('revoke_access', True) else 'access_retained',
                ],
            )

        final_user = self._get_directory_user_instance(user.id) or self._base_user_queryset().get(pk=user.id)
        return Response({
            'success': True,
            'user': UserDirectorySerializer(final_user, context={'request': request}).data,
            'cleanup': {
                'tasks_transferred_count': tasks_transferred_count,
                'sessions_revoked_count': sessions_revoked_count,
                'revoke_access': bool(validated.get('revoke_access', True)),
                'transfer_target': (
                    {
                        'id': transfer_target.id,
                        'username': transfer_target.username,
                        'full_name': transfer_target.get_full_name() or transfer_target.username,
                    }
                    if transfer_target is not None else None
                ),
            },
            'actions': {
                'deactivate_account': bool(validated.get('deactivate_account', True)),
                'lock_account': bool(validated.get('lock_account', True)),
                'revoke_access': bool(validated.get('revoke_access', True)),
                'revoke_sessions': bool(validated.get('revoke_sessions', True)),
            },
        })

    @action(detail=False, methods=['get'], url_path='offboarding_activity')
    def offboarding_activity(self, request):
        self._ensure_manage_user_directory_permission(request.user)
        try:
            limit = int(request.query_params.get('limit') or 20)
        except (TypeError, ValueError):
            return Response({'error': 'limit phai la so nguyen.'}, status=status.HTTP_400_BAD_REQUEST)
        queryset = AuditLog.objects.filter(entity_type='UserOffboarding').select_related('user')
        return Response({
            'items': _build_user_offboarding_activity_items(queryset, limit=limit),
            'total': queryset.count(),
        })

    @action(detail=False, methods=['get'], url_path='admin_observability_workspace')
    def admin_observability_workspace(self, request):
        if not _can_view_admin_observability(request.user):
            return Response({'error': 'Bạn không có quyền xem trung tâm sức khỏe hệ thống.'}, status=status.HTTP_403_FORBIDDEN)

        try:
            hours = int(request.query_params.get('hours') or 24)
        except (TypeError, ValueError):
            return Response({'error': 'hours phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            incident_limit = int(request.query_params.get('incident_limit') or 12)
        except (TypeError, ValueError):
            return Response({'error': 'incident_limit phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            activity_limit = int(request.query_params.get('activity_limit') or 10)
        except (TypeError, ValueError):
            return Response({'error': 'activity_limit phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(_build_admin_observability_workspace_payload(
            request.user,
            hours=hours,
            incident_limit=incident_limit,
            activity_limit=activity_limit,
        ))

    @action(detail=False, methods=['post'], url_path='admin_observability_alert_drill')
    def admin_observability_alert_drill(self, request):
        if not _can_view_admin_observability(request.user):
            return Response({'error': 'Ban khong co quyen chay alert drill.'}, status=status.HTTP_403_FORBIDDEN)

        payload = request.data if isinstance(request.data, dict) else {}
        channels_raw = payload.get('channels') or []
        if isinstance(channels_raw, str):
            channels = [item.strip() for item in channels_raw.split(',') if item.strip()]
        elif isinstance(channels_raw, (list, tuple)):
            channels = [str(item).strip() for item in channels_raw if str(item).strip()]
        else:
            channels = []
        result = send_operational_alert(
            title=str(payload.get('title') or 'ERP Carton test alert'),
            message=str(payload.get('message') or 'Manual alert drill from Admin Observability workspace.'),
            severity=str(payload.get('severity') or 'warning').lower(),
            channels=channels or None,
            actor=request.user,
            metadata={'source': 'admin_observability_alert_drill'},
            is_test=True,
        )
        return Response(result)

    @action(detail=False, methods=['get'], url_path='admin_observability_go_live_handoff')
    def admin_observability_go_live_handoff(self, request):
        if not _can_view_admin_observability(request.user):
            return Response({'error': 'Ban khong co quyen xem go-live handoff.'}, status=status.HTTP_403_FORBIDDEN)

        environment = str(request.query_params.get('environment') or 'staging').strip().lower()
        if environment not in {'staging', 'uat', 'production'}:
            return Response({'error': 'environment khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = _run_command_json_payload('go_live_handoff', f'--environment={environment}')
        except Exception as exc:
            return Response({'error': f'Khong the tao go-live handoff: {exc}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response(payload)

    @action(detail=False, methods=['get'], url_path='admin_observability_alert_readiness')
    def admin_observability_alert_readiness(self, request):
        if not _can_view_admin_observability(request.user):
            return Response({'error': 'Ban khong co quyen xem alert readiness.'}, status=status.HTTP_403_FORBIDDEN)
        try:
            hours = int(request.query_params.get('hours') or 24)
        except (TypeError, ValueError):
            return Response({'error': 'hours phai la so nguyen.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = _run_command_json_payload('alert_channel_readiness', f'--hours={hours}')
        except Exception as exc:
            return Response({'error': f'Khong the tao alert readiness: {exc}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response(payload)

    @action(detail=False, methods=['get'], url_path='admin_observability_release_cleanup_preview')
    def admin_observability_release_cleanup_preview(self, request):
        if not _can_view_admin_observability(request.user):
            return Response({'error': 'Ban khong co quyen xem cleanup preview.'}, status=status.HTTP_403_FORBIDDEN)
        try:
            payload = _run_command_json_payload('cleanup_release_artifacts')
        except Exception as exc:
            return Response({'error': f'Khong the tao cleanup preview: {exc}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response(payload)

    @action(detail=False, methods=['get'], url_path='admin_observability_release_lockfile')
    def admin_observability_release_lockfile(self, request):
        if not _can_view_admin_observability(request.user):
            return Response({'error': 'Ban khong co quyen xuat release lockfile.'}, status=status.HTTP_403_FORBIDDEN)

        environment = str(request.query_params.get('environment') or 'staging').strip().lower()
        if environment not in {'staging', 'uat', 'production'}:
            return Response({'error': 'environment khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = _run_command_json_payload('release_lockfile', f'--environment={environment}')
        except Exception as exc:
            return Response({'error': f'Khong the tao release lockfile: {exc}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response(payload)

    @action(detail=False, methods=['get'], url_path='admin_observability_performance_drilldown')
    def admin_observability_performance_drilldown(self, request):
        if not _can_view_admin_observability(request.user):
            return Response({'error': 'Ban khong co quyen xem performance drilldown.'}, status=status.HTTP_403_FORBIDDEN)

        args = ['performance_drilldown']
        include_all = _parse_query_bool(request.query_params.get('include_all'))
        if include_all:
            args.append('--include-all')
        sample_size_raw = request.query_params.get('sample_size')
        try:
            if sample_size_raw is not None and str(sample_size_raw).strip():
                args.append(f'--sample-size={int(sample_size_raw)}')
        except (TypeError, ValueError):
            return Response({'error': 'sample_size phai la so nguyen.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = _run_command_json_payload(*args)
        except Exception as exc:
            return Response({'error': f'Khong the tao performance drilldown: {exc}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response(payload)

    @action(detail=False, methods=['get'], url_path='access_governance_surface_audit')
    def access_governance_surface_audit(self, request):
        if not _can_view_access_governance_center(request.user):
            return Response({'error': 'Ban khong co quyen xem surface audit governance.'}, status=status.HTTP_403_FORBIDDEN)

        args = ['permission_surface_audit']
        threshold_raw = request.query_params.get('low_coverage_threshold')
        try:
            if threshold_raw is not None and str(threshold_raw).strip():
                args.append(f'--low-coverage-threshold={int(threshold_raw)}')
        except (TypeError, ValueError):
            return Response({'error': 'low_coverage_threshold phai la so nguyen.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = _run_command_json_payload(*args)
        except Exception as exc:
            return Response({'error': f'Khong the tao surface audit governance: {exc}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response(payload)


    @action(detail=False, methods=['get'], url_path='admin_audit_workspace')
    def admin_audit_workspace(self, request):
        if not _can_view_admin_audit(request.user):
            return Response({'error': 'Bạn không có quyền xem trung tâm kiểm soát audit.'}, status=status.HTTP_403_FORBIDDEN)

        try:
            hours = int(request.query_params.get('hours') or 72)
        except (TypeError, ValueError):
            return Response({'error': 'hours phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            limit = int(request.query_params.get('limit') or 40)
        except (TypeError, ValueError):
            return Response({'error': 'limit phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(_build_admin_audit_workspace_payload(
            request.user,
            hours=hours,
            limit=limit,
        ))

    @action(detail=False, methods=['get'], url_path='admin_audit_retention_preview')
    def admin_audit_retention_preview(self, request):
        if not _can_view_admin_audit(request.user):
            return Response({'error': 'Ban khong co quyen xem retention preview.'}, status=status.HTTP_403_FORBIDDEN)

        days_raw = request.query_params.get('days')
        try:
            if days_raw is not None and str(days_raw).strip():
                payload = _run_command_json_payload('purge_audit_logs', f'--days={int(days_raw)}', '--dry-run')
            else:
                payload = _run_command_json_payload('purge_audit_logs', '--dry-run')
        except (TypeError, ValueError):
            return Response({'error': 'days phai la so nguyen.'}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            return Response({'error': f'Khong the chay retention preview: {exc}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response(payload)

    @action(detail=False, methods=['get'], url_path='admin_audit_export')
    def admin_audit_export(self, request):
        if not _can_view_admin_audit(request.user):
            return Response({'error': 'Ban khong co quyen xuat audit.'}, status=status.HTTP_403_FORBIDDEN)

        try:
            hours = int(request.query_params.get('hours') or 72)
        except (TypeError, ValueError):
            return Response({'error': 'hours phai la so nguyen.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            limit = int(request.query_params.get('limit') or 200)
        except (TypeError, ValueError):
            return Response({'error': 'limit phai la so nguyen.'}, status=status.HTTP_400_BAD_REQUEST)

        format_type = str(
            request.query_params.get('export_format')
            or request.query_params.get('file_format')
            or 'csv'
        ).strip().lower()
        domain_filter = str(request.query_params.get('domain') or 'ALL').strip()
        export_limit = min(limit, int(getattr(settings, 'AUDIT_EXPORT_MAX_ROWS', 5000) or 5000))
        items = _collect_admin_audit_activity_items(
            request.user,
            hours=hours,
            limit=export_limit,
            domain_filter=domain_filter,
        )

        AuditLog.objects.create(
            user=request.user,
            action='EXPORT',
            entity_type='AdminAuditExport',
            entity_id=0,
            entity_id_str='admin-audit',
            entity_code='ADMIN_AUDIT_EXPORT',
            old_values={},
            new_values={
                'format': format_type,
                'hours': hours,
                'limit': export_limit,
                'domain': domain_filter,
                'exported_count': len(items),
            },
            changed_fields=['format', 'exported_count'],
        )

        timestamp = django_timezone.now().strftime('%Y%m%d%H%M%S')
        if format_type == 'json':
            response = HttpResponse(
                json.dumps(
                    {
                        'hours_window': hours,
                        'domain_filter': domain_filter,
                        'count': len(items),
                        'items': items,
                    },
                    ensure_ascii=False,
                    default=str,
                ),
                content_type='application/json',
            )
            response['Content-Disposition'] = f'attachment; filename=\"admin_audit_export_{timestamp}.json\"'
            return response

        response = HttpResponse(content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = f'attachment; filename=\"admin_audit_export_{timestamp}.csv\"'
        writer = csv.writer(response)
        writer.writerow([
            'timestamp',
            'domain',
            'severity',
            'action',
            'entity_type',
            'entity_code',
            'summary',
            'actor',
            'route',
            'comments',
        ])
        for item in items:
            writer.writerow([
                item.get('created_at'),
                item.get('domain'),
                item.get('severity'),
                item.get('action_label') or item.get('action'),
                item.get('entity_type'),
                item.get('entity_code'),
                item.get('summary'),
                item.get('actor_label'),
                item.get('route'),
                item.get('comments'),
            ])
        return response


class UserPreferencesViewSet(viewsets.ViewSet):
    """
    API cho user preferences
    GET/POST/DELETE /api/preferences/{page}/
    """
    serializer_class = UserPreferencesSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return UserPreferences.objects.filter(user=self.request.user)

    def page_config(self, request, page=None):
        """Get/Save/Delete config cho page"""
        if request.method == 'GET':
            try:
                pref = UserPreferences.objects.get(user=request.user, page=page)
                serializer = UserPreferencesSerializer(pref)
                return Response(serializer.data)
            except UserPreferences.DoesNotExist:
                return Response({'config': {}}, status=status.HTTP_200_OK)

        elif request.method == 'POST':
            config = request.data.get('config', {})
            pref, created = UserPreferences.objects.update_or_create(
                user=request.user,
                page=page,
                defaults={'config': config}
            )
            serializer = UserPreferencesSerializer(pref)
            return Response(serializer.data, status=status.HTTP_200_OK)

        elif request.method == 'DELETE':
            UserPreferences.objects.filter(user=request.user, page=page).delete()
            return Response(status=status.HTTP_204_NO_CONTENT)


class ColumnPermissionViewSet(viewsets.ModelViewSet):
    """
    API quản lý phân quyền cột
    GET /api/column-permissions/{page}/available/ → Lấy cột được phép
    """
    queryset = ColumnPermission.objects.all()
    serializer_class = ColumnPermissionSerializer
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['get'], url_path=r'(?P<page>[^/.]+)/available')
    def available_columns(self, request, page=None):
        """
        Trả về danh sách cột user được phép xem
        Response: {available_columns: [...], restricted_columns: [...]}
        """
        user = request.user
        permissions = ColumnPermission.objects.filter(page=page, is_active=True)

        # Debug log
        # NOTE: Keep logs ASCII-safe for Windows consoles (avoid emoji -> UnicodeEncodeError)
        print(f"\n[ColumnPermission] page={page}, user={user.username} (id={user.id})")
        print(f"   user.roles: {list(user.roles.values_list('code', flat=True))}")
        print(f"   permissions count: {permissions.count()}")

        available = []
        restricted = []
        for perm in permissions:
            if perm.user_has_permission(user):
                available.append(perm.column)
            else:
                restricted.append(perm.column)

        user_roles_list = list(user.roles.values_list('code', flat=True))
        print(f"   Result: available={available}, restricted={restricted}, user_roles={user_roles_list}")
        return Response({
            'page': page,
            'available_columns': available,
            'restricted_columns': restricted,
            'user_roles': user_roles_list,
            'user_id': user.id,
        })


class RoleViewSet(ExportExcelMixin, viewsets.ModelViewSet):
    """Master Data chuẩn: filterset + search + ordering + soft delete + bulk + export."""
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [IsAuthenticated]
    export_template_entity_type = 'Role'
    filter_backends = [
        django_filters.rest_framework.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_class = RoleFilter
    search_fields = ['code', 'name', 'description']
    ordering_fields = ['code', 'name', 'sort_order', 'created_at']
    ordering = ['sort_order', 'name']

    def get_serializer_class(self):
        if self.action in {'create', 'update', 'partial_update'}:
            return RoleWriteSerializer
        return RoleSerializer

    def get_queryset(self):
        return _annotate_role_governance_queryset(super().get_queryset())

    @staticmethod
    def _can_manage_module_permissions(user):
        if not user or not user.is_authenticated:
            return False
        if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
            return True
        return check_action_permission(user, 'CORE', 'MANAGE_RBAC', strict=True)

    @staticmethod
    def _get_module_permission_map():
        query = models.Q()
        for row in MODULE_PERMISSION_FIELDS:
            query |= models.Q(resource=row['resource'], action=row['action'])
        perms = Permission.objects.filter(query)
        return {f'{perm.resource}:{perm.action}': perm for perm in perms}

    @staticmethod
    def _module_permission_keys():
        return [row['field'] for row in MODULE_PERMISSION_FIELDS]

    @staticmethod
    def _freeze_cache_key(user_id):
        return f'rbac:module-freeze:user:{int(user_id)}'

    @staticmethod
    def _freeze_prepare_cache_key(token):
        return f'rbac:module-freeze:prepare:{token}'

    @classmethod
    def _get_freeze_payload(cls, user_id):
        if not user_id:
            return None
        payload = cache.get(cls._freeze_cache_key(user_id))
        return payload if isinstance(payload, dict) else None

    def _ensure_manage_role_catalog_permission(self, user):
        if not self._can_manage_module_permissions(user):
            raise PermissionDenied('Ban khong co quyen quan tri role va team.')

    def _get_role_instance(self, role_id):
        return self.get_queryset().filter(pk=role_id).first()

    def create(self, request, *args, **kwargs):
        self._ensure_manage_role_catalog_permission(request.user)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        role = serializer.save(created_by=request.user, updated_by=request.user)
        role = self._get_role_instance(role.id) or role
        snapshot = _serialize_role_snapshot(role)
        _create_catalog_audit_log(
            request=request,
            actor=request.user,
            action='CREATE',
            entity_type='Role',
            entity_id=role.id,
            entity_code=role.code,
            old_values={},
            new_values=snapshot,
            changed_fields=['code', 'name', 'description', 'is_active', 'sort_order', 'permissions'],
        )
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def update(self, request, *args, **kwargs):
        self._ensure_manage_role_catalog_permission(request.user)
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        old_snapshot = _serialize_role_snapshot(instance)
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        refreshed = self._get_role_instance(instance.id) or instance
        new_snapshot = _serialize_role_snapshot(refreshed)
        changed_fields = _get_snapshot_changed_fields(old_snapshot, new_snapshot)
        if changed_fields:
            _create_catalog_audit_log(
                request=request,
                actor=request.user,
                action='UPDATE',
                entity_type='Role',
                entity_id=refreshed.id,
                entity_code=refreshed.code,
                old_values=old_snapshot,
                new_values=new_snapshot,
                changed_fields=changed_fields,
            )
        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        self._ensure_manage_role_catalog_permission(request.user)
        instance = self.get_object()
        old_snapshot = _serialize_role_snapshot(instance)
        instance.deleted_at = django_timezone.now()
        instance.deleted_by = request.user
        instance.updated_by = request.user
        instance.save(update_fields=['deleted_at', 'deleted_by', 'updated_by', 'updated_at'])
        _create_catalog_audit_log(
            request=request,
            actor=request.user,
            action='DELETE',
            entity_type='Role',
            entity_id=instance.id,
            entity_code=instance.code,
            old_values=old_snapshot,
            new_values={**old_snapshot, 'deleted_at': instance.deleted_at.isoformat() if instance.deleted_at else None},
            changed_fields=['deleted_at'],
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        ids = request.data.get('ids', [])
        Role.objects.filter(id__in=ids, deleted_at__isnull=True).update(is_active=True)
        return Response({'message': f'Đã kích hoạt {len(ids)} role'})

    @action(detail=False, methods=['post'])
    def bulk_deactivate(self, request):
        ids = request.data.get('ids', [])
        Role.objects.filter(id__in=ids, deleted_at__isnull=True).update(is_active=False)
        return Response({'message': f'Đã vô hiệu hóa {len(ids)} role'})

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        ids = request.data.get('ids', [])
        now = django_timezone.now()
        Role.objects.filter(id__in=ids).update(deleted_at=now, deleted_by=request.user)
        return Response({'message': f'Đã xóa (soft) {len(ids)} role'})

    @action(detail=False, methods=['get'])
    def module_permissions(self, request):
        if not self._can_manage_module_permissions(request.user):
            return Response({'error': 'Bạn không có quyền xem cấu hình quyền module.'}, status=403)

        perm_map = self._get_module_permission_map()
        roles = (
            Role.objects
            .filter(deleted_at__isnull=True)
            .prefetch_related('permissions')
            .order_by('sort_order', 'name')
        )
        items = []
        for role in roles:
            assigned_ids = {perm.id for perm in role.permissions.all()}
            items.append({
                'role_id': role.id,
                'role_code': role.code,
                'role_name': role.name,
                'is_active': role.is_active,
                **{
                    row['field']: bool(
                        perm_map.get(f"{row['resource']}:{row['action']}")
                        and perm_map[f"{row['resource']}:{row['action']}"].id in assigned_ids
                    )
                    for row in MODULE_PERMISSION_FIELDS
                },
            })
        return Response({
            'items': items,
            'field_meta': [
                {'field': row['field'], 'label': row['label'], 'changed_type': row['changed_type']}
                for row in MODULE_PERMISSION_FIELDS
            ],
        })

    @module_permissions.mapping.post
    def update_module_permissions(self, request):
        if not self._can_manage_module_permissions(request.user):
            return Response({'error': 'Bạn không có quyền cập nhật cấu hình quyền module.'}, status=403)
        freeze_payload = self._get_freeze_payload(request.user.id)
        if freeze_payload:
            frozen_until = freeze_payload.get('frozen_until') or ''
            reason = str(freeze_payload.get('reason') or '').strip()
            msg = f'Tài khoản đang bị đóng băng quyền thay đổi phân quyền đến {frozen_until}.'
            if reason:
                msg = f'{msg} Lý do: {reason}'
            return Response({'error': msg}, status=403)

        raw_items = request.data.get('items', [])
        if not isinstance(raw_items, list) or not raw_items:
            return Response({'error': 'items là bắt buộc và phải là mảng.'}, status=400)

        perm_map = self._get_module_permission_map()
        if any(perm_map.get(f"{row['resource']}:{row['action']}") is None for row in MODULE_PERMISSION_FIELDS):
            return Response({'error': 'Thiếu permission hệ thống, vui lòng chạy migration mới nhất.'}, status=400)
        rbac_field = next(row for row in MODULE_PERMISSION_FIELDS if row['field'] == 'rbac_manage')
        rbac_perm = perm_map[f"{rbac_field['resource']}:{rbac_field['action']}"]

        role_ids = []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            role_id = item.get('role_id')
            if isinstance(role_id, int):
                role_ids.append(role_id)
        if not role_ids:
            return Response({'error': 'Không có role_id hợp lệ.'}, status=400)

        roles = {r.id: r for r in Role.objects.filter(id__in=role_ids, deleted_at__isnull=True).prefetch_related('permissions')}
        existing_rbac_ids = set(
            Role.objects.filter(
                deleted_at__isnull=True,
                permissions=rbac_perm,
            ).values_list('id', flat=True)
        )
        next_rbac_ids = set(existing_rbac_ids)
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            role_id = item.get('role_id')
            if not isinstance(role_id, int) or role_id not in roles:
                continue
            if bool(item.get('rbac_manage')):
                next_rbac_ids.add(role_id)
            else:
                next_rbac_ids.discard(role_id)
        has_active_rbac = Role.objects.filter(
            id__in=next_rbac_ids,
            deleted_at__isnull=True,
            is_active=True,
        ).exists()
        if not has_active_rbac:
            return Response(
                {'error': 'Phải có ít nhất 1 vai trò đang hoạt động có quyền quản trị phân quyền.'},
                status=400,
            )

        changed_rows = []
        updated = 0
        with transaction.atomic():
            for item in raw_items:
                if not isinstance(item, dict):
                    continue
                role_id = item.get('role_id')
                if not isinstance(role_id, int) or role_id not in roles:
                    continue
                role = roles[role_id]
                assigned_ids = {perm.id for perm in role.permissions.all()}
                old_values = {}
                new_values = {}
                changed_any = False
                for row_cfg in MODULE_PERMISSION_FIELDS:
                    perm = perm_map[f"{row_cfg['resource']}:{row_cfg['action']}"]
                    old_flag = perm.id in assigned_ids
                    new_flag = bool(item.get(row_cfg['field']))
                    old_values[row_cfg['field']] = old_flag
                    new_values[row_cfg['field']] = new_flag
                    if new_flag:
                        role.permissions.add(perm)
                    else:
                        role.permissions.remove(perm)
                    if old_flag != new_flag:
                        changed_any = True
                if changed_any:
                    changed_rows.append({
                        'role_id': role.id,
                        'role_code': role.code,
                        'role_name': role.name,
                        'old': old_values,
                        'new': new_values,
                    })
                updated += 1

        if changed_rows:
            AuditLog.objects.create(
                user=request.user,
                action='UPDATE',
                entity_type='RoleModulePermission',
                entity_id=0,
                entity_id_str='role-module-permissions',
                entity_code='ROLE_MODULE_PERMISSIONS',
                old_values={'items': [row['old'] | {'role_id': row['role_id'], 'role_code': row['role_code'], 'role_name': row['role_name']} for row in changed_rows]},
                new_values={'items': [row['new'] | {'role_id': row['role_id'], 'role_code': row['role_code'], 'role_name': row['role_name']} for row in changed_rows]},
                changed_fields=['module_permissions'],
                ip_address=request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0] or request.META.get('REMOTE_ADDR'),
                user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
            )

            # Realtime anomaly alert for unusually high permission-change activity (24h window).
            now = django_timezone.now()
            recent_logs = AuditLog.objects.filter(
                entity_type='RoleModulePermission',
                user=request.user,
                created_at__gte=now - timedelta(hours=24),
            ).order_by('-created_at')
            recent_events = recent_logs.count()
            recent_role_changes = 0
            for log in recent_logs:
                items = (log.new_values or {}).get('items') if isinstance(log.new_values, dict) else []
                if isinstance(items, list):
                    recent_role_changes += len([item for item in items if isinstance(item, dict)])

            if recent_events >= 20 or recent_role_changes >= 40:
                title = 'Canh bao bat thuong thay doi quyen module'
                actor_name = request.user.get_full_name() or request.user.username
                message = (
                    f'Nguoi dung {actor_name} da thay doi quyen module {recent_events} lan '
                    f'va tac dong {recent_role_changes} role trong 24 gio qua.'
                )
                recipients = (
                    User.objects
                    .filter(is_active=True)
                    .filter(
                        models.Q(is_superuser=True)
                        | models.Q(is_staff=True)
                        | models.Q(roles__permissions=rbac_perm)
                    )
                    .exclude(id=request.user.id)
                    .distinct()
                )
                for recipient in recipients:
                    already_notified = Notification.objects.filter(
                        recipient=recipient,
                        notification_type='system',
                        entity_type='RoleModulePermission',
                        actor=request.user,
                        title=title,
                        created_at__gte=now - timedelta(hours=6),
                    ).exists()
                    if already_notified:
                        continue
                    Notification.objects.create(
                        recipient=recipient,
                        notification_type='system',
                        title=title,
                        message=message,
                        entity_type='RoleModulePermission',
                        entity_id=0,
                        actor=request.user,
                    )

        return Response({'success': True, 'updated': updated})

    @action(detail=False, methods=['post'])
    def module_permissions_freeze_prepare(self, request):
        if not self._can_manage_module_permissions(request.user):
            return Response({'error': 'Bạn không có quyền chuẩn bị đóng băng user.'}, status=403)
        user_id = request.data.get('user_id')
        if not isinstance(user_id, int):
            return Response({'error': 'user_id phải là số nguyên.'}, status=400)
        target = User.objects.filter(id=user_id, is_active=True).first()
        if not target:
            return Response({'error': 'Không tìm thấy user hợp lệ.'}, status=404)
        hours = request.data.get('hours', 24)
        try:
            hours = int(hours)
        except (TypeError, ValueError):
            return Response({'error': 'hours phải là số nguyên.'}, status=400)
        hours = max(1, min(168, hours))
        reason = str(request.data.get('reason') or '').strip()
        token = uuid.uuid4().hex
        cache.set(
            self._freeze_prepare_cache_key(token),
            {
                'prepared_by': request.user.id,
                'target_user_id': target.id,
                'hours': hours,
                'reason': reason,
            },
            timeout=600,
        )
        return Response({
            'success': True,
            'prepare_token': token,
            'target_user': {
                'id': target.id,
                'username': target.username,
                'full_name': f'{target.first_name} {target.last_name}'.strip(),
            },
            'hours': hours,
        })

    @action(detail=False, methods=['post'])
    def module_permissions_freeze_apply(self, request):
        if not self._can_manage_module_permissions(request.user):
            return Response({'error': 'Bạn không có quyền đóng băng user.'}, status=403)
        prepare_token = str(request.data.get('prepare_token') or '').strip()
        confirm_text = str(request.data.get('confirm_text') or '').strip().upper()
        if not prepare_token:
            return Response({'error': 'prepare_token là bắt buộc.'}, status=400)
        if confirm_text != 'FREEZE':
            return Response({'error': 'confirm_text phải là FREEZE.'}, status=400)
        payload = cache.get(self._freeze_prepare_cache_key(prepare_token))
        if not isinstance(payload, dict):
            return Response({'error': 'Token chuẩn bị không hợp lệ hoặc đã hết hạn.'}, status=400)
        if payload.get('prepared_by') != request.user.id:
            return Response({'error': 'Token chuẩn bị không thuộc phiên của bạn.'}, status=403)
        target_user_id = int(payload.get('target_user_id') or 0)
        target = User.objects.filter(id=target_user_id, is_active=True).first()
        if not target:
            return Response({'error': 'User mục tiêu không còn hợp lệ.'}, status=404)

        hours = int(payload.get('hours') or 24)
        reason = str(payload.get('reason') or '').strip()
        now = django_timezone.now()
        frozen_until_dt = now + timedelta(hours=hours)
        freeze_data = {
            'frozen_by': request.user.id,
            'frozen_by_username': request.user.username,
            'frozen_at': now.isoformat(),
            'frozen_until': frozen_until_dt.isoformat(),
            'reason': reason,
            'hours': hours,
        }
        cache.set(self._freeze_cache_key(target.id), freeze_data, timeout=max(60, hours * 3600))
        cache.delete(self._freeze_prepare_cache_key(prepare_token))

        AuditLog.objects.create(
            user=request.user,
            action='LOCK',
            entity_type='RoleModulePermissionFreeze',
            entity_id=target.id,
            entity_id_str=str(target.id),
            entity_code=target.username,
            old_values={},
            new_values=freeze_data,
            changed_fields=['freeze_module_permissions'],
            ip_address=request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0] or request.META.get('REMOTE_ADDR'),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        Notification.objects.create(
            recipient=target,
            notification_type='system',
            title='Quyen thay doi phan quyen module da bi dong bang tam thoi',
            message=(
                f'Tai khoan cua ban bi dong bang quyen thay doi phan quyen trong {hours} gio.'
                + (f' Ly do: {reason}' if reason else '')
            ),
            entity_type='RoleModulePermissionFreeze',
            entity_id=target.id,
            actor=request.user,
        )

        return Response({
            'success': True,
            'user_id': target.id,
            'frozen_until': freeze_data['frozen_until'],
        })

    @action(detail=False, methods=['post'])
    def module_permissions_unfreeze_actor(self, request):
        if not self._can_manage_module_permissions(request.user):
            return Response({'error': 'Bạn không có quyền gỡ đóng băng user.'}, status=403)
        user_id = request.data.get('user_id')
        confirm_text = str(request.data.get('confirm_text') or '').strip().upper()
        if not isinstance(user_id, int):
            return Response({'error': 'user_id phải là số nguyên.'}, status=400)
        if confirm_text != 'UNFREEZE':
            return Response({'error': 'confirm_text phải là UNFREEZE.'}, status=400)
        target = User.objects.filter(id=user_id).first()
        if not target:
            return Response({'error': 'Không tìm thấy user.'}, status=404)
        key = self._freeze_cache_key(target.id)
        old_data = cache.get(key)
        cache.delete(key)

        AuditLog.objects.create(
            user=request.user,
            action='ACTIVATE',
            entity_type='RoleModulePermissionFreeze',
            entity_id=target.id,
            entity_id_str=str(target.id),
            entity_code=target.username,
            old_values=old_data if isinstance(old_data, dict) else {},
            new_values={'unfrozen_at': django_timezone.now().isoformat()},
            changed_fields=['unfreeze_module_permissions'],
            ip_address=request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0] or request.META.get('REMOTE_ADDR'),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response({'success': True, 'user_id': target.id})

    @action(detail=False, methods=['get'])
    def module_permissions_freeze_history(self, request):
        if not _can_view_rbac_audit(request.user):
            return Response({'error': 'Bạn không có quyền xem lịch sử đóng băng quyền module.'}, status=403)

        queryset = (
            AuditLog.objects
            .filter(entity_type='RoleModulePermissionFreeze')
            .select_related('user')
            .order_by('-created_at', '-id')
        )

        q = (request.query_params.get('q') or '').strip()
        if q:
            queryset = queryset.filter(
                models.Q(user__username__icontains=q)
                | models.Q(user__first_name__icontains=q)
                | models.Q(user__last_name__icontains=q)
                | models.Q(entity_code__icontains=q)
            )

        action_type = (request.query_params.get('action_type') or '').strip().upper()
        if action_type in {'LOCK', 'ACTIVATE'}:
            queryset = queryset.filter(action=action_type)

        total = queryset.count()
        page = request.query_params.get('page', '1')
        page_size = request.query_params.get('page_size', '20')
        try:
            page_int = max(1, int(page))
        except ValueError:
            page_int = 1
        try:
            page_size_int = max(1, min(200, int(page_size)))
        except ValueError:
            page_size_int = 20

        start = (page_int - 1) * page_size_int
        end = start + page_size_int
        rows = list(queryset[start:end])
        target_ids = [row.entity_id for row in rows if isinstance(row.entity_id, int) and row.entity_id > 0]
        target_user_map = {u.id: u for u in User.objects.filter(id__in=target_ids)}
        results = []
        for row in rows:
            target_user = target_user_map.get(row.entity_id) if isinstance(row.entity_id, int) else None
            freeze_payload = self._get_freeze_payload(target_user.id if target_user else None)
            results.append({
                'id': row.id,
                'created_at': row.created_at.isoformat() if row.created_at else None,
                'action': row.action,
                'entity_code': row.entity_code,
                'old_values': row.old_values or {},
                'new_values': row.new_values or {},
                'actor': {
                    'id': row.user_id,
                    'username': row.user.username if row.user else None,
                    'full_name': f'{row.user.first_name} {row.user.last_name}'.strip() if row.user else '',
                },
                'target_user': {
                    'id': target_user.id if target_user else row.entity_id,
                    'username': target_user.username if target_user else row.entity_code,
                    'full_name': (f'{target_user.first_name} {target_user.last_name}'.strip() if target_user else ''),
                    'is_active_freeze': bool(freeze_payload),
                    'frozen_until': (freeze_payload or {}).get('frozen_until') if isinstance(freeze_payload, dict) else None,
                },
            })
        return Response({'count': total, 'results': results})

    @action(detail=False, methods=['get'])
    def module_permissions_history_meta(self, request):
        if not _can_view_rbac_audit(request.user):
            return Response({'error': 'Bạn không có quyền xem metadata lịch sử phân quyền module.'}, status=403)

        return Response(_get_role_module_permission_history_meta_payload())

    @action(detail=False, methods=['get'])
    def module_permissions_history(self, request):
        if not _can_view_rbac_audit(request.user):
            return Response({'error': 'Bạn không có quyền xem lịch sử phân quyền module.'}, status=403)

        queryset = (
            AuditLog.objects
            .filter(entity_type='RoleModulePermission')
            .select_related('user')
            .annotate(
                old_values_text=Cast('old_values', output_field=models.TextField()),
                new_values_text=Cast('new_values', output_field=models.TextField()),
            )
            .order_by('-created_at', '-id')
        )

        q = (request.query_params.get('q') or '').strip()
        if q:
            queryset = queryset.filter(
                models.Q(user__username__icontains=q)
                | models.Q(user__first_name__icontains=q)
                | models.Q(user__last_name__icontains=q)
                | models.Q(entity_code__icontains=q)
                | models.Q(old_values_text__icontains=q)
                | models.Q(new_values_text__icontains=q)
            )

        user_id = (request.query_params.get('user_id') or '').strip()
        if user_id.isdigit():
            queryset = queryset.filter(user_id=int(user_id))

        date_from = (request.query_params.get('date_from') or '').strip()
        if date_from:
            dt_from = parse_datetime(date_from)
            if dt_from is not None:
                queryset = queryset.filter(created_at__gte=dt_from)

        date_to = (request.query_params.get('date_to') or '').strip()
        if date_to:
            dt_to = parse_datetime(date_to)
            if dt_to is not None:
                queryset = queryset.filter(created_at__lte=dt_to)

        role_code = (request.query_params.get('role_code') or '').strip().lower()
        supported_changed_types = {row['changed_type'] for row in MODULE_PERMISSION_FIELDS}
        changed_type = (request.query_params.get('changed_type') or '').strip().lower()

        rows_all = list(queryset)
        if role_code or changed_type in supported_changed_types:
            filtered_rows = []
            for row in rows_all:
                old_items = (row.old_values or {}).get('items') if isinstance(row.old_values, dict) else []
                new_items = (row.new_values or {}).get('items') if isinstance(row.new_values, dict) else []
                if not isinstance(old_items, list):
                    old_items = []
                if not isinstance(new_items, list):
                    new_items = []
                old_by_role_id = {
                    int(item.get('role_id')): item
                    for item in old_items
                    if isinstance(item, dict) and str(item.get('role_id', '')).isdigit()
                }
                matched = False
                for item in new_items:
                    if not isinstance(item, dict):
                        continue
                    role_id_raw = item.get('role_id')
                    if not str(role_id_raw).isdigit():
                        continue
                    role_id = int(role_id_raw)
                    role_code_value = str(item.get('role_code') or '').strip().lower()
                    if role_code and role_code not in role_code_value:
                        continue
                    if changed_type in supported_changed_types:
                        old_item = old_by_role_id.get(role_id, {})
                        field_name = next(
                            (row['field'] for row in MODULE_PERMISSION_FIELDS if row['changed_type'] == changed_type),
                            '',
                        )
                        if not field_name:
                            continue
                        if bool(old_item.get(field_name)) == bool(item.get(field_name)):
                            continue
                    matched = True
                    break
                if matched:
                    filtered_rows.append(row)
            rows_all = filtered_rows

        export = (request.query_params.get('export') or '').strip().lower()
        if export == 'excel':
            from openpyxl import Workbook

            wb = Workbook()
            ws = wb.active
            ws.title = 'ModulePermissionHistory'
            ws.append([
                'Thoi gian',
                'Nguoi thao tac',
                'Username',
                'Role code',
                'Role name',
                *[f"{row['label']} (cu -> moi)" for row in MODULE_PERMISSION_FIELDS],
                'IP',
            ])
            for row in rows_all:
                old_items = (row.old_values or {}).get('items') if isinstance(row.old_values, dict) else []
                new_items = (row.new_values or {}).get('items') if isinstance(row.new_values, dict) else []
                if not isinstance(old_items, list):
                    old_items = []
                if not isinstance(new_items, list):
                    new_items = []
                old_by_role_id = {
                    int(item.get('role_id')): item
                    for item in old_items
                    if isinstance(item, dict) and str(item.get('role_id', '')).isdigit()
                }
                for item in new_items:
                    if not isinstance(item, dict):
                        continue
                    role_id_raw = item.get('role_id')
                    if not str(role_id_raw).isdigit():
                        continue
                    role_id = int(role_id_raw)
                    old_item = old_by_role_id.get(role_id, {})
                    role_code_value = str(item.get('role_code') or '')
                    if role_code and role_code not in role_code_value.strip().lower():
                        continue
                    if changed_type in supported_changed_types:
                        field_name = next(
                            (row['field'] for row in MODULE_PERMISSION_FIELDS if row['changed_type'] == changed_type),
                            '',
                        )
                        if not field_name:
                            continue
                        if bool(old_item.get(field_name)) == bool(item.get(field_name)):
                            continue
                    ws.append([
                        row.created_at.isoformat() if row.created_at else '',
                        f'{row.user.first_name} {row.user.last_name}'.strip() if row.user else '',
                        row.user.username if row.user else '',
                        role_code_value,
                        str(item.get('role_name') or ''),
                        *[
                            f'{"Bật" if bool(old_item.get(row_cfg["field"])) else "Tắt"} -> {"Bật" if bool(item.get(row_cfg["field"])) else "Tắt"}'
                            for row_cfg in MODULE_PERMISSION_FIELDS
                        ],
                        row.ip_address or '',
                    ])
            response = HttpResponse(
                content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            )
            response['Content-Disposition'] = 'attachment; filename="module_permission_history.xlsx"'
            wb.save(response)
            return response

        summary_total_events = len(rows_all)
        summary_total_role_changes = 0
        summary_by_changed_type = {row['changed_type']: 0 for row in MODULE_PERMISSION_FIELDS}
        actor_stats = {}
        for row in rows_all:
            old_items = (row.old_values or {}).get('items') if isinstance(row.old_values, dict) else []
            new_items = (row.new_values or {}).get('items') if isinstance(row.new_values, dict) else []
            if not isinstance(old_items, list):
                old_items = []
            if not isinstance(new_items, list):
                new_items = []
            old_by_role_id = {
                int(item.get('role_id')): item
                for item in old_items
                if isinstance(item, dict) and str(item.get('role_id', '')).isdigit()
            }

            username = row.user.username if row.user else 'system'
            actor_key = row.user_id or 0
            actor = actor_stats.get(actor_key)
            if actor is None:
                actor = {
                    'user_id': row.user_id,
                    'username': username,
                    'full_name': (
                        f'{row.user.first_name} {row.user.last_name}'.strip()
                        if row.user else ''
                    ),
                    'events': 0,
                    'role_changes': 0,
                }
                actor_stats[actor_key] = actor
            actor['events'] += 1

            for item in new_items:
                if not isinstance(item, dict):
                    continue
                role_id_raw = item.get('role_id')
                if not str(role_id_raw).isdigit():
                    continue
                role_id = int(role_id_raw)
                old_item = old_by_role_id.get(role_id, {})
                changed_any = False
                for row_cfg in MODULE_PERMISSION_FIELDS:
                    if bool(old_item.get(row_cfg['field'])) != bool(item.get(row_cfg['field'])):
                        summary_by_changed_type[row_cfg['changed_type']] += 1
                        changed_any = True
                if changed_any:
                    summary_total_role_changes += 1
                    actor['role_changes'] += 1

        top_actors = sorted(
            actor_stats.values(),
            key=lambda x: (-int(x['events']), -int(x['role_changes']), str(x['username'])),
        )[:5]

        # Trend 12 months (based on currently filtered rows, before pagination).
        now = django_timezone.now()
        y = now.year
        m = now.month
        month_keys = []
        for _ in range(12):
            month_keys.append(f'{y}-{str(m).zfill(2)}')
            m -= 1
            if m == 0:
                y -= 1
                m = 12
        month_keys.reverse()
        trend_map = {k: {'month': k, 'events': 0, 'role_changes': 0} for k in month_keys}
        for row in rows_all:
            if not row.created_at:
                continue
            key = row.created_at.strftime('%Y-%m')
            if key not in trend_map:
                continue
            trend_map[key]['events'] += 1
            new_items = (row.new_values or {}).get('items') if isinstance(row.new_values, dict) else []
            if isinstance(new_items, list):
                trend_map[key]['role_changes'] += len([item for item in new_items if isinstance(item, dict)])
        trend_12m = [trend_map[k] for k in month_keys]

        # Anomaly detection: heavy change activity in the last 24 hours.
        recent_cutoff = now - timedelta(hours=24)
        recent_actor_counts = {}
        for row in rows_all:
            if not row.created_at or row.created_at < recent_cutoff:
                continue
            actor_key = row.user_id or 0
            actor = recent_actor_counts.get(actor_key)
            if actor is None:
                actor = {
                    'user_id': row.user_id,
                    'username': row.user.username if row.user else 'system',
                    'full_name': (
                        f'{row.user.first_name} {row.user.last_name}'.strip()
                        if row.user else ''
                    ),
                    'events_24h': 0,
                    'role_changes_24h': 0,
                }
                recent_actor_counts[actor_key] = actor
            actor['events_24h'] += 1
            new_items = (row.new_values or {}).get('items') if isinstance(row.new_values, dict) else []
            if isinstance(new_items, list):
                actor['role_changes_24h'] += len([item for item in new_items if isinstance(item, dict)])
        anomalies = []
        for actor in recent_actor_counts.values():
            events_24h = int(actor['events_24h'])
            role_changes_24h = int(actor['role_changes_24h'])
            if events_24h >= 10 or role_changes_24h >= 20:
                severity = 'high' if (events_24h >= 20 or role_changes_24h >= 40) else 'medium'
                freeze_payload = self._get_freeze_payload(actor.get('user_id'))
                anomalies.append({
                    **actor,
                    'severity': severity,
                    'is_frozen': bool(freeze_payload),
                    'frozen_until': (freeze_payload or {}).get('frozen_until') if isinstance(freeze_payload, dict) else None,
                })
        anomalies.sort(key=lambda x: (-int(x['events_24h']), -int(x['role_changes_24h']), str(x['username'])))
        anomalies = anomalies[:10]

        total = len(rows_all)
        page = request.query_params.get('page', '1')
        page_size = request.query_params.get('page_size', '20')
        try:
            page_int = max(1, int(page))
        except ValueError:
            page_int = 1
        try:
            page_size_int = max(1, min(200, int(page_size)))
        except ValueError:
            page_size_int = 20

        start = (page_int - 1) * page_size_int
        end = start + page_size_int
        rows = rows_all[start:end]
        results = []
        for row in rows:
            results.append({
                'id': row.id,
                'created_at': row.created_at.isoformat() if row.created_at else None,
                'action': row.action,
                'entity_type': row.entity_type,
                'entity_code': row.entity_code,
                'changed_fields': row.changed_fields or [],
                'old_values': row.old_values or {},
                'new_values': row.new_values or {},
                'ip_address': row.ip_address,
                'user': {
                    'id': row.user_id,
                    'username': row.user.username if row.user else None,
                    'full_name': (
                        f'{row.user.first_name} {row.user.last_name}'.strip()
                        if row.user else ''
                    ),
                },
            })
        return Response({
            'count': total,
            'results': results,
            'summary': {
                'total_events': summary_total_events,
                'total_role_changes': summary_total_role_changes,
                'by_changed_type': summary_by_changed_type,
                'top_actors': top_actors,
                'trend_12m': trend_12m,
                'anomalies_24h': anomalies,
            },
        })

    def get_export_sheet_title(self):
        return 'Role'
    def get_export_filename(self):
        return 'roles.xlsx'
    def get_export_headers(self):
        return ['Mã', 'Tên', 'Mô tả', 'Đang dùng', 'Thứ tự', 'Ngày tạo']
    def get_export_row(self, obj):
        return [
            obj.code or '', obj.name or '', (obj.description or '')[:200],
            'Có' if obj.is_active else 'Không', obj.sort_order or 0,
            obj.created_at.strftime('%Y-%m-%d') if obj.created_at else '',
        ]

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        self._ensure_manage_role_catalog_permission(request.user)
        raw_ids = request.data.get('ids', [])
        try:
            ids = sorted({int(value) for value in raw_ids if str(value).strip()})
        except (TypeError, ValueError):
            return Response({'error': 'Danh sach role khong hop le.'}, status=400)
        roles = list(self.get_queryset().filter(id__in=ids))
        if not roles:
            return Response({'success': True, 'count': 0})
        old_snapshots = {role.id: _serialize_role_snapshot(role) for role in roles}
        Role.objects.filter(id__in=[role.id for role in roles]).update(is_active=True, updated_by=request.user)
        refreshed_roles = list(self.get_queryset().filter(id__in=[role.id for role in roles]))
        for role in refreshed_roles:
            new_snapshot = _serialize_role_snapshot(role)
            changed_fields = _get_snapshot_changed_fields(old_snapshots[role.id], new_snapshot)
            if changed_fields:
                _create_catalog_audit_log(
                    request=request,
                    actor=request.user,
                    action='ACTIVATE',
                    entity_type='Role',
                    entity_id=role.id,
                    entity_code=role.code,
                    old_values=old_snapshots[role.id],
                    new_values=new_snapshot,
                    changed_fields=changed_fields,
                )
        return Response({'success': True, 'count': len(refreshed_roles)})

    @action(detail=False, methods=['post'])
    def bulk_deactivate(self, request):
        self._ensure_manage_role_catalog_permission(request.user)
        raw_ids = request.data.get('ids', [])
        try:
            ids = sorted({int(value) for value in raw_ids if str(value).strip()})
        except (TypeError, ValueError):
            return Response({'error': 'Danh sach role khong hop le.'}, status=400)
        roles = list(self.get_queryset().filter(id__in=ids))
        if not roles:
            return Response({'success': True, 'count': 0})
        old_snapshots = {role.id: _serialize_role_snapshot(role) for role in roles}
        Role.objects.filter(id__in=[role.id for role in roles]).update(is_active=False, updated_by=request.user)
        refreshed_roles = list(self.get_queryset().filter(id__in=[role.id for role in roles]))
        for role in refreshed_roles:
            new_snapshot = _serialize_role_snapshot(role)
            changed_fields = _get_snapshot_changed_fields(old_snapshots[role.id], new_snapshot)
            if changed_fields:
                _create_catalog_audit_log(
                    request=request,
                    actor=request.user,
                    action='DEACTIVATE',
                    entity_type='Role',
                    entity_id=role.id,
                    entity_code=role.code,
                    old_values=old_snapshots[role.id],
                    new_values=new_snapshot,
                    changed_fields=changed_fields,
                )
        return Response({'success': True, 'count': len(refreshed_roles)})

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        self._ensure_manage_role_catalog_permission(request.user)
        raw_ids = request.data.get('ids', [])
        try:
            ids = sorted({int(value) for value in raw_ids if str(value).strip()})
        except (TypeError, ValueError):
            return Response({'error': 'Danh sach role khong hop le.'}, status=400)
        roles = list(self.get_queryset().filter(id__in=ids))
        if not roles:
            return Response({'success': True, 'count': 0})
        now = django_timezone.now()
        old_snapshots = {role.id: _serialize_role_snapshot(role) for role in roles}
        Role.objects.filter(id__in=[role.id for role in roles]).update(
            deleted_at=now,
            deleted_by=request.user,
            updated_by=request.user,
        )
        for role in roles:
            _create_catalog_audit_log(
                request=request,
                actor=request.user,
                action='DELETE',
                entity_type='Role',
                entity_id=role.id,
                entity_code=role.code,
                old_values=old_snapshots[role.id],
                new_values={**old_snapshots[role.id], 'deleted_at': now.isoformat()},
                changed_fields=['deleted_at'],
            )
        return Response({'success': True, 'count': len(roles)})

    @action(detail=False, methods=['get'])
    def governance_summary(self, request):
        self._ensure_manage_role_catalog_permission(request.user)
        roles = list(self.get_queryset().order_by('sort_order', 'name'))
        teams = list(_annotate_team_governance_queryset(Team.objects.all()).order_by('sort_order', 'name'))
        role_rows = []
        module_coverage = []
        for role in roles:
            permission_rows = _get_prefetched_role_permissions(role)
            module_keys = _get_role_governance_module_keys(permission_rows)
            role_rows.append({
                'id': role.id,
                'code': role.code,
                'name': role.name,
                'is_active': bool(role.is_active),
                'permission_count': int(getattr(role, 'permission_count', len(permission_rows)) or 0),
                'user_count': int(getattr(role, 'user_count', 0) or 0),
                'module_keys': module_keys,
            })
        for row in MODULE_PERMISSION_FIELDS:
            active_roles = 0
            for role in roles:
                if not role.is_active:
                    continue
                if any(
                    str(permission.resource or '').upper() == row['resource']
                    and str(permission.action or '').upper() == row['action']
                    for permission in _get_prefetched_role_permissions(role)
                ):
                    active_roles += 1
            module_coverage.append({
                'key': row['field'],
                'label': row['label'],
                'changed_type': row['changed_type'],
                'active_role_count': active_roles,
            })
        team_rows = [
            {
                'id': team.id,
                'code': team.code,
                'name': team.name,
                'is_active': bool(team.is_active),
                'user_count': int(getattr(team, 'user_count', 0) or 0),
                'active_user_count': int(getattr(team, 'active_user_count', 0) or 0),
                'locked_user_count': int(getattr(team, 'locked_user_count', 0) or 0),
            }
            for team in teams
        ]
        sensitive_role_count = len([
            role for role in role_rows
            if 'rbac-manage' in role['module_keys']
            or 'rbac-audit' in role['module_keys']
            or 'workflow-manage' in role['module_keys']
        ])
        recent_cutoff = django_timezone.now() - timedelta(days=7)
        recent_events_7d = AuditLog.objects.filter(
            entity_type__in=['Role', 'Team', 'UserAccess', 'RoleModulePermission'],
            created_at__gte=recent_cutoff,
        ).count()
        return Response({
            'summary': {
                'total_roles': len(role_rows),
                'active_roles': len([role for role in role_rows if role['is_active']]),
                'inactive_roles': len([role for role in role_rows if not role['is_active']]),
                'roles_without_users': len([role for role in role_rows if role['user_count'] == 0]),
                'roles_without_permissions': len([role for role in role_rows if role['permission_count'] == 0]),
                'sensitive_roles': sensitive_role_count,
                'average_permissions_per_role': round(
                    sum(role['permission_count'] for role in role_rows) / len(role_rows),
                    1,
                ) if role_rows else 0,
                'total_teams': len(team_rows),
                'active_teams': len([team for team in team_rows if team['is_active']]),
                'inactive_teams': len([team for team in team_rows if not team['is_active']]),
                'empty_teams': len([team for team in team_rows if team['user_count'] == 0]),
                'users_without_role': User.objects.filter(is_active=True, roles__isnull=True).distinct().count(),
                'users_without_team': User.objects.filter(is_active=True, teams__isnull=True).distinct().count(),
                'locked_users': User.objects.filter(is_active=True, is_locked=True).count(),
                'recent_events_7d': recent_events_7d,
            },
            'module_coverage': module_coverage,
            'role_templates': _build_role_governance_templates(),
            'team_presets': TEAM_GOVERNANCE_PRESETS,
            'watchlist': _build_governance_watchlist(role_rows, team_rows),
            'top_roles': sorted(
                role_rows,
                key=lambda item: (-int(item['user_count']), -int(item['permission_count']), str(item['code'])),
            )[:6],
            'top_teams': sorted(
                team_rows,
                key=lambda item: (-int(item['user_count']), -int(item['locked_user_count']), str(item['code'])),
            )[:6],
            'permissions': _serialize_permission_rows(
                Permission.objects.order_by('resource', 'action', 'code')
            ),
        })

    @action(detail=False, methods=['get'])
    def governance_activity(self, request):
        self._ensure_manage_role_catalog_permission(request.user)
        kind = str(request.query_params.get('kind') or 'all').strip().lower()
        limit = request.query_params.get('limit', 20)
        queryset = AuditLog.objects.filter(
            entity_type__in=['Role', 'Team', 'UserAccess', 'RoleModulePermission']
        ).select_related('user')
        if kind == 'role':
            queryset = queryset.filter(entity_type='Role')
        elif kind == 'team':
            queryset = queryset.filter(entity_type='Team')
        elif kind == 'assignment':
            queryset = queryset.filter(entity_type='UserAccess')
        elif kind == 'module':
            queryset = queryset.filter(entity_type='RoleModulePermission')
        items = _build_governance_activity_items(queryset, limit=limit)
        return Response({
            'items': items,
            'total': queryset.count(),
            'kind': kind,
        })


class PermissionViewSet(viewsets.ModelViewSet):
    queryset = Permission.objects.all()
    serializer_class = PermissionSerializer


class TeamViewSet(ExportExcelMixin, viewsets.ModelViewSet):
    """Master Data chuẩn: filterset + search + ordering + soft delete + bulk + export."""
    queryset = Team.objects.all()
    serializer_class = TeamSerializer
    permission_classes = [IsAuthenticated]
    export_template_entity_type = 'Team'
    filter_backends = [
        django_filters.rest_framework.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_class = TeamFilter
    search_fields = ['code', 'name', 'description']
    ordering_fields = ['code', 'name', 'sort_order', 'created_at']
    ordering = ['sort_order', 'name']

    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    def perform_destroy(self, instance):
        instance.deleted_at = django_timezone.now()
        instance.deleted_by = self.request.user
        instance.save()

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        ids = request.data.get('ids', [])
        Team.objects.filter(id__in=ids, deleted_at__isnull=True).update(is_active=True)
        return Response({'message': f'Đã kích hoạt {len(ids)} team'})

    @action(detail=False, methods=['post'])
    def bulk_deactivate(self, request):
        ids = request.data.get('ids', [])
        Team.objects.filter(id__in=ids, deleted_at__isnull=True).update(is_active=False)
        return Response({'message': f'Đã vô hiệu hóa {len(ids)} team'})

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        ids = request.data.get('ids', [])
        now = django_timezone.now()
        Team.objects.filter(id__in=ids).update(deleted_at=now, deleted_by=request.user)
        return Response({'message': f'Đã xóa (soft) {len(ids)} team'})

    def get_export_sheet_title(self):
        return 'Team'
    def get_export_filename(self):
        return 'teams.xlsx'
    def get_export_headers(self):
        return ['Mã', 'Tên', 'Mô tả', 'Đang dùng', 'Thứ tự', 'Ngày tạo']
    def get_export_row(self, obj):
        return [
            obj.code or '', obj.name or '', (obj.description or '')[:200],
            'Có' if obj.is_active else 'Không', obj.sort_order or 0,
            obj.created_at.strftime('%Y-%m-%d') if obj.created_at else '',
        ]

    def get_serializer_class(self):
        if self.action in {'create', 'update', 'partial_update'}:
            return TeamWriteSerializer
        return TeamSerializer

    def get_queryset(self):
        return _annotate_team_governance_queryset(super().get_queryset())

    def _ensure_manage_team_catalog_permission(self, user):
        if not _can_manage_module_permissions(user):
            raise PermissionDenied('Ban khong co quyen quan tri role va team.')

    def _get_team_instance(self, team_id):
        return self.get_queryset().filter(pk=team_id).first()

    def create(self, request, *args, **kwargs):
        self._ensure_manage_team_catalog_permission(request.user)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        team = serializer.save(created_by=request.user, updated_by=request.user)
        team = self._get_team_instance(team.id) or team
        snapshot = _serialize_team_snapshot(team)
        _create_catalog_audit_log(
            request=request,
            actor=request.user,
            action='CREATE',
            entity_type='Team',
            entity_id=team.id,
            entity_code=team.code,
            old_values={},
            new_values=snapshot,
            changed_fields=['code', 'name', 'description', 'is_active', 'sort_order'],
        )
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def update(self, request, *args, **kwargs):
        self._ensure_manage_team_catalog_permission(request.user)
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        old_snapshot = _serialize_team_snapshot(instance)
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        refreshed = self._get_team_instance(instance.id) or instance
        new_snapshot = _serialize_team_snapshot(refreshed)
        changed_fields = _get_snapshot_changed_fields(old_snapshot, new_snapshot)
        if changed_fields:
            _create_catalog_audit_log(
                request=request,
                actor=request.user,
                action='UPDATE',
                entity_type='Team',
                entity_id=refreshed.id,
                entity_code=refreshed.code,
                old_values=old_snapshot,
                new_values=new_snapshot,
                changed_fields=changed_fields,
            )
        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        self._ensure_manage_team_catalog_permission(request.user)
        instance = self.get_object()
        old_snapshot = _serialize_team_snapshot(instance)
        instance.deleted_at = django_timezone.now()
        instance.deleted_by = request.user
        instance.updated_by = request.user
        instance.save(update_fields=['deleted_at', 'deleted_by', 'updated_by', 'updated_at'])
        _create_catalog_audit_log(
            request=request,
            actor=request.user,
            action='DELETE',
            entity_type='Team',
            entity_id=instance.id,
            entity_code=instance.code,
            old_values=old_snapshot,
            new_values={**old_snapshot, 'deleted_at': instance.deleted_at.isoformat() if instance.deleted_at else None},
            changed_fields=['deleted_at'],
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        self._ensure_manage_team_catalog_permission(request.user)
        raw_ids = request.data.get('ids', [])
        try:
            ids = sorted({int(value) for value in raw_ids if str(value).strip()})
        except (TypeError, ValueError):
            return Response({'error': 'Danh sach nhom khong hop le.'}, status=400)
        teams = list(self.get_queryset().filter(id__in=ids))
        if not teams:
            return Response({'success': True, 'count': 0})
        old_snapshots = {team.id: _serialize_team_snapshot(team) for team in teams}
        Team.objects.filter(id__in=[team.id for team in teams]).update(is_active=True, updated_by=request.user)
        refreshed_teams = list(self.get_queryset().filter(id__in=[team.id for team in teams]))
        for team in refreshed_teams:
            new_snapshot = _serialize_team_snapshot(team)
            changed_fields = _get_snapshot_changed_fields(old_snapshots[team.id], new_snapshot)
            if changed_fields:
                _create_catalog_audit_log(
                    request=request,
                    actor=request.user,
                    action='ACTIVATE',
                    entity_type='Team',
                    entity_id=team.id,
                    entity_code=team.code,
                    old_values=old_snapshots[team.id],
                    new_values=new_snapshot,
                    changed_fields=changed_fields,
                )
        return Response({'success': True, 'count': len(refreshed_teams)})

    @action(detail=False, methods=['post'])
    def bulk_deactivate(self, request):
        self._ensure_manage_team_catalog_permission(request.user)
        raw_ids = request.data.get('ids', [])
        try:
            ids = sorted({int(value) for value in raw_ids if str(value).strip()})
        except (TypeError, ValueError):
            return Response({'error': 'Danh sach nhom khong hop le.'}, status=400)
        teams = list(self.get_queryset().filter(id__in=ids))
        if not teams:
            return Response({'success': True, 'count': 0})
        old_snapshots = {team.id: _serialize_team_snapshot(team) for team in teams}
        Team.objects.filter(id__in=[team.id for team in teams]).update(is_active=False, updated_by=request.user)
        refreshed_teams = list(self.get_queryset().filter(id__in=[team.id for team in teams]))
        for team in refreshed_teams:
            new_snapshot = _serialize_team_snapshot(team)
            changed_fields = _get_snapshot_changed_fields(old_snapshots[team.id], new_snapshot)
            if changed_fields:
                _create_catalog_audit_log(
                    request=request,
                    actor=request.user,
                    action='DEACTIVATE',
                    entity_type='Team',
                    entity_id=team.id,
                    entity_code=team.code,
                    old_values=old_snapshots[team.id],
                    new_values=new_snapshot,
                    changed_fields=changed_fields,
                )
        return Response({'success': True, 'count': len(refreshed_teams)})

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        self._ensure_manage_team_catalog_permission(request.user)
        raw_ids = request.data.get('ids', [])
        try:
            ids = sorted({int(value) for value in raw_ids if str(value).strip()})
        except (TypeError, ValueError):
            return Response({'error': 'Danh sach nhom khong hop le.'}, status=400)
        teams = list(self.get_queryset().filter(id__in=ids))
        if not teams:
            return Response({'success': True, 'count': 0})
        now = django_timezone.now()
        old_snapshots = {team.id: _serialize_team_snapshot(team) for team in teams}
        Team.objects.filter(id__in=[team.id for team in teams]).update(
            deleted_at=now,
            deleted_by=request.user,
            updated_by=request.user,
        )
        for team in teams:
            _create_catalog_audit_log(
                request=request,
                actor=request.user,
                action='DELETE',
                entity_type='Team',
                entity_id=team.id,
                entity_code=team.code,
                old_values=old_snapshots[team.id],
                new_values={**old_snapshots[team.id], 'deleted_at': now.isoformat()},
                changed_fields=['deleted_at'],
            )
        return Response({'success': True, 'count': len(teams)})


class SettingViewSet(viewsets.ModelViewSet):
    queryset = Setting.objects.all()
    serializer_class = SettingSerializer


class CustomerViewSet(ExportExcelMixin, AuditLogMixin, viewsets.ModelViewSet):
    """CRUD Customer với ExportExcelMixin (export_data), Data Scope, Search tiếng Việt không dấu."""
    export_template_entity_type = 'Customer'
    queryset = Customer.objects.select_related('owner', 'team', 'created_by', 'updated_by').all()
    serializer_class = CustomerSerializer
    filterset_class = CustomerFilter
    ordering_fields = ['code', 'name', 'created_at', 'updated_at', 'credit_limit']
    ordering = ['-created_at']

    def get_queryset(self):
        """Apply data scope filtering and custom search (unaccent via unidecode)"""
        queryset = Customer.objects.all()
        user = self.request.user

        if not user.is_authenticated:
            return queryset.none()

        # Admin sees everything
        if user.is_superuser:
            pass
        else:
            user_roles = list(user.roles.values_list('name', flat=True))
            if 'Admin' in user_roles or 'Manager' in user_roles:
                user_teams = user.teams.all()
                queryset = queryset.filter(
                    models.Q(owner=user) |
                    models.Q(team__in=user_teams) |
                    models.Q(owner__isnull=True, team__isnull=True)
                )
            else:
                queryset = queryset.filter(
                    models.Q(owner=user) |
                    models.Q(owner__isnull=True, team__isnull=True)
                )

        # Search: exact_search=1 dùng get_search_query (icontains, không trigram); ngược lại fuzzy
        search = (self.request.query_params.get('search') or self.request.query_params.get('q') or '').strip()
        exact_search = self.request.query_params.get('exact_search') in ('1', 'true', 'True')
        if search:
            search_fields = ['code', 'name', 'company_name', 'email', 'phone', 'address']
            if exact_search:
                from core.utils import get_search_query
                q = get_search_query(search, search_fields)
                queryset = queryset.filter(q)
            else:
                from core.utils import get_fuzzy_search_queryset
                # 1) Ưu tiên match chính xác code (vd: KH001 -> đúng 1 record)
                exact_code = queryset.filter(code__iexact=search)
                if exact_code.exists():
                    return exact_code
                # 2) Fuzzy search (trigram + unaccent)
                queryset = get_fuzzy_search_queryset(queryset, search, search_fields)

        return queryset

    def get_export_queryset(self):
        return self.filter_queryset(self.get_queryset())

    def get_export_sheet_title(self):
        return 'Khách hàng'

    def get_export_filename(self):
        from datetime import datetime
        return f'khach_hang_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'

    def get_export_headers(self):
        return ['Mã KH', 'Tên KH', 'Tên công ty', 'MST', 'Điện thoại', 'Email', 'Địa chỉ', 'Trạng thái', 'Owner', 'Team']

    def get_export_row(self, obj):
        return [
            obj.code or '',
            obj.name or '',
            obj.company_name or '',
            obj.tax_code or '',
            obj.phone or '',
            obj.email or '',
            obj.address or '',
            obj.get_status_display() if hasattr(obj, 'get_status_display') else (obj.status or ''),
            obj.owner.username if obj.owner else '',
            obj.team.name if obj.team else '',
        ]

    def get_export_pdf_fields(self):
        return ['code', 'name', 'company_name', 'tax_code', 'phone', 'email', 'address', 'status', 'owner__username', 'team__name']

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        """Bulk delete customers"""
        ids = request.data.get('ids', [])
        if not ids:
            return Response({"error": "No IDs provided"}, status=400)
        
        count = Customer.objects.filter(id__in=ids).delete()[0]
        return Response({"success": True, "count": count})

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        """Bulk activate/deactivate customers"""
        ids = request.data.get('ids', [])
        is_active = request.data.get('is_active', True)
        
        if not ids:
            return Response({"error": "No IDs provided"}, status=400)
        
        count = Customer.objects.filter(id__in=ids).update(is_active=is_active)
        return Response({"success": True, "count": count})

    @action(detail=False, methods=['post'])
    def bulk_export(self, request):
        """Bulk export selected customers"""
        from .utils import export_to_excel
        from datetime import datetime
        
        ids = request.data.get('ids', [])
        template_id = request.data.get('template_id')
        
        if not ids:
            return Response({"error": "No IDs provided"}, status=400)
        
        # Get template
        template = ExportTemplate.objects.filter(
            entity_type='Customer',
            is_default=True
        ).first()
        
        if template_id:
            template = ExportTemplate.objects.filter(id=template_id).first()
        
        if not template:
            return Response({"error": "No template found"}, status=404)
        
        # Get selected customers
        customers = Customer.objects.filter(id__in=ids)
        filename = f'customers_selected_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'
        
        return export_to_excel(customers, template.columns, template.headers, filename)
    
    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def export_pdf(self, request):
        """Export customers to PDF"""
        from .models import ExportTemplate
        from .utils import export_to_pdf
        from datetime import datetime
        
        # Get template
        template_id = request.query_params.get('template_id')
        if template_id:
            try:
                template = ExportTemplate.objects.get(id=template_id, entity_type='Customer', is_active=True)
            except ExportTemplate.DoesNotExist:
                return Response({"error": "Template not found"}, status=404)
        else:
            template = ExportTemplate.objects.filter(entity_type='Customer', is_default=True, is_active=True).first()
            if not template:
                return Response({"error": "No default template"}, status=404)
        
        # Get filtered queryset
        queryset = self.filter_queryset(self.get_queryset())
        
        # Export PDF
        filename = f'customers_{datetime.now().strftime("%Y%m%d_%H%M%S")}.pdf'
        return export_to_pdf(queryset, template.columns, template.headers, filename, title='Customer List')

    @action(detail=False, methods=['post'], permission_classes=[AllowAny])
    def export_async(self, request):
        """Queue async export task"""
        from django_q.tasks import async_task

        template_id = request.data.get('template_id')
        if not template_id:
            return Response({"error": "template_id required"}, status=400)

        # Queue task
        task_id = async_task(
            'core.tasks.async_export_customers',
            request.user.id if request.user.is_authenticated else 1,
            template_id
        )

        return Response({
            "success": True,
            "message": "Export queued. You will receive a notification when ready.",
            "task_id": task_id
        })
    
    @action(detail=False, methods=['post'], permission_classes=[AllowAny])
    def import_excel(self, request):
        """Import customers from Excel"""
        from .utils import import_from_excel
        
        # Get uploaded file
        if 'file' not in request.FILES:
            return Response({"error": "No file uploaded"}, status=400)
        
        file = request.FILES['file']
        
        # Validate file extension
        if not file.name.endswith('.xlsx'):
            return Response({"error": "Only .xlsx files are supported"}, status=400)
        
        # Field mapping (Excel header -> Model field)
        field_mapping = {
            'Mã KH': 'code',
            'Tên KH': 'name',
            'Tên công ty': 'company_name',
            'MST': 'tax_code',
            'Điện thoại': 'phone',
            'Email': 'email',
            'Địa chỉ': 'address',
            'Người liên hệ': 'contact_person',
            'SĐT liên hệ': 'contact_phone',
            'Thời hạn TT': 'payment_terms',
            'Hạn mức': 'credit_limit',
        }
        
        try:
            result = import_from_excel(
                file,
                Customer,
                field_mapping,
                user=request.user if request.user.is_authenticated else None
            )
            
            return Response({
                "success": True,
                "total_rows": result['total'],
                "success_count": result['success'],
                "error_count": len(result['errors']),
                "errors": result['errors'],
                "log_id": result.get('log_id'),
            })
            
        except Exception as e:
            return Response({"error": str(e)}, status=500)
    
    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def download_import_template(self, request):
        """Download Excel template for import"""
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill
        from django.http import HttpResponse
        
        # Create workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "Customers"
        
        # Headers
        headers = [
            'Mã KH', 'Tên KH', 'Tên công ty', 'MST', 
            'Điện thoại', 'Email', 'Địa chỉ', 
            'Người liên hệ', 'SĐT liên hệ', 
            'Thời hạn TT', 'Hạn mức'
        ]
        
        ws.append(headers)
        
        # Style header
        header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
        header_font = Font(color="FFFFFF", bold=True)
        
        for cell in ws[1]:
            cell.fill = header_fill
            cell.font = header_font
        
        # Add example rows
        ws.append([
            'CUST001', 'Công ty ABC', 'CÔNG TY TNHH ABC', '0123456789',
            '0901234567', 'abc@example.com', '123 Đường ABC, Quận 1, TP.HCM',
            'Nguyễn Văn A', '0912345678',
            '30', '50000000'
        ])
        
        ws.append([
            'CUST002', 'Công ty XYZ', 'CÔNG TY CP XYZ', '9876543210',
            '0909876543', 'xyz@example.com', '456 Đường XYZ, Quận 2, TP.HCM',
            'Trần Thị B', '0987654321',
            '60', '100000000'
        ])
        
        # Auto column width
        for column in ws.columns:
            max_length = 0
            column_letter = column[0].column_letter
            for cell in column:
                try:
                    if len(str(cell.value)) > max_length:
                        max_length = len(str(cell.value))
                except:
                    pass
            adjusted_width = min(max_length + 2, 50)
            ws.column_dimensions[column_letter].width = adjusted_width
        
        # Create response
        response = HttpResponse(
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        response['Content-Disposition'] = 'attachment; filename="customer_import_template.xlsx"'
        wb.save(response)
        
        return response
    
    @action(detail=True, methods=['post'], permission_classes=[AllowAny])
    def upload_attachment(self, request, pk=None):
        """Upload file attachment to customer"""
        customer = self.get_object()
        
        if 'file' not in request.FILES:
            return Response({"error": "No file uploaded"}, status=400)
        
        file = request.FILES['file']
        description = request.data.get('description', '')
        
        # Create attachment
        attachment = Attachment.objects.create(
            entity_type='Customer',
            entity_id=customer.id,
            file=file,
            filename=file.name,
            file_size=file.size,
            file_type=getattr(file, 'content_type', ''),
            description=description,
            uploaded_by=request.user if request.user.is_authenticated else None
        )
        
        serializer = AttachmentSerializer(attachment, context={'request': request})
        return Response(serializer.data, status=201)
    
    @action(detail=True, methods=['get'], permission_classes=[AllowAny])
    def list_attachments(self, request, pk=None):
        """List all attachments for this customer"""
        customer = self.get_object()
        
        attachments = Attachment.objects.filter(
            entity_type='Customer',
            entity_id=customer.id
        )
        
        serializer = AttachmentSerializer(attachments, many=True, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'], permission_classes=[AllowAny])
    def add_comment(self, request, pk=None):
        """Add comment to customer"""
        customer = self.get_object()
        content = request.data.get('content', '')
        parent_id = request.data.get('parent_id')
        
        if not content:
            return Response({"error": "Content required"}, status=400)
        
        comment = Comment.objects.create(
            entity_type='Customer',
            entity_id=customer.id,
            content=content,
            parent_id=parent_id,
            created_by=request.user if request.user.is_authenticated else None
        )
        
        serializer = CommentSerializer(comment)
        return Response(serializer.data, status=201)
    
    @action(detail=True, methods=['get'], permission_classes=[AllowAny])
    def list_comments(self, request, pk=None):
        """List all comments for this customer"""
        customer = self.get_object()
        
        comments = Comment.objects.filter(
            entity_type='Customer',
            entity_id=customer.id,
            parent__isnull=True,  # Only top-level
            is_deleted=False
        ).order_by('created_at')
        
        serializer = CommentSerializer(comments, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def submit_for_approval(self, request, pk=None):
        """Submit customer for approval"""
        customer = self.get_object()
        
        if customer.status != 'DRAFT':
            return Response({"error": "Only draft customers can be submitted"}, status=400)
        
        customer.status = 'PENDING_APPROVAL'
        customer.save()
        
        # Log approval history
        from .models import ApprovalHistory
        ApprovalHistory.objects.create(
            entity_type='Customer',
            entity_id=customer.id,
            entity_code=customer.code,
            action='SUBMIT',
            user=request.user,
            level=1
        )
        
        # Create audit log
        from .models import AuditLog
        AuditLog.objects.create(
            user=request.user,
            action='APPROVE',
            entity_type='Customer',
            entity_id=customer.id,
            entity_code=customer.code,
            new_values={'status': 'PENDING_APPROVAL'}
        )
        
        return Response({"success": True, "status": customer.status})
    
    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """Approve customer"""
        customer = self.get_object()
        
        if customer.status != 'PENDING_APPROVAL':
            return Response({"error": "Only pending customers can be approved"}, status=400)
        
        from django.utils import timezone
        from .models import AuditLog
        customer.status = 'APPROVED'
        customer.approved_by = request.user
        customer.approved_at = timezone.now()
        customer.save()
        
        # Log approval history
        from .models import ApprovalHistory
        ApprovalHistory.objects.create(
            entity_type='Customer',
            entity_id=customer.id,
            entity_code=customer.code,
            action='APPROVE',
            user=request.user,
            level=1
        )
        
        # Create audit log
        AuditLog.objects.create(
            user=request.user,
            action='APPROVE',
            entity_type='Customer',
            entity_id=customer.id,
            entity_code=customer.code,
            new_values={'status': 'APPROVED'}
        )
        
        return Response({"success": True, "status": customer.status})
    
    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """Reject customer"""
        customer = self.get_object()
        
        if customer.status != 'PENDING_APPROVAL':
            return Response({"error": "Only pending customers can be rejected"}, status=400)
        
        reason = request.data.get('reason', '')
        
        from django.utils import timezone
        from .models import AuditLog
        customer.status = 'REJECTED'
        customer.rejected_by = request.user
        customer.rejected_at = timezone.now()
        customer.rejection_reason = reason
        customer.save()
        
        # Log approval history
        from .models import ApprovalHistory
        ApprovalHistory.objects.create(
            entity_type='Customer',
            entity_id=customer.id,
            entity_code=customer.code,
            action='REJECT',
            comments=reason,
            user=request.user,
            level=1
        )
        
        # Create audit log
        AuditLog.objects.create(
            user=request.user,
            action='REJECT',
            entity_type='Customer',
            entity_id=customer.id,
            entity_code=customer.code,
            new_values={'status': 'REJECTED', 'reason': reason}
        )
        
        return Response({"success": True, "status": customer.status})

    @action(detail=True, methods=['get'], permission_classes=[AllowAny])
    def approval_history(self, request, pk=None):
        """Get approval history for this customer"""
        customer = self.get_object()
        
        from .models import ApprovalHistory
        history = ApprovalHistory.objects.filter(
            entity_type='Customer',
            entity_id=customer.id
        ).order_by('-created_at')
        
        data = []
        for h in history:
            data.append({
                'action': h.get_action_display(),
                'user': h.user.username if h.user else None,
                'comments': h.comments,
                'level': h.level,
                'created_at': h.created_at
            })
        
        return Response(data)

    @action(detail=True, methods=['post'])
    def assign_owner(self, request, pk=None):
        """Assign owner to customer"""
        customer = self.get_object()
        user_id = request.data.get('user_id')

        if not user_id:
            return Response({"error": "user_id required"}, status=400)

        try:
            from django.contrib.auth import get_user_model
            User = get_user_model()
            owner = User.objects.get(id=user_id)

            customer.owner = owner
            customer.save()

            # Log
            AuditLog.objects.create(
                user=request.user,
                action='UPDATE',
                entity_type='Customer',
                entity_id=customer.id,
                entity_code=customer.code,
                new_values={'owner': owner.username}
            )

            return Response({"success": True, "owner": owner.username})
        except User.DoesNotExist:
            return Response({"error": "User not found"}, status=404)

    @action(detail=True, methods=['post'])
    def assign_team(self, request, pk=None):
        """Assign team to customer"""
        customer = self.get_object()
        team_id = request.data.get('team_id')

        if not team_id:
            return Response({"error": "team_id required"}, status=400)

        try:
            team = Team.objects.get(id=team_id)

            customer.team = team
            customer.save()

            # Log
            AuditLog.objects.create(
                user=request.user,
                action='UPDATE',
                entity_type='Customer',
                entity_id=customer.id,
                entity_code=customer.code,
                new_values={'team': team.name}
            )

            return Response({"success": True, "team": team.name})
        except Team.DoesNotExist:
            return Response({"error": "Team not found"}, status=404)
    
    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def export(self, request):
        """Export customers to Excel/CSV/PDF using template"""
        from .models import ExportTemplate
        import csv
        
        # Get format
        format_type = request.query_params.get('format', 'excel')
        
        # Get template
        template_id = request.query_params.get('template_id')
        
        if template_id:
            try:
                template = ExportTemplate.objects.get(
                    id=template_id,
                    entity_type='Customer',
                    is_active=True
                )
            except ExportTemplate.DoesNotExist:
                return Response({"error": "Template not found"}, status=404)
        else:
            template = ExportTemplate.objects.filter(
                entity_type='Customer',
                is_default=True,
                is_active=True
            ).first()
            
            if not template:
                return Response({"error": "No default template found"}, status=404)
        
        # Get filtered queryset
        queryset = self.filter_queryset(self.get_queryset())
        
        # Export based on format
        if format_type == 'csv':
            # CSV Export
            response = HttpResponse(content_type='text/csv; charset=utf-8-sig')
            response['Content-Disposition'] = f'attachment; filename="customers_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv"'
            
            writer = csv.writer(response)
            writer.writerow(template.headers)
            
            for obj in queryset:
                row = []
                for field in template.columns:
                    value = obj
                    for part in field.split('__'):
                        value = getattr(value, part, '')
                        if value is None:
                            value = ''
                    row.append(str(value))
                writer.writerow(row)
            
            return response
        
        elif format_type == 'excel':
            # Excel Export (existing)
            filename = f'customers_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'
            return export_to_excel(queryset, template.columns, template.headers, filename)
        
        else:
            return Response({"error": "Invalid format. Use 'excel' or 'csv'"}, status=400)


class ExportTemplateViewSet(viewsets.ReadOnlyModelViewSet):
    """Export Template ViewSet - Read only for users"""
    queryset = ExportTemplate.objects.filter(is_active=True)
    serializer_class = ExportTemplateSerializer
    filterset_fields = ['entity_type']


class SavedViewViewSet(viewsets.ModelViewSet):
    serializer_class = SavedViewSerializer
    filterset_fields = ['entity_type', 'is_public']
    
    def get_queryset(self):
        # User chỉ thấy: view của mình + public views
        if self.request.user.is_authenticated:
            from django.db.models import Q
            return SavedView.objects.filter(
                Q(user=self.request.user) | Q(is_public=True)
            )
        return SavedView.objects.filter(is_public=True)
    
    def perform_create(self, serializer):
        serializer.save(user=self.request.user, created_by=self.request.user)
    
    @action(detail=True, methods=['post'])
    def set_default(self, request, pk=None):
        """Set this view as default for entity_type"""
        view = self.get_object()
        
        # Unset other defaults for this entity
        SavedView.objects.filter(
            user=request.user,
            entity_type=view.entity_type,
            is_default=True
        ).update(is_default=False)
        
        # Set this as default
        view.is_default = True
        view.save()
        
        return Response({"status": "set as default"})
    
    @action(detail=True, methods=['post'], permission_classes=[IsAdminUser])
    def publish(self, request, pk=None):
        """Publish view (admin only)"""
        view = self.get_object()
        view.is_public = True
        view.save()
        return Response({"status": "published"})


class AttachmentViewSet(viewsets.ModelViewSet):
    serializer_class = AttachmentSerializer
    filterset_fields = ['entity_type', 'entity_id']
    
    def get_queryset(self):
        return Attachment.objects.all()
    
    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)
    
    @action(detail=True, methods=['get'], permission_classes=[AllowAny])
    def download(self, request, pk=None):
        """Download file"""
        attachment = self.get_object()
        
        # Check if file exists
        if not attachment.file:
            return Response({"error": "File not found"}, status=404)
        
        # Serve file
        from django.http import FileResponse
        response = FileResponse(attachment.file.open('rb'))
        response['Content-Disposition'] = f'attachment; filename="{attachment.filename}"'
        response['Content-Type'] = attachment.file_type or 'application/octet-stream'
        
        return response
    
    def destroy(self, request, *args, **kwargs):
        """Delete attachment (and file)"""
        attachment = self.get_object()
        
        # Delete file from disk
        if attachment.file:
            try:
                attachment.file.delete(save=False)
            except:
                pass
        
        # Delete record
        attachment.delete()
        
        return Response(status=204)


class CommentViewSet(viewsets.ModelViewSet):
    serializer_class = CommentSerializer
    filterset_fields = ['entity_type', 'entity_id', 'parent']
    
    def get_queryset(self):
        # Don't show deleted comments
        return Comment.objects.filter(is_deleted=False)
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
    
    def perform_update(self, serializer):
        # Only allow editing own comments
        comment = self.get_object()
        if comment.created_by != self.request.user:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("You can only edit your own comments")
        serializer.save()
    
    def perform_destroy(self, instance):
        # Only allow deleting own comments
        if instance.created_by != self.request.user:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("You can only delete your own comments")
        
        # Soft delete
        from django.utils import timezone
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.save()
    
    @action(detail=False, methods=['get'])
    def by_entity(self, request):
        """Get all comments for an entity with replies nested"""
        entity_type = request.query_params.get('entity_type')
        entity_id = request.query_params.get('entity_id')
        
        if not entity_type or not entity_id:
            return Response({"error": "entity_type and entity_id required"}, status=400)
        
        # Get top-level comments (no parent)
        comments = Comment.objects.filter(
            entity_type=entity_type,
            entity_id=entity_id,
            parent__isnull=True,
            is_deleted=False
        ).order_by('created_at')
        
        serializer = self.get_serializer(comments, many=True)
        return Response(serializer.data)


class ActivityStreamViewSet(viewsets.ReadOnlyModelViewSet):
    """Combined activity stream from audit logs and comments"""
    permission_classes = [IsAuthenticated]

    @staticmethod
    def _ensure_operations_log_permission(user):
        if not _can_view_operations_log(user):
            raise PermissionDenied('Bạn không có quyền xem nhật ký vận hành.')
    
    @action(detail=False, methods=['get'])
    def by_entity(self, request):
        """Get activity stream for an entity"""
        entity_type = request.query_params.get('entity_type')
        entity_id = request.query_params.get('entity_id')
        
        if not entity_type or not entity_id:
            return Response({"error": "entity_type and entity_id required"}, status=400)
        
        activities = []

        from .models import AuditLog, Comment

        related_product_map = {}
        related_bundle_map = {}
        related_product_ids = []
        related_bundle_ids = []
        root_product = None

        if str(entity_type).lower() == 'product':
            try:
                from products.models import Product, ProductBundle

                selected_product = (
                    Product.objects
                    .select_related('parent')
                    .get(pk=entity_id)
                )
                root_product = selected_product.parent or selected_product
                family_products = list(
                    Product.objects
                    .filter(models.Q(id=root_product.id) | models.Q(parent_id=root_product.id))
                    .select_related('parent')
                    .order_by('id')
                )
                related_product_map = {item.id: item for item in family_products}
                related_product_ids = list(related_product_map.keys())
                bundles = list(
                    ProductBundle.objects
                    .filter(sellable_product_id=root_product.id)
                    .select_related('sellable_product', 'primary_product')
                )
                related_bundle_map = {item.id: item for item in bundles}
                related_bundle_ids = list(related_bundle_map.keys())
            except Exception:
                related_product_ids = [int(entity_id)] if str(entity_id).isdigit() else []
                related_bundle_ids = []

        if str(entity_type).lower() == 'product' and related_product_ids:
            audit_logs = (
                AuditLog.objects
                .filter(
                    models.Q(entity_type='Product', entity_id__in=related_product_ids)
                    | models.Q(entity_type='ProductBundle', entity_id__in=related_bundle_ids)
                )
                .select_related('user')
                .order_by('-created_at')[:80]
            )
        else:
            audit_logs = (
                AuditLog.objects
                .filter(entity_type=entity_type, entity_id=entity_id)
                .select_related('user')
                .order_by('-created_at')[:20]
            )

        for log in audit_logs:
            details = {
                'old_values': log.old_values,
                'new_values': log.new_values,
                'changed_fields': log.changed_fields,
            }
            if log.entity_type == 'Product':
                related_product = related_product_map.get(log.entity_id)
                details.update({
                    'entity_scope': 'COMPONENT_PRODUCT' if related_product and related_product.parent_id else 'PRIMARY_PRODUCT',
                    'related_entity_id': related_product.id if related_product else log.entity_id,
                    'related_entity_code': related_product.code if related_product else log.entity_code,
                    'related_entity_name': related_product.name if related_product else None,
                })
            elif log.entity_type == 'ProductBundle':
                related_bundle = related_bundle_map.get(log.entity_id)
                details.update({
                    'entity_scope': 'BUNDLE_CONFIG',
                    'related_entity_id': related_bundle.sellable_product_id if related_bundle else None,
                    'related_entity_code': related_bundle.sellable_product.code if related_bundle else log.entity_code,
                    'related_entity_name': related_bundle.sellable_product.name if related_bundle else None,
                })
            activities.append({
                'type': 'audit',
                'action': log.action,
                'user': log.user.username if log.user else None,
                'timestamp': log.created_at,
                'details': details,
            })

        if str(entity_type).lower() == 'product' and related_product_ids:
            comments = (
                Comment.objects
                .filter(
                    entity_type='Product',
                    entity_id__in=related_product_ids,
                    is_deleted=False,
                )
                .order_by('-created_at')[:40]
            )
        else:
            comments = (
                Comment.objects
                .filter(
                    entity_type=entity_type,
                    entity_id=entity_id,
                    is_deleted=False,
                )
                .order_by('-created_at')[:20]
            )

        for comment in comments:
            related_product = related_product_map.get(comment.entity_id)
            activities.append({
                'type': 'comment',
                'action': 'COMMENT',
                'user': comment.created_by.username if comment.created_by else None,
                'timestamp': comment.created_at,
                'details': {
                    'content': comment.content,
                    'mentions': comment.mentions,
                    'entity_scope': 'COMPONENT_PRODUCT' if related_product and related_product.parent_id else 'PRIMARY_PRODUCT',
                    'related_entity_id': related_product.id if related_product else comment.entity_id,
                    'related_entity_code': related_product.code if related_product else None,
                    'related_entity_name': related_product.name if related_product else None,
                }
            })

        if str(entity_type).lower() == 'product' and related_product_ids:
            try:
                from products.models import BundlePriceChange, PriceChange

                price_events = (
                    PriceChange.objects
                    .select_related('product', 'submitted_by', 'approved_by')
                    .filter(product_id__in=related_product_ids)
                    .exclude(status=PriceChange.STATUS_ACTIVE_APPLIED)
                    .order_by('-created_at')[:40]
                )
                for event in price_events:
                    action = {
                        PriceChange.STATUS_PENDING_APPROVAL: 'SUBMIT',
                        PriceChange.STATUS_APPROVED_SCHEDULED: 'APPROVE',
                        PriceChange.STATUS_REJECTED: 'REJECT',
                        PriceChange.STATUS_SUPERSEDED: 'UPDATE',
                    }.get(event.status, 'UPDATE')
                    actor = event.approved_by if action in {'APPROVE', 'REJECT'} and event.approved_by else event.submitted_by
                    activities.append({
                        'type': 'audit',
                        'action': action,
                        'user': actor.username if actor else None,
                        'timestamp': event.created_at,
                        'details': {
                            'old_values': {
                                'cost_price': str(event.old_cost_price) if event.old_cost_price is not None else None,
                                'sale_price': str(event.old_sale_price) if event.old_sale_price is not None else None,
                                'commission_per_unit': str(event.old_commission_per_unit) if event.old_commission_per_unit is not None else None,
                                'commission_percent': str(event.old_commission_percent) if event.old_commission_percent is not None else None,
                            },
                            'new_values': {
                                'cost_price': str(event.new_cost_price) if event.new_cost_price is not None else None,
                                'sale_price': str(event.new_sale_price) if event.new_sale_price is not None else None,
                                'commission_per_unit': str(event.new_commission_per_unit) if event.new_commission_per_unit is not None else None,
                                'commission_percent': str(event.new_commission_percent) if event.new_commission_percent is not None else None,
                                'price_change_reason': event.reason or '',
                                'price_effective_at': event.effective_at.isoformat() if event.effective_at else None,
                                'reject_reason': event.reject_reason or '',
                                'delta_cost_percent': str(event.delta_cost_percent) if event.delta_cost_percent is not None else None,
                                'delta_sale_percent': str(event.delta_sale_percent) if event.delta_sale_percent is not None else None,
                                'price_change_status': event.status,
                            },
                            'changed_fields': [
                                'cost_price', 'sale_price', 'commission_per_unit', 'commission_percent',
                                *(['price_change_reason'] if event.reason else []),
                                *(['price_effective_at'] if event.effective_at else []),
                                *(['reject_reason'] if event.reject_reason else []),
                            ],
                            'content': (
                                f"Lý do: {event.reason}"
                                + (f" | Hiệu lực: {event.effective_at.strftime('%d/%m/%Y %H:%M')}" if event.effective_at else '')
                            ).strip() if event.reason or event.effective_at else None,
                            'entity_scope': 'COMPONENT_PRODUCT' if event.product.parent_id else 'PRIMARY_PRODUCT',
                            'related_entity_id': event.product_id,
                            'related_entity_code': event.product.code,
                            'related_entity_name': event.product.name,
                        }
                    })

                bundle_price_events = (
                    BundlePriceChange.objects
                    .select_related('bundle__sellable_product', 'submitted_by', 'approved_by')
                    .filter(bundle_id__in=related_bundle_ids)
                    .exclude(status=BundlePriceChange.STATUS_ACTIVE_APPLIED)
                    .order_by('-created_at')[:40]
                )
                for event in bundle_price_events:
                    action = {
                        BundlePriceChange.STATUS_PENDING_APPROVAL: 'SUBMIT',
                        BundlePriceChange.STATUS_APPROVED_SCHEDULED: 'APPROVE',
                        BundlePriceChange.STATUS_REJECTED: 'REJECT',
                        BundlePriceChange.STATUS_SUPERSEDED: 'UPDATE',
                    }.get(event.status, 'UPDATE')
                    actor = event.approved_by if action in {'APPROVE', 'REJECT'} and event.approved_by else event.submitted_by
                    activities.append({
                        'type': 'audit',
                        'action': action,
                        'user': actor.username if actor else None,
                        'timestamp': event.created_at,
                        'details': {
                            'old_values': {
                                'bundle_fixed_cost_price': str(event.old_fixed_cost_price) if event.old_fixed_cost_price is not None else None,
                                'bundle_fixed_sale_price': str(event.old_fixed_sale_price) if event.old_fixed_sale_price is not None else None,
                                'bundle_fixed_commission_per_unit': str(event.old_fixed_commission_per_unit) if event.old_fixed_commission_per_unit is not None else None,
                                'bundle_fixed_commission_percent': str(event.old_fixed_commission_percent) if event.old_fixed_commission_percent is not None else None,
                            },
                            'new_values': {
                                'bundle_fixed_cost_price': str(event.new_fixed_cost_price) if event.new_fixed_cost_price is not None else None,
                                'bundle_fixed_sale_price': str(event.new_fixed_sale_price) if event.new_fixed_sale_price is not None else None,
                                'bundle_fixed_commission_per_unit': str(event.new_fixed_commission_per_unit) if event.new_fixed_commission_per_unit is not None else None,
                                'bundle_fixed_commission_percent': str(event.new_fixed_commission_percent) if event.new_fixed_commission_percent is not None else None,
                                'bundle_price_change_reason': event.reason or '',
                                'bundle_price_effective_at': event.effective_at.isoformat() if event.effective_at else None,
                                'reject_reason': event.reject_reason or '',
                                'delta_cost_percent': str(event.delta_cost_percent) if event.delta_cost_percent is not None else None,
                                'delta_sale_percent': str(event.delta_sale_percent) if event.delta_sale_percent is not None else None,
                                'bundle_price_change_status': event.status,
                            },
                            'changed_fields': [
                                'bundle_fixed_cost_price', 'bundle_fixed_sale_price',
                                'bundle_fixed_commission_per_unit', 'bundle_fixed_commission_percent',
                                *(['bundle_price_change_reason'] if event.reason else []),
                                *(['bundle_price_effective_at'] if event.effective_at else []),
                                *(['reject_reason'] if event.reject_reason else []),
                            ],
                            'content': (
                                f"Giá bộ cố định | Lý do: {event.reason}"
                                + (f" | Hiệu lực: {event.effective_at.strftime('%d/%m/%Y %H:%M')}" if event.effective_at else '')
                            ).strip() if event.reason or event.effective_at else 'Giá bộ cố định',
                            'entity_scope': 'BUNDLE_FIXED',
                            'related_entity_id': event.bundle.sellable_product_id,
                            'related_entity_code': event.bundle.sellable_product.code,
                            'related_entity_name': event.bundle.sellable_product.name,
                        }
                    })
            except Exception:
                pass
        
        # Sort by timestamp (newest first)
        activities.sort(key=lambda x: x['timestamp'], reverse=True)
        
        return Response(activities[:50])  # Return top 50

    @staticmethod
    def _to_bool(raw):
        if raw is None:
            return None
        lowered = str(raw).strip().lower()
        if lowered in ('1', 'true', 'yes'):
            return True
        if lowered in ('0', 'false', 'no'):
            return False
        return None

    @staticmethod
    def _parse_since(since_raw):
        if since_raw is None or str(since_raw).strip() == '':
            return None
        dt = parse_datetime(str(since_raw).strip())
        if dt is None:
            return 'INVALID'
        if django_timezone.is_naive(dt):
            dt = django_timezone.make_aware(dt, django_timezone.get_current_timezone())
        return dt

    def _build_operations_items(
        self,
        user,
        actor_query='',
        action_filter='ALL',
        source_filter='ALL',
        success_filter='ALL',
        q='',
        include_all=False,
        limit=100,
    ):
        actor_query = (actor_query or '').strip().lower()
        action_filter = (action_filter or 'ALL').strip().upper()
        source_filter = (source_filter or 'ALL').strip().upper()
        success_filter = (success_filter or 'ALL').strip().upper()
        q = (q or '').strip().lower()

        allow_all = include_all and _can_view_operations_log(user)
        items = []

        def allow_item(source, action, actor_name, success, message):
            if source_filter != 'ALL' and source != source_filter:
                return False
            if action_filter != 'ALL' and str(action or '').upper() != action_filter:
                return False
            if actor_query and actor_query not in (actor_name or '').lower():
                return False
            if success_filter == 'SUCCESS' and success is not True:
                return False
            if success_filter == 'FAILED' and success is not False:
                return False
            if q:
                haystack = ' '.join([
                    source,
                    str(action or ''),
                    actor_name or '',
                    message or '',
                ]).lower()
                if q not in haystack:
                    return False
            return True

        audit_qs = AuditLog.objects.filter(
            entity_type__in=['TaskBulk', 'WorkflowAnalytics', 'Task', 'WorkflowAutomation']
        ).select_related('user').order_by('-created_at', '-id')
        if not allow_all:
            audit_qs = audit_qs.filter(user=user)
        audit_qs = audit_qs[: max(limit * 3, 120)]

        for log in audit_qs:
            payload = log.new_values or {}
            actor_name = log.user.username if log.user else None
            if log.entity_type == 'TaskBulk':
                source = 'TASK_BULK'
                action = str(payload.get('action') or 'UPDATE').upper()
                failed_count = int(payload.get('failed_count') or 0)
                success = failed_count == 0
                message = (
                    f'Bulk {action}: thành công {int(payload.get("success_count") or 0)}, '
                    f'lỗi {failed_count}.'
                )
                meta = {
                    'selected_count': int(payload.get('total_requested') or 0),
                    'processed_count': int(payload.get('processed_count') or 0),
                    'success_count': int(payload.get('success_count') or 0),
                    'failed_count': failed_count,
                    'reminder_sent_count': int(payload.get('reminder_sent_count') or 0),
                }
            elif log.entity_type == 'WorkflowAnalytics':
                source = 'INSIGHT_ACTION'
                action = str(payload.get('suggested_action') or 'EXECUTE').upper()
                success = bool(payload.get('success', True))
                message = str(payload.get('message') or payload.get('insight_type') or 'Thực thi insight')
                meta = {
                    'insight_type': payload.get('insight_type'),
                    'manual_action': bool(payload.get('manual_action', False)),
                }
            elif log.entity_type == 'WorkflowAutomation':
                source = 'AUTOMATION_RUN'
                action = str(payload.get('profile_key') or 'RUN_PROFILE').upper()
                success = bool(payload.get('success', True))
                message = str(payload.get('message') or 'Đã chạy profile tự động hóa.')
                meta = {
                    'run_mode': payload.get('run_mode') or 'MANUAL_PROFILE',
                    'auto_started_count': int(payload.get('auto_started_count') or 0),
                    'overdue_reminded_count': int(payload.get('overdue_reminded_count') or 0),
                    'notifications_sent': int(payload.get('notifications_sent') or 0),
                }
            else:
                source = 'TASK_AUDIT'
                action = str(log.action or 'UPDATE').upper()
                success = True
                message = ', '.join(log.changed_fields or []) or 'Cập nhật task'
                meta = {
                    'entity_type': log.entity_type,
                    'entity_id': log.entity_id,
                }

            if not allow_item(source, action, actor_name, success, message):
                continue
            items.append({
                'id': f'audit-{log.id}',
                'source': source,
                'action': action,
                'actor': actor_name,
                'success': success,
                'message': message,
                'entity_type': log.entity_type,
                'entity_id': log.entity_id,
                'entity_code': log.entity_code,
                'created_at': log.created_at,
                'meta': meta,
            })

        pipeline_qs = WorkflowPipelineEvent.objects.select_related('actor').order_by('-created_at', '-id')
        if not allow_all:
            pipeline_qs = pipeline_qs.filter(actor=user)
        pipeline_qs = pipeline_qs[: max(limit * 3, 120)]
        for ev in pipeline_qs:
            source = 'PIPELINE_EVENT'
            action = str(ev.action or '').upper()
            actor_name = ev.actor.username if ev.actor else None
            success = True
            message = ev.note or f'{ev.from_step or "-"} -> {ev.to_step or "-"}'
            if not allow_item(source, action, actor_name, success, message):
                continue
            items.append({
                'id': f'pipeline-{ev.id}',
                'source': source,
                'action': action,
                'actor': actor_name,
                'success': success,
                'message': message,
                'entity_type': ev.entity_type,
                'entity_id': ev.entity_id,
                'entity_code': ev.entity_code,
                'created_at': ev.created_at,
                'meta': {
                    'trigger': ev.trigger,
                    'from_step': ev.from_step,
                    'to_step': ev.to_step,
                },
            })

        items.sort(key=lambda x: x['created_at'], reverse=True)
        return items[:limit]

    @action(detail=False, methods=['get'], url_path='operations_log')
    def operations_log(self, request):
        """
        Nhật ký vận hành hợp nhất (Task/Pipeline/Bulk/Insight).
        Query:
          - actor_query, action, source, success, q, limit, include_all
        """
        self._ensure_operations_log_permission(request.user)
        actor_query = request.query_params.get('actor_query') or ''
        action_filter = request.query_params.get('action') or 'ALL'
        source_filter = request.query_params.get('source') or 'ALL'
        success_filter = request.query_params.get('success') or 'ALL'
        q = request.query_params.get('q') or ''
        include_all = str(request.query_params.get('include_all') or '').strip().lower() in ('1', 'true', 'yes')
        try:
            limit = int(request.query_params.get('limit') or 100)
        except (TypeError, ValueError):
            return Response({'error': 'limit phải là số nguyên.'}, status=400)
        limit = max(10, min(limit, 300))
        items = self._build_operations_items(
            user=request.user,
            actor_query=actor_query,
            action_filter=action_filter,
            source_filter=source_filter,
            success_filter=success_filter,
            q=q,
            include_all=include_all,
            limit=limit,
        )
        return Response({'items': items, 'total': len(items)})

    @action(detail=False, methods=['get'], url_path='operations_live_updates')
    def operations_live_updates(self, request):
        """
        Kiểm tra thay đổi mới cho nhật ký vận hành (lightweight).
        Query: giống operations_log + since (ISO datetime)
        """
        self._ensure_operations_log_permission(request.user)
        since_dt = self._parse_since(request.query_params.get('since'))
        if since_dt == 'INVALID':
            return Response({'error': 'since phải là ISO datetime hợp lệ.'}, status=400)

        actor_query = request.query_params.get('actor_query') or ''
        action_filter = request.query_params.get('action') or 'ALL'
        source_filter = request.query_params.get('source') or 'ALL'
        success_filter = request.query_params.get('success') or 'ALL'
        q = request.query_params.get('q') or ''
        include_all = str(request.query_params.get('include_all') or '').strip().lower() in ('1', 'true', 'yes')

        # Lấy một tập mới nhất rồi lọc theo cùng tiêu chí để xác định latest + changed_count.
        items = self._build_operations_items(
            user=request.user,
            actor_query=actor_query,
            action_filter=action_filter,
            source_filter=source_filter,
            success_filter=success_filter,
            q=q,
            include_all=include_all,
            limit=300,
        )
        latest_at = items[0]['created_at'] if items else None
        changed_count = 0
        if since_dt is not None:
            changed_count = sum(1 for item in items if item['created_at'] > since_dt)
        return Response({
            'has_changes': changed_count > 0,
            'latest_at': latest_at,
            'server_time': django_timezone.now(),
            'changed_count': changed_count,
        })

    @action(detail=False, methods=['get'], url_path='operations_log_meta')
    def operations_log_meta(self, request):
        self._ensure_operations_log_permission(request.user)
        items = self._build_operations_items(
            user=request.user,
            actor_query='',
            action_filter='ALL',
            source_filter='ALL',
            success_filter='ALL',
            q='',
            include_all=True,
            limit=300,
        )
        actions = sorted({str(item.get('action') or '').upper() for item in items if str(item.get('action') or '').strip()})
        sources = sorted({str(item.get('source') or '').upper() for item in items if str(item.get('source') or '').strip()})
        recent_cutoff = django_timezone.now() - timedelta(hours=24)
        recent_failed_count = len([
            item for item in items
            if item.get('success') is False
            and item.get('created_at')
            and item['created_at'] >= recent_cutoff
        ])
        return Response({
            'actions': [{'value': action, 'label': action} for action in actions],
            'sources': [{'value': source, 'label': source} for source in sources],
            'recent_failed_count_24h': recent_failed_count,
        })


class NotificationViewSet(viewsets.ModelViewSet):
    serializer_class = NotificationSerializer
    
    def get_queryset(self):
        # User chỉ thấy notifications của mình
        qs = Notification.objects.filter(recipient=self.request.user)
        unread = self.request.query_params.get('unread')
        if unread in ('1', 'true', 'yes'):
            qs = qs.filter(is_read=False)
        type_filter = (self.request.query_params.get('type') or '').strip()
        if type_filter:
            qs = qs.filter(notification_type=type_filter)
        q = (self.request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(models.Q(title__icontains=q) | models.Q(message__icontains=q))
        return qs
    
    @action(detail=False, methods=['get'])
    def unread(self, request):
        """Get unread notifications"""
        notifications = self.get_queryset().filter(is_read=False)
        serializer = self.get_serializer(notifications, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        """Get unread count"""
        count = self.get_queryset().filter(is_read=False).count()
        return Response({"count": count})
    
    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        """Mark notification as read"""
        notification = self.get_object()
        notification.mark_as_read()
        return Response({"success": True})
    
    @action(detail=False, methods=['post'])
    def mark_all_read(self, request):
        """Mark all notifications as read"""
        from django.utils import timezone
        count = self.get_queryset().filter(is_read=False).update(
            is_read=True,
            read_at=timezone.now()
        )
        return Response({"success": True, "count": count})

    @action(detail=False, methods=['post'])
    def mark_many_read(self, request):
        """Mark selected notifications as read"""
        from django.utils import timezone
        raw_ids = request.data.get('ids') or []
        if not isinstance(raw_ids, list):
            return Response({'error': 'ids phải là danh sách.'}, status=400)
        ids = []
        for raw in raw_ids:
            try:
                nid = int(raw)
            except (TypeError, ValueError):
                continue
            if nid > 0:
                ids.append(nid)
        if not ids:
            return Response({'error': 'ids không hợp lệ.'}, status=400)
        count = self.get_queryset().filter(id__in=ids, is_read=False).update(
            is_read=True,
            read_at=timezone.now(),
        )
        return Response({'success': True, 'count': count})

    @action(detail=False, methods=['get'])
    def live_updates(self, request):
        """Lightweight endpoint for notification realtime checks"""
        since_dt = TaskViewSet._parse_since(request.query_params.get('since'))
        if since_dt == 'INVALID':
            return Response({'error': 'since phải là ISO datetime hợp lệ.'}, status=400)

        qs = self.get_queryset()
        latest_at = qs.order_by('-created_at', '-id').values_list('created_at', flat=True).first()
        unread_count = qs.filter(is_read=False).count()
        changed_count = 0
        if since_dt is not None:
            changed_count = qs.filter(created_at__gt=since_dt).count()
        return Response({
            'has_changes': changed_count > 0,
            'latest_at': latest_at,
            'server_time': django_timezone.now(),
            'changed_count': changed_count,
            'unread_count': unread_count,
        })


class UserSessionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = UserSessionSerializer

    def get_queryset(self):
        # User only sees their own sessions
        return UserSession.objects.filter(user=self.request.user).order_by('-is_active', '-last_active', '-login_at')

    @action(detail=True, methods=['post'])
    def revoke(self, request, pk=None):
        """Revoke a specific session"""
        session = self.get_object()
        session.revoke()
        return Response({"success": True})

    @action(detail=False, methods=['post'])
    def revoke_all(self, request):
        """Revoke all sessions except current"""
        from django.utils import timezone
        current_session = _get_current_session_identifier(request)

        # Revoke all except current
        queryset = UserSession.objects.filter(user=request.user, is_active=True)
        if current_session:
            queryset = queryset.exclude(session_key=str(current_session))
        count = queryset.update(is_active=False, logout_at=timezone.now())

        return Response({"success": True, "count": count})


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        refresh_token = data.get('refresh')
        if refresh_token:
            token = RefreshToken(refresh_token)
            session_id = token.get('sid')
            if session_id:
                _register_user_session(request, serializer.user, session_id)

        return Response(data, status=status.HTTP_200_OK)
from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
import csv

@api_view(['GET'])
@permission_classes([AllowAny])
def customer_export_view(request):
    """Direct export view - CSV, Excel, or PDF"""
    from .models import ExportTemplate, Customer
    from datetime import datetime
    import csv
    from .utils import export_to_excel
    
    # Get format (csv or excel)
    format_type = request.GET.get('format', 'excel')
    
    # Get template
    template_id = request.GET.get('template_id')
    if template_id:
        try:
            template = ExportTemplate.objects.get(id=template_id, entity_type='Customer', is_active=True)
        except ExportTemplate.DoesNotExist:
            return HttpResponse('{"error": "Template not found"}', status=404, content_type='application/json')
    else:
        template = ExportTemplate.objects.filter(entity_type='Customer', is_default=True, is_active=True).first()
        if not template:
            return HttpResponse('{"error": "No default template"}', status=404, content_type='application/json')
    
    # Get data
    customers = Customer.objects.all()
    
    # Export based on format
    if format_type == 'csv':
        # CSV Export
        response = HttpResponse(content_type='text/csv; charset=utf-8-sig')
        response['Content-Disposition'] = f'attachment; filename="customers_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv"'
        writer = csv.writer(response)
        writer.writerow(template.headers)
        for customer in customers:
            row = []
            for field in template.columns:
                value = getattr(customer, field, '')
                row.append(str(value) if value else '')
            writer.writerow(row)
        return response
    elif format_type == 'pdf':
        # PDF Export
        from .utils import export_to_pdf
        filename = f'customers_{datetime.now().strftime("%Y%m%d_%H%M%S")}.pdf'
        return export_to_pdf(customers, template.columns, template.headers, filename, title='Customer List')
    else:
        # Excel Export (default)
        filename = f'customers_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'
        return export_to_excel(customers, template.columns, template.headers, filename)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    """Logout: Blacklist refresh token and revoke sessions"""
    from django.utils import timezone

    try:
        refresh_token = request.data.get('refresh')
        current_session_id = _get_current_session_identifier(request)
        if refresh_token:
            try:
                token = RefreshToken(refresh_token)
            except Exception:
                return Response({"error": "Refresh token khong hop le."}, status=400)
            blacklist_token = getattr(token, 'blacklist', None)
            if callable(blacklist_token):
                blacklist_token()
            current_session_id = token.get('sid') or current_session_id

        session_qs = UserSession.objects.filter(user=request.user, is_active=True)
        if current_session_id:
            session_qs = session_qs.filter(session_key=str(current_session_id))
        session_qs.update(is_active=False, logout_at=timezone.now())

        return Response({"success": True, "message": "Logged out successfully"})
    except Exception:
        return Response({"error": "Logout failed."}, status=400)


class TaskViewSet(viewsets.ModelViewSet):
    """
    CRUD + actions cho nhiệm vụ (task/assignment).
    Lọc theo entity: GET /api/v1/tasks/?entity_type=Product&entity_id=5
    """
    serializer_class = TaskSerializer
    permission_classes = [IsAuthenticated]

    def _can_manage_task(self, user, task):
        return (
            task.assigned_to_id == user.id
            or task.assigned_by_id == user.id
            or user.is_staff
            or user.is_superuser
        )

    @staticmethod
    def _parse_since(since_raw):
        if since_raw is None or str(since_raw).strip() == '':
            return None
        dt = parse_datetime(str(since_raw).strip())
        if dt is None:
            return 'INVALID'
        if django_timezone.is_naive(dt):
            dt = django_timezone.make_aware(dt, django_timezone.get_current_timezone())
        return dt

    def get_queryset(self):
        user = self.request.user
        comment_count_subquery = (
            Comment.objects
            .filter(entity_type='Task', entity_id=OuterRef('pk'), is_deleted=False)
            .values('entity_id')
            .annotate(cnt=Count('id'))
            .values('cnt')
        )
        attachment_count_subquery = (
            Attachment.objects
            .filter(entity_type='Task', entity_id=OuterRef('pk'))
            .values('entity_id')
            .annotate(cnt=Count('id'))
            .values('cnt')
        )
        latest_comment_subquery = (
            Comment.objects
            .filter(entity_type='Task', entity_id=OuterRef('pk'), is_deleted=False)
            .order_by('-created_at')
            .values('created_at')[:1]
        )
        latest_attachment_subquery = (
            Attachment.objects
            .filter(entity_type='Task', entity_id=OuterRef('pk'))
            .order_by('-uploaded_at')
            .values('uploaded_at')[:1]
        )
        watcher_count_subquery = (
            TaskWatcher.objects
            .filter(task_id=OuterRef('pk'))
            .values('task_id')
            .annotate(cnt=Count('id'))
            .values('cnt')
        )
        is_watching_subquery = TaskWatcher.objects.filter(task_id=OuterRef('pk'), user=user)

        qs = (
            Task.objects
            .select_related('assigned_to', 'assigned_by', 'last_updated_by', 'depends_on')
            .annotate(
                comment_count_db=Coalesce(
                    Subquery(comment_count_subquery, output_field=IntegerField()),
                    0,
                ),
                attachment_count_db=Coalesce(
                    Subquery(attachment_count_subquery, output_field=IntegerField()),
                    0,
                ),
                latest_comment_at_db=Subquery(latest_comment_subquery, output_field=DateTimeField()),
                latest_attachment_at_db=Subquery(latest_attachment_subquery, output_field=DateTimeField()),
                watchers_count_db=Coalesce(
                    Subquery(watcher_count_subquery, output_field=IntegerField()),
                    0,
                ),
                is_watching_db=Exists(is_watching_subquery),
            )
        )
        entity_type = self.request.query_params.get('entity_type')
        entity_id = self.request.query_params.get('entity_id')
        if entity_type:
            qs = qs.filter(entity_type=entity_type)
        if entity_id:
            qs = qs.filter(entity_id=entity_id)
        status_param = self.request.query_params.get('status')
        if status_param:
            qs = qs.filter(status=status_param)
        is_open = self.request.query_params.get('is_open')
        if is_open == '1':
            qs = qs.filter(status__in=[Task.STATUS_TODO, Task.STATUS_IN_PROGRESS])
        needs_help = self.request.query_params.get('needs_help')
        if needs_help == '1':
            qs = qs.filter(needs_help=True, status__in=[Task.STATUS_TODO, Task.STATUS_IN_PROGRESS])
        is_blocking = self.request.query_params.get('is_blocking')
        if is_blocking == '1':
            qs = qs.filter(is_blocking=True, status__in=[Task.STATUS_TODO, Task.STATUS_IN_PROGRESS])
        is_overdue = self.request.query_params.get('is_overdue')
        if is_overdue == '1':
            qs = qs.filter(
                due_date__lt=django_timezone.localdate(),
                status__in=[Task.STATUS_TODO, Task.STATUS_IN_PROGRESS],
            )
        dependency_blocked = self.request.query_params.get('dependency_blocked')
        if dependency_blocked == '1':
            qs = qs.filter(depends_on__isnull=False).exclude(depends_on__status=Task.STATUS_DONE)
        tag = (self.request.query_params.get('tag') or '').strip().lower()
        if tag:
            qs = qs.filter(tags__contains=[tag])
        q = (self.request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(
                models.Q(title__icontains=q)
                | models.Q(description__icontains=q)
                | models.Q(entity_code__icontains=q)
            )
        mine = self.request.query_params.get('mine')
        if mine == '1':
            qs = qs.filter(assigned_to=self.request.user)
        created_by_me = self.request.query_params.get('created_by_me')
        if created_by_me == '1':
            qs = qs.filter(assigned_by=self.request.user)
        watching = self.request.query_params.get('watching')
        if watching == '1':
            qs = qs.filter(watchers__user=self.request.user)
        team_members = self.request.query_params.get('team_members')
        if team_members == '1':
            team_ids = list(self.request.user.teams.values_list('id', flat=True))
            if team_ids:
                qs = qs.filter(assigned_to__teams__id__in=team_ids).exclude(assigned_to=self.request.user)
            else:
                qs = qs.none()
        ordering_mode = (self.request.query_params.get('ordering_mode') or '').strip()
        if ordering_mode == 'quick_queue':
            today = django_timezone.localdate()
            qs = qs.annotate(
                overdue_rank=models.Case(
                    models.When(
                        due_date__lt=today,
                        status__in=[Task.STATUS_TODO, Task.STATUS_IN_PROGRESS],
                        then=models.Value(1),
                    ),
                    default=models.Value(0),
                    output_field=IntegerField(),
                ),
                dependency_rank=models.Case(
                    models.When(depends_on__isnull=False, depends_on__status=Task.STATUS_DONE, then=models.Value(0)),
                    models.When(depends_on__isnull=False, then=models.Value(1)),
                    default=models.Value(0),
                    output_field=IntegerField(),
                ),
                priority_rank=models.Case(
                    models.When(priority=Task.PRIORITY_URGENT, then=models.Value(4)),
                    models.When(priority=Task.PRIORITY_HIGH, then=models.Value(3)),
                    models.When(priority=Task.PRIORITY_MEDIUM, then=models.Value(2)),
                    default=models.Value(1),
                    output_field=IntegerField(),
                ),
            )
            return qs.order_by('-is_pinned', '-is_blocking', '-needs_help', '-overdue_rank', '-dependency_rank', '-priority_rank', 'due_date', '-created_at').distinct()
        # Mặc định: ưu tiên ghim + blocking + mới nhất
        return qs.order_by('-is_pinned', '-is_blocking', '-created_at').distinct()

    @action(detail=True, methods=['post'])
    def start(self, request, pk=None):
        task = self.get_object()
        if task.status != Task.STATUS_TODO:
            return Response({'error': 'Chỉ có thể bắt đầu nhiệm vụ đang ở trạng thái Chờ thực hiện.'}, status=400)
        if task.depends_on_id and task.depends_on and task.depends_on.status != Task.STATUS_DONE:
            return Response(
                {'error': f'Nhiệm vụ này đang chờ "{task.depends_on.title}" hoàn thành.'},
                status=400
            )
        task.start()
        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        task = self.get_object()
        if task.status == Task.STATUS_DONE:
            return Response({'error': 'Nhiệm vụ này đã hoàn thành.'}, status=400)
        if task.status == Task.STATUS_CANCELLED:
            return Response({'error': 'Không thể hoàn thành nhiệm vụ đã hủy.'}, status=400)
        task.complete(user=request.user)
        # Tự động đẩy qua bước kế tiếp nếu task thuộc pipeline template.
        from .workflow_services import auto_advance_pipeline_from_completed_task
        auto_advance_pipeline_from_completed_task(task, actor=request.user)
        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        task = self.get_object()
        if task.status in (Task.STATUS_DONE, Task.STATUS_CANCELLED):
            return Response({'error': 'Không thể hủy nhiệm vụ đã hoàn thành hoặc đã hủy.'}, status=400)
        task.cancel()
        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def unblock(self, request, pk=None):
        """Tắt blocking flag — chỉ manager/admin hoặc người tạo task."""
        task = self.get_object()
        reason = (request.data.get('reason') or '').strip()

        if not task.is_blocking:
            return Response({'error': 'Nhiệm vụ này không có blocking.'}, status=400)

        # Permission: người tạo hoặc staff/admin
        is_creator = task.assigned_by_id == request.user.id
        if not (is_creator or request.user.is_staff or request.user.is_superuser):
            return Response({'error': 'Chỉ người tạo hoặc quản lý mới có thể bỏ blocking.'}, status=403)

        task.is_blocking = False
        # Ghi lý do vào description nếu có
        if reason:
            note = f'\n\n[Bỏ blocking bởi {request.user.get_full_name() or request.user.username} — Lý do: {reason}]'
            task.description = (task.description or '') + note
            task.save(update_fields=['is_blocking', 'description', 'updated_at'])
        else:
            task.save(update_fields=['is_blocking', 'updated_at'])

        # Ghi AuditLog
        AuditLog.objects.create(
            user=request.user,
            action='UPDATE',
            entity_type='Task',
            entity_id=task.id,
            entity_code=task.entity_code or str(task.id),
            changed_fields=['is_blocking'],
            old_values={'is_blocking': True},
            new_values={'is_blocking': False, 'reason': reason},
        )

        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def request_help(self, request, pk=None):
        """Nhân viên báo cần hỗ trợ — thông báo cho người tạo task và manager."""
        task = self.get_object()
        if not task.is_open:
            return Response({'error': 'Chỉ có thể báo cần hỗ trợ cho nhiệm vụ đang mở.'}, status=400)

        reason = (request.data.get('reason') or '').strip()
        task.needs_help = True
        task.help_reason = reason
        task.help_requested_at = django_timezone.now()
        task.save(update_fields=['needs_help', 'help_reason', 'help_requested_at', 'updated_at'])

        # Thông báo cho người tạo task (nếu khác người báo)
        actor_name = request.user.get_full_name() or request.user.username
        msg = f'{actor_name} cần hỗ trợ cho nhiệm vụ "{task.title}"'
        if reason:
            msg += f' — {reason}'
        recipients = set()
        if task.assigned_by_id and task.assigned_by_id != request.user.id:
            recipients.add(task.assigned_by_id)
        # Thông báo cho superuser/staff nếu cần (có thể mở rộng sau)
        for uid in recipients:
            Notification.objects.create(
                recipient_id=uid,
                notification_type='system',
                title=f'🆘 Cần hỗ trợ: {task.title[:60]}',
                message=msg,
                entity_type='Task',
                entity_id=task.id,
                actor=request.user,
            )
        AuditLog.objects.create(
            user=request.user, action='UPDATE', entity_type='Task',
            entity_id=task.id, entity_code=task.entity_code or str(task.id),
            changed_fields=['needs_help'], old_values={'needs_help': False},
            new_values={'needs_help': True, 'reason': reason},
        )
        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def resolve_help(self, request, pk=None):
        """Manager/người tạo đánh dấu đã xử lý hỗ trợ."""
        task = self.get_object()
        if not task.needs_help:
            return Response({'error': 'Nhiệm vụ này không có yêu cầu hỗ trợ.'}, status=400)
        is_creator = task.assigned_by_id == request.user.id
        if not (is_creator or request.user.is_staff or request.user.is_superuser):
            return Response({'error': 'Chỉ người tạo hoặc quản lý mới có thể giải quyết hỗ trợ.'}, status=403)

        task.needs_help = False
        task.help_reason = ''
        task.save(update_fields=['needs_help', 'help_reason', 'updated_at'])

        # Thông báo lại cho người đã báo cần hỗ trợ
        if task.assigned_to_id and task.assigned_to_id != request.user.id:
            Notification.objects.create(
                recipient_id=task.assigned_to_id,
                notification_type='system',
                title=f'✅ Đã được hỗ trợ: {task.title[:60]}',
                message=f'{request.user.get_full_name() or request.user.username} đã xác nhận hỗ trợ cho nhiệm vụ "{task.title}".',
                entity_type='Task', entity_id=task.id, actor=request.user,
            )
        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def reassign(self, request, pk=None):
        """Chuyển nhiệm vụ sang người khác — assigned person, creator, hoặc manager."""
        task = self.get_object()
        if not task.is_open:
            return Response({'error': 'Chỉ có thể chuyển nhiệm vụ đang mở.'}, status=400)

        new_assignee_id = request.data.get('assigned_to')
        note = (request.data.get('note') or '').strip()

        is_assigned = task.assigned_to_id == request.user.id
        is_creator = task.assigned_by_id == request.user.id
        if not (is_assigned or is_creator or request.user.is_staff or request.user.is_superuser):
            return Response({'error': 'Không có quyền chuyển nhiệm vụ này.'}, status=403)

        old_assignee_name = task.assigned_to.get_full_name() if task.assigned_to else 'Chưa giao'
        old_assignee_id = task.assigned_to_id

        task.assigned_to_id = new_assignee_id or None
        # Reset cần hỗ trợ khi chuyển người — đúng logic: help request gắn với người cũ
        # KHÔNG đụng last_update_note — giữ nguyên tiến độ cho người nhận mới tham khảo
        task.needs_help = False
        task.help_reason = ''
        task.save(update_fields=['assigned_to', 'needs_help', 'help_reason', 'updated_at'])

        # Lý do chuyển giao → lưu vào Comment để giữ lịch sử, KHÔNG ghi đè ghi chú tiến độ
        actor_name = request.user.get_full_name() or request.user.username
        new_assignee_obj = task.assigned_to
        new_name = new_assignee_obj.get_full_name() or new_assignee_obj.username if new_assignee_obj else 'Chưa xác định'
        comment_content = f'🔄 **Chuyển giao nhiệm vụ**\nTừ: {old_assignee_name} → Đến: {new_name}\nBởi: {actor_name}'
        if note:
            comment_content += f'\nLý do: {note}'
        if task.last_update_note:
            comment_content += f'\n\n📋 *Tiến độ hiện tại: {task.last_update_note}*'
        Comment.objects.create(
            entity_type='Task',
            entity_id=task.id,
            content=comment_content,
            created_by=request.user,
        )

        # Thông báo cho người nhận mới
        if new_assignee_id and new_assignee_id != request.user.id:
            notif_msg = f'{actor_name} đã chuyển giao nhiệm vụ "{task.title}" cho bạn'
            if old_assignee_id:
                notif_msg += f' (từ {old_assignee_name})'
            if note:
                notif_msg += f'. Lý do: {note}'
            if task.last_update_note:
                notif_msg += f'. Tiến độ hiện tại: {task.last_update_note}'
            Notification.objects.create(
                recipient_id=new_assignee_id,
                notification_type='assignment',
                title=f'👤 Nhiệm vụ chuyển giao: {task.title[:60]}',
                message=notif_msg,
                entity_type='Task', entity_id=task.id, actor=request.user,
            )

        # Thông báo cho người cũ (nếu là bên thứ ba chuyển, không phải tự chuyển)
        if old_assignee_id and old_assignee_id != request.user.id and old_assignee_id != new_assignee_id:
            Notification.objects.create(
                recipient_id=old_assignee_id,
                notification_type='system',
                title=f'↩️ Nhiệm vụ đã được chuyển: {task.title[:60]}',
                message=f'{actor_name} đã chuyển nhiệm vụ "{task.title}" từ bạn sang {new_name}.',
                entity_type='Task', entity_id=task.id, actor=request.user,
            )

        AuditLog.objects.create(
            user=request.user, action='UPDATE', entity_type='Task',
            entity_id=task.id, entity_code=task.entity_code or str(task.id),
            changed_fields=['assigned_to'],
            old_values={'assigned_to': old_assignee_id, 'assignee_name': old_assignee_name},
            new_values={'assigned_to': new_assignee_id, 'assignee_name': new_name, 'note': note},
        )
        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def add_note(self, request, pk=None):
        """Thêm ghi chú tiến độ — người được giao, người tạo, hoặc manager."""
        task = self.get_object()
        note = (request.data.get('note') or '').strip()
        if not note:
            return Response({'error': 'Vui lòng nhập nội dung ghi chú.'}, status=400)

        is_involved = (
            task.assigned_to_id == request.user.id
            or task.assigned_by_id == request.user.id
            or request.user.is_staff
            or request.user.is_superuser
        )
        if not is_involved:
            return Response({'error': 'Chỉ người liên quan đến nhiệm vụ mới có thể ghi chú.'}, status=403)

        task.last_update_note = note
        task.last_update_at = django_timezone.now()
        task.last_updated_by = request.user
        if task.needs_help and task.assigned_by_id == request.user.id:
            task.needs_help = False  # Manager trả lời → tự reset help flag
        task.save(update_fields=['last_update_note', 'last_update_at', 'last_updated_by', 'needs_help', 'updated_at'])
        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def remind_overdue(self, request, pk=None):
        """
        Nhắc quá hạn cho nhiệm vụ mở.
        - Người liên quan/manager có thể bấm nhắc tay.
        - Chống spam: không gửi trùng cho cùng recipient trong 6 giờ gần nhất.
        """
        task = self.get_object()
        if not task.is_open:
            return Response({'error': 'Chỉ nhắc quá hạn cho nhiệm vụ đang mở.'}, status=400)
        if not task.due_date:
            return Response({'error': 'Nhiệm vụ chưa có hạn hoàn thành.'}, status=400)
        if task.due_date >= django_timezone.localdate():
            return Response({'error': 'Nhiệm vụ chưa quá hạn.'}, status=400)
        if not self._can_manage_task(request.user, task):
            return Response({'error': 'Không có quyền gửi nhắc quá hạn cho nhiệm vụ này.'}, status=403)

        actor_name = request.user.get_full_name() or request.user.username
        overdue_days = (django_timezone.localdate() - task.due_date).days
        sent_count = 0
        recipients = set()
        if task.assigned_to_id:
            recipients.add(task.assigned_to_id)
        if task.assigned_by_id:
            recipients.add(task.assigned_by_id)

        # Escalation nhẹ: quá hạn >= 2 ngày thì nhắc thêm manager/admin.
        if overdue_days >= 2:
            manager_ids = User.objects.filter(
                models.Q(is_staff=True) | models.Q(is_superuser=True),
                is_active=True,
            ).values_list('id', flat=True)
            recipients.update(set(manager_ids))

        recipients.discard(request.user.id)
        cool_down_since = django_timezone.now() - timedelta(hours=6)

        for uid in recipients:
            duplicated_recent = Notification.objects.filter(
                recipient_id=uid,
                notification_type='due_date',
                entity_type='Task',
                entity_id=task.id,
                created_at__gte=cool_down_since,
            ).exists()
            if duplicated_recent:
                continue
            Notification.objects.create(
                recipient_id=uid,
                notification_type='due_date',
                title=f'⏰ Nhắc quá hạn: {task.title[:60]}',
                message=(
                    f'{actor_name} nhắc nhiệm vụ "{task.title}" đã quá hạn {overdue_days} ngày.'
                    f' Hạn: {task.due_date.strftime("%d/%m/%Y")}.'
                ),
                entity_type='Task',
                entity_id=task.id,
                actor=request.user,
            )
            sent_count += 1

        # Ghi comment sự kiện để timeline rõ loại event.
        Comment.objects.create(
            entity_type='Task',
            entity_id=task.id,
            content=(
                f'⏰ **Nhắc quá hạn** bởi {actor_name}\n'
                f'Quá hạn: {overdue_days} ngày (hạn {task.due_date.strftime("%d/%m/%Y")}).'
            ),
            created_by=request.user,
        )
        AuditLog.objects.create(
            user=request.user,
            action='UPDATE',
            entity_type='Task',
            entity_id=task.id,
            entity_code=task.entity_code or str(task.id),
            changed_fields=['overdue_reminder'],
            old_values={'sent_count': 0},
            new_values={'sent_count': sent_count, 'overdue_days': overdue_days},
        )
        return Response({
            'success': True,
            'sent_count': sent_count,
            'overdue_days': overdue_days,
            'message': f'Đã gửi {sent_count} thông báo nhắc quá hạn.',
        })

    @action(detail=True, methods=['post'])
    def watch(self, request, pk=None):
        task = self.get_object()
        TaskWatcher.objects.get_or_create(task=task, user=request.user)
        return Response({'success': True, 'watching': True})

    @action(detail=True, methods=['post'])
    def unwatch(self, request, pk=None):
        task = self.get_object()
        TaskWatcher.objects.filter(task=task, user=request.user).delete()
        return Response({'success': True, 'watching': False})

    @action(detail=False, methods=['post'])
    def bulk_action(self, request):
        """
        Thao tác task hàng loạt.
        Body:
          {
            "action": "START" | "COMPLETE" | "REMIND_OVERDUE" | "REASSIGN",
            "task_ids": [1,2,3]
          }
        """
        action_name = str(request.data.get('action') or '').strip().upper()
        raw_ids = request.data.get('task_ids') or []
        if action_name not in ('START', 'COMPLETE', 'REMIND_OVERDUE', 'REASSIGN'):
            return Response({'error': 'action không hợp lệ.'}, status=400)
        if not isinstance(raw_ids, list):
            return Response({'error': 'task_ids phải là danh sách.'}, status=400)

        ordered_ids = []
        for raw_id in raw_ids:
            try:
                task_id = int(raw_id)
            except (TypeError, ValueError):
                continue
            if task_id > 0 and task_id not in ordered_ids:
                ordered_ids.append(task_id)
        if not ordered_ids:
            return Response({'error': 'task_ids không hợp lệ.'}, status=400)

        task_map = {
            task.id: task
            for task in Task.objects.select_related('depends_on', 'assigned_to', 'assigned_by').filter(id__in=ordered_ids)
        }
        today = django_timezone.localdate()
        cool_down_since = django_timezone.now() - timedelta(hours=6)
        actor_name = request.user.get_full_name() or request.user.username
        reassign_to_raw = request.data.get('assigned_to', None)
        reassign_note = (request.data.get('note') or '').strip()
        new_assignee = None
        if action_name == 'REASSIGN':
            if reassign_to_raw in (None, '', 0, '0'):
                new_assignee = None
            else:
                try:
                    reassign_to_id = int(reassign_to_raw)
                except (TypeError, ValueError):
                    return Response({'error': 'assigned_to không hợp lệ.'}, status=400)
                new_assignee = User.objects.filter(id=reassign_to_id, is_active=True).first()
                if not new_assignee:
                    return Response({'error': 'Không tìm thấy người nhận nhiệm vụ hợp lệ.'}, status=400)
        items = []
        success_count = 0
        failed_count = 0
        reminder_sent_total = 0
        failed_items = []

        for task_id in ordered_ids:
            task = task_map.get(task_id)
            if not task:
                failed_count += 1
                failed_items.append({'task_id': task_id, 'message': 'Không tìm thấy nhiệm vụ.'})
                items.append({
                    'task_id': task_id,
                    'success': False,
                    'message': 'Không tìm thấy nhiệm vụ.',
                })
                continue
            try:
                if action_name == 'START':
                    if task.status != Task.STATUS_TODO:
                        raise ValueError('Chỉ có thể bắt đầu nhiệm vụ đang ở trạng thái Chờ thực hiện.')
                    if task.depends_on_id and task.depends_on and task.depends_on.status != Task.STATUS_DONE:
                        raise ValueError(f'Nhiệm vụ đang chờ "{task.depends_on.title}" hoàn thành.')
                    task.start()
                    success_count += 1
                    items.append({
                        'task_id': task.id,
                        'success': True,
                        'message': 'Đã bắt đầu nhiệm vụ.',
                    })
                    continue

                if action_name == 'COMPLETE':
                    if task.status == Task.STATUS_DONE:
                        raise ValueError('Nhiệm vụ đã hoàn thành.')
                    if task.status == Task.STATUS_CANCELLED:
                        raise ValueError('Không thể hoàn thành nhiệm vụ đã hủy.')
                    task.complete(user=request.user)
                    from .workflow_services import auto_advance_pipeline_from_completed_task
                    auto_advance_pipeline_from_completed_task(task, actor=request.user)
                    success_count += 1
                    items.append({
                        'task_id': task.id,
                        'success': True,
                        'message': 'Đã hoàn thành nhiệm vụ.',
                    })
                    continue

                if action_name == 'REMIND_OVERDUE':
                    if not task.is_open:
                        raise ValueError('Chỉ nhắc quá hạn cho nhiệm vụ đang mở.')
                    if not task.due_date:
                        raise ValueError('Nhiệm vụ chưa có hạn hoàn thành.')
                    if task.due_date >= today:
                        raise ValueError('Nhiệm vụ chưa quá hạn.')
                    if not self._can_manage_task(request.user, task):
                        raise PermissionError('Không có quyền gửi nhắc quá hạn cho nhiệm vụ này.')

                    overdue_days = (today - task.due_date).days
                    recipients = set()
                    if task.assigned_to_id:
                        recipients.add(task.assigned_to_id)
                    if task.assigned_by_id:
                        recipients.add(task.assigned_by_id)
                    if overdue_days >= 2:
                        manager_ids = User.objects.filter(
                            models.Q(is_staff=True) | models.Q(is_superuser=True),
                            is_active=True,
                        ).values_list('id', flat=True)
                        recipients.update(set(manager_ids))
                    recipients.discard(request.user.id)

                    sent_count = 0
                    for uid in recipients:
                        duplicated_recent = Notification.objects.filter(
                            recipient_id=uid,
                            notification_type='due_date',
                            entity_type='Task',
                            entity_id=task.id,
                            created_at__gte=cool_down_since,
                        ).exists()
                        if duplicated_recent:
                            continue
                        Notification.objects.create(
                            recipient_id=uid,
                            notification_type='due_date',
                            title=f'⏰ Nhắc quá hạn: {task.title[:60]}',
                            message=(
                                f'{actor_name} nhắc nhiệm vụ "{task.title}" đã quá hạn {overdue_days} ngày.'
                                f' Hạn: {task.due_date.strftime("%d/%m/%Y")}.'
                            ),
                            entity_type='Task',
                            entity_id=task.id,
                            actor=request.user,
                        )
                        sent_count += 1
                    Comment.objects.create(
                        entity_type='Task',
                        entity_id=task.id,
                        content=(
                            f'⏰ **Nhắc quá hạn (bulk)** bởi {actor_name}\n'
                            f'Quá hạn: {overdue_days} ngày (hạn {task.due_date.strftime("%d/%m/%Y")}).'
                        ),
                        created_by=request.user,
                    )
                    AuditLog.objects.create(
                        user=request.user,
                        action='UPDATE',
                        entity_type='Task',
                        entity_id=task.id,
                        entity_code=task.entity_code or str(task.id),
                        changed_fields=['overdue_reminder'],
                        old_values={'sent_count': 0},
                        new_values={'sent_count': sent_count, 'overdue_days': overdue_days, 'mode': 'BULK'},
                    )
                    success_count += 1
                    reminder_sent_total += sent_count
                    items.append({
                        'task_id': task.id,
                        'success': True,
                        'message': 'Đã xử lý nhắc quá hạn.',
                        'sent_count': sent_count,
                    })
                    continue

                if action_name == 'REASSIGN':
                    if not task.is_open:
                        raise ValueError('Chỉ chuyển giao nhiệm vụ đang mở.')
                    if not self._can_manage_task(request.user, task):
                        raise PermissionError('Không có quyền chuyển nhiệm vụ này.')
                    old_assignee_id = task.assigned_to_id
                    old_assignee_name = task.assigned_to.get_full_name() if task.assigned_to else 'Chưa giao'
                    new_assignee_name = (
                        new_assignee.get_full_name() or new_assignee.username
                        if new_assignee else 'Chưa giao'
                    )
                    task.assigned_to = new_assignee
                    task.needs_help = False
                    task.help_reason = ''
                    task.save(update_fields=['assigned_to', 'needs_help', 'help_reason', 'updated_at'])
                    comment_content = (
                        f'🔄 **Chuyển giao nhiệm vụ (bulk)**\n'
                        f'Từ: {old_assignee_name} → Đến: {new_assignee_name}\n'
                        f'Bởi: {actor_name}'
                    )
                    if reassign_note:
                        comment_content += f'\nLý do: {reassign_note}'
                    if task.last_update_note:
                        comment_content += f'\n\n📋 *Tiến độ hiện tại: {task.last_update_note}*'
                    Comment.objects.create(
                        entity_type='Task',
                        entity_id=task.id,
                        content=comment_content,
                        created_by=request.user,
                    )
                    AuditLog.objects.create(
                        user=request.user,
                        action='UPDATE',
                        entity_type='Task',
                        entity_id=task.id,
                        entity_code=task.entity_code or str(task.id),
                        changed_fields=['assigned_to'],
                        old_values={'assigned_to': old_assignee_id},
                        new_values={
                            'assigned_to': new_assignee.id if new_assignee else None,
                            'mode': 'BULK',
                            'note': reassign_note,
                        },
                    )
                    if new_assignee and new_assignee.id != request.user.id:
                        Notification.objects.create(
                            recipient_id=new_assignee.id,
                            notification_type='system',
                            title=f'🔄 Bạn được giao {task.title[:60]}',
                            message=f'{actor_name} vừa chuyển nhiệm vụ "{task.title}" cho bạn.',
                            entity_type='Task',
                            entity_id=task.id,
                            actor=request.user,
                        )
                    success_count += 1
                    items.append({
                        'task_id': task.id,
                        'success': True,
                        'message': f'Đã chuyển nhiệm vụ sang {new_assignee_name}.',
                    })
                    continue

                raise ValueError('Thao tác không hỗ trợ.')
            except PermissionError as e:
                failed_count += 1
                failed_items.append({'task_id': task.id, 'message': str(e)})
                items.append({
                    'task_id': task.id,
                    'success': False,
                    'message': str(e),
                })
            except Exception as e:
                failed_count += 1
                failed_items.append({'task_id': task.id, 'message': str(e)})
                items.append({
                    'task_id': task.id,
                    'success': False,
                    'message': str(e),
                })

        summary_payload = {
            'success': True,
            'action': action_name,
            'total_requested': len(ordered_ids),
            'processed_count': len(items),
            'success_count': success_count,
            'failed_count': failed_count,
            'reminder_sent_count': reminder_sent_total,
            'items': items,
        }
        # Audit log tổng hợp cho thao tác hàng loạt (dùng cho lịch sử vận hành).
        AuditLog.objects.create(
            user=request.user,
            action='UPDATE',
            entity_type='TaskBulk',
            entity_id=0,
            entity_code='TASK_BULK',
            changed_fields=['bulk_action'],
            old_values={},
            new_values={
                'action': action_name,
                'total_requested': len(ordered_ids),
                'processed_count': len(items),
                'success_count': success_count,
                'failed_count': failed_count,
                'reminder_sent_count': reminder_sent_total,
                'failed_items': failed_items[:50],
            },
        )
        return Response(summary_payload)

    @action(detail=False, methods=['get'])
    def bulk_history(self, request):
        """
        Lịch sử thao tác task hàng loạt (từ AuditLog).
        Query:
          - action: START | COMPLETE | REMIND_OVERDUE | REASSIGN
          - result: ALL | SUCCESS | HAS_ERROR
          - limit: 1..200
        """
        action_filter = str(request.query_params.get('action') or 'ALL').strip().upper()
        result_filter = str(request.query_params.get('result') or 'ALL').strip().upper()
        try:
            limit = int(request.query_params.get('limit') or 50)
        except (TypeError, ValueError):
            return Response({'error': 'limit phải là số nguyên.'}, status=400)
        limit = max(1, min(limit, 200))

        qs = AuditLog.objects.filter(entity_type='TaskBulk').order_by('-created_at', '-id')
        # Mặc định user xem log của chính mình; staff/superuser có thể xem tất cả bằng include_all=1
        include_all = str(request.query_params.get('include_all') or '').strip().lower() in ('1', 'true', 'yes')
        if not include_all or not (request.user.is_staff or request.user.is_superuser):
            qs = qs.filter(user=request.user)

        items = []
        for log in qs[:limit]:
            payload = log.new_values or {}
            action_name = str(payload.get('action') or '').upper()
            failed_count = int(payload.get('failed_count') or 0)
            if action_filter != 'ALL' and action_name != action_filter:
                continue
            if result_filter == 'SUCCESS' and failed_count > 0:
                continue
            if result_filter == 'HAS_ERROR' and failed_count == 0:
                continue
            items.append({
                'id': str(log.id),
                'action': action_name,
                'action_label': (
                    'Bắt đầu' if action_name == 'START'
                    else 'Hoàn thành' if action_name == 'COMPLETE'
                    else 'Nhắc quá hạn' if action_name == 'REMIND_OVERDUE'
                    else 'Chuyển người xử lý' if action_name == 'REASSIGN'
                    else action_name
                ),
                'selected_count': int(payload.get('total_requested') or 0),
                'processed_count': int(payload.get('processed_count') or 0),
                'success_count': int(payload.get('success_count') or 0),
                'failed_count': failed_count,
                'reminder_sent_count': int(payload.get('reminder_sent_count') or 0),
                'failed_items': payload.get('failed_items') or [],
                'actor': log.user.username if log.user else None,
                'created_at': log.created_at,
            })

        return Response({'items': items, 'total': len(items)})

    @action(detail=False, methods=['post'])
    def clear_bulk_history(self, request):
        """
        Xóa lịch sử thao tác hàng loạt.
        - User thường: xóa log của chính mình.
        - Staff/Superuser + include_all=1: xóa toàn bộ.
        """
        include_all = str(request.data.get('include_all') or '').strip().lower() in ('1', 'true', 'yes')
        qs = AuditLog.objects.filter(entity_type='TaskBulk')
        if include_all and (request.user.is_staff or request.user.is_superuser):
            deleted, _ = qs.delete()
            return Response({'success': True, 'deleted_count': deleted, 'scope': 'ALL'})
        qs = qs.filter(user=request.user)
        deleted, _ = qs.delete()
        return Response({'success': True, 'deleted_count': deleted, 'scope': 'MINE'})

    @action(detail=False, methods=['get'])
    def live_updates(self, request):
        """
        Endpoint nhẹ để frontend kiểm tra có thay đổi mới hay không.
        Query:
          - since: ISO datetime (UTC/local đều được)
          - dùng lại các filter chính của /tasks/ để theo đúng scope đang xem
        """
        since_dt = self._parse_since(request.query_params.get('since'))
        if since_dt == 'INVALID':
            return Response({'error': 'since phải là ISO datetime hợp lệ.'}, status=400)

        qs = self.get_queryset()
        latest_task_at = qs.order_by('-updated_at', '-id').values_list('updated_at', flat=True).first()
        latest_bulk_log_at = (
            AuditLog.objects
            .filter(entity_type='TaskBulk', user=request.user)
            .order_by('-created_at', '-id')
            .values_list('created_at', flat=True)
            .first()
        )
        latest_audit_at = (
            AuditLog.objects
            .filter(entity_type='Task', entity_id__in=qs.values('id'))
            .order_by('-created_at', '-id')
            .values_list('created_at', flat=True)
            .first()
        )
        latest_candidates = [v for v in (latest_task_at, latest_bulk_log_at, latest_audit_at) if v is not None]
        latest_at = max(latest_candidates) if latest_candidates else None

        task_changed_count = 0
        bulk_changed_count = 0
        audit_changed_count = 0
        if since_dt is not None:
            task_changed_count = qs.filter(updated_at__gt=since_dt).count()
            bulk_changed_count = AuditLog.objects.filter(
                entity_type='TaskBulk',
                user=request.user,
                created_at__gt=since_dt,
            ).count()
            audit_changed_count = AuditLog.objects.filter(
                entity_type='Task',
                entity_id__in=qs.values('id'),
                created_at__gt=since_dt,
            ).count()

        return Response({
            'has_changes': (task_changed_count + bulk_changed_count + audit_changed_count) > 0,
            'latest_at': latest_at,
            'server_time': django_timezone.now(),
            'task_changed_count': task_changed_count,
            'bulk_changed_count': bulk_changed_count,
            'audit_changed_count': audit_changed_count,
        })

    @action(detail=False, methods=['get'])
    def my_summary(self, request):
        today = django_timezone.localdate()
        team_ids = list(request.user.teams.values_list('id', flat=True))
        open_statuses = [Task.STATUS_TODO, Task.STATUS_IN_PROGRESS]

        assigned_to_me = Task.objects.filter(assigned_to=request.user, status__in=open_statuses).count()
        created_by_me = Task.objects.filter(assigned_by=request.user, status__in=open_statuses).count()
        watching = Task.objects.filter(watchers__user=request.user, status__in=open_statuses).distinct().count()
        overdue = Task.objects.filter(
            status__in=open_statuses,
            due_date__lt=today,
        ).filter(
            models.Q(assigned_to=request.user)
            | models.Q(assigned_by=request.user)
            | models.Q(watchers__user=request.user)
        ).distinct().count()
        if team_ids:
            team_members = Task.objects.filter(
                status__in=open_statuses,
                assigned_to__teams__id__in=team_ids,
            ).exclude(assigned_to=request.user).distinct().count()
        else:
            team_members = 0

        return Response({
            'assigned_to_me': assigned_to_me,
            'created_by_me': created_by_me,
            'watching': watching,
            'team_members': team_members,
            'overdue': overdue,
        })

    def perform_update(self, serializer):
        """Ghi AuditLog khi edit task. Dùng serializer.instance để tránh gọi get_object() thêm lần nữa."""
        track_fields = ['title', 'description', 'assigned_to_id', 'depends_on_id', 'priority', 'is_pinned', 'tags', 'is_blocking', 'due_date']
        # Snapshot giá trị cũ TRƯỚC khi save (serializer.instance do DRF đã fetch)
        old_snapshot = {f: getattr(serializer.instance, f) for f in track_fields}

        instance = serializer.save()

        changed, old_vals, new_vals = [], {}, {}
        for field in track_fields:
            old_val = old_snapshot[field]
            new_val = getattr(instance, field)
            if old_val != new_val:
                changed.append(field)
                old_vals[field] = str(old_val) if old_val is not None else None
                new_vals[field] = str(new_val) if new_val is not None else None

        if changed:
            AuditLog.objects.create(
                user=self.request.user,
                action='UPDATE',
                entity_type='Task',
                entity_id=instance.id,
                entity_code=instance.entity_code or str(instance.id),
                changed_fields=changed,
                old_values=old_vals,
                new_values=new_vals,
            )


class WorkflowTaskTemplateViewSet(viewsets.ModelViewSet):
    """
    CRUD Mẫu nhiệm vụ workflow.
    GET  /api/workflow-task-templates/
    POST /api/workflow-task-templates/{id}/preview_generate/  — xem trước task sẽ sinh
    POST /api/workflow-task-templates/generate_for_entity/    — sinh thật task cho entity
    """
    serializer_class = WorkflowTaskTemplateSerializer
    permission_classes = [IsAuthenticated]
    SCHEDULER_JOB_NAME = WORKFLOW_SCHEDULER_JOB_NAME

    @staticmethod
    def _ensure_workflow_view_permission(user):
        if not _can_view_workflow(user):
            raise PermissionDenied('Bạn không có quyền xem dữ liệu workflow.')

    @staticmethod
    def _ensure_workflow_manage_permission(user):
        if not _can_manage_workflow(user):
            raise PermissionDenied('Bạn không có quyền quản lý dữ liệu workflow.')

    @staticmethod
    def _to_bool(value, default=False):
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in ('1', 'true', 'yes', 'on')

    @staticmethod
    def _default_automation_profiles():
        from .workflow_services import get_default_automation_profiles
        return get_default_automation_profiles()

    def _get_automation_pref(self):
        pref, _ = UserPreferences.objects.get_or_create(
            user=self.request.user,
            page='workflow-automation-profiles',
            defaults={'config': {}},
        )
        return pref

    def get_queryset(self):
        self._ensure_workflow_view_permission(self.request.user)
        qs = WorkflowTaskTemplate.objects.select_related('created_by')
        entity_type = self.request.query_params.get('entity_type')
        trigger = self.request.query_params.get('trigger')
        is_active = self.request.query_params.get('is_active')
        if entity_type:
            qs = qs.filter(entity_type=entity_type)
        if trigger:
            qs = qs.filter(trigger=trigger)
        if is_active is not None:
            qs = qs.filter(is_active=(is_active not in ('0', 'false', 'False')))
        return qs

    def perform_create(self, serializer):
        self._ensure_workflow_manage_permission(self.request.user)
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        self._ensure_workflow_manage_permission(self.request.user)
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_workflow_manage_permission(self.request.user)
        instance.delete()

    @action(detail=False, methods=['post'], url_path='generate_for_entity')
    def generate_for_entity(self, request):
        """
        Sinh task từ template cho một entity + trigger cụ thể.
        Body: { entity_type, entity_id, entity_code, trigger }
        Returns: { created: [...task titles], skipped: N }
        """
        self._ensure_workflow_manage_permission(request.user)
        from .workflow_services import generate_tasks_for_entity

        entity_type = (request.data.get('entity_type') or '').strip()
        entity_id = request.data.get('entity_id')
        entity_code = (request.data.get('entity_code') or '').strip()
        trigger = (request.data.get('trigger') or '').strip()

        if not entity_type or not entity_id or not trigger:
            return Response(
                {'error': 'entity_type, entity_id và trigger là bắt buộc.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            entity_id = int(entity_id)
        except (TypeError, ValueError):
            return Response({'error': 'entity_id phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)

        created = generate_tasks_for_entity(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_code=entity_code,
            trigger=trigger,
            triggered_by=request.user,
        )

        return Response({
            'created_count': len(created),
            'created': [{'id': t.id, 'title': t.title, 'source_key': t.source_key} for t in created],
        })

    @action(detail=False, methods=['post'], url_path='preview_generate')
    def preview_generate(self, request):
        """
        Xem trước task sẽ được sinh (không tạo thật).
        Body: { entity_type, entity_id, entity_code, trigger }
        """
        self._ensure_workflow_view_permission(request.user)
        from .workflow_services import preview_tasks_for_entity

        entity_type = (request.data.get('entity_type') or '').strip()
        entity_id = request.data.get('entity_id')
        entity_code = (request.data.get('entity_code') or '').strip()
        trigger = (request.data.get('trigger') or '').strip()

        if not entity_type or not entity_id or not trigger:
            return Response(
                {'error': 'entity_type, entity_id và trigger là bắt buộc.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            entity_id = int(entity_id)
        except (TypeError, ValueError):
            return Response({'error': 'entity_id phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)

        preview = preview_tasks_for_entity(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_code=entity_code,
            trigger=trigger,
        )

        return Response({'preview': preview, 'total': len(preview)})

    @action(detail=False, methods=['get'], url_path='pipeline_board')
    def pipeline_board(self, request):
        """
        Board quy trình kiểu cột cho entity + trigger.
        GET /api/workflow-task-templates/pipeline_board/?entity_type=SalesOrder&trigger=SUBMIT&limit=200
        """
        self._ensure_workflow_view_permission(request.user)
        from .workflow_services import build_workflow_pipeline_board

        entity_type = (request.query_params.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.query_params.get('trigger') or 'SUBMIT').strip()
        limit_raw = request.query_params.get('limit') or '200'
        try:
            limit = int(limit_raw)
        except (TypeError, ValueError):
            return Response({'error': 'limit phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        limit = max(10, min(limit, 500))

        data = build_workflow_pipeline_board(
            entity_type=entity_type,
            trigger=trigger,
            limit=limit,
        )
        return Response(data)

    @action(detail=False, methods=['get'], url_path='pipeline_live_updates')
    def pipeline_live_updates(self, request):
        """
        Endpoint nhẹ để board biết khi nào cần reload.
        Query:
          - entity_type, trigger
          - since: ISO datetime
        """
        self._ensure_workflow_view_permission(request.user)
        entity_type = (request.query_params.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.query_params.get('trigger') or 'SUBMIT').strip()
        since_dt = TaskViewSet._parse_since(request.query_params.get('since'))
        if since_dt == 'INVALID':
            return Response({'error': 'since phải là ISO datetime hợp lệ.'}, status=400)

        events_qs = WorkflowPipelineEvent.objects.filter(entity_type=entity_type, trigger=trigger)
        latest_event_at = events_qs.order_by('-created_at', '-id').values_list('created_at', flat=True).first()
        latest_template_at = (
            WorkflowTaskTemplate.objects
            .filter(entity_type=entity_type, trigger=trigger, is_active=True)
            .order_by('-updated_at', '-id')
            .values_list('updated_at', flat=True)
            .first()
        )
        latest_candidates = [v for v in (latest_event_at, latest_template_at) if v is not None]
        latest_at = max(latest_candidates) if latest_candidates else None

        event_changed_count = 0
        template_changed_count = 0
        if since_dt is not None:
            event_changed_count = events_qs.filter(created_at__gt=since_dt).count()
            template_changed_count = WorkflowTaskTemplate.objects.filter(
                entity_type=entity_type,
                trigger=trigger,
                is_active=True,
                updated_at__gt=since_dt,
            ).count()

        return Response({
            'has_changes': (event_changed_count + template_changed_count) > 0,
            'latest_at': latest_at,
            'server_time': django_timezone.now(),
            'event_changed_count': event_changed_count,
            'template_changed_count': template_changed_count,
            'entity_type': entity_type,
            'trigger': trigger,
        })

    @action(detail=False, methods=['post'], url_path='advance_pipeline')
    def advance_pipeline(self, request):
        """
        Chuyển entity sang bước kế tiếp.
        Body: {entity_type, entity_id, entity_code, trigger, note}
        """
        self._ensure_workflow_manage_permission(request.user)
        from .workflow_services import advance_pipeline_step

        entity_type = (request.data.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.data.get('trigger') or 'SUBMIT').strip()
        entity_code = (request.data.get('entity_code') or '').strip()
        note = (request.data.get('note') or '').strip()
        try:
            entity_id = int(request.data.get('entity_id'))
        except (TypeError, ValueError):
            return Response({'error': 'entity_id phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)

        result = advance_pipeline_step(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_code=entity_code,
            trigger=trigger,
            actor=request.user,
            note=note,
        )
        if not result.get('success'):
            return Response({'error': result.get('error') or 'Không thể chuyển bước.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)

    @action(detail=False, methods=['post'], url_path='move_pipeline_card')
    def move_pipeline_card(self, request):
        """
        Di chuyển card sang cột khác (drag-drop).
        Body: {entity_type, entity_id, entity_code, trigger, target_column_id, note}
        """
        self._ensure_workflow_manage_permission(request.user)
        from .workflow_services import move_pipeline_card

        entity_type = (request.data.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.data.get('trigger') or 'SUBMIT').strip()
        entity_code = (request.data.get('entity_code') or '').strip()
        target_column_id = (request.data.get('target_column_id') or '').strip()
        note = (request.data.get('note') or '').strip()
        if not target_column_id:
            return Response({'error': 'target_column_id là bắt buộc.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            entity_id = int(request.data.get('entity_id'))
        except (TypeError, ValueError):
            return Response({'error': 'entity_id phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)

        result = move_pipeline_card(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_code=entity_code,
            trigger=trigger,
            target_column_id=target_column_id,
            actor=request.user,
            note=note,
        )
        if not result.get('success'):
            return Response({'error': result.get('error') or 'Không thể di chuyển card.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)

    @action(detail=False, methods=['get'], url_path='pipeline_timeline')
    def pipeline_timeline(self, request):
        """
        Timeline sự kiện pipeline theo entity.
        GET .../pipeline_timeline/?entity_type=SalesOrder&entity_id=123&limit=100
        """
        from .workflow_services import get_pipeline_timeline

        entity_type = (request.query_params.get('entity_type') or 'SalesOrder').strip()
        try:
            entity_id = int(request.query_params.get('entity_id'))
        except (TypeError, ValueError):
            return Response({'error': 'entity_id phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            limit = int(request.query_params.get('limit') or 100)
        except (TypeError, ValueError):
            limit = 100
        limit = max(10, min(limit, 300))

        timeline = get_pipeline_timeline(entity_type=entity_type, entity_id=entity_id, limit=limit)
        return Response({'items': timeline, 'total': len(timeline)})

    @action(detail=False, methods=['post'], url_path='retry_pipeline_failed')
    def retry_pipeline_failed(self, request):
        """
        Khôi phục card Failed về bước xử lý trước đó.
        Body: {entity_type, entity_id, entity_code, trigger, note}
        """
        from .workflow_services import retry_pipeline_from_failed

        entity_type = (request.data.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.data.get('trigger') or 'SUBMIT').strip()
        entity_code = (request.data.get('entity_code') or '').strip()
        note = (request.data.get('note') or '').strip()
        try:
            entity_id = int(request.data.get('entity_id'))
        except (TypeError, ValueError):
            return Response({'error': 'entity_id phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)

        result = retry_pipeline_from_failed(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_code=entity_code,
            trigger=trigger,
            actor=request.user,
            note=note,
        )
        if not result.get('success'):
            return Response({'error': result.get('error') or 'Không thể khôi phục card failed.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)

    @action(detail=False, methods=['get'], url_path='pipeline_analytics')
    def pipeline_analytics(self, request):
        """
        Dashboard analytics cho pipeline theo entity/trigger.
        GET .../pipeline_analytics/?entity_type=SalesOrder&trigger=SUBMIT&days=30
        """
        from .workflow_services import get_pipeline_analytics

        entity_type = (request.query_params.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.query_params.get('trigger') or 'SUBMIT').strip()
        try:
            days = int(request.query_params.get('days') or 30)
        except (TypeError, ValueError):
            return Response({'error': 'days phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        days = max(1, min(days, 365))

        data = get_pipeline_analytics(entity_type=entity_type, trigger=trigger, days=days)
        return Response(data)

    @action(detail=False, methods=['post'], url_path='run_automation')
    def run_automation(self, request):
        """
        Chạy automation workflow theo entity/trigger.
        Body: {entity_type, trigger, remind_overdue, auto_start_ready, reminder_cooldown_hours}
        """
        from .workflow_services import run_pipeline_automation

        entity_type = (request.data.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.data.get('trigger') or 'SUBMIT').strip()
        remind_overdue = self._to_bool(request.data.get('remind_overdue'), default=True)
        auto_start_ready = self._to_bool(request.data.get('auto_start_ready'), default=True)
        try:
            reminder_cooldown_hours = int(request.data.get('reminder_cooldown_hours') or 24)
        except (TypeError, ValueError):
            return Response({'error': 'reminder_cooldown_hours phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        reminder_cooldown_hours = max(1, min(reminder_cooldown_hours, 168))

        result = run_pipeline_automation(
            entity_type=entity_type,
            trigger=trigger,
            actor=request.user,
            remind_overdue=remind_overdue,
            auto_start_ready=auto_start_ready,
            reminder_cooldown_hours=reminder_cooldown_hours,
        )
        return Response(result)

    @action(detail=False, methods=['get'], url_path='automation_profiles')
    def automation_profiles(self, request):
        """
        Lấy cấu hình kịch bản tự động theo entity/trigger của user.
        """
        entity_type = (request.query_params.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.query_params.get('trigger') or 'SUBMIT').strip()
        pref = self._get_automation_pref()
        config = pref.config if isinstance(pref.config, dict) else {}
        key = f'{entity_type}:{trigger}'
        from .workflow_services import merge_automation_profiles
        saved = config.get(key) if isinstance(config.get(key), dict) else {}
        merged_profiles = merge_automation_profiles(saved)
        return Response({
            'entity_type': entity_type,
            'trigger': trigger,
            'profiles': merged_profiles,
        })

    @automation_profiles.mapping.post
    def save_automation_profiles(self, request):
        """
        Lưu cấu hình profile theo entity/trigger.
        Body: { entity_type, trigger, profiles: {MORNING|MIDDAY|EOD|CUSTOM: {...}} }
        """
        entity_type = (request.data.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.data.get('trigger') or 'SUBMIT').strip()
        profiles = request.data.get('profiles') or {}
        if not isinstance(profiles, dict):
            return Response({'error': 'profiles phải là object.'}, status=status.HTTP_400_BAD_REQUEST)

        normalized_profiles = {}
        defaults = self._default_automation_profiles()
        for profile_key in defaults.keys():
            raw = profiles.get(profile_key)
            if raw is not None and not isinstance(raw, dict):
                return Response({'error': f'Profile {profile_key} không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
            data = raw if isinstance(raw, dict) else {}
            try:
                cooldown = int(data.get('reminder_cooldown_hours') or defaults[profile_key]['reminder_cooldown_hours'])
            except (TypeError, ValueError):
                return Response({'error': f'reminder_cooldown_hours của {profile_key} phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
            normalized_profiles[profile_key] = {
                'name': str(data.get('name') or defaults[profile_key]['name']).strip() or defaults[profile_key]['name'],
                'remind_overdue': self._to_bool(data.get('remind_overdue'), default=defaults[profile_key]['remind_overdue']),
                'auto_start_ready': self._to_bool(data.get('auto_start_ready'), default=defaults[profile_key]['auto_start_ready']),
                'reminder_cooldown_hours': max(1, min(168, cooldown)),
            }

        pref = self._get_automation_pref()
        config = pref.config if isinstance(pref.config, dict) else {}
        key = f'{entity_type}:{trigger}'
        config[key] = normalized_profiles
        pref.config = config
        pref.save(update_fields=['config', 'updated_at'])
        return Response({
            'success': True,
            'entity_type': entity_type,
            'trigger': trigger,
            'profiles': normalized_profiles,
        })

    @action(detail=False, methods=['post'], url_path='run_automation_profile')
    def run_automation_profile(self, request):
        """
        Chạy tự động hóa theo profile đã lưu.
        Body: { entity_type, trigger, profile_key }
        """
        from .workflow_services import execute_automation_profile, merge_automation_profiles

        entity_type = (request.data.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.data.get('trigger') or 'SUBMIT').strip()
        profile_key = str(request.data.get('profile_key') or 'MORNING').strip().upper()
        defaults = self._default_automation_profiles()
        if profile_key not in defaults:
            return Response({'error': 'profile_key không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

        pref = self._get_automation_pref()
        config = pref.config if isinstance(pref.config, dict) else {}
        key = f'{entity_type}:{trigger}'
        profile = merge_automation_profiles(config.get(key)).get(profile_key, defaults[profile_key])
        result = execute_automation_profile(
            entity_type=entity_type,
            trigger=trigger,
            profile_key=profile_key,
            profile=profile,
            actor=request.user,
            run_mode='MANUAL_PROFILE',
        )
        return Response({
            'success': True,
            'profile_key': profile_key,
            'profile': profile,
            'result': result,
        })

    @action(detail=False, methods=['get'], url_path='automation_run_history')
    def automation_run_history(self, request):
        """
        Lịch sử chạy profile tự động hóa.
        """
        entity_type = (request.query_params.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.query_params.get('trigger') or 'SUBMIT').strip()
        run_mode = str(request.query_params.get('run_mode') or 'ALL').strip().upper()
        try:
            limit = int(request.query_params.get('limit') or 20)
        except (TypeError, ValueError):
            return Response({'error': 'limit phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        limit = max(1, min(limit, 100))
        key = f'{entity_type}:{trigger}'
        logs = (
            AuditLog.objects
            .select_related('user')
            .filter(entity_type='WorkflowAutomation', entity_id_str=key)
            .order_by('-created_at', '-id')[:limit]
        )
        items = []
        for log in logs:
            payload = log.new_values or {}
            if run_mode != 'ALL' and str(payload.get('run_mode') or '').upper() != run_mode:
                continue
            items.append({
                'id': log.id,
                'actor': log.user.username if log.user else '',
                'profile_key': payload.get('profile_key') or '',
                'run_mode': payload.get('run_mode') or 'MANUAL_PROFILE',
                'auto_started_count': int(payload.get('auto_started_count') or 0),
                'overdue_reminded_count': int(payload.get('overdue_reminded_count') or 0),
                'notifications_sent': int(payload.get('notifications_sent') or 0),
                'message': payload.get('message') or '',
                'created_at': log.created_at,
            })
        return Response({'items': items, 'total': len(items)})

    @action(detail=False, methods=['get'], url_path='automation_schedule')
    def automation_schedule(self, request):
        """
        Lấy cấu hình scheduler theo entity/trigger.
        """
        entity_type = (request.query_params.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.query_params.get('trigger') or 'SUBMIT').strip()
        pref, _ = UserPreferences.objects.get_or_create(
            user=request.user,
            page='workflow-automation-scheduler',
            defaults={'config': {}},
        )
        config = pref.config if isinstance(pref.config, dict) else {}
        key = f'{entity_type}:{trigger}'
        current = config.get(key) if isinstance(config.get(key), dict) else {}
        slots = current.get('slots') if isinstance(current.get('slots'), list) else [
            {'profile_key': 'MORNING', 'time': '08:00', 'active': True},
            {'profile_key': 'MIDDAY', 'time': '13:00', 'active': False},
            {'profile_key': 'EOD', 'time': '17:30', 'active': True},
        ]
        return Response({
            'entity_type': entity_type,
            'trigger': trigger,
            'enabled': bool(current.get('enabled', False)),
            'slots': slots,
        })

    @automation_schedule.mapping.post
    def save_automation_schedule(self, request):
        """
        Lưu cấu hình scheduler.
        Body: {entity_type, trigger, enabled, slots:[{profile_key,time,active}]}
        """
        entity_type = (request.data.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.data.get('trigger') or 'SUBMIT').strip()
        enabled = self._to_bool(request.data.get('enabled'), default=False)
        raw_slots = request.data.get('slots') or []
        if not isinstance(raw_slots, list):
            return Response({'error': 'slots phải là danh sách.'}, status=status.HTTP_400_BAD_REQUEST)
        valid_keys = set(self._default_automation_profiles().keys())
        slots = []
        for raw in raw_slots:
            if not isinstance(raw, dict):
                continue
            key = str(raw.get('profile_key') or '').strip().upper()
            time_str = str(raw.get('time') or '').strip()
            active = self._to_bool(raw.get('active'), default=True)
            if key not in valid_keys:
                return Response({'error': f'profile_key không hợp lệ: {key}'}, status=status.HTTP_400_BAD_REQUEST)
            if len(time_str) != 5 or time_str[2] != ':' or not time_str.replace(':', '').isdigit():
                return Response({'error': f'time không hợp lệ: {time_str}'}, status=status.HTTP_400_BAD_REQUEST)
            hh = int(time_str[:2])
            mm = int(time_str[3:])
            if hh < 0 or hh > 23 or mm < 0 or mm > 59:
                return Response({'error': f'time không hợp lệ: {time_str}'}, status=status.HTTP_400_BAD_REQUEST)
            slots.append({'profile_key': key, 'time': f'{hh:02d}:{mm:02d}', 'active': bool(active)})

        pref, _ = UserPreferences.objects.get_or_create(
            user=request.user,
            page='workflow-automation-scheduler',
            defaults={'config': {}},
        )
        config = pref.config if isinstance(pref.config, dict) else {}
        key = f'{entity_type}:{trigger}'
        old = config.get(key) if isinstance(config.get(key), dict) else {}
        last_marks = old.get('last_run_marks') if isinstance(old.get('last_run_marks'), dict) else {}
        config[key] = {'enabled': bool(enabled), 'slots': slots, 'last_run_marks': last_marks}
        pref.config = config
        pref.save(update_fields=['config', 'updated_at'])
        return Response({
            'success': True,
            'entity_type': entity_type,
            'trigger': trigger,
            'enabled': bool(enabled),
            'slots': slots,
        })

    @action(detail=False, methods=['post'], url_path='run_due_automation_schedule')
    def run_due_automation_schedule(self, request):
        """
        Chạy scheduler theo mốc thời gian hiện tại cho user hiện tại.
        Body: {dry_run?: bool}
        """
        from .workflow_services import run_due_automation_schedules_for_user
        dry_run = self._to_bool(request.data.get('dry_run'), default=False)
        entity_type = (request.data.get('entity_type') or '').strip()
        trigger = (request.data.get('trigger') or '').strip()
        result = run_due_automation_schedules_for_user(
            user=request.user,
            now=django_timezone.now(),
            dry_run=dry_run,
            only_entity_type=entity_type,
            only_trigger=trigger,
        )
        return Response(result)

    @action(detail=False, methods=['get'], url_path='scheduler_job_status')
    def scheduler_job_status(self, request):
        """
        Trạng thái global scheduler job (Django Q).
        """
        try:
            from django_q.models import Schedule
        except Exception:
            return Response({'error': 'Django Q chưa sẵn sàng.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        Schedule  # keep import-side availability check intact
        return Response(_get_workflow_scheduler_job_status_payload(job_name=self.SCHEDULER_JOB_NAME))

    @scheduler_job_status.mapping.post
    def save_scheduler_job_status(self, request):
        """
        Bật/tắt và cấu hình chu kỳ chạy scheduler job.
        Body: {enabled, interval_minutes}
        """
        try:
            from django_q.models import Schedule
        except Exception:
            return Response({'error': 'Django Q chưa sẵn sàng.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        enabled = self._to_bool(request.data.get('enabled'), default=True)
        try:
            interval_minutes = int(request.data.get('interval_minutes') or 5)
        except (TypeError, ValueError):
            return Response({'error': 'interval_minutes phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        interval_minutes = max(1, min(interval_minutes, 120))

        schedule, _created = Schedule.objects.get_or_create(
            name=self.SCHEDULER_JOB_NAME,
            defaults={
                'func': 'core.workflow_services.run_due_automation_schedules_job',
                'schedule_type': Schedule.MINUTES,
                'minutes': interval_minutes,
                'repeats': -1,
                'next_run': django_timezone.now(),
                'cluster': 'default',
            },
        )
        if enabled:
            schedule.func = 'core.workflow_services.run_due_automation_schedules_job'
            schedule.schedule_type = Schedule.MINUTES
            schedule.minutes = interval_minutes
            schedule.repeats = -1
            if not schedule.next_run:
                schedule.next_run = django_timezone.now()
        else:
            schedule.repeats = 0
            schedule.minutes = interval_minutes
        schedule.save()
        return Response({
            'success': True,
            'enabled': enabled,
            'name': schedule.name,
            'interval_minutes': int(schedule.minutes or interval_minutes),
            'next_run': schedule.next_run,
            'schedule_id': schedule.id,
            'lock_active': cache.get('workflow_automation_scheduler_job_lock') is not None,
        })

    @action(detail=False, methods=['get'], url_path='scheduler_health')
    def scheduler_health(self, request):
        """
        Health metrics cho scheduler job (global).
        """
        try:
            hours = int(request.query_params.get('hours') or 24)
        except (TypeError, ValueError):
            return Response({'error': 'hours phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(_get_workflow_scheduler_health_payload(hours=hours, job_name=self.SCHEDULER_JOB_NAME))

    @action(detail=False, methods=['post'], url_path='scheduler_recover')
    def scheduler_recover(self, request):
        """
        Khôi phục scheduler sau khi auto-disable.
        Body: {interval_minutes?, clear_lock?}
        """
        try:
            from django_q.models import Schedule
        except Exception:
            return Response({'error': 'Django Q chưa sẵn sàng.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        try:
            interval_minutes = int(request.data.get('interval_minutes') or 5)
        except (TypeError, ValueError):
            return Response({'error': 'interval_minutes phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        interval_minutes = max(1, min(interval_minutes, 120))
        clear_lock = self._to_bool(request.data.get('clear_lock'), default=False)
        if clear_lock:
            cache.delete('workflow_automation_scheduler_job_lock')

        schedule, _created = Schedule.objects.get_or_create(
            name=self.SCHEDULER_JOB_NAME,
            defaults={
                'func': 'core.workflow_services.run_due_automation_schedules_job',
                'schedule_type': Schedule.MINUTES,
                'minutes': interval_minutes,
                'repeats': -1,
                'next_run': django_timezone.now(),
                'cluster': 'default',
            },
        )
        schedule.func = 'core.workflow_services.run_due_automation_schedules_job'
        schedule.schedule_type = Schedule.MINUTES
        schedule.minutes = interval_minutes
        schedule.repeats = -1
        schedule.next_run = django_timezone.now()
        schedule.save()
        AuditLog.objects.create(
            user=request.user,
            action='UPDATE',
            entity_type='WorkflowAutomationJob',
            entity_id=0,
            entity_id_str='global',
            entity_code='WORKFLOW_AUTOMATION_JOB',
            changed_fields=['recover'],
            old_values={},
            new_values={
                'status': 'SUCCESS',
                'enabled': True,
                'interval_minutes': interval_minutes,
                'clear_lock': clear_lock,
                'message': 'Scheduler recovered manually.',
            },
        )
        return Response({
            'success': True,
            'enabled': True,
            'interval_minutes': interval_minutes,
            'next_run': schedule.next_run,
            'lock_active': cache.get('workflow_automation_scheduler_job_lock') is not None,
        })

    @action(detail=False, methods=['get'], url_path='scheduler_policy')
    def scheduler_policy(self, request):
        """
        Lấy policy tự phục hồi scheduler.
        """
        from .workflow_services import get_scheduler_policy, get_scheduler_policy_presets
        return Response({
            **get_scheduler_policy(),
            'presets': get_scheduler_policy_presets(),
        })

    @scheduler_policy.mapping.post
    def save_scheduler_policy(self, request):
        """
        Lưu policy tự phục hồi scheduler.
        Body: {failure_threshold}
        """
        try:
            failure_threshold = int(request.data.get('failure_threshold') or 3)
        except (TypeError, ValueError):
            return Response({'error': 'failure_threshold phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        failure_threshold = max(1, min(failure_threshold, 20))

        old_row = Setting.objects.filter(key='WORKFLOW_AUTOMATION_FAILURE_THRESHOLD').first()
        old_threshold = int(old_row.value) if old_row and str(old_row.value).isdigit() else None
        Setting.objects.update_or_create(
            key='WORKFLOW_AUTOMATION_FAILURE_THRESHOLD',
            defaults={
                'value': str(failure_threshold),
                'data_type': 'integer',
                'description': 'Ngưỡng fail liên tiếp để tự tắt scheduler workflow automation.',
                'is_active': True,
            },
        )
        AuditLog.objects.create(
            user=request.user,
            action='UPDATE',
            entity_type='WorkflowAutomationJob',
            entity_id=0,
            entity_id_str='global',
            entity_code='WORKFLOW_AUTOMATION_JOB',
            changed_fields=['policy_update'],
            old_values={'failure_threshold': old_threshold},
            new_values={
                'failure_threshold': failure_threshold,
                'message': 'Cập nhật policy scheduler thủ công.',
                'run_mode': 'MANUAL_POLICY',
                'status': 'SUCCESS',
            },
        )
        return Response({
            'success': True,
            'failure_threshold': failure_threshold,
        })

    @action(detail=False, methods=['post'], url_path='scheduler_apply_policy_preset')
    def scheduler_apply_policy_preset(self, request):
        """
        Áp dụng preset policy nhanh.
        Body: {preset_key: CONSERVATIVE|BALANCED|AGGRESSIVE}
        """
        from .workflow_services import get_scheduler_policy_presets

        preset_key = str(request.data.get('preset_key') or '').strip().upper()
        presets = get_scheduler_policy_presets()
        if preset_key not in presets:
            return Response({'error': 'preset_key không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
        profile = presets[preset_key]
        failure_threshold = int(profile.get('failure_threshold') or 3)
        old_row = Setting.objects.filter(key='WORKFLOW_AUTOMATION_FAILURE_THRESHOLD').first()
        old_threshold = int(old_row.value) if old_row and str(old_row.value).isdigit() else None
        Setting.objects.update_or_create(
            key='WORKFLOW_AUTOMATION_FAILURE_THRESHOLD',
            defaults={
                'value': str(failure_threshold),
                'data_type': 'integer',
                'description': 'Ngưỡng fail liên tiếp để tự tắt scheduler workflow automation.',
                'is_active': True,
            },
        )
        AuditLog.objects.create(
            user=request.user,
            action='UPDATE',
            entity_type='WorkflowAutomationJob',
            entity_id=0,
            entity_id_str='global',
            entity_code='WORKFLOW_AUTOMATION_JOB',
            changed_fields=['policy_preset'],
            old_values={'failure_threshold': old_threshold},
            new_values={
                'failure_threshold': failure_threshold,
                'preset_key': preset_key,
                'message': f'Áp dụng preset policy {preset_key}.',
                'run_mode': 'MANUAL_POLICY',
                'status': 'SUCCESS',
            },
        )
        return Response({
            'success': True,
            'preset_key': preset_key,
            'failure_threshold': failure_threshold,
        })

    @action(detail=False, methods=['post'], url_path='scheduler_notify_admins')
    def scheduler_notify_admins(self, request):
        """
        Gửi cảnh báo thủ công tới admin/staff.
        Body: {message}
        """
        from .workflow_services import notify_scheduler_admins

        message_text = str(request.data.get('message') or '').strip()
        if not message_text:
            message_text = 'Cảnh báo thủ công từ dashboard scheduler.'
        result = notify_scheduler_admins(message=message_text, actor=request.user)
        return Response(result)

    @action(detail=False, methods=['get'], url_path='scheduler_incidents')
    def scheduler_incidents(self, request):
        """
        Timeline sự cố/recovery của scheduler.
        """
        status_filter = str(request.query_params.get('status') or 'ALL').strip().upper()
        try:
            limit = int(request.query_params.get('limit') or 30)
        except (TypeError, ValueError):
            return Response({'error': 'limit phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(_get_workflow_scheduler_incidents_payload(status_filter=status_filter, limit=limit))

    @action(detail=False, methods=['post'], url_path='scheduler_simulate_failure')
    def scheduler_simulate_failure(self, request):
        """
        Mô phỏng lỗi scheduler để diễn tập (admin/staff).
        Body: {reason}
        """
        from .workflow_services import simulate_scheduler_failure

        if not (request.user.is_staff or request.user.is_superuser):
            return Response({'error': 'Chỉ admin/staff được phép mô phỏng lỗi scheduler.'}, status=status.HTTP_403_FORBIDDEN)
        reason = str(request.data.get('reason') or '').strip() or 'Manual failure simulation from dashboard.'
        result = simulate_scheduler_failure(reason=reason, actor=request.user)
        return Response(result)

    @action(detail=False, methods=['post'], url_path='execute_insight_action')
    def execute_insight_action(self, request):
        """
        Thực thi hành động gợi ý từ insight và ghi log truy vết.
        Body: {entity_type, trigger, insight_type, suggested_action}
        """
        from .workflow_services import execute_insight_action

        entity_type = (request.data.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.data.get('trigger') or 'SUBMIT').strip()
        insight_type = (request.data.get('insight_type') or '').strip()
        suggested_action = (request.data.get('suggested_action') or '').strip()
        if not insight_type or not suggested_action:
            return Response({'error': 'insight_type và suggested_action là bắt buộc.'}, status=status.HTTP_400_BAD_REQUEST)

        result = execute_insight_action(
            entity_type=entity_type,
            trigger=trigger,
            insight_type=insight_type,
            suggested_action=suggested_action,
            actor=request.user,
        )
        if not result.get('success'):
            return Response({'error': result.get('error') or 'Không thể thực thi gợi ý.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)

    @action(detail=False, methods=['post'], url_path='execute_insight_batch')
    def execute_insight_batch(self, request):
        """
        Thực thi nhiều insight actions một lần.
        Body: {
          entity_type, trigger,
          stop_on_error?: bool,
          items: [{insight_type, suggested_action}]
        }
        """
        from .workflow_services import execute_insight_actions_batch

        entity_type = (request.data.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.data.get('trigger') or 'SUBMIT').strip()
        raw_items = request.data.get('items') or []
        stop_on_error = self._to_bool(request.data.get('stop_on_error'), default=False)
        if not isinstance(raw_items, list):
            return Response({'error': 'items phải là danh sách.'}, status=status.HTTP_400_BAD_REQUEST)

        result = execute_insight_actions_batch(
            entity_type=entity_type,
            trigger=trigger,
            items=raw_items,
            actor=request.user,
            stop_on_error=stop_on_error,
        )
        if not result.get('success'):
            return Response({'error': result.get('error') or 'Không thể thực thi gợi ý hàng loạt.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)

    @action(detail=False, methods=['get'], url_path='insight_execution_history')
    def insight_execution_history(self, request):
        """
        Lấy lịch sử thực thi gợi ý theo entity/trigger.
        GET .../insight_execution_history/?entity_type=SalesOrder&trigger=SUBMIT&limit=20
        """
        from .workflow_services import get_insight_action_history

        entity_type = (request.query_params.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.query_params.get('trigger') or 'SUBMIT').strip()
        actor_query = (request.query_params.get('actor_query') or '').strip()
        suggested_action = (request.query_params.get('suggested_action') or '').strip()
        success_raw = request.query_params.get('success')
        success = None
        if success_raw is not None:
            lowered = str(success_raw).strip().lower()
            if lowered in ('1', 'true', 'yes'):
                success = True
            elif lowered in ('0', 'false', 'no'):
                success = False
            else:
                return Response({'error': 'success phải là true/false.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            limit = int(request.query_params.get('limit') or 20)
        except (TypeError, ValueError):
            return Response({'error': 'limit phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)

        data = get_insight_action_history(
            entity_type=entity_type,
            trigger=trigger,
            limit=limit,
            actor_query=actor_query,
            suggested_action=suggested_action,
            success=success,
        )
        return Response(data)

    @action(detail=False, methods=['get'], url_path='playbook_suggestions')
    def playbook_suggestions(self, request):
        """
        Lay bo goi y workflow playbook.
        GET .../playbook_suggestions/?entity_type=SalesOrder&scenario=STANDARD_ORDER
        """
        from .workflow_services import get_workflow_playbook_suggestions

        entity_type = (request.query_params.get('entity_type') or 'SalesOrder').strip()
        scenario = (request.query_params.get('scenario') or '').strip() or None
        data = get_workflow_playbook_suggestions(entity_type=entity_type, scenario=scenario)
        return Response(data)

    @action(detail=False, methods=['post'], url_path='apply_playbook')
    def apply_playbook(self, request):
        """
        Ap dung bo playbook vao template workflow.
        Body: {entity_type, scenario, overwrite_existing}
        """
        from .workflow_services import apply_workflow_playbook

        entity_type = (request.data.get('entity_type') or 'SalesOrder').strip()
        scenario = (request.data.get('scenario') or '').strip() or None
        overwrite_existing = self._to_bool(request.data.get('overwrite_existing'), default=False)

        result = apply_workflow_playbook(
            entity_type=entity_type,
            scenario=scenario,
            actor=request.user,
            overwrite_existing=overwrite_existing,
        )
        if not result.get('success'):
            return Response({'error': result.get('error') or 'Không thể áp dụng playbook.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)

    @action(detail=False, methods=['post'], url_path='bulk_pipeline_action')
    def bulk_pipeline_action(self, request):
        """
        Thao tác pipeline hàng loạt.
        Body: {entity_type, trigger, action, note, items:[{entity_id, entity_code}]}
        """
        from .workflow_services import bulk_pipeline_action

        entity_type = (request.data.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.data.get('trigger') or 'SUBMIT').strip()
        action_name = (request.data.get('action') or '').strip()
        note = (request.data.get('note') or '').strip()
        items = request.data.get('items') or []
        if not isinstance(items, list):
            return Response({'error': 'items phải là danh sách.'}, status=status.HTTP_400_BAD_REQUEST)

        result = bulk_pipeline_action(
            entity_type=entity_type,
            trigger=trigger,
            action=action_name,
            items=items,
            actor=request.user,
            note=note,
        )
        if not result.get('success'):
            return Response({'error': result.get('error') or 'Không thể thao tác hàng loạt.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)


# ── System Configuration ViewSets ─────────────────────────────────────────────


class SystemConfigurationPermissionMixin:
    permission_classes = [IsAuthenticated]

    def check_permissions(self, request):
        super().check_permissions(request)
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            if not (request.user.is_staff or request.user.is_superuser):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('Chỉ admin mới có thể thay đổi cấu hình hệ thống.')


class DocumentTypeViewSet(SystemConfigurationPermissionMixin, viewsets.ModelViewSet):
    queryset = DocumentType.objects.all().order_by('sort_order', 'name', 'code')
    serializer_class = DocumentTypeSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['code', 'name', 'entity_type', 'prefix']
    ordering_fields = ['sort_order', 'code', 'name']


class TaxRateViewSet(SystemConfigurationPermissionMixin, viewsets.ModelViewSet):
    queryset = TaxRate.objects.all().order_by('sort_order', 'rate_pct', 'code')
    serializer_class = TaxRateSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['code', 'name']
    ordering_fields = ['sort_order', 'code', 'rate_pct']


class ShiftViewSet(SystemConfigurationPermissionMixin, viewsets.ModelViewSet):
    queryset = Shift.objects.all().order_by('sort_order', 'name', 'code')
    serializer_class = ShiftSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['code', 'name', 'short_label']
    ordering_fields = ['sort_order', 'code', 'name']


class ExpenseCategoryViewSet(SystemConfigurationPermissionMixin, viewsets.ModelViewSet):
    queryset = ExpenseCategory.objects.all().order_by('sort_order', 'name', 'code')
    serializer_class = ExpenseCategorySerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['code', 'name']
    ordering_fields = ['sort_order', 'code', 'name']


class NumberSequenceViewSet(SystemConfigurationPermissionMixin, viewsets.ModelViewSet):
    queryset = NumberSequence.objects.all().order_by('entity_type')
    serializer_class = NumberSequenceSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['entity_type', 'prefix']
