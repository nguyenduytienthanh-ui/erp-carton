import { Suspense, lazy, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Col, Drawer, Empty, Input, List, Modal, Row, Segmented, Select, Space, Spin, Statistic, Switch, Tag, message } from 'antd';
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
import { SafeText as Text } from '../../components/SafeText';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { getEntityTypeLabel, PAGES } from '../../utils/constants';
import { storage } from '../../utils/storage';
import { useRealtimePollingInterval } from '../../hooks/useRealtimePollingInterval';
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

function normalizeTaskStatus(raw: string | null | undefined): string {
  if (!raw) return '-';
  const key = raw.toUpperCase();
  if (key === 'TODO') return 'Chờ thực hiện';
  if (key === 'IN_PROGRESS') return 'Đang xử lý';
  if (key === 'DONE') return 'Hoàn thành';
  if (key === 'CANCELLED') return 'Đã hủy';
  return raw;
}

const PRIORITY_LABELS: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT', string> = {
  LOW: 'Thấp',
  MEDIUM: 'Trung bình',
  HIGH: 'Cao',
  URGENT: 'Khẩn',
};

const PRIORITY_COLORS: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT', string> = {
  LOW: 'default',
  MEDIUM: 'blue',
  HIGH: 'orange',
  URGENT: 'red',
};

const QUICK_VIEW_LABELS: Record<'DEFAULT' | 'MY_ITEMS' | 'MY_TEAM' | 'RISK' | 'FAILED', string> = {
  DEFAULT: 'Mặc định',
  MY_ITEMS: 'Của tôi',
  MY_TEAM: 'Nhóm tôi',
  RISK: 'Rủi ro',
  FAILED: 'Thất bại',
};

const SUMMARY_TILE_STYLE = {
  minHeight: 116,
  borderRadius: 18,
  padding: '16px',
  display: 'flex',
  flexDirection: 'column' as const,
  justifyContent: 'space-between',
  background: 'linear-gradient(160deg, #ffffff 0%, #f7fbff 100%)',
  border: '1px solid #d6e4ff',
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)',
  height: '100%',
};

export default function WorkflowPipelineBoard() {
  type QuickViewMode = 'DEFAULT' | 'MY_ITEMS' | 'MY_TEAM' | 'RISK' | 'FAILED';
  type PipelineFilterSnapshot = {
    entity_type: string;
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

  const {
    config: savedConfig,
    saveConfig,
    isLoading: isPreferencesLoading,
  } = useUserPreferences(PAGES.WORKFLOW_PIPELINE_BOARD);
  const [entityType, setEntityType] = useState<string>('SalesOrder');
  const [trigger, setTrigger] = useState<WftTrigger>('SUBMIT');
  const [search, setSearch] = useState('');
  const [slaFilter, setSlaFilter] = useState<'ALL' | 'OVERDUE' | 'DUE_TODAY' | 'AT_RISK'>('ALL');
  const [ownerFilter, setOwnerFilter] = useState<string>('ALL');
  const [teamFilter, setTeamFilter] = useState<string>('ALL');
  const [quickView, setQuickView] = useState<QuickViewMode>('DEFAULT');
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
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
    activeMs: 10_000,
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
    return templates[0].entity_type;
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

  const boardSummary = useMemo(() => {
    const summary = {
      overdue: 0,
      dueToday: 0,
      atRisk: 0,
      blocked: 0,
      pinned: 0,
      failed: 0,
      unassigned: 0,
    };
    filteredColumns.forEach((col) => {
      col.cards.forEach((card) => {
        if (card.sla_state === 'OVERDUE') summary.overdue += 1;
        if (card.sla_state === 'DUE_TODAY') summary.dueToday += 1;
        if (card.sla_state === 'AT_RISK') summary.atRisk += 1;
        if (card.current_task_is_blocking) summary.blocked += 1;
        if (card.current_task_is_pinned) summary.pinned += 1;
        if (!card.owner) summary.unassigned += 1;
      });
      if (col.id === 'failed') summary.failed += col.cards.length;
    });
    return summary;
  }, [filteredColumns]);

  const allEntityIds = useMemo(() => {
    const ids = new Set<number>();
    (boardQuery.data?.columns ?? []).forEach((col) => {
      col.cards.forEach((card) => ids.add(card.entity_id));
    });
    return ids;
  }, [boardQuery.data?.columns]);

  const selectedEffectiveIds = selectedEntityIds.filter((id) => allEntityIds.has(id));

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (quickView !== 'DEFAULT') tags.push(`Góc nhìn: ${QUICK_VIEW_LABELS[quickView]}`);
    if (slaFilter !== 'ALL') {
      tags.push(`SLA: ${slaFilter === 'OVERDUE' ? 'Quá hạn' : slaFilter === 'DUE_TODAY' ? 'Đến hạn hôm nay' : 'Sắp quá hạn'}`);
    }
    if (ownerFilter !== 'ALL') tags.push(`Người phụ trách: ${ownerFilter}`);
    if (teamFilter !== 'ALL') tags.push(`Nhóm: ${teamFilter}`);
    if (search.trim()) tags.push(`Tìm kiếm: ${search.trim()}`);
    return tags;
  }, [ownerFilter, quickView, search, slaFilter, teamFilter]);

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
          (typeof entityType !== 'string' || !entityType)
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

  const selectedPreset = useMemo(
    () => namedPresets.find((preset) => preset.id === selectedPresetId) ?? null,
    [namedPresets, selectedPresetId]
  );

  const boardCommandSummary = useMemo(() => ({
    hotColumns: filteredColumns.filter((col) =>
      col.cards.some((card) => card.sla_state !== 'ON_TRACK' || card.current_task_is_blocking)
    ).length,
    emptyColumns: filteredColumns.filter((col) => col.cards.length === 0).length,
    overWipColumns: filteredColumns.filter((col) => col.is_over_wip).length,
    presetCount: namedPresets.length,
  }), [filteredColumns, namedPresets.length]);

  const boardStatusAlert = useMemo(() => {
    if (boardSummary.failed > 0 || boardSummary.overdue > 0 || boardSummary.blocked > 0) {
      return {
        type: 'warning' as const,
        message: 'Pipeline đang có thẻ cần xử lý ưu tiên.',
        description: `Hiện có ${boardSummary.overdue} thẻ quá hạn, ${boardSummary.blocked} thẻ đang chặn và ${boardSummary.failed} thẻ ở cột thất bại.`,
      };
    }
    if (boardCommandSummary.overWipColumns > 0 || boardSummary.unassigned > 0 || boardSummary.atRisk > 0) {
      return {
        type: 'info' as const,
        message: 'Pipeline ổn định nhưng vẫn còn điểm cần điều phối.',
        description: `Có ${boardCommandSummary.overWipColumns} cột vượt WIP, ${boardSummary.unassigned} thẻ chưa phụ trách và ${boardSummary.atRisk} thẻ đang tiệm cận SLA.`,
      };
    }
    return {
      type: 'success' as const,
      message: 'Pipeline đang ở trạng thái kiểm soát tốt.',
      description: `Tổng ${totalCards} thẻ đang được theo dõi, ${boardCommandSummary.presetCount} mẫu lọc cá nhân sẵn sàng cho các ca vận hành.`,
    };
  }, [boardCommandSummary.overWipColumns, boardCommandSummary.presetCount, boardSummary.atRisk, boardSummary.blocked, boardSummary.failed, boardSummary.overdue, boardSummary.unassigned, totalCards]);

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

  const parseFilterSnapshot = (value: unknown): PipelineFilterSnapshot | null => {
    if (!value || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    const entityTypeValue = obj.entity_type;
    const triggerValue = obj.trigger;
    const quickValue = obj.quick_view;
    const slaValue = obj.sla_filter;
    if (
      typeof entityTypeValue !== 'string'
      || !entityTypeValue
      || typeof triggerValue !== 'string'
      || (quickValue !== 'DEFAULT' && quickValue !== 'MY_ITEMS' && quickValue !== 'MY_TEAM' && quickValue !== 'RISK' && quickValue !== 'FAILED')
      || (slaValue !== 'ALL' && slaValue !== 'OVERDUE' && slaValue !== 'DUE_TODAY' && slaValue !== 'AT_RISK')
    ) {
      return null;
    }
    return {
      entity_type: entityTypeValue,
      trigger: triggerValue as WftTrigger,
      search: typeof obj.search === 'string' ? obj.search : '',
      quick_view: quickValue,
      sla_filter: slaValue,
      owner_filter: typeof obj.owner_filter === 'string' ? obj.owner_filter : 'ALL',
      team_filter: typeof obj.team_filter === 'string' ? obj.team_filter : 'ALL',
      live_sync: obj.live_sync !== false,
    };
  };

  const savedViewSnapshot = useMemo(() => {
    const directSnapshot = parseFilterSnapshot((savedConfig as Record<string, unknown>)?.saved_view_snapshot);
    if (directSnapshot) return directSnapshot;
    return parseFilterSnapshot(savedConfig);
  }, [savedConfig]);

  const resetBoardFilters = () => {
    setSearch('');
    setQuickView('DEFAULT');
    setSlaFilter('ALL');
    setOwnerFilter('ALL');
    setTeamFilter('ALL');
    setSelectedEntityIds([]);
    setSelectedPresetId(undefined);
    message.success('Đã đưa bảng luồng về trạng thái mặc định.');
  };

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
        saved_view_snapshot: currentSnapshot,
        saved_views: namedPresets,
      });
      message.success('Đã lưu bộ lọc luồng công việc.');
    } catch {
      message.error('Không thể lưu bộ lọc luồng công việc.');
    }
  };

  const applySavedFilters = () => {
    if (!savedViewSnapshot) {
      message.warning('Chưa có chế độ xem đã lưu.');
      return;
    }
    applyFilterSnapshot(savedViewSnapshot);
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
        saved_view_snapshot: currentSnapshot,
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
        saved_view_snapshot: buildCurrentSnapshot(),
        saved_views: nextPresets,
      });
      setSelectedPresetId(undefined);
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <Space wrap>
              <Text strong style={{ fontSize: 18 }}>Trung tâm điều phối quy trình</Text>
              <Tag color="blue">{getEntityTypeLabel(effectiveEntityType)}</Tag>
              <Tag>{WFT_TRIGGER_LABELS[effectiveTrigger] ?? effectiveTrigger}</Tag>
            </Space>
            <div style={{ color: '#666', fontSize: 13, marginTop: 6, maxWidth: 760 }}>
              Theo dõi luồng xử lý theo thời gian thực, nhận diện cột nóng, thẻ chặn và áp dụng nhanh các mẫu lọc cho từng ca vận hành.
            </div>
          </div>
          <Space wrap>
            <Tag color="processing" style={{ marginInlineEnd: 0 }}>
              Dữ liệu: {getEntityTypeLabel(effectiveEntityType)} / {WFT_TRIGGER_LABELS[effectiveTrigger] ?? effectiveTrigger}
            </Tag>
            {selectedPreset ? (
              <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                Mẫu đang dùng: {selectedPreset.name}
              </Tag>
            ) : null}
            {liveSync ? (
              <Tag color={pipelineLiveQuery.data?.has_changes ? 'gold' : 'cyan'} style={{ marginInlineEnd: 0 }}>
                Trực tiếp: {pipelineLiveQuery.isFetching ? 'đang kiểm tra thay đổi' : 'đang hoạt động'}
              </Tag>
            ) : (
              <Tag color="default" style={{ marginInlineEnd: 0 }}>
                Trực tiếp: đang tắt
              </Tag>
            )}
            <Button icon={<ReloadOutlined />} loading={boardQuery.isFetching} onClick={() => boardQuery.refetch()}>
              Tải lại
            </Button>
          </Space>
        </div>

        <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
          <Col xs={12} md={8} xl={3}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Tổng thẻ" value={totalCards} valueStyle={{ color: '#1677ff' }} />
              <Text type="secondary">Tổng số thẻ đang hiển thị trên bảng luồng.</Text>
            </div>
          </Col>
          <Col xs={12} md={8} xl={4}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Quá hạn" value={boardSummary.overdue} valueStyle={{ color: boardSummary.overdue > 0 ? '#cf1322' : undefined }} />
              <Text type="secondary">Thẻ đã vượt SLA hiện tại.</Text>
            </div>
          </Col>
          <Col xs={12} md={8} xl={4}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Đến hạn hôm nay" value={boardSummary.dueToday} valueStyle={{ color: boardSummary.dueToday > 0 ? '#d48806' : undefined }} />
              <Text type="secondary">Cần xử lý dứt điểm trong ngày.</Text>
            </div>
          </Col>
          <Col xs={12} md={8} xl={4}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Sắp quá hạn" value={boardSummary.atRisk} valueStyle={{ color: boardSummary.atRisk > 0 ? '#fa8c16' : undefined }} />
              <Text type="secondary">Đang tiệm cận ngưỡng cảnh báo.</Text>
            </div>
          </Col>
          <Col xs={12} md={8} xl={4}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Đang chặn" value={boardSummary.blocked} valueStyle={{ color: boardSummary.blocked > 0 ? '#cf1322' : undefined }} />
              <Text type="secondary">Thẻ có nhiệm vụ chặn sản xuất.</Text>
            </div>
          </Col>
          <Col xs={12} md={8} xl={4}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Thất bại" value={boardSummary.failed} valueStyle={{ color: boardSummary.failed > 0 ? '#cf1322' : undefined }} />
              <Text type="secondary">Nằm ở cột thất bại cần khôi phục.</Text>
            </div>
          </Col>
          <Col xs={12} md={8} xl={4}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Chưa phụ trách" value={boardSummary.unassigned} valueStyle={{ color: boardSummary.unassigned > 0 ? '#722ed1' : undefined }} />
              <Text type="secondary">Thẻ chưa có người xử lý chính.</Text>
            </div>
          </Col>
          <Col xs={12} md={8} xl={3}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Vượt WIP" value={boardCommandSummary.overWipColumns} valueStyle={{ color: boardCommandSummary.overWipColumns > 0 ? '#cf1322' : undefined }} />
              <Text type="secondary">Số cột đang vượt giới hạn công việc song song.</Text>
            </div>
          </Col>
          <Col xs={12} md={8} xl={3}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Mẫu lọc" value={boardCommandSummary.presetCount} valueStyle={{ color: '#531dab' }} />
              <Text type="secondary">Mẫu cá nhân đã lưu để đổi góc nhìn nhanh.</Text>
            </div>
          </Col>
        </Row>
        <Alert
          style={{ marginTop: 12 }}
          showIcon
          type={boardStatusAlert.type}
          message={boardStatusAlert.message}
          description={boardStatusAlert.description}
        />

        <div
          data-testid="workflow-pipeline-command-strip"
          style={{
            marginTop: 12,
            padding: '12px 14px',
            borderRadius: 16,
            border: '1px solid #e5eefc',
            background: 'linear-gradient(180deg, #fcfdff 0%, #f7fbff 100%)',
          }}
        >
          <Space wrap>
            <div data-testid="workflow-pipeline-search" style={{ display: 'inline-block' }}>
              <Input
                placeholder="Tìm mã đơn, bước, người phụ trách..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 280 }}
                suffix={search ? <QuickClearIcon onClear={() => setSearch('')} title="Xóa tìm kiếm" /> : undefined}
              />
            </div>
            <div data-testid="workflow-pipeline-trigger-filter" style={{ display: 'inline-block' }}>
              <Select<WftTrigger>
                value={effectiveTrigger}
                onChange={setTrigger}
                style={{ width: 200 }}
                options={triggerOptionsForEntity}
              />
            </div>
            <div data-testid="workflow-pipeline-entity-filter" style={{ display: 'inline-block' }}>
              <Select<string>
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
                    : ['SalesOrder', 'PurchaseOrder', 'ProductionOrder', 'Product', 'Customer']
                  ).map((v) => ({ value: v, label: getEntityTypeLabel(v) }))
                }
              />
            </div>
            <div data-testid="workflow-pipeline-sla-filter" style={{ display: 'inline-block' }}>
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
            </div>
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
            <Button
              data-testid="workflow-pipeline-save-view"
              onClick={() => void saveCurrentFilters()}
              disabled={isPreferencesLoading}
            >
              Lưu bộ lọc hiện tại
            </Button>
            <Button
              data-testid="workflow-pipeline-restore-view"
              onClick={applySavedFilters}
              disabled={isPreferencesLoading}
            >
              Khôi phục bộ lọc đã lưu
            </Button>
            <Button
              data-testid="workflow-pipeline-open-preset-modal"
              onClick={() => {
                setPresetName(selectedPreset?.name ?? '');
                setIsPresetModalOpen(true);
              }}
              disabled={isPreferencesLoading}
            >
              Tạo mẫu lọc mới
            </Button>
            <Button onClick={resetBoardFilters}>Đưa về mặc định</Button>
          </Space>
        </div>

        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Space size={6}>
            <Text type="secondary">Theo dõi trực tiếp</Text>
            <Switch checked={liveSync} onChange={setLiveSync} size="small" />
          </Space>
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
          <div data-testid="workflow-pipeline-preset-select" style={{ display: 'inline-block' }}>
            <Select<string>
              allowClear
              value={selectedPresetId}
              onChange={(value) => setSelectedPresetId(value)}
              disabled={isPreferencesLoading}
              style={{ width: 220 }}
              options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
              placeholder="Chọn mẫu lọc cá nhân"
            />
          </div>
          <Button data-testid="workflow-pipeline-apply-preset" onClick={applyNamedPreset} disabled={isPreferencesLoading}>
            Áp dụng mẫu lọc
          </Button>
          <Button
            danger
            data-testid="workflow-pipeline-delete-preset"
            disabled={!selectedPreset || isPreferencesLoading}
            onClick={() => void deleteNamedPreset()}
          >
            Xóa mẫu lọc
          </Button>
          {isFallbackCombo && (
            <Tag color="gold">
              Đã tự chuyển từ {getEntityTypeLabel(entityType)} / {WFT_TRIGGER_LABELS[trigger] ?? trigger} sang bộ có mẫu đang bật
            </Tag>
          )}
          <Tag color={boardCommandSummary.hotColumns > 0 ? 'volcano' : 'default'}>
            Cột nóng: {boardCommandSummary.hotColumns}
          </Tag>
          <Tag color={boardCommandSummary.emptyColumns > 0 ? 'default' : 'success'}>
            Cột trống: {boardCommandSummary.emptyColumns}
          </Tag>
          {selectedEffectiveIds.length > 0 && <Tag color="purple">Đã chọn {selectedEffectiveIds.length} thẻ</Tag>}
          {activeFilterTags.map((label) => (
            <Tag key={label}>{label}</Tag>
          ))}
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
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', alignItems: 'start' }}>
          {filteredColumns.map((col) => (
            <Card
              key={col.id}
              size="small"
              title={(() => {
                const columnRiskCount = col.cards.filter((card) => card.sla_state !== 'ON_TRACK').length;
                const columnBlockingCount = col.cards.filter((card) => card.current_task_is_blocking).length;
                const columnUnassignedCount = col.cards.filter((card) => !card.owner).length;

                return (
                  <Space size={6} wrap>
                    <span>{normalizeColumnTitle(col.title)}</span>
                    <Tag>{col.cards.length}</Tag>
                    {columnRiskCount > 0 ? <Tag color="gold">Rủi ro {columnRiskCount}</Tag> : null}
                    {columnBlockingCount > 0 ? <Tag color="error">Chặn {columnBlockingCount}</Tag> : null}
                    {columnUnassignedCount > 0 ? <Tag color="purple">Chưa giao {columnUnassignedCount}</Tag> : null}
                    {col.wip_limit ? <Tag color="cyan">Giới hạn WIP {col.wip_limit}</Tag> : null}
                    {col.is_over_wip ? (
                      <Tag color="red" icon={<ExclamationCircleOutlined />}>
                        Vượt giới hạn WIP
                      </Tag>
                    ) : null}
                  </Space>
                );
              })()}
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
                  {col.cards.map((card) => {
                    const isSelected = selectedEffectiveIds.includes(card.entity_id);
                    const cardBorderColor = isSelected
                      ? '#1677ff'
                      : card.current_task_is_blocking
                        ? '#ffd591'
                        : card.sla_state === 'OVERDUE'
                          ? '#ffa39e'
                          : card.sla_state === 'AT_RISK'
                            ? '#ffe58f'
                            : '#f0f0f0';
                    const cardBackground = card.current_task_is_blocking
                      ? '#fff7e6'
                      : card.sla_state === 'OVERDUE'
                        ? '#fff1f0'
                        : card.sla_state === 'AT_RISK'
                          ? '#fffbe6'
                          : '#fafafa';

                    return (
                      <div
                        key={`${col.id}-${card.entity_id}`}
                        draggable
                        onDragStart={() => setDraggingCard(card)}
                        onDragEnd={() => setDraggingCard(null)}
                        style={{
                          border: `1px solid ${cardBorderColor}`,
                          borderRadius: 12,
                          padding: 12,
                          background: cardBackground,
                          boxShadow: isSelected ? '0 0 0 2px rgba(22, 119, 255, 0.12)' : 'none',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
                          <Space size={6}>
                            <Checkbox
                              checked={isSelected}
                              onChange={(e) => toggleSelectCard(card.entity_id, e.target.checked)}
                            />
                            <Tag color="blue" style={{ marginInlineEnd: 0 }}>{card.entity_code}</Tag>
                          </Space>
                          <Tag style={{ marginInlineEnd: 0 }}>{normalizeOrderStatus(card.order_status)}</Tag>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1f1f1f', marginBottom: 4 }}>{normalizeStepTitle(card.current_step)}</div>
                        <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 8 }}>
                          {card.owner || 'Chưa có người phụ trách'}{card.team ? ` • ${card.team}` : ''}
                        </div>
                        <Space size={4} wrap style={{ marginBottom: 8 }}>
                          {renderSlaTag(card)}
                          {card.current_task_priority && (
                            <Tag color={PRIORITY_COLORS[card.current_task_priority]}>{PRIORITY_LABELS[card.current_task_priority]}</Tag>
                          )}
                          {card.current_task_status && <Tag>{normalizeTaskStatus(card.current_task_status)}</Tag>}
                          {card.current_task_is_blocking && <Tag color="red">Chặn</Tag>}
                          {card.current_task_is_pinned && <Tag color="magenta">Ghim</Tag>}
                          {card.current_task_due_date && <Tag>Hạn {dayjs(card.current_task_due_date).format('DD/MM')}</Tag>}
                        </Space>
                        {card.updated_at && (
                          <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 8 }}>
                            Cập nhật {dayjs(card.updated_at).format('DD/MM HH:mm')}
                          </div>
                        )}
                        <Space direction="vertical" size={6} style={{ width: '100%' }}>
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
                            Mở không gian công việc
                          </Button>
                          <Button
                            size="small"
                            icon={<HistoryOutlined />}
                            onClick={() => setTimelineCard(card)}
                            style={{ width: '100%' }}
                          >
                            Xem dòng thời gian
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
                              Chuyển sang thất bại
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
                    );
                  })}
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
          data-testid="workflow-pipeline-preset-name"
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
