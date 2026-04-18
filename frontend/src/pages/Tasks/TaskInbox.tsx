import { Suspense, lazy, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Input, Modal, Segmented, Select, Space, Spin, Switch, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EyeOutlined, InboxOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, tasksApi, type TaskItem, type TaskPriority, type TaskStatus } from '../../api/tasks';
import { getUserDisplayName, usersApi } from '../../api/users';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { SafeText as Text } from '../../components/SafeText';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { useRowSelection } from '../../hooks/useRowSelection';
import { getEntityTypeLabel, PAGES } from '../../utils/constants';
import { storage } from '../../utils/storage';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useRealtimePollingInterval } from '../../hooks/useRealtimePollingInterval';

type InboxTab = 'ASSIGNED' | 'CREATED' | 'WATCHING' | 'TEAM' | 'OVERDUE';
type SortMode = 'SMART' | 'DUE_ASC' | 'DUE_DESC' | 'UPDATED_DESC';
type InboxFilterSnapshot = {
  tab: InboxTab;
  search: string;
  status_filter: 'ALL' | TaskStatus;
  priority_filter: 'ALL' | TaskPriority;
  sort_mode: SortMode;
  auto_refresh: boolean;
  live_sync: boolean;
};
type InboxNamedPreset = {
  id: string;
  name: string;
  filters: InboxFilterSnapshot;
};
type BulkHistoryAction = 'START' | 'COMPLETE' | 'REMIND_OVERDUE' | 'REASSIGN';
type BulkHistoryItem = {
  id: string;
  action: BulkHistoryAction;
  action_label: string;
  selected_count: number;
  processed_count: number;
  success_count: number;
  failed_count: number;
  reminder_sent_count?: number;
  created_at: string;
};
type BulkHistoryResultFilter = 'ALL' | 'SUCCESS' | 'HAS_ERROR';
const TaskWorkspaceModalLazy = lazy(() => import('../../components/TaskWorkspaceModal/TaskWorkspaceModal'));

const SUMMARY_TILE_STYLE = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: '14px 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
};

const INBOX_TAB_LABELS: Record<InboxTab, string> = {
  ASSIGNED: 'Giao cho tôi',
  CREATED: 'Tạo bởi tôi',
  WATCHING: 'Tôi theo dõi',
  TEAM: 'Nhóm của tôi',
  OVERDUE: 'Quá hạn',
};

const SORT_MODE_LABELS: Record<SortMode, string> = {
  SMART: 'Sắp xếp thông minh',
  DUE_ASC: 'Hạn gần nhất trước',
  DUE_DESC: 'Hạn xa nhất trước',
  UPDATED_DESC: 'Cập nhật mới nhất',
};

function parseInboxSnapshot(value: unknown): InboxFilterSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const tab = obj.tab;
  const statusFilter = obj.status_filter;
  const priorityFilter = obj.priority_filter;
  const sortMode = obj.sort_mode;
  if (
    (tab !== 'ASSIGNED' && tab !== 'CREATED' && tab !== 'WATCHING' && tab !== 'TEAM' && tab !== 'OVERDUE')
    || (statusFilter !== 'ALL' && statusFilter !== 'TODO' && statusFilter !== 'IN_PROGRESS')
    || (priorityFilter !== 'ALL' && priorityFilter !== 'LOW' && priorityFilter !== 'MEDIUM' && priorityFilter !== 'HIGH' && priorityFilter !== 'URGENT')
    || (sortMode !== 'SMART' && sortMode !== 'DUE_ASC' && sortMode !== 'DUE_DESC' && sortMode !== 'UPDATED_DESC')
  ) {
    return null;
  }
  return {
    tab,
    search: typeof obj.search === 'string' ? obj.search : '',
    status_filter: statusFilter,
    priority_filter: priorityFilter,
    sort_mode: sortMode,
    auto_refresh: obj.auto_refresh !== false,
    live_sync: obj.live_sync !== false,
  };
}

function canManageBulkByRole(): boolean {
  const user = storage.getUser() as unknown;
  if (!user || typeof user !== 'object') return false;
  const u = user as Record<string, unknown>;
  if (u.is_superuser === true || u.is_staff === true) return true;
  const roles = Array.isArray(u.roles) ? u.roles : [];
  const roleNames = roles
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const roleObj = item as Record<string, unknown>;
      return String(roleObj.name ?? roleObj.code ?? '').toLowerCase();
    })
    .filter(Boolean);
  return roleNames.some((name) => ['admin', 'manager', 'quan-ly', 'quanly'].includes(name));
}

export default function TaskInbox() {
  const [tab, setTab] = useState<InboxTab>('ASSIGNED');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | TaskStatus>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<'ALL' | TaskPriority>('ALL');
  const [sortMode, setSortMode] = useState<SortMode>('SMART');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [liveSync, setLiveSync] = useState(true);
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [selected, setSelected] = useState<TaskItem | null>(null);
  const [bulkInProgress, setBulkInProgress] = useState<BulkHistoryAction | null>(null);
  const [bulkHistoryActionFilter, setBulkHistoryActionFilter] = useState<'ALL' | BulkHistoryAction>('ALL');
  const [bulkHistoryResultFilter, setBulkHistoryResultFilter] = useState<BulkHistoryResultFilter>('ALL');
  const [bulkReassignOpen, setBulkReassignOpen] = useState(false);
  const [bulkReassignTo, setBulkReassignTo] = useState<number | null>(null);
  const [bulkReassignNote, setBulkReassignNote] = useState('');
  const [bulkReassignSearch, setBulkReassignSearch] = useState('');
  const canBulkManage = useMemo(() => canManageBulkByRole(), []);
  const { selectedIds, rowSelection, clearSelection } = useRowSelection<TaskItem>();
  const {
    config: savedConfig,
    saveConfig,
    isLoading: isPreferencesLoading,
  } = useUserPreferences(PAGES.TASK_INBOX);
  const queryClient = useQueryClient();
  const liveSinceRef = useRef<string | null>(null);
  const {
    intentSearch,
    intentFilters,
  } = useSearchFilterIntent({
    searchInput: q,
    filterValues: { tab },
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters: (f) => f.tab,
    parseFilters: (v) => ({
      tab: (v === 'ASSIGNED' || v === 'CREATED' || v === 'WATCHING' || v === 'TEAM' || v === 'OVERDUE'
        ? v
        : 'ASSIGNED') as InboxTab,
    }),
  });
  const autoRefreshPollingInterval = useRealtimePollingInterval({
    enabled: autoRefresh && !liveSync,
    activeMs: 15_000,
    hiddenMs: false,
  });
  const livePollingInterval = useRealtimePollingInterval({
    enabled: liveSync,
    activeMs: 10_000,
    hiddenMs: false,
  });

  const summaryQuery = useQuery({
    queryKey: ['task-inbox-summary'],
    queryFn: () => tasksApi.mySummary(),
    staleTime: 10_000,
  });

  const tasksQuery = useQuery({
    queryKey: ['task-inbox-list', intentFilters.tab, intentSearch],
    queryFn: () => {
      const baseParams = {
        is_open: true,
        q: intentSearch.trim() || undefined,
        ordering_mode: 'quick_queue' as const,
      };
      if (intentFilters.tab === 'ASSIGNED') return tasksApi.list({ ...baseParams, mine: true });
      if (intentFilters.tab === 'CREATED') return tasksApi.list({ ...baseParams, created_by_me: true });
      if (intentFilters.tab === 'WATCHING') return tasksApi.list({ ...baseParams, watching: true });
      if (intentFilters.tab === 'TEAM') return tasksApi.list({ ...baseParams, team_members: true });
      return tasksApi.list({ ...baseParams, is_overdue: true });
    },
    staleTime: 5_000,
    refetchInterval: autoRefreshPollingInterval,
    refetchIntervalInBackground: false,
  });
  const bulkReassignUsersQuery = useQuery({
    queryKey: ['task-bulk-reassign-users', bulkReassignSearch],
    queryFn: () => usersApi.list({ search: bulkReassignSearch.trim() || undefined, is_active: true }),
    staleTime: 30_000,
  });
  const liveQueryParams = useMemo(() => {
    const base = {
      is_open: true,
      q: intentSearch.trim() || undefined,
      ordering_mode: 'quick_queue' as const,
    };
    if (intentFilters.tab === 'ASSIGNED') return { ...base, mine: true };
    if (intentFilters.tab === 'CREATED') return { ...base, created_by_me: true };
    if (intentFilters.tab === 'WATCHING') return { ...base, watching: true };
    if (intentFilters.tab === 'TEAM') return { ...base, team_members: true };
    return { ...base, is_overdue: true };
  }, [intentFilters.tab, intentSearch]);
  const taskLiveUpdatesQuery = useQuery({
    queryKey: ['task-live-updates', liveSync, intentFilters.tab, intentSearch],
    queryFn: () => tasksApi.liveUpdates({
      ...liveQueryParams,
      since: liveSinceRef.current || undefined,
    }),
    enabled: liveSync,
    refetchInterval: livePollingInterval,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
  useEffect(() => {
    liveSinceRef.current = null;
  }, [intentFilters.tab, intentSearch, liveSync]);
  useEffect(() => {
    const payload = taskLiveUpdatesQuery.data;
    if (!payload) return;
    if (payload.latest_at) {
      liveSinceRef.current = payload.latest_at;
    } else if (!liveSinceRef.current) {
      liveSinceRef.current = dayjs().toISOString();
    }
    if (payload.has_changes) {
      void queryClient.invalidateQueries({ queryKey: ['task-inbox-list'] });
      void queryClient.invalidateQueries({ queryKey: ['task-inbox-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['task-bulk-history'] });
    }
  }, [queryClient, taskLiveUpdatesQuery.data]);

  const watchMutation = useMutation({
    mutationFn: ({ id, watching }: { id: number; watching: boolean }) =>
      (watching ? tasksApi.unwatch(id) : tasksApi.watch(id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['task-inbox-list'] });
      void queryClient.invalidateQueries({ queryKey: ['task-inbox-summary'] });
    },
    onError: () => message.error('Không thể cập nhật trạng thái theo dõi.'),
  });

  const data = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const filteredData = useMemo(() => {
    const today = dayjs();
    const openStatuses: TaskStatus[] = ['TODO', 'IN_PROGRESS'];
    const base = data.filter((item) => openStatuses.includes(item.status));
    const withOverdueRule = tab === 'OVERDUE'
      ? base.filter((item) => !!item.due_date && dayjs(item.due_date).isBefore(today, 'day'))
      : base;
    const withStatus = statusFilter === 'ALL'
      ? withOverdueRule
      : withOverdueRule.filter((item) => item.status === statusFilter);
    const withPriority = priorityFilter === 'ALL'
      ? withStatus
      : withStatus.filter((item) => item.priority === priorityFilter);
    const arr = [...withPriority];
    if (sortMode === 'DUE_ASC') {
      arr.sort((a, b) => (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31'));
    } else if (sortMode === 'DUE_DESC') {
      arr.sort((a, b) => (b.due_date || '').localeCompare(a.due_date || ''));
    } else if (sortMode === 'UPDATED_DESC') {
      arr.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    }
    return arr;
  }, [data, tab, statusFilter, priorityFilter, sortMode]);
  const deferredFilteredData = useDeferredValue(filteredData);
  const selectedEffectiveIds = useMemo(() => {
    const idSet = new Set(deferredFilteredData.map((x) => x.id));
    return selectedIds.filter((id) => idSet.has(id));
  }, [deferredFilteredData, selectedIds]);
  const namedPresets = useMemo(() => {
    const raw = savedConfig?.inbox_saved_views;
    if (!Array.isArray(raw)) return [] as InboxNamedPreset[];
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const obj = item as Record<string, unknown>;
        const id = typeof obj.id === 'string' ? obj.id : '';
        const name = typeof obj.name === 'string' ? obj.name : '';
        const filters = parseInboxSnapshot(obj.filters);
        if (!id || !name || !filters) return null;
        return {
          id,
          name,
          filters,
        } as InboxNamedPreset;
      })
      .filter((v): v is InboxNamedPreset => v !== null);
  }, [savedConfig?.inbox_saved_views]);
  const savedViewSnapshot = useMemo(() => {
    const directSnapshot = parseInboxSnapshot((savedConfig as Record<string, unknown>)?.saved_view_snapshot);
    if (directSnapshot) return directSnapshot;
    return parseInboxSnapshot({
      tab: savedConfig?.inbox_tab,
      search: savedConfig?.inbox_search,
      status_filter: savedConfig?.inbox_status_filter,
      priority_filter: savedConfig?.inbox_priority_filter,
      sort_mode: savedConfig?.inbox_sort_mode,
      auto_refresh: savedConfig?.inbox_auto_refresh,
      live_sync: savedConfig?.inbox_live_sync,
    });
  }, [savedConfig]);
  const bulkHistoryQuery = useQuery({
    queryKey: ['task-bulk-history', bulkHistoryActionFilter, bulkHistoryResultFilter],
    queryFn: () => tasksApi.bulkHistory({
      action: bulkHistoryActionFilter,
      result: bulkHistoryResultFilter,
      limit: 50,
    }),
    staleTime: 5_000,
  });
  const bulkHistory = useMemo(() => {
    const items = bulkHistoryQuery.data?.items ?? [];
    return items.map((item) => ({
      id: item.id,
      action: item.action as BulkHistoryAction,
      action_label: item.action_label,
      selected_count: item.selected_count,
      processed_count: item.processed_count,
      success_count: item.success_count,
      failed_count: item.failed_count,
      reminder_sent_count: item.reminder_sent_count,
      created_at: item.created_at,
    })) as BulkHistoryItem[];
  }, [bulkHistoryQuery.data?.items]);
  const visibleBulkHistory = useMemo(() => {
    return bulkHistory;
  }, [bulkHistory]);
  const selectedPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedPresetId) ?? null,
    [namedPresets, selectedPresetId]
  );
  const inboxMetrics = useMemo(() => {
    const startOfToday = dayjs().startOf('day');
    return filteredData.reduce((acc, item) => {
      const isOpen = item.status === 'TODO' || item.status === 'IN_PROGRESS';
      const dueDate = item.due_date ? dayjs(item.due_date) : null;
      acc.total += 1;
      if (!item.assigned_to) acc.unassigned += 1;
      if (item.priority === 'HIGH' || item.priority === 'URGENT') acc.hot += 1;
      if (item.needs_help && isOpen) acc.needHelp += 1;
      if (item.is_blocking && isOpen) acc.blocking += 1;
      if (dueDate && dueDate.isSame(startOfToday, 'day') && isOpen) acc.dueToday += 1;
      if (dueDate && dueDate.isBefore(startOfToday, 'day') && isOpen) acc.overdue += 1;
      return acc;
    }, {
      total: 0,
      overdue: 0,
      dueToday: 0,
      needHelp: 0,
      blocking: 0,
      hot: 0,
      unassigned: 0,
    });
  }, [filteredData]);
  const bulkHistoryMetrics = useMemo(() => {
    return visibleBulkHistory.reduce((acc, item) => {
      acc.total += 1;
      if (item.failed_count > 0) acc.withErrors += 1;
      if ((item.reminder_sent_count ?? 0) > 0) acc.reminderRuns += 1;
      acc.processed += item.processed_count;
      return acc;
    }, {
      total: 0,
      withErrors: 0,
      reminderRuns: 0,
      processed: 0,
    });
  }, [visibleBulkHistory]);
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (q.trim()) tags.push(`Từ khóa: ${q.trim()}`);
    if (statusFilter !== 'ALL') tags.push(`Trạng thái: ${TASK_STATUS_LABELS[statusFilter]}`);
    if (priorityFilter !== 'ALL') tags.push(`Ưu tiên: ${TASK_PRIORITY_LABELS[priorityFilter]}`);
    if (sortMode !== 'SMART') tags.push(`Sắp xếp: ${SORT_MODE_LABELS[sortMode]}`);
    if (selectedPreset) tags.push(`Mẫu đang chọn: ${selectedPreset.name}`);
    return tags;
  }, [priorityFilter, q, selectedPreset, sortMode, statusFilter]);

  const refreshInbox = () => {
    void queryClient.invalidateQueries({ queryKey: ['task-inbox-list'] });
    void queryClient.invalidateQueries({ queryKey: ['task-inbox-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['task-bulk-history'] });
  };

  const appendBulkHistory = async (item: BulkHistoryItem) => {
    // Legacy no-op: đã chuyển lịch sử bulk sang backend.
    void item;
  };

  const runBulkAction = async (action: BulkHistoryAction) => {
    if (!canBulkManage) {
      message.error('Bạn không có quyền thao tác hàng loạt.');
      return;
    }
    if (!selectedEffectiveIds.length) {
      message.warning('Vui lòng chọn ít nhất 1 nhiệm vụ.');
      return;
    }
    const selectedMap = new Map(filteredData.map((x) => [x.id, x]));
    const selectedTargets = selectedEffectiveIds
      .map((id) => selectedMap.get(id))
      .filter((item): item is TaskItem => !!item);
    if (!selectedTargets.length) {
      message.warning('Không có nhiệm vụ hợp lệ để thao tác.');
      return;
    }

    const actionName = action === 'START'
      ? 'Bắt đầu'
      : action === 'COMPLETE'
        ? 'Hoàn thành'
        : action === 'REMIND_OVERDUE'
          ? 'Nhắc quá hạn'
          : 'Chuyển người xử lý';
    const confirmed = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: `${actionName} hàng loạt`,
        content: `Bạn có chắc muốn ${actionName.toLowerCase()} ${selectedTargets.length} nhiệm vụ đã chọn không?`,
        okText: 'Xác nhận',
        cancelText: 'Hủy',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!confirmed) return;
    setBulkInProgress(action);
    let result: Awaited<ReturnType<typeof tasksApi.bulkAction>> | null = null;
    try {
      result = await tasksApi.bulkAction({
        action,
        task_ids: selectedTargets.map((item) => item.id),
      });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (err as { message?: string })?.message
        || 'Không thể chạy thao tác hàng loạt.';
      message.error(msg);
      setBulkInProgress(null);
      return;
    }
    setBulkInProgress(null);
    if (!result) return;
    const successCount = result.success_count;
    const failedCount = result.failed_count;
    const reminderSentCount = action === 'REMIND_OVERDUE' ? result.reminder_sent_count : undefined;
    const failedDetails = result.items
      .filter((item) => !item.success)
      .map((item) => {
        const title = selectedMap.get(item.task_id)?.title || 'Nhiệm vụ';
        return `#${item.task_id} - ${title}: ${item.message || 'Lỗi không xác định'}`;
      });
    if (failedCount > 0) {
      message.warning(`${actionName} hàng loạt: thành công ${successCount}, lỗi ${failedCount}.`);
      Modal.warning({
        title: `Chi tiết lỗi ${actionName.toLowerCase()} hàng loạt`,
        width: 760,
        content: (
          <div style={{ maxHeight: 280, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
            {failedDetails.join('\n')}
          </div>
        ),
      });
    } else {
      message.success(`${actionName} hàng loạt thành công ${successCount} nhiệm vụ.`);
    }
    try {
      await appendBulkHistory({
        id: `${Date.now()}`,
        action,
        action_label: actionName,
        selected_count: selectedEffectiveIds.length,
        processed_count: result.processed_count,
        success_count: successCount,
        failed_count: failedCount,
        reminder_sent_count: reminderSentCount,
        created_at: dayjs().toISOString(),
      });
    } catch {
      // Không chặn luồng chính nếu lưu lịch sử thất bại.
    }
    clearSelection();
    refreshInbox();
  };

  const runBulkReassign = async () => {
    if (!canBulkManage) {
      message.error('Bạn không có quyền thao tác hàng loạt.');
      return;
    }
    if (!selectedEffectiveIds.length) {
      message.warning('Vui lòng chọn ít nhất 1 nhiệm vụ.');
      return;
    }
    if (!bulkReassignTo) {
      message.warning('Vui lòng chọn người xử lý mới.');
      return;
    }
    const selectedMap = new Map(filteredData.map((x) => [x.id, x]));
    const selectedTargets = selectedEffectiveIds
      .map((id) => selectedMap.get(id))
      .filter((item): item is TaskItem => !!item);
    if (!selectedTargets.length) {
      message.warning('Không có nhiệm vụ hợp lệ để chuyển giao.');
      return;
    }
    const targetUser = (bulkReassignUsersQuery.data ?? []).find((item) => item.id === bulkReassignTo);
    const targetName = targetUser ? getUserDisplayName(targetUser) : `#${bulkReassignTo}`;
    const confirmed = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: 'Chuyển người xử lý hàng loạt',
        content: `Bạn có chắc muốn chuyển ${selectedTargets.length} nhiệm vụ đã chọn sang ${targetName} không?`,
        okText: 'Xác nhận',
        cancelText: 'Hủy',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!confirmed) return;
    setBulkInProgress('REASSIGN');
    try {
      const result = await tasksApi.bulkAction({
        action: 'REASSIGN',
        task_ids: selectedTargets.map((item) => item.id),
        assigned_to: bulkReassignTo,
        note: bulkReassignNote.trim() || undefined,
      });
      const failedDetails = result.items
        .filter((item) => !item.success)
        .map((item) => {
          const title = selectedMap.get(item.task_id)?.title || 'Nhiệm vụ';
          return `#${item.task_id} - ${title}: ${item.message || 'Lỗi không xác định'}`;
        });
      if (result.failed_count > 0) {
        message.warning(`Chuyển người hàng loạt: thành công ${result.success_count}, lỗi ${result.failed_count}.`);
        Modal.warning({
          title: 'Chi tiết lỗi chuyển người hàng loạt',
          width: 760,
          content: (
            <div style={{ maxHeight: 280, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
              {failedDetails.join('\n')}
            </div>
          ),
        });
      } else {
        message.success(`Đã chuyển ${result.success_count} nhiệm vụ sang ${targetName}.`);
      }
      setBulkReassignOpen(false);
      setBulkReassignTo(null);
      setBulkReassignNote('');
      setBulkReassignSearch('');
      clearSelection();
      refreshInbox();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (err as { message?: string })?.message
        || 'Không thể chuyển người xử lý hàng loạt.';
      message.error(msg);
    } finally {
      setBulkInProgress(null);
    }
  };

  const exportFilteredCsv = () => {
    if (!filteredData.length) {
      message.warning('Không có dữ liệu để xuất CSV.');
      return;
    }
    const headers = [
      'id',
      'doi_tuong',
      'ma_doi_tuong',
      'nhiem_vu',
      'trang_thai',
      'uu_tien',
      'nguoi_xu_ly',
      'han',
      'tre_ngay',
      'theo_doi',
    ];
    const rows = filteredData.map((item) => {
      const overdueDays = item.due_date
        ? Math.max(0, dayjs().startOf('day').diff(dayjs(item.due_date), 'day'))
        : 0;
      return [
        String(item.id),
        getEntityTypeLabel(item.entity_type),
        item.entity_code || String(item.entity_id),
        item.title || '',
        item.status_display || '',
        TASK_PRIORITY_LABELS[item.priority as TaskPriority] || item.priority || '',
        item.assigned_to_info?.full_name || 'Chưa giao',
        item.due_date ? dayjs(item.due_date).format('DD/MM/YYYY') : '',
        String(overdueDays),
        String(item.watchers_count ?? 0),
      ];
    });
    const escapeCell = (value: string) => `"${String(value).replace(/"/g, '""')}"`;
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => escapeCell(cell)).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nhiem_vu_cua_toi_${dayjs().format('YYYYMMDD_HHmmss')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    message.success('Đã xuất CSV theo bộ lọc hiện tại.');
  };
  const exportFilteredExcel = () => {
    if (!filteredData.length) {
      message.warning('Không có dữ liệu để xuất Excel.');
      return;
    }
    const headers = [
      'ID',
      'Đối tượng',
      'Mã đối tượng',
      'Nhiệm vụ',
      'Trạng thái',
      'Ưu tiên',
      'Người xử lý',
      'Hạn',
      'Trễ (ngày)',
      'Theo dõi',
    ];
    const rows = filteredData.map((item) => {
      const overdueDays = item.due_date
        ? Math.max(0, dayjs().startOf('day').diff(dayjs(item.due_date), 'day'))
        : 0;
      return [
        String(item.id),
        getEntityTypeLabel(item.entity_type),
        item.entity_code || String(item.entity_id),
        item.title || '',
        item.status_display || '',
        TASK_PRIORITY_LABELS[item.priority as TaskPriority] || item.priority || '',
        item.assigned_to_info?.full_name || 'Chưa giao',
        item.due_date ? dayjs(item.due_date).format('DD/MM/YYYY') : '',
        String(overdueDays),
        String(item.watchers_count ?? 0),
      ];
    });
    const tsv = [headers, ...rows]
      .map((row) => row.map((cell) => String(cell).replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t'))
      .join('\n');
    const blob = new Blob([`\uFEFF${tsv}`], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nhiem_vu_cua_toi_${dayjs().format('YYYYMMDD_HHmmss')}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    message.success('Đã xuất Excel theo bộ lọc hiện tại.');
  };
  const exportBulkHistoryCsv = () => {
    if (!visibleBulkHistory.length) {
      message.warning('Không có lịch sử thao tác hàng loạt để xuất.');
      return;
    }
    const headers = [
      'thoi_gian',
      'hanh_dong',
      'da_chon',
      'da_xu_ly',
      'thanh_cong',
      'that_bai',
      'thong_bao_gui',
    ];
    const rows = visibleBulkHistory.map((item) => [
      dayjs(item.created_at).format('DD/MM/YYYY HH:mm:ss'),
      item.action_label,
      String(item.selected_count),
      String(item.processed_count),
      String(item.success_count),
      String(item.failed_count),
      String(item.reminder_sent_count ?? 0),
    ]);
    const escapeCell = (value: string) => `"${String(value).replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lich_su_thao_tac_hang_loat_${dayjs().format('YYYYMMDD_HHmmss')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    message.success('Đã xuất CSV lịch sử thao tác hàng loạt.');
  };

  const saveCurrentView = async () => {
    try {
      const currentSnapshot = buildCurrentSnapshot();
      await saveConfig({
        ...savedConfig,
        inbox_search: q,
        inbox_tab: tab,
        inbox_status_filter: statusFilter,
        inbox_priority_filter: priorityFilter,
        inbox_sort_mode: sortMode,
        inbox_auto_refresh: autoRefresh,
        inbox_live_sync: liveSync,
        saved_view_snapshot: currentSnapshot,
        inbox_saved_views: namedPresets,
      });
      message.success('Đã lưu chế độ xem cá nhân.');
    } catch {
      message.error('Không thể lưu chế độ xem cá nhân.');
    }
  };

  const applySavedView = () => {
    if (!savedViewSnapshot) {
      message.warning('Chưa có chế độ xem đã lưu.');
      return;
    }
    applySnapshot(savedViewSnapshot);
    message.success('Đã áp dụng chế độ xem đã lưu.');
  };
  const buildCurrentSnapshot = (): InboxFilterSnapshot => ({
    tab,
    search: q,
    status_filter: statusFilter,
    priority_filter: priorityFilter,
    sort_mode: sortMode,
    auto_refresh: autoRefresh,
    live_sync: liveSync,
  });
  const applySnapshot = (snapshot: InboxFilterSnapshot) => {
    setTab(snapshot.tab);
    setQ(snapshot.search);
    setStatusFilter(snapshot.status_filter);
    setPriorityFilter(snapshot.priority_filter);
    setSortMode(snapshot.sort_mode);
    setAutoRefresh(snapshot.auto_refresh);
    setLiveSync(snapshot.live_sync);
  };
  const saveNamedPreset = async () => {
    const name = presetName.trim();
    if (!name) {
      message.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const nextPreset: InboxNamedPreset = existing
      ? { ...existing, name, filters: currentSnapshot }
      : { id: `${Date.now()}`, name, filters: currentSnapshot };
    const nextPresets = existing
      ? namedPresets.map((p) => (p.id === existing.id ? nextPreset : p))
      : [...namedPresets, nextPreset];
    try {
      await saveConfig({
        ...savedConfig,
        inbox_search: q,
        inbox_tab: tab,
        inbox_status_filter: statusFilter,
        inbox_priority_filter: priorityFilter,
        inbox_sort_mode: sortMode,
        inbox_auto_refresh: autoRefresh,
        inbox_live_sync: liveSync,
        saved_view_snapshot: currentSnapshot,
        inbox_saved_views: nextPresets,
      });
      setSelectedPresetId(nextPreset.id);
      setPresetName('');
      setIsPresetModalOpen(false);
      message.success(existing ? 'Đã cập nhật mẫu lọc.' : 'Đã lưu mẫu lọc mới.');
    } catch {
      message.error('Không thể lưu mẫu lọc.');
    }
  };
  const applyNamedPreset = () => {
    const preset = namedPresets.find((p) => p.id === selectedPresetId);
    if (!preset) {
      message.warning('Vui lòng chọn mẫu lọc.');
      return;
    }
    applySnapshot(preset.filters);
    message.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };
  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((p) => p.id === selectedPresetId);
    if (!preset) {
      message.warning('Vui lòng chọn mẫu lọc để xóa.');
      return;
    }
    const nextPresets = namedPresets.filter((p) => p.id !== preset.id);
    const currentSnapshot = buildCurrentSnapshot();
    try {
      await saveConfig({
        ...savedConfig,
        inbox_search: q,
        inbox_tab: tab,
        inbox_status_filter: statusFilter,
        inbox_priority_filter: priorityFilter,
        inbox_sort_mode: sortMode,
        inbox_auto_refresh: autoRefresh,
        inbox_live_sync: liveSync,
        saved_view_snapshot: currentSnapshot,
        inbox_saved_views: nextPresets,
      });
      setSelectedPresetId(undefined);
      message.success(`Đã xóa mẫu lọc "${preset.name}".`);
    } catch {
      message.error('Không thể xóa mẫu lọc.');
    }
  };

  const columns: ColumnsType<TaskItem> = [
    {
      title: 'Đối tượng',
      key: 'entity',
      width: 180,
      render: (_, r) => (
        <Space direction="vertical" size={1}>
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>{getEntityTypeLabel(r.entity_type)}</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.entity_code || `#${r.entity_id}`}</Text>
        </Space>
      ),
    },
    {
      title: 'Nhiệm vụ',
      dataIndex: 'title',
      key: 'title',
      render: (_, r) => (
        <Space direction="vertical" size={2}>
          <Text strong>{r.title}</Text>
          <Space size={6} wrap>
            <Tag>{r.status_display}</Tag>
            {r.needs_help && <Tag color="warning">Cần hỗ trợ</Tag>}
            {r.is_blocking && <Tag color="error">Đang chặn luồng</Tag>}
            {r.due_date && dayjs(r.due_date).isBefore(dayjs(), 'day') && <Tag color="gold">Quá hạn</Tag>}
          </Space>
        </Space>
      ),
    },
    {
      title: 'Người xử lý',
      key: 'assignee',
      width: 160,
      render: (_, r) => r.assigned_to_info?.full_name || 'Chưa giao',
    },
    {
      title: 'Theo dõi',
      key: 'watch',
      width: 110,
      render: (_, r) => (
        <Button
          size="small"
          icon={r.is_watching ? <StarFilled /> : <StarOutlined />}
          onClick={() => watchMutation.mutate({ id: r.id, watching: r.is_watching })}
        >
          {r.watchers_count}
        </Button>
      ),
    },
    {
      title: 'Hạn',
      dataIndex: 'due_date',
      key: 'due_date',
      width: 120,
      render: (v) => (v ? dayjs(v).format('DD/MM/YYYY') : '-'),
    },
    {
      title: 'Trễ (ngày)',
      key: 'overdue_days',
      width: 100,
      render: (_, r) => {
        if (!r.due_date) return '-';
        if (!(r.status === 'TODO' || r.status === 'IN_PROGRESS')) return '-';
        const days = dayjs().startOf('day').diff(dayjs(r.due_date), 'day');
        return days > 0 ? <Tag color="error">{days}</Tag> : <Tag color="green">0</Tag>;
      },
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 110,
      render: (_, r) => (
        <Button size="small" icon={<EyeOutlined />} onClick={() => setSelected(r)}>
          Mở
        </Button>
      ),
    },
  ];

  const summary = summaryQuery.data;
  const lastBulkHistoryAt = visibleBulkHistory[0]?.created_at ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card size="small">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Space wrap>
            <InboxOutlined />
            <Text strong style={{ fontSize: 16 }}>Nhiệm vụ của tôi</Text>
            <Tag color="processing" style={{ marginInlineEnd: 0 }}>
              Chế độ: {INBOX_TAB_LABELS[tab]}
            </Tag>
            {selectedPreset ? (
              <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                Mẫu đang dùng: {selectedPreset.name}
              </Tag>
            ) : null}
          </Space>
          <div data-testid="task-inbox-search" style={{ display: 'inline-block' }}>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm theo mã, tiêu đề, mô tả..."
              style={{ width: 300 }}
              suffix={q ? <QuickClearIcon onClear={() => setQ('')} title="Xóa tìm kiếm" /> : undefined}
            />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Segmented<InboxTab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'ASSIGNED', label: <Badge count={summary?.assigned_to_me ?? 0} size="small">Giao cho tôi</Badge> },
              { value: 'CREATED', label: <Badge count={summary?.created_by_me ?? 0} size="small">Tạo bởi tôi</Badge> },
              { value: 'WATCHING', label: <Badge count={summary?.watching ?? 0} size="small">Tôi theo dõi</Badge> },
              { value: 'TEAM', label: <Badge count={summary?.team_members ?? 0} size="small">Nhóm của tôi</Badge> },
              { value: 'OVERDUE', label: <Badge count={summary?.overdue ?? 0} size="small">Quá hạn</Badge> },
            ]}
          />
        </div>
        <div
          style={{
            marginTop: 14,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: 10,
          }}
        >
          {[
            { label: 'Đang hiển thị', value: inboxMetrics.total, tone: '#1d4ed8' },
            { label: 'Quá hạn', value: inboxMetrics.overdue, tone: '#dc2626' },
            { label: 'Đến hạn hôm nay', value: inboxMetrics.dueToday, tone: '#d97706' },
            { label: 'Cần hỗ trợ', value: inboxMetrics.needHelp, tone: '#b45309' },
            { label: 'Đang chặn luồng', value: inboxMetrics.blocking, tone: '#be123c' },
            { label: 'Ưu tiên cao/khẩn', value: inboxMetrics.hot, tone: '#7c3aed' },
          ].map((item) => (
            <div key={item.label} style={SUMMARY_TILE_STYLE}>
              <Text type="secondary" style={{ fontSize: 12 }}>{item.label}</Text>
              <div style={{ fontSize: 28, fontWeight: 700, color: item.tone, lineHeight: 1.15, marginTop: 6 }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
        {(inboxMetrics.overdue > 0 || inboxMetrics.needHelp > 0 || inboxMetrics.blocking > 0) && (
          <Alert
            style={{ marginTop: 14 }}
            type={inboxMetrics.overdue > 0 || inboxMetrics.blocking > 0 ? 'warning' : 'info'}
            showIcon
            message="Bảng điều phối đang có nhiệm vụ cần ưu tiên xử lý"
            description={[
              inboxMetrics.overdue > 0 ? `${inboxMetrics.overdue} nhiệm vụ quá hạn` : null,
              inboxMetrics.needHelp > 0 ? `${inboxMetrics.needHelp} nhiệm vụ đang cần hỗ trợ` : null,
              inboxMetrics.blocking > 0 ? `${inboxMetrics.blocking} nhiệm vụ đang chặn luồng` : null,
            ].filter(Boolean).join(' · ')}
          />
        )}
        <div
          data-testid="task-inbox-command-strip"
          style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}
        >
          <div data-testid="task-inbox-status-filter" style={{ display: 'inline-block' }}>
            <Select<'ALL' | TaskStatus>
              value={statusFilter}
              onChange={setStatusFilter}
              style={{ width: 170 }}
              options={[
                { value: 'ALL', label: 'Mọi trạng thái mở' },
                { value: 'TODO', label: 'Chờ thực hiện' },
                { value: 'IN_PROGRESS', label: 'Đang thực hiện' },
              ]}
            />
          </div>
          <div data-testid="task-inbox-priority-filter" style={{ display: 'inline-block' }}>
            <Select<'ALL' | TaskPriority>
              value={priorityFilter}
              onChange={setPriorityFilter}
              style={{ width: 150 }}
              options={[
                { value: 'ALL', label: 'Mọi ưu tiên' },
                { value: 'LOW', label: TASK_PRIORITY_LABELS.LOW },
                { value: 'MEDIUM', label: TASK_PRIORITY_LABELS.MEDIUM },
                { value: 'HIGH', label: TASK_PRIORITY_LABELS.HIGH },
                { value: 'URGENT', label: TASK_PRIORITY_LABELS.URGENT },
              ]}
            />
          </div>
          <div data-testid="task-inbox-sort-filter" style={{ display: 'inline-block' }}>
            <Select<SortMode>
              value={sortMode}
              onChange={setSortMode}
              style={{ width: 190 }}
              options={[
                { value: 'SMART', label: 'Sắp xếp thông minh' },
                { value: 'DUE_ASC', label: 'Hạn gần nhất trước' },
                { value: 'DUE_DESC', label: 'Hạn xa nhất trước' },
                { value: 'UPDATED_DESC', label: 'Cập nhật mới nhất' },
              ]}
            />
          </div>
          <Button
            onClick={() => {
              setStatusFilter('ALL');
              setPriorityFilter('ALL');
              setSortMode('SMART');
            }}
          >
            Đặt lại lọc
          </Button>
          <Button onClick={refreshInbox}>
            Làm mới ngay
          </Button>
          <Button data-testid="task-inbox-save-view" onClick={() => void saveCurrentView()} disabled={isPreferencesLoading}>
            Lưu chế độ xem
          </Button>
          <Button data-testid="task-inbox-restore-view" onClick={applySavedView} disabled={isPreferencesLoading}>
            Áp dụng chế độ đã lưu
          </Button>
          <Button
            data-testid="task-inbox-open-preset-modal"
            onClick={() => {
              setPresetName(selectedPreset?.name ?? '');
              setIsPresetModalOpen(true);
            }}
            disabled={isPreferencesLoading}
          >
            Lưu mẫu mới
          </Button>
          <div data-testid="task-inbox-preset-select" style={{ display: 'inline-block' }}>
            <Select<string>
              allowClear
              value={selectedPresetId}
              onChange={(value) => setSelectedPresetId(value)}
              disabled={isPreferencesLoading}
              style={{ width: 200 }}
              options={namedPresets.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="Chọn mẫu lọc cá nhân"
            />
          </div>
          <Button data-testid="task-inbox-apply-preset" onClick={applyNamedPreset} disabled={isPreferencesLoading}>
            Áp dụng mẫu lọc
          </Button>
          <Button danger data-testid="task-inbox-delete-preset" onClick={() => void deleteNamedPreset()} disabled={isPreferencesLoading}>
            Xóa mẫu lọc
          </Button>
          <Button onClick={exportFilteredCsv}>
            Xuất CSV
          </Button>
          <Button onClick={exportFilteredExcel}>
            Xuất Excel
          </Button>
          <Button
            danger
            onClick={async () => {
              await tasksApi.clearBulkHistory({});
              void queryClient.invalidateQueries({ queryKey: ['task-bulk-history'] });
              message.success('Đã xóa lịch sử thao tác hàng loạt.');
            }}
          >
            Xóa lịch sử hàng loạt
          </Button>
          <Space size={6}>
            <Text type="secondary">Tự làm mới</Text>
            <Switch checked={autoRefresh} onChange={setAutoRefresh} size="small" />
          </Space>
          <Space size={6}>
            <Text type="secondary">Theo dõi trực tiếp</Text>
            <Switch checked={liveSync} onChange={setLiveSync} size="small" />
          </Space>
          <Tag color="processing" style={{ marginInlineEnd: 0 }}>Hiển thị {filteredData.length} nhiệm vụ</Tag>
          {savedViewSnapshot ? <Tag style={{ marginInlineEnd: 0 }}>Có chế độ xem đã lưu</Tag> : null}
          {inboxMetrics.unassigned > 0 && (
            <Tag color="gold" style={{ marginInlineEnd: 0 }}>
              Chưa giao: {inboxMetrics.unassigned}
            </Tag>
          )}
          {liveSync && (
            <Tag color={taskLiveUpdatesQuery.data?.has_changes ? 'gold' : 'cyan'}>
              Trực tiếp: {taskLiveUpdatesQuery.isFetching ? 'đang kiểm tra' : 'đang hoạt động'}
            </Tag>
          )}
          <Tag>
            Cập nhật: {tasksQuery.dataUpdatedAt ? dayjs(tasksQuery.dataUpdatedAt).format('HH:mm:ss') : '--:--:--'}
          </Tag>
        </div>
        {activeFilterTags.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {activeFilterTags.map((item) => (
              <Tag key={item}>{item}</Tag>
            ))}
          </div>
        )}
        {selectedEffectiveIds.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Tag color="purple">Đã chọn {selectedEffectiveIds.length} nhiệm vụ</Tag>
            <Button size="small" disabled={!canBulkManage || bulkInProgress !== null} loading={bulkInProgress === 'START'} onClick={() => void runBulkAction('START')}>
              Bắt đầu hàng loạt
            </Button>
            <Button size="small" type="primary" disabled={!canBulkManage || bulkInProgress !== null} loading={bulkInProgress === 'COMPLETE'} onClick={() => void runBulkAction('COMPLETE')}>
              Hoàn thành hàng loạt
            </Button>
            <Button size="small" disabled={!canBulkManage || bulkInProgress !== null} loading={bulkInProgress === 'REMIND_OVERDUE'} onClick={() => void runBulkAction('REMIND_OVERDUE')}>
              Nhắc quá hạn hàng loạt
            </Button>
            <Button
              size="small"
              disabled={!canBulkManage || bulkInProgress !== null}
              loading={bulkInProgress === 'REASSIGN'}
              onClick={() => {
                setBulkReassignSearch('');
                setBulkReassignTo(null);
                setBulkReassignNote('');
                setBulkReassignOpen(true);
              }}
            >
              Chuyển người hàng loạt
            </Button>
            <Button size="small" onClick={clearSelection}>
              Bỏ chọn
            </Button>
          </div>
        )}
        {!canBulkManage && (
          <div style={{ marginTop: 8 }}>
            <Tag color="gold">Tài khoản hiện tại chỉ có quyền xem/chọn, chưa có quyền thao tác hàng loạt.</Tag>
          </div>
        )}
      </Card>
      <Card size="small" title="Nhật ký thao tác hàng loạt">
        <div
          style={{
            marginBottom: 12,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: 10,
          }}
        >
          {[
            { label: 'Bản ghi hiển thị', value: bulkHistoryMetrics.total, tone: '#1d4ed8' },
            { label: 'Lượt có lỗi', value: bulkHistoryMetrics.withErrors, tone: '#dc2626' },
            { label: 'Lượt gửi nhắc', value: bulkHistoryMetrics.reminderRuns, tone: '#d97706' },
            { label: 'Tác vụ đã xử lý', value: bulkHistoryMetrics.processed, tone: '#0f766e' },
          ].map((item) => (
            <div key={item.label} style={SUMMARY_TILE_STYLE}>
              <Text type="secondary" style={{ fontSize: 12 }}>{item.label}</Text>
              <div style={{ fontSize: 28, fontWeight: 700, color: item.tone, lineHeight: 1.15, marginTop: 6 }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
        {(bulkHistoryMetrics.withErrors > 0 || lastBulkHistoryAt) && (
          <Alert
            style={{ marginBottom: 12 }}
            type={bulkHistoryMetrics.withErrors > 0 ? 'warning' : 'info'}
            showIcon
            message={bulkHistoryMetrics.withErrors > 0 ? 'Có lượt xử lý hàng loạt phát sinh lỗi' : 'Nhật ký thao tác hàng loạt đã sẵn sàng để đối soát'}
            description={[
              bulkHistoryMetrics.withErrors > 0 ? `${bulkHistoryMetrics.withErrors} bản ghi có lỗi xử lý` : null,
              lastBulkHistoryAt ? `Lần gần nhất: ${dayjs(lastBulkHistoryAt).format('DD/MM/YYYY HH:mm:ss')}` : null,
            ].filter(Boolean).join(' · ')}
          />
        )}
        <div style={{ marginBottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Select<'ALL' | BulkHistoryAction>
            value={bulkHistoryActionFilter}
            onChange={setBulkHistoryActionFilter}
            style={{ width: 190 }}
            options={[
              { value: 'ALL', label: 'Mọi thao tác' },
              { value: 'START', label: 'Bắt đầu' },
              { value: 'COMPLETE', label: 'Hoàn thành' },
              { value: 'REMIND_OVERDUE', label: 'Nhắc quá hạn' },
              { value: 'REASSIGN', label: 'Chuyển người xử lý' },
            ]}
          />
          <Select<BulkHistoryResultFilter>
            value={bulkHistoryResultFilter}
            onChange={setBulkHistoryResultFilter}
            style={{ width: 180 }}
            options={[
              { value: 'ALL', label: 'Mọi kết quả' },
              { value: 'SUCCESS', label: 'Không có lỗi' },
              { value: 'HAS_ERROR', label: 'Có lỗi xử lý' },
            ]}
          />
          <Button onClick={exportBulkHistoryCsv}>Xuất CSV lịch sử</Button>
          <Tag style={{ marginInlineEnd: 0 }}>Hiển thị {visibleBulkHistory.length} bản ghi</Tag>
        </div>
        {bulkHistoryQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: 18 }}><Spin /></div>
        ) : !visibleBulkHistory.length ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có lịch sử thao tác hàng loạt." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleBulkHistory.slice(0, 20).map((item) => (
              <div
                key={item.id}
                style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: '8px 10px', background: '#fafafa' }}
              >
                <Space wrap size={6}>
                  <Tag color="blue">{item.action_label}</Tag>
                  <Tag>Đã chọn {item.selected_count}</Tag>
                  <Tag>Xử lý {item.processed_count}</Tag>
                  <Tag color="green">OK {item.success_count}</Tag>
                  <Tag color={item.failed_count > 0 ? 'red' : 'default'}>Lỗi {item.failed_count}</Tag>
                  {typeof item.reminder_sent_count === 'number' ? (
                    <Tag color="gold">Thông báo gửi {item.reminder_sent_count}</Tag>
                  ) : null}
                  <Tag>{dayjs(item.created_at).format('DD/MM/YYYY HH:mm:ss')}</Tag>
                </Space>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card size="small">
        {tasksQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
        ) : filteredData.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có nhiệm vụ phù hợp với bộ lọc hiện tại." />
        ) : (
          <Table<TaskItem>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={deferredFilteredData}
            rowSelection={rowSelection}
            pagination={{ pageSize: 20, showSizeChanger: true }}
          />
        )}
      </Card>

      <Suspense fallback={null}>
        <TaskWorkspaceModalLazy
          open={!!selected}
          onClose={() => setSelected(null)}
          entityType={selected?.entity_type || 'Product'}
          entityId={selected?.entity_id ?? null}
          entityCode={selected?.entity_code}
          titlePrefix="Nhiệm vụ của tôi"
        />
      </Suspense>
      <Modal
        title={`Chuyển người xử lý cho ${selectedEffectiveIds.length} nhiệm vụ`}
        open={bulkReassignOpen}
        onCancel={() => setBulkReassignOpen(false)}
        onOk={() => void runBulkReassign()}
        okText="Xác nhận chuyển"
        cancelText="Hủy"
        confirmLoading={bulkInProgress === 'REASSIGN'}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Select
            showSearch
            allowClear
            placeholder="Tìm và chọn người xử lý mới..."
            value={bulkReassignTo ?? undefined}
            onChange={(value) => setBulkReassignTo(value ?? null)}
            onSearch={setBulkReassignSearch}
            filterOption={false}
            loading={bulkReassignUsersQuery.isLoading}
            options={(bulkReassignUsersQuery.data ?? []).map((user) => ({
              value: user.id,
              label: `${getUserDisplayName(user)} (@${user.username})`,
            }))}
          />
          <Input.TextArea
            rows={4}
            value={bulkReassignNote}
            onChange={(event) => setBulkReassignNote(event.target.value)}
            placeholder="Ghi chú bàn giao hàng loạt, ví dụ: chuyển nhóm ca sáng xử lý tiếp đơn gấp..."
          />
        </div>
      </Modal>
      <Modal
        title="Lưu mẫu lọc cá nhân"
        open={isPresetModalOpen}
        onCancel={() => {
          setIsPresetModalOpen(false);
          setPresetName('');
        }}
        onOk={() => void saveNamedPreset()}
        okText="Lưu"
        cancelText="Hủy"
      >
        <Input
          data-testid="task-inbox-preset-name"
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
          placeholder="Ví dụ: Ca sáng / Quá hạn cao / Theo dõi QC"
          maxLength={80}
          autoFocus
        />
      </Modal>
    </div>
  );
}
