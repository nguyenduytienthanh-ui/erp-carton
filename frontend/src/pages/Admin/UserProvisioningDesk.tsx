import { useMemo, useState } from 'react';
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
  Radio,
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
  UserAddOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';

import PageHeader from '../../components/PageHeader/PageHeader';
import { adminApi } from '../../api/admin';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { getToastMessage } from '../../shared/apiError';
import type { UserProvisioningPreviewResponse, UserProvisioningResponse } from '../../types/admin';
import { downloadCSV } from '../../utils/csvExport';
import { PAGES } from '../../utils/constants';

const { Paragraph, Text } = Typography;

type ProvisioningFormValues = {
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  preset_key?: string;
  role_ids: number[];
  team_ids: number[];
  is_active: boolean;
  is_staff: boolean;
  create_tasks: boolean;
  include_security_task: boolean;
  password_mode: 'generated' | 'custom';
  temporary_password?: string;
};

type WatchlistStateFilter = 'all' | 'ready' | 'access-gap' | 'security-followup' | 'onboarding-in-flight';
type ActivityPasswordFilter = 'all' | 'generated' | 'custom';
type ProvisioningFilterSnapshot = {
  watchlist_search: string;
  watchlist_state: WatchlistStateFilter;
  activity_search: string;
  activity_password_filter: ActivityPasswordFilter;
};
type ProvisioningNamedPreset = {
  id: string;
  name: string;
  filters: ProvisioningFilterSnapshot;
};

const HERO_CARD_STYLE: CSSProperties = {
  borderRadius: 22,
  border: '1px solid #d7e7dd',
  background: 'linear-gradient(180deg, #ffffff 0%, #f5fbf6 100%)',
  boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
};

const PANEL_STYLE: CSSProperties = {
  borderRadius: 22,
  border: '1px solid #e2e8f0',
  boxShadow: '0 14px 36px rgba(15, 23, 42, 0.06)',
};

const WATCHLIST_STATE_COLORS: Record<string, string> = {
  ready: 'green',
  'access-gap': 'gold',
  'security-followup': 'red',
  'onboarding-in-flight': 'blue',
};

const WATCHLIST_STATE_LABELS: Record<Exclude<WatchlistStateFilter, 'all'>, string> = {
  'access-gap': 'Thiếu quyền',
  'security-followup': 'Theo dõi bảo mật',
  'onboarding-in-flight': 'Tiếp nhận đang chạy',
  ready: 'Ổn định',
};

const PASSWORD_FILTER_LABELS: Record<Exclude<ActivityPasswordFilter, 'all'>, string> = {
  generated: 'Sinh tự động',
  custom: 'Tự nhập',
};

const CHECK_STATUS_COLORS: Record<string, string> = {
  ready: 'green',
  warning: 'gold',
  blocked: 'red',
  info: 'blue',
};

const DEFAULT_VALUES: ProvisioningFormValues = {
  username: '',
  email: '',
  first_name: '',
  last_name: '',
  phone: '',
  preset_key: undefined,
  role_ids: [],
  team_ids: [],
  is_active: true,
  is_staff: false,
  create_tasks: true,
  include_security_task: true,
  password_mode: 'generated',
  temporary_password: '',
};

function formatDateTime(value?: string | null): string {
  if (!value) return 'Chưa ghi nhận';
  return dayjs(value).format('DD/MM/YYYY HH:mm');
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function buildProvisioningRecommendations(
  state: string,
  rotationDeadlineDays: number,
  taskCount: number,
): string[] {
  if (state === 'access-gap') {
    return [
      'Rà soát preset, vai trò và nhóm đang gán để đóng khoảng trống truy cập.',
      'Chạy xem trước lại trước khi bàn giao tài khoản cho người dùng.',
    ];
  }
  if (state === 'security-followup') {
    return [
      `Theo dõi việc đổi mật khẩu trong ${rotationDeadlineDays} ngày đầu.`,
      'Nhắc người dùng hoàn tất các bước xác thực và bàn giao bảo mật.',
    ];
  }
  if (state === 'onboarding-in-flight') {
    return [
      `Theo dõi ${taskCount} đầu việc tiếp nhận còn mở để tránh chậm bàn giao.`,
      'Phối hợp owner công việc nếu có hạng mục đang chặn hoặc quá hạn.',
    ];
  }
  return [
    'Không có tín hiệu rủi ro lớn, chỉ cần tiếp tục theo dõi theo chu kỳ.',
    'Giữ lại dấu vết bàn giao thông tin đăng nhập và xác nhận hoàn tất tiếp nhận.',
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

export default function UserProvisioningDesk() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const focusUserId = Number(searchParams.get('focus_user_id') || 0) || null;
  const focusSearch = searchParams.get('focus') || searchParams.get('search') || '';
  const [previewData, setPreviewData] = useState<UserProvisioningPreviewResponse | null>(null);
  const [createdResult, setCreatedResult] = useState<UserProvisioningResponse | null>(null);
  const [watchlistSearch, setWatchlistSearch] = useState(focusSearch);
  const [watchlistState, setWatchlistState] = useState<WatchlistStateFilter>('all');
  const [activitySearch, setActivitySearch] = useState(focusSearch);
  const [activityPasswordFilter, setActivityPasswordFilter] = useState<ActivityPasswordFilter>('all');
  const [selectedViewPresetId, setSelectedViewPresetId] = useState('NONE');
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const [selectedWatchlistUserId, setSelectedWatchlistUserId] = useState<number | null>(null);
  const [dismissedFocusWatchlistId, setDismissedFocusWatchlistId] = useState<number | null>(null);
  const [form] = Form.useForm<ProvisioningFormValues>();
  const passwordMode = Form.useWatch('password_mode', form) ?? 'generated';
  const deferredWatchlistSearch = useMemo(() => normalizeSearch(watchlistSearch), [watchlistSearch]);
  const deferredActivitySearch = useMemo(() => normalizeSearch(activitySearch), [activitySearch]);
  const { config: savedConfig, saveConfig } = useUserPreferences(PAGES.ADMIN_USER_PROVISIONING);
  const namedPresets = useMemo(() => {
    const raw = savedConfig?.saved_views;
    if (!Array.isArray(raw)) return [] as ProvisioningNamedPreset[];
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
        const activityPasswordFilterValue = filterRecord.activity_password_filter;
        if (
          watchlistStateValue !== 'all'
          && watchlistStateValue !== 'ready'
          && watchlistStateValue !== 'access-gap'
          && watchlistStateValue !== 'security-followup'
          && watchlistStateValue !== 'onboarding-in-flight'
        ) {
          return null;
        }
        if (
          activityPasswordFilterValue !== 'all'
          && activityPasswordFilterValue !== 'generated'
          && activityPasswordFilterValue !== 'custom'
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
            activity_password_filter: activityPasswordFilterValue,
          },
        } as ProvisioningNamedPreset;
      })
      .filter((item): item is ProvisioningNamedPreset => item !== null);
  }, [savedConfig?.saved_views]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId]
  );

  const workspaceQuery = useQuery({
    queryKey: ['admin-user-provisioning-workspace'],
    queryFn: adminApi.getUserProvisioningWorkspace,
  });
  const rolesQuery = useQuery({
    queryKey: ['admin-user-provisioning-roles'],
    queryFn: () => adminApi.listRoles({ page_size: 200, is_active: true }),
  });
  const teamsQuery = useQuery({
    queryKey: ['admin-user-provisioning-teams'],
    queryFn: () => adminApi.listTeams({ page_size: 200, is_active: true }),
  });
  const activityQuery = useQuery({
    queryKey: ['admin-user-provisioning-activity'],
    queryFn: () => adminApi.getUserProvisioningActivity({ limit: 40 }),
  });

  const invalidateProvisioning = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-user-provisioning-workspace'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-user-provisioning-activity'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-user-directory'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-user-directory-summary'] }),
    ]);
  };

  const previewMutation = useMutation({
    mutationFn: adminApi.previewProvisionUser,
    onSuccess: (response) => {
      setPreviewData(response);
      if (response.profile.username !== form.getFieldValue('username')) {
        form.setFieldValue('username', response.profile.username);
      }
      messageApi.success('Đã cập nhật bản xem trước cấp tài khoản.');
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Không thể xem trước gói cấp tài khoản.')),
  });

  const provisionMutation = useMutation({
    mutationFn: adminApi.provisionUser,
    onSuccess: async (response) => {
      setCreatedResult(response);
      setPreviewData(null);
      form.resetFields();
      form.setFieldsValue(DEFAULT_VALUES);
      await invalidateProvisioning();
      messageApi.success('Đã cấp tài khoản mới và gắn gói tiếp nhận.');
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Không thể cấp tài khoản mới.')),
  });

  const roleOptions = useMemo(
    () => (rolesQuery.data ?? []).map((role) => ({ value: role.id, label: `${role.name || role.code} (${role.code})` })),
    [rolesQuery.data],
  );
  const teamOptions = useMemo(
    () => (teamsQuery.data ?? []).map((team) => ({ value: team.id, label: `${team.name || team.code} (${team.code})` })),
    [teamsQuery.data],
  );
  const presetOptions = useMemo(
    () => (workspaceQuery.data?.presets ?? []).map((preset) => ({
      value: preset.key,
      label: `${preset.name} (${preset.role_count} vai trò, ${preset.team_count} nhóm)`,
    })),
    [workspaceQuery.data?.presets],
  );
  const filteredWatchlist = useMemo(
    () =>
      (workspaceQuery.data?.watchlist ?? []).filter((item) => {
        const searchTarget = normalizeSearch([item.full_name, item.username, item.email, item.summary, item.preset_key].join(' '));
        const matchesSearch = !deferredWatchlistSearch || searchTarget.includes(deferredWatchlistSearch);
        const matchesState = watchlistState === 'all' || item.state === watchlistState;
        return matchesSearch && matchesState;
      }),
    [deferredWatchlistSearch, watchlistState, workspaceQuery.data?.watchlist],
  );
  const filteredActivity = useMemo(
    () =>
      (activityQuery.data?.items ?? []).filter((item) => {
        const searchTarget = normalizeSearch([
          item.summary,
          item.entity_code,
          item.actor.full_name,
          item.actor.username,
          item.provisioning.preset_key,
        ].join(' '));
        const matchesSearch = !deferredActivitySearch || searchTarget.includes(deferredActivitySearch);
        const matchesPassword = activityPasswordFilter === 'all' || item.credentials.password_mode === activityPasswordFilter;
        return matchesSearch && matchesPassword;
      }),
    [activityPasswordFilter, activityQuery.data?.items, deferredActivitySearch],
  );
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (watchlistSearch.trim()) tags.push(`Watchlist: ${watchlistSearch.trim()}`);
    if (watchlistState !== 'all') tags.push(`Trạng thái watchlist: ${WATCHLIST_STATE_LABELS[watchlistState]}`);
    if (activitySearch.trim()) tags.push(`Hoạt động: ${activitySearch.trim()}`);
    if (activityPasswordFilter !== 'all') tags.push(`Mật khẩu: ${PASSWORD_FILTER_LABELS[activityPasswordFilter]}`);
    if (selectedViewPreset) tags.push(`Mẫu đang dùng: ${selectedViewPreset.name}`);
    return tags;
  }, [activityPasswordFilter, activitySearch, selectedViewPreset, watchlistSearch, watchlistState]);

  const buildCurrentSnapshot = (): ProvisioningFilterSnapshot => ({
    watchlist_search: watchlistSearch,
    watchlist_state: watchlistState,
    activity_search: activitySearch,
    activity_password_filter: activityPasswordFilter,
  });

  const applySnapshot = (snapshot: ProvisioningFilterSnapshot) => {
    setWatchlistSearch(snapshot.watchlist_search);
    setWatchlistState(snapshot.watchlist_state);
    setActivitySearch(snapshot.activity_search);
    setActivityPasswordFilter(snapshot.activity_password_filter);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...savedConfig,
        ...buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem provisioning.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem provisioning.');
    }
  };

  const applySavedView = () => {
    const snapshot: ProvisioningFilterSnapshot = {
      watchlist_search: typeof savedConfig?.watchlist_search === 'string' ? savedConfig.watchlist_search : '',
      watchlist_state: savedConfig?.watchlist_state === 'ready'
        || savedConfig?.watchlist_state === 'access-gap'
        || savedConfig?.watchlist_state === 'security-followup'
        || savedConfig?.watchlist_state === 'onboarding-in-flight'
        ? savedConfig.watchlist_state
        : 'all',
      activity_search: typeof savedConfig?.activity_search === 'string' ? savedConfig.activity_search : '',
      activity_password_filter: savedConfig?.activity_password_filter === 'generated'
        || savedConfig?.activity_password_filter === 'custom'
        ? savedConfig.activity_password_filter
        : 'all',
    };
    applySnapshot(snapshot);
    messageApi.success('Đã khôi phục chế độ xem provisioning đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = viewPresetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: ProvisioningNamedPreset = existing
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
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc provisioning.' : 'Đã lưu mẫu lọc provisioning mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc provisioning.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc provisioning.');
      return;
    }
    applySnapshot(preset.filters);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc provisioning để xóa.');
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
      messageApi.error('Không thể xóa mẫu lọc provisioning.');
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

  const handlePreview = async () => {
    const values = await form.validateFields();
    previewMutation.mutate({
      username: values.username,
      email: values.email || undefined,
      first_name: values.first_name || undefined,
      last_name: values.last_name || undefined,
      phone: values.phone || undefined,
      preset_key: values.preset_key || undefined,
      role_ids: values.role_ids,
      team_ids: values.team_ids,
      is_active: values.is_active,
      is_staff: values.is_staff,
      create_tasks: values.create_tasks,
      include_security_task: values.include_security_task,
    });
  };

  const handleProvision = async () => {
    const values = await form.validateFields();
    provisionMutation.mutate({
      ...values,
      preset_key: values.preset_key || undefined,
      temporary_password: values.password_mode === 'custom' ? values.temporary_password : undefined,
    });
  };

  const loadPresetIntoForm = (presetKey?: string) => {
    if (!presetKey) return;
    form.setFieldsValue({
      preset_key: presetKey,
      role_ids: [],
      team_ids: [],
      create_tasks: true,
      include_security_task: true,
    });
    setPreviewData(null);
    messageApi.success(`Đã nạp preset ${presetKey} vào biểu mẫu.`);
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
        'Preset': item.preset_key,
        'Số vai trò': item.role_count,
        'Số nhóm': item.team_count,
        'Đầu việc còn mở': item.open_task_count,
        'Theo dõi bảo mật': item.has_security_followup ? 'Có' : 'Không',
      })),
      'user-provisioning-watchlist',
    );
  };

  const exportActivity = () => {
    if (!filteredActivity.length) {
      messageApi.warning('Chưa có hoạt động cấp tài khoản phù hợp để xuất CSV.');
      return;
    }
    downloadCSV(
      filteredActivity.map((item) => ({
        'Thời điểm': formatDateTime(item.timestamp),
        'Mã đối tượng': item.entity_code,
        'Tóm tắt': item.summary,
        'Người thao tác': item.actor.full_name || item.actor.username || 'Hệ thống',
        'Chế độ mật khẩu': item.credentials.password_mode,
        Preset: item.provisioning.preset_key,
        'Số vai trò': item.provisioning.roles_count,
        'Số nhóm': item.provisioning.teams_count,
        'Đầu việc onboarding': item.provisioning.tasks_created_count,
        'Có đầu việc bảo mật': item.provisioning.security_task_created ? 'Có' : 'Không',
      })),
      'user-provisioning-activity',
    );
  };

  return (
    <>
      {contextHolder}
      <PageHeader
        title="Bàn cấp tài khoản người dùng"
        subtitle="Cấp tài khoản mới theo chuẩn vai trò, nhóm, mẫu tiếp nhận và bàn giao thông tin đăng nhập an toàn."
        extra={[
          <Button
            key="reload"
            icon={<ReloadOutlined />}
            loading={workspaceQuery.isFetching || activityQuery.isFetching}
            onClick={() => {
              void invalidateProvisioning();
            }}
          >
            Làm mới
          </Button>,
        ]}
      />

      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        {(focusUserId || focusSearch) ? (
          <Alert
            data-testid="user-provisioning-focus-banner"
            type={selectedWatchlistItem ? 'info' : 'warning'}
            showIcon
            message={`Đang tập trung theo drilldown: ${focusSearch || `#${focusUserId}`}`}
            description={selectedWatchlistItem
              ? 'Hệ thống đã mở đúng hồ sơ ưu tiên trong command center để bạn xử lý nhanh hơn.'
              : 'Bộ lọc đang thu hẹp theo tài khoản được drilldown. Nếu chưa thấy hồ sơ trong watchlist, hãy kiểm tra nhật ký hoạt động bên dưới.'}
          />
        ) : null}
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12} xl={6}>
            <SummaryCard title="Mẫu sẵn sàng" value={workspaceQuery.data?.summary.ready_presets ?? 0} tint="#16a34a" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <SummaryCard title="Tài khoản cần rà soát" value={workspaceQuery.data?.summary.attention_accounts ?? 0} tint="#dc2626" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <SummaryCard title="Theo dõi bảo mật" value={workspaceQuery.data?.summary.security_followups ?? 0} tint="#f59e0b" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <SummaryCard title="Tiếp nhận đang chạy" value={workspaceQuery.data?.summary.onboarding_in_flight ?? 0} tint="#1677ff" />
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24}>
            <Card
              data-testid="user-provisioning-command-strip"
              style={PANEL_STYLE}
              bodyStyle={{ padding: 18 }}
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <div data-testid="user-provisioning-command-watchlist-search">
                    <Input.Search
                      allowClear
                      placeholder="Tìm watchlist theo tài khoản, email hoặc preset"
                      value={watchlistSearch}
                      onChange={(event) => setWatchlistSearch(event.target.value)}
                      style={{ width: 260 }}
                    />
                  </div>
                  <Select<WatchlistStateFilter>
                    value={watchlistState}
                    onChange={setWatchlistState}
                    style={{ width: 180 }}
                    options={[
                      { value: 'all', label: 'Mọi trạng thái' },
                      { value: 'access-gap', label: 'Thiếu quyền' },
                      { value: 'security-followup', label: 'Theo dõi bảo mật' },
                      { value: 'onboarding-in-flight', label: 'Tiếp nhận đang chạy' },
                      { value: 'ready', label: 'Ổn định' },
                    ]}
                  />
                  <Input.Search
                    allowClear
                    placeholder="Tìm activity theo tóm tắt, người thao tác hoặc preset"
                    value={activitySearch}
                    onChange={(event) => setActivitySearch(event.target.value)}
                    style={{ width: 260 }}
                  />
                  <Select<ActivityPasswordFilter>
                    value={activityPasswordFilter}
                    onChange={setActivityPasswordFilter}
                    style={{ width: 170 }}
                    options={[
                      { value: 'all', label: 'Mọi chế độ mật khẩu' },
                      { value: 'generated', label: 'Sinh tự động' },
                      { value: 'custom', label: 'Tự nhập' },
                    ]}
                  />
                </div>
                <Space wrap>
                  <Button data-testid="user-provisioning-save-view" onClick={() => void saveCurrentView()}>
                    Lưu chế độ xem
                  </Button>
                  <Button data-testid="user-provisioning-restore-view" onClick={applySavedView}>
                    Khôi phục
                  </Button>
                  <Button
                    data-testid="user-provisioning-open-preset-modal"
                    onClick={() => setIsViewPresetModalOpen(true)}
                  >
                    Tạo mẫu lọc
                  </Button>
                  <div data-testid="user-provisioning-preset-select">
                    <Select
                      value={selectedViewPresetId}
                      onChange={setSelectedViewPresetId}
                      style={{ width: 240 }}
                      options={[
                        { value: 'NONE', label: 'Chọn mẫu provisioning' },
                        ...namedPresets.map((preset) => ({ value: preset.id, label: preset.name })),
                      ]}
                    />
                  </div>
                  <Button data-testid="user-provisioning-apply-preset" onClick={applyNamedPreset}>
                    Áp dụng mẫu
                  </Button>
                  <Button
                    danger
                    data-testid="user-provisioning-delete-preset"
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
            <Card title="Thiết kế cấp tài khoản" style={PANEL_STYLE}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Alert
                  type="info"
                  showIcon
                    message="Luồng cấp tài khoản"
                  description={workspaceQuery.data?.credential_policy.secure_share_hint || 'Mật khẩu tạm thời chỉ hiển thị một lần sau khi tạo tài khoản.'}
                />
                {workspaceQuery.data ? (
                  <Alert
                    type="info"
                    showIcon
                    message="Chính sách bàn giao bảo mật"
                    description={`Yêu cầu đổi mật khẩu trong ${workspaceQuery.data.credential_policy.rotation_deadline_days} ngày. Kênh chia sẻ khuyến nghị: ${workspaceQuery.data.credential_policy.recommended_share_channels.join(', ')}.`}
                  />
                ) : null}
                {workspaceQuery.isError || rolesQuery.isError || teamsQuery.isError || activityQuery.isError ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="Có khung dữ liệu không gian làm việc đang tải lỗi"
                    description="Bạn vẫn có thể cấp tài khoản, nhưng một số khung theo dõi có thể chưa đủ dữ liệu."
                  />
                ) : null}

                <Form<ProvisioningFormValues> form={form} layout="vertical" initialValues={DEFAULT_VALUES}>
                  <Row gutter={[12, 12]}>
                    <Col span={12}>
                      <Form.Item label="Tên đăng nhập" name="username" rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập.' }]}>
                        <Input placeholder="ops.new.hire" />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="Email công việc" name="email">
                        <Input placeholder="ops.new.hire@example.com" />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="Họ" name="first_name">
                        <Input placeholder="Nguyễn" />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="Tên" name="last_name">
                        <Input placeholder="Nhân sự mới" />
                      </Form.Item>
                    </Col>
                    <Col span={24}>
                      <Form.Item label="Số điện thoại" name="phone">
                        <Input placeholder="0900111222" />
                      </Form.Item>
                    </Col>
                    <Col span={24}>
                      <Form.Item label="Mẫu tiếp nhận" name="preset_key">
                        <Select allowClear placeholder="Chọn mẫu tiếp nhận" options={presetOptions} />
                      </Form.Item>
                    </Col>
                    <Col span={24}>
                      <Form.Item label="Vai trò bổ sung" name="role_ids">
                        <Select mode="multiple" placeholder="Thêm vai trò bổ sung" options={roleOptions} />
                      </Form.Item>
                    </Col>
                    <Col span={24}>
                      <Form.Item label="Nhóm bổ sung" name="team_ids">
                        <Select mode="multiple" placeholder="Thêm nhóm bổ sung" options={teamOptions} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="Chế độ mật khẩu" name="password_mode">
                        <Radio.Group>
                          <Radio.Button value="generated">Sinh tự động</Radio.Button>
                          <Radio.Button value="custom">Tự nhập</Radio.Button>
                        </Radio.Group>
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      {passwordMode === 'custom' ? (
                        <Form.Item label="Mật khẩu tạm thời" name="temporary_password" rules={[{ required: true, message: 'Vui lòng nhập mật khẩu tạm thời.' }]}>
                          <Input.Password placeholder="Nhập mật khẩu tạm thời" />
                        </Form.Item>
                      ) : (
                        <Alert type="success" showIcon message="Mật khẩu được sinh tự động" description="Hệ thống sẽ tạo mật khẩu tạm thời đạt chuẩn." />
                      )}
                    </Col>
                    <Col span={12}>
                      <Form.Item label="Kích hoạt tài khoản" name="is_active" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="Quyền nhân sự nội bộ" name="is_staff" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="Tạo đầu việc tiếp nhận" name="create_tasks" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="Tạo đầu việc bảo mật" name="include_security_task" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Col>
                  </Row>
                </Form>

                <Space>
                  <Button icon={<EyeOutlined />} onClick={() => void handlePreview()} loading={previewMutation.isPending}>
                    Xem trước
                  </Button>
                  <Button type="primary" icon={<UserAddOutlined />} onClick={() => void handleProvision()} loading={provisionMutation.isPending}>
                    Cấp tài khoản
                  </Button>
                </Space>
              </Space>
            </Card>
          </Col>

          <Col xs={24} xl={13}>
            <Card title="Xem trước gói cấp tài khoản" style={PANEL_STYLE}>
              {previewData ? (
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  <Alert
                    type={previewData.availability.username_available && previewData.availability.email_available ? 'success' : 'warning'}
                    showIcon
                    message={`${previewData.profile.full_name || previewData.profile.username} (${previewData.profile.username})`}
                    description={`Vai trò: ${previewData.summary.role_count}, Nhóm: ${previewData.summary.team_count}, Đầu việc: ${previewData.summary.task_total}.`}
                  />

                  {!previewData.availability.username_available ? (
                    <Card size="small" title="Gợi ý tên đăng nhập" style={{ borderRadius: 16 }}>
                      <Space size={[6, 6]} wrap>
                        {previewData.availability.username_suggestions.map((item) => (
                          <Tag
                            key={item}
                            color="blue"
                            style={{ cursor: 'pointer' }}
                            onClick={() => form.setFieldValue('username', item)}
                          >
                            {item}
                          </Tag>
                        ))}
                      </Space>
                    </Card>
                  ) : null}

                  {previewData.warnings.length ? (
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      {previewData.warnings.map((item) => (
                        <Alert key={item} type="warning" showIcon message={item} />
                      ))}
                    </Space>
                  ) : null}

                  <Card size="small" title="Kiểm tra trước khi tạo" style={{ borderRadius: 16 }}>
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

                  <Card size="small" title="Quyền sau khi hợp nhất" style={{ borderRadius: 16 }}>
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                      <div>
                        <Text type="secondary">Vai trò</Text>
                        <div style={{ marginTop: 6 }}>{renderCompactTags(previewData.roles, 'Chưa gán vai trò')}</div>
                      </div>
                      <div>
                        <Text type="secondary">Nhóm</Text>
                        <div style={{ marginTop: 6 }}>{renderCompactTags(previewData.teams, 'Chưa gán nhóm')}</div>
                      </div>
                      <div>
                        <Text type="secondary">Kế hoạch thông báo email</Text>
                        <div style={{ marginTop: 6 }}>
                          {previewData.notification_plan.email_notifications_enabled ? (
                            <Space size={[6, 6]} wrap>
                              {previewData.notification_plan.email_notification_types.map((item) => (
                                <Tag key={item} color="volcano">{item}</Tag>
                              ))}
                            </Space>
                          ) : (
                            <Tag>Tắt thông báo email</Tag>
                          )}
                        </div>
                      </div>
                    </Space>
                  </Card>

                  <Card size="small" title="Kế hoạch đầu việc" style={{ borderRadius: 16 }}>
                    {previewData.task_preview.length || previewData.security_task_preview ? (
                      <List
                        size="small"
                        dataSource={[
                          ...previewData.task_preview.map((item) => ({
                            key: item.source_key,
                            title: item.title,
                            description: item.description,
                            tag: 'Quy trình',
                            due_date: item.due_date,
                          })),
                          ...(previewData.security_task_preview ? [{
                            key: previewData.security_task_preview.source_key,
                            title: previewData.security_task_preview.title,
                            description: previewData.security_task_preview.description,
                            tag: 'Bảo mật',
                            due_date: previewData.security_task_preview.due_date,
                          }] : []),
                        ]}
                        renderItem={(item) => (
                          <List.Item key={item.key}>
                            <Space direction="vertical" size={4} style={{ width: '100%' }}>
                              <Space size={[6, 6]} wrap>
                                <Text strong>{item.title}</Text>
                                <Tag color={item.tag === 'Bảo mật' ? 'gold' : 'blue'}>{item.tag}</Tag>
                                <Tag>Hạn: {item.due_date || 'Chưa có hạn'}</Tag>
                              </Space>
                              <Text type="secondary">{item.description}</Text>
                            </Space>
                          </List.Item>
                        )}
                      />
                    ) : (
                      <Empty description="Không có đầu việc nào sẽ được tạo" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    )}
                  </Card>
                </Space>
              ) : (
                <Empty description="Xem trước để kiểm tra tính khả dụng, quyền và kế hoạch đầu việc" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={10}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Card
              title="Danh sách ưu tiên cấp tài khoản"
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
                            {item.preset_key ? <Tag color="purple">{item.preset_key}</Tag> : null}
                          </Space>
                          <Text type="secondary">
                            {item.username}
                            {item.email ? ` · ${item.email}` : ''}
                            {` · Tham gia ${formatDateTime(item.date_joined)}`}
                          </Text>
                          <Text type="secondary">{item.summary}</Text>
                          <Space size={[6, 6]} wrap>
                            <Tag>{item.role_count} vai trò</Tag>
                            <Tag>{item.team_count} nhóm</Tag>
                            <Tag>{item.open_task_count} đầu việc mở</Tag>
                            {item.has_security_followup ? <Tag color="gold">Đổi mật khẩu</Tag> : null}
                          </Space>
                          <Space size={[8, 8]} wrap>
                            <Button size="small" onClick={() => openWatchlistItem(item.id)}>
                              Xem chi tiết
                            </Button>
                            {item.preset_key ? (
                              <Button size="small" type="link" onClick={() => loadPresetIntoForm(item.preset_key)}>
                                Nạp preset
                              </Button>
                            ) : null}
                          </Space>
                        </Space>
                      </List.Item>
                    )}
                  />
                ) : (
                  <Empty description="Chưa có tài khoản nào cần theo dõi" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </Card>

              <Card title="Độ sẵn sàng của preset" style={PANEL_STYLE}>
                {(workspaceQuery.data?.presets ?? []).length ? (
                  <List
                    dataSource={workspaceQuery.data?.presets ?? []}
                    renderItem={(item) => (
                      <List.Item>
                        <Space direction="vertical" size={4} style={{ width: '100%' }}>
                          <Space size={[6, 6]} wrap>
                            <Text strong>{item.name}</Text>
                            <Tag color={item.has_issues ? 'gold' : 'green'}>{item.has_issues ? 'Cần rà soát' : 'Sẵn sàng'}</Tag>
                          </Space>
                          <Text type="secondary">{item.description}</Text>
                          <Space size={[6, 6]} wrap>
                            <Tag>{item.role_count} vai trò</Tag>
                            <Tag>{item.team_count} nhóm</Tag>
                            <Tag>{item.workflow_template_count} mẫu workflow</Tag>
                          </Space>
                          <Space size={[8, 8]} wrap>
                            <Button size="small" onClick={() => loadPresetIntoForm(item.key)}>
                              Nạp vào biểu mẫu
                            </Button>
                            {item.has_issues ? <Tag color="gold">Cần làm sạch phụ thuộc trước khi rollout</Tag> : null}
                          </Space>
                        </Space>
                      </List.Item>
                    )}
                  />
                ) : (
                  <Empty description="Chưa có preset sẵn sàng" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </Card>
            </Space>
          </Col>

          <Col xs={24} xl={14}>
            <Card
              title="Hoạt động cấp tài khoản"
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
                          <Tag color="blue">{item.entity_code}</Tag>
                          <Tag color="green">{item.credentials.password_mode === 'generated' ? 'Sinh tự động' : 'Tự nhập'}</Tag>
                          {item.provisioning.preset_key ? <Tag color="purple">{item.provisioning.preset_key}</Tag> : null}
                          <Text strong>{item.summary}</Text>
                        </Space>
                        <Text type="secondary">
                          {item.actor.full_name || item.actor.username || 'Hệ thống'} · {formatDateTime(item.timestamp)}
                        </Text>
                        <Space size={[6, 6]} wrap>
                          <Tag>{item.provisioning.roles_count} vai trò</Tag>
                          <Tag>{item.provisioning.teams_count} nhóm</Tag>
                          <Tag>{item.provisioning.tasks_created_count} đầu việc tiếp nhận</Tag>
                          {item.provisioning.security_task_created ? <Tag color="gold">Đầu việc bảo mật</Tag> : null}
                        </Space>
                      </Space>
                    </List.Item>
                  )}
                />
              ) : (
                <Empty description="Chưa có hoạt động cấp tài khoản" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Col>
        </Row>
      </Space>

      <Modal
        open={Boolean(createdResult)}
        title="Bàn giao thông tin đăng nhập"
        onCancel={() => setCreatedResult(null)}
        footer={[
          <Button key="close" type="primary" onClick={() => setCreatedResult(null)}>
            Đóng
          </Button>,
        ]}
      >
        {createdResult ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              type="success"
              showIcon
              message={`${createdResult.user.full_name || createdResult.user.username} đã được cấp tài khoản`}
              description={createdResult.credentials.secure_share_hint}
            />
            <Card size="small" title="Thông tin đăng nhập" style={{ borderRadius: 16 }}>
              <Paragraph copyable={{ text: createdResult.credentials.username }}>
                <Text strong>Tên đăng nhập:</Text> {createdResult.credentials.username}
              </Paragraph>
              <Paragraph copyable={{ text: createdResult.credentials.temporary_password }}>
                <Text strong>Mật khẩu tạm thời:</Text> {createdResult.credentials.temporary_password}
              </Paragraph>
            </Card>
            <Card size="small" title="Gói cấp tài khoản" style={{ borderRadius: 16 }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <div>{renderCompactTags(createdResult.roles, 'Chưa gán vai trò')}</div>
                <div>{renderCompactTags(createdResult.teams, 'Chưa gán nhóm')}</div>
                <Text type="secondary">
                  Đầu việc tiếp nhận: {createdResult.tasks_created.length}
                  {createdResult.security_task_created ? ' + 1 đầu việc bảo mật' : ''}
                </Text>
              </Space>
            </Card>
            <Card size="small" title="Bước tiếp theo" style={{ borderRadius: 16 }}>
              <List
                size="small"
                dataSource={[
                  `Chia sẻ thông tin đăng nhập qua kênh an toàn: ${(workspaceQuery.data?.credential_policy.recommended_share_channels ?? ['Kênh bảo mật nội bộ']).join(', ')}.`,
                  `Yêu cầu người dùng đổi mật khẩu trong ${workspaceQuery.data?.credential_policy.rotation_deadline_days ?? 1} ngày đầu tiên.`,
                  `Theo dõi ${createdResult.tasks_created.length + (createdResult.security_task_created ? 1 : 0)} đầu việc theo dõi trong danh sách ưu tiên cấp tài khoản.`,
                ]}
                renderItem={(item) => (
                  <List.Item>
                    <Text type="secondary">{item}</Text>
                  </List.Item>
                )}
              />
            </Card>
          </Space>
        ) : null}
      </Modal>

      <Modal
        open={isViewPresetModalOpen}
        title="Lưu mẫu lọc provisioning"
        okText="Lưu mẫu"
        cancelText="Đóng"
        onOk={() => void saveNamedPreset()}
        onCancel={() => {
          setIsViewPresetModalOpen(false);
          setViewPresetName('');
        }}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Lưu nhanh bộ lọc watchlist và activity để đội vận hành mở lại đúng hàng chờ cấp tài khoản đang phụ trách.
          </Paragraph>
          <Input
            data-testid="user-provisioning-preset-name"
            placeholder="Ví dụ: Ca sáng theo dõi bảo mật"
            value={viewPresetName}
            onChange={(event) => setViewPresetName(event.target.value)}
            onPressEnter={() => void saveNamedPreset()}
          />
        </Space>
      </Modal>

      <Drawer
        open={Boolean(selectedWatchlistItem)}
        title="Chi tiết danh sách ưu tiên cấp tài khoản"
        width={480}
        onClose={closeWatchlistDrawer}
      >
        {selectedWatchlistItem ? (
          <div data-testid="user-provisioning-watchlist-drawer">
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              type={selectedWatchlistItem.severity === 'error' ? 'error' : selectedWatchlistItem.severity === 'warning' ? 'warning' : 'info'}
              showIcon
              message={`${selectedWatchlistItem.full_name} (${selectedWatchlistItem.username})`}
              description={selectedWatchlistItem.summary}
            />
            <Card size="small" title="Bối cảnh tài khoản" style={{ borderRadius: 16 }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Text type="secondary">{selectedWatchlistItem.email || 'Chưa có email công việc'}</Text>
                <Space size={[6, 6]} wrap>
                  <Tag color={WATCHLIST_STATE_COLORS[selectedWatchlistItem.state] || 'default'}>{selectedWatchlistItem.state_label}</Tag>
                  {selectedWatchlistItem.preset_key ? <Tag color="purple">{selectedWatchlistItem.preset_key}</Tag> : null}
                  <Tag>{selectedWatchlistItem.role_count} vai trò</Tag>
                  <Tag>{selectedWatchlistItem.team_count} nhóm</Tag>
                  <Tag>{selectedWatchlistItem.open_task_count} đầu việc mở</Tag>
                </Space>
                <Text type="secondary">Ngày tham gia: {formatDateTime(selectedWatchlistItem.date_joined)}</Text>
              </Space>
            </Card>
            <Card size="small" title="Khuyến nghị xử lý" style={{ borderRadius: 16 }}>
              <List
                size="small"
                dataSource={buildProvisioningRecommendations(
                  selectedWatchlistItem.state,
                  workspaceQuery.data?.credential_policy.rotation_deadline_days ?? 1,
                  selectedWatchlistItem.open_task_count,
                )}
                renderItem={(item) => (
                  <List.Item>
                    <Text type="secondary">{item}</Text>
                  </List.Item>
                )}
              />
            </Card>
            <Space size={[8, 8]} wrap>
              {selectedWatchlistItem.preset_key ? (
                <Button type="primary" onClick={() => loadPresetIntoForm(selectedWatchlistItem.preset_key)}>
                  Nạp preset vào biểu mẫu
                </Button>
              ) : null}
              <Button onClick={closeWatchlistDrawer}>Đóng</Button>
            </Space>
          </Space>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
