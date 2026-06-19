import uuid
from decimal import Decimal, InvalidOperation

from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .models import User, Role, Permission, Team, Setting, Customer, ExportTemplate, SavedView, Attachment, Comment, Notification, UserSession, UserPreferences, ColumnPermission, Task, WorkflowTaskTemplate, TaskWatcher, DocumentType, TaxRate, Shift, ExpenseCategory, NumberSequence
from .permissions import CUSTOMER_PERMISSION_DEFINITIONS, user_has_customer_permission


ROLE_MODULE_PERMISSION_LOOKUP = {
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
ROLE_MODULE_PERMISSION_LOOKUP.update({
    (row['resource'], row['action']): row['field'].replace('_', '-')
    for row in CUSTOMER_PERMISSION_DEFINITIONS
})


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = '__all__'


class RoleSerializer(serializers.ModelSerializer):
    permissions = PermissionSerializer(many=True, read_only=True)
    permission_count = serializers.SerializerMethodField()
    user_count = serializers.SerializerMethodField()
    active_user_count = serializers.SerializerMethodField()
    last_activity_at = serializers.SerializerMethodField()
    last_activity_action = serializers.SerializerMethodField()
    module_keys = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = [
            'id', 'code', 'name', 'description', 'is_active', 'sort_order',
            'created_at', 'updated_at', 'created_by', 'updated_by',
            'deleted_at', 'deleted_by', 'permissions',
            'permission_count', 'user_count', 'active_user_count',
            'last_activity_at', 'last_activity_action', 'module_keys',
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at',
            'created_by', 'updated_by', 'deleted_at', 'deleted_by',
        ]

    def get_permission_count(self, obj):
        annotated_value = getattr(obj, 'permission_count', None)
        if annotated_value is not None:
            return int(annotated_value)
        cache_data = getattr(obj, '_prefetched_objects_cache', {})
        prefetched_permissions = cache_data.get('permissions')
        if prefetched_permissions is not None:
            return len(prefetched_permissions)
        return obj.permissions.count()

    def get_user_count(self, obj):
        annotated_value = getattr(obj, 'user_count', None)
        if annotated_value is not None:
            return int(annotated_value)
        return obj.users.count()

    def get_active_user_count(self, obj):
        annotated_value = getattr(obj, 'active_user_count', None)
        if annotated_value is not None:
            return int(annotated_value)
        return obj.users.filter(is_active=True).count()

    def get_last_activity_at(self, obj):
        return getattr(obj, 'last_activity_at', None)

    def get_last_activity_action(self, obj):
        return getattr(obj, 'last_activity_action', None)

    def get_module_keys(self, obj):
        cache_data = getattr(obj, '_prefetched_objects_cache', {})
        prefetched_permissions = cache_data.get('permissions')
        permission_rows = prefetched_permissions if prefetched_permissions is not None else obj.permissions.all()
        module_keys = []
        for permission in permission_rows:
            key = ROLE_MODULE_PERMISSION_LOOKUP.get(
                (str(permission.resource or '').upper(), str(permission.action or '').upper())
            )
            if key and key not in module_keys:
                module_keys.append(key)
        return module_keys


class TeamSerializer(serializers.ModelSerializer):
    user_count = serializers.SerializerMethodField()
    active_user_count = serializers.SerializerMethodField()
    locked_user_count = serializers.SerializerMethodField()
    last_activity_at = serializers.SerializerMethodField()
    last_activity_action = serializers.SerializerMethodField()

    class Meta:
        model = Team
        fields = [
            'id', 'code', 'name', 'description', 'is_active', 'sort_order',
            'created_at', 'updated_at', 'created_by', 'updated_by',
            'deleted_at', 'deleted_by',
            'user_count', 'active_user_count', 'locked_user_count',
            'last_activity_at', 'last_activity_action',
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at',
            'created_by', 'updated_by', 'deleted_at', 'deleted_by',
        ]

    def get_user_count(self, obj):
        annotated_value = getattr(obj, 'user_count', None)
        if annotated_value is not None:
            return int(annotated_value)
        return obj.users.count()

    def get_active_user_count(self, obj):
        annotated_value = getattr(obj, 'active_user_count', None)
        if annotated_value is not None:
            return int(annotated_value)
        return obj.users.filter(is_active=True).count()

    def get_locked_user_count(self, obj):
        annotated_value = getattr(obj, 'locked_user_count', None)
        if annotated_value is not None:
            return int(annotated_value)
        return obj.users.filter(is_locked=True).count()

    def get_last_activity_at(self, obj):
        return getattr(obj, 'last_activity_at', None)

    def get_last_activity_action(self, obj):
        return getattr(obj, 'last_activity_action', None)


class RoleWriteSerializer(serializers.ModelSerializer):
    permission_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
        write_only=True,
    )

    class Meta:
        model = Role
        fields = [
            'id', 'code', 'name', 'description', 'is_active', 'sort_order',
            'permission_ids',
        ]
        read_only_fields = ['id']

    def validate_code(self, value):
        normalized = str(value or '').strip().upper()
        queryset = Role.objects.filter(code=normalized, deleted_at__isnull=True)
        instance = getattr(self, 'instance', None)
        if instance is not None:
            queryset = queryset.exclude(id=instance.id)
        if queryset.exists():
            raise serializers.ValidationError('Ma vai tro da ton tai.')
        return normalized

    def validate_permission_ids(self, value):
        unique_ids = sorted({int(item) for item in value})
        if not unique_ids:
            return []
        existing_ids = set(Permission.objects.filter(id__in=unique_ids).values_list('id', flat=True))
        if existing_ids != set(unique_ids):
            raise serializers.ValidationError('Danh sach quyen khong hop le.')
        return unique_ids

    def create(self, validated_data):
        permission_ids = validated_data.pop('permission_ids', [])
        instance = super().create(validated_data)
        if permission_ids:
            instance.permissions.set(permission_ids)
        return instance

    def update(self, instance, validated_data):
        permission_ids = validated_data.pop('permission_ids', None)
        instance = super().update(instance, validated_data)
        if permission_ids is not None:
            instance.permissions.set(permission_ids)
        return instance

    def to_representation(self, instance):
        return RoleSerializer(instance, context=self.context).data


class TeamWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Team
        fields = [
            'id', 'code', 'name', 'description', 'is_active', 'sort_order',
        ]
        read_only_fields = ['id']

    def validate_code(self, value):
        normalized = str(value or '').strip().upper()
        queryset = Team.objects.filter(code=normalized, deleted_at__isnull=True)
        instance = getattr(self, 'instance', None)
        if instance is not None:
            queryset = queryset.exclude(id=instance.id)
        if queryset.exists():
            raise serializers.ValidationError('Ma nhom da ton tai.')
        return normalized

    def to_representation(self, instance):
        return TeamSerializer(instance, context=self.context).data


class OnboardingPresetSerializer(serializers.Serializer):
    key = serializers.CharField(max_length=50)
    name = serializers.CharField(max_length=120)
    description = serializers.CharField(required=False, allow_blank=True, default='')
    is_active = serializers.BooleanField(default=True)
    tone = serializers.CharField(required=False, allow_blank=True, default='blue')
    access_strategy = serializers.ChoiceField(
        choices=['merge', 'replace'],
        default='merge',
    )
    role_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
        default=list,
    )
    team_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
        default=list,
    )
    workflow_template_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
        default=list,
    )
    task_owner_mode = serializers.ChoiceField(
        choices=['target_user', 'template_rule'],
        default='target_user',
    )
    checklist = serializers.ListField(
        child=serializers.CharField(max_length=160),
        required=False,
        allow_empty=True,
        default=list,
    )
    email_notifications_enabled = serializers.BooleanField(default=True)
    email_notification_types = serializers.ListField(
        child=serializers.CharField(max_length=50),
        required=False,
        allow_empty=True,
        default=list,
    )

    def validate_key(self, value):
        normalized = str(value or '').strip().lower()
        normalized = normalized.replace(' ', '-').replace('_', '-')
        if not normalized:
            raise serializers.ValidationError('Can cung cap key cho preset.')
        if not all(ch.isalnum() or ch == '-' for ch in normalized):
            raise serializers.ValidationError('Key chi duoc gom chu, so va dau gach ngang.')
        return normalized[:50]

    def validate_role_ids(self, value):
        unique_ids = sorted({int(item) for item in value})
        if not unique_ids:
            return []
        existing_ids = set(Role.objects.filter(id__in=unique_ids, deleted_at__isnull=True).values_list('id', flat=True))
        if existing_ids != set(unique_ids):
            raise serializers.ValidationError('Danh sach vai tro khong hop le.')
        return unique_ids

    def validate_team_ids(self, value):
        unique_ids = sorted({int(item) for item in value})
        if not unique_ids:
            return []
        existing_ids = set(Team.objects.filter(id__in=unique_ids, deleted_at__isnull=True).values_list('id', flat=True))
        if existing_ids != set(unique_ids):
            raise serializers.ValidationError('Danh sach nhom khong hop le.')
        return unique_ids

    def validate_workflow_template_ids(self, value):
        unique_ids = sorted({int(item) for item in value})
        if not unique_ids:
            return []
        existing_ids = set(WorkflowTaskTemplate.objects.filter(id__in=unique_ids, is_active=True).values_list('id', flat=True))
        if existing_ids != set(unique_ids):
            raise serializers.ValidationError('Danh sach workflow template khong hop le.')
        return unique_ids

    def validate_checklist(self, value):
        cleaned = []
        for item in value:
            normalized = str(item or '').strip()
            if not normalized:
                continue
            cleaned.append(normalized[:160])
        return list(dict.fromkeys(cleaned))[:8]

    def validate_email_notification_types(self, value):
        cleaned = []
        for item in value:
            normalized = str(item or '').strip()
            if not normalized:
                continue
            cleaned.append(normalized[:50])
        return list(dict.fromkeys(cleaned))[:8]


class OnboardingPresetPreviewSerializer(serializers.Serializer):
    preset_key = serializers.CharField(max_length=50)
    user_id = serializers.IntegerField(min_value=1, required=False)
    access_strategy = serializers.ChoiceField(
        choices=['merge', 'replace'],
        required=False,
    )


class ApplyOnboardingPresetSerializer(OnboardingPresetPreviewSerializer):
    create_tasks = serializers.BooleanField(default=True)


class UserProvisionPreviewSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField(required=False, allow_blank=True)
    first_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    last_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    phone = serializers.CharField(required=False, allow_blank=True, max_length=20)
    preset_key = serializers.CharField(required=False, allow_blank=True, max_length=50)
    role_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
        default=list,
    )
    team_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
        default=list,
    )
    is_active = serializers.BooleanField(default=True)
    is_staff = serializers.BooleanField(default=False)
    create_tasks = serializers.BooleanField(default=True)
    include_security_task = serializers.BooleanField(default=True)

    def validate_username(self, value):
        normalized = str(value or '').strip()
        if not normalized:
            raise serializers.ValidationError('Can cung cap username.')
        return normalized

    def validate_phone(self, value):
        return str(value or '').strip()

    def validate_preset_key(self, value):
        return str(value or '').strip().lower()

    def validate_role_ids(self, value):
        unique_ids = sorted({int(item) for item in value})
        if not unique_ids:
            return []
        existing_ids = set(Role.objects.filter(id__in=unique_ids, deleted_at__isnull=True).values_list('id', flat=True))
        if existing_ids != set(unique_ids):
            raise serializers.ValidationError('Danh sach vai tro khong hop le.')
        return unique_ids

    def validate_team_ids(self, value):
        unique_ids = sorted({int(item) for item in value})
        if not unique_ids:
            return []
        existing_ids = set(Team.objects.filter(id__in=unique_ids, deleted_at__isnull=True).values_list('id', flat=True))
        if existing_ids != set(unique_ids):
            raise serializers.ValidationError('Danh sach nhom khong hop le.')
        return unique_ids


class CreateProvisionedUserSerializer(UserProvisionPreviewSerializer):
    password_mode = serializers.ChoiceField(
        choices=['generated', 'custom'],
        default='generated',
    )
    temporary_password = serializers.CharField(
        required=False,
        allow_blank=False,
        trim_whitespace=False,
        write_only=True,
    )

    def validate(self, attrs):
        attrs = super().validate(attrs)
        password_mode = attrs.get('password_mode') or 'generated'
        temporary_password = attrs.get('temporary_password')
        if password_mode == 'custom':
            if not temporary_password:
                raise serializers.ValidationError({'temporary_password': 'Can cung cap mat khau tam thoi.'})
            provisional_user = User(
                username=attrs.get('username', ''),
                email=attrs.get('email', ''),
                first_name=attrs.get('first_name', ''),
                last_name=attrs.get('last_name', ''),
            )
            validate_password(temporary_password, user=provisional_user)
        return attrs


class UserOffboardingPreviewSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(min_value=1)
    transfer_task_owner_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    deactivate_account = serializers.BooleanField(default=True)
    lock_account = serializers.BooleanField(default=True)
    revoke_access = serializers.BooleanField(default=True)
    revoke_sessions = serializers.BooleanField(default=True)

    def validate_user_id(self, value):
        if not User.objects.filter(id=value).exists():
            raise serializers.ValidationError('Nguoi dung khong ton tai.')
        return int(value)

    def validate_transfer_task_owner_id(self, value):
        if value in (None, ''):
            return None
        queryset = User.objects.filter(id=value, is_active=True)
        if not queryset.exists():
            raise serializers.ValidationError('Nguoi nhan ban giao khong hop le hoac da ngung hoat dong.')
        return int(value)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        user_id = attrs.get('user_id')
        transfer_task_owner_id = attrs.get('transfer_task_owner_id')
        if transfer_task_owner_id and transfer_task_owner_id == user_id:
            raise serializers.ValidationError({'transfer_task_owner_id': 'Khong the ban giao task cho chinh user dang offboarding.'})
        return attrs


class ApplyUserOffboardingSerializer(UserOffboardingPreviewSerializer):
    pass


class AccessReviewCampaignSerializer(serializers.Serializer):
    key = serializers.CharField(max_length=50)
    name = serializers.CharField(max_length=120)
    description = serializers.CharField(required=False, allow_blank=True, default='')
    is_active = serializers.BooleanField(default=True)
    tone = serializers.CharField(required=False, allow_blank=True, default='blue')
    scope = serializers.ChoiceField(
        choices=['all_active', 'dormant', 'privileged', 'unassigned', 'locked'],
        default='dormant',
    )
    review_action = serializers.ChoiceField(
        choices=['certify', 'revoke_access', 'lock_account'],
        default='certify',
    )
    role_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
        default=list,
    )
    team_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
        default=list,
    )
    inactivity_days = serializers.IntegerField(min_value=1, max_value=365, default=30)
    include_locked = serializers.BooleanField(default=False)
    only_active_users = serializers.BooleanField(default=True)
    checklist = serializers.ListField(
        child=serializers.CharField(max_length=160),
        required=False,
        allow_empty=True,
        default=list,
    )

    def validate_key(self, value):
        normalized = str(value or '').strip().lower()
        normalized = normalized.replace(' ', '-').replace('_', '-')
        if not normalized:
            raise serializers.ValidationError('Can cung cap key cho campaign.')
        if not all(ch.isalnum() or ch == '-' for ch in normalized):
            raise serializers.ValidationError('Key chi duoc gom chu, so va dau gach ngang.')
        return normalized[:50]

    def validate_role_ids(self, value):
        unique_ids = sorted({int(item) for item in value})
        if not unique_ids:
            return []
        existing_ids = set(Role.objects.filter(id__in=unique_ids, deleted_at__isnull=True).values_list('id', flat=True))
        if existing_ids != set(unique_ids):
            raise serializers.ValidationError('Danh sach vai tro khong hop le.')
        return unique_ids

    def validate_team_ids(self, value):
        unique_ids = sorted({int(item) for item in value})
        if not unique_ids:
            return []
        existing_ids = set(Team.objects.filter(id__in=unique_ids, deleted_at__isnull=True).values_list('id', flat=True))
        if existing_ids != set(unique_ids):
            raise serializers.ValidationError('Danh sach nhom khong hop le.')
        return unique_ids

    def validate_checklist(self, value):
        cleaned = []
        for item in value:
            normalized = str(item or '').strip()
            if not normalized:
                continue
            cleaned.append(normalized[:160])
        return list(dict.fromkeys(cleaned))[:8]


class AccessReviewPreviewSerializer(serializers.Serializer):
    campaign_key = serializers.CharField(max_length=50)
    selected_user_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
        default=list,
    )

    def validate_campaign_key(self, value):
        return str(value or '').strip().lower()

    def validate_selected_user_ids(self, value):
        unique_ids = sorted({int(item) for item in value})
        if not unique_ids:
            return []
        existing_ids = set(User.objects.filter(id__in=unique_ids).values_list('id', flat=True))
        if existing_ids != set(unique_ids):
            raise serializers.ValidationError('Danh sach nguoi dung khong hop le.')
        return unique_ids


class ApplyAccessReviewSerializer(AccessReviewPreviewSerializer):
    note = serializers.CharField(required=False, allow_blank=True, default='')


class AccessExceptionPolicySerializer(serializers.Serializer):
    key = serializers.CharField(max_length=50)
    pack_key = serializers.CharField(required=False, allow_blank=True, default='', max_length=50)
    name = serializers.CharField(max_length=120)
    description = serializers.CharField(required=False, allow_blank=True, default='')
    is_active = serializers.BooleanField(default=True)
    tone = serializers.CharField(required=False, allow_blank=True, default='blue')
    risk_level = serializers.ChoiceField(
        choices=['standard', 'elevated', 'critical'],
        default='standard',
    )
    approval_stage_count = serializers.IntegerField(min_value=1, max_value=2, default=1)
    approval_sla_hours = serializers.IntegerField(min_value=1, max_value=168, default=24)
    stage_one_label = serializers.CharField(required=False, allow_blank=True, default='Manager review', max_length=80)
    stage_two_label = serializers.CharField(required=False, allow_blank=True, default='Governance sign-off', max_length=80)
    default_duration_days = serializers.IntegerField(min_value=1, max_value=90, default=7)
    max_duration_days = serializers.IntegerField(min_value=1, max_value=180, default=30)
    requires_approval = serializers.BooleanField(default=True)
    role_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
        default=list,
    )
    team_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
        default=list,
    )
    checklist = serializers.ListField(
        child=serializers.CharField(max_length=160),
        required=False,
        allow_empty=True,
        default=list,
    )

    def validate_key(self, value):
        normalized = str(value or '').strip().lower()
        normalized = normalized.replace(' ', '-').replace('_', '-')
        if not normalized:
            raise serializers.ValidationError('Can cung cap key cho policy.')
        if not all(ch.isalnum() or ch == '-' for ch in normalized):
            raise serializers.ValidationError('Key chi duoc gom chu, so va dau gach ngang.')
        return normalized[:50]

    def validate_pack_key(self, value):
        return str(value or '').strip().lower()[:50]

    def validate_role_ids(self, value):
        unique_ids = sorted({int(item) for item in value})
        if not unique_ids:
            return []
        existing_ids = set(Role.objects.filter(id__in=unique_ids, deleted_at__isnull=True).values_list('id', flat=True))
        if existing_ids != set(unique_ids):
            raise serializers.ValidationError('Danh sach vai tro khong hop le.')
        return unique_ids

    def validate_team_ids(self, value):
        unique_ids = sorted({int(item) for item in value})
        if not unique_ids:
            return []
        existing_ids = set(Team.objects.filter(id__in=unique_ids, deleted_at__isnull=True).values_list('id', flat=True))
        if existing_ids != set(unique_ids):
            raise serializers.ValidationError('Danh sach nhom khong hop le.')
        return unique_ids

    def validate_checklist(self, value):
        cleaned = []
        for item in value:
            normalized = str(item or '').strip()
            if not normalized:
                continue
            cleaned.append(normalized[:160])
        return list(dict.fromkeys(cleaned))[:8]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if not attrs.get('role_ids') and not attrs.get('team_ids'):
            raise serializers.ValidationError('Can chon it nhat mot role hoac team cho exception policy.')
        if int(attrs.get('default_duration_days') or 0) > int(attrs.get('max_duration_days') or 0):
            raise serializers.ValidationError({'default_duration_days': 'Default duration khong duoc lon hon max duration.'})
        if not attrs.get('requires_approval', True):
            attrs['approval_stage_count'] = 1
        if int(attrs.get('approval_stage_count') or 1) < 2:
            attrs['stage_two_label'] = ''
        return attrs


class AccessExceptionRoutingRuleSerializer(serializers.Serializer):
    department_key = serializers.CharField(max_length=50)
    department_label = serializers.CharField(max_length=120)
    is_active = serializers.BooleanField(default=True)
    stage_one_mode = serializers.ChoiceField(
        choices=['directory_then_team', 'team_then_directory', 'directory_only', 'team_match', 'governance_pool'],
        default='directory_then_team',
    )
    stage_two_mode = serializers.ChoiceField(
        choices=['directory_then_independent', 'independent_team_then_directory', 'directory_only', 'independent_team_match', 'governance_pool', ''],
        default='directory_then_independent',
        required=False,
        allow_blank=True,
    )
    stage_one_primary_user_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    stage_one_delegate_user_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    stage_two_primary_user_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    stage_two_delegate_user_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    stage_one_rotation_user_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
        default=list,
    )
    stage_two_rotation_user_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
        default=list,
    )
    fallback_team_tokens = serializers.ListField(
        child=serializers.CharField(max_length=40),
        required=False,
        allow_empty=True,
        default=list,
    )
    notes = serializers.CharField(required=False, allow_blank=True, default='', max_length=280)

    def validate_department_key(self, value):
        normalized = str(value or '').strip().lower().replace(' ', '-').replace('_', '-')
        if not normalized:
            raise serializers.ValidationError('Can cung cap department key.')
        if not all(ch.isalnum() or ch == '-' for ch in normalized):
            raise serializers.ValidationError('Department key chi duoc gom chu, so va dau gach ngang.')
        return normalized[:50]

    def validate_department_label(self, value):
        normalized = str(value or '').strip()
        if not normalized:
            raise serializers.ValidationError('Can cung cap department label.')
        return normalized[:120]

    def _validate_user_id(self, value, field_name, field_label):
        if value in (None, ''):
            return None
        queryset = User.objects.filter(id=value, is_active=True)
        if not queryset.exists():
            raise serializers.ValidationError(f'{field_label} khong hop le hoac da ngung hoat dong.')
        return int(value)

    def validate_stage_one_primary_user_id(self, value):
        return self._validate_user_id(value, 'stage_one_primary_user_id', 'Stage 1 owner')

    def validate_stage_one_delegate_user_id(self, value):
        return self._validate_user_id(value, 'stage_one_delegate_user_id', 'Stage 1 delegate')

    def validate_stage_two_primary_user_id(self, value):
        return self._validate_user_id(value, 'stage_two_primary_user_id', 'Stage 2 owner')

    def validate_stage_two_delegate_user_id(self, value):
        return self._validate_user_id(value, 'stage_two_delegate_user_id', 'Stage 2 delegate')

    def _validate_user_id_list(self, value, field_label):
        cleaned = []
        for item in value or []:
            validated = self._validate_user_id(item, '', field_label)
            if validated and validated not in cleaned:
                cleaned.append(validated)
        return cleaned[:6]

    def validate_stage_one_rotation_user_ids(self, value):
        return self._validate_user_id_list(value, 'Stage 1 rotation owner')

    def validate_stage_two_rotation_user_ids(self, value):
        return self._validate_user_id_list(value, 'Stage 2 rotation owner')

    def validate_fallback_team_tokens(self, value):
        cleaned = []
        for item in value:
            normalized = str(item or '').strip().upper()
            if normalized and normalized not in cleaned:
                cleaned.append(normalized[:40])
        return cleaned[:8]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if attrs.get('stage_one_mode') == 'directory_only' and not (
            attrs.get('stage_one_primary_user_id') or attrs.get('stage_one_delegate_user_id') or attrs.get('stage_one_rotation_user_ids')
        ):
            raise serializers.ValidationError({'stage_one_primary_user_id': 'Directory-only stage 1 can owner hoac delegate.'})
        if attrs.get('stage_two_mode') == 'directory_only' and not (
            attrs.get('stage_two_primary_user_id') or attrs.get('stage_two_delegate_user_id') or attrs.get('stage_two_rotation_user_ids')
        ):
            raise serializers.ValidationError({'stage_two_primary_user_id': 'Directory-only stage 2 can owner hoac delegate.'})
        return attrs


class AccessExceptionApproverAvailabilitySerializer(serializers.Serializer):
    user_id = serializers.IntegerField(min_value=1)
    is_out_of_office = serializers.BooleanField(default=True)
    starts_at = serializers.DateTimeField(required=False, allow_null=True)
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
    backup_user_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    label = serializers.CharField(required=False, allow_blank=True, default='', max_length=120)
    notes = serializers.CharField(required=False, allow_blank=True, default='', max_length=280)

    def validate_user_id(self, value):
        queryset = User.objects.filter(id=value, is_active=True)
        if not queryset.exists():
            raise serializers.ValidationError('Approver khong hop le hoac da ngung hoat dong.')
        return int(value)

    def validate_backup_user_id(self, value):
        if value in (None, ''):
            return None
        queryset = User.objects.filter(id=value, is_active=True)
        if not queryset.exists():
            raise serializers.ValidationError('Backup approver khong hop le hoac da ngung hoat dong.')
        return int(value)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if attrs.get('backup_user_id') and int(attrs['backup_user_id']) == int(attrs['user_id']):
            raise serializers.ValidationError({'backup_user_id': 'Backup approver khong duoc trung voi approver goc.'})
        starts_at = attrs.get('starts_at')
        ends_at = attrs.get('ends_at')
        if starts_at and ends_at and ends_at <= starts_at:
            raise serializers.ValidationError({'ends_at': 'Khoang ket thuc phai sau thoi diem bat dau.'})
        return attrs


class AccessExceptionPreviewSerializer(serializers.Serializer):
    policy_key = serializers.CharField(max_length=50)
    user_id = serializers.IntegerField(min_value=1)
    approver_user_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    stage_two_approver_user_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    duration_days = serializers.IntegerField(min_value=1, max_value=180, required=False)
    justification = serializers.CharField(required=False, allow_blank=True, default='')
    ticket_ref = serializers.CharField(required=False, allow_blank=True, default='', max_length=80)

    def validate_policy_key(self, value):
        return str(value or '').strip().lower()

    def validate_user_id(self, value):
        if not User.objects.filter(id=value).exists():
            raise serializers.ValidationError('Nguoi dung khong ton tai.')
        return int(value)

    def validate_approver_user_id(self, value):
        if value in (None, ''):
            return None
        queryset = User.objects.filter(id=value, is_active=True)
        if not queryset.exists():
            raise serializers.ValidationError('Approver khong hop le hoac da ngung hoat dong.')
        return int(value)

    def validate_stage_two_approver_user_id(self, value):
        if value in (None, ''):
            return None
        queryset = User.objects.filter(id=value, is_active=True)
        if not queryset.exists():
            raise serializers.ValidationError('Stage 2 approver khong hop le hoac da ngung hoat dong.')
        return int(value)

    def validate_ticket_ref(self, value):
        return str(value or '').strip()[:80]


class CreateAccessExceptionRequestSerializer(AccessExceptionPreviewSerializer):
    justification = serializers.CharField(allow_blank=False, trim_whitespace=True, max_length=1000)


class CreateAccessExceptionRenewalSerializer(serializers.Serializer):
    request_key = serializers.CharField(max_length=80)
    approver_user_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    stage_two_approver_user_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    duration_days = serializers.IntegerField(min_value=1, max_value=180, required=False)
    justification = serializers.CharField(allow_blank=False, trim_whitespace=True, max_length=1000)
    ticket_ref = serializers.CharField(required=False, allow_blank=True, default='', max_length=80)

    def validate_request_key(self, value):
        return str(value or '').strip().lower()

    def validate_approver_user_id(self, value):
        if value in (None, ''):
            return None
        queryset = User.objects.filter(id=value, is_active=True)
        if not queryset.exists():
            raise serializers.ValidationError('Approver khong hop le hoac da ngung hoat dong.')
        return int(value)

    def validate_stage_two_approver_user_id(self, value):
        if value in (None, ''):
            return None
        queryset = User.objects.filter(id=value, is_active=True)
        if not queryset.exists():
            raise serializers.ValidationError('Stage 2 approver khong hop le hoac da ngung hoat dong.')
        return int(value)

    def validate_ticket_ref(self, value):
        return str(value or '').strip()[:80]


class DecisionAccessExceptionRequestSerializer(serializers.Serializer):
    request_key = serializers.CharField(max_length=80)
    decision = serializers.ChoiceField(choices=['approve', 'reject'])
    note = serializers.CharField(required=False, allow_blank=True, default='', max_length=1000)

    def validate_request_key(self, value):
        return str(value or '').strip().lower()


class RevokeAccessExceptionRequestSerializer(serializers.Serializer):
    request_key = serializers.CharField(max_length=80)
    note = serializers.CharField(required=False, allow_blank=True, default='', max_length=1000)

    def validate_request_key(self, value):
        return str(value or '').strip().lower()


class RerouteAccessExceptionRequestSerializer(serializers.Serializer):
    request_key = serializers.CharField(max_length=80)
    approver_user_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, default='', max_length=1000)

    def validate_request_key(self, value):
        return str(value or '').strip().lower()

    def validate_approver_user_id(self, value):
        if value in (None, ''):
            return None
        queryset = User.objects.filter(id=value, is_active=True)
        if not queryset.exists():
            raise serializers.ValidationError('Approver reroute khong hop le hoac da ngung hoat dong.')
        return int(value)


class AccessExceptionAutomationPolicySerializer(serializers.Serializer):
    enabled = serializers.BooleanField(default=True)
    auto_revoke_expired = serializers.BooleanField(default=True)
    reminder_offsets_days = serializers.ListField(
        child=serializers.IntegerField(min_value=1, max_value=45),
        required=False,
        allow_empty=True,
        default=list,
    )
    renewal_window_days = serializers.IntegerField(min_value=1, max_value=30, default=5)
    notify_target_user = serializers.BooleanField(default=True)
    notify_requested_by = serializers.BooleanField(default=True)
    notify_approver = serializers.BooleanField(default=False)
    approval_warning_window_hours = serializers.IntegerField(min_value=1, max_value=72, default=6)
    approval_escalation_delay_hours = serializers.IntegerField(min_value=1, max_value=72, default=2)
    notify_requester_for_sla = serializers.BooleanField(default=True)
    notify_active_approver_for_sla = serializers.BooleanField(default=True)
    notify_directory_owners_for_sla = serializers.BooleanField(default=True)
    continuity_drill_enabled = serializers.BooleanField(default=True)
    continuity_drill_interval_days = serializers.IntegerField(min_value=1, max_value=30, default=7)
    continuity_drill_warning_days = serializers.IntegerField(min_value=1, max_value=14, default=2)
    notify_directory_owners_for_continuity = serializers.BooleanField(default=True)
    auto_prepare_playbooks = serializers.BooleanField(default=True)

    def validate_reminder_offsets_days(self, value):
        offsets = sorted({int(item) for item in value if int(item) > 0}, reverse=True)
        if not offsets:
            return [7, 3, 1]
        return offsets[:6]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        warning_days = int(attrs.get('continuity_drill_warning_days') or 2)
        interval_days = int(attrs.get('continuity_drill_interval_days') or 7)
        if warning_days > interval_days:
            raise serializers.ValidationError({
                'continuity_drill_warning_days': 'Drill warning days khong duoc lon hon chu ky drill.',
            })
        return attrs


class AccessExceptionAutomationRunSerializer(serializers.Serializer):
    dry_run = serializers.BooleanField(default=False)
    scope = serializers.ChoiceField(
        choices=['all', 'reminders', 'expiry', 'approvals', 'continuity'],
        default='all',
    )


class AccessExceptionAbsenceSimulationSerializer(serializers.Serializer):
    approver_user_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
        default=list,
    )
    department_key = serializers.CharField(required=False, allow_blank=True, default='', max_length=50)
    duration_hours = serializers.IntegerField(min_value=1, max_value=336, default=24)

    def validate_approver_user_ids(self, value):
        cleaned = []
        for item in value or []:
            user_id = int(item)
            if user_id in cleaned:
                continue
            if not User.objects.filter(id=user_id, is_active=True).exists():
                raise serializers.ValidationError('Co approver khong hop le hoac da ngung hoat dong.')
            cleaned.append(user_id)
        return cleaned[:8]

    def validate_department_key(self, value):
        return str(value or '').strip().lower().replace(' ', '-').replace('_', '-')[:50]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if not attrs.get('approver_user_ids') and not attrs.get('department_key'):
            raise serializers.ValidationError('Can chon approver hoac department de mo phong vang mat.')
        return attrs


class AccessExceptionGuidedRemediationSerializer(serializers.Serializer):
    action_type = serializers.ChoiceField(
        choices=[
            'policy_enable_approval',
            'policy_upgrade_stage_two',
            'request_revoke',
            'request_reroute',
        ],
    )
    policy_key = serializers.CharField(required=False, allow_blank=True, default='', max_length=50)
    request_key = serializers.CharField(required=False, allow_blank=True, default='', max_length=50)
    note = serializers.CharField(required=False, allow_blank=True, default='', max_length=500)

    def validate_policy_key(self, value):
        return str(value or '').strip().lower()[:50]

    def validate_request_key(self, value):
        return str(value or '').strip()[:50]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        action_type = str(attrs.get('action_type') or '')
        if action_type.startswith('policy_') and not str(attrs.get('policy_key') or '').strip():
            raise serializers.ValidationError({'policy_key': 'Can cung cap policy key cho remediation nay.'})
        if action_type.startswith('request_') and not str(attrs.get('request_key') or '').strip():
            raise serializers.ValidationError({'request_key': 'Can cung cap request key cho remediation nay.'})
        return attrs


class UserSerializer(serializers.ModelSerializer):
    roles = RoleSerializer(many=True, read_only=True)
    teams = TeamSerializer(many=True, read_only=True)
    full_name = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name',
                  'full_name', 'phone', 'avatar_url', 'is_staff', 'is_active', 'is_locked',
                  'roles', 'teams', 'date_joined']
        read_only_fields = ['is_locked', 'date_joined']

    def get_full_name(self, obj):
        return obj.get_full_name() or obj.username

    def get_avatar_url(self, obj):
        request = self.context.get('request')
        if obj.avatar and request:
            return request.build_absolute_uri(obj.avatar.url)
        if obj.avatar:
            return obj.avatar.url
        return None


class UserMentionSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'full_name', 'phone']

    def get_full_name(self, obj):
        return obj.get_full_name() or obj.username


class UserDirectorySerializer(UserSerializer):
    active_session_count = serializers.IntegerField(read_only=True, required=False)
    last_seen_at = serializers.DateTimeField(read_only=True, required=False)
    last_login_at = serializers.DateTimeField(read_only=True, required=False)
    last_seen_ip = serializers.CharField(read_only=True, required=False, allow_null=True)
    role_count = serializers.SerializerMethodField()
    team_count = serializers.SerializerMethodField()

    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + [
            'active_session_count',
            'last_seen_at',
            'last_login_at',
            'last_seen_ip',
            'role_count',
            'team_count',
        ]
        read_only_fields = UserSerializer.Meta.read_only_fields + [
            'active_session_count',
            'last_seen_at',
            'last_login_at',
            'last_seen_ip',
            'role_count',
            'team_count',
        ]

    def get_role_count(self, obj):
        cache_data = getattr(obj, '_prefetched_objects_cache', {})
        prefetched_roles = cache_data.get('roles')
        if prefetched_roles is not None:
            return len(prefetched_roles)
        return obj.roles.count()

    def get_team_count(self, obj):
        cache_data = getattr(obj, '_prefetched_objects_cache', {})
        prefetched_teams = cache_data.get('teams')
        if prefetched_teams is not None:
            return len(prefetched_teams)
        return obj.teams.count()


class AdminUserAccessUpdateSerializer(serializers.Serializer):
    role_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
    )
    team_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
    )

    def validate_role_ids(self, value):
        unique_ids = sorted({int(item) for item in value})
        if not unique_ids:
            return []
        existing_ids = set(
            Role.objects.filter(id__in=unique_ids, deleted_at__isnull=True).values_list('id', flat=True)
        )
        if existing_ids != set(unique_ids):
            raise serializers.ValidationError('Danh sach vai tro khong hop le.')
        return unique_ids

    def validate_team_ids(self, value):
        unique_ids = sorted({int(item) for item in value})
        if not unique_ids:
            return []
        existing_ids = set(
            Team.objects.filter(id__in=unique_ids, deleted_at__isnull=True).values_list('id', flat=True)
        )
        if existing_ids != set(unique_ids):
            raise serializers.ValidationError('Danh sach nhom khong hop le.')
        return unique_ids

    def validate(self, attrs):
        if 'role_ids' not in self.initial_data and 'team_ids' not in self.initial_data:
            raise serializers.ValidationError('Can cung cap role_ids hoac team_ids.')
        return attrs


class BulkUserAccessUpdateSerializer(AdminUserAccessUpdateSerializer):
    ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
    )
    strategy = serializers.ChoiceField(choices=['add', 'replace', 'remove'], default='add')

    def validate_ids(self, value):
        return sorted({int(item) for item in value})

    def validate(self, attrs):
        attrs = super().validate(attrs)
        strategy = attrs.get('strategy') or 'add'
        role_ids_provided = 'role_ids' in self.initial_data
        team_ids_provided = 'team_ids' in self.initial_data
        role_ids = attrs.get('role_ids', [])
        team_ids = attrs.get('team_ids', [])

        if strategy != 'replace' and not role_ids and not team_ids:
            raise serializers.ValidationError('Can chon it nhat mot vai tro hoac nhom de ap dung.')
        if strategy == 'replace' and not role_ids_provided and not team_ids_provided:
            raise serializers.ValidationError('Can xac dinh role_ids hoac team_ids cho che do replace.')
        return attrs


class CurrentUserUpdateSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(required=False, allow_blank=True)
    first_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    last_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    phone = serializers.CharField(required=False, allow_blank=True, max_length=20)

    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'email', 'phone']

    def validate_email(self, value):
        return value.strip().lower()

    def validate_phone(self, value):
        return value.strip()


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)
    confirm_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        new_password = attrs.get('new_password') or ''
        confirm_password = attrs.get('confirm_password') or ''
        if new_password != confirm_password:
            raise serializers.ValidationError({'confirm_password': 'Xác nhận mật khẩu không khớp.'})

        user = self.context.get('user')
        if user is None:
            raise serializers.ValidationError('Không tìm thấy người dùng.')

        validate_password(new_password, user=user)
        return attrs


class SettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Setting
        fields = '__all__'


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    default_error_messages = {
        **TokenObtainPairSerializer.default_error_messages,
        'account_locked': 'Tai khoan da bi khoa.',
    }

    def validate(self, attrs):
        data = super().validate(attrs)
        if getattr(self.user, 'is_locked', False):
            raise AuthenticationFailed(self.error_messages['account_locked'], code='account_locked')
        return data

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)

        # Add custom claims
        token['username'] = user.username
        token['email'] = user.email
        token['is_staff'] = user.is_staff
        if 'sid' not in token:
            token['sid'] = uuid.uuid4().hex

        return token


class CustomerSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    updated_by_username = serializers.CharField(source='updated_by.username', read_only=True)
    owner_name = serializers.CharField(source='owner.username', read_only=True, allow_null=True)
    team_name = serializers.CharField(source='team.name', read_only=True, allow_null=True)
    code = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = Customer
        fields = '__all__'
        read_only_fields = ['created_by', 'updated_by', 'created_at', 'updated_at']

    def validate_code(self, value):
        normalized = str(value or '').strip()
        if not normalized:
            return ''
        queryset = Customer.objects.filter(code__iexact=normalized)
        instance = getattr(self, 'instance', None)
        if instance is not None:
            queryset = queryset.exclude(id=instance.id)
        if queryset.exists():
            raise serializers.ValidationError('Mã khách hàng đã tồn tại.')
        return normalized

    def validate_tax_code(self, value):
        normalized = str(value or '').strip()
        if not normalized:
            return ''
        queryset = Customer.objects.filter(tax_code__iexact=normalized)
        instance = getattr(self, 'instance', None)
        if instance is not None:
            queryset = queryset.exclude(id=instance.id)
        if queryset.exists():
            raise serializers.ValidationError('Mã số thuế đã tồn tại.')
        return normalized

    def validate_phone(self, value):
        return str(value or '').strip()

    def validate_contact_phone(self, value):
        return str(value or '').strip()

    def validate_payment_terms(self, value):
        if value is None:
            return value
        if int(value) < 0:
            raise serializers.ValidationError('Số ngày thanh toán không được âm.')
        return value

    def validate_credit_limit(self, value):
        if value is None:
            return value
        try:
            normalized = Decimal(value)
        except (InvalidOperation, TypeError, ValueError):
            raise serializers.ValidationError('Hạn mức công nợ không hợp lệ.')
        if normalized < 0:
            raise serializers.ValidationError('Hạn mức công nợ không được âm.')
        return normalized

    def validate(self, attrs):
        attrs = super().validate(attrs)
        assignment_fields = {'owner', 'team'} & set(attrs.keys())
        if not assignment_fields:
            return attrs
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user_has_customer_permission(user, 'ASSIGN', strict=True):
            raise serializers.ValidationError({
                field: 'Bạn không có quyền phân công owner/team cho khách hàng.'
                for field in assignment_fields
            })
        return attrs

    def create(self, validated_data):
        # Auto-generate customer code if not provided
        if not validated_data.get('code'):
            from django.utils import timezone
            import random
            
            # Generate code: KH-YYYYMMDD-XXXXX (KH = Khách Hàng)
            now = timezone.now()
            date_str = now.strftime('%Y%m%d')
            random_suffix = str(random.randint(10000, 99999))
            code = f'KH-{date_str}-{random_suffix}'
            
            # Ensure unique
            max_attempts = 10
            base_code = code
            attempt = 0
            while Customer.objects.filter(code=code).exists() and attempt < max_attempts:
                random_suffix = str(random.randint(10000, 99999))
                code = f'{base_code[:-5]}{random_suffix}'
                attempt += 1
            
            validated_data['code'] = code
        
        # Ensure created_by is set (can come from context or kwargs)
        if 'created_by' not in validated_data and self.context.get('request'):
            validated_data['created_by'] = self.context['request'].user
        
        return super().create(validated_data)


class ExportTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExportTemplate
        fields = ['id', 'name', 'entity_type', 'is_default', 'columns', 'headers']


class SavedViewSerializer(serializers.ModelSerializer):
    user_username = serializers.CharField(source='user.username', read_only=True, allow_null=True)
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    
    class Meta:
        model = SavedView
        fields = '__all__'
        read_only_fields = ['created_by', 'created_at', 'updated_at']


class AttachmentSerializer(serializers.ModelSerializer):
    uploaded_by_username = serializers.CharField(source='uploaded_by.username', read_only=True)
    file_size_display = serializers.CharField(source='get_file_size_display', read_only=True)
    file_url = serializers.SerializerMethodField()
    
    class Meta:
        model = Attachment
        fields = '__all__'
        read_only_fields = ['uploaded_by', 'uploaded_at', 'file_size', 'file_type']
    
    def get_file_url(self, obj):
        request = self.context.get('request')
        if obj.file and request:
            return request.build_absolute_uri(obj.file.url)
        return None
    
    def create(self, validated_data):
        # Auto-fill file metadata
        file = validated_data.get('file')
        if file:
            validated_data['filename'] = file.name
            validated_data['file_size'] = file.size
            validated_data['file_type'] = getattr(file, 'content_type', '')
        return super().create(validated_data)


class CommentSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    created_by_name = serializers.SerializerMethodField()
    replies_count = serializers.SerializerMethodField()
    
    class Meta:
        model = Comment
        fields = '__all__'
        read_only_fields = ['created_by', 'created_at', 'updated_at', 'mentions', 'deleted_at']
    
    def get_created_by_name(self, obj):
        if obj.created_by:
            full_name = f"{obj.created_by.first_name} {obj.created_by.last_name}".strip()
            return full_name or obj.created_by.username
        return None
    
    def get_replies_count(self, obj):
        return obj.replies.filter(is_deleted=False).count()


class NotificationSerializer(serializers.ModelSerializer):
    actor_username = serializers.CharField(source='actor.username', read_only=True, allow_null=True)
    type_display = serializers.CharField(source='get_notification_type_display', read_only=True)
    
    class Meta:
        model = Notification
        fields = '__all__'
        read_only_fields = ['recipient', 'actor', 'created_at', 'read_at']


class UserSessionSerializer(serializers.ModelSerializer):
    device_summary = serializers.SerializerMethodField()
    is_current = serializers.SerializerMethodField()
    browser = serializers.SerializerMethodField()
    operating_system = serializers.SerializerMethodField()
    ip_address = serializers.CharField(read_only=True)

    class Meta:
        model = UserSession
        fields = [
            'id',
            'user',
            'session_key',
            'device_info',
            'device_summary',
            'browser',
            'operating_system',
            'ip_address',
            'login_at',
            'last_active',
            'logout_at',
            'is_active',
            'is_current',
        ]
        read_only_fields = ['user', 'login_at', 'last_active', 'logout_at']

    def get_device_summary(self, obj):
        browser = obj.device_info.get('browser', 'Không rõ')
        os = obj.device_info.get('os', 'Không rõ')
        return f"{browser} trên {os}"

    def get_is_current(self, obj):
        request = self.context.get('request')
        if not request:
            return False

        auth = getattr(request, 'auth', None)
        session_id = None
        if auth is not None:
            try:
                session_id = auth.get('sid')
            except AttributeError:
                session_id = None

        if session_id:
            return str(obj.session_key) == str(session_id)

        current_session_key = getattr(request.session, 'session_key', None)
        return bool(current_session_key and obj.session_key == current_session_key)

    def get_browser(self, obj):
        return obj.device_info.get('browser', 'Không rõ')

    def get_operating_system(self, obj):
        return obj.device_info.get('os', 'Không rõ')


class UserPreferencesSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserPreferences
        fields = ['id', 'page', 'config', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_config(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Config must be JSON object")
        return value


class ColumnPermissionSerializer(serializers.ModelSerializer):
    allowed_users_list = serializers.SerializerMethodField()

    class Meta:
        model = ColumnPermission
        fields = [
            'id', 'page', 'column', 'column_label',
            'allowed_roles', 'allowed_users_list',
            'is_restricted', 'is_active',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['created_at', 'updated_at']

    def get_allowed_users_list(self, obj):
        return list(obj.allowed_users.values('id', 'username', 'email'))


class TaskSerializer(serializers.ModelSerializer):
    assigned_to_info = serializers.SerializerMethodField(read_only=True)
    assigned_by_info = serializers.SerializerMethodField(read_only=True)
    depends_on_info = serializers.SerializerMethodField(read_only=True)
    last_updated_by_info = serializers.SerializerMethodField(read_only=True)
    comment_count = serializers.SerializerMethodField(read_only=True)
    attachment_count = serializers.SerializerMethodField(read_only=True)
    activity_updated_at = serializers.SerializerMethodField(read_only=True)
    watchers_count = serializers.SerializerMethodField(read_only=True)
    is_watching = serializers.SerializerMethodField(read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)
    is_open = serializers.BooleanField(read_only=True)

    class Meta:
        model = Task
        fields = [
            'id',
            'entity_type', 'entity_id', 'entity_code',
            'title', 'description',
            'assigned_to', 'assigned_to_info',
            'assigned_by', 'assigned_by_info',
            'depends_on', 'depends_on_info',
            'status', 'status_display',
            'priority', 'priority_display',
            'is_pinned', 'tags',
            'is_blocking', 'blocks_action',
            'due_date', 'completed_at',
            # Cần hỗ trợ
            'needs_help', 'help_reason', 'help_requested_at',
            # Ghi chú tiến độ
            'last_update_note', 'last_update_at', 'last_updated_by', 'last_updated_by_info',
            # Realtime meta cho UI (badge bình luận/file)
            'comment_count', 'attachment_count', 'activity_updated_at',
            'watchers_count', 'is_watching',
            'created_at', 'updated_at',
            'is_open',
        ]
        read_only_fields = [
            'id', 'assigned_by', 'completed_at',
            'help_requested_at', 'last_update_at', 'last_updated_by',
            'created_at', 'updated_at',
        ]

    def get_assigned_to_info(self, obj):
        if obj.assigned_to:
            return {
                'id': obj.assigned_to.id,
                'username': obj.assigned_to.username,
                'full_name': obj.assigned_to.get_full_name() or obj.assigned_to.username,
            }
        return None

    def get_assigned_by_info(self, obj):
        if obj.assigned_by:
            return {
                'id': obj.assigned_by.id,
                'username': obj.assigned_by.username,
                'full_name': obj.assigned_by.get_full_name() or obj.assigned_by.username,
            }
        return None

    def get_last_updated_by_info(self, obj):
        if obj.last_updated_by:
            return {
                'id': obj.last_updated_by.id,
                'username': obj.last_updated_by.username,
                'full_name': obj.last_updated_by.get_full_name() or obj.last_updated_by.username,
            }
        return None

    def get_depends_on_info(self, obj):
        if obj.depends_on:
            return {
                'id': obj.depends_on.id,
                'title': obj.depends_on.title,
                'status': obj.depends_on.status,
                'status_display': obj.depends_on.get_status_display(),
            }
        return None

    def get_comment_count(self, obj):
        # Ưu tiên annotated value để tránh N+1 query.
        if hasattr(obj, 'comment_count_db'):
            return obj.comment_count_db or 0
        return Comment.objects.filter(entity_type='Task', entity_id=obj.id, is_deleted=False).count()

    def get_attachment_count(self, obj):
        # Ưu tiên annotated value để tránh N+1 query.
        if hasattr(obj, 'attachment_count_db'):
            return obj.attachment_count_db or 0
        return Attachment.objects.filter(entity_type='Task', entity_id=obj.id).count()

    def get_activity_updated_at(self, obj):
        latest_comment = getattr(obj, 'latest_comment_at_db', None)
        latest_attachment = getattr(obj, 'latest_attachment_at_db', None)
        latest = max([d for d in [latest_comment, latest_attachment] if d is not None], default=None)
        return latest

    def get_watchers_count(self, obj):
        if hasattr(obj, 'watchers_count_db'):
            return obj.watchers_count_db or 0
        return TaskWatcher.objects.filter(task_id=obj.id).count()

    def get_is_watching(self, obj):
        if hasattr(obj, 'is_watching_db'):
            return bool(obj.is_watching_db)
        request = self.context.get('request')
        if not request or not request.user or not request.user.is_authenticated:
            return False
        return TaskWatcher.objects.filter(task_id=obj.id, user=request.user).exists()

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['assigned_by'] = request.user
        return super().create(validated_data)

    def validate(self, attrs):
        depends_on = attrs.get('depends_on')
        entity_type = attrs.get('entity_type', getattr(self.instance, 'entity_type', None))
        entity_id = attrs.get('entity_id', getattr(self.instance, 'entity_id', None))
        tags = attrs.get('tags')

        if depends_on:
            if self.instance and depends_on.id == self.instance.id:
                raise serializers.ValidationError({'depends_on': 'Không thể phụ thuộc chính nó.'})
            if depends_on.entity_type != entity_type or depends_on.entity_id != entity_id:
                raise serializers.ValidationError({'depends_on': 'Chỉ được phụ thuộc nhiệm vụ cùng đối tượng.'})
            # Chặn vòng phụ thuộc đơn giản: A -> B thì B không được -> A
            if self.instance and depends_on.depends_on_id == self.instance.id:
                raise serializers.ValidationError({'depends_on': 'Không thể tạo vòng phụ thuộc giữa 2 nhiệm vụ.'})
        if tags is not None:
            if not isinstance(tags, list):
                raise serializers.ValidationError({'tags': 'Tags phải là mảng chuỗi.'})
            normalized = []
            for tag in tags:
                val = str(tag or '').strip()
                if not val:
                    continue
                if len(val) > 30:
                    raise serializers.ValidationError({'tags': 'Mỗi tag tối đa 30 ký tự.'})
                normalized.append(val.lower())
            attrs['tags'] = list(dict.fromkeys(normalized))[:10]
        return attrs


class WorkflowTaskTemplateSerializer(serializers.ModelSerializer):
    trigger_display = serializers.CharField(source='get_trigger_display', read_only=True)
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)
    created_by_info = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = WorkflowTaskTemplate
        fields = [
            'id',
            'entity_type', 'trigger', 'trigger_display',
            'title_template', 'description_template',
            'assign_rule',
            'due_in_days',
            'priority', 'priority_display',
            'is_blocking', 'blocks_action',
            'tags',
            'depends_on_previous',
            'sort_order',
            'is_active',
            'created_by', 'created_by_info',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']

    def get_created_by_info(self, obj):
        if obj.created_by:
            return {
                'id': obj.created_by.id,
                'username': obj.created_by.username,
                'full_name': obj.created_by.get_full_name() or obj.created_by.username,
            }
        return None

    def validate_tags(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('Tags phải là mảng chuỗi.')
        normalized = []
        for tag in value:
            val = str(tag or '').strip().lower()
            if val and len(val) <= 30:
                normalized.append(val)
        return list(dict.fromkeys(normalized))[:10]

    def validate_assign_rule(self, value):
        if value in (None, ''):
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError('assign_rule phải là object JSON.')

        rule_type = str(value.get('type', '')).strip().lower()
        if not rule_type:
            return {}

        if rule_type == 'user':
            user_id = value.get('id')
            try:
                normalized_id = int(user_id)
            except (TypeError, ValueError):
                raise serializers.ValidationError('assign_rule.user cần id là số nguyên.')
            return {'type': 'user', 'id': normalized_id}

        if rule_type == 'role':
            role_code = str(value.get('value', '')).strip()
            if not role_code:
                raise serializers.ValidationError('assign_rule.role cần value là mã role.')
            return {'type': 'role', 'value': role_code}

        raise serializers.ValidationError("assign_rule.type chỉ hỗ trợ 'user' hoặc 'role'.")


# ── System Configuration serializers ─────────────────────────────────────────


class DocumentTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = DocumentType
        fields = ['id', 'code', 'name', 'entity_type', 'prefix', 'description', 'sort_order', 'is_active', 'created_at', 'updated_at']


class TaxRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaxRate
        fields = ['id', 'code', 'name', 'rate_pct', 'applies_to', 'description', 'sort_order', 'is_default', 'is_active', 'created_at', 'updated_at']


class ShiftSerializer(serializers.ModelSerializer):
    class Meta:
        model = Shift
        fields = ['id', 'code', 'name', 'short_label', 'start_time', 'end_time', 'capacity_hours', 'description', 'sort_order', 'is_active', 'created_at', 'updated_at']


class ExpenseCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseCategory
        fields = ['id', 'code', 'name', 'description', 'color', 'sort_order', 'is_active', 'created_at', 'updated_at']


class NumberSequenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NumberSequence
        fields = '__all__'
