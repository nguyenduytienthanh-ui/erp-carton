import { Suspense, lazy, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Checkbox, Drawer, Empty, Input, List, Modal, Switch, message, Segmented, Select, Space, Spin, Tag, Typography } from 'antd';
import { ReloadOutlined, ProjectOutlined, SwapRightOutlined, WarningOutlined, HistoryOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  workflowTaskTemplatesApi,
  WFT_TRIGGER_LABELS,
  type WftTrigger,
  type WorkflowPipelineCard,
  type WorkflowPipelineTimelineItem,
} from '../../api/workflowTaskTemplates';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { getEntityTypeLabel } from '../../utils/constants';
import { storage } from '../../utils/storage';
import { useRealtimePollingInterval } from '../../hooks/useRealtimePollingInterval';

const { Text } = Typography;
const TaskWorkspaceModalLazy = lazy(() => import('../../components/TaskWorkspaceModal/TaskWorkspaceModal'));

function normalizeStepTitle(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\{entity_code\}/gi, 'mã đối tượng')
    .replace(/\(entity_code\)/gi, '(mã đối tượng)')
    .replace(/\{entity_type\}/gi, 'loại đối tượng')
    .replace(/\(entity_type\)/gi, '(loại đối tượng)')
    .replace(/\{trigger\}/gi, 'sự kiện')
    .replace(/\(trigger\)/gi, '(sự kiện)')
    .replace(/\bXac nhan thong tin don\b/gi, 'Xác nhận thông tin đơn')
    .replace(/\bLap ke hoach vat tu cho don\b/gi, 'Lập kế hoạch vật tư cho đơn')
    .replace(/\bDieu do san xuat don\b/gi, 'Điều độ sản xuất đơn')
    .replace(/\bQC thanh pham don\b/gi, 'QC thành phẩm đơn')
    .replace(/\bChuan bi giao hang don\b/gi, 'Chuẩn bị giao hàng đơn');
}

function normalizeColumnTitle(raw: string): string {
  if (!raw) return '';
  if (raw.toLowerCase() === 'done') return 'Hoàn thành';
  if (raw.toLowerCase() === 'failed') return 'Thất bại';
  return normalizeStepTitle(raw);
}

function normalizeOrderStatus(raw: string | null | undefined): string {
  if (!raw) return '-';
  const key = raw.toUpperCase();
  if (key === 'SUBMITTED') return 'Đã nộp';
  if (key === 'APPROVED') return 'Đã duyệt';
  if (key === 'DRAFT') return 'Nháp';
  if (key === 'CANCELLED') return 'Đã hủy';
  if (key === 'COMPLETED') return 'Hoàn thành';
  return raw;
}

function normalizeTimelineAction(raw: string | null | undefined): string {
  if (!raw) return '-';
  const key = raw.toUpperCase();
  if (key === 'ADVANCE') return 'Chuyển bước';
  if (key === 'MOVE') return 'Di chuyển';
  if (key === 'RETRY_FAILED') return 'Khôi phục thất bại';
  if (key === 'FAIL') return 'Đánh dấu thất bại';
  if (key === 'AUTO_START') return 'Tự động bắt đầu';
  return raw;
}

export default function WorkflowPipelineBoard() {
  type QuickViewMode = 'DEFAULT' | 'MY_ITEMS' | 'MY_TEAM' | 'RISK' | 'FAILED';
  type PipelineFilterSnapshot = {
    entity_type: 'SalesOrder' | 'Product' | 'Customer';
    trigger: WftTrigger;
    search: string;
    quick_view: QuickViewMode;
    sla_filter: 'ALL' | 'OVERDUE' | 'DUE_TODAY' | 'AT_RISK';
    owner_filter: string;
    team_filter: string;
    live_sync: boolean;
  };
  type PipelineNamedPreset = {
    id: string;
    name: string;
    filters: PipelineFilterSnapshot;
  };

  const { config: savedConfig, saveConfig } = useUserPreferences('workflow-pipeline-board');
  const [entityType, setEntityType] = useState<'SalesOrder' | 'Product' | 'Customer'>('SalesOrder');
  const [trigger, setTrigger] = useState<WftTrigger>('SUBMIT');
  const [search, setSearch] = useState('');
  const [slaFilter, setSlaFilter] = useState<'ALL' | 'OVERDUE' | 'DUE_TODAY' | 'AT_RISK'>('ALL');
  const [ownerFilter, setOwnerFilter] = useState<string>('ALL');
  const [teamFilter, setTeamFilter] = useState<string>('ALL');
  const [quickView, setQuickView] = useState<QuickViewMode>('DEFAULT');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('NONE');
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [selectedCard, setSelectedCard] = useState<WorkflowPipelineCard | null>(null);
  const [draggingCard, setDraggingCard] = useState<WorkflowPipelineCard | null>(null);
  const [timelineCard, setTimelineCard] = useState<WorkflowPipelineCard | null>(null);
  const [selectedEntityIds, setSelectedEntityIds] = useState<number[]>([]);
  const [liveSync, setLiveSync] = useState(true);
  const queryClient = useQueryClient();
  const liveSinceRef = useRef<string | null>(null);
  const deferredSearch = useDeferredValue(search);
  const livePollingInterval = useRealtimePollingInterval({
    enabled: liveSync,
    activeMs: 4_000,
    hiddenMs: false,
  });

  const templatesQuery = useQuery({
    queryKey: ['workflow-active-templates'],
    queryFn: () => workflowTaskTemplatesApi.list({ is_active: true }),
    staleTime: 30_000,
  });

  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const availableEntityTypes = useMemo(() => {
    const set = new Set<string>();
    templates.forEach((t) => set.add(t.entity_type));
    return Array.from(set);
  }, [templates]);

  const effectiveEntityType = useMemo(() => {
    if (!templates.length) return entityType;
    const hasCurrent = templates.some((t) => t.entity_type === entityType);
    if (hasCurrent) return entityType;
    return templates[0].entity_type as 'SalesOrder' | 'Product' | 'Customer';
  }, [templates, entityType]);

  const triggerOptionsForEntity = useMemo(() => {
    const set = new Set<WftTrigger>();
    templates
      .filter((t) => t.entity_type === effectiveEntityType)
      .forEach((t) => set.add(t.trigger));
    const values = Array.from(set);
    return values.map((value) => ({ value, label: WFT_TRIGGER_LABELS[value] ?? value }));
  }, [templates, effectiveEntityType]);

  const effectiveTrigger = useMemo(() => {
    if (!triggerOptionsForEntity.length) return trigger;
    const hasCurrent = triggerOptionsForEntity.some((opt) => opt.value === trigger);
    if (hasCurrent) return trigger;
    return triggerOptionsForEntity[0].value;
  }, [triggerOptionsForEntity, trigger]);

  const isFallbackCombo = effectiveEntityType !== entityType || effectiveTrigger !== trigger;

  const boardQuery = useQuery({
    queryKey: ['workflow-pipeline-board', effectiveEntityType, effectiveTrigger],
    queryFn: () => workflowTaskTemplatesApi.getPipelineBoard({ entity_type: effectiveEntityType, trigger: effectiveTrigger, limit: 300 }),
    staleTime: 10_000,
  });

  const timelineQuery = useQuery({
    queryKey: ['workflow-pipeline-timeline', effectiveEntityType, timelineCard?.entity_id],
    queryFn: () =>
      workflowTaskTemplatesApi.getPipelineTimeline({
        entity_type: effectiveEntityType,
        entity_id: timelineCard!.entity_id,
        limit: 100,
      }),
    enabled: !!timelineCard?.entity_id,
    staleTime: 5_000,
  });
  const pipelineLiveQuery = useQuery({
    queryKey: ['workflow-pipeline-live-updates', effectiveEntityType, effectiveTrigger, liveSync],
    queryFn: () => workflowTaskTemplatesApi.getPipelineLiveUpdates({
      entity_type: effectiveEntityType,
      trigger: effectiveTrigger,
      since: liveSinceRef.current || undefined,
    }),
    enabled: liveSync,
    refetchInterval: livePollingInterval,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
  useEffect(() => {
    liveSinceRef.current = null;
  }, [effectiveEntityType, effectiveTrigger, liveSync]);
  useEffect(() => {
    const payload = pipelineLiveQuery.data;
    if (!payload) return;
    if (payload.latest_at) {
      liveSinceRef.current = payload.latest_at;
    }
    if (!payload.has_changes) return;
    void queryClient.invalidateQueries({ queryKey: ['workflow-pipeline-board'] });
    if (timelineCard?.entity_id) {
      void queryClient.invalidateQueries({ queryKey: ['workflow-pipeline-timeline', effectiveEntityType, timelineCard.entity_id] });
    }
  }, [effectiveEntityType, pipelineLiveQuery.data, queryClient, timelineCard?.entity_id]);

  const refreshBoard = () => {
    void queryClient.invalidateQueries({ queryKey: ['workflow-pipeline-board'] });
  };

  const advanceMutation = useMutation({
    mutationFn: (card: WorkflowPipelineCard) =>
      workflowTaskTemplatesApi.advancePipeline({
        entity_type: effectiveEntityType,
        entity_id: card.entity_id,
        entity_code: card.entity_code,
        trigger: effectiveTrigger,
      }),
    onSuccess: (res) => {
      message.success(res.message || 'Đã chuyển bước.');
      refreshBoard();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(msg || 'Không thể chuyển bước.');
    },
  });

  const moveMutation = useMutation({
    mutationFn: ({ card, targetColumnId }: { card: WorkflowPipelineCard; targetColumnId: string }) =>
      workflowTaskTemplatesApi.movePipelineCard({
        entity_type: effectiveEntityType,
        entity_id: card.entity_id,
        entity_code: card.entity_code,
        trigger: effectiveTrigger,
        target_column_id: targetColumnId,
      }),
    onSuccess: (res) => {
      message.success(res.message || 'Đã di chuyển thẻ.');
      refreshBoard();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(msg || 'Không thể di chuyển thẻ.');
    },
  });

  const retryFailedMutation = useMutation({
    mutationFn: (card: WorkflowPipelineCard) =>
      workflowTaskTemplatesApi.retryPipelineFailed({
        entity_type: effectiveEntityType,
        entity_id: card.entity_id,
        entity_code: card.entity_code,
        trigger: effectiveTrigger,
      }),
    onSuccess: (res) => {
      message.success(res.message || 'Đã khôi phục thẻ thất bại.');
      refreshBoard();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(msg || 'Không thể khôi phục thẻ thất bại.');
    },
  });

  const bulkActionMutation = useMutation({
    mutationFn: (action: 'ADVANCE' | 'FAIL' | 'RETRY_FAILED') =>
      workflowTaskTemplatesApi.bulkPipelineAction({
        entity_type: effectiveEntityType,
        trigger: effectiveTrigger,
        action,
        items: selectedEffectiveIds.map((entityId) => {
          const card = (boardQuery.data?.columns ?? []).flatMap((col) => col.cards).find((c) => c.entity_id === entityId);
          return { entity_id: entityId, entity_code: card?.entity_code };
        }),
      }),
    onSuccess: (res, action) => {
      message.success(
        `Thao tác hàng loạt ${action}: thành công ${res.success_count}/${res.total}, lỗi ${res.failed_count}.`
      );
      setSelectedEntityIds([]);
      refreshBoard();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(msg || 'Không thể chạy thao tác hàng loạt.');
    },
  });

  const columns = useMemo(() => {
    const data = boardQuery.data?.columns ?? [];
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return data;
    return data.map((col) => ({
      ...col,
      cards: col.cards.filter((card) =>
        `${card.entity_code} ${card.current_step} ${card.owner} ${card.team}`.toLowerCase().includes(q)
      ),
    }));
  }, [boardQuery.data?.columns, deferredSearch]);

  const filteredColumns = useMemo(() => {
    const userRaw = storage.getUser() as unknown;
    const userObj = userRaw && typeof userRaw === 'object' ? (userRaw as Record<string, unknown>) : null;
    const myNameCandidates = [
      typeof userObj?.full_name === 'string' ? userObj.full_name : '',
      typeof userObj?.username === 'string' ? userObj.username : '',
    ].filter(Boolean);
    const teamRaw = userObj?.teams;
    const myTeams: string[] = Array.isArray(teamRaw)
      ? teamRaw
          .map((item) => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).name === 'string') {
              return (item as Record<string, unknown>).name as string;
            }
            return '';
          })
          .filter(Boolean)
      : [];

    const priorityRank: Record<string, number> = {
      URGENT: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    };
    const slaRank: Record<string, number> = {
      OVERDUE: 4,
      DUE_TODAY: 3,
      AT_RISK: 2,
      ON_TRACK: 1,
    };

    return columns.map((col) => ({
      ...col,
      cards: col.cards
        .filter((card) => {
          const quickViewMatch = (() => {
            if (quickView === 'DEFAULT') return true;
            if (quickView === 'RISK') return ['OVERDUE', 'DUE_TODAY', 'AT_RISK'].includes(card.sla_state);
            if (quickView === 'FAILED') return col.id === 'failed';
            if (quickView === 'MY_ITEMS') return myNameCandidates.includes(card.owner || '');
            if (quickView === 'MY_TEAM') return myTeams.includes(card.team || '');
            return true;
          })();
          const slaMatch = slaFilter === 'ALL' || card.sla_state === slaFilter;
          const ownerMatch = ownerFilter === 'ALL' || (card.owner || 'Chưa có người phụ trách') === ownerFilter;
          const teamMatch = teamFilter === 'ALL' || (card.team || 'Chưa có nhóm') === teamFilter;
          return quickViewMatch && slaMatch && ownerMatch && teamMatch;
        })
        .sort((a, b) => {
          const aSla = slaRank[a.sla_state] ?? 0;
          const bSla = slaRank[b.sla_state] ?? 0;
          if (aSla !== bSla) return bSla - aSla;

          const aBlocking = a.current_task_is_blocking ? 1 : 0;
          const bBlocking = b.current_task_is_blocking ? 1 : 0;
          if (aBlocking !== bBlocking) return bBlocking - aBlocking;

          const aPinned = a.current_task_is_pinned ? 1 : 0;
          const bPinned = b.current_task_is_pinned ? 1 : 0;
          if (aPinned !== bPinned) return bPinned - aPinned;

          const aPriority = priorityRank[a.current_task_priority || ''] ?? 0;
          const bPriority = priorityRank[b.current_task_priority || ''] ?? 0;
          if (aPriority !== bPriority) return bPriority - aPriority;

          if (a.current_task_due_date && b.current_task_due_date) {
            const dueCompare = a.current_task_due_date.localeCompare(b.current_task_due_date);
            if (dueCompare !== 0) return dueCompare;
          } else if (a.current_task_due_date || b.current_task_due_date) {
            return a.current_task_due_date ? -1 : 1;
          }

          if (a.updated_at && b.updated_at) return b.updated_at.localeCompare(a.updated_at);
          if (a.updated_at || b.updated_at) return a.updated_at ? -1 : 1;
          return 0;
        }),
    }));
  }, [columns, quickView, slaFilter, ownerFilter, teamFilter]);

  const totalCards = useMemo(
    () => filteredColumns.reduce((acc, col) => acc + col.cards.length, 0),
    [filteredColumns]
  );

  const allEntityIds = useMemo(() => {
    const ids = new Set<number>();
    (boardQuery.data?.columns ?? []).forEach((col) => {
      col.cards.forEach((card) => ids.add(card.entity_id));
    });
    return ids;
  }, [boardQuery.data?.columns]);

  const selectedEffectiveIds = selectedEntityIds.filter((id) => allEntityIds.has(id));

  const ownerOptions = useMemo(() => {
    const set = new Set<string>();
    (boardQuery.data?.columns ?? []).forEach((col) => {
      col.cards.forEach((card) => set.add(card.owner || 'Chưa có người phụ trách'));
    });
    return Array.from(set).sort();
  }, [boardQuery.data?.columns]);

  const teamOptions = useMemo(() => {
    const set = new Set<string>();
    (boardQuery.data?.columns ?? []).forEach((col) => {
      col.cards.forEach((card) => set.add(card.team || 'Chưa có nhóm'));
    });
    return Array.from(set).sort();
  }, [boardQuery.data?.columns]);

  const namedPresets = useMemo(() => {
    const raw = savedConfig?.saved_views;
    if (!Array.isArray(raw)) return [] as PipelineNamedPreset[];
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const obj = item as Record<string, unknown>;
        const id = typeof obj.id === 'string' ? obj.id : '';
        const name = typeof obj.name === 'string' ? obj.name : '';
        const filtersRaw = obj.filters;
        if (!id || !name || !filtersRaw || typeof filtersRaw !== 'object') return null;
        const f = filtersRaw as Record<string, unknown>;
        const entityType = f.entity_type;
        const triggerValue = f.trigger;
        const quickValue = f.quick_view;
        const slaValue = f.sla_filter;
        if (
          (entityType !== 'SalesOrder' && entityType !== 'Product' && entityType !== 'Customer')
          || typeof triggerValue !== 'string'
          || (quickValue !== 'DEFAULT' && quickValue !== 'MY_ITEMS' && quickValue !== 'MY_TEAM' && quickValue !== 'RISK' && quickValue !== 'FAILED')
          || (slaValue !== 'ALL' && slaValue !== 'OVERDUE' && slaValue !== 'DUE_TODAY' && slaValue !== 'AT_RISK')
        ) {
          return null;
        }
        return {
          id,
          name,
          filters: {
            entity_type: entityType,
            trigger: triggerValue as WftTrigger,
            search: typeof f.search === 'string' ? f.search : '',
            quick_view: quickValue,
            sla_filter: slaValue,
            owner_filter: typeof f.owner_filter === 'string' ? f.owner_filter : 'ALL',
            team_filter: typeof f.team_filter === 'string' ? f.team_filter : 'ALL',
            live_sync: f.live_sync !== false,
          },
        } as PipelineNamedPreset;
      })
      .filter((v): v is PipelineNamedPreset => v !== null);
  }, [savedConfig?.saved_views]);

  const buildCurrentSnapshot = (): PipelineFilterSnapshot => ({
    entity_type: entityType,
    trigger,
    search,
    quick_view: quickView,
    sla_filter: slaFilter,
    owner_filter: ownerFilter,
    team_filter: teamFilter,
    live_sync: liveSync,
  });

  const applyFilterSnapshot = (snapshot: PipelineFilterSnapshot) => {
    setEntityType(snapshot.entity_type);
    setTrigger(snapshot.trigger);
    setSearch(snapshot.search);
    setQuickView(snapshot.quick_view);
    setSlaFilter(snapshot.sla_filter);
    setOwnerFilter(snapshot.owner_filter);
    setTeamFilter(snapshot.team_filter);
    setLiveSync(snapshot.live_sync);
  };

  const saveCurrentFilters = async () => {
    try {
      const currentSnapshot = buildCurrentSnapshot();
      await saveConfig({
        ...savedConfig,
        ...currentSnapshot,
        saved_views: namedPresets,
      });
      message.success('Đã lưu bộ lọc luồng công việc.');
    } catch {
      message.error('Không thể lưu bộ lọc luồng công việc.');
    }
  };

  const applySavedFilters = () => {
    const nextEntityType = savedConfig?.entity_type;
    const nextTrigger = savedConfig?.trigger;
    const nextSearch = savedConfig?.search;
    const nextQuickView = savedConfig?.quick_view;
    const nextSla = savedConfig?.sla_filter;
    const nextOwner = savedConfig?.owner_filter;
    const nextTeam = savedConfig?.team_filter;
    const nextLiveSync = savedConfig?.live_sync;

    if (nextEntityType === 'SalesOrder' || nextEntityType === 'Product' || nextEntityType === 'Customer') {
      setEntityType(nextEntityType);
    }
    if (typeof nextTrigger === 'string') setTrigger(nextTrigger as WftTrigger);
    if (typeof nextSearch === 'string') setSearch(nextSearch);
    if (nextQuickView === 'DEFAULT' || nextQuickView === 'MY_ITEMS' || nextQuickView === 'MY_TEAM' || nextQuickView === 'RISK' || nextQuickView === 'FAILED') {
      setQuickView(nextQuickView);
    }
    if (nextSla === 'ALL' || nextSla === 'OVERDUE' || nextSla === 'DUE_TODAY' || nextSla === 'AT_RISK') {
      setSlaFilter(nextSla);
    }
    if (typeof nextOwner === 'string') setOwnerFilter(nextOwner);
    if (typeof nextTeam === 'string') setTeamFilter(nextTeam);
    if (typeof nextLiveSync === 'boolean') setLiveSync(nextLiveSync);
    message.success('Đã áp dụng bộ lọc đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = presetName.trim();
    if (!name) {
      message.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const nextPreset: PipelineNamedPreset = existing
      ? { ...existing, name, filters: currentSnapshot }
      : { id: `${Date.now()}`, name, filters: currentSnapshot };
    const nextPresets = existing
      ? namedPresets.map((p) => (p.id === existing.id ? nextPreset : p))
      : [...namedPresets, nextPreset];
    try {
      await saveConfig({
        ...savedConfig,
        ...currentSnapshot,
        saved_views: nextPresets,
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
    applyFilterSnapshot(preset.filters);
    message.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((p) => p.id === selectedPresetId);
    if (!preset) {
      message.warning('Vui lòng chọn mẫu lọc để xóa.');
      return;
    }
    const nextPresets = namedPresets.filter((p) => p.id !== preset.id);
    try {
      await saveConfig({
        ...savedConfig,
        ...buildCurrentSnapshot(),
        saved_views: nextPresets,
      });
      setSelectedPresetId('NONE');
      message.success(`Đã xóa mẫu lọc "${preset.name}".`);
    } catch {
      message.error('Không thể xóa mẫu lọc.');
    }
  };

  const toggleSelectCard = (entityId: number, checked: boolean) => {
    setSelectedEntityIds((prev) => {
      if (checked) {
        if (prev.includes(entityId)) return prev;
        return [...prev, entityId];
      }
      return prev.filter((id) => id !== entityId);
    });
  };

  const renderSlaTag = (card: WorkflowPipelineCard) => {
    if (card.sla_state === 'OVERDUE') return <Tag color="error">Quá hạn</Tag>;
    if (card.sla_state === 'DUE_TODAY') return <Tag color="gold">Đến hạn hôm nay</Tag>;
    if (card.sla_state === 'AT_RISK') return <Tag color="orange">Sắp quá hạn</Tag>;
    return <Tag color="green">Đúng hạn</Tag>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card size="small">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Space wrap>
            <Text strong style={{ fontSize: 16 }}>Bảng luồng công việc</Text>
            <Tag color="blue">{getEntityTypeLabel(effectiveEntityType)}</Tag>
            <Tag>{totalCards} thẻ</Tag>
          </Space>
          <Space wrap>
            <Input
              placeholder="Tìm mã đơn, bước, người phụ trách..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 280 }}
              suffix={search ? <QuickClearIcon onClear={() => setSearch('')} title="Xóa tìm kiếm" /> : undefined}
            />
            <Select<WftTrigger>
              value={effectiveTrigger}
              onChange={setTrigger}
              style={{ width: 200 }}
              options={triggerOptionsForEntity}
            />
            <Select<'SalesOrder' | 'Product' | 'Customer'>
              value={entityType}
              onChange={(v) => {
                setEntityType(v);
                setSelectedCard(null);
                setTimelineCard(null);
              }}
              style={{ width: 170 }}
              options={
                (availableEntityTypes.length
                  ? availableEntityTypes
                  : ['SalesOrder', 'Product', 'Customer']
                ).map((v) => ({ value: v, label: getEntityTypeLabel(v) }))
              }
            />
            <Select<'ALL' | 'OVERDUE' | 'DUE_TODAY' | 'AT_RISK'>
              value={slaFilter}
              onChange={setSlaFilter}
              style={{ width: 170 }}
              options={[
                { value: 'ALL', label: 'Tất cả SLA' },
                { value: 'OVERDUE', label: 'Chỉ quá hạn' },
                { value: 'DUE_TODAY', label: 'Đến hạn hôm nay' },
                { value: 'AT_RISK', label: 'Sắp quá hạn' },
              ]}
            />
            <Select<string>
              value={ownerFilter}
              onChange={setOwnerFilter}
              style={{ width: 180 }}
              options={[
                { value: 'ALL', label: 'Tất cả người phụ trách' },
                ...ownerOptions.map((v) => ({ value: v, label: v })),
              ]}
            />
            <Select<string>
              value={teamFilter}
              onChange={setTeamFilter}
              style={{ width: 170 }}
              options={[
                { value: 'ALL', label: 'Tất cả nhóm' },
                ...teamOptions.map((v) => ({ value: v, label: v })),
              ]}
            />
            <Button icon={<ReloadOutlined />} loading={boardQuery.isFetching} onClick={() => boardQuery.refetch()}>
              Tải lại
            </Button>
            <Button onClick={() => void saveCurrentFilters()}>Lưu bộ lọc</Button>
            <Button onClick={applySavedFilters}>Dùng bộ lọc đã lưu</Button>
            <Button onClick={() => setIsPresetModalOpen(true)}>Lưu mẫu lọc mới</Button>
            <Select<string>
              value={selectedPresetId}
              onChange={setSelectedPresetId}
              style={{ width: 200 }}
              options={[
                { value: 'NONE', label: 'Chọn mẫu lọc cá nhân' },
                ...namedPresets.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
            <Button onClick={applyNamedPreset}>Áp dụng mẫu lọc</Button>
            <Button danger onClick={() => void deleteNamedPreset()}>
              Xóa mẫu lọc
            </Button>
          </Space>
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Tag color="processing">Bộ dữ liệu: {getEntityTypeLabel(effectiveEntityType)} / {WFT_TRIGGER_LABELS[effectiveTrigger] ?? effectiveTrigger}</Tag>
          <Space size={6}>
            <Text type="secondary">Đồng bộ realtime</Text>
            <Switch checked={liveSync} onChange={setLiveSync} size="small" />
          </Space>
          {liveSync && (
            <Tag color={pipelineLiveQuery.data?.has_changes ? 'gold' : 'cyan'}>
              Realtime: {pipelineLiveQuery.isFetching ? 'đang kiểm tra' : 'đang chạy'}
            </Tag>
          )}
          <Segmented<QuickViewMode>
            value={quickView}
            onChange={(v) => setQuickView(v as QuickViewMode)}
            options={[
              { label: 'Mặc định', value: 'DEFAULT' },
              { label: 'Của tôi', value: 'MY_ITEMS' },
              { label: 'Nhóm tôi', value: 'MY_TEAM' },
              { label: 'Rủi ro', value: 'RISK' },
              { label: 'Thất bại', value: 'FAILED' },
            ]}
          />
          {isFallbackCombo && (
            <Tag color="gold">
              Đã tự chuyển từ {getEntityTypeLabel(entityType)} / {WFT_TRIGGER_LABELS[trigger] ?? trigger} sang bộ có mẫu đang bật
            </Tag>
          )}
        </div>
        {!!boardQuery.data?.meta?.message && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Tag color={boardQuery.data.meta.diagnostic_code === 'NO_TEMPLATE' ? 'red' : 'gold'} style={{ width: 'fit-content' }}>
              {boardQuery.data.meta.message}
            </Tag>
            {(boardQuery.data.meta.hints ?? []).length > 0 && (
              <div style={{ color: '#8c8c8c', fontSize: 12 }}>
                {(boardQuery.data.meta.hints ?? []).map((hint) => (
                  <div key={hint}>- {hint}</div>
                ))}
              </div>
            )}
          </div>
        )}
        {selectedEffectiveIds.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Tag color="purple">Đã chọn {selectedEffectiveIds.length} thẻ</Tag>
            <Button
              size="small"
              loading={bulkActionMutation.isPending}
              onClick={() => bulkActionMutation.mutate('ADVANCE')}
            >
              Chuyển bước hàng loạt
            </Button>
            <Button
              size="small"
              danger
              loading={bulkActionMutation.isPending}
              onClick={() => bulkActionMutation.mutate('FAIL')}
            >
              Đánh dấu thất bại hàng loạt
            </Button>
            <Button
              size="small"
              loading={bulkActionMutation.isPending}
              onClick={() => bulkActionMutation.mutate('RETRY_FAILED')}
            >
              Khôi phục thất bại hàng loạt
            </Button>
            <Button size="small" onClick={() => setSelectedEntityIds([])}>
              Bỏ chọn
            </Button>
          </div>
        )}
      </Card>

      {boardQuery.isLoading ? (
        <Card size="small"><div style={{ textAlign: 'center', padding: 40 }}><Spin /></div></Card>
      ) : !filteredColumns.length ? (
        <Card size="small">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={boardQuery.data?.meta?.message || 'Chưa có dữ liệu luồng công việc'}
          />
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: `repeat(${Math.max(filteredColumns.length, 1)}, minmax(220px, 1fr))`, alignItems: 'start' }}>
          {filteredColumns.map((col) => (
            <Card
              key={col.id}
              size="small"
              title={(
                <Space>
                  <span>{normalizeColumnTitle(col.title)}</span>
                  <Tag>{col.cards.length}</Tag>
                  {col.wip_limit ? <Tag color="cyan">Giới hạn WIP {col.wip_limit}</Tag> : null}
                  {col.is_over_wip ? (
                    <Tag color="red" icon={<ExclamationCircleOutlined />}>
                      Vượt giới hạn WIP
                    </Tag>
                  ) : null}
                </Space>
              )}
              bodyStyle={{ padding: 8, minHeight: 220 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (!draggingCard) return;
                moveMutation.mutate({ card: draggingCard, targetColumnId: col.id });
                setDraggingCard(null);
              }}
            >
              {col.cards.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Trống" />
              ) : (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {col.cards.map((card) => (
                    <div
                      key={`${col.id}-${card.entity_id}`}
                      draggable
                      onDragStart={() => setDraggingCard(card)}
                      onDragEnd={() => setDraggingCard(null)}
                      style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10, background: '#fafafa' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <Space size={6}>
                          <Checkbox
                            checked={selectedEffectiveIds.includes(card.entity_id)}
                            onChange={(e) => toggleSelectCard(card.entity_id, e.target.checked)}
                          />
                          <Tag color="blue" style={{ marginInlineEnd: 0 }}>{card.entity_code}</Tag>
                        </Space>
                        <Tag style={{ marginInlineEnd: 0 }}>{normalizeOrderStatus(card.order_status)}</Tag>
                      </div>
                      <div style={{ fontSize: 12, color: '#595959', marginBottom: 4 }}>{normalizeStepTitle(card.current_step)}</div>
                      <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 8 }}>
                        {card.owner || 'Chưa có người phụ trách'}{card.team ? ` • ${card.team}` : ''}
                      </div>
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        <Space size={4} wrap>
                          {renderSlaTag(card)}
                          {card.current_task_due_date && <Tag>{dayjs(card.current_task_due_date).format('DD/MM/YYYY')}</Tag>}
                        </Space>
                        {col.id !== 'done' && col.id !== 'failed' && (
                          <Button
                            size="small"
                            icon={<SwapRightOutlined />}
                            loading={advanceMutation.isPending}
                            onClick={() => advanceMutation.mutate(card)}
                            style={{ width: '100%' }}
                          >
                            Chuyển bước tiếp
                          </Button>
                        )}
                        <Button
                          size="small"
                          icon={<ProjectOutlined />}
                          onClick={() => setSelectedCard(card)}
                          style={{ width: '100%' }}
                        >
                          Mở công việc
                        </Button>
                        <Button
                          size="small"
                          icon={<HistoryOutlined />}
                          onClick={() => setTimelineCard(card)}
                          style={{ width: '100%' }}
                        >
                          Dòng thời gian
                        </Button>
                        {col.id !== 'failed' && (
                          <Button
                            size="small"
                            danger
                            icon={<WarningOutlined />}
                            loading={moveMutation.isPending}
                            onClick={() => moveMutation.mutate({ card, targetColumnId: 'failed' })}
                            style={{ width: '100%' }}
                          >
                            Đánh dấu thất bại
                          </Button>
                        )}
                        {col.id === 'failed' && (
                          <Button
                            size="small"
                            icon={<SwapRightOutlined />}
                            loading={retryFailedMutation.isPending}
                            onClick={() => retryFailedMutation.mutate(card)}
                            style={{ width: '100%' }}
                          >
                            Khôi phục xử lý
                          </Button>
                        )}
                      </Space>
                    </div>
                  ))}
                </Space>
              )}
            </Card>
          ))}
        </div>
      )}

      <Suspense fallback={null}>
        <TaskWorkspaceModalLazy
          open={!!selectedCard}
          onClose={() => setSelectedCard(null)}
          entityType={effectiveEntityType}
          entityId={selectedCard?.entity_id ?? null}
          entityCode={selectedCard?.entity_code}
          titlePrefix="Luồng công việc"
        />
      </Suspense>

      <Drawer
        title={timelineCard ? `Lịch sử luồng - ${timelineCard.entity_code}` : 'Lịch sử luồng'}
        width={520}
        open={!!timelineCard}
        onClose={() => setTimelineCard(null)}
        destroyOnClose
      >
        {timelineQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : (
          <List<WorkflowPipelineTimelineItem>
            dataSource={timelineQuery.data?.items ?? []}
            locale={{ emptyText: 'Chưa có sự kiện' }}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  title={
                    <Space size={8} wrap>
                      <Tag color="blue">{normalizeTimelineAction(item.action)}</Tag>
                      <Text>{item.from_step ? normalizeStepTitle(item.from_step) : '-'}</Text>
                      <SwapRightOutlined />
                      <Text>{item.to_step ? normalizeStepTitle(item.to_step) : '-'}</Text>
                    </Space>
                  }
                  description={
                    <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                        <div>{item.actor || 'Hệ thống'} • {item.created_at ? dayjs(item.created_at).format('DD/MM/YYYY HH:mm') : ''}</div>
                      {item.note ? <div>{item.note}</div> : null}
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>
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
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
          placeholder="Ví dụ: Ca sáng / Nhóm in / Rủi ro cao"
          maxLength={80}
          autoFocus
        />
      </Modal>
    </div>
  );
}
