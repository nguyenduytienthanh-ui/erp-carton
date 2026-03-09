from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
import django_filters
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import RefreshToken
from django.http import HttpResponse
from django.db import models, transaction
from django.db.models import Count, DateTimeField, Exists, IntegerField, OuterRef, Subquery
from django.db.models.functions import Coalesce, Cast
from datetime import datetime
from datetime import timedelta
import uuid
from django.utils.dateparse import parse_datetime
from django.core.cache import cache
from .models import User, Role, Permission, Team, Setting, Customer, ExportTemplate, SavedView, Attachment, Comment, Notification, AuditLog, UserSession, UserPreferences, ColumnPermission, Task, WorkflowTaskTemplate, TaskWatcher, WorkflowPipelineEvent
from .serializers import (
    UserSerializer, RoleSerializer, PermissionSerializer,
    TeamSerializer, SettingSerializer, CustomTokenObtainPairSerializer,
    CustomerSerializer, ExportTemplateSerializer, SavedViewSerializer, AttachmentSerializer, CommentSerializer, NotificationSerializer, UserSessionSerializer, UserPreferencesSerializer, ColumnPermissionSerializer, TaskSerializer,
    WorkflowTaskTemplateSerializer,
)
from django.utils import timezone as django_timezone
from .filters import CustomerFilter, TeamFilter, RoleFilter
from .utils import export_to_excel
from .mixins import AuditLogMixin, ExportExcelMixin
from .permissions import check_action_permission


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer

    @action(detail=False, methods=['get'])
    def me(self, request):
        serializer = self.get_serializer(request.user)
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        """Bulk activate/deactivate users"""
        ids = request.data.get('ids', [])
        is_active = request.data.get('is_active', True)
        if not ids:
            return Response({"error": "No IDs provided"}, status=400)
        count = User.objects.filter(id__in=ids).update(is_active=is_active)
        return Response({"success": True, "count": count})

    @action(detail=False, methods=['post'])
    def bulk_lock(self, request):
        """Bulk lock/unlock users"""
        ids = request.data.get('ids', [])
        is_locked = request.data.get('is_locked', True)
        if not ids:
            return Response({"error": "No IDs provided"}, status=400)
        count = User.objects.filter(id__in=ids).update(is_locked=is_locked)
        return Response({"success": True, "count": count})


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

    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)

    @staticmethod
    def _can_manage_module_permissions(user):
        if not user or not user.is_authenticated:
            return False
        if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
            return True
        return check_action_permission(user, 'CORE', 'MANAGE_RBAC', strict=True)

    @staticmethod
    def _get_module_permission_map():
        perms = Permission.objects.filter(
            models.Q(resource='WORKFORCE', action='MANAGE')
            | models.Q(resource='FINANCE', action='MANAGE')
            | models.Q(resource='CORE', action='MANAGE_RBAC')
        )
        return {f'{perm.resource}:{perm.action}': perm for perm in perms}

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
        workforce_perm = perm_map.get('WORKFORCE:MANAGE')
        finance_perm = perm_map.get('FINANCE:MANAGE')
        rbac_perm = perm_map.get('CORE:MANAGE_RBAC')

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
                'workforce_manage': bool(workforce_perm and workforce_perm.id in assigned_ids),
                'finance_manage': bool(finance_perm and finance_perm.id in assigned_ids),
                'rbac_manage': bool(rbac_perm and rbac_perm.id in assigned_ids),
            })
        return Response({'items': items})

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
        workforce_perm = perm_map.get('WORKFORCE:MANAGE')
        finance_perm = perm_map.get('FINANCE:MANAGE')
        rbac_perm = perm_map.get('CORE:MANAGE_RBAC')
        if not workforce_perm or not finance_perm or not rbac_perm:
            return Response({'error': 'Thiếu permission hệ thống, vui lòng chạy migration mới nhất.'}, status=400)

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
                old_workforce = workforce_perm.id in assigned_ids
                old_finance = finance_perm.id in assigned_ids
                old_rbac = rbac_perm.id in assigned_ids

                workforce_manage = bool(item.get('workforce_manage'))
                finance_manage = bool(item.get('finance_manage'))
                rbac_manage = bool(item.get('rbac_manage'))

                if workforce_manage:
                    role.permissions.add(workforce_perm)
                else:
                    role.permissions.remove(workforce_perm)

                if finance_manage:
                    role.permissions.add(finance_perm)
                else:
                    role.permissions.remove(finance_perm)

                if rbac_manage:
                    role.permissions.add(rbac_perm)
                else:
                    role.permissions.remove(rbac_perm)
                if (
                    old_workforce != workforce_manage
                    or old_finance != finance_manage
                    or old_rbac != rbac_manage
                ):
                    changed_rows.append({
                        'role_id': role.id,
                        'role_code': role.code,
                        'role_name': role.name,
                        'old': {
                            'workforce_manage': old_workforce,
                            'finance_manage': old_finance,
                            'rbac_manage': old_rbac,
                        },
                        'new': {
                            'workforce_manage': workforce_manage,
                            'finance_manage': finance_manage,
                            'rbac_manage': rbac_manage,
                        },
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
        if not self._can_manage_module_permissions(request.user):
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
    def module_permissions_history(self, request):
        if not self._can_manage_module_permissions(request.user):
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
        changed_type = (request.query_params.get('changed_type') or '').strip().lower()

        rows_all = list(queryset)
        if role_code or changed_type in {'workforce', 'finance', 'rbac'}:
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
                    if changed_type in {'workforce', 'finance', 'rbac'}:
                        old_item = old_by_role_id.get(role_id, {})
                        field_name = f'{changed_type}_manage'
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
                'Workforce (cu -> moi)',
                'Finance (cu -> moi)',
                'RBAC (cu -> moi)',
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
                    if changed_type in {'workforce', 'finance', 'rbac'}:
                        field_name = f'{changed_type}_manage'
                        if bool(old_item.get(field_name)) == bool(item.get(field_name)):
                            continue
                    ws.append([
                        row.created_at.isoformat() if row.created_at else '',
                        f'{row.user.first_name} {row.user.last_name}'.strip() if row.user else '',
                        row.user.username if row.user else '',
                        role_code_value,
                        str(item.get('role_name') or ''),
                        f'{"Bật" if bool(old_item.get("workforce_manage")) else "Tắt"} -> {"Bật" if bool(item.get("workforce_manage")) else "Tắt"}',
                        f'{"Bật" if bool(old_item.get("finance_manage")) else "Tắt"} -> {"Bật" if bool(item.get("finance_manage")) else "Tắt"}',
                        f'{"Bật" if bool(old_item.get("rbac_manage")) else "Tắt"} -> {"Bật" if bool(item.get("rbac_manage")) else "Tắt"}',
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
        summary_by_changed_type = {'workforce': 0, 'finance': 0, 'rbac': 0}
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
                if bool(old_item.get('workforce_manage')) != bool(item.get('workforce_manage')):
                    summary_by_changed_type['workforce'] += 1
                    changed_any = True
                if bool(old_item.get('finance_manage')) != bool(item.get('finance_manage')):
                    summary_by_changed_type['finance'] += 1
                    changed_any = True
                if bool(old_item.get('rbac_manage')) != bool(item.get('rbac_manage')):
                    summary_by_changed_type['rbac'] += 1
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
    
    @action(detail=False, methods=['get'])
    def by_entity(self, request):
        """Get activity stream for an entity"""
        entity_type = request.query_params.get('entity_type')
        entity_id = request.query_params.get('entity_id')
        
        if not entity_type or not entity_id:
            return Response({"error": "entity_type and entity_id required"}, status=400)
        
        activities = []
        
        # Get audit logs
        from .models import AuditLog, Comment
        
        audit_logs = AuditLog.objects.filter(
            entity_type=entity_type,
            entity_id=entity_id
        ).order_by('-created_at')[:20]
        
        for log in audit_logs:
            activities.append({
                'type': 'audit',
                'action': log.action,
                'user': log.user.username if log.user else None,
                'timestamp': log.created_at,
                'details': {
                    'old_values': log.old_values,
                    'new_values': log.new_values,
                    'changed_fields': log.changed_fields,
                }
            })
        
        # Get comments
        comments = Comment.objects.filter(
            entity_type=entity_type,
            entity_id=entity_id,
            is_deleted=False
        ).order_by('-created_at')[:20]
        
        for comment in comments:
            activities.append({
                'type': 'comment',
                'action': 'COMMENT',
                'user': comment.created_by.username if comment.created_by else None,
                'timestamp': comment.created_at,
                'details': {
                    'content': comment.content,
                    'mentions': comment.mentions,
                }
            })
        
        # Get product price workflow events (avoid duplicate with direct UPDATE audit logs)
        if str(entity_type).lower() == 'product':
            try:
                from products.models import PriceChange
                price_events = PriceChange.objects.filter(
                    product_id=entity_id
                ).exclude(status='APPLIED').order_by('-created_at')[:20]
                for event in price_events:
                    action = {
                        'PENDING': 'SUBMIT',
                        'APPROVED': 'APPROVE',
                        'REJECTED': 'REJECT',
                    }.get(event.status, 'UPDATE')
                    activities.append({
                        'type': 'audit',
                        'action': action,
                        'user': event.submitted_by.username if event.submitted_by else None,
                        'timestamp': event.created_at,
                        'details': {
                            'old_values': {
                                'cost_price': str(event.old_cost_price) if event.old_cost_price is not None else None,
                                'sale_price': str(event.old_sale_price) if event.old_sale_price is not None else None,
                            },
                            'new_values': {
                                'cost_price': str(event.new_cost_price) if event.new_cost_price is not None else None,
                                'sale_price': str(event.new_sale_price) if event.new_sale_price is not None else None,
                                'price_change_reason': event.reason or '',
                                'price_effective_at': event.effective_at.isoformat() if event.effective_at else None,
                                'reject_reason': event.reject_reason or '',
                                'delta_cost_percent': str(event.delta_cost_percent) if event.delta_cost_percent is not None else None,
                                'delta_sale_percent': str(event.delta_sale_percent) if event.delta_sale_percent is not None else None,
                            },
                            'changed_fields': [
                                'cost_price', 'sale_price',
                                *(['price_change_reason'] if event.reason else []),
                                *(['price_effective_at'] if event.effective_at else []),
                                *(['reject_reason'] if event.reject_reason else []),
                            ],
                            'content': (
                                f"Lý do: {event.reason}"
                                + (f" | Hiệu lực: {event.effective_at.strftime('%d/%m/%Y %H:%M')}" if event.effective_at else '')
                            ).strip() if event.reason or event.effective_at else None,
                        }
                    })
            except Exception:
                # Activity stream should still work even if price event query fails.
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

        allow_all = include_all and (user.is_staff or user.is_superuser)
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
        return UserSession.objects.filter(user=self.request.user)

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
        current_session = request.session.session_key

        # Revoke all except current
        count = UserSession.objects.filter(
            user=request.user,
            is_active=True
        ).exclude(session_key=current_session).update(
            is_active=False,
            logout_at=timezone.now()
        )

        return Response({"success": True, "count": count})


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
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
        if refresh_token:
            token = RefreshToken(refresh_token)
            token.blacklist()

        # Revoke user sessions
        UserSession.objects.filter(user=request.user, is_active=True).update(
            is_active=False,
            logout_at=timezone.now()
        )

        return Response({"success": True, "message": "Logged out successfully"})
    except Exception as e:
        return Response({"error": str(e)}, status=400)


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
            "action": "START" | "COMPLETE" | "REMIND_OVERDUE",
            "task_ids": [1,2,3]
          }
        """
        action_name = str(request.data.get('action') or '').strip().upper()
        raw_ids = request.data.get('task_ids') or []
        if action_name not in ('START', 'COMPLETE', 'REMIND_OVERDUE'):
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
          - action: START | COMPLETE | REMIND_OVERDUE
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
    SCHEDULER_JOB_NAME = 'workflow-automation-global-scheduler'

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
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=['post'], url_path='generate_for_entity')
    def generate_for_entity(self, request):
        """
        Sinh task từ template cho một entity + trigger cụ thể.
        Body: { entity_type, entity_id, entity_code, trigger }
        Returns: { created: [...task titles], skipped: N }
        """
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

        schedule = Schedule.objects.filter(name=self.SCHEDULER_JOB_NAME).first()
        if not schedule:
            return Response({
                'enabled': False,
                'name': self.SCHEDULER_JOB_NAME,
                'interval_minutes': 5,
                'next_run': None,
                'schedule_id': None,
                'lock_active': cache.get('workflow_automation_scheduler_job_lock') is not None,
            })
        return Response({
            'enabled': bool(schedule.repeats != 0),
            'name': schedule.name,
            'interval_minutes': int(schedule.minutes or 5),
            'next_run': schedule.next_run,
            'schedule_id': schedule.id,
            'lock_active': cache.get('workflow_automation_scheduler_job_lock') is not None,
        })

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
        from .workflow_services import get_scheduler_policy

        try:
            hours = int(request.query_params.get('hours') or 24)
        except (TypeError, ValueError):
            return Response({'error': 'hours phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        hours = max(1, min(hours, 168))
        since_dt = django_timezone.now() - timedelta(hours=hours)

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
            schedule = Schedule.objects.filter(name=self.SCHEDULER_JOB_NAME).first()
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

        return Response({
            'hours_window': hours,
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
        })

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
        limit = max(1, min(limit, 200))
        logs = (
            AuditLog.objects
            .select_related('user')
            .filter(entity_type='WorkflowAutomationJob')
            .order_by('-created_at', '-id')
        )
        items = []
        for log in logs[: max(limit * 3, limit)]:
            payload = log.new_values or {}
            status_value = str(payload.get('status') or '').upper()
            if status_filter != 'ALL' and status_value != status_filter:
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
            if len(items) >= limit:
                break
        return Response({'items': items, 'total': len(items)})

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
            return Response({'error': result.get('error') or 'Khong the ap dung playbook.'}, status=status.HTTP_400_BAD_REQUEST)
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