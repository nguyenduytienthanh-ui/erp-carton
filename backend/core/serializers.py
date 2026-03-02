from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .models import User, Role, Permission, Team, Setting, Customer, ExportTemplate, SavedView, Attachment, Comment, Notification, UserSession, UserPreferences, ColumnPermission, Task, WorkflowTaskTemplate, TaskWatcher


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = '__all__'


class RoleSerializer(serializers.ModelSerializer):
    permissions = PermissionSerializer(many=True, read_only=True)

    class Meta:
        model = Role
        fields = [
            'id', 'code', 'name', 'description', 'is_active', 'sort_order',
            'created_at', 'updated_at', 'created_by', 'updated_by',
            'deleted_at', 'deleted_by', 'permissions',
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at',
            'created_by', 'updated_by', 'deleted_at', 'deleted_by',
        ]


class TeamSerializer(serializers.ModelSerializer):
    class Meta:
        model = Team
        fields = [
            'id', 'code', 'name', 'description', 'is_active', 'sort_order',
            'created_at', 'updated_at', 'created_by', 'updated_by',
            'deleted_at', 'deleted_by',
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at',
            'created_by', 'updated_by', 'deleted_at', 'deleted_by',
        ]


class UserSerializer(serializers.ModelSerializer):
    roles = RoleSerializer(many=True, read_only=True)
    teams = TeamSerializer(many=True, read_only=True)
    
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 
                  'phone', 'is_staff', 'is_active', 'is_locked', 
                  'roles', 'teams', 'date_joined']
        read_only_fields = ['is_locked', 'date_joined']


class SettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Setting
        fields = '__all__'


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        
        # Add custom claims
        token['username'] = user.username
        token['email'] = user.email
        token['is_staff'] = user.is_staff
        
        return token


class CustomerSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    updated_by_username = serializers.CharField(source='updated_by.username', read_only=True)
    owner_name = serializers.CharField(source='owner.username', read_only=True, allow_null=True)
    team_name = serializers.CharField(source='team.name', read_only=True, allow_null=True)

    class Meta:
        model = Customer
        fields = '__all__'
        read_only_fields = ['created_by', 'updated_by', 'created_at', 'updated_at']


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

    class Meta:
        model = UserSession
        fields = '__all__'
        read_only_fields = ['user', 'login_at', 'last_active', 'logout_at']

    def get_device_summary(self, obj):
        browser = obj.device_info.get('browser', 'Unknown')
        os = obj.device_info.get('os', 'Unknown')
        return f"{browser} on {os}"


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
