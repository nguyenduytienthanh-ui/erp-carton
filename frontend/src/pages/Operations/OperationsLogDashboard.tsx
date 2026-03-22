import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Input, Modal, Select, Space, Spin, Switch, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { operationsApi, type OperationLogItem, type OperationSource, type OperationSuccessFilter } from '../../api/operations';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useRealtimePollingInterval } from '../../hooks/useRealtimePollingInterval';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { canViewOperationsLog } from '../../utils/authz';
import { PAGES } from '../../utils/constants';
import { storage } from '../../utils/storage';
import { downloadCSV } from '../../utils/csvExport';

const SOURCE_LABELS: Record<string, string> = {
  TASK_BULK: 'Nhiem vu hang loat',
  PIPELINE_EVENT: 'Luong xu ly',
  INSIGHT_ACTION: 'Phan tich',
  TASK_AUDIT: 'Kiem tra nhiem vu',
  AUTOMATION_RUN: 'Tu dong hoa',
};

const SOURCE_COLORS: Record<string, string> = {
  TASK_BULK: 'purple',
  PIPELINE_EVENT: 'blue',
  INSIGHT_ACTION: 'gold',
  TASK_AUDIT: 'default',
  AUTOMATION_RUN: 'cyan',
};

const ACTION_LABELS: Record<string, string> = {
  ADVANCE: 'Chuyen buoc',
  MOVE: 'Di chuyen',
  FAIL: 'Danh dau that bai',
  RETRY_FAILED: 'Khoi phuc that bai',
  RUN_AUTOMATION: 'Chay tu dong hoa',
  EXECUTE_INSIGHT: 'Thuc thi goi y',
  EXECUTE_BATCH: 'Thuc thi hang loat',
  COPY_HANDOVER: 'Sao chep ban giao',
  COPY_CHECKLIST: 'Sao chep danh sach',
  PLAYBOOK_APPLY: 'Ap dung kich ban',
  NOTIFY_ADMINS: 'Gui canh bao quan tri',
};
const OPERATION_SOURCE_VALUES: OperationSource[] = ['ALL', 'TASK_BULK', 'PIPELINE_EVENT', 'INSIGHT_ACTION', 'TASK_AUDIT', 'AUTOMATION_RUN'];
const OPERATION_SUCCESS_VALUES: OperationSuccessFilter[] = ['ALL', 'SUCCESS', 'FAILED'];

type OperationsLogViewSnapshot = {
  searchInput: string;
  actorQuery: string;
  actionFilter: string;
  sourceFilter: OperationSource;
  successFilter: OperationSuccessFilter;
  includeAll: boolean;
  liveSync: boolean;
};

type OperationsLogNamedPreset = {
  id: string;
  name: string;
  snapshot: OperationsLogViewSnapshot;
  updatedAt: string;
};

function formatActionLabel(raw: string): string {
  if (!raw) {
    return '-';
  }
  const key = raw.toUpperCase();
  if (ACTION_LABELS[key]) {
    return ACTION_LABELS[key];
  }
  const normalized = raw.replace(/_/g, ' ').toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function canViewAllLogs(): boolean {
  if (canViewOperationsLog()) {
    return true;
  }
  const user = storage.getUser() as unknown;
  if (!user || typeof user !== 'object') {
    return false;
  }
  const record = user as Record<string, unknown>;
  return record.is_staff === true || record.is_superuser === true;
}

function isOperationSource(value: unknown): value is OperationSource {
  return typeof value === 'string' && OPERATION_SOURCE_VALUES.includes(value as OperationSource);
}

function isOperationSuccessFilter(value: unknown): value is OperationSuccessFilter {
  return typeof value === 'string' && OPERATION_SUCCESS_VALUES.includes(value as OperationSuccessFilter);
}

export default function OperationsLogDashboard() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [actorQuery, setActorQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState<OperationSource>('ALL');
  const [successFilter, setSuccessFilter] = useState<OperationSuccessFilter>('ALL');
  const [liveSync, setLiveSync] = useState(true);
  const [includeAll, setIncludeAll] = useState(canViewAllLogs());
  const [selectedViewPresetId, setSelectedViewPresetId] = useState<string>();
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const liveSinceRef = useRef<string | null>(null);
  const { config, saveConfig } = useUserPreferences(PAGES.OPERATIONS_LOG_DASHBOARD);
  const configRecord = useMemo<Record<string, unknown>>(
    () => (config && typeof config === 'object' ? (config as Record<string, unknown>) : {}),
    [config],
  );
  const namedPresets = useMemo<OperationsLogNamedPreset[]>(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const preset = item as Partial<OperationsLogNamedPreset>;
        const snapshot = preset.snapshot as Partial<OperationsLogViewSnapshot> | undefined;
        if (
          typeof preset.id !== 'string' ||
          typeof preset.name !== 'string' ||
          !snapshot ||
          typeof snapshot.searchInput !== 'string' ||
          typeof snapshot.actorQuery !== 'string' ||
          typeof snapshot.actionFilter !== 'string' ||
          !isOperationSource(snapshot.sourceFilter) ||
          !isOperationSuccessFilter(snapshot.successFilter) ||
          typeof snapshot.includeAll !== 'boolean' ||
          typeof snapshot.liveSync !== 'boolean'
        ) {
          return null;
        }
        return {
          id: preset.id,
          name: preset.name,
          snapshot: {
            searchInput: snapshot.searchInput,
            actorQuery: snapshot.actorQuery,
            actionFilter: snapshot.actionFilter,
            sourceFilter: snapshot.sourceFilter,
            successFilter: snapshot.successFilter,
            includeAll: snapshot.includeAll,
            liveSync: snapshot.liveSync,
          },
          updatedAt: typeof preset.updatedAt === 'string' ? preset.updatedAt : new Date().toISOString(),
        };
      })
      .filter((item): item is OperationsLogNamedPreset => Boolean(item));
  }, [configRecord]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId],
  );

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: { actorQuery, actionFilter, sourceFilter, successFilter, includeAll },
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters: (filters) => JSON.stringify(filters),
    parseFilters: (raw) => {
      try {
        const parsed = JSON.parse(raw) as {
          actorQuery?: string;
          actionFilter?: string;
          sourceFilter?: OperationSource;
          successFilter?: OperationSuccessFilter;
          includeAll?: boolean;
        };
        return {
          actorQuery: parsed.actorQuery ?? '',
          actionFilter: parsed.actionFilter ?? 'ALL',
          sourceFilter: parsed.sourceFilter ?? 'ALL',
          successFilter: parsed.successFilter ?? 'ALL',
          includeAll: parsed.includeAll === true,
        };
      } catch {
        return {
          actorQuery: '',
          actionFilter: 'ALL',
          sourceFilter: 'ALL' as OperationSource,
          successFilter: 'ALL' as OperationSuccessFilter,
          includeAll: canViewAllLogs(),
        };
      }
    },
  });

  const livePollingInterval = useRealtimePollingInterval({
    enabled: liveSync,
    activeMs: 10_000,
    hiddenMs: false,
  });

  const logsQuery = useQuery({
    queryKey: [
      'operations-log',
      intentSearch,
      intentFilters.actorQuery,
      intentFilters.actionFilter,
      intentFilters.sourceFilter,
      intentFilters.successFilter,
      intentFilters.includeAll,
    ],
    queryFn: () =>
      operationsApi.list({
        q: intentSearch.trim() || undefined,
        actor_query: intentFilters.actorQuery.trim() || undefined,
        action: intentFilters.actionFilter,
        source: intentFilters.sourceFilter,
        success: intentFilters.successFilter,
        include_all: intentFilters.includeAll,
        limit: 200,
      }),
    staleTime: 5_000,
  });

  const logMetaQuery = useQuery({
    queryKey: ['operations-log-meta'],
    queryFn: () => operationsApi.meta(),
    staleTime: 30_000,
  });

  const liveQuery = useQuery({
    queryKey: [
      'operations-log-live',
      liveSync,
      intentSearch,
      intentFilters.actorQuery,
      intentFilters.actionFilter,
      intentFilters.sourceFilter,
      intentFilters.successFilter,
      intentFilters.includeAll,
    ],
    queryFn: () =>
      operationsApi.liveUpdates({
        since: liveSinceRef.current || undefined,
        q: intentSearch.trim() || undefined,
        actor_query: intentFilters.actorQuery.trim() || undefined,
        action: intentFilters.actionFilter,
        source: intentFilters.sourceFilter,
        success: intentFilters.successFilter,
        include_all: intentFilters.includeAll,
      }),
    enabled: liveSync,
    refetchInterval: livePollingInterval,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  useEffect(() => {
    liveSinceRef.current = null;
  }, [
    intentSearch,
    intentFilters.actorQuery,
    intentFilters.actionFilter,
    intentFilters.sourceFilter,
    intentFilters.successFilter,
    intentFilters.includeAll,
    liveSync,
  ]);

  useEffect(() => {
    const payload = liveQuery.data;
    if (!payload) {
      return;
    }
    if (payload.latest_at) {
      liveSinceRef.current = payload.latest_at;
    }
    if (!payload.has_changes) {
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ['operations-log'] });
  }, [liveQuery.data, queryClient]);

  const rows = useMemo(() => logsQuery.data?.items ?? [], [logsQuery.data?.items]);

  const stats = useMemo(() => {
    const successCount = rows.filter((item) => item.success === true).length;
    const failedCount = rows.filter((item) => item.success === false).length;
    const automationCount = rows.filter((item) => item.source === 'AUTOMATION_RUN').length;
    const actorCount = new Set(rows.map((item) => item.actor || 'He thong')).size;
    const latestAt = rows.reduce<string | null>((latest, item) => {
      if (!latest) {
        return item.created_at;
      }
      return dayjs(item.created_at).isAfter(dayjs(latest)) ? item.created_at : latest;
    }, null);
    return { successCount, failedCount, automationCount, actorCount, latestAt };
  }, [rows]);

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) {
      tags.push(`Tim kiem: ${intentSearch.trim()}`);
    }
    if (intentFilters.actorQuery.trim()) {
      tags.push(`Actor: ${intentFilters.actorQuery.trim()}`);
    }
    if (intentFilters.actionFilter !== 'ALL') {
      tags.push(`Hanh dong: ${formatActionLabel(intentFilters.actionFilter)}`);
    }
    if (intentFilters.sourceFilter !== 'ALL') {
      tags.push(`Nguon: ${SOURCE_LABELS[intentFilters.sourceFilter] || intentFilters.sourceFilter}`);
    }
    if (intentFilters.successFilter === 'SUCCESS') {
      tags.push('Ket qua: Thanh cong');
    }
    if (intentFilters.successFilter === 'FAILED') {
      tags.push('Ket qua: That bai');
    }
    if (canViewAllLogs() && intentFilters.includeAll) {
      tags.push('Pham vi: Toan he thong');
    }
    if (!liveSync) {
      tags.push('Live sync: Tam dung');
    }
    if (selectedViewPreset) {
      tags.push(`Mau loc: ${selectedViewPreset.name}`);
    }
    return tags;
  }, [
    intentFilters.actionFilter,
    intentFilters.actorQuery,
    intentFilters.includeAll,
    intentFilters.sourceFilter,
    intentFilters.successFilter,
    intentSearch,
    liveSync,
    selectedViewPreset,
  ]);

  const operationsAlert = useMemo(() => {
    const recentFailedCount = Number(logMetaQuery.data?.recent_failed_count_24h ?? 0);
    if (stats.failedCount > 0) {
      return {
        title: `Co ${stats.failedCount} ban ghi loi trong bo loc hien tai`,
        description: 'Nen ra soat cac loi van hanh dang hien tren workspace nay truoc khi tiep tuc cac tac vu hang loat hoac automation.',
        tone: 'warning' as const,
      };
    }
    if (recentFailedCount > 0) {
      return {
        title: `24h gan nhat co ${recentFailedCount} loi van hanh`,
        description: 'Luong hien tai da on hon, nhung van nen kiem tra lich su gan day de tranh loi lap lai.',
        tone: 'warning' as const,
      };
    }
    if (!liveSync) {
      return {
        title: 'Theo doi truc tiep dang tat',
        description: 'Ban van xem duoc lich su, nhung se khong co live polling cho toi khi bat lai lane nay.',
        tone: 'warning' as const,
      };
    }
    return {
      title: 'Nhat ky van hanh dang o trang thai on dinh',
      description: 'Live sync dang bat va chua co canh bao loi noi bat trong bo loc hien tai.',
      tone: 'steady' as const,
    };
  }, [logMetaQuery.data?.recent_failed_count_24h, liveSync, stats.failedCount]);

  const liveStatusMessage = !liveSync
    ? 'Theo doi truc tiep dang tat.'
    : liveQuery.isFetching
      ? 'Dang kiem tra thay doi nhat ky van hanh.'
      : liveQuery.data?.has_changes
        ? `Co ${liveQuery.data.changed_count} ban ghi moi vua duoc ghi nhan.`
        : 'Luong nhat ky dang on dinh va duoc cap nhat tu dong.';

  const failedRows = rows.filter((item) => item.success === false);
  const priorityRows = failedRows.length > 0 ? failedRows.slice(0, 5) : rows.slice(0, 5);

  const signalCards = useMemo(
    () => [
      {
        key: 'failed',
        title: 'That bai trong bo loc',
        value: `${stats.failedCount}`,
        detail: 'Diem nong can ra soat truoc khi tiep tuc batch run hoac automation.',
        tone: stats.failedCount > 0 ? 'critical' : 'steady',
        icon: <WarningOutlined />,
      },
      {
        key: 'automation',
        title: 'Ban ghi automation',
        value: `${stats.automationCount}`,
        detail: 'So ban ghi den tu automation run trong tap log dang xem.',
        tone: stats.automationCount > 0 ? 'warning' : 'steady',
        icon: <ReloadOutlined />,
      },
      {
        key: 'actors',
        title: 'Nguoi thao tac',
        value: `${stats.actorCount}`,
        detail: stats.latestAt ? `Ban ghi moi nhat luc ${dayjs(stats.latestAt).format('DD/MM HH:mm:ss')}` : 'Chua co du lieu log.',
        tone: 'steady',
        icon: <DownloadOutlined />,
      },
    ],
    [stats.actorCount, stats.automationCount, stats.failedCount, stats.latestAt],
  );

  const exportCsv = () => {
    if (rows.length === 0) {
      messageApi.warning('Khong co du lieu de xuat CSV.');
      return;
    }
    downloadCSV(
      rows.map((item) => ({
        thoi_gian: dayjs(item.created_at).format('DD/MM/YYYY HH:mm:ss'),
        nguon: SOURCE_LABELS[item.source] || item.source,
        hanh_dong: formatActionLabel(item.action),
        actor: item.actor || 'He thong',
        ket_qua: item.success === true ? 'Thanh cong' : item.success === false ? 'That bai' : '-',
        doi_tuong: item.entity_type,
        ma: item.entity_code || String(item.entity_id),
        noi_dung: item.message || '',
      })),
      `operations-log-${dayjs().format('YYYYMMDD_HHmmss')}`,
    );
    messageApi.success('Da xuat CSV nhat ky van hanh.');
  };

  const buildCurrentSnapshot = (): OperationsLogViewSnapshot => ({
    searchInput,
    actorQuery,
    actionFilter,
    sourceFilter,
    successFilter,
    includeAll: canViewAllLogs() ? includeAll : false,
    liveSync,
  });

  const applySnapshot = (snapshot: OperationsLogViewSnapshot) => {
    setSearchInput(snapshot.searchInput);
    setActorQuery(snapshot.actorQuery);
    setActionFilter(snapshot.actionFilter);
    setSourceFilter(snapshot.sourceFilter);
    setSuccessFilter(snapshot.successFilter);
    setIncludeAll(canViewAllLogs() ? snapshot.includeAll : false);
    setLiveSync(snapshot.liveSync);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...configRecord,
        saved_view: buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Da luu che do xem nhat ky van hanh.');
    } catch {
      messageApi.error('Khong the luu che do xem nhat ky van hanh.');
    }
  };

  const applySavedView = () => {
    const savedView = configRecord.saved_view;
    const snapshot = savedView as Partial<OperationsLogViewSnapshot> | undefined;
    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      typeof snapshot.searchInput !== 'string' ||
      typeof snapshot.actorQuery !== 'string' ||
      typeof snapshot.actionFilter !== 'string' ||
      !isOperationSource(snapshot.sourceFilter) ||
      !isOperationSuccessFilter(snapshot.successFilter) ||
      typeof snapshot.includeAll !== 'boolean' ||
      typeof snapshot.liveSync !== 'boolean'
    ) {
      messageApi.warning('Chua co che do xem nhat ky van hanh da luu.');
      return;
    }
    applySnapshot({
      searchInput: snapshot.searchInput,
      actorQuery: snapshot.actorQuery,
      actionFilter: snapshot.actionFilter,
      sourceFilter: snapshot.sourceFilter,
      successFilter: snapshot.successFilter,
      includeAll: snapshot.includeAll,
      liveSync: snapshot.liveSync,
    });
    messageApi.success('Da khoi phuc che do xem nhat ky van hanh.');
  };

  const saveNamedPreset = async () => {
    const trimmedName = viewPresetName.trim();
    if (!trimmedName) {
      messageApi.warning('Nhap ten mau loc nhat ky van hanh.');
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
      messageApi.success('Da luu mau loc nhat ky van hanh.');
    } catch {
      messageApi.error('Khong the luu mau loc nhat ky van hanh.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Chon mot mau loc nhat ky van hanh de ap dung.');
      return;
    }
    applySnapshot(preset.snapshot);
    messageApi.success(`Da ap dung mau loc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Chon mot mau loc nhat ky van hanh de xoa.');
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
      messageApi.success(`Da xoa mau loc "${preset.name}".`);
    } catch {
      messageApi.error('Khong the xoa mau loc nhat ky van hanh.');
    }
  };

  const columns: ColumnsType<OperationLogItem> = [
    {
      title: 'Thoi gian',
      key: 'created_at',
      width: 170,
      render: (_, row) => dayjs(row.created_at).format('DD/MM/YYYY HH:mm:ss'),
    },
    {
      title: 'Nguon',
      key: 'source',
      width: 140,
      render: (_, row) => <Tag color={SOURCE_COLORS[row.source] || 'default'}>{SOURCE_LABELS[row.source] || row.source}</Tag>,
    },
    {
      title: 'Hanh dong',
      dataIndex: 'action',
      key: 'action',
      width: 150,
      render: (value: string) => <Tag>{formatActionLabel(value)}</Tag>,
    },
    {
      title: 'Actor',
      dataIndex: 'actor',
      key: 'actor',
      width: 170,
      render: (value: string | null) => value || 'He thong',
    },
    {
      title: 'Ket qua',
      key: 'success',
      width: 120,
      render: (_, row) =>
        row.success === true ? (
          <Tag color="green">Thanh cong</Tag>
        ) : row.success === false ? (
          <Tag color="red">That bai</Tag>
        ) : (
          <Tag>-</Tag>
        ),
    },
    {
      title: 'Noi dung',
      key: 'message',
      render: (_, row) => (
        <Space direction="vertical" size={1}>
          <span>{row.message || '-'}</span>
          <span style={{ color: '#64748b', fontSize: 12 }}>
            {row.entity_type} · {row.entity_code || `#${row.entity_id}`}
          </span>
        </Space>
      ),
    },
  ];

  return (
    <div className="command-center">
      {contextHolder}

      <section className="command-center-hero">
        <div className="command-center-hero-grid">
          <div>
            <div className="command-center-eyebrow">Operations control · Live log · Automation pulse</div>
            <div className="command-center-title">Trung tam nhat ky van hanh</div>
            <div className="command-center-description">
              Theo doi thao tac van hanh, log automation va loi he thong trong mot workspace duoc cap nhat lien tuc.
            </div>

            <div className="command-center-hero-badges">
              <div className="command-center-hero-badge">
                <ReloadOutlined />
                <span>Live sync</span>
                <span className="command-center-hero-badge-value">{liveSync ? 'ON' : 'OFF'}</span>
              </div>
              <div className="command-center-hero-badge">
                <WarningOutlined />
                <span>Loi 24h</span>
                <span className="command-center-hero-badge-value">{logMetaQuery.data?.recent_failed_count_24h ?? 0}</span>
              </div>
              <div className="command-center-hero-badge">
                <DownloadOutlined />
                <span>Ban ghi</span>
                <span className="command-center-hero-badge-value">{rows.length}</span>
              </div>
            </div>

            <div className="command-center-hero-actions" data-testid="operations-log-command-strip">
              <div data-testid="operations-log-command-search" style={{ minWidth: 260, flex: '1 1 280px' }}>
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Tim noi dung, nguon, hanh dong..."
                  suffix={
                    searchInput ? (
                      <QuickClearIcon onClear={() => setSearchInput('')} title="Xoa tim kiem" />
                    ) : undefined
                  }
                />
              </div>
              <div data-testid="operations-log-actor-search" style={{ minWidth: 220, flex: '1 1 220px' }}>
                <Input
                  value={actorQuery}
                  onChange={(event) => setActorQuery(event.target.value)}
                  placeholder="Loc theo actor"
                  suffix={
                    actorQuery ? (
                      <QuickClearIcon onClear={() => setActorQuery('')} title="Xoa actor" />
                    ) : undefined
                  }
                />
              </div>
              <Button data-testid="operations-log-save-view" onClick={() => void saveCurrentView()}>
                Luu che do xem
              </Button>
              <Button data-testid="operations-log-restore-view" onClick={applySavedView}>
                Khoi phuc
              </Button>
              <Button
                data-testid="operations-log-open-preset-modal"
                onClick={() => {
                  setViewPresetName(selectedViewPreset?.name ?? '');
                  setIsViewPresetModalOpen(true);
                }}
              >
                Tao mau loc
              </Button>
              <div data-testid="operations-log-preset-select">
                <Select
                  style={{ width: 240 }}
                  placeholder="Chon mau loc nhat ky"
                  value={selectedViewPresetId}
                  onChange={(value) => setSelectedViewPresetId(value)}
                  options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
                />
              </div>
              <Button data-testid="operations-log-apply-preset" onClick={applyNamedPreset}>
                Ap dung mau
              </Button>
              <Button danger data-testid="operations-log-delete-preset" onClick={() => void deleteNamedPreset()}>
                Xoa mau
              </Button>
              <Button data-testid="operations-log-refresh" icon={<ReloadOutlined />} loading={logsQuery.isFetching} onClick={() => logsQuery.refetch()}>
                Tai lai
              </Button>
              <Button data-testid="operations-log-export-csv" icon={<DownloadOutlined />} onClick={exportCsv}>
                Xuat CSV
              </Button>
            </div>
          </div>

          <div className="command-center-hero-meta">
            <div className="command-center-hero-card">
              <div className="command-center-hero-card-label">Trang thai lane live</div>
              <div className="command-center-hero-card-value">{liveSync ? 'LIVE' : 'PAUSE'}</div>
              <div className="command-center-hero-card-caption">{liveStatusMessage}</div>
            </div>
            <div className="command-center-hero-card">
              <div className="command-center-hero-card-label">Pham vi</div>
              <div className="command-center-hero-card-value">{canViewAllLogs() && includeAll ? 'ALL' : 'ROLE'}</div>
              <div className="command-center-hero-card-caption">
                {canViewAllLogs() && includeAll ? 'Dang xem toan he thong.' : 'Dang xem theo quyen hien tai.'}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div
        className={`command-center-finance-alert ${
          operationsAlert.tone === 'steady' ? 'command-center-finance-alert--steady' : 'command-center-finance-alert--warning'
        }`}
      >
        <div>
          <div className="command-center-finance-alert-title">{operationsAlert.title}</div>
          <div className="command-center-finance-alert-description">{operationsAlert.description}</div>
        </div>
        <Space wrap>
          <span className="workspace-inline-note">{liveStatusMessage}</span>
          {stats.latestAt ? <Tag>{`Moi nhat ${dayjs(stats.latestAt).format('DD/MM HH:mm:ss')}`}</Tag> : null}
        </Space>
      </div>

      <div className="workspace-toolbar">
        <div className="workspace-toolbar-group">
          <div data-testid="operations-log-action-filter">
            <Select<string>
              value={actionFilter}
              onChange={setActionFilter}
              style={{ width: 170 }}
              options={[
                { value: 'ALL', label: 'Moi hanh dong' },
                ...((logMetaQuery.data?.actions ?? []).map((item) => ({ value: item.value, label: item.label }))),
              ]}
            />
          </div>
          <div data-testid="operations-log-source-filter">
            <Select<OperationSource>
              value={sourceFilter}
              onChange={setSourceFilter}
              style={{ width: 170 }}
              options={[
                { value: 'ALL', label: 'Moi nguon' },
                ...((logMetaQuery.data?.sources ?? []).map((item) => ({
                  value: item.value as OperationSource,
                  label: SOURCE_LABELS[item.value] || item.label,
                }))),
              ]}
            />
          </div>
          <div data-testid="operations-log-success-filter">
            <Select<OperationSuccessFilter>
              value={successFilter}
              onChange={setSuccessFilter}
              style={{ width: 150 }}
              options={[
                { value: 'ALL', label: 'Moi ket qua' },
                { value: 'SUCCESS', label: 'Thanh cong' },
                { value: 'FAILED', label: 'That bai' },
              ]}
            />
          </div>
        </div>

        <div className="workspace-toolbar-group">
          {canViewAllLogs() ? (
            <Space>
              <span className="workspace-inline-note">Toan he thong</span>
              <Switch checked={includeAll} onChange={setIncludeAll} size="small" />
            </Space>
          ) : null}
          <Space>
            <span className="workspace-inline-note">Theo doi truc tiep</span>
            <Switch checked={liveSync} onChange={setLiveSync} size="small" />
          </Space>
          {activeFilterTags.length > 0 ? activeFilterTags.map((tag) => <Tag key={tag}>{tag}</Tag>) : null}
        </div>
      </div>

      <div className="workspace-metric-grid">
        <div className="workspace-metric-card">
          <div className="workspace-metric-eyebrow">Ban ghi trong bo loc</div>
          <div className="workspace-metric-value">{rows.length}</div>
          <div className="workspace-metric-caption">So log dang hien thi theo dieu kien hien tai.</div>
        </div>
        <div className="workspace-metric-card workspace-metric-card--critical">
          <div className="workspace-metric-eyebrow">That bai</div>
          <div className="workspace-metric-value">{stats.failedCount}</div>
          <div className="workspace-metric-caption">Nhung log can uu tien ra soat truoc.</div>
        </div>
        <div className="workspace-metric-card workspace-metric-card--warning">
          <div className="workspace-metric-eyebrow">Automation</div>
          <div className="workspace-metric-value">{stats.automationCount}</div>
          <div className="workspace-metric-caption">Ban ghi den tu luong tu dong hoa.</div>
        </div>
        <div className="workspace-metric-card workspace-metric-card--steady">
          <div className="workspace-metric-eyebrow">Nguoi thao tac</div>
          <div className="workspace-metric-value">{stats.actorCount}</div>
          <div className="workspace-metric-caption">Do rong actor xuat hien trong tap log.</div>
        </div>
      </div>

      <div className="command-center-grid">
        <section className="command-center-panel">
          <div className="command-center-panel-header">
            <div>
              <div className="command-center-panel-kicker">Priority lane</div>
              <div className="command-center-panel-title">Ban ghi uu tien xu ly</div>
              <div className="command-center-panel-subtitle">
                Uu tien cac log that bai, neu khong co thi xem nhom log moi nhat trong lane van hanh.
              </div>
            </div>
          </div>

          <div className="command-center-watchlist">
            {priorityRows.length > 0 ? (
              priorityRows.map((row) => (
                <div
                  key={row.id}
                  className={`command-center-watch-item command-center-watch-item--${row.success === false ? 'critical' : 'warning'}`}
                >
                  <div className="command-center-watch-title">{`${SOURCE_LABELS[row.source] || row.source} · ${formatActionLabel(row.action)}`}</div>
                  <div className="command-center-watch-detail">
                    {dayjs(row.created_at).format('DD/MM/YYYY HH:mm:ss')} · {row.actor || 'He thong'}
                  </div>
                  <div className="workspace-inline-note">{row.message || `${row.entity_type} · ${row.entity_code || row.entity_id}`}</div>
                </div>
              ))
            ) : (
              <div className="command-center-empty">Chua co ban ghi de dua vao lane uu tien.</div>
            )}
          </div>
        </section>

        <section className="command-center-panel">
          <div className="command-center-panel-header">
            <div>
              <div className="command-center-panel-kicker">Signals</div>
              <div className="command-center-panel-title">Bo tin hieu van hanh</div>
              <div className="command-center-panel-subtitle">
                Nhin nhanh xem lane log dang bi nong o dau: fail, automation hay actor spread.
              </div>
            </div>
          </div>
          <div className="command-center-signal-grid">
            {signalCards.map((item) => (
              <div key={item.key} className={`command-center-signal-card command-center-signal-card--${item.tone}`}>
                <div className="command-center-card-head">
                  <div className="command-center-card-icon">{item.icon}</div>
                  <div className={`command-center-card-tone command-center-card-tone--${item.tone}`}>
                    {item.tone === 'critical' ? 'Can xu ly' : item.tone === 'warning' ? 'Theo doi' : 'On dinh'}
                  </div>
                </div>
                <div className="command-center-card-value">{item.value}</div>
                <div className="command-center-card-title">{item.title}</div>
                <div className="command-center-card-detail">{item.detail}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="command-center-panel">
        <div className="command-center-panel-header">
          <div>
            <div className="command-center-panel-kicker">Log table</div>
            <div className="command-center-panel-title">Bang nhat ky van hanh</div>
            <div className="command-center-panel-subtitle">
              Lane chi tiet de doi support, ops va automation review toan bo ban ghi trong bo loc hien tai.
            </div>
          </div>
        </div>

        {logsQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: 30 }}>
            <Spin />
          </div>
        ) : rows.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chua co du lieu nhat ky van hanh." />
        ) : (
          <Table<OperationLogItem>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={rows}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            scroll={{ x: 1200 }}
          />
        )}
      </section>
      <Modal
        title="Luu mau loc nhat ky van hanh"
        open={isViewPresetModalOpen}
        onCancel={() => {
          setIsViewPresetModalOpen(false);
          setViewPresetName('');
        }}
        onOk={() => void saveNamedPreset()}
        okText="Luu mau"
        cancelText="Dong"
      >
        <Input
          data-testid="operations-log-preset-name"
          value={viewPresetName}
          onChange={(event) => setViewPresetName(event.target.value)}
          placeholder="Vi du: Theo doi loi automation"
        />
      </Modal>
    </div>
  );
}
