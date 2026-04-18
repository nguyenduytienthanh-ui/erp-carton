import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Input,
  List,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined,
  DownloadOutlined,
  FilterOutlined,
  HistoryOutlined,
  LockOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  SafetyOutlined,
  ThunderboltOutlined,
  UnlockOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';

import PageHeader from '../../components/PageHeader/PageHeader';
import { useRowSelection } from '../../hooks/useRowSelection';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import {
  usersApi,
  type AdminUserDirectoryFilters,
  type AdminUserDirectoryFocusItem,
  type AdminUserDirectoryItem,
  type UserAccessActivityItem,
} from '../../api/users';
import { getToastMessage } from '../../shared/apiError';
import { downloadCSV } from '../../utils/csvExport';
import { PAGES } from '../../utils/constants';

const { Text, Title } = Typography;

const SUMMARY_TILE_STYLE: CSSProperties = {
  height: '100%',
  borderRadius: 20,
  border: '1px solid #dbe6f3',
  background: 'linear-gradient(180deg, #ffffff 0%, #f6fbff 100%)',
  boxShadow: '0 20px 40px rgba(15, 23, 42, 0.06)',
};

const PANEL_STYLE: CSSProperties = {
  borderRadius: 20,
  border: '1px solid #e5edf6',
  boxShadow: '0 16px 36px rgba(15, 23, 42, 0.05)',
};

type AdminUserCenterFilters = {
  status: 'all' | 'active' | 'inactive';
  lockState: 'all' | 'locked' | 'unlocked';
  attention: 'all' | 'review' | 'unassigned' | 'locked' | 'inactive' | 'dormant';
  sessionState: 'all' | 'online' | 'offline';
  role?: number;
  team?: number;
};

type AdminUserCenterPreferences = {
  search?: string;
  pageSize?: number;
  filters?: AdminUserCenterFilters;
};

const DEFAULT_FILTERS: AdminUserCenterFilters = {
  status: 'all',
  lockState: 'all',
  attention: 'all',
  sessionState: 'all',
  role: undefined,
  team: undefined,
};

function serializeFilters(filters: AdminUserCenterFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): AdminUserCenterFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<AdminUserCenterFilters>;
    return {
      status: parsed.status === 'active' || parsed.status === 'inactive' ? parsed.status : 'all',
      lockState: parsed.lockState === 'locked' || parsed.lockState === 'unlocked' ? parsed.lockState : 'all',
      attention: parsed.attention === 'review'
        || parsed.attention === 'unassigned'
        || parsed.attention === 'locked'
        || parsed.attention === 'inactive'
        || parsed.attention === 'dormant'
        ? parsed.attention
        : 'all',
      sessionState: parsed.sessionState === 'online' || parsed.sessionState === 'offline' ? parsed.sessionState : 'all',
      role: typeof parsed.role === 'number' && parsed.role > 0 ? parsed.role : undefined,
      team: typeof parsed.team === 'number' && parsed.team > 0 ? parsed.team : undefined,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function normalizePreferences(config: Record<string, unknown>): Required<AdminUserCenterPreferences> {
  const pageSize = typeof config.pageSize === 'number' && config.pageSize > 0 ? config.pageSize : 20;
  const search = typeof config.search === 'string' ? config.search : '';
  const filters = config.filters && typeof config.filters === 'object'
    ? parseFilters(JSON.stringify(config.filters))
    : DEFAULT_FILTERS;
  return {
    search,
    pageSize,
    filters,
  };
}

function toDirectoryParams(
  search: string,
  filters: AdminUserCenterFilters,
  page?: number,
  pageSize?: number,
): AdminUserDirectoryFilters {
  return {
    search: search.trim() || undefined,
    role: filters.role,
    team: filters.team,
    is_active: filters.status === 'active' ? true : filters.status === 'inactive' ? false : undefined,
    is_locked: filters.lockState === 'locked' ? true : filters.lockState === 'unlocked' ? false : undefined,
    attention: filters.attention,
    session_state: filters.sessionState,
    page,
    page_size: pageSize,
  };
}

function formatDateTime(value?: string | null): string {
  if (!value) return 'Chưa ghi nhận';
  return dayjs(value).format('DD/MM/YYYY HH:mm');
}

function getUserInitials(user: AdminUserDirectoryItem): string {
  const source = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || 'U';
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function getAttentionReasons(user: AdminUserDirectoryItem): string[] {
  const reasons: string[] = [];
  if (user.is_locked) reasons.push('Bị khóa');
  if (!user.is_active) reasons.push('Tạm ngưng');
  if (user.role_count === 0) reasons.push('Thiếu vai trò');
  if (user.team_count === 0) reasons.push('Thiếu nhóm');
  if (user.active_session_count >= 4) reasons.push('Nhiều phiên');
  if (!user.last_seen_at || dayjs(user.last_seen_at).isBefore(dayjs().subtract(30, 'day'))) reasons.push('Ngủ đông');
  return reasons;
}

function reasonColor(reason: string): string {
  if (reason === 'Bị khóa' || reason === 'Tạm ngưng') return 'red';
  if (reason === 'Ngủ đông') return 'gold';
  if (reason === 'Nhiều phiên') return 'cyan';
  return 'default';
}

function renderCompactTags(items: Array<{ id: number; name: string; code: string }>, emptyLabel: string) {
  if (!items.length) return <Tag>{emptyLabel}</Tag>;
  const visible = items.slice(0, 2);
  return (
    <Space size={[6, 6]} wrap>
      {visible.map((item) => (
        <Tag key={`${item.id}-${item.code}`}>{item.name || item.code}</Tag>
      ))}
      {items.length > visible.length ? <Tag>+{items.length - visible.length}</Tag> : null}
    </Space>
  );
}

function describeAccessDelta(
  beforeItems: Array<{ id: number; name: string; code: string }>,
  afterItems: Array<{ id: number; name: string; code: string }>,
) {
  const beforeMap = new Map(beforeItems.map((item) => [item.id, item.name || item.code]));
  const afterMap = new Map(afterItems.map((item) => [item.id, item.name || item.code]));
  const added = Array.from(afterMap.entries())
    .filter(([id]) => !beforeMap.has(id))
    .map(([, label]) => label);
  const removed = Array.from(beforeMap.entries())
    .filter(([id]) => !afterMap.has(id))
    .map(([, label]) => label);

  const parts: string[] = [];
  if (added.length) parts.push(`+ ${added.join(', ')}`);
  if (removed.length) parts.push(`- ${removed.join(', ')}`);
  if (!parts.length) return 'Không thay đổi';
  return parts.join(' | ');
}

function strategyLabel(strategy?: string): string {
  if (strategy === 'add') return 'Thêm vào';
  if (strategy === 'remove') return 'Gỡ bỏ';
  return 'Thay thế';
}

function strategyColor(strategy?: string): string {
  if (strategy === 'add') return 'green';
  if (strategy === 'remove') return 'volcano';
  return 'blue';
}

function BreakdownList({
  title,
  items,
  accentColor,
}: {
  title: string;
  items: Array<{ id: number; code: string; name: string; user_count: number }>;
  accentColor: string;
}) {
  const maxCount = items.reduce((max, item) => Math.max(max, item.user_count), 0);
  return (
    <Card size="small" title={title} style={{ borderRadius: 16 }}>
      {items.length === 0 ? (
        <Empty description="Chưa có dữ liệu" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          {items.map((item) => (
            <div key={`${title}-${item.id}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                <Text strong>{item.name || item.code}</Text>
                <Tag color="blue">{item.user_count}</Tag>
              </div>
              <Progress
                percent={maxCount > 0 ? Math.round((item.user_count / maxCount) * 100) : 0}
                strokeColor={accentColor}
                showInfo={false}
                size="small"
              />
            </div>
          ))}
        </Space>
      )}
    </Card>
  );
}

function buildUserRecommendations(user: AdminUserDirectoryItem): string[] {
  const recommendations: string[] = [];
  if (user.is_locked) {
    recommendations.push('Xác nhận lại lý do khóa tài khoản và thời điểm có thể mở khóa.');
  }
  if (!user.is_active) {
    recommendations.push('Kiểm tra xem tài khoản có còn cần giữ trạng thái tạm ngưng hay nên kích hoạt lại.');
  }
  if (user.role_count === 0 || user.team_count === 0) {
    recommendations.push('Bổ sung vai trò hoặc nhóm để tránh tài khoản rơi khỏi luồng điều phối chuẩn.');
  }
  if (user.active_session_count >= 4) {
    recommendations.push('Rà soát các phiên đăng nhập mở lâu, ưu tiên thu hồi các phiên không còn cần thiết.');
  }
  if (!user.last_seen_at || dayjs(user.last_seen_at).isBefore(dayjs().subtract(30, 'day'))) {
    recommendations.push('Đánh giá lại nhu cầu sử dụng vì tài khoản đã ngủ đông hơn 30 ngày.');
  }
  if (!recommendations.length) {
    recommendations.push('Tài khoản đang ổn định, chỉ cần duy trì theo dõi định kỳ và kiểm tra nhật ký truy cập.');
  }
  return recommendations;
}

function AccessActivityList({
  items,
  emptyText,
}: {
  items: UserAccessActivityItem[];
  emptyText: string;
}) {
  if (!items.length) {
    return <Empty description={emptyText} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <List
      dataSource={items}
      renderItem={(item) => (
        <List.Item>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Space wrap>
              <Text strong>{item.target_user.full_name || item.target_user.username}</Text>
              <Tag color="blue">@{item.target_user.username}</Tag>
              <Tag color={strategyColor(item.strategy)}>{strategyLabel(item.strategy)}</Tag>
              <Tag>{dayjs(item.timestamp).format('DD/MM HH:mm')}</Tag>
            </Space>
            <Text type="secondary">
              {item.actor.full_name || item.actor.username || 'Hệ thống'} đã {item.summary.toLowerCase()}.
            </Text>
            {item.changed_fields.includes('roles') ? (
              <Text type="secondary">Vai trò: {describeAccessDelta(item.roles_before, item.roles_after)}</Text>
            ) : null}
            {item.changed_fields.includes('teams') ? (
              <Text type="secondary">Nhóm: {describeAccessDelta(item.teams_before, item.teams_after)}</Text>
            ) : null}
          </Space>
        </List.Item>
      )}
    />
  );
}

export default function UserControlCenter() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const lastSavedPreferenceKeyRef = useRef('');
  const focusUserId = Number(searchParams.get('focus_id') || searchParams.get('focus_user_id') || 0) || null;
  const focusSearch = searchParams.get('focus') || searchParams.get('search') || '';
  const { config, isLoading: preferencesLoading, saveConfig } = useUserPreferences(PAGES.ADMIN_USER_DIRECTORY);
  const normalizedPreferences = useMemo(
    () => normalizePreferences((config && typeof config === 'object' ? config : {}) as Record<string, unknown>),
    [config],
  );
  const focusDefaultsActive = Boolean(focusUserId || focusSearch);

  const [searchInputOverride, setSearchInputOverride] = useState<string | null>(null);
  const [filtersOverride, setFiltersOverride] = useState<AdminUserCenterFilters | null>(null);
  const [page, setPage] = useState(1);
  const [pageSizeOverride, setPageSizeOverride] = useState<number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [dismissedFocusUserId, setDismissedFocusUserId] = useState<number | null>(null);
  const [bulkAccessModalOpen, setBulkAccessModalOpen] = useState(false);
  const [bulkAccessStrategy, setBulkAccessStrategy] = useState<'add' | 'replace' | 'remove'>('add');
  const [bulkRoleIds, setBulkRoleIds] = useState<number[]>([]);
  const [bulkTeamIds, setBulkTeamIds] = useState<number[]>([]);
  const [accessDraftOverride, setAccessDraftOverride] = useState<{
    userId: number;
    role_ids: number[];
    team_ids: number[];
  } | null>(null);
  const { selectedIds, rowSelection, clearSelection } = useRowSelection<AdminUserDirectoryItem>();
  const searchInput = searchInputOverride ?? (focusDefaultsActive ? focusSearch : normalizedPreferences.search);
  const filters = filtersOverride ?? (focusDefaultsActive ? DEFAULT_FILTERS : normalizedPreferences.filters);
  const pageSize = pageSizeOverride ?? normalizedPreferences.pageSize;
  const selectedActivityUserId = selectedUserId ?? (focusUserId !== dismissedFocusUserId ? focusUserId : null);

  const updateSearchInput = useCallback((value: string) => {
    setSearchInputOverride(value);
    setPage(1);
  }, []);

  const updateFilters = useCallback(
    (
      next:
        | AdminUserCenterFilters
        | ((previous: AdminUserCenterFilters) => AdminUserCenterFilters),
    ) => {
      setFiltersOverride((previous) => {
        const current = previous ?? (focusDefaultsActive ? DEFAULT_FILTERS : normalizedPreferences.filters);
        return typeof next === 'function'
          ? (next as (previous: AdminUserCenterFilters) => AdminUserCenterFilters)(current)
          : next;
      });
      setPage(1);
    },
    [focusDefaultsActive, normalizedPreferences.filters],
  );

  const {
    intentSearch,
    intentFilters,
    intentFilterStableString,
  } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 250,
    serializeFilters,
    parseFilters,
  });

  useEffect(() => {
    const nextKey = JSON.stringify({
      search: intentSearch,
      pageSize,
      filters: parseFilters(intentFilterStableString),
    });
    if (nextKey === lastSavedPreferenceKeyRef.current) return;
    lastSavedPreferenceKeyRef.current = nextKey;
    void saveConfig({
      search: intentSearch,
      pageSize,
      filters: parseFilters(intentFilterStableString),
    }).catch(() => undefined);
  }, [intentFilterStableString, intentSearch, pageSize, saveConfig]);

  const listParams = useMemo(
    () => toDirectoryParams(intentSearch, intentFilters, page, pageSize),
    [intentFilters, intentSearch, page, pageSize],
  );
  const summaryParams = useMemo(
    () => toDirectoryParams(intentSearch, intentFilters),
    [intentFilters, intentSearch],
  );

  const listQuery = useQuery({
    queryKey: ['admin-user-directory', listParams],
    queryFn: () => usersApi.getDirectory(listParams),
    placeholderData: (previousData) => previousData,
    enabled: !preferencesLoading,
  });
  const summaryQuery = useQuery({
    queryKey: ['admin-user-directory-summary', summaryParams],
    queryFn: () => usersApi.getDirectorySummary(summaryParams),
    placeholderData: (previousData) => previousData,
    enabled: !preferencesLoading,
  });
  const rolesQuery = useQuery({
    queryKey: ['admin-user-directory-roles'],
    queryFn: usersApi.listRoles,
    staleTime: 5 * 60 * 1000,
  });
  const teamsQuery = useQuery({
    queryKey: ['admin-user-directory-teams'],
    queryFn: usersApi.listTeams,
    staleTime: 5 * 60 * 1000,
  });
  const accessActivityQuery = useQuery({
    queryKey: ['admin-user-access-activity'],
    queryFn: () => usersApi.getAccessActivity({ limit: 6 }),
    enabled: !preferencesLoading,
  });
  const selectedAccessActivityQuery = useQuery({
    queryKey: ['admin-user-access-activity', selectedActivityUserId],
    queryFn: () => usersApi.getAccessActivity({ user_id: selectedActivityUserId ?? undefined, limit: 8 }),
    enabled: Boolean(selectedActivityUserId),
  });

  const refreshDirectoryData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-user-directory'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-user-directory-summary'] }),
    ]);
  };

  const bulkActivateMutation = useMutation({
    mutationFn: usersApi.bulkActivate,
    onSuccess: async (result, variables) => {
      await refreshDirectoryData();
      clearSelection();
      const actionLabel = variables.is_active ? 'kich hoat' : 'tam ngung';
      const skippedSelfText = result.skipped_self ? `, bo qua ${result.skipped_self} tai khoan hien tai` : '';
      messageApi.success(`Da ${actionLabel} ${result.count} tai khoan${skippedSelfText}.`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const bulkLockMutation = useMutation({
    mutationFn: usersApi.bulkLock,
    onSuccess: async (result, variables) => {
      await refreshDirectoryData();
      clearSelection();
      const actionLabel = variables.is_locked ? 'khoa' : 'mo khoa';
      const skippedSelfText = result.skipped_self ? `, bo qua ${result.skipped_self} tai khoan hien tai` : '';
      messageApi.success(`Da ${actionLabel} ${result.count} tai khoan${skippedSelfText}.`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateAccessMutation = useMutation({
    mutationFn: ({ userId, payload }: { userId: number; payload: { role_ids: number[]; team_ids: number[] } }) =>
      usersApi.updateAccessProfile(userId, payload),
    onSuccess: async (result) => {
      setAccessDraftOverride({
        userId: result.user.id,
        role_ids: (result.user.roles ?? []).map((role) => role.id),
        team_ids: (result.user.teams ?? []).map((team) => team.id),
      });
      await refreshDirectoryData();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-user-access-activity'] }),
      ]);
      messageApi.success(result.changed_fields.length > 0 ? 'Đã cập nhật vai trò và nhóm cho người dùng.' : 'Không có thay đổi mới để lưu.');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const bulkAccessMutation = useMutation({
    mutationFn: usersApi.bulkAccess,
    onSuccess: async (result) => {
      await refreshDirectoryData();
      await queryClient.invalidateQueries({ queryKey: ['admin-user-access-activity'] });
      clearSelection();
      setBulkAccessModalOpen(false);
      setBulkAccessStrategy('add');
      setBulkRoleIds([]);
      setBulkTeamIds([]);
      const skippedSelfText = result.skipped_self ? `, bo qua ${result.skipped_self} tai khoan hien tai` : '';
      messageApi.success(`Da ap dung orchestration truy cap cho ${result.count} tai khoan${skippedSelfText}.`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const directoryItems = useMemo(() => listQuery.data?.results ?? [], [listQuery.data?.results]);
  const autoSelectedFocusUserId = useMemo(() => {
    if (!focusUserId || dismissedFocusUserId === focusUserId) return null;
    return directoryItems.some((item) => item.id === focusUserId) ? focusUserId : null;
  }, [directoryItems, dismissedFocusUserId, focusUserId]);
  const effectiveSelectedUserId = selectedUserId ?? autoSelectedFocusUserId;
  const selectedUser = useMemo(
    () => directoryItems.find((item) => item.id === effectiveSelectedUserId) ?? null,
    [directoryItems, effectiveSelectedUserId],
  );
  const summary = summaryQuery.data;
  const selectedUserAttention = useMemo(
    () => (selectedUser ? getAttentionReasons(selectedUser) : []),
    [selectedUser],
  );
  const accessJournalItems = accessActivityQuery.data?.items ?? [];
  const selectedAccessJournalItems = selectedAccessActivityQuery.data?.items ?? [];
  const sessionHotspotUsers = useMemo(
    () => [...directoryItems]
      .filter((item) => item.active_session_count >= 3)
      .sort((left, right) => right.active_session_count - left.active_session_count || (left.full_name || left.username).localeCompare(right.full_name || right.username))
      .slice(0, 5),
    [directoryItems],
  );
  const selectedUserRecommendations = useMemo(
    () => (selectedUser ? buildUserRecommendations(selectedUser) : []),
    [selectedUser],
  );

  const baseAccessDraft = useMemo(
    () => ({
      role_ids: (selectedUser?.roles ?? []).map((role) => role.id),
      team_ids: (selectedUser?.teams ?? []).map((team) => team.id),
    }),
    [selectedUser],
  );
  const accessDraft = useMemo(() => {
    if (selectedUser && accessDraftOverride?.userId === selectedUser.id) {
      return {
        role_ids: accessDraftOverride.role_ids,
        team_ids: accessDraftOverride.team_ids,
      };
    }
    return baseAccessDraft;
  }, [accessDraftOverride, baseAccessDraft, selectedUser]);

  const summaryHealthMessage = useMemo(() => {
    if (!summary) return 'Đang tải tổng quan điều phối người dùng.';
    if (summary.attention_users > 0) {
      return `${summary.attention_users}/${summary.total_users} tài khoản đang cần rà soát. Ưu tiên xử lý tài khoản bị khóa, tạm ngưng, ngủ đông hoặc chưa đủ vai trò và nhóm.`;
    }
    return 'Danh mục người dùng đang ổn định, chưa có tín hiệu cần can thiệp trong phạm vi bộ lọc hiện tại.';
  }, [summary]);

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) tags.push(`Từ khóa: ${intentSearch.trim()}`);
    if (intentFilters.status === 'active') tags.push('Chỉ hiện tài khoản đang hoạt động');
    if (intentFilters.status === 'inactive') tags.push('Chỉ hiện tài khoản tạm ngưng');
    if (intentFilters.lockState === 'locked') tags.push('Chỉ hiện tài khoản bị khóa');
    if (intentFilters.lockState === 'unlocked') tags.push('Chỉ hiện tài khoản đang mở');
    if (intentFilters.attention === 'review') tags.push('Ưu tiên rà soát');
    if (intentFilters.attention === 'unassigned') tags.push('Thiếu phân công');
    if (intentFilters.attention === 'locked') tags.push('Bị khóa');
    if (intentFilters.attention === 'inactive') tags.push('Tạm ngưng');
    if (intentFilters.attention === 'dormant') tags.push('Ngủ đông');
    if (intentFilters.sessionState === 'online') tags.push('Đang trực tuyến');
    if (intentFilters.sessionState === 'offline') tags.push('Đang ngoại tuyến');
    if (intentFilters.role) {
      const roleName = rolesQuery.data?.find((role) => role.id === intentFilters.role)?.name;
      tags.push(`Vai trò: ${roleName || intentFilters.role}`);
    }
    if (intentFilters.team) {
      const teamName = teamsQuery.data?.find((team) => team.id === intentFilters.team)?.name;
      tags.push(`Nhóm: ${teamName || intentFilters.team}`);
    }
    return tags;
  }, [intentFilters, intentSearch, rolesQuery.data, teamsQuery.data]);

  const accessRoleOptions = useMemo(() => {
    const optionMap = new Map<number, { label: string; value: number }>();
    (rolesQuery.data ?? []).forEach((role) => {
      optionMap.set(role.id, { label: role.name, value: role.id });
    });
    (selectedUser?.roles ?? []).forEach((role) => {
      if (!optionMap.has(role.id)) optionMap.set(role.id, { label: role.name, value: role.id });
    });
    return Array.from(optionMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [rolesQuery.data, selectedUser]);

  const accessTeamOptions = useMemo(() => {
    const optionMap = new Map<number, { label: string; value: number }>();
    (teamsQuery.data ?? []).forEach((team) => {
      optionMap.set(team.id, { label: team.name, value: team.id });
    });
    (selectedUser?.teams ?? []).forEach((team) => {
      if (!optionMap.has(team.id)) optionMap.set(team.id, { label: team.name, value: team.id });
    });
    return Array.from(optionMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [teamsQuery.data, selectedUser]);

  const accessDraftChanged = useMemo(() => {
    if (!selectedUser) return false;
    const currentRoleIds = [...baseAccessDraft.role_ids].sort((a, b) => a - b);
    const currentTeamIds = [...baseAccessDraft.team_ids].sort((a, b) => a - b);
    const draftRoleIds = [...accessDraft.role_ids].sort((a, b) => a - b);
    const draftTeamIds = [...accessDraft.team_ids].sort((a, b) => a - b);
    return JSON.stringify(currentRoleIds) !== JSON.stringify(draftRoleIds)
      || JSON.stringify(currentTeamIds) !== JSON.stringify(draftTeamIds);
  }, [accessDraft.role_ids, accessDraft.team_ids, baseAccessDraft.role_ids, baseAccessDraft.team_ids, selectedUser]);

  const columns: ColumnsType<AdminUserDirectoryItem> = [
    {
      title: 'Nguoi dung',
      key: 'user',
      width: 280,
      render: (_, record) => (
        <Space align="start" size={12}>
          <Avatar
            style={{
              background: record.is_locked ? '#ef4444' : '#1d4ed8',
              color: '#fff',
            }}
          >
            {getUserInitials(record)}
          </Avatar>
          <Space direction="vertical" size={2}>
            <Text strong>{record.full_name || record.username}</Text>
            <Text type="secondary">@{record.username}</Text>
            <Text type="secondary">{record.email || 'Chưa có email'}</Text>
          </Space>
        </Space>
      ),
    },
    {
      title: 'Vai trò và nhóm',
      key: 'coverage',
      width: 250,
      render: (_, record) => (
        <Space direction="vertical" size={8}>
          <div>
            <Text type="secondary">Vai trò</Text>
            <div>{renderCompactTags(record.roles ?? [], 'Chưa gán vai trò')}</div>
          </div>
          <div>
            <Text type="secondary">Nhóm</Text>
            <div>{renderCompactTags(record.teams ?? [], 'Chưa gán nhóm')}</div>
          </div>
        </Space>
      ),
    },
    {
      title: 'Tin hieu',
      key: 'signals',
      width: 220,
      render: (_, record) => {
        const reasons = getAttentionReasons(record);
        if (!reasons.length) return <Tag color="green">Ổn định</Tag>;
        return (
          <Space size={[6, 6]} wrap>
            {reasons.map((reason) => (
              <Tag key={`${record.id}-${reason}`} color={reasonColor(reason)}>
                {reason}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: 'Bao mat',
      key: 'security',
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text>Phien dang hoat dong: <strong>{record.active_session_count}</strong></Text>
          <Text type="secondary">Lan online cuoi: {formatDateTime(record.last_seen_at)}</Text>
          <Text type="secondary">IP cuối: {record.last_seen_ip || 'Chưa ghi nhận'}</Text>
        </Space>
      ),
    },
    {
      title: 'Trang thai',
      key: 'status',
      width: 170,
      render: (_, record) => (
        <Space size={[6, 6]} wrap>
          <Tag color={record.is_active ? 'green' : 'default'}>{record.is_active ? 'Hoạt động' : 'Tạm ngưng'}</Tag>
          <Tag color={record.is_locked ? 'red' : 'blue'}>{record.is_locked ? 'Bị khóa' : 'Đang mở'}</Tag>
          {record.is_staff ? <Tag color="purple">Nhân sự nội bộ</Tag> : null}
        </Space>
      ),
    },
    {
      title: 'Tac vu',
      key: 'actions',
      width: 130,
      fixed: 'right',
      render: (_, record) => (
        <Button type="link" onClick={() => openSelectedUser(record.id)}>
          Mở chi tiết
        </Button>
      ),
    },
  ];

  const runBulkActivate = async (ids: number[], isActive: boolean) => {
    if (!ids.length) return;
    await bulkActivateMutation.mutateAsync({ ids, is_active: isActive });
  };

  const runBulkLock = async (ids: number[], isLocked: boolean) => {
    if (!ids.length) return;
    await bulkLockMutation.mutateAsync({ ids, is_locked: isLocked });
  };

  const openSelectedUser = useCallback((userId: number) => {
    setSelectedUserId(userId);
    if (dismissedFocusUserId === userId) {
      setDismissedFocusUserId(null);
    }
  }, [dismissedFocusUserId]);

  const closeSelectedUser = useCallback(() => {
    if (effectiveSelectedUserId && effectiveSelectedUserId === focusUserId) {
      setDismissedFocusUserId(focusUserId);
    }
    setSelectedUserId(null);
  }, [effectiveSelectedUserId, focusUserId]);

  const updateAccessDraft = useCallback(
    (next: Partial<{ role_ids: number[]; team_ids: number[] }>) => {
      if (!effectiveSelectedUserId) return;
      setAccessDraftOverride({
        userId: effectiveSelectedUserId,
        role_ids: next.role_ids ?? accessDraft.role_ids,
        team_ids: next.team_ids ?? accessDraft.team_ids,
      });
    },
    [accessDraft.role_ids, accessDraft.team_ids, effectiveSelectedUserId],
  );

  const applyFocusPreset = (preset: 'dormant' | 'unassigned' | 'locked' | 'online' | 'clear') => {
    if (preset === 'clear') {
      updateSearchInput('');
      updateFilters(DEFAULT_FILTERS);
      return;
    }
    if (preset === 'online') {
      updateFilters((previous: AdminUserCenterFilters) => ({
        ...previous,
        sessionState: 'online',
      }));
      return;
    }
    updateFilters((previous: AdminUserCenterFilters) => ({
      ...previous,
      attention: preset,
      sessionState: previous.sessionState === 'online' ? 'all' : previous.sessionState,
    }));
  };

  const openFocusItem = (item: AdminUserDirectoryFocusItem) => {
    updateSearchInput(item.username);
    updateFilters((previous: AdminUserCenterFilters) => ({
      ...previous,
      attention: 'review',
    }));
  };

  const exportCurrentScope = () => {
    if (!directoryItems.length) {
      messageApi.warning('Chưa có tài khoản phù hợp để xuất CSV.');
      return;
    }
    downloadCSV(
      directoryItems.map((item) => ({
        'Tên người dùng': item.full_name || item.username,
        'Tên đăng nhập': item.username,
        Email: item.email || '',
        'Vai trò': (item.roles ?? []).map((role) => role.name || role.code).join(', '),
        'Nhóm': (item.teams ?? []).map((team) => team.name || team.code).join(', '),
        'Trạng thái hoạt động': item.is_active ? 'Hoạt động' : 'Tạm ngưng',
        'Trạng thái khóa': item.is_locked ? 'Bị khóa' : 'Đang mở',
        'Phiên hoạt động': item.active_session_count,
        'Lần online cuối': formatDateTime(item.last_seen_at),
        'IP cuối': item.last_seen_ip || '',
      })),
      'admin-user-control-center',
    );
    messageApi.success('Đã xuất CSV phạm vi người dùng hiện tại.');
  };

  const exportAccessActivity = () => {
    if (!accessJournalItems.length) {
      messageApi.warning('Chưa có nhật ký truy cập phù hợp để xuất CSV.');
      return;
    }
    downloadCSV(
      accessJournalItems.map((item) => ({
        'Thời điểm': formatDateTime(item.timestamp),
        'Người thực hiện': item.actor.full_name || item.actor.username || 'Hệ thống',
        'Người nhận tác động': item.target_user.full_name || item.target_user.username,
        'Chiến lược': strategyLabel(item.strategy),
        'Tóm tắt': item.summary,
        'Thay đổi vai trò': describeAccessDelta(item.roles_before, item.roles_after),
        'Thay đổi nhóm': describeAccessDelta(item.teams_before, item.teams_after),
      })),
      'admin-user-access-activity',
    );
    messageApi.success('Đã xuất CSV nhật ký điều phối truy cập.');
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {contextHolder}

      <PageHeader
        title="Trung tâm điều phối người dùng"
        subtitle="Điều hành tài khoản hệ thống, rà soát tín hiệu rủi ro và xử lý hàng loạt trong một trung tâm quản trị thống nhất."
        icon={<SafetyOutlined />}
        extra={(
          <Space wrap>
            <Tag color="blue">Trong phạm vi: {summary?.total_users ?? listQuery.data?.count ?? 0}</Tag>
            <Button icon={<HistoryOutlined />} onClick={() => navigate('/admin/module-permissions/history')}>
              Lịch sử RBAC
            </Button>
            <Button icon={<FilterOutlined />} onClick={() => navigate('/admin/module-permissions')}>
              Phân quyền phân hệ
            </Button>
            <Button icon={<DownloadOutlined />} onClick={exportCurrentScope}>
              Xuất CSV
            </Button>
            <Button
              icon={<ReloadOutlined />}
              loading={listQuery.isFetching || summaryQuery.isFetching}
              onClick={() => {
                void refreshDirectoryData();
              }}
            >
              Làm mới
            </Button>
          </Space>
        )}
      />

      {(focusUserId || focusSearch) ? (
        <Alert
          data-testid="admin-user-control-focus-banner"
          type={selectedUser ? 'info' : 'warning'}
          showIcon
          message={`Đang tập trung theo drilldown: ${focusSearch || `#${focusUserId}`}`}
          description={selectedUser
            ? 'Hồ sơ người dùng đã được mở sẵn để bạn kiểm tra trạng thái, phiên và orchestration truy cập.'
            : 'Bộ lọc danh bạ đang thu hẹp theo tín hiệu drilldown. Nếu chưa thấy hồ sơ, hãy kiểm tra phân trang hoặc điều kiện lọc hiện tại.'}
        />
      ) : null}

      <Alert
        type={summary && summary.attention_users > 0 ? 'warning' : 'success'}
        message={summary && summary.attention_users > 0 ? 'Có tài khoản cần ưu tiên xử lý ngay' : 'Nhịp quản trị người dùng đang ổn định'}
        description={summaryHealthMessage}
        showIcon
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <Card size="small" style={SUMMARY_TILE_STYLE}>
            <Statistic title="Tổng tài khoản" value={summary?.total_users ?? 0} prefix={<UserOutlined />} />
            <Text type="secondary">Phạm vi theo bộ lọc hiện tại.</Text>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card size="small" style={SUMMARY_TILE_STYLE}>
            <Statistic title="Cần rà soát" value={summary?.attention_users ?? 0} prefix={<ThunderboltOutlined />} />
            <Text type="secondary">Bị khóa, tạm ngưng, ngủ đông hoặc chưa đủ phân công.</Text>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card size="small" style={SUMMARY_TILE_STYLE}>
            <Statistic title="Đang trực tuyến" value={summary?.online_users ?? 0} prefix={<CheckCircleOutlined />} />
            <Text type="secondary">Số tài khoản đang có phiên hoạt động.</Text>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card size="small" style={SUMMARY_TILE_STYLE}>
            <Statistic title="Đang bị khóa" value={summary?.locked_users ?? 0} prefix={<LockOutlined />} />
            <Text type="secondary">Theo dõi nhanh các tài khoản nhạy cảm.</Text>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card
            size="small"
            title="Hàng chờ cần rà soát"
            extra={(
              <Space size={[8, 8]} wrap>
                <Tag color="volcano">Ngủ đông 30 ngày: {summary?.dormant_users ?? 0}</Tag>
                <Tag color="gold">Thiếu vai trò: {summary?.without_role_users ?? 0}</Tag>
              </Space>
            )}
            style={PANEL_STYLE}
          >
            {summary?.focus_items?.length ? (
              <List
                dataSource={summary.focus_items}
                renderItem={(item) => (
                  <List.Item
                    actions={[
                      <Button key={`focus-${item.id}`} type="link" onClick={() => openFocusItem(item)}>
                        Mở trong bảng
                      </Button>,
                    ]}
                  >
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Space wrap>
                        <Text strong>{item.full_name}</Text>
                        <Tag>@{item.username}</Tag>
                        <Tag color={item.severity === 'error' ? 'red' : 'orange'}>
                          {item.is_locked ? 'Bị khóa' : item.is_active ? 'Đang hoạt động' : 'Tạm ngưng'}
                        </Tag>
                      </Space>
                      <Space size={[6, 6]} wrap>
                        {item.reasons.map((reason) => (
                          <Tag key={`${item.id}-${reason}`}>{reason}</Tag>
                        ))}
                      </Space>
                      <Text type="secondary">
                        Lần online cuối: {formatDateTime(item.last_seen_at)} | Vai trò: {item.role_count} | Nhóm: {item.team_count}
                      </Text>
                    </Space>
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="Không có tài khoản cần rà soát trong phạm vi hiện tại" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small" style={PANEL_STYLE}>
              <Row gutter={[12, 12]}>
                <Col span={12}>
                  <Statistic title="Thiếu vai trò" value={summary?.without_role_users ?? 0} />
                </Col>
                <Col span={12}>
                  <Statistic title="Thiếu nhóm" value={summary?.without_team_users ?? 0} />
                </Col>
              </Row>
              <Divider style={{ margin: '14px 0' }} />
              <Row gutter={[12, 12]}>
                <Col span={12}>
                  <Statistic title="Tạm ngưng" value={summary?.inactive_users ?? 0} />
                </Col>
                <Col span={12}>
                  <Statistic title="Nhân sự nội bộ" value={summary?.staff_users ?? 0} />
                </Col>
              </Row>
            </Card>
            <Card size="small" title="Điểm nóng phiên đăng nhập" style={PANEL_STYLE}>
              {sessionHotspotUsers.length ? (
                <List
                  dataSource={sessionHotspotUsers}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key={`open-hotspot-${item.id}`} type="link" onClick={() => openSelectedUser(item.id)}>
                          Mở hồ sơ
                        </Button>,
                      ]}
                    >
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <Space wrap>
                          <Text strong>{item.full_name || item.username}</Text>
                          <Tag color="cyan">{item.active_session_count} phiên</Tag>
                          <Tag color={item.is_locked ? 'red' : 'blue'}>{item.is_locked ? 'Bị khóa' : 'Đang mở'}</Tag>
                        </Space>
                        <Text type="secondary">
                          Lần online cuối: {formatDateTime(item.last_seen_at)} | IP cuối: {item.last_seen_ip || 'Chưa ghi nhận'}
                        </Text>
                      </Space>
                    </List.Item>
                  )}
                />
              ) : (
                <Empty description="Chưa có tài khoản nào có áp lực phiên cao" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
            <BreakdownList title="Phân bổ vai trò" items={summary?.role_breakdown ?? []} accentColor="#2563eb" />
            <BreakdownList title="Dấu chân nhóm" items={summary?.team_breakdown ?? []} accentColor="#0f766e" />
          </Space>
        </Col>
      </Row>

      <Card
        size="small"
        title="Nhật ký điều phối truy cập"
        extra={(
          <Space size={[8, 8]} wrap>
            <Tag color="geekblue">7 ngày gần đây</Tag>
            <Button size="small" icon={<DownloadOutlined />} onClick={exportAccessActivity}>
              Xuất CSV
            </Button>
          </Space>
        )}
        style={PANEL_STYLE}
      >
        <AccessActivityList
          items={accessJournalItems}
          emptyText="Chưa có thay đổi truy cập nào trong thời gian gần đây."
        />
      </Card>

      <Card size="small" style={PANEL_STYLE}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space align="center" wrap>
            <Text strong>Preset lọc nhanh</Text>
            <Text type="secondary">Đưa bảng về đúng nhóm tài khoản cần hành động ngay.</Text>
          </Space>
          <Space size={[8, 8]} wrap>
            <Button onClick={() => applyFocusPreset('dormant')}>Ưu tiên ngủ đông</Button>
            <Button onClick={() => applyFocusPreset('unassigned')}>Thiếu phân công</Button>
            <Button onClick={() => applyFocusPreset('locked')}>Đang bị khóa</Button>
            <Button onClick={() => applyFocusPreset('online')}>Đang trực tuyến</Button>
            <Button onClick={() => applyFocusPreset('clear')}>Xóa preset</Button>
          </Space>
        </Space>
      </Card>

      <Card size="small" style={PANEL_STYLE}>
        <Row gutter={[12, 12]}>
          <Col xs={24} lg={8}>
            <div data-testid="admin-user-control-search">
              <Input
                value={searchInput}
                onChange={(event) => updateSearchInput(event.target.value)}
                allowClear
                placeholder="Tìm username, họ tên, email hoặc số điện thoại"
              />
            </div>
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Select
              value={filters.status}
              style={{ width: '100%' }}
              onChange={(value) => updateFilters((previous: AdminUserCenterFilters) => ({ ...previous, status: value }))}
              options={[
                { label: 'Tất cả trạng thái', value: 'all' },
                { label: 'Đang hoạt động', value: 'active' },
                { label: 'Tạm ngưng', value: 'inactive' },
              ]}
            />
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Select
              value={filters.lockState}
              style={{ width: '100%' }}
              onChange={(value) => updateFilters((previous: AdminUserCenterFilters) => ({ ...previous, lockState: value }))}
              options={[
                { label: 'Khóa và mở', value: 'all' },
                { label: 'Đang bị khóa', value: 'locked' },
                { label: 'Đang mở', value: 'unlocked' },
              ]}
            />
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Select
              value={filters.attention}
              style={{ width: '100%' }}
              onChange={(value) => updateFilters((previous: AdminUserCenterFilters) => ({ ...previous, attention: value }))}
              options={[
                { label: 'Tất cả ưu tiên', value: 'all' },
                { label: 'Cần rà soát', value: 'review' },
                { label: 'Thiếu phân công', value: 'unassigned' },
                { label: 'Đang bị khóa', value: 'locked' },
                { label: 'Tạm ngưng', value: 'inactive' },
                { label: 'Ngủ đông', value: 'dormant' },
              ]}
            />
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Select
              value={filters.sessionState}
              style={{ width: '100%' }}
              onChange={(value) => updateFilters((previous: AdminUserCenterFilters) => ({ ...previous, sessionState: value }))}
              options={[
                { label: 'Phiên bất kỳ', value: 'all' },
                { label: 'Đang trực tuyến', value: 'online' },
                { label: 'Đang ngoại tuyến', value: 'offline' },
              ]}
            />
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Select
              value={filters.role}
              allowClear
              style={{ width: '100%' }}
              placeholder="Lọc theo vai trò"
              onChange={(value) => updateFilters((previous: AdminUserCenterFilters) => ({ ...previous, role: value }))}
              options={(rolesQuery.data ?? []).map((role) => ({
                label: role.name,
                value: role.id,
              }))}
            />
          </Col>
          <Col xs={12} md={8} lg={4}>
            <Select
              value={filters.team}
              allowClear
              style={{ width: '100%' }}
              placeholder="Lọc theo nhóm"
              onChange={(value) => updateFilters((previous: AdminUserCenterFilters) => ({ ...previous, team: value }))}
              options={(teamsQuery.data ?? []).map((team) => ({
                label: team.name,
                value: team.id,
              }))}
            />
          </Col>
        </Row>

        {activeFilterTags.length > 0 ? (
          <Space size={[8, 8]} wrap style={{ marginTop: 14 }}>
            {activeFilterTags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Space>
        ) : null}
      </Card>

      {selectedIds.length > 0 ? (
        <Alert
          type="info"
          showIcon
          message={`Đang chọn ${selectedIds.length} tài khoản`}
          description="Áp dụng tác vụ hàng loạt để giảm thao tác lặp lại cho admin và đội vận hành."
          action={(
            <Space wrap>
              <Button type="primary" onClick={() => setBulkAccessModalOpen(true)}>
                Điều phối truy cập
              </Button>
              <Button onClick={() => void runBulkActivate(selectedIds, true)} loading={bulkActivateMutation.isPending}>
                Kích hoạt
              </Button>
              <Popconfirm
                title="Tạm ngưng các tài khoản đã chọn?"
                okText="Tạm ngưng"
                cancelText="Hủy"
                onConfirm={() => void runBulkActivate(selectedIds, false)}
              >
                <Button danger loading={bulkActivateMutation.isPending} icon={<PoweroffOutlined />}>
                  Tạm ngưng
                </Button>
              </Popconfirm>
              <Popconfirm
                title="Khóa các tài khoản đã chọn?"
                okText="Khoa"
                cancelText="Hủy"
                onConfirm={() => void runBulkLock(selectedIds, true)}
              >
                <Button danger loading={bulkLockMutation.isPending} icon={<LockOutlined />}>
                  Khóa
                </Button>
              </Popconfirm>
              <Button onClick={() => void runBulkLock(selectedIds, false)} loading={bulkLockMutation.isPending} icon={<UnlockOutlined />}>
                Mở khóa
              </Button>
            </Space>
          )}
        />
      ) : null}

      <Card size="small" style={PANEL_STYLE}>
        <Table
          rowKey="id"
          rowSelection={rowSelection}
          columns={columns}
          dataSource={directoryItems}
          loading={listQuery.isLoading}
          scroll={{ x: 1250 }}
          pagination={{
            current: page,
            pageSize,
            total: listQuery.data?.count ?? 0,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50', '100'],
            onChange: (nextPage, nextPageSize) => {
              if (nextPageSize !== pageSize) {
                setPageSizeOverride(nextPageSize);
                setPage(1);
                return;
              }
              setPage(nextPage);
            },
          }}
          locale={{
            emptyText: (
              <Empty
                description="Không có người dùng phù hợp với bộ lọc hiện tại"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          }}
          onRow={(record) => ({
            onClick: () => openSelectedUser(record.id),
          })}
        />
      </Card>

      <Modal
        title={`Điều phối truy cập cho ${selectedIds.length} tài khoản`}
        open={bulkAccessModalOpen}
        onCancel={() => setBulkAccessModalOpen(false)}
        onOk={() => {
          void bulkAccessMutation.mutateAsync({
            ids: selectedIds,
            strategy: bulkAccessStrategy,
            role_ids: bulkRoleIds,
            team_ids: bulkTeamIds,
          });
        }}
        confirmLoading={bulkAccessMutation.isPending}
        okText="Áp dụng"
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Lựa chọn cách áp dụng"
            description={bulkAccessStrategy === 'add'
              ? 'Thêm vai trò và nhóm đã chọn vào các tài khoản hiện có.'
              : bulkAccessStrategy === 'remove'
                ? 'Gỡ vai trò và nhóm đã chọn khỏi các tài khoản đang chọn.'
                : 'Thay thế toàn bộ vai trò và nhóm của các tài khoản bằng danh sách mới.'}
          />
          <div>
            <Text type="secondary">Chiến lược</Text>
            <Select
              value={bulkAccessStrategy}
              style={{ width: '100%', marginTop: 6 }}
              onChange={(value) => setBulkAccessStrategy(value)}
              options={[
                { label: 'Thêm vào', value: 'add' },
                { label: 'Thay thế toàn bộ', value: 'replace' },
                { label: 'Gỡ bỏ', value: 'remove' },
              ]}
            />
          </div>
          <div>
            <Text type="secondary">Vai trò</Text>
            <Select
              mode="multiple"
              value={bulkRoleIds}
              allowClear
              style={{ width: '100%', marginTop: 6 }}
              placeholder="Chọn vai trò"
              onChange={(value) => setBulkRoleIds(value)}
              options={(rolesQuery.data ?? []).map((role) => ({ label: role.name, value: role.id }))}
            />
          </div>
          <div>
            <Text type="secondary">Nhóm</Text>
            <Select
              mode="multiple"
              value={bulkTeamIds}
              allowClear
              style={{ width: '100%', marginTop: 6 }}
              placeholder="Chọn nhóm"
              onChange={(value) => setBulkTeamIds(value)}
              options={(teamsQuery.data ?? []).map((team) => ({ label: team.name, value: team.id }))}
            />
          </div>
        </Space>
      </Modal>

      <Drawer
        title={selectedUser ? `Hồ sơ điều phối: ${selectedUser.full_name || selectedUser.username}` : 'Hồ sơ điều phối'}
        width={520}
        open={Boolean(selectedUser)}
        onClose={closeSelectedUser}
      >
        {selectedUser ? (
          <div data-testid="admin-user-control-drawer">
          <Space direction="vertical" size={18} style={{ width: '100%' }}>
            <Card size="small" style={{ borderRadius: 16 }}>
              <Space align="start" size={14}>
                <Avatar size={56} style={{ background: selectedUser.is_locked ? '#ef4444' : '#1d4ed8' }}>
                  {getUserInitials(selectedUser)}
                </Avatar>
                <Space direction="vertical" size={2}>
                  <Title level={5} style={{ margin: 0 }}>
                    {selectedUser.full_name || selectedUser.username}
                  </Title>
                  <Text type="secondary">@{selectedUser.username}</Text>
                  <Text type="secondary">{selectedUser.email || 'Chưa có email'} | {selectedUser.phone || 'Chưa có số điện thoại'}</Text>
                </Space>
              </Space>
              <Divider />
              <Space size={[8, 8]} wrap>
                <Tag color={selectedUser.is_active ? 'green' : 'default'}>{selectedUser.is_active ? 'Hoạt động' : 'Tạm ngưng'}</Tag>
                <Tag color={selectedUser.is_locked ? 'red' : 'blue'}>{selectedUser.is_locked ? 'Bị khóa' : 'Đang mở'}</Tag>
                {selectedUser.is_staff ? <Tag color="purple">Nhân sự nội bộ</Tag> : null}
                <Tag color="cyan">Phiên đang hoạt động: {selectedUser.active_session_count}</Tag>
              </Space>
            </Card>

            <Row gutter={[12, 12]}>
              <Col span={8}>
                <Card size="small" style={{ borderRadius: 16 }}>
                  <Statistic title="Vai trò" value={selectedUser.role_count} />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small" style={{ borderRadius: 16 }}>
                  <Statistic title="Nhóm" value={selectedUser.team_count} />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small" style={{ borderRadius: 16 }}>
                  <Statistic title="Ngủ đông" value={!selectedUser.last_seen_at || dayjs(selectedUser.last_seen_at).isBefore(dayjs().subtract(30, 'day')) ? 1 : 0} />
                </Card>
              </Col>
            </Row>

            <Card size="small" title="Cảnh báo và rà soát" style={{ borderRadius: 16 }}>
              {selectedUserAttention.length > 0 ? (
                <Space size={[8, 8]} wrap>
                  {selectedUserAttention.map((reason) => (
                    <Tag key={`drawer-${reason}`} color={reasonColor(reason)}>
                      {reason}
                    </Tag>
                  ))}
                </Space>
              ) : (
                <Tag color="green">Không có tín hiệu bất thường</Tag>
              )}
            </Card>

            <Card size="small" title="Thông tin vận hành" style={{ borderRadius: 16 }}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Lần online cuối">{formatDateTime(selectedUser.last_seen_at)}</Descriptions.Item>
                <Descriptions.Item label="Lần đăng nhập cuối">{formatDateTime(selectedUser.last_login_at)}</Descriptions.Item>
                <Descriptions.Item label="IP cuối">{selectedUser.last_seen_ip || 'Chưa ghi nhận'}</Descriptions.Item>
                <Descriptions.Item label="Ngày tham gia">{formatDateTime(selectedUser.date_joined)}</Descriptions.Item>
              </Descriptions>
            </Card>

            <Card size="small" title="Vai trò và nhóm" style={{ borderRadius: 16 }}>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div>
                  <Text type="secondary">Vai trò</Text>
                  <div style={{ marginTop: 6 }}>{renderCompactTags(selectedUser.roles ?? [], 'Chưa gán vai trò')}</div>
                </div>
                <div>
                  <Text type="secondary">Nhóm</Text>
                  <div style={{ marginTop: 6 }}>{renderCompactTags(selectedUser.teams ?? [], 'Chưa gán nhóm')}</div>
                </div>
              </Space>
            </Card>

            <Card size="small" title="Điều phối truy cập" style={{ borderRadius: 16 }}>
              <Space direction="vertical" size={14} style={{ width: '100%' }}>
                <div>
                  <Text type="secondary">Cập nhật vai trò</Text>
                  <Select
                    mode="multiple"
                    value={accessDraft.role_ids}
                    allowClear
                    style={{ width: '100%', marginTop: 6 }}
                    placeholder="Chọn vai trò cho người dùng"
                    onChange={(value) => updateAccessDraft({ role_ids: value })}
                    options={accessRoleOptions}
                  />
                </div>
                <div>
                  <Text type="secondary">Cập nhật nhóm</Text>
                  <Select
                    mode="multiple"
                    value={accessDraft.team_ids}
                    allowClear
                    style={{ width: '100%', marginTop: 6 }}
                    placeholder="Chọn nhóm cho người dùng"
                    onChange={(value) => updateAccessDraft({ team_ids: value })}
                    options={accessTeamOptions}
                  />
                </div>
                <Alert
                  type="info"
                  showIcon
                  message="Điều phối an toàn"
                  description="Mọi thay đổi role/nhom se duoc ghi vao nhat ky truy cap de doi governance co the doi chieu sau nay."
                />
                <Button
                  type="primary"
                  disabled={!accessDraftChanged}
                  loading={updateAccessMutation.isPending}
                  onClick={() => {
                    if (!selectedUser) return;
                    void updateAccessMutation.mutateAsync({
                      userId: selectedUser.id,
                      payload: {
                        role_ids: accessDraft.role_ids,
                        team_ids: accessDraft.team_ids,
                      },
                    });
                  }}
                >
                  Lưu vai trò và nhóm
                </Button>
              </Space>
            </Card>

            <Card size="small" title="Khuyến nghị xử lý" style={{ borderRadius: 16 }}>
              <List
                size="small"
                dataSource={selectedUserRecommendations}
                renderItem={(item) => <List.Item>{item}</List.Item>}
              />
            </Card>

            <Card size="small" title="Nhật ký truy cập của người dùng" style={{ borderRadius: 16 }}>
              <AccessActivityList
                items={selectedAccessJournalItems}
                emptyText="Chưa có thay đổi truy cập nào cho người dùng này."
              />
            </Card>

            <Card size="small" title="Tác vụ nhanh" style={{ borderRadius: 16 }}>
              <Space wrap>
                {selectedUser.is_active ? (
                  <Popconfirm
                    title="Tạm ngưng tài khoản này?"
                    okText="Tạm ngưng"
                    cancelText="Hủy"
                    onConfirm={() => void runBulkActivate([selectedUser.id], false)}
                  >
                    <Button danger icon={<PoweroffOutlined />} loading={bulkActivateMutation.isPending}>
                      Tạm ngưng
                    </Button>
                  </Popconfirm>
                ) : (
                  <Button onClick={() => void runBulkActivate([selectedUser.id], true)} loading={bulkActivateMutation.isPending}>
                    Kích hoạt
                  </Button>
                )}
                {selectedUser.is_locked ? (
                  <Button onClick={() => void runBulkLock([selectedUser.id], false)} icon={<UnlockOutlined />} loading={bulkLockMutation.isPending}>
                    Mở khóa
                  </Button>
                ) : (
                  <Popconfirm
                    title="Khóa tài khoản này?"
                    okText="Khóa"
                    cancelText="Hủy"
                    onConfirm={() => void runBulkLock([selectedUser.id], true)}
                  >
                    <Button danger icon={<LockOutlined />} loading={bulkLockMutation.isPending}>
                      Khóa tài khoản
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            </Card>
          </Space>
          </div>
        ) : null}
      </Drawer>
    </Space>
  );
}
