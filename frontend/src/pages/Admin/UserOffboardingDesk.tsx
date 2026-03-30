import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  List,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  DownloadOutlined,
  EyeOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';

import PageHeader from '../../components/PageHeader/PageHeader';
import { adminApi } from '../../api/admin';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { getToastMessage } from '../../shared/apiError';
import type { UserOffboardingPreviewResponse, UserOffboardingResponse } from '../../types/admin';
import { downloadCSV } from '../../utils/csvExport';
import { PAGES } from '../../utils/constants';

const { Text } = Typography;

type OffboardingFormValues = {
  user_id?: number;
  transfer_task_owner_id?: number;
  deactivate_account: boolean;
  lock_account: boolean;
  revoke_access: boolean;
  revoke_sessions: boolean;
};

type WatchlistStateFilter = 'all' | 'session-cleanup' | 'task-handoff' | 'access-retained' | 'ready';
type ActivityFilter = 'all' | 'access' | 'transfer' | 'sessions';
type OffboardingFilterSnapshot = {
  watchlist_search: string;
  watchlist_state: WatchlistStateFilter;
  activity_search: string;
  activity_filter: ActivityFilter;
};
type OffboardingNamedPreset = {
  id: string;
  name: string;
  filters: OffboardingFilterSnapshot;
};

const HERO_CARD_STYLE: CSSProperties = {
  borderRadius: 22,
  border: '1px solid #efe1d0',
  background: 'linear-gradient(180deg, #fffdf7 0%, #fff6eb 100%)',
  boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
};

const PANEL_STYLE: CSSProperties = {
  borderRadius: 22,
  border: '1px solid #e2e8f0',
  boxShadow: '0 14px 36px rgba(15, 23, 42, 0.06)',
};

const WATCHLIST_STATE_COLORS: Record<string, string> = {
  'session-cleanup': 'red',
  'task-handoff': 'gold',
  'access-retained': 'orange',
  ready: 'green',
};

const WATCHLIST_STATE_LABELS: Record<Exclude<WatchlistStateFilter, 'all'>, string> = {
  'session-cleanup': 'Thu hồi phiên',
  'task-handoff': 'Bàn giao đầu việc',
  'access-retained': 'Còn giữ quyền',
  ready: 'Ổn định',
};

const ACTIVITY_FILTER_LABELS: Record<Exclude<ActivityFilter, 'all'>, string> = {
  sessions: 'Thu hồi phiên',
  transfer: 'Chuyển đầu việc',
  access: 'Thu hồi quyền',
};

const CHECK_STATUS_COLORS: Record<string, string> = {
  ready: 'green',
  warning: 'gold',
  blocked: 'red',
  info: 'blue',
};

function formatDateTime(value?: string | null): string {
  if (!value) return 'Chưa ghi nhận';
  return dayjs(value).format('DD/MM/YYYY HH:mm');
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function buildOffboardingRecommendations(
  state: string,
  openTasks: number,
  activeSessions: number,
  roles: number,
): string[] {
  if (state === 'session-cleanup') {
    return [
      `Thu hồi ${activeSessions} phiên còn mở trước khi bàn giao tài khoản.`,
      'Xác nhận các phiên API hoặc thiết bị đăng nhập lâu ngày đã bị vô hiệu hóa.',
    ];
  }
  if (state === 'task-handoff') {
    return [
      `Chuyển ${openTasks} đầu việc đang mở sang owner mới trước khi khóa tài khoản.`,
      'Kiểm tra các đầu việc chặn và quá hạn để tránh đứt luồng vận hành.',
    ];
  }
  if (state === 'access-retained') {
    return [
      `Rút quyền đang còn giữ trên ${roles} vai trò/nhóm trước khi chốt offboarding.`,
      'Kiểm tra lại quyền nhạy cảm và đảm bảo audit đã ghi nhận đầy đủ.',
    ];
  }
  return [
    'Không còn tín hiệu rủi ro lớn, chỉ cần hoàn tất checklist offboarding chuẩn.',
    'Lưu lại dấu vết bàn giao công việc và trạng thái khóa tài khoản.',
  ];
}

function SummaryCard({ title, value, tint }: { title: string; value: number | string; tint: string }) {
  return (
    <Card style={HERO_CARD_STYLE} bodyStyle={{ padding: 18 }}>
      <Statistic title={title} value={value} valueStyle={{ color: tint, fontWeight: 700 }} />
    </Card>
  );
}

function renderCompactTags(items: Array<{ id: number; code: string; name: string }>, emptyLabel: string) {
  if (!items.length) return <Tag>{emptyLabel}</Tag>;
  return (
    <Space size={[6, 6]} wrap>
      {items.map((item) => (
        <Tag key={`${item.id}-${item.code}`}>{item.name || item.code}</Tag>
      ))}
    </Space>
  );
}

export default function UserOffboardingDesk() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const focusUserId = Number(searchParams.get('focus_user_id') || 0) || null;
  const focusSearch = searchParams.get('focus') || searchParams.get('search') || '';
  const [previewData, setPreviewData] = useState<UserOffboardingPreviewResponse | null>(null);
  const [result, setResult] = useState<UserOffboardingResponse | null>(null);
  const [watchlistSearch, setWatchlistSearch] = useState(focusSearch);
  const [watchlistState, setWatchlistState] = useState<WatchlistStateFilter>('all');
  const [activitySearch, setActivitySearch] = useState(focusSearch);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [selectedViewPresetId, setSelectedViewPresetId] = useState('NONE');
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const [selectedWatchlistUserId, setSelectedWatchlistUserId] = useState<number | null>(null);
  const [dismissedFocusWatchlistId, setDismissedFocusWatchlistId] = useState<number | null>(null);
  const focusHandledRef = useRef(false);
  const [form] = Form.useForm<OffboardingFormValues>();
  const selectedUserId = Form.useWatch('user_id', form);
  const transferTaskOwnerId = Form.useWatch('transfer_task_owner_id', form);
  const deactivateAccount = Form.useWatch('deactivate_account', form);
  const lockAccount = Form.useWatch('lock_account', form);
  const revokeAccess = Form.useWatch('revoke_access', form);
  const revokeSessions = Form.useWatch('revoke_sessions', form);
  const watchlistSearchValue = useMemo(() => normalizeSearch(watchlistSearch), [watchlistSearch]);
  const activitySearchValue = useMemo(() => normalizeSearch(activitySearch), [activitySearch]);
  const { config: savedConfig, saveConfig } = useUserPreferences(PAGES.ADMIN_USER_LIFECYCLE);
  const namedPresets = useMemo(() => {
    const raw = savedConfig?.saved_views;
    if (!Array.isArray(raw)) return [] as OffboardingNamedPreset[];
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id : '';
        const name = typeof record.name === 'string' ? record.name : '';
        const filters = record.filters;
        if (!id || !name || !filters || typeof filters !== 'object') return null;
        const filterRecord = filters as Record<string, unknown>;
        const watchlistStateValue = filterRecord.watchlist_state;
        const activityFilterValue = filterRecord.activity_filter;
        if (
          watchlistStateValue !== 'all'
          && watchlistStateValue !== 'session-cleanup'
          && watchlistStateValue !== 'task-handoff'
          && watchlistStateValue !== 'access-retained'
          && watchlistStateValue !== 'ready'
        ) {
          return null;
        }
        if (
          activityFilterValue !== 'all'
          && activityFilterValue !== 'access'
          && activityFilterValue !== 'transfer'
          && activityFilterValue !== 'sessions'
        ) {
          return null;
        }
        return {
          id,
          name,
          filters: {
            watchlist_search: typeof filterRecord.watchlist_search === 'string' ? filterRecord.watchlist_search : '',
            watchlist_state: watchlistStateValue,
            activity_search: typeof filterRecord.activity_search === 'string' ? filterRecord.activity_search : '',
            activity_filter: activityFilterValue,
          },
        } as OffboardingNamedPreset;
      })
      .filter((item): item is OffboardingNamedPreset => item !== null);
  }, [savedConfig?.saved_views]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId]
  );

  const workspaceQuery = useQuery({
    queryKey: ['admin-user-offboarding-workspace'],
    queryFn: adminApi.getUserOffboardingWorkspace,
  });
  const activityQuery = useQuery({
    queryKey: ['admin-user-offboarding-activity'],
    queryFn: () => adminApi.getUserOffboardingActivity({ limit: 40 }),
  });

  useEffect(() => {
    if (!workspaceQuery.data) return;
    if (!form.getFieldValue('user_id') && workspaceQuery.data.candidates.length > 0) {
      form.setFieldsValue({
        user_id: workspaceQuery.data.candidates[0].id,
        deactivate_account: workspaceQuery.data.policy.default_deactivate_account,
        lock_account: workspaceQuery.data.policy.default_lock_account,
        revoke_access: workspaceQuery.data.policy.default_revoke_access,
        revoke_sessions: workspaceQuery.data.policy.default_revoke_sessions,
      });
    }
  }, [form, workspaceQuery.data]);

  useEffect(() => {
    if (!selectedUserId) return;
    const transferTarget = form.getFieldValue('transfer_task_owner_id');
    if (transferTarget && transferTarget === selectedUserId) {
      form.setFieldValue('transfer_task_owner_id', undefined);
    }
  }, [form, selectedUserId]);

  const invalidateLifecycle = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-user-offboarding-workspace'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-user-offboarding-activity'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-user-directory'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-user-directory-summary'] }),
    ]);
  };

  const previewMutation = useMutation({
    mutationFn: adminApi.previewUserOffboarding,
    onSuccess: (response) => {
      setPreviewData(response);
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Khong the preview offboarding.')),
  });

  const applyMutation = useMutation({
    mutationFn: adminApi.offboardUser,
    onSuccess: async (response) => {
      setResult(response);
      setPreviewData(null);
      await invalidateLifecycle();
      messageApi.success('Đã áp dụng xử lý vòng đời cho tài khoản.');
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Khong the offboard user.')),
  });

  const candidateOptions = useMemo(
    () => (workspaceQuery.data?.candidates ?? []).map((item) => ({
      value: item.id,
      label: `${item.full_name} (${item.username})`,
    })),
    [workspaceQuery.data?.candidates],
  );
  const transferOptions = useMemo(
    () => (workspaceQuery.data?.candidates ?? [])
      .filter((item) => item.id !== selectedUserId && item.is_active && !item.is_locked)
      .map((item) => ({
        value: item.id,
        label: `${item.full_name} (${item.username})`,
      })),
    [selectedUserId, workspaceQuery.data?.candidates],
  );
  const filteredWatchlist = useMemo(
    () =>
      (workspaceQuery.data?.watchlist ?? []).filter((item) => {
        const searchTarget = normalizeSearch([
          item.full_name,
          item.username,
          item.email,
          item.summary,
          item.state_label,
        ].join(' '));
        const matchesSearch = !watchlistSearchValue || searchTarget.includes(watchlistSearchValue);
        const matchesState = watchlistState === 'all' || item.state === watchlistState;
        return matchesSearch && matchesState;
      }),
    [watchlistSearchValue, watchlistState, workspaceQuery.data?.watchlist],
  );
  const filteredActivity = useMemo(
    () =>
      (activityQuery.data?.items ?? []).filter((item) => {
        const searchTarget = normalizeSearch([
          item.summary,
          item.entity_code,
          item.actor.full_name,
          item.actor.username,
          item.cleanup.transfer_target_username,
        ].join(' '));
        const matchesSearch = !activitySearchValue || searchTarget.includes(activitySearchValue);
        const matchesFilter =
          activityFilter === 'all'
          || (activityFilter === 'access' && item.cleanup.revoke_access)
          || (activityFilter === 'transfer' && item.cleanup.tasks_transferred_count > 0)
          || (activityFilter === 'sessions' && item.cleanup.sessions_revoked_count > 0);
        return matchesSearch && matchesFilter;
      }),
    [activityFilter, activityQuery.data?.items, activitySearchValue],
  );
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (watchlistSearch.trim()) tags.push(`Watchlist: ${watchlistSearch.trim()}`);
    if (watchlistState !== 'all') tags.push(`Trạng thái watchlist: ${WATCHLIST_STATE_LABELS[watchlistState]}`);
    if (activitySearch.trim()) tags.push(`Hoạt động: ${activitySearch.trim()}`);
    if (activityFilter !== 'all') tags.push(`Bộ lọc activity: ${ACTIVITY_FILTER_LABELS[activityFilter]}`);
    if (selectedViewPreset) tags.push(`Mẫu đang dùng: ${selectedViewPreset.name}`);
    return tags;
  }, [activityFilter, activitySearch, selectedViewPreset, watchlistSearch, watchlistState]);

  const buildCurrentSnapshot = (): OffboardingFilterSnapshot => ({
    watchlist_search: watchlistSearch,
    watchlist_state: watchlistState,
    activity_search: activitySearch,
    activity_filter: activityFilter,
  });

  const applySnapshot = (snapshot: OffboardingFilterSnapshot) => {
    setWatchlistSearch(snapshot.watchlist_search);
    setWatchlistState(snapshot.watchlist_state);
    setActivitySearch(snapshot.activity_search);
    setActivityFilter(snapshot.activity_filter);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...savedConfig,
        ...buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem offboarding.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem offboarding.');
    }
  };

  const applySavedView = () => {
    const snapshot: OffboardingFilterSnapshot = {
      watchlist_search: typeof savedConfig?.watchlist_search === 'string' ? savedConfig.watchlist_search : '',
      watchlist_state: savedConfig?.watchlist_state === 'session-cleanup'
        || savedConfig?.watchlist_state === 'task-handoff'
        || savedConfig?.watchlist_state === 'access-retained'
        || savedConfig?.watchlist_state === 'ready'
        ? savedConfig.watchlist_state
        : 'all',
      activity_search: typeof savedConfig?.activity_search === 'string' ? savedConfig.activity_search : '',
      activity_filter: savedConfig?.activity_filter === 'access'
        || savedConfig?.activity_filter === 'transfer'
        || savedConfig?.activity_filter === 'sessions'
        ? savedConfig.activity_filter
        : 'all',
    };
    applySnapshot(snapshot);
    messageApi.success('Đã khôi phục chế độ xem offboarding đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = viewPresetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: OffboardingNamedPreset = existing
      ? { ...existing, name, filters: currentSnapshot }
      : { id: `${Date.now()}`, name, filters: currentSnapshot };
    const nextPresets = existing
      ? namedPresets.map((item) => (item.id === existing.id ? nextPreset : item))
      : [...namedPresets, nextPreset];
    try {
      await saveConfig({
        ...savedConfig,
        ...currentSnapshot,
        saved_views: nextPresets,
      });
      setSelectedViewPresetId(nextPreset.id);
      setViewPresetName('');
      setIsViewPresetModalOpen(false);
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc offboarding.' : 'Đã lưu mẫu lọc offboarding mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc offboarding.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc offboarding.');
      return;
    }
    applySnapshot(preset.filters);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc offboarding để xóa.');
      return;
    }
    const nextPresets = namedPresets.filter((item) => item.id !== preset.id);
    try {
      await saveConfig({
        ...savedConfig,
        ...buildCurrentSnapshot(),
        saved_views: nextPresets,
      });
      setSelectedViewPresetId('NONE');
      messageApi.success(`Đã xóa mẫu lọc "${preset.name}".`);
    } catch {
      messageApi.error('Không thể xóa mẫu lọc offboarding.');
    }
  };
  const focusedWatchlistUserId = useMemo(() => {
    if (!workspaceQuery.data || (!focusUserId && !focusSearch)) return null;
    const normalizedFocus = normalizeSearch(focusSearch);
    const matched = (workspaceQuery.data.watchlist ?? []).find((item) => {
      if (focusUserId && item.id === focusUserId) return true;
      if (!normalizedFocus) return false;
      return normalizeSearch([item.username, item.full_name, item.email].join(' ')).includes(normalizedFocus);
    });
    if (!matched) return null;
    return dismissedFocusWatchlistId === matched.id ? null : matched.id;
  }, [dismissedFocusWatchlistId, focusSearch, focusUserId, workspaceQuery.data]);
  const effectiveSelectedWatchlistUserId = selectedWatchlistUserId ?? focusedWatchlistUserId;
  const selectedWatchlistItem = filteredWatchlist.find((item) => item.id === effectiveSelectedWatchlistUserId)
    ?? (workspaceQuery.data?.watchlist ?? []).find((item) => item.id === effectiveSelectedWatchlistUserId)
    ?? null;

  useEffect(() => {
    if (focusHandledRef.current || !workspaceQuery.data) return;
    if (!focusUserId && !focusSearch) {
      focusHandledRef.current = true;
      return;
    }
    if (focusUserId && (workspaceQuery.data.candidates ?? []).some((item) => item.id === focusUserId)) {
      form.setFieldValue('user_id', focusUserId);
    }
    focusHandledRef.current = true;
  }, [focusSearch, focusUserId, form, workspaceQuery.data]);

  const openWatchlistItem = (userId: number) => {
    setSelectedWatchlistUserId(userId);
    if (dismissedFocusWatchlistId === userId) {
      setDismissedFocusWatchlistId(null);
    }
  };

  const closeWatchlistDrawer = () => {
    if (focusedWatchlistUserId && focusedWatchlistUserId === effectiveSelectedWatchlistUserId) {
      setDismissedFocusWatchlistId(focusedWatchlistUserId);
    }
    setSelectedWatchlistUserId(null);
  };

  const buildPreviewPayload = useCallback(() => {
    if (!selectedUserId) return null;
    return {
      user_id: selectedUserId,
      transfer_task_owner_id: transferTaskOwnerId,
      deactivate_account: deactivateAccount ?? workspaceQuery.data?.policy.default_deactivate_account ?? true,
      lock_account: lockAccount ?? workspaceQuery.data?.policy.default_lock_account ?? true,
      revoke_access: revokeAccess ?? workspaceQuery.data?.policy.default_revoke_access ?? true,
      revoke_sessions: revokeSessions ?? workspaceQuery.data?.policy.default_revoke_sessions ?? true,
    };
  }, [
    deactivateAccount,
    lockAccount,
    revokeAccess,
    revokeSessions,
    selectedUserId,
    transferTaskOwnerId,
    workspaceQuery.data?.policy.default_deactivate_account,
    workspaceQuery.data?.policy.default_lock_account,
    workspaceQuery.data?.policy.default_revoke_access,
    workspaceQuery.data?.policy.default_revoke_sessions,
  ]);

  useEffect(() => {
    if (!workspaceQuery.data) return;
    const payload = buildPreviewPayload();
    if (!payload || previewMutation.isPending) return;
    previewMutation.mutate(payload);
  }, [
    deactivateAccount,
    lockAccount,
    previewMutation,
    revokeAccess,
    revokeSessions,
    selectedUserId,
    transferTaskOwnerId,
    buildPreviewPayload,
    workspaceQuery.data,
  ]);

  const handlePreview = async () => {
    const values = await form.validateFields();
    if (!values.user_id) return;
    previewMutation.mutate({
      user_id: values.user_id,
      transfer_task_owner_id: values.transfer_task_owner_id,
      deactivate_account: values.deactivate_account,
      lock_account: values.lock_account,
      revoke_access: values.revoke_access,
      revoke_sessions: values.revoke_sessions,
    });
  };

  const handleApply = async () => {
    const values = await form.validateFields();
    if (!values.user_id) return;
    applyMutation.mutate({
      user_id: values.user_id,
      transfer_task_owner_id: values.transfer_task_owner_id,
      deactivate_account: values.deactivate_account,
      lock_account: values.lock_account,
      revoke_access: values.revoke_access,
      revoke_sessions: values.revoke_sessions,
    });
  };

  const focusUser = (userId: number) => {
    form.setFieldValue('user_id', userId);
    openWatchlistItem(userId);
    setResult(null);
    messageApi.success('Đã đưa tài khoản vào bàn xử lý offboarding.');
  };

  const exportWatchlist = () => {
    if (!filteredWatchlist.length) {
      messageApi.warning('Chưa có tài khoản nào trong danh sách ưu tiên để xuất CSV.');
      return;
    }
    downloadCSV(
      filteredWatchlist.map((item) => ({
        'Tài khoản': item.username,
        'Họ tên': item.full_name,
        Email: item.email,
        'Trạng thái': item.state_label,
        'Phiên đang mở': item.active_session_count,
        'Đầu việc đang mở': item.open_task_count,
        'Vai trò còn giữ': item.role_count,
        'Nhóm còn giữ': item.team_count,
        'Tài khoản hoạt động': item.is_active ? 'Có' : 'Không',
        'Tài khoản đã khóa': item.is_locked ? 'Có' : 'Không',
      })),
      'user-offboarding-watchlist',
    );
  };

  const exportActivity = () => {
    if (!filteredActivity.length) {
      messageApi.warning('Chưa có hoạt động offboarding phù hợp để xuất CSV.');
      return;
    }
    downloadCSV(
      filteredActivity.map((item) => ({
        'Thời điểm': formatDateTime(item.timestamp),
        'Mã tài khoản': item.entity_code,
        'Tóm tắt': item.summary,
        'Người thao tác': item.actor.full_name || item.actor.username || 'Hệ thống',
        'Số đầu việc chuyển': item.cleanup.tasks_transferred_count,
        'Số phiên đã thu hồi': item.cleanup.sessions_revoked_count,
        'Đã thu hồi quyền': item.cleanup.revoke_access ? 'Có' : 'Không',
        'Người nhận bàn giao': item.cleanup.transfer_target_username || '',
      })),
      'user-offboarding-activity',
    );
  };

  return (
    <>
      {contextHolder}
      <PageHeader
        title="Bàn kết thúc vòng đời tài khoản"
        subtitle="Khóa vòng đời tài khoản theo chuẩn thu hồi phiên, bàn giao đầu việc và rút quyền có audit."
        extra={[
          <Button
            key="reload"
            icon={<ReloadOutlined />}
            loading={workspaceQuery.isFetching || activityQuery.isFetching}
            onClick={() => {
              void invalidateLifecycle();
            }}
          >
            Làm mới
          </Button>,
        ]}
      />

      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        {(focusUserId || focusSearch) ? (
          <Alert
            data-testid="user-offboarding-focus-banner"
            type={selectedWatchlistItem ? 'info' : 'warning'}
            showIcon
            message={`Đang tập trung theo drilldown: ${focusSearch || `#${focusUserId}`}`}
            description={selectedWatchlistItem
              ? 'Hồ sơ cần xử lý đã được mở sẵn để bạn tiếp tục bàn giao, thu hồi phiên và rút quyền.'
              : 'Biểu mẫu và bộ lọc đã được thu hẹp theo tài khoản drilldown. Nếu chưa thấy trong watchlist, bạn vẫn có thể thao tác trực tiếp trên biểu mẫu offboarding.'}
          />
        ) : null}
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12} xl={6}>
            <SummaryCard title="Hàng chờ rà soát" value={workspaceQuery.data?.summary.review_queue ?? 0} tint="#dc2626" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <SummaryCard title="Thu hồi phiên" value={workspaceQuery.data?.summary.session_cleanup ?? 0} tint="#f59e0b" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <SummaryCard title="Bàn giao đầu việc" value={workspaceQuery.data?.summary.task_handoffs ?? 0} tint="#1677ff" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <SummaryCard title="Còn giữ quyền" value={workspaceQuery.data?.summary.access_retained ?? 0} tint="#7c3aed" />
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24}>
            <Card
              data-testid="user-offboarding-command-strip"
              style={PANEL_STYLE}
              bodyStyle={{ padding: 18 }}
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <div data-testid="user-offboarding-command-watchlist-search">
                    <Input.Search
                      allowClear
                      placeholder="Tìm watchlist theo tài khoản, email hoặc trạng thái"
                      value={watchlistSearch}
                      onChange={(event) => setWatchlistSearch(event.target.value)}
                      style={{ width: 270 }}
                    />
                  </div>
                  <Select<WatchlistStateFilter>
                    value={watchlistState}
                    onChange={setWatchlistState}
                    style={{ width: 180 }}
                    options={[
                      { value: 'all', label: 'Mọi trạng thái' },
                      { value: 'session-cleanup', label: 'Thu hồi phiên' },
                      { value: 'task-handoff', label: 'Bàn giao đầu việc' },
                      { value: 'access-retained', label: 'Còn giữ quyền' },
                      { value: 'ready', label: 'Ổn định' },
                    ]}
                  />
                  <Input.Search
                    allowClear
                    placeholder="Tìm activity theo tóm tắt, người thao tác hoặc tài khoản"
                    value={activitySearch}
                    onChange={(event) => setActivitySearch(event.target.value)}
                    style={{ width: 280 }}
                  />
                  <Select<ActivityFilter>
                    value={activityFilter}
                    onChange={setActivityFilter}
                    style={{ width: 180 }}
                    options={[
                      { value: 'all', label: 'Mọi hoạt động' },
                      { value: 'sessions', label: 'Thu hồi phiên' },
                      { value: 'transfer', label: 'Chuyển đầu việc' },
                      { value: 'access', label: 'Thu hồi quyền' },
                    ]}
                  />
                </div>
                <Space wrap>
                  <Button data-testid="user-offboarding-save-view" onClick={() => void saveCurrentView()}>
                    Lưu chế độ xem
                  </Button>
                  <Button data-testid="user-offboarding-restore-view" onClick={applySavedView}>
                    Khôi phục
                  </Button>
                  <Button
                    data-testid="user-offboarding-open-preset-modal"
                    onClick={() => setIsViewPresetModalOpen(true)}
                  >
                    Tạo mẫu lọc
                  </Button>
                  <div data-testid="user-offboarding-preset-select">
                    <Select
                      value={selectedViewPresetId}
                      onChange={setSelectedViewPresetId}
                      style={{ width: 240 }}
                      options={[
                        { value: 'NONE', label: 'Chọn mẫu offboarding' },
                        ...namedPresets.map((preset) => ({ value: preset.id, label: preset.name })),
                      ]}
                    />
                  </div>
                  <Button data-testid="user-offboarding-apply-preset" onClick={applyNamedPreset}>
                    Áp dụng mẫu
                  </Button>
                  <Button
                    danger
                    data-testid="user-offboarding-delete-preset"
                    disabled={!selectedViewPreset}
                    onClick={() => void deleteNamedPreset()}
                  >
                    Xóa mẫu
                  </Button>
                </Space>
                {activeFilterTags.length ? (
                  <Space size={[6, 6]} wrap>
                    {activeFilterTags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </Space>
                ) : null}
              </Space>
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={11}>
            <Card title="Thiết kế kết thúc vòng đời" style={PANEL_STYLE}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Alert
                  type="info"
                  showIcon
                  message="Chính sách vòng đời"
                  description={workspaceQuery.data?.policy.require_task_handoff
                    ? 'Nếu tài khoản còn đầu việc đang mở, hệ thống sẽ yêu cầu chọn owner mới trước khi áp dụng.'
                    : 'Đầu việc đang mở có thể tạm thời giữ nguyên trên tài khoản.'}
                />

                <Form<OffboardingFormValues> form={form} layout="vertical">
                  <Row gutter={[12, 12]}>
                    <Col span={24}>
                      <Form.Item label="Tài khoản cần xử lý" name="user_id" rules={[{ required: true, message: 'Vui lòng chọn tài khoản cần offboarding.' }]}>
                        <Select
                          showSearch
                          optionFilterProp="label"
                          placeholder="Chọn tài khoản cần xử lý vòng đời"
                          options={candidateOptions}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={24}>
                      <Form.Item label="Chuyển đầu việc mở cho" name="transfer_task_owner_id">
                        <Select
                          allowClear
                          showSearch
                          optionFilterProp="label"
                          placeholder="Chọn owner mới cho đầu việc đang mở"
                          options={transferOptions}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="Ngừng kích hoạt tài khoản" name="deactivate_account" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="Khóa tài khoản" name="lock_account" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="Thu hồi quyền" name="revoke_access" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="Thu hồi phiên đăng nhập" name="revoke_sessions" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Col>
                  </Row>
                </Form>

                <Space>
                  <Button icon={<EyeOutlined />} onClick={() => void handlePreview()} loading={previewMutation.isPending}>
                    Xem trước
                  </Button>
                  <Button type="primary" danger icon={<StopOutlined />} onClick={() => void handleApply()} loading={applyMutation.isPending}>
                    Áp dụng xử lý
                  </Button>
                </Space>
              </Space>
            </Card>
          </Col>

          <Col xs={24} xl={13}>
            <Card title="Xem trước tác động xử lý vòng đời" style={PANEL_STYLE}>
              {previewData ? (
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  <Alert
                    type={previewData.warnings.length ? 'warning' : 'success'}
                    showIcon
                    message={`${previewData.user.full_name || previewData.user.username} (${previewData.user.username})`}
                    description={`Phiên mở: ${previewData.sessions.active_session_count}, đầu việc mở: ${previewData.tasks.open_task_count}, vai trò/nhóm: ${previewData.access.role_count}/${previewData.access.team_count}.`}
                  />

                  {previewData.warnings.length ? (
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      {previewData.warnings.map((item) => (
                        <Alert key={item} type="warning" showIcon message={item} />
                      ))}
                    </Space>
                  ) : null}

                  <Card size="small" title="Kiểm tra trước khi xử lý" style={{ borderRadius: 16 }}>
                    <List
                      size="small"
                      dataSource={previewData.preflight_checks}
                      renderItem={(item) => (
                        <List.Item key={item.key}>
                          <Space direction="vertical" size={4} style={{ width: '100%' }}>
                            <Space size={[6, 6]} wrap>
                              <Text strong>{item.title}</Text>
                              <Tag color={CHECK_STATUS_COLORS[item.status] || 'default'}>{item.status}</Tag>
                            </Space>
                            <Text type="secondary">{item.description}</Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Card>

                  <Card size="small" title="Tác động xử lý vòng đời" style={{ borderRadius: 16 }}>
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                      <div>
                        <Text type="secondary">Quyền hiện có</Text>
                        <div style={{ marginTop: 6 }}>{renderCompactTags(previewData.access.roles, 'Không có vai trò')}</div>
                        <div style={{ marginTop: 6 }}>{renderCompactTags(previewData.access.teams, 'Không có nhóm')}</div>
                      </div>
                      <Space size={[6, 6]} wrap>
                        <Tag>{previewData.sessions.active_session_count} phiên mở</Tag>
                        <Tag>{previewData.tasks.open_task_count} đầu việc mở</Tag>
                        <Tag>{previewData.tasks.blocking_task_count} đầu việc chặn</Tag>
                        <Tag>{previewData.tasks.overdue_task_count} quá hạn</Tag>
                        {previewData.transfer_target ? <Tag color="blue">Chuyển cho {previewData.transfer_target.username}</Tag> : null}
                      </Space>
                      <Text type="secondary">
                        Lần hoạt động gần nhất: {formatDateTime(previewData.sessions.last_seen_at)} · IP cuối: {previewData.sessions.last_seen_ip || 'Chưa ghi nhận'}
                      </Text>
                    </Space>
                  </Card>
                </Space>
              ) : (
                <Empty description="Xem trước để kiểm tra phiên, đầu việc và quyền sẽ được xử lý" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={10}>
            <Card
              title="Danh sách ưu tiên xử lý vòng đời"
              style={PANEL_STYLE}
              extra={(
                <Button icon={<DownloadOutlined />} onClick={exportWatchlist}>
                  Xuất CSV
                </Button>
              )}
            >
              {filteredWatchlist.length ? (
                <List
                  dataSource={filteredWatchlist}
                  renderItem={(item) => (
                    <List.Item>
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <Space size={[6, 6]} wrap>
                          <Text strong>{item.full_name}</Text>
                          <Tag color={WATCHLIST_STATE_COLORS[item.state] || 'default'}>{item.state_label}</Tag>
                          {!item.is_active ? <Tag>Đã ngừng kích hoạt</Tag> : null}
                          {item.is_locked ? <Tag color="gold">Đã khóa</Tag> : null}
                        </Space>
                        <Text type="secondary">
                          {item.username}
                          {item.email ? ` · ${item.email}` : ''}
                          {` · Hoạt động gần nhất ${formatDateTime(item.last_seen_at)}`}
                        </Text>
                        <Text type="secondary">{item.summary}</Text>
                        <Space size={[6, 6]} wrap>
                          <Tag>{item.active_session_count} phiên mở</Tag>
                          <Tag>{item.open_task_count} đầu việc mở</Tag>
                          <Tag>{item.role_count} vai trò</Tag>
                          <Tag>{item.team_count} nhóm</Tag>
                        </Space>
                        <Space size={[8, 8]} wrap>
                          <Button size="small" onClick={() => focusUser(item.id)}>
                            Đưa vào bàn xử lý
                          </Button>
                          <Button size="small" onClick={() => openWatchlistItem(item.id)}>
                            Xem chi tiết
                          </Button>
                        </Space>
                      </Space>
                    </List.Item>
                  )}
                />
              ) : (
                <Empty description="Không có tài khoản nào cần xử lý vòng đời" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Col>

          <Col xs={24} xl={14}>
            <Card
              title="Hoạt động kết thúc vòng đời"
              style={PANEL_STYLE}
              extra={(
                <Button icon={<DownloadOutlined />} onClick={exportActivity}>
                  Xuất CSV
                </Button>
              )}
            >
              {filteredActivity.length ? (
                <List
                  dataSource={filteredActivity}
                  renderItem={(item) => (
                    <List.Item>
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <Space size={[6, 6]} wrap>
                          <Tag color="red">{item.entity_code}</Tag>
                          {!item.account_state.is_active ? <Tag>Đã ngừng kích hoạt</Tag> : null}
                          {item.account_state.is_locked ? <Tag color="gold">Đã khóa</Tag> : null}
                          <Text strong>{item.summary}</Text>
                        </Space>
                        <Text type="secondary">
                          {item.actor.full_name || item.actor.username || 'Hệ thống'} · {formatDateTime(item.timestamp)}
                        </Text>
                        <Space size={[6, 6]} wrap>
                          <Tag>{item.cleanup.tasks_transferred_count} đầu việc đã chuyển</Tag>
                          <Tag>{item.cleanup.sessions_revoked_count} phiên đã thu hồi</Tag>
                          {item.cleanup.revoke_access ? <Tag color="blue">Đã thu hồi quyền</Tag> : null}
                          {item.cleanup.transfer_target_username ? <Tag color="purple">{item.cleanup.transfer_target_username}</Tag> : null}
                        </Space>
                      </Space>
                    </List.Item>
                  )}
                />
              ) : (
                <Empty description="Chưa có hoạt động offboarding" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Col>
        </Row>
      </Space>

      <Modal
        open={isViewPresetModalOpen}
        title="Lưu mẫu lọc kết thúc vòng đời"
        okText="Lưu mẫu"
        cancelText="Đóng"
        onOk={() => void saveNamedPreset()}
        onCancel={() => {
          setIsViewPresetModalOpen(false);
          setViewPresetName('');
        }}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Text type="secondary">
            Lưu nhanh bộ lọc watchlist và activity để đội vận hành mở lại đúng hàng chờ kết thúc vòng đời đang phụ trách.
          </Text>
          <Input
            data-testid="user-offboarding-preset-name"
            placeholder="Ví dụ: Ca chiều thu hồi phiên"
            value={viewPresetName}
            onChange={(event) => setViewPresetName(event.target.value)}
            onPressEnter={() => void saveNamedPreset()}
          />
        </Space>
      </Modal>

      <Modal
        open={Boolean(result)}
        title="Đã áp dụng xử lý vòng đời"
        onCancel={() => setResult(null)}
        footer={[
          <Button key="close" type="primary" onClick={() => setResult(null)}>
            Đóng
          </Button>,
        ]}
      >
        {result ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              type="success"
              showIcon
              message={`${result.user.full_name || result.user.username} đã được xử lý vòng đời`}
              description="Trạng thái tài khoản và các chỉ số xử lý đã được ghi audit."
            />
            <Card size="small" title="Kết quả xử lý" style={{ borderRadius: 16 }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Text type="secondary">Đầu việc đã chuyển: {result.cleanup.tasks_transferred_count}</Text>
                <Text type="secondary">Phiên đã thu hồi: {result.cleanup.sessions_revoked_count}</Text>
                <Text type="secondary">Đã thu hồi quyền: {result.cleanup.revoke_access ? 'Có' : 'Không'}</Text>
                {result.cleanup.transfer_target ? (
                  <Text type="secondary">Người nhận bàn giao: {result.cleanup.transfer_target.full_name}</Text>
                ) : null}
              </Space>
            </Card>
          </Space>
        ) : null}
      </Modal>

      <Drawer
        open={Boolean(selectedWatchlistItem)}
        title="Chi tiết danh sách ưu tiên kết thúc vòng đời"
        width={460}
        onClose={closeWatchlistDrawer}
      >
        {selectedWatchlistItem ? (
          <div data-testid="user-offboarding-watchlist-drawer">
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              type={selectedWatchlistItem.severity === 'error' ? 'error' : selectedWatchlistItem.severity === 'warning' ? 'warning' : 'info'}
              showIcon
              message={`${selectedWatchlistItem.full_name} (${selectedWatchlistItem.username})`}
              description={selectedWatchlistItem.summary}
            />
            <Card size="small" title="Bối cảnh xử lý" style={{ borderRadius: 16 }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Text type="secondary">{selectedWatchlistItem.email || 'Chưa có email công việc'}</Text>
                <Space size={[6, 6]} wrap>
                  <Tag color={WATCHLIST_STATE_COLORS[selectedWatchlistItem.state] || 'default'}>{selectedWatchlistItem.state_label}</Tag>
                  <Tag>{selectedWatchlistItem.active_session_count} phiên mở</Tag>
                  <Tag>{selectedWatchlistItem.open_task_count} đầu việc mở</Tag>
                  <Tag>{selectedWatchlistItem.role_count} vai trò</Tag>
                  <Tag>{selectedWatchlistItem.team_count} nhóm</Tag>
                </Space>
                <Text type="secondary">Hoạt động gần nhất: {formatDateTime(selectedWatchlistItem.last_seen_at)}</Text>
              </Space>
            </Card>
            <Card size="small" title="Khuyến nghị xử lý" style={{ borderRadius: 16 }}>
              <List
                size="small"
                dataSource={buildOffboardingRecommendations(
                  selectedWatchlistItem.state,
                  selectedWatchlistItem.open_task_count,
                  selectedWatchlistItem.active_session_count,
                  selectedWatchlistItem.role_count + selectedWatchlistItem.team_count,
                )}
                renderItem={(item) => (
                  <List.Item>
                    <Text type="secondary">{item}</Text>
                  </List.Item>
                )}
              />
            </Card>
            <Space size={[8, 8]} wrap>
              <Button type="primary" onClick={() => focusUser(selectedWatchlistItem.id)}>
                Đưa vào bàn xử lý
              </Button>
              <Button onClick={closeWatchlistDrawer}>Đóng</Button>
            </Space>
          </Space>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
