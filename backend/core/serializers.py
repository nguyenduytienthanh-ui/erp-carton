from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .models import User, Role, Permission, Team, Setting, Customer, ExportTemplate, SavedView, Attachment, Comment, Notification, UserSession, UserPreferences, ColumnPermission


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
