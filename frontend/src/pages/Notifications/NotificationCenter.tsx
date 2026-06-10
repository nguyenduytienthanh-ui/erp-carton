import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Empty, Input, Modal, Select, Space, Spin, Switch, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { notificationsApi, type NotificationItem } from '../../api/notifications';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { SafeText as Text } from '../../components/SafeText';
import { useRowSelection } from '../../hooks/useRowSelection';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useRealtimePollingInterval } from '../../hooks/useRealtimePollingInterval';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';

type ReadFilter = 'ALL' | 'UNREAD' | 'READ';

type NotificationCenterViewSnapshot = {
  searchInput: string;
  typeFilter: string;
  readFilter: ReadFilter;
  liveSync: boolean;
};

type NotificationCenterNamedPreset = {
  id: string;
  name: string;
  snapshot: NotificationCenterViewSnapshot;
  updatedAt: string;
};

const TYPE_LABELS: Record<string, string> = {
  mention: 'Đề cập',
  comment: 'Bình luận',
  approval_request: 'Yêu cầu duyệt',
  approval_approved: 'Đã duyệt',
  approval_rejected: 'Từ chối duyệt',
  assignment: 'Phân công',
  due_date: 'Nhắc hạn',
  system: 'Hệ thống',
};

function typeColor(type: string): string {
  if (type === 'assignment') return 'blue';
  if (type === 'due_date') return 'gold';
  if (type === 'approval_rejected') return 'red';
  if (type === 'approval_approved') return 'green';
  return 'default';
}

function needsAction(type: string): boolean {
  return ['approval_request', 'approval_rejected', 'due_date', 'assignment'].includes(type);
}

function isConversationType(type: string): boolean {
  return ['mention', 'comment'].includes(type);
}

function getNotificationTargetPath(item: NotificationItem): string {
  const normalizedEntityType = (item.entity_type || '').toLowerCase().replace(/[_-]/g, '');
  if (normalizedEntityType === 'task') return '/task-inbox';
  if (normalizedEntityType.includes('salaryadvance')) return '/salary-advance';
  if (normalizedEntityType.includes('employee')) return '/employees';
  if (item.notification_type === 'assignment' || item.notification_type === 'due_date') return '/task-inbox';
  return '/workflow-pipeline';
}

function getNotificationTargetLabel(item: NotificationItem): string {
  const targetPath = getNotificationTargetPath(item);
  if (targetPath === '/task-inbox') return 'Mở inbox';
  if (targetPath === '/salary-advance') return 'Mở ứng lương';
  if (targetPath === '/employees') return 'Mở nhân sự';
  return 'Mở workflow';
}

function getNotificationNextStep(item: NotificationItem): string {
  if (item.notification_type === 'approval_request') {
    return 'Mở luồng liên quan để duyệt, từ chối hoặc giao lại owner xử lý.';
  }
  if (item.notification_type === 'approval_rejected') {
    return 'Mở hồ sơ liên quan để xem lý do từ chối và bổ sung lại thông tin.';
  }
  if (item.notification_type === 'approval_approved') {
    return 'Mở luồng liên quan để kiểm tra bước sau duyệt hoặc tiếp tục vận hành.';
  }
  if (item.notification_type === 'assignment') {
    return 'Mở inbox để nhận việc, bắt đầu xử lý hoặc chuyển người nếu không đúng owner.';
  }
  if (item.notification_type === 'due_date') {
    return 'Mở nhiệm vụ để chốt hạn, cập nhật tiến độ hoặc nhắc người phụ trách.';
  }
  if (isConversationType(item.notification_type)) {
    return 'Mở luồng liên quan để đọc đầy đủ bối cảnh và phản hồi đúng chỗ.';
  }
  return 'Đọc nội dung, đánh dấu đã đọc khi đã đối chiếu xong.';
}

function isReadFilter(value: unknown): value is ReadFilter {
  return value === 'ALL' || value === 'UNREAD' || value === 'READ';
}

function parseNotificationCenterViewSnapshot(raw: unknown): NotificationCenterViewSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const snapshot = raw as Partial<NotificationCenterViewSnapshot>;
  if (
    typeof snapshot.searchInput !== 'string' ||
    typeof snapshot.typeFilter !== 'string' ||
    !isReadFilter(snapshot.readFilter) ||
    typeof snapshot.liveSync !== 'boolean'
  ) {
    return null;
  }
  return {
    searchInput: snapshot.searchInput,
    typeFilter: snapshot.typeFilter,
    readFilter: snapshot.readFilter,
    liveSync: snapshot.liveSync,
  };
}

export default function NotificationCenter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { config, saveConfig } = useUserPreferences(PAGES.NOTIFICATION_CENTER);
  const [searchInput, setSearchInput] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [readFilter, setReadFilter] = useState<ReadFilter>('ALL');
  const [liveSync, setLiveSync] = useState(true);
  const [selectedViewPresetId, setSelectedViewPresetId] = useState<string>();
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const liveSinceRef = useRef<string | null>(null);
  const { selectedIds, rowSelection, clearSelection } = useRowSelection<NotificationItem>();
  const configRecord = useMemo<Record<string, unknown>>(
    () => (config && typeof config === 'object' ? (config as Record<string, unknown>) : {}),
    [config],
  );
  const namedPresets = useMemo<NotificationCenterNamedPreset[]>(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const preset = item as Partial<NotificationCenterNamedPreset>;
        if (typeof preset.id !== 'string' || typeof preset.name !== 'string') return null;
        const snapshot = parseNotificationCenterViewSnapshot(preset.snapshot);
        if (!snapshot) return null;
        return {
          id: preset.id,
          name: preset.name,
          snapshot,
          updatedAt: typeof preset.updatedAt === 'string' ? preset.updatedAt : new Date().toISOString(),
        };
      })
      .filter((item): item is NotificationCenterNamedPreset => Boolean(item));
  }, [configRecord]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId],
  );
  const {
    intentSearch,
    intentFilters,
  } = useSearchFilterIntent({
    searchInput,
    filterValues: { typeFilter, readFilter },
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters: (f) => `${f.typeFilter}|${f.readFilter}`,
    parseFilters: (raw) => {
      const [type, read] = raw.split('|');
      return {
        typeFilter: type || 'ALL',
        readFilter: (read === 'UNREAD' || read === 'READ' ? read : 'ALL') as ReadFilter,
      };
    },
  });
  const livePollingInterval = useRealtimePollingInterval({
    enabled: liveSync,
    activeMs: 10_000,
    hiddenMs: false,
  });

  const listQuery = useQuery({
    queryKey: ['notifications-list', intentSearch, intentFilters.typeFilter, intentFilters.readFilter],
    queryFn: () => notificationsApi.list({
      q: intentSearch.trim() || undefined,
      type: intentFilters.typeFilter !== 'ALL' ? intentFilters.typeFilter : undefined,
      unread: intentFilters.readFilter === 'UNREAD' ? true : undefined,
      page_size: 200,
    }),
    staleTime: 5_000,
  });

  const unreadCountQuery = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: () => notificationsApi.unreadCount(),
    staleTime: 5_000,
  });

  const liveQuery = useQuery({
    queryKey: ['notifications-live-updates', liveSync, intentSearch, intentFilters.typeFilter, intentFilters.readFilter],
    queryFn: () => notificationsApi.liveUpdates({
      since: liveSinceRef.current || undefined,
      q: intentSearch.trim() || undefined,
      type: intentFilters.typeFilter !== 'ALL' ? intentFilters.typeFilter : undefined,
      unread: intentFilters.readFilter === 'UNREAD' ? true : undefined,
    }),
    enabled: liveSync,
    refetchInterval: livePollingInterval,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  useEffect(() => {
    liveSinceRef.current = null;
  }, [intentSearch, intentFilters.typeFilter, intentFilters.readFilter, liveSync]);

  useEffect(() => {
    const payload = liveQuery.data;
    if (!payload) return;
    if (payload.latest_at) liveSinceRef.current = payload.latest_at;
    if (!payload.has_changes) return;
    void queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
  }, [liveQuery.data, queryClient]);

  const markReadMutation = useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });

  const markManyMutation = useMutation({
    mutationFn: (ids: number[]) => notificationsApi.markManyRead(ids),
    onSuccess: (res) => {
      message.success(`Đã đánh dấu đã đọc ${res.count} thông báo.`);
      clearSelection();
      void queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
    onError: () => message.error('Không thể đánh dấu đã đọc hàng loạt.'),
  });

  const markAllMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: (res) => {
      message.success(`Đã đánh dấu đã đọc ${res.count} thông báo.`);
      clearSelection();
      void queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
    onError: () => message.error('Không thể đánh dấu tất cả đã đọc.'),
  });

  const data = useMemo(() => {
    const raw = listQuery.data ?? [];
    if (intentFilters.readFilter === 'READ') return raw.filter((x) => x.is_read);
    return raw;
  }, [intentFilters.readFilter, listQuery.data]);

  const stats = useMemo(() => {
    const unread = data.filter((item) => !item.is_read).length;
    const pendingApprovals = data.filter((item) => item.notification_type === 'approval_request').length;
    const actionNeeded = data.filter((item) => !item.is_read && needsAction(item.notification_type)).length;
    const collaboration = data.filter((item) => isConversationType(item.notification_type)).length;
    const todayCount = data.filter((item) => dayjs(item.created_at).isSame(dayjs(), 'day')).length;
    const latestAt = data.reduce<string | null>((latest, item) => {
      if (!latest) return item.created_at;
      return dayjs(item.created_at).isAfter(dayjs(latest)) ? item.created_at : latest;
    }, null);
    return { unread, pendingApprovals, actionNeeded, collaboration, todayCount, latestAt };
  }, [data]);

  const activeContextTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) tags.push(`Tim kiem: ${intentSearch.trim()}`);
    if (intentFilters.typeFilter !== 'ALL') tags.push(`Loai: ${TYPE_LABELS[intentFilters.typeFilter] || intentFilters.typeFilter}`);
    if (intentFilters.readFilter === 'UNREAD') tags.push('Trang thai: Chua doc');
    if (intentFilters.readFilter === 'READ') tags.push('Trang thai: Da doc');
    if (!liveSync) tags.push('Live sync: Tam dung');
    if (selectedViewPreset) tags.push(`Mau loc: ${selectedViewPreset.name}`);
    return tags;
  }, [intentFilters.readFilter, intentFilters.typeFilter, intentSearch, liveSync, selectedViewPreset]);

  const buildCurrentSnapshot = (): NotificationCenterViewSnapshot => ({
    searchInput,
    typeFilter,
    readFilter,
    liveSync,
  });

  const applySnapshot = (snapshot: NotificationCenterViewSnapshot) => {
    setSearchInput(snapshot.searchInput);
    setTypeFilter(snapshot.typeFilter);
    setReadFilter(snapshot.readFilter);
    setLiveSync(snapshot.liveSync);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...configRecord,
        saved_view: buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      message.success('Đã lưu chế độ xem thông báo.');
    } catch {
      message.error('Không thể lưu chế độ xem thông báo.');
    }
  };

  const applySavedView = () => {
    const savedView = parseNotificationCenterViewSnapshot(configRecord.saved_view);
    if (!savedView) {
      message.warning('Chưa có chế độ xem thông báo đã lưu.');
      return;
    }
    applySnapshot(savedView);
    message.success('Đã khôi phục chế độ xem thông báo.');
  };

  const saveNamedPreset = async () => {
    const trimmedName = viewPresetName.trim();
    if (!trimmedName) {
      message.warning('Nhập tên mẫu lọc thông báo.');
      return;
    }
    const snapshot = buildCurrentSnapshot();
    const presetId = selectedViewPreset?.id ?? `${Date.now()}`;
    const nextPresets = [
      ...namedPresets.filter((item) => item.id !== presetId),
      {
        id: presetId,
        name: trimmedName,
        snapshot,
        updatedAt: new Date().toISOString(),
      },
    ];
    try {
      await saveConfig({
        ...configRecord,
        saved_view: snapshot,
        saved_views: nextPresets,
      });
      setSelectedViewPresetId(presetId);
      setIsViewPresetModalOpen(false);
      setViewPresetName('');
      message.success('Đã lưu mẫu lọc thông báo.');
    } catch {
      message.error('Không thể lưu mẫu lọc thông báo.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      message.warning('Chọn một mẫu lọc thông báo để áp dụng.');
      return;
    }
    applySnapshot(preset.snapshot);
    message.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      message.warning('Chọn một mẫu lọc thông báo để xóa.');
      return;
    }
    const nextPresets = namedPresets.filter((item) => item.id !== preset.id);
    try {
      await saveConfig({
        ...configRecord,
        saved_view: configRecord.saved_view,
        saved_views: nextPresets,
      });
      setSelectedViewPresetId((current) => (current === preset.id ? undefined : current));
      message.success(`Đã xóa mẫu lọc "${preset.name}".`);
    } catch {
      message.error('Không thể xóa mẫu lọc thông báo.');
    }
  };

  const liveStatusMessage = (() => {
    if (!liveSync) return 'Theo dõi trực tiếp đang tắt.';
    if (liveQuery.isFetching) return 'Đang kiểm tra thông báo mới từ máy chủ.';
    if (liveQuery.data?.has_changes) {
      return `Có ${liveQuery.data.changed_count} thay đổi mới trong luồng thông báo.`;
    }
    return 'Luồng thông báo đang ổn định và được đồng bộ tự động.';
  })();
  const unreadTotal = unreadCountQuery.data?.count ?? stats.unread;
  const activeFilterCount =
    Number(Boolean(intentSearch.trim())) +
    Number(intentFilters.typeFilter !== 'ALL') +
    Number(intentFilters.readFilter !== 'ALL');
  const actionQueue = data.filter((item) => !item.is_read && needsAction(item.notification_type)).slice(0, 4);
  const approvalQueue = data.filter((item) => !item.is_read && item.notification_type === 'approval_request').slice(0, 4);
  const collaborationQueue = data.filter((item) => isConversationType(item.notification_type)).slice(0, 4);
  const systemQueue = data.filter((item) => item.notification_type === 'system').slice(0, 3);

  const openRelated = (item: NotificationItem) => {
    navigate(getNotificationTargetPath(item));
  };

  const columns: ColumnsType<NotificationItem> = [
    {
      title: 'Loại',
      key: 'type',
      width: 140,
      render: (_, r) => <Tag color={typeColor(r.notification_type)}>{TYPE_LABELS[r.notification_type] || r.notification_type}</Tag>,
    },
    {
      title: 'Thông báo',
      key: 'content',
      render: (_, r) => (
        <Space direction="vertical" size={2}>
          <Space size={6}>
            <Text strong>{r.title}</Text>
            {!r.is_read && <Badge color="#1677ff" text={<Text type="secondary">Mới</Text>} />}
            {!r.is_read && needsAction(r.notification_type) && <Tag color="volcano">Cần xử lý</Tag>}
          </Space>
          <Text type="secondary">{r.message}</Text>
          <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.4 }}>
            Tiếp theo: {getNotificationNextStep(r)}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Nguồn',
      key: 'meta',
      width: 230,
      render: (_, r) => (
        <Space direction="vertical" size={1}>
          <Text type="secondary">Người gửi: {r.actor_username || 'Hệ thống'}</Text>
          <Text type="secondary">
            {dayjs(r.created_at).format('DD/MM/YYYY HH:mm:ss')}
            {r.read_at ? ` • Đã đọc ${dayjs(r.read_at).format('DD/MM HH:mm')}` : ''}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 220,
      render: (_, r) => (
        <Space>
          {!r.is_read && (
            <Button size="small" loading={markReadMutation.isPending} onClick={() => markReadMutation.mutate(r.id)}>
              Đã đọc
            </Button>
          )}
          <Button size="small" type="primary" onClick={() => openRelated(r)}>
            {getNotificationTargetLabel(r)}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="command-center">
      <section className="command-center-hero">
        <div className="command-center-hero-grid">
          <div>
            <div className="command-center-eyebrow">Notification Control Desk</div>
            <div className="command-center-title">
              Gom toàn bộ thông báo, phê duyệt và trao đổi về một bàn điều phối duy nhất.
            </div>
            <div className="command-center-description">
              Trung tâm thông báo mới ưu tiên rõ việc cần hành động, trạng thái đồng bộ trực tiếp và những luồng trao đổi vừa phát sinh để đội vận hành không bỏ sót nhịp xử lý.
            </div>
            <div className="command-center-hero-badges">
              <div className="command-center-hero-badge">
                <span>Chưa đọc</span>
                <span className="command-center-hero-badge-value">{unreadTotal}</span>
              </div>
              <div className="command-center-hero-badge">
                <span>Cần xử lý</span>
                <span className="command-center-hero-badge-value">{stats.actionNeeded}</span>
              </div>
              <div className="command-center-hero-badge">
                <span>Chờ duyệt</span>
                <span className="command-center-hero-badge-value">{stats.pendingApprovals}</span>
              </div>
              <div className="command-center-hero-badge">
                <span>Trong bộ lọc</span>
                <span className="command-center-hero-badge-value">{data.length}</span>
              </div>
            </div>
            <div className="command-center-hero-actions" data-testid="notification-center-command-strip">
              <Button data-testid="notification-center-save-view" onClick={() => void saveCurrentView()}>
                Lưu chế độ xem
              </Button>
              <Button data-testid="notification-center-restore-view" onClick={applySavedView}>
                Khôi phục
              </Button>
              <Button
                data-testid="notification-center-open-preset-modal"
                onClick={() => {
                  setViewPresetName(selectedViewPreset?.name ?? '');
                  setIsViewPresetModalOpen(true);
                }}
              >
                Tạo mẫu lọc
              </Button>
              <div data-testid="notification-center-preset-select">
                <Select
                  style={{ width: 240 }}
                  placeholder="Chọn mẫu lọc thông báo"
                  value={selectedViewPresetId}
                  onChange={(value) => setSelectedViewPresetId(value)}
                  options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
                />
              </div>
              <Button data-testid="notification-center-apply-preset" onClick={applyNamedPreset}>
                Áp dụng mẫu
              </Button>
              <Button danger data-testid="notification-center-delete-preset" onClick={() => void deleteNamedPreset()}>
                Xóa mẫu
              </Button>
              <Button data-testid="notification-center-refresh" icon={<ReloadOutlined />} loading={listQuery.isFetching} onClick={() => listQuery.refetch()}>
                Tải lại
              </Button>
              <Button
                type="primary"
                loading={markAllMutation.isPending}
                onClick={() => markAllMutation.mutate()}
              >
                Đánh dấu tất cả
              </Button>
              <Button onClick={() => navigate('/task-inbox')}>
                Mở Task Inbox
              </Button>
              <Space size={8}>
                <Text style={{ color: 'rgba(226, 232, 240, 0.88)' }}>Theo dõi trực tiếp</Text>
                <Switch checked={liveSync} onChange={setLiveSync} />
              </Space>
            </div>
          </div>

          <div className="command-center-hero-meta">
            <div className="command-center-hero-card">
              <div className="command-center-hero-card-label">Trạng thái live sync</div>
              <div className="command-center-hero-card-value">{liveSync ? 'ON' : 'OFF'}</div>
              <div className="command-center-hero-card-caption">
                {liveStatusMessage}
                {liveQuery.data?.server_time
                  ? ` Máy chủ cập nhật lúc ${dayjs(liveQuery.data.server_time).format('DD/MM/YYYY HH:mm:ss')}.`
                  : ''}
              </div>
              <div className="command-center-hero-score-grid">
                <div className="command-center-hero-score">
                  <div className="command-center-hero-score-label">Tương tác</div>
                  <div className="command-center-hero-score-value">{stats.collaboration}</div>
                  <div className="command-center-hero-score-caption">Mention và comment đang hiển thị.</div>
                </div>
                <div className="command-center-hero-score">
                  <div className="command-center-hero-score-label">Hôm nay</div>
                  <div className="command-center-hero-score-value">{stats.todayCount}</div>
                  <div className="command-center-hero-score-caption">Thông báo phát sinh trong ngày.</div>
                </div>
                <div className="command-center-hero-score">
                  <div className="command-center-hero-score-label">Bộ lọc</div>
                  <div className="command-center-hero-score-value">{activeFilterCount}</div>
                  <div className="command-center-hero-score-caption">Điều kiện lọc đang được áp dụng.</div>
                </div>
                <div className="command-center-hero-score">
                  <div className="command-center-hero-score-label">Mới nhất</div>
                  <div className="command-center-hero-score-value">{stats.latestAt ? dayjs(stats.latestAt).format('HH:mm') : '--:--'}</div>
                  <div className="command-center-hero-score-caption">Mốc thông báo gần nhất trong danh sách.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="workspace-split-grid">
        <section className="command-center-panel">
          <div className="command-center-panel-header">
            <div>
              <div className="command-center-panel-kicker">Notification Stream</div>
              <div className="command-center-panel-title">Lọc, rà soát và xử lý thông báo</div>
              <div className="command-center-panel-subtitle">
                {activeFilterCount > 0
                  ? `Đang áp dụng ${activeFilterCount} điều kiện để tập trung vào nhóm thông báo quan trọng hơn.`
                  : 'Danh sách đang mở toàn phần để bạn nhìn được bức tranh chung của mọi luồng thông báo.'}
              </div>
            </div>
            <div className="workspace-pill">
              {liveSync ? (liveQuery.isFetching ? 'Live checking' : 'Live active') : 'Live off'}
            </div>
          </div>

          {liveSync ? (
            <Alert
              showIcon
              style={{ marginBottom: 18 }}
              type={liveQuery.data?.has_changes ? 'info' : 'success'}
              message={liveStatusMessage}
              description={
                liveQuery.data?.server_time
                  ? `Máy chủ cập nhật lúc ${dayjs(liveQuery.data.server_time).format('DD/MM/YYYY HH:mm:ss')}.`
                  : 'Hệ thống sẽ tiếp tục tự kiểm tra trong lúc bạn đang mở màn hình này.'
              }
            />
          ) : null}

          <div className="workspace-toolbar" style={{ marginBottom: 18 }}>
            <div className="workspace-toolbar-group">
              <Input
                data-testid="notification-center-search"
                className="workspace-filter-input"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Tìm theo tiêu đề hoặc nội dung"
                suffix={searchInput ? <QuickClearIcon onClear={() => setSearchInput('')} title="Xóa tìm kiếm" /> : undefined}
              />
              <Select
                data-testid="notification-center-type-filter"
                value={typeFilter}
                onChange={setTypeFilter}
                style={{ width: 170 }}
                options={[
                  { value: 'ALL', label: 'Mọi loại' },
                  ...Object.entries(TYPE_LABELS).map(([key, value]) => ({ value: key, label: value })),
                ]}
              />
              <Select<ReadFilter>
                data-testid="notification-center-read-filter"
                value={readFilter}
                onChange={setReadFilter}
                style={{ width: 140 }}
                options={[
                  { value: 'ALL', label: 'Tất cả' },
                  { value: 'UNREAD', label: 'Chưa đọc' },
                  { value: 'READ', label: 'Đã đọc' },
                ]}
              />
            </div>

            <div className="workspace-toolbar-group">
              <Button
                icon={<CheckOutlined />}
                disabled={!selectedIds.length}
                loading={markManyMutation.isPending}
                onClick={() => markManyMutation.mutate(selectedIds)}
              >
                Đánh dấu đã chọn
              </Button>
              <Button loading={markAllMutation.isPending} onClick={() => markAllMutation.mutate()}>
                Đánh dấu tất cả
              </Button>
              <Button onClick={() => navigate('/workflow-pipeline')}>
                Mở workflow
              </Button>
            </div>
          </div>

          <Space wrap style={{ marginBottom: 18 }}>
            {activeContextTags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Space>

          {listQuery.isLoading ? (
            <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
          ) : !data.length ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={(
                <Space direction="vertical" size={2}>
                  <Text>Chưa có thông báo phù hợp.</Text>
                  <Text type="secondary">Thử bỏ bộ lọc hoặc mở inbox nhiệm vụ để kiểm tra các việc đang chờ xử lý.</Text>
                </Space>
              )}
            />
          ) : (
            <Table<NotificationItem>
              rowKey="id"
              size="small"
              rowSelection={rowSelection}
              columns={columns}
              dataSource={data}
              pagination={{ pageSize: 20, showSizeChanger: true }}
            />
          )}
        </section>

        <div className="command-center-stack">
          <section className="command-center-panel">
            <div className="command-center-panel-header">
              <div>
                <div className="command-center-panel-kicker">Action Queue</div>
                <div className="command-center-panel-title">Cần xử lý ngay</div>
                <div className="command-center-panel-subtitle">
                  Những thông báo chưa đọc yêu cầu phản hồi hoặc điều hướng sang tác vụ liên quan.
                </div>
              </div>
            </div>
            <div className="command-center-playbook">
              {actionQueue.length === 0 ? (
                <div className="command-center-empty">Không có thông báo nào đang yêu cầu hành động khẩn trong bộ lọc hiện tại.</div>
              ) : actionQueue.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="command-center-playbook-item"
                  onClick={() => openRelated(item)}
                >
                  <div className="command-center-playbook-title">{item.title}</div>
                  <div className="command-center-playbook-detail">{item.message}</div>
                  <div className="workspace-inline-note">
                    {TYPE_LABELS[item.notification_type] || item.notification_type} • {dayjs(item.created_at).format('DD/MM HH:mm')}
                  </div>
                  <div className="workspace-inline-note">
                    Tiếp theo: {getNotificationNextStep(item)}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="command-center-panel">
            <div className="command-center-panel-header">
              <div>
                <div className="command-center-panel-kicker">Approval Queue</div>
                <div className="command-center-panel-title">Chờ phê duyệt</div>
                <div className="command-center-panel-subtitle">
                  Gom riêng các yêu cầu duyệt để bạn xử lý theo lô thay vì lẫn trong dòng thông báo chung.
                </div>
              </div>
            </div>
            <div className="command-center-watchlist">
              {approvalQueue.length === 0 ? (
                <div className="command-center-empty">Hiện chưa có yêu cầu phê duyệt chưa đọc trong danh sách này.</div>
              ) : approvalQueue.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="command-center-watch-item command-center-watch-item--warning"
                  onClick={() => openRelated(item)}
                  style={{ textAlign: 'left', cursor: 'pointer' }}
                >
                  <div className="command-center-watch-title">{item.title}</div>
                  <div className="command-center-watch-detail">{item.message}</div>
                  <div className="workspace-inline-note">{dayjs(item.created_at).format('DD/MM/YYYY HH:mm')}</div>
                  <div className="workspace-inline-note">
                    Tiếp theo: {getNotificationNextStep(item)}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="command-center-panel">
            <div className="command-center-panel-header">
              <div>
                <div className="command-center-panel-kicker">Collaboration Feed</div>
                <div className="command-center-panel-title">Trao đổi và hệ thống</div>
                <div className="command-center-panel-subtitle">
                  Nhìn nhanh các luồng mention, comment và thông báo hệ thống mới nhất để không bỏ rơi bối cảnh cộng tác.
                </div>
              </div>
            </div>
            <div className="workspace-list-stack">
              {collaborationQueue.length === 0 && systemQueue.length === 0 ? (
                <div className="command-center-empty">Chưa có tương tác cộng tác hoặc thông báo hệ thống nổi bật trong bộ lọc hiện tại.</div>
              ) : (
                <>
                  {collaborationQueue.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="command-center-playbook-item"
                      onClick={() => openRelated(item)}
                    >
                      <div className="command-center-playbook-title">{item.title}</div>
                      <div className="command-center-playbook-detail">{item.message}</div>
                      <div className="workspace-inline-note">
                        {item.actor_username || 'Hệ thống'} • {dayjs(item.created_at).format('DD/MM HH:mm')}
                      </div>
                      <div className="workspace-inline-note">
                        Tiếp theo: {getNotificationNextStep(item)}
                      </div>
                    </button>
                  ))}
                  {systemQueue.map((item) => (
                    <div key={item.id} className="command-center-watch-item command-center-watch-item--steady">
                      <div className="command-center-watch-title">{item.title}</div>
                      <div className="command-center-watch-detail">{item.message}</div>
                      <div className="workspace-inline-note">{dayjs(item.created_at).format('DD/MM/YYYY HH:mm')}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </section>
        </div>
      <Modal
        title="Lưu mẫu lọc thông báo"
        open={isViewPresetModalOpen}
        onCancel={() => {
          setIsViewPresetModalOpen(false);
          setViewPresetName('');
        }}
        onOk={() => void saveNamedPreset()}
        okText="Lưu mẫu"
        cancelText="Đóng"
      >
        <Input
          data-testid="notification-center-preset-name"
          value={viewPresetName}
          onChange={(event) => setViewPresetName(event.target.value)}
          placeholder="Ví dụ: Thông báo cần xử lý trong ca"
        />
      </Modal>
      </div>
    </div>
  );
}
