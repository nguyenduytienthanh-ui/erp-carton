import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DownloadOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';

import PageHeader from '../../components/PageHeader/PageHeader';
import { useRowSelection } from '../../hooks/useRowSelection';
import { adminApi } from '../../api/admin';
import type {
  GovernanceActivityItem,
  GovernancePermissionItem,
  GovernanceRoleItem,
  GovernanceRoleTemplate,
  GovernanceTeamItem,
  GovernanceTeamPreset,
  GovernanceWatchlistItem,
} from '../../types/admin';
import { getToastMessage } from '../../shared/apiError';
import { downloadCSV } from '../../utils/csvExport';

const { Paragraph, Text, Title } = Typography;

type CatalogStatus = 'all' | 'active' | 'inactive' | 'attention';
type ActivityKind = 'all' | 'role' | 'team' | 'assignment' | 'module';

const HERO_CARD_STYLE: CSSProperties = {
  borderRadius: 22,
  border: '1px solid #d6e3f2',
  background: 'linear-gradient(180deg, #ffffff 0%, #f2f8ff 100%)',
  boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
};

const PANEL_STYLE: CSSProperties = {
  borderRadius: 22,
  border: '1px solid #e2e8f0',
  boxShadow: '0 14px 36px rgba(15, 23, 42, 0.06)',
};

const MODULE_LABELS: Record<string, string> = {
  workforce: 'Nhân sự',
  finance: 'Tài chính',
  purchasing: 'Mua hàng',
  production: 'Sản xuất',
  operations: 'Điều hành',
  reports: 'Báo cáo',
  'workflow-view': 'Quy trình xem',
  'workflow-manage': 'Quy trình quản lý',
  'ops-log': 'Nhật ký vận hành',
  'rbac-audit': 'Kiểm toán RBAC',
  'rbac-manage': 'Quản trị RBAC',
};

const ACTIVITY_KIND_OPTIONS: Array<{ value: ActivityKind; label: string }> = [
  { value: 'all', label: 'Toàn bộ hoạt động' },
  { value: 'role', label: 'Vai trò' },
  { value: 'team', label: 'Nhóm' },
  { value: 'assignment', label: 'Gán quyền' },
  { value: 'module', label: 'Quyền phân hệ' },
];

function formatDateTime(value?: string | null): string {
  if (!value) return 'Chưa ghi nhận';
  return dayjs(value).format('DD/MM/YYYY HH:mm');
}

function getStatusColor(isActive: boolean): string {
  return isActive ? 'green' : 'default';
}

function getActivityColor(item: GovernanceActivityItem): string {
  if (item.severity === 'warning') return 'gold';
  if (item.severity === 'processing') return 'blue';
  if (item.action === 'DELETE') return 'volcano';
  if (item.action === 'ACTIVATE') return 'green';
  if (item.action === 'DEACTIVATE') return 'orange';
  return 'default';
}

function getWatchlistColor(item: GovernanceWatchlistItem): string {
  if (item.severity === 'error') return 'volcano';
  if (item.severity === 'warning') return 'gold';
  return 'blue';
}

function getWatchlistKindLabel(kind: string): string {
  if (kind === 'role') return 'Vai trò';
  if (kind === 'team') return 'Nhóm';
  if (kind === 'user') return 'Người dùng';
  return kind;
}

function getActivityActionLabel(action: string): string {
  if (action === 'CREATE') return 'Tạo mới';
  if (action === 'UPDATE') return 'Cập nhật';
  if (action === 'DELETE') return 'Lưu trữ';
  if (action === 'ACTIVATE') return 'Kích hoạt';
  if (action === 'DEACTIVATE') return 'Tạm dừng';
  return action;
}

function isRoleAttention(role: GovernanceRoleItem): boolean {
  return role.user_count === 0 || role.permission_count === 0;
}

function isTeamAttention(team: GovernanceTeamItem): boolean {
  return team.user_count === 0 || team.locked_user_count > 0;
}

function buildPermissionOptions(permissions: GovernancePermissionItem[]) {
  const grouped = new Map<string, Array<{ label: string; value: number }>>();
  permissions.forEach((permission) => {
    const current = grouped.get(permission.resource) ?? [];
    current.push({ label: `${permission.code} - ${permission.name}`, value: permission.id });
    grouped.set(permission.resource, current);
  });
  return Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([resource, options]) => ({
      label: resource,
      options: options.sort((a, b) => a.label.localeCompare(b.label)),
    }));
}

function SummaryMetric({
  title,
  value,
  tint,
}: {
  title: string;
  value: number | string;
  tint: string;
}) {
  return (
    <Card style={HERO_CARD_STYLE} bodyStyle={{ padding: 18 }}>
      <Statistic title={title} value={value} valueStyle={{ color: tint, fontWeight: 700 }} />
    </Card>
  );
}

export default function RoleTeamGovernance() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [searchState, setSearchState] = useState<{ sourceKey: string; value: string }>({ sourceKey: '', value: '' });
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>('all');
  const [activityKind, setActivityKind] = useState<ActivityKind>('all');
  const [roleDrawerOpen, setRoleDrawerOpen] = useState(false);
  const [teamDrawerOpen, setTeamDrawerOpen] = useState(false);
  const [dismissedFocusKey, setDismissedFocusKey] = useState<string | null>(null);
  const roleFocusRecoveryKeyRef = useRef<string | null>(null);
  const teamFocusRecoveryKeyRef = useRef<string | null>(null);
  const roleFormSeedKeyRef = useRef('');
  const teamFormSeedKeyRef = useRef('');
  const [editingRole, setEditingRole] = useState<GovernanceRoleItem | null>(null);
  const [editingTeam, setEditingTeam] = useState<GovernanceTeamItem | null>(null);
  const [roleCloneSourceId, setRoleCloneSourceId] = useState<number | undefined>(undefined);
  const [roleForm] = Form.useForm();
  const [teamForm] = Form.useForm();
  const focusKind = searchParams.get('focus_kind');
  const focusId = Number(searchParams.get('focus_id') || 0) || null;
  const focusSearch = searchParams.get('q') || searchParams.get('search') || '';
  const focusSignature = `${focusKind ?? ''}:${focusId ?? ''}:${focusSearch.trim().toLowerCase()}`;
  const searchText = searchState.sourceKey === focusSignature ? searchState.value : focusSearch;
  const deferredSearch = useDeferredValue(searchText.trim().toLowerCase());
  const roleSelection = useRowSelection<GovernanceRoleItem>();
  const teamSelection = useRowSelection<GovernanceTeamItem>();

  const summaryQuery = useQuery({
    queryKey: ['admin-role-governance-summary'],
    queryFn: adminApi.getRoleGovernanceSummary,
  });
  const rolesQuery = useQuery({
    queryKey: ['admin-role-governance-roles'],
    queryFn: () => adminApi.listRoles({ page_size: 200 }),
  });
  const teamsQuery = useQuery({
    queryKey: ['admin-role-governance-teams'],
    queryFn: () => adminApi.listTeams({ page_size: 200 }),
  });
  const activityQuery = useQuery({
    queryKey: ['admin-role-governance-activity', activityKind],
    queryFn: () => adminApi.getRoleGovernanceActivity({ kind: activityKind, limit: 24 }),
  });

  const permissionCatalog = useMemo(() => summaryQuery.data?.permissions ?? [], [summaryQuery.data?.permissions]);
  const roleTemplates = useMemo(() => summaryQuery.data?.role_templates ?? [], [summaryQuery.data?.role_templates]);
  const teamPresets = useMemo(() => summaryQuery.data?.team_presets ?? [], [summaryQuery.data?.team_presets]);
  const permissionOptions = useMemo(() => buildPermissionOptions(permissionCatalog), [permissionCatalog]);
  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const focusedRole = roles.find((item) => item.id === focusId || item.code === focusSearch || item.name === focusSearch) ?? null;
  const focusedTeam = teams.find((item) => item.id === focusId || item.code === focusSearch || item.name === focusSearch) ?? null;
  const focusedRoleQuery = useQuery({
    queryKey: ['admin-role-governance-role', focusId],
    queryFn: () => adminApi.getRole(Number(focusId)),
    enabled: focusKind === 'role' && !!focusId && !focusedRole,
  });
  const focusedTeamQuery = useQuery({
    queryKey: ['admin-role-governance-team', focusId],
    queryFn: () => adminApi.getTeam(Number(focusId)),
    enabled: focusKind === 'team' && !!focusId && !focusedTeam,
  });
  const resolvedFocusedRole = focusedRole ?? focusedRoleQuery.data ?? null;
  const resolvedFocusedTeam = focusedTeam ?? focusedTeamQuery.data ?? null;
  const isRolesFetching = rolesQuery.isFetching;
  const isTeamsFetching = teamsQuery.isFetching;
  const refetchRoles = rolesQuery.refetch;
  const refetchTeams = teamsQuery.refetch;
  const isFocusedRoleDrawerActive = focusKind === 'role'
    && dismissedFocusKey !== focusSignature
    && Boolean(resolvedFocusedRole);
  const isFocusedTeamDrawerActive = focusKind === 'team'
    && dismissedFocusKey !== focusSignature
    && Boolean(resolvedFocusedTeam);
  const activeEditingRole = (isFocusedRoleDrawerActive ? resolvedFocusedRole : null) ?? editingRole;
  const activeEditingTeam = (isFocusedTeamDrawerActive ? resolvedFocusedTeam : null) ?? editingTeam;
  const effectiveRoleDrawerOpen = roleDrawerOpen || isFocusedRoleDrawerActive;
  const effectiveTeamDrawerOpen = teamDrawerOpen || isFocusedTeamDrawerActive;

  const invalidateGovernance = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-role-governance-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-role-governance-roles'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-role-governance-teams'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-role-governance-activity'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-module-permissions'] }),
    ]);
  };

  const saveRoleMutation = useMutation({
    mutationFn: async (payload: {
      id?: number;
      code: string;
      name: string;
      description?: string;
      is_active: boolean;
      sort_order: number;
      permission_ids: number[];
    }) => {
      if (payload.id) {
        const { id, ...body } = payload;
        return adminApi.updateRole(id, body);
      }
      return adminApi.createRole(payload);
    },
    onSuccess: async () => {
      message.success(activeEditingRole ? 'Đã cập nhật vai trò.' : 'Đã tạo vai trò mới.');
      closeRoleDrawer();
      roleForm.resetFields();
      await invalidateGovernance();
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Không thể lưu vai trò.'));
    },
  });

  const saveTeamMutation = useMutation({
    mutationFn: async (payload: {
      id?: number;
      code: string;
      name: string;
      description?: string;
      is_active: boolean;
      sort_order: number;
    }) => {
      if (payload.id) {
        const { id, ...body } = payload;
        return adminApi.updateTeam(id, body);
      }
      return adminApi.createTeam(payload);
    },
    onSuccess: async () => {
      message.success(activeEditingTeam ? 'Đã cập nhật nhóm.' : 'Đã tạo nhóm mới.');
      closeTeamDrawer();
      teamForm.resetFields();
      await invalidateGovernance();
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Không thể lưu nhóm.'));
    },
  });

  const roleBulkMutation = useMutation({
    mutationFn: async (payload: { ids: number[]; action: 'activate' | 'deactivate' | 'delete' }) => {
      if (payload.action === 'activate') return adminApi.bulkActivateRoles(payload.ids);
      if (payload.action === 'deactivate') return adminApi.bulkDeactivateRoles(payload.ids);
      return adminApi.bulkDeleteRoles(payload.ids);
    },
    onSuccess: async (_data, variables) => {
      roleSelection.clearSelection();
      message.success(
        variables.action === 'activate'
          ? 'Đã kích hoạt các vai trò đã chọn.'
          : variables.action === 'deactivate'
            ? 'Đã tạm dừng các vai trò đã chọn.'
            : 'Đã lưu trữ các vai trò đã chọn.'
      );
      await invalidateGovernance();
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Không thể xử lý các vai trò đã chọn.'));
    },
  });

  const teamBulkMutation = useMutation({
    mutationFn: async (payload: { ids: number[]; action: 'activate' | 'deactivate' | 'delete' }) => {
      if (payload.action === 'activate') return adminApi.bulkActivateTeams(payload.ids);
      if (payload.action === 'deactivate') return adminApi.bulkDeactivateTeams(payload.ids);
      return adminApi.bulkDeleteTeams(payload.ids);
    },
    onSuccess: async (_data, variables) => {
      teamSelection.clearSelection();
      message.success(
        variables.action === 'activate'
          ? 'Đã kích hoạt các nhóm đã chọn.'
          : variables.action === 'deactivate'
            ? 'Đã tạm dừng các nhóm đã chọn.'
            : 'Đã lưu trữ các nhóm đã chọn.'
      );
      await invalidateGovernance();
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Không thể xử lý các nhóm đã chọn.'));
    },
  });

  const visibleRoles = useMemo(() => {
    return roles.filter((role) => {
      if (catalogStatus === 'active' && !role.is_active) return false;
      if (catalogStatus === 'inactive' && role.is_active) return false;
      if (catalogStatus === 'attention' && !isRoleAttention(role)) return false;
      if (!deferredSearch) return true;
      return `${role.code} ${role.name} ${role.description}`.toLowerCase().includes(deferredSearch);
    });
  }, [catalogStatus, deferredSearch, roles]);

  const visibleTeams = useMemo(() => {
    return teams.filter((team) => {
      if (catalogStatus === 'active' && !team.is_active) return false;
      if (catalogStatus === 'inactive' && team.is_active) return false;
      if (catalogStatus === 'attention' && !isTeamAttention(team)) return false;
      if (!deferredSearch) return true;
      return `${team.code} ${team.name} ${team.description}`.toLowerCase().includes(deferredSearch);
    });
  }, [catalogStatus, deferredSearch, teams]);

  const exportRoles = () => {
    if (!visibleRoles.length) {
      message.warning('Chưa có vai trò phù hợp để xuất CSV.');
      return;
    }
    downloadCSV(
      visibleRoles.map((role) => ({
        'Mã vai trò': role.code,
        'Tên vai trò': role.name,
        'Mô tả': role.description || '',
        'Trạng thái': role.is_active ? 'Đang dùng' : 'Tạm dừng',
        'Số quyền': role.permission_count,
        'Số người dùng': role.user_count,
        'Người dùng hoạt động': role.active_user_count,
        'Phân hệ trọng tâm': role.module_keys.map((key) => MODULE_LABELS[key] ?? key).join(', '),
        'Hoạt động gần nhất': formatDateTime(role.last_activity_at),
      })),
      'role-governance',
    );
  };

  const exportTeams = () => {
    if (!visibleTeams.length) {
      message.warning('Chưa có nhóm phù hợp để xuất CSV.');
      return;
    }
    downloadCSV(
      visibleTeams.map((team) => ({
        'Mã nhóm': team.code,
        'Tên nhóm': team.name,
        'Mô tả': team.description || '',
        'Trạng thái': team.is_active ? 'Đang dùng' : 'Tạm dừng',
        'Tổng thành viên': team.user_count,
        'Thành viên hoạt động': team.active_user_count,
        'Tài khoản bị khóa': team.locked_user_count,
        'Hoạt động gần nhất': formatDateTime(team.last_activity_at),
      })),
      'team-governance',
    );
  };

  const dismissFocusedDrawer = () => {
    if (focusKind === 'role' || focusKind === 'team') {
      setDismissedFocusKey(focusSignature);
    }
  };

  const closeRoleDrawer = () => {
    if (isFocusedRoleDrawerActive) {
      setDismissedFocusKey(focusSignature);
    }
    setRoleDrawerOpen(false);
    setEditingRole(null);
    setRoleCloneSourceId(undefined);
    roleFormSeedKeyRef.current = '';
  };

  const closeTeamDrawer = () => {
    if (isFocusedTeamDrawerActive) {
      setDismissedFocusKey(focusSignature);
    }
    setTeamDrawerOpen(false);
    setEditingTeam(null);
    teamFormSeedKeyRef.current = '';
  };

  const openCreateRoleDrawer = () => {
    dismissFocusedDrawer();
    setTeamDrawerOpen(false);
    setEditingTeam(null);
    teamFormSeedKeyRef.current = '';
    setEditingRole(null);
    setRoleCloneSourceId(undefined);
    roleFormSeedKeyRef.current = '';
    setRoleDrawerOpen(true);
  };

  const openEditRoleDrawer = (role: GovernanceRoleItem) => {
    dismissFocusedDrawer();
    setTeamDrawerOpen(false);
    setEditingTeam(null);
    teamFormSeedKeyRef.current = '';
    setEditingRole(role);
    setRoleCloneSourceId(undefined);
    roleFormSeedKeyRef.current = '';
    setRoleDrawerOpen(true);
  };

  const openCreateTeamDrawer = () => {
    dismissFocusedDrawer();
    setRoleDrawerOpen(false);
    setEditingRole(null);
    setRoleCloneSourceId(undefined);
    roleFormSeedKeyRef.current = '';
    setEditingTeam(null);
    teamFormSeedKeyRef.current = '';
    setTeamDrawerOpen(true);
  };

  const openEditTeamDrawer = (team: GovernanceTeamItem) => {
    dismissFocusedDrawer();
    setRoleDrawerOpen(false);
    setEditingRole(null);
    setRoleCloneSourceId(undefined);
    roleFormSeedKeyRef.current = '';
    setEditingTeam(team);
    teamFormSeedKeyRef.current = '';
    setTeamDrawerOpen(true);
  };

  useEffect(() => {
    if (focusKind !== 'role' || !focusId || resolvedFocusedRole || focusedRoleQuery.isFetching || isRolesFetching) {
      return;
    }
    const recoveryKey = `${focusSignature}:role`;
    if (roleFocusRecoveryKeyRef.current === recoveryKey) {
      return;
    }
    roleFocusRecoveryKeyRef.current = recoveryKey;
    void refetchRoles();
  }, [
    focusId,
    focusKind,
    focusSignature,
    focusedRoleQuery.isFetching,
    isRolesFetching,
    refetchRoles,
    resolvedFocusedRole,
  ]);

  useEffect(() => {
    if (focusKind !== 'team' || !focusId || resolvedFocusedTeam || focusedTeamQuery.isFetching || isTeamsFetching) {
      return;
    }
    const recoveryKey = `${focusSignature}:team`;
    if (teamFocusRecoveryKeyRef.current === recoveryKey) {
      return;
    }
    teamFocusRecoveryKeyRef.current = recoveryKey;
    void refetchTeams();
  }, [
    focusId,
    focusKind,
    focusSignature,
    focusedTeamQuery.isFetching,
    isTeamsFetching,
    refetchTeams,
    resolvedFocusedTeam,
  ]);

  useEffect(() => {
    if (!effectiveRoleDrawerOpen) {
      roleFormSeedKeyRef.current = '';
      return;
    }
    const nextSeedKey = activeEditingRole ? `edit:${activeEditingRole.id}` : 'create';
    if (roleFormSeedKeyRef.current === nextSeedKey) {
      return;
    }
    roleFormSeedKeyRef.current = nextSeedKey;
    roleForm.resetFields();
    if (activeEditingRole) {
      roleForm.setFieldsValue({
        code: activeEditingRole.code,
        name: activeEditingRole.name,
        description: activeEditingRole.description,
        is_active: activeEditingRole.is_active,
        sort_order: activeEditingRole.sort_order,
        permission_ids: activeEditingRole.permissions.map((permission) => permission.id),
      });
      return;
    }
    roleForm.setFieldsValue({ code: '', name: '', description: '', is_active: true, sort_order: 10, permission_ids: [] });
  }, [activeEditingRole, effectiveRoleDrawerOpen, roleForm]);

  useEffect(() => {
    if (!effectiveTeamDrawerOpen) {
      teamFormSeedKeyRef.current = '';
      return;
    }
    const nextSeedKey = activeEditingTeam ? `edit:${activeEditingTeam.id}` : 'create';
    if (teamFormSeedKeyRef.current === nextSeedKey) {
      return;
    }
    teamFormSeedKeyRef.current = nextSeedKey;
    teamForm.resetFields();
    if (activeEditingTeam) {
      teamForm.setFieldsValue({
        code: activeEditingTeam.code,
        name: activeEditingTeam.name,
        description: activeEditingTeam.description,
        is_active: activeEditingTeam.is_active,
        sort_order: activeEditingTeam.sort_order,
      });
      return;
    }
    teamForm.setFieldsValue({ code: '', name: '', description: '', is_active: true, sort_order: 10 });
  }, [activeEditingTeam, effectiveTeamDrawerOpen, teamForm]);

  const applyRoleTemplate = (template: GovernanceRoleTemplate) => {
    roleForm.setFieldsValue({
      permission_ids: template.permission_ids,
      description: roleForm.getFieldValue('description') || template.description,
    });
  };

  const applyRoleClone = (roleId?: number) => {
    setRoleCloneSourceId(roleId);
    if (!roleId) return;
    const source = roles.find((role) => role.id === roleId);
    if (!source) return;
    roleForm.setFieldsValue({
      description: roleForm.getFieldValue('description') || source.description,
      sort_order: source.sort_order + 10,
      permission_ids: source.permissions.map((permission) => permission.id),
    });
  };

  const applyTeamPreset = (preset: GovernanceTeamPreset) => {
    teamForm.setFieldsValue({
      code: preset.code,
      name: preset.name,
      description: preset.description,
    });
  };

  const handleRoleSubmit = async () => {
    const values = await roleForm.validateFields();
    saveRoleMutation.mutate({
      id: activeEditingRole?.id,
      code: String(values.code || '').trim(),
      name: String(values.name || '').trim(),
      description: String(values.description || '').trim(),
      is_active: Boolean(values.is_active),
      sort_order: Number(values.sort_order || 0),
      permission_ids: (values.permission_ids as number[]) ?? [],
    });
  };

  const handleTeamSubmit = async () => {
    const values = await teamForm.validateFields();
    saveTeamMutation.mutate({
      id: activeEditingTeam?.id,
      code: String(values.code || '').trim(),
      name: String(values.name || '').trim(),
      description: String(values.description || '').trim(),
      is_active: Boolean(values.is_active),
      sort_order: Number(values.sort_order || 0),
    });
  };

  const roleColumns: ColumnsType<GovernanceRoleItem> = [
    {
      title: 'Vai trò',
      dataIndex: 'name',
      key: 'name',
      render: (_value, record) => (
        <Space direction="vertical" size={2}>
          <Space wrap>
            <Text strong>{record.name}</Text>
            <Tag>{record.code}</Tag>
            <Tag color={getStatusColor(record.is_active)}>{record.is_active ? 'Đang dùng' : 'Tạm dừng'}</Tag>
          </Space>
          <Text type="secondary">{record.description || 'Chưa có mô tả'}</Text>
        </Space>
      ),
    },
    {
      title: 'Độ phủ',
      key: 'coverage',
      render: (_value, record) => (
        <Space direction="vertical" size={6}>
          <Text>{`Quyền: ${record.permission_count}`}</Text>
          <Space size={[6, 6]} wrap>
            {(record.module_keys.length > 0 ? record.module_keys : ['none']).map((key) => (
              <Tag key={`${record.id}-${key}`} color={key === 'none' ? 'default' : 'blue'}>
                {key === 'none' ? 'Chưa gắn phân hệ' : (MODULE_LABELS[key] ?? key)}
              </Tag>
            ))}
          </Space>
        </Space>
      ),
    },
    {
      title: 'Người dùng',
      key: 'users',
      width: 130,
      render: (_value, record) => (
        <Space direction="vertical" size={2}>
          <Text strong>{record.user_count}</Text>
          <Text type="secondary">{`Đang hoạt động ${record.active_user_count}`}</Text>
        </Space>
      ),
    },
    {
      title: 'Hoạt động gần nhất',
      key: 'last_activity',
      width: 170,
      render: (_value, record) => (
        <Space direction="vertical" size={2}>
          <Text>{formatDateTime(record.last_activity_at)}</Text>
          {record.last_activity_action ? <Tag>{record.last_activity_action}</Tag> : null}
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'action',
      width: 240,
      render: (_value, record) => (
        <Space wrap>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditRoleDrawer(record)}>Chỉnh sửa</Button>
          <Button size="small" onClick={() => roleBulkMutation.mutate({ ids: [record.id], action: record.is_active ? 'deactivate' : 'activate' })}>
            {record.is_active ? 'Tạm dừng' : 'Kích hoạt'}
          </Button>
          <Button danger size="small" onClick={() => roleBulkMutation.mutate({ ids: [record.id], action: 'delete' })}>Lưu trữ</Button>
        </Space>
      ),
    },
  ];

  const teamColumns: ColumnsType<GovernanceTeamItem> = [
    {
      title: 'Nhóm',
      dataIndex: 'name',
      key: 'name',
      render: (_value, record) => (
        <Space direction="vertical" size={2}>
          <Space wrap>
            <Text strong>{record.name}</Text>
            <Tag>{record.code}</Tag>
            <Tag color={getStatusColor(record.is_active)}>{record.is_active ? 'Đang dùng' : 'Tạm dừng'}</Tag>
          </Space>
          <Text type="secondary">{record.description || 'Chưa có mô tả'}</Text>
        </Space>
      ),
    },
    {
      title: 'Thành viên',
      key: 'members',
      width: 160,
      render: (_value, record) => (
        <Space direction="vertical" size={2}>
          <Text strong>{record.user_count}</Text>
          <Text type="secondary">{`Hoạt động ${record.active_user_count} | Bị khóa ${record.locked_user_count}`}</Text>
        </Space>
      ),
    },
    {
      title: 'Hoạt động gần nhất',
      key: 'last_activity',
      width: 170,
      render: (_value, record) => (
        <Space direction="vertical" size={2}>
          <Text>{formatDateTime(record.last_activity_at)}</Text>
          {record.last_activity_action ? <Tag>{record.last_activity_action}</Tag> : null}
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'action',
      width: 240,
      render: (_value, record) => (
        <Space wrap>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditTeamDrawer(record)}>Chỉnh sửa</Button>
          <Button size="small" onClick={() => teamBulkMutation.mutate({ ids: [record.id], action: record.is_active ? 'deactivate' : 'activate' })}>
            {record.is_active ? 'Tạm dừng' : 'Kích hoạt'}
          </Button>
          <Button danger size="small" onClick={() => teamBulkMutation.mutate({ ids: [record.id], action: 'delete' })}>Lưu trữ</Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Trung tâm quản trị vai trò và nhóm"
        subtitle="Điều phối vai trò, nhóm và nhật ký quản trị trong một command center thống nhất cho lớp kiểm soát."
        icon={<SafetyOutlined />}
        extra={(
          <>
            <Button onClick={() => navigate('/admin/module-permissions')}>Mở phân quyền phân hệ</Button>
            <Button onClick={() => navigate('/admin/module-permission-history')}>Xem lịch sử phân quyền</Button>
            <Button icon={<ReloadOutlined />} onClick={() => void invalidateGovernance()}>Làm mới</Button>
            <Button icon={<PlusOutlined />} onClick={openCreateTeamDrawer}>Tạo nhóm</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateRoleDrawer}>Tạo vai trò</Button>
          </>
        )}
      >
        <Space wrap size={12}>
          <Input.Search
            data-testid="role-governance-search"
            allowClear
            placeholder="Tìm vai trò hoặc nhóm theo mã, tên, mô tả"
            value={searchText}
            onChange={(event) => setSearchState({ sourceKey: focusSignature, value: event.target.value })}
            style={{ width: 320 }}
          />
          <Select<CatalogStatus>
            value={catalogStatus}
            onChange={setCatalogStatus}
            style={{ width: 180 }}
            options={[
              { value: 'all', label: 'Toàn bộ danh mục' },
              { value: 'active', label: 'Chỉ đang dùng' },
              { value: 'inactive', label: 'Chỉ tạm dừng' },
              { value: 'attention', label: 'Chỉ cần xử lý' },
            ]}
          />
          <Select<ActivityKind>
            value={activityKind}
            onChange={setActivityKind}
            style={{ width: 180 }}
            options={ACTIVITY_KIND_OPTIONS}
          />
        </Space>
      </PageHeader>

      {(focusId || focusSearch || focusKind === 'role' || focusKind === 'team') ? (
        <Alert
          data-testid="role-governance-focus-banner"
          type={activeEditingRole || activeEditingTeam ? 'info' : 'warning'}
          showIcon
          style={{ marginBottom: 16 }}
          message={`Đang tập trung theo drilldown: ${focusSearch || focusKind || `#${focusId}`}`}
          description={activeEditingRole || activeEditingTeam
            ? 'Drawer chỉnh sửa đã được mở sẵn để bạn tiếp tục rà soát governance theo đúng ngữ cảnh.'
            : 'Danh mục đang được thu hẹp theo tín hiệu drilldown. Nếu chưa thấy bản ghi cần mở, hãy kiểm tra bộ lọc hoặc dữ liệu hiện hành.'}
        />
      ) : null}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12} xl={6}><SummaryMetric title="Tổng vai trò" value={summaryQuery.data?.summary.total_roles ?? 0} tint="#2563eb" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryMetric title="Vai trò nhạy cảm" value={summaryQuery.data?.summary.sensitive_roles ?? 0} tint="#c2410c" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryMetric title="Người dùng thiếu vai trò" value={summaryQuery.data?.summary.users_without_role ?? 0} tint="#b45309" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryMetric title="Sự kiện 7 ngày" value={summaryQuery.data?.summary.recent_events_7d ?? 0} tint="#0f766e" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryMetric title="Tổng nhóm" value={summaryQuery.data?.summary.total_teams ?? 0} tint="#1d4ed8" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryMetric title="Nhóm trống" value={summaryQuery.data?.summary.empty_teams ?? 0} tint="#c2410c" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryMetric title="Người dùng thiếu nhóm" value={summaryQuery.data?.summary.users_without_team ?? 0} tint="#b45309" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryMetric title="Tài khoản bị khóa" value={summaryQuery.data?.summary.locked_users ?? 0} tint="#0f766e" /></Col>
      </Row>

      {(catalogStatus === 'attention' || deferredSearch || (summaryQuery.data?.watchlist?.length ?? 0) > 0) ? (
        <Alert
          type={(summaryQuery.data?.watchlist?.length ?? 0) > 0 ? 'warning' : 'info'}
          showIcon
          style={{ marginBottom: 16, borderRadius: 16 }}
          message="Chế độ điều phối quản trị"
          description={[
            deferredSearch ? `Từ khóa: ${deferredSearch}` : null,
            catalogStatus === 'attention' ? 'Đang lọc các vai trò và nhóm cần xử lý ưu tiên.' : null,
            (summaryQuery.data?.watchlist?.length ?? 0) > 0 ? `Watchlist hiện có ${summaryQuery.data?.watchlist?.length ?? 0} tín hiệu cần kiểm soát.` : null,
          ].filter(Boolean).join(' | ')}
        />
      ) : null}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} xl={8}>
          <Card title="Watchlist quản trị" style={PANEL_STYLE} bodyStyle={{ minHeight: 320 }}>
            {summaryQuery.data?.watchlist?.length ? (
              <List
                dataSource={summaryQuery.data.watchlist}
                renderItem={(item) => (
                  <List.Item actions={[<Button key={`${item.title}-open`} type="link" onClick={() => navigate(item.route)}>Mở</Button>]}>
                    <List.Item.Meta
                      title={<Space wrap><Text strong>{item.title}</Text><Tag color={getWatchlistColor(item)}>{getWatchlistKindLabel(item.kind)}</Tag></Space>}
                      description={item.description}
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="Chưa có mục nào cần cảnh báo" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="Mẫu vai trò" style={PANEL_STYLE} bodyStyle={{ minHeight: 320 }}>
            <List
              dataSource={roleTemplates}
              renderItem={(template) => (
                <List.Item actions={[<Button key={`${template.key}-use`} type="link" onClick={() => { openCreateRoleDrawer(); applyRoleTemplate(template); }}>Dùng cho vai trò mới</Button>]}>
                  <List.Item.Meta
                    title={<Space wrap><Text strong>{template.name}</Text><Tag color="blue">{template.permissions.length} quyền</Tag></Space>}
                    description={(
                      <Space direction="vertical" size={6}>
                        <Text type="secondary">{template.description}</Text>
                        <Space size={[6, 6]} wrap>
                          {template.focus_modules.map((module) => <Tag key={`${template.key}-${module}`}>{MODULE_LABELS[module] ?? module}</Tag>)}
                        </Space>
                      </Space>
                    )}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="Độ phủ phân hệ" style={PANEL_STYLE} bodyStyle={{ minHeight: 320 }}>
            {(summaryQuery.data?.module_coverage ?? []).length ? (
              <Space direction="vertical" size={14} style={{ width: '100%' }}>
                {(summaryQuery.data?.module_coverage ?? []).map((item) => {
                  const totalRoles = Math.max(1, summaryQuery.data?.summary.total_roles ?? 1);
                  return (
                    <div key={item.key}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                        <Text strong>{item.label}</Text>
                        <Tag color="blue">{item.active_role_count}</Tag>
                      </div>
                      <Progress percent={Math.round((item.active_role_count / totalRoles) * 100)} strokeColor="#2563eb" showInfo={false} />
                    </div>
                  );
                })}
              </Space>
            ) : (
              <Empty description="Chưa có dữ liệu độ phủ" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Col>
      </Row>

      <Card
        title="Xưởng vai trò"
        extra={(
          <Space wrap>
            <Tag>{`${visibleRoles.length} vai trò`}</Tag>
            <Button icon={<DownloadOutlined />} onClick={exportRoles}>Xuất CSV</Button>
          </Space>
        )}
        style={{ ...PANEL_STYLE, marginBottom: 16 }}
      >
        {roleSelection.selectedCount > 0 ? (
          <Alert
            style={{ marginBottom: 16, borderRadius: 16 }}
            type="info"
            message={`Đang chọn ${roleSelection.selectedCount} vai trò`}
            action={(
              <Space wrap>
                <Button size="small" onClick={() => roleBulkMutation.mutate({ ids: roleSelection.selectedIds, action: 'activate' })}>Kích hoạt</Button>
                <Button size="small" onClick={() => roleBulkMutation.mutate({ ids: roleSelection.selectedIds, action: 'deactivate' })}>Tạm dừng</Button>
                <Button size="small" danger onClick={() => roleBulkMutation.mutate({ ids: roleSelection.selectedIds, action: 'delete' })}>Lưu trữ</Button>
              </Space>
            )}
          />
        ) : null}
        <Table<GovernanceRoleItem>
          rowKey="id"
          dataSource={visibleRoles}
          columns={roleColumns}
          rowSelection={roleSelection.rowSelection}
          loading={rolesQuery.isLoading || roleBulkMutation.isPending}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          scroll={{ x: 1100 }}
        />
      </Card>

      <Card
        title="Xưởng nhóm"
        extra={(
          <Space wrap>
            <Tag>{`${visibleTeams.length} nhóm`}</Tag>
            <Button icon={<DownloadOutlined />} onClick={exportTeams}>Xuất CSV</Button>
          </Space>
        )}
        style={{ ...PANEL_STYLE, marginBottom: 16 }}
      >
        {teamSelection.selectedCount > 0 ? (
          <Alert
            style={{ marginBottom: 16, borderRadius: 16 }}
            type="info"
            message={`Đang chọn ${teamSelection.selectedCount} nhóm`}
            action={(
              <Space wrap>
                <Button size="small" onClick={() => teamBulkMutation.mutate({ ids: teamSelection.selectedIds, action: 'activate' })}>Kích hoạt</Button>
                <Button size="small" onClick={() => teamBulkMutation.mutate({ ids: teamSelection.selectedIds, action: 'deactivate' })}>Tạm dừng</Button>
                <Button size="small" danger onClick={() => teamBulkMutation.mutate({ ids: teamSelection.selectedIds, action: 'delete' })}>Lưu trữ</Button>
              </Space>
            )}
          />
        ) : null}
        <Table<GovernanceTeamItem>
          rowKey="id"
          dataSource={visibleTeams}
          columns={teamColumns}
          rowSelection={teamSelection.rowSelection}
          loading={teamsQuery.isLoading || teamBulkMutation.isPending}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          scroll={{ x: 900 }}
        />
      </Card>

      <Card title="Nhật ký quản trị" style={PANEL_STYLE}>
        <List
          loading={activityQuery.isLoading}
          dataSource={activityQuery.data?.items ?? []}
          locale={{ emptyText: <Empty description="Chưa có hoạt động quản trị" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          renderItem={(item) => (
            <List.Item actions={[<Button key={`${item.id}-open`} type="link" onClick={() => navigate(item.route)}>Mở</Button>]}>
              <List.Item.Meta
                avatar={<Tag color={getActivityColor(item)}>{item.kind_label}</Tag>}
                title={<Space wrap><Text strong>{item.summary}</Text><Tag>{getActivityActionLabel(item.action)}</Tag></Space>}
                description={(
                  <Space direction="vertical" size={4}>
                    <Text type="secondary">{`${item.actor.full_name || item.actor.username || 'Hệ thống'} • ${formatDateTime(item.timestamp)}`}</Text>
                    {item.changed_fields.length > 0 ? (
                      <Space size={[6, 6]} wrap>
                        {item.changed_fields.map((field) => <Tag key={`${item.id}-${field}`}>{field}</Tag>)}
                      </Space>
                    ) : null}
                  </Space>
                )}
              />
            </List.Item>
          )}
        />
      </Card>

      <Drawer
        title={activeEditingRole ? `Xưởng vai trò: ${activeEditingRole.code}` : 'Xưởng vai trò'}
        width={720}
        open={effectiveRoleDrawerOpen}
        onClose={closeRoleDrawer}
        extra={<Space><Button onClick={closeRoleDrawer}>Hủy</Button><Button type="primary" loading={saveRoleMutation.isPending} onClick={() => void handleRoleSubmit()}>Lưu vai trò</Button></Space>}
      >
        <div data-testid="role-governance-role-drawer">
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card size="small" style={{ borderRadius: 16 }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {!activeEditingRole ? (
                <Select<number>
                  allowClear
                  showSearch
                  placeholder="Sao chép quyền từ một vai trò đang có"
                  value={roleCloneSourceId}
                  onChange={applyRoleClone}
                  options={roles.map((role) => ({ value: role.id, label: `${role.code} - ${role.name}` }))}
                />
              ) : null}
              <div>
                <Text strong>Mẫu áp dụng nhanh</Text>
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {roleTemplates.map((template) => <Button key={template.key} size="small" onClick={() => applyRoleTemplate(template)}>{template.name}</Button>)}
                </div>
              </div>
            </Space>
          </Card>

          <Form form={roleForm} layout="vertical">
            <Row gutter={16}>
              <Col xs={24} md={12}><Form.Item name="code" label="Mã vai trò" rules={[{ required: true, message: 'Nhập mã vai trò' }]}><Input placeholder="Ví dụ: OPS_LEAD" /></Form.Item></Col>
              <Col xs={24} md={12}><Form.Item name="name" label="Tên vai trò" rules={[{ required: true, message: 'Nhập tên vai trò' }]}><Input placeholder="Ví dụ: Điều phối vận hành" /></Form.Item></Col>
              <Col xs={24} md={16}><Form.Item name="description" label="Mô tả"><Input.TextArea rows={3} placeholder="Mục tiêu vận hành, guardrail và bối cảnh dùng vai trò này" /></Form.Item></Col>
              <Col xs={24} md={8}>
                <Form.Item name="sort_order" label="Thứ tự hiển thị" rules={[{ required: true, message: 'Nhập thứ tự' }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
                <Form.Item name="is_active" label="Đang dùng" valuePropName="checked"><Switch /></Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item name="permission_ids" label="Danh sách quyền">
                  <Select mode="multiple" showSearch optionFilterProp="label" placeholder="Chọn quyền cho vai trò này" options={permissionOptions} />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Space>
        </div>
      </Drawer>

      <Drawer
        title={activeEditingTeam ? `Xưởng nhóm: ${activeEditingTeam.code}` : 'Xưởng nhóm'}
        width={540}
        open={effectiveTeamDrawerOpen}
        onClose={closeTeamDrawer}
        extra={<Space><Button onClick={closeTeamDrawer}>Hủy</Button><Button type="primary" loading={saveTeamMutation.isPending} onClick={() => void handleTeamSubmit()}>Lưu nhóm</Button></Space>}
      >
        <div data-testid="role-governance-team-drawer">
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card size="small" style={{ borderRadius: 16 }}>
            <Title level={5} style={{ marginTop: 0 }}>Mẫu nhóm</Title>
            <Paragraph type="secondary" style={{ marginBottom: 12 }}>Dùng preset để tạo nhóm nhanh theo những cấu trúc vận hành phổ biến.</Paragraph>
            <Space size={[8, 8]} wrap>
              {teamPresets.map((preset) => <Button key={preset.key} size="small" onClick={() => applyTeamPreset(preset)}>{preset.name}</Button>)}
            </Space>
          </Card>

          <Form form={teamForm} layout="vertical">
            <Form.Item name="code" label="Mã nhóm" rules={[{ required: true, message: 'Nhập mã nhóm' }]}><Input placeholder="Ví dụ: OPS_CELL" /></Form.Item>
            <Form.Item name="name" label="Tên nhóm" rules={[{ required: true, message: 'Nhập tên nhóm' }]}><Input placeholder="Ví dụ: Tổ vận hành" /></Form.Item>
            <Form.Item name="description" label="Mô tả"><Input.TextArea rows={4} placeholder="Sứ mệnh, phạm vi phối hợp và nguyên tắc bàn giao của nhóm" /></Form.Item>
            <Row gutter={16}>
              <Col xs={24} md={12}><Form.Item name="sort_order" label="Thứ tự hiển thị" rules={[{ required: true, message: 'Nhập thứ tự' }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
              <Col xs={24} md={12}><Form.Item name="is_active" label="Đang dùng" valuePropName="checked"><Switch /></Form.Item></Col>
            </Row>
          </Form>
        </Space>
        </div>
      </Drawer>
    </div>
  );
}
