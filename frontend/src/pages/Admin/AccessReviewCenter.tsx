import { useDeferredValue, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
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
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';

import PageHeader from '../../components/PageHeader/PageHeader';
import { adminApi } from '../../api/admin';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import type {
  AccessReviewActivityItem,
  AccessReviewCampaign,
  AccessReviewPreviewResponse,
  AccessReviewTargetUser,
  AccessReviewWatchlistItem,
} from '../../types/admin';
import { getToastMessage } from '../../shared/apiError';
import { downloadCSV } from '../../utils/csvExport';
import { PAGES } from '../../utils/constants';

const { Text, Paragraph } = Typography;

type CampaignStatusFilter = 'all' | 'active' | 'inactive' | 'findings';
type CampaignScopeFilter = 'all' | CampaignFormValues['scope'];
type CampaignActionFilter = 'all' | CampaignFormValues['review_action'];
type WatchlistSeverityFilter = 'all' | 'info' | 'warning' | 'error';
type ActivityKindFilter = 'all' | 'campaign' | 'review';

type CampaignFormValues = {
  key: string;
  name: string;
  description: string;
  is_active: boolean;
  tone: 'blue' | 'green' | 'gold' | 'cyan' | 'volcano' | 'purple';
  scope: 'all_active' | 'dormant' | 'privileged' | 'unassigned' | 'locked';
  review_action: 'certify' | 'revoke_access' | 'lock_account';
  role_ids: number[];
  team_ids: number[];
  inactivity_days: number;
  include_locked: boolean;
  only_active_users: boolean;
  checklist_text: string;
};
type AccessReviewFilterSnapshot = {
  campaign_search: string;
  campaign_status: CampaignStatusFilter;
  campaign_scope_filter: CampaignScopeFilter;
  campaign_action_filter: CampaignActionFilter;
  watchlist_severity: WatchlistSeverityFilter;
  activity_search: string;
  activity_kind_filter: ActivityKindFilter;
};
type AccessReviewNamedPreset = {
  id: string;
  name: string;
  filters: AccessReviewFilterSnapshot;
};

const HERO_CARD_STYLE: CSSProperties = {
  borderRadius: 22,
  border: '1px solid #d6e3f2',
  background: 'linear-gradient(180deg, #ffffff 0%, #f3f8ff 100%)',
  boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
};

const PANEL_STYLE: CSSProperties = {
  borderRadius: 22,
  border: '1px solid #e2e8f0',
  boxShadow: '0 14px 36px rgba(15, 23, 42, 0.06)',
};

const TONE_OPTIONS = [
  { value: 'blue', label: 'Xanh dương' },
  { value: 'green', label: 'Xanh lá' },
  { value: 'gold', label: 'Vàng' },
  { value: 'cyan', label: 'Xanh ngọc' },
  { value: 'volcano', label: 'Đỏ cam' },
  { value: 'purple', label: 'Tím' },
] as const;

const DEFAULT_FORM_VALUES: CampaignFormValues = {
  key: '',
  name: '',
  description: '',
  is_active: true,
  tone: 'blue',
  scope: 'dormant',
  review_action: 'certify',
  role_ids: [],
  team_ids: [],
  inactivity_days: 45,
  include_locked: false,
  only_active_users: true,
  checklist_text: '',
};

function formatDateTime(value?: string | null): string {
  if (!value) return 'Chưa ghi nhận';
  return dayjs(value).format('DD/MM/YYYY HH:mm');
}

function toneColor(tone: string): string {
  if (tone === 'green') return 'green';
  if (tone === 'gold') return 'gold';
  if (tone === 'cyan') return 'cyan';
  if (tone === 'volcano') return 'volcano';
  if (tone === 'purple') return 'purple';
  return 'blue';
}

function severityColor(severity: string): string {
  if (severity === 'error') return 'volcano';
  if (severity === 'warning') return 'gold';
  return 'blue';
}

function riskColor(riskLevel: string): string {
  if (riskLevel === 'error') return 'volcano';
  if (riskLevel === 'warning') return 'gold';
  return 'blue';
}

function actionColor(action: string): string {
  if (action === 'CREATE') return 'green';
  if (action === 'DELETE') return 'volcano';
  return 'blue';
}

function buildChecklistText(checklist: string[]): string {
  return checklist.join('\n');
}

function parseChecklistText(rawValue: string): string[] {
  return rawValue
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function SummaryCard({
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

function renderCompactTags(items: Array<{ id: number; code: string; name: string }>, emptyLabel: string) {
  if (!items.length) return <Tag>{emptyLabel}</Tag>;
  return (
    <Space size={[6, 6]} wrap>
      {items.slice(0, 3).map((item) => (
        <Tag key={`${item.id}-${item.code}`}>{item.name || item.code}</Tag>
      ))}
      {items.length > 3 ? <Tag>+{items.length - 3}</Tag> : null}
    </Space>
  );
}

export default function AccessReviewCenter() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [searchParams] = useSearchParams();
  const focusCampaignKey = searchParams.get('campaign_key') || '';
  const focusSearch = searchParams.get('search') || '';
  const [campaignSearch, setCampaignSearch] = useState(focusSearch);
  const [campaignStatus, setCampaignStatus] = useState<CampaignStatusFilter>('all');
  const [campaignScopeFilter, setCampaignScopeFilter] = useState<CampaignScopeFilter>('all');
  const [campaignActionFilter, setCampaignActionFilter] = useState<CampaignActionFilter>('all');
  const [watchlistSeverity, setWatchlistSeverity] = useState<WatchlistSeverityFilter>('all');
  const [activitySearch, setActivitySearch] = useState(focusSearch);
  const [activityKindFilter, setActivityKindFilter] = useState<ActivityKindFilter>('all');
  const [selectedPresetId, setSelectedPresetId] = useState('NONE');
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<AccessReviewCampaign | null>(null);
  const [selectedCampaignKey, setSelectedCampaignKey] = useState<string | undefined>(focusCampaignKey || undefined);
  const [previewData, setPreviewData] = useState<AccessReviewPreviewResponse | null>(null);
  const [selectedTargetIds, setSelectedTargetIds] = useState<number[]>([]);
  const [applyNote, setApplyNote] = useState('');
  const [form] = Form.useForm<CampaignFormValues>();
  const deferredSearch = useDeferredValue(normalizeSearch(campaignSearch));
  const deferredActivitySearch = useDeferredValue(normalizeSearch(activitySearch));
  const { config: savedConfig, saveConfig } = useUserPreferences(PAGES.ADMIN_ACCESS_REVIEWS);
  const namedPresets = useMemo(() => {
    const raw = savedConfig?.saved_views;
    if (!Array.isArray(raw)) return [] as AccessReviewNamedPreset[];
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id : '';
        const name = typeof record.name === 'string' ? record.name : '';
        const filters = record.filters;
        if (!id || !name || !filters || typeof filters !== 'object') return null;
        const filterRecord = filters as Record<string, unknown>;
        const campaignStatusValue = filterRecord.campaign_status;
        const campaignScopeValue = filterRecord.campaign_scope_filter;
        const campaignActionValue = filterRecord.campaign_action_filter;
        const watchlistSeverityValue = filterRecord.watchlist_severity;
        const activityKindValue = filterRecord.activity_kind_filter;
        if (
          campaignStatusValue !== 'all'
          && campaignStatusValue !== 'active'
          && campaignStatusValue !== 'inactive'
          && campaignStatusValue !== 'findings'
        ) {
          return null;
        }
        if (
          campaignScopeValue !== 'all'
          && campaignScopeValue !== 'all_active'
          && campaignScopeValue !== 'dormant'
          && campaignScopeValue !== 'privileged'
          && campaignScopeValue !== 'unassigned'
          && campaignScopeValue !== 'locked'
        ) {
          return null;
        }
        if (
          campaignActionValue !== 'all'
          && campaignActionValue !== 'certify'
          && campaignActionValue !== 'revoke_access'
          && campaignActionValue !== 'lock_account'
        ) {
          return null;
        }
        if (
          watchlistSeverityValue !== 'all'
          && watchlistSeverityValue !== 'info'
          && watchlistSeverityValue !== 'warning'
          && watchlistSeverityValue !== 'error'
        ) {
          return null;
        }
        if (
          activityKindValue !== 'all'
          && activityKindValue !== 'campaign'
          && activityKindValue !== 'review'
        ) {
          return null;
        }
        return {
          id,
          name,
          filters: {
            campaign_search: typeof filterRecord.campaign_search === 'string' ? filterRecord.campaign_search : '',
            campaign_status: campaignStatusValue,
            campaign_scope_filter: campaignScopeValue,
            campaign_action_filter: campaignActionValue,
            watchlist_severity: watchlistSeverityValue,
            activity_search: typeof filterRecord.activity_search === 'string' ? filterRecord.activity_search : '',
            activity_kind_filter: activityKindValue,
          },
        } as AccessReviewNamedPreset;
      })
      .filter((item): item is AccessReviewNamedPreset => item !== null);
  }, [savedConfig?.saved_views]);
  const selectedPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedPresetId) ?? null,
    [namedPresets, selectedPresetId]
  );

  const workspaceQuery = useQuery({
    queryKey: ['admin-access-review-workspace'],
    queryFn: adminApi.getAccessReviewWorkspace,
  });
  const activityQuery = useQuery({
    queryKey: ['admin-access-review-activity'],
    queryFn: () => adminApi.getAccessReviewActivity({ limit: 40 }),
  });

  const resetCampaignWorkspace = () => {
    setPreviewData(null);
    setSelectedTargetIds([]);
    setApplyNote('');
  };

  const setCampaignSelection = (nextKey?: string) => {
    setSelectedCampaignKey(nextKey);
    resetCampaignWorkspace();
  };

  const saveMutation = useMutation({
    mutationFn: adminApi.saveAccessReviewCampaign,
    onSuccess: async (response) => {
      messageApi.success(response.action === 'CREATE' ? 'Đã tạo chiến dịch rà soát truy cập.' : 'Đã cập nhật chiến dịch rà soát truy cập.');
      setDrawerOpen(false);
      setEditingCampaign(null);
      setCampaignSelection(response.campaign.key);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-access-review-workspace'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-access-review-activity'] }),
      ]);
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Không thể lưu chiến dịch rà soát truy cập.'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: adminApi.deleteAccessReviewCampaign,
    onSuccess: async (response) => {
      messageApi.success('Đã xóa chiến dịch rà soát truy cập.');
      if (resolvedSelectedCampaignKey === response.key) {
        setCampaignSelection(undefined);
      } else {
        resetCampaignWorkspace();
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-access-review-workspace'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-access-review-activity'] }),
      ]);
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Không thể xóa chiến dịch rà soát truy cập.'));
    },
  });

  const previewMutation = useMutation({
    mutationFn: adminApi.previewAccessReview,
    onSuccess: (response) => {
      setPreviewData(response);
      setSelectedTargetIds(response.selected_user_ids);
      messageApi.success(`Bản xem trước đã sẵn sàng cho ${response.summary.selected_users} tài khoản.`);
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Không thể xem trước đợt rà soát truy cập.'));
    },
  });

  const applyMutation = useMutation({
    mutationFn: adminApi.applyAccessReview,
    onSuccess: async (response) => {
      messageApi.success(`Đã áp dụng chiến dịch cho ${response.summary.processed_users} tài khoản.`);
      resetCampaignWorkspace();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-access-review-workspace'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-access-review-activity'] }),
      ]);
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Không thể áp dụng đợt rà soát truy cập.'));
    },
  });

  const campaignResults = workspaceQuery.data?.campaigns;
  const campaigns = campaignResults ?? [];
  let resolvedSelectedCampaignKey = selectedCampaignKey;
  if (!resolvedSelectedCampaignKey && focusCampaignKey) {
    const matchedByKey = campaigns.find((item) => item.key === focusCampaignKey);
    resolvedSelectedCampaignKey = matchedByKey?.key;
  }
  if (!resolvedSelectedCampaignKey) {
    const normalizedFocus = normalizeSearch(focusSearch);
    if (normalizedFocus) {
      const matchedBySearch = campaigns.find((campaign) => (
        normalizeSearch([campaign.key, campaign.name, campaign.description].join(' ')).includes(normalizedFocus)
      ));
      resolvedSelectedCampaignKey = matchedBySearch?.key;
    }
  }
  if (!resolvedSelectedCampaignKey) {
    resolvedSelectedCampaignKey = campaigns[0]?.key;
  }
  const selectedCampaign = campaigns.find((item) => item.key === resolvedSelectedCampaignKey) ?? campaigns[0];
  const scopeOptions = workspaceQuery.data?.scope_options ?? [];
  const actionOptions = workspaceQuery.data?.action_options ?? [];
  const roleOptions = workspaceQuery.data?.roles ?? [];
  const teamOptions = workspaceQuery.data?.teams ?? [];

  const filteredCampaigns = campaigns.filter((campaign) => {
    const searchTarget = [
      campaign.name,
      campaign.key,
      campaign.description,
      campaign.scope_label,
      campaign.review_action_label,
    ].join(' ').toLowerCase();
    const matchesSearch = !deferredSearch || searchTarget.includes(deferredSearch);
    const matchesStatus =
      campaignStatus === 'all'
      || (campaignStatus === 'active' && campaign.is_active)
      || (campaignStatus === 'inactive' && !campaign.is_active)
      || (campaignStatus === 'findings' && campaign.has_findings);
    const matchesScope = campaignScopeFilter === 'all' || campaign.scope === campaignScopeFilter;
    const matchesAction = campaignActionFilter === 'all' || campaign.review_action === campaignActionFilter;
    return matchesSearch && matchesStatus && matchesScope && matchesAction;
  });
  const filteredWatchlist = (workspaceQuery.data?.watchlist ?? []).filter((item) => (
    watchlistSeverity === 'all' || item.severity === watchlistSeverity
  ));
  const filteredActivity = (activityQuery.data?.items ?? workspaceQuery.data?.recent_activity ?? []).filter((item) => {
    const searchTarget = normalizeSearch([
      item.summary,
      item.entity_code,
      item.actor.full_name,
      item.actor.username,
      item.action,
      item.kind,
    ].join(' '));
    const matchesSearch = !deferredActivitySearch || searchTarget.includes(deferredActivitySearch);
    const matchesKind = activityKindFilter === 'all' || item.kind === activityKindFilter;
    return matchesSearch && matchesKind;
  });
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (campaignSearch.trim()) tags.push(`Chiến dịch: ${campaignSearch.trim()}`);
    if (campaignStatus !== 'all') tags.push(`Trạng thái: ${campaignStatus}`);
    if (campaignScopeFilter !== 'all') tags.push(`Phạm vi: ${campaignScopeFilter}`);
    if (campaignActionFilter !== 'all') tags.push(`Hành động: ${campaignActionFilter}`);
    if (watchlistSeverity !== 'all') tags.push(`Watchlist: ${watchlistSeverity}`);
    if (activitySearch.trim()) tags.push(`Nhật ký: ${activitySearch.trim()}`);
    if (activityKindFilter !== 'all') tags.push(`Loại hoạt động: ${activityKindFilter}`);
    if (selectedPreset) tags.push(`Mẫu đang dùng: ${selectedPreset.name}`);
    return tags;
  }, [
    activityKindFilter,
    activitySearch,
    campaignActionFilter,
    campaignScopeFilter,
    campaignSearch,
    campaignStatus,
    selectedPreset,
    watchlistSeverity,
  ]);

  const buildCurrentSnapshot = (): AccessReviewFilterSnapshot => ({
    campaign_search: campaignSearch,
    campaign_status: campaignStatus,
    campaign_scope_filter: campaignScopeFilter,
    campaign_action_filter: campaignActionFilter,
    watchlist_severity: watchlistSeverity,
    activity_search: activitySearch,
    activity_kind_filter: activityKindFilter,
  });

  const applySnapshot = (snapshot: AccessReviewFilterSnapshot) => {
    setCampaignSearch(snapshot.campaign_search);
    setCampaignStatus(snapshot.campaign_status);
    setCampaignScopeFilter(snapshot.campaign_scope_filter);
    setCampaignActionFilter(snapshot.campaign_action_filter);
    setWatchlistSeverity(snapshot.watchlist_severity);
    setActivitySearch(snapshot.activity_search);
    setActivityKindFilter(snapshot.activity_kind_filter);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...savedConfig,
        ...buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem access review.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem access review.');
    }
  };

  const applySavedView = () => {
    const snapshot: AccessReviewFilterSnapshot = {
      campaign_search: typeof savedConfig?.campaign_search === 'string' ? savedConfig.campaign_search : '',
      campaign_status: savedConfig?.campaign_status === 'active'
        || savedConfig?.campaign_status === 'inactive'
        || savedConfig?.campaign_status === 'findings'
        ? savedConfig.campaign_status
        : 'all',
      campaign_scope_filter: savedConfig?.campaign_scope_filter === 'all_active'
        || savedConfig?.campaign_scope_filter === 'dormant'
        || savedConfig?.campaign_scope_filter === 'privileged'
        || savedConfig?.campaign_scope_filter === 'unassigned'
        || savedConfig?.campaign_scope_filter === 'locked'
        ? savedConfig.campaign_scope_filter
        : 'all',
      campaign_action_filter: savedConfig?.campaign_action_filter === 'certify'
        || savedConfig?.campaign_action_filter === 'revoke_access'
        || savedConfig?.campaign_action_filter === 'lock_account'
        ? savedConfig.campaign_action_filter
        : 'all',
      watchlist_severity: savedConfig?.watchlist_severity === 'info'
        || savedConfig?.watchlist_severity === 'warning'
        || savedConfig?.watchlist_severity === 'error'
        ? savedConfig.watchlist_severity
        : 'all',
      activity_search: typeof savedConfig?.activity_search === 'string' ? savedConfig.activity_search : '',
      activity_kind_filter: savedConfig?.activity_kind_filter === 'campaign'
        || savedConfig?.activity_kind_filter === 'review'
        ? savedConfig.activity_kind_filter
        : 'all',
    };
    applySnapshot(snapshot);
    messageApi.success('Đã khôi phục chế độ xem access review đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = presetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: AccessReviewNamedPreset = existing
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
      setSelectedPresetId(nextPreset.id);
      setPresetName('');
      setIsPresetModalOpen(false);
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc access review.' : 'Đã lưu mẫu lọc access review mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc access review.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc access review.');
      return;
    }
    applySnapshot(preset.filters);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc access review để xóa.');
      return;
    }
    const nextPresets = namedPresets.filter((item) => item.id !== preset.id);
    try {
      await saveConfig({
        ...savedConfig,
        ...buildCurrentSnapshot(),
        saved_views: nextPresets,
      });
      setSelectedPresetId('NONE');
      messageApi.success(`Đã xóa mẫu lọc "${preset.name}".`);
    } catch {
      messageApi.error('Không thể xóa mẫu lọc access review.');
    }
  };

  const openCreateDrawer = (source?: AccessReviewCampaign | null) => {
    const nextSource = source ?? null;
    const isDuplicate = Boolean(source);
    setEditingCampaign(nextSource && !isDuplicate ? nextSource : null);
    form.setFieldsValue(
      nextSource
        ? {
            key: isDuplicate ? `${nextSource.key}-copy` : nextSource.key,
            name: isDuplicate ? `${nextSource.name} Copy` : nextSource.name,
            description: nextSource.description,
            is_active: nextSource.is_active,
            tone: nextSource.tone as CampaignFormValues['tone'],
            scope: nextSource.scope as CampaignFormValues['scope'],
            review_action: nextSource.review_action as CampaignFormValues['review_action'],
            role_ids: nextSource.role_ids,
            team_ids: nextSource.team_ids,
            inactivity_days: nextSource.inactivity_days,
            include_locked: nextSource.include_locked,
            only_active_users: nextSource.only_active_users,
            checklist_text: buildChecklistText(nextSource.checklist),
          }
        : DEFAULT_FORM_VALUES,
    );
    setDrawerOpen(true);
  };

  const openEditDrawer = (campaign: AccessReviewCampaign) => {
    setEditingCampaign(campaign);
    form.setFieldsValue({
      key: campaign.key,
      name: campaign.name,
      description: campaign.description,
      is_active: campaign.is_active,
      tone: campaign.tone as CampaignFormValues['tone'],
      scope: campaign.scope as CampaignFormValues['scope'],
      review_action: campaign.review_action as CampaignFormValues['review_action'],
      role_ids: campaign.role_ids,
      team_ids: campaign.team_ids,
      inactivity_days: campaign.inactivity_days,
      include_locked: campaign.include_locked,
      only_active_users: campaign.only_active_users,
      checklist_text: buildChecklistText(campaign.checklist),
    });
    setDrawerOpen(true);
  };

  const handleSaveCampaign = async () => {
    const values = await form.validateFields();
    await saveMutation.mutateAsync({
      key: values.key,
      name: values.name,
      description: values.description,
      is_active: values.is_active,
      tone: values.tone,
      scope: values.scope,
      review_action: values.review_action,
      role_ids: values.role_ids,
      team_ids: values.team_ids,
      inactivity_days: values.inactivity_days,
      include_locked: values.include_locked,
      only_active_users: values.only_active_users,
      checklist: parseChecklistText(values.checklist_text),
    });
  };

  const handleDeleteCampaign = (campaign: AccessReviewCampaign) => {
    Modal.confirm({
      title: 'Xóa chiến dịch rà soát truy cập?',
      content: `Chiến dịch ${campaign.name} sẽ bị gỡ khỏi không gian làm việc, nhưng lịch sử kiểm toán vẫn được giữ lại.`,
      okText: 'Xóa chiến dịch',
      okButtonProps: { danger: true },
      cancelText: 'Hủy',
      onOk: async () => {
        await deleteMutation.mutateAsync(campaign.key);
      },
    });
  };

  const handlePreview = async (campaign: AccessReviewCampaign, manualSelection?: number[]) => {
    await previewMutation.mutateAsync({
      campaign_key: campaign.key,
      selected_user_ids: manualSelection && manualSelection.length ? manualSelection : undefined,
    });
  };

  const handleApply = async (campaign: AccessReviewCampaign) => {
    await applyMutation.mutateAsync({
      campaign_key: campaign.key,
      selected_user_ids: selectedTargetIds.length ? selectedTargetIds : undefined,
      note: applyNote.trim() || undefined,
    });
  };

  const applySelectionPreset = (preset: 'all' | 'risk' | 'privileged' | 'locked' | 'clear') => {
    if (!previewData) return;
    if (preset === 'clear') {
      setSelectedTargetIds([]);
      return;
    }
    const nextIds = previewData.target_users
      .filter((user) => {
        if (preset === 'all') return true;
        if (preset === 'risk') return ['warning', 'error'].includes(user.risk_level);
        if (preset === 'privileged') return user.is_privileged;
        if (preset === 'locked') return user.is_locked;
        return false;
      })
      .map((user) => user.id);
    setSelectedTargetIds(nextIds);
  };

  const exportCampaignLibrary = () => {
    if (!filteredCampaigns.length) {
      messageApi.warning('Chưa có chiến dịch phù hợp để xuất CSV.');
      return;
    }
    downloadCSV(
      filteredCampaigns.map((campaign) => ({
        'Khóa chiến dịch': campaign.key,
        'Tên chiến dịch': campaign.name,
        'Phạm vi': campaign.scope_label,
        'Hành động rà soát': campaign.review_action_label,
        'Trạng thái': campaign.is_active ? 'Đang kích hoạt' : 'Tạm dừng',
        'Có phát hiện': campaign.has_findings ? 'Có' : 'Không',
        'Người dùng khớp': campaign.matched_user_count,
        'Tài khoản đặc quyền': campaign.privileged_match_count,
        'Bộ lọc vai trò': campaign.role_count,
        'Bộ lọc nhóm': campaign.team_count,
      })),
      'access-review-campaigns',
    );
  };

  const exportWatchlist = () => {
    if (!filteredWatchlist.length) {
      messageApi.warning('Chưa có danh sách ưu tiên cần xuất CSV.');
      return;
    }
    downloadCSV(
      filteredWatchlist.map((item) => ({
        'Mức độ': item.severity,
        'Tiêu đề': item.title,
        'Mô tả': item.description,
        'Chiến dịch': item.campaign_key,
        'Số tài khoản khớp': item.matched_user_count,
      })),
      'access-review-watchlist',
    );
  };

  const exportActivity = () => {
    if (!filteredActivity.length) {
      messageApi.warning('Chưa có hoạt động phù hợp để xuất CSV.');
      return;
    }
    downloadCSV(
      filteredActivity.map((item) => ({
        'Thời điểm': formatDateTime(item.timestamp),
        'Loại': item.kind,
        'Hành động': item.action,
        'Tóm tắt': item.summary,
        'Mã đối tượng': item.entity_code,
        'Người thao tác': item.actor.full_name || item.actor.username || 'Hệ thống',
      })),
      'access-review-activity',
    );
  };

  const campaignColumns: ColumnsType<AccessReviewCampaign> = [
    {
      title: 'Chiến dịch',
      key: 'campaign',
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Space wrap>
            <Text strong>{record.name}</Text>
            <Tag color={toneColor(record.tone)}>{record.scope_label}</Tag>
            <Tag>{record.review_action_label}</Tag>
          </Space>
          <Text type="secondary">{record.description || 'Chưa có mô tả chiến dịch.'}</Text>
          <Space size={[6, 6]} wrap>
            <Tag color={record.is_active ? 'green' : 'default'}>{record.is_active ? 'Đang kích hoạt' : 'Tạm dừng'}</Tag>
            {record.has_findings ? <Tag color="gold">Cần rà soát</Tag> : <Tag color="blue">Ổn định</Tag>}
          </Space>
        </Space>
      ),
    },
    {
      title: 'Phạm vi ảnh hưởng',
      key: 'targets',
      width: 190,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Text strong>{record.matched_user_count} tài khoản</Text>
          <Text type="secondary">{record.privileged_match_count} tài khoản đặc quyền</Text>
          <Text type="secondary">{record.role_count} vai trò / {record.team_count} nhóm</Text>
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 170,
      render: (_, record) => (
        <Space wrap>
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={(event) => {
              event.stopPropagation();
              setCampaignSelection(record.key);
              void handlePreview(record);
            }}
          >
            Xem trước
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={(event) => {
              event.stopPropagation();
              openEditDrawer(record);
            }}
          />
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={(event) => {
              event.stopPropagation();
              openCreateDrawer(record);
            }}
          />
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={(event) => {
              event.stopPropagation();
              handleDeleteCampaign(record);
            }}
          />
        </Space>
      ),
    },
  ];

  const targetColumns: ColumnsType<AccessReviewTargetUser> = [
    {
      title: 'Tài khoản',
      key: 'user',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Space wrap>
            <Text strong>{record.full_name}</Text>
            <Tag>{record.username}</Tag>
            {record.is_privileged ? <Tag color="volcano">Đặc quyền</Tag> : null}
            {record.is_locked ? <Tag color="gold">Đã khóa</Tag> : null}
          </Space>
          <Text type="secondary">{record.email || 'Chưa có email'}</Text>
          <Text type="secondary">Lần hoạt động gần nhất: {formatDateTime(record.last_seen_at)}</Text>
        </Space>
      ),
    },
    {
      title: 'Quyền hiện có',
      key: 'access',
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={6}>
          <Text type="secondary">{record.role_count} vai trò / {record.team_count} nhóm</Text>
          {renderCompactTags(record.roles, 'Chưa có vai trò')}
          {renderCompactTags(record.teams, 'Chưa có nhóm')}
        </Space>
      ),
    },
    {
      title: 'Tín hiệu rà soát',
      key: 'signal',
      width: 300,
      render: (_, record) => (
        <Space direction="vertical" size={6}>
          <Tag color={riskColor(record.risk_level)}>{record.risk_level.toUpperCase()}</Tag>
          <Text>{record.impact}</Text>
          <Space size={[6, 6]} wrap>
            {record.reasons.map((reason) => (
              <Tag key={`${record.id}-${reason}`}>{reason}</Tag>
            ))}
          </Space>
        </Space>
      ),
    },
  ];

  const watchlistColumns: ColumnsType<AccessReviewWatchlistItem> = [
    {
      title: 'Danh sách theo dõi',
      key: 'watchlist',
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Space wrap>
            <Tag color={severityColor(record.severity)}>{record.severity.toUpperCase()}</Tag>
            <Text strong>{record.title}</Text>
          </Space>
          <Text type="secondary">{record.description}</Text>
          <Text type="secondary">Tài khoản khớp: {record.matched_user_count}</Text>
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 150,
      render: (_, record) => (
        <Space wrap>
          <Button
            size="small"
            onClick={() => {
              setCampaignSelection(record.campaign_key);
            }}
          >
            Mở chiến dịch
          </Button>
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => {
              const targetCampaign = campaigns.find((item) => item.key === record.campaign_key);
              if (targetCampaign) {
                setCampaignSelection(targetCampaign.key);
                void handlePreview(targetCampaign);
              }
            }}
          />
        </Space>
      ),
    },
  ];

  const activityColumns: ColumnsType<AccessReviewActivityItem> = [
    {
      title: 'Hoạt động',
      key: 'activity',
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Space wrap>
            <Tag color={record.kind === 'campaign' ? 'blue' : 'green'}>
              {record.kind === 'campaign' ? 'Chiến dịch' : 'Đợt rà soát'}
            </Tag>
            <Tag color={actionColor(record.action)}>{record.action}</Tag>
            <Text strong>{record.summary}</Text>
          </Space>
          <Text type="secondary">
            {record.actor.full_name || record.actor.username || 'Hệ thống'} - {formatDateTime(record.timestamp)}
          </Text>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {contextHolder}
      <PageHeader
        title="Trung tâm rà soát truy cập"
        subtitle="Điều phối chiến dịch rà soát định kỳ, xem trước phạm vi tác động và áp dụng có lưu lịch sử trong một không gian làm việc thống nhất."
        icon={<SafetyOutlined />}
        extra={[
          <Button
            icon={<ReloadOutlined />}
            key="refresh"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ['admin-access-review-workspace'] });
              void queryClient.invalidateQueries({ queryKey: ['admin-access-review-activity'] });
            }}
          >
            Làm mới
          </Button>,
          <Button icon={<PlusOutlined />} key="create" type="primary" onClick={() => openCreateDrawer(null)}>
            Tạo chiến dịch
          </Button>,
        ]}
      />

      {(focusCampaignKey || focusSearch) ? (
        <Alert
          data-testid="access-review-focus-banner"
          type={selectedCampaign ? 'info' : 'warning'}
          showIcon
          style={{ marginBottom: 16 }}
          message={`Đang tập trung theo drilldown: ${focusCampaignKey || focusSearch}`}
          description={selectedCampaign
            ? 'Chiến dịch mục tiêu đã được mở sẵn trong không gian rà soát để bạn tiếp tục preview hoặc áp dụng.'
            : 'Thư viện đang được thu hẹp theo tín hiệu drilldown. Nếu chưa thấy chiến dịch, hãy kiểm tra từ khóa hoặc dữ liệu vừa seed.'}
        />
      ) : null}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12} xl={6}>
          <SummaryCard title="Chiến dịch đang kích hoạt" value={workspaceQuery.data?.summary.active_campaigns ?? 0} tint="#1d4ed8" />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <SummaryCard title="Chiến dịch cần rà soát" value={workspaceQuery.data?.summary.campaigns_with_findings ?? 0} tint="#d97706" />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <SummaryCard title="Tài khoản đặc quyền" value={workspaceQuery.data?.summary.privileged_users ?? 0} tint="#dc2626" />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <SummaryCard title="Tài khoản ngủ quên" value={workspaceQuery.data?.summary.dormant_users ?? 0} tint="#0891b2" />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24}>
          <Card
            data-testid="access-review-command-strip"
            style={PANEL_STYLE}
            bodyStyle={{ padding: 18 }}
          >
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div data-testid="access-review-command-search">
                  <Input.Search
                    allowClear
                    placeholder="Tìm chiến dịch theo tên, khóa hoặc mô tả"
                    value={campaignSearch}
                    onChange={(event) => setCampaignSearch(event.target.value)}
                    style={{ width: 220 }}
                  />
                </div>
                <Select<CampaignScopeFilter>
                  value={campaignScopeFilter}
                  onChange={setCampaignScopeFilter}
                  style={{ width: 170 }}
                  options={[
                    { value: 'all', label: 'Mọi phạm vi' },
                    ...scopeOptions.map((item) => ({ value: item.value as CampaignScopeFilter, label: item.label })),
                  ]}
                />
                <Select<CampaignActionFilter>
                  value={campaignActionFilter}
                  onChange={setCampaignActionFilter}
                  style={{ width: 170 }}
                  options={[
                    { value: 'all', label: 'Mọi hành động' },
                    ...actionOptions.map((item) => ({ value: item.value as CampaignActionFilter, label: item.label })),
                  ]}
                />
                <Select<CampaignStatusFilter>
                  value={campaignStatus}
                  onChange={setCampaignStatus}
                  style={{ width: 150 }}
                  options={[
                    { value: 'all', label: 'Tất cả' },
                    { value: 'active', label: 'Đang kích hoạt' },
                    { value: 'inactive', label: 'Tạm dừng' },
                    { value: 'findings', label: 'Cần rà soát' },
                  ]}
                />
                <Select<WatchlistSeverityFilter>
                  value={watchlistSeverity}
                  onChange={setWatchlistSeverity}
                  style={{ width: 170 }}
                  options={[
                    { value: 'all', label: 'Mọi mức độ watchlist' },
                    { value: 'error', label: 'Nguy cơ cao' },
                    { value: 'warning', label: 'Cảnh báo' },
                    { value: 'info', label: 'Thông tin' },
                  ]}
                />
                <Input.Search
                  allowClear
                  placeholder="Tìm hoạt động, actor hoặc mã đối tượng"
                  value={activitySearch}
                  onChange={(event) => setActivitySearch(event.target.value)}
                  style={{ width: 260 }}
                />
                <Select<ActivityKindFilter>
                  value={activityKindFilter}
                  onChange={setActivityKindFilter}
                  style={{ width: 160 }}
                  options={[
                    { value: 'all', label: 'Mọi loại activity' },
                    { value: 'campaign', label: 'Chiến dịch' },
                    { value: 'review', label: 'Đợt rà soát' },
                  ]}
                />
              </div>
              <Space wrap>
                <Button data-testid="access-review-save-view" onClick={() => void saveCurrentView()}>
                  Lưu chế độ xem
                </Button>
                <Button data-testid="access-review-restore-view" onClick={applySavedView}>
                  Khôi phục
                </Button>
                <Button
                  data-testid="access-review-open-preset-modal"
                  onClick={() => setIsPresetModalOpen(true)}
                >
                  Tạo mẫu lọc
                </Button>
                <div data-testid="access-review-preset-select">
                  <Select
                    value={selectedPresetId}
                    onChange={setSelectedPresetId}
                    style={{ width: 240 }}
                    options={[
                      { value: 'NONE', label: 'Chọn mẫu access review' },
                      ...namedPresets.map((preset) => ({ value: preset.id, label: preset.name })),
                    ]}
                  />
                </div>
                <Button data-testid="access-review-apply-preset" onClick={applyNamedPreset}>
                  Áp dụng mẫu
                </Button>
                <Button
                  danger
                  data-testid="access-review-delete-preset"
                  disabled={!selectedPreset}
                  onClick={() => void deleteNamedPreset()}
                >
                  Xóa mẫu
                </Button>
              </Space>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                Bộ lọc này đồng bộ cho thư viện chiến dịch, watchlist và activity feed để đội quản trị mở lại đúng góc nhìn rà soát khi đổi ca.
              </Paragraph>
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
          <Card
            title="Thư viện chiến dịch"
            style={PANEL_STYLE}
            bodyStyle={{ padding: 18 }}
            extra={(
              <Space>
                <Input.Search
                  data-testid="access-review-campaign-search"
                  allowClear
                  placeholder="Tìm chiến dịch theo tên, khóa hoặc mô tả"
                  value={campaignSearch}
                  onChange={(event) => setCampaignSearch(event.target.value)}
                  style={{ width: 220 }}
                />
                <Select<CampaignScopeFilter>
                  value={campaignScopeFilter}
                  onChange={setCampaignScopeFilter}
                  style={{ width: 170 }}
                  options={[
                    { value: 'all', label: 'Mọi phạm vi' },
                    ...scopeOptions.map((item) => ({ value: item.value as CampaignScopeFilter, label: item.label })),
                  ]}
                />
                <Select<CampaignActionFilter>
                  value={campaignActionFilter}
                  onChange={setCampaignActionFilter}
                  style={{ width: 170 }}
                  options={[
                    { value: 'all', label: 'Mọi hành động' },
                    ...actionOptions.map((item) => ({ value: item.value as CampaignActionFilter, label: item.label })),
                  ]}
                />
                <Select<CampaignStatusFilter>
                  value={campaignStatus}
                  onChange={setCampaignStatus}
                  style={{ width: 150 }}
                  options={[
                    { value: 'all', label: 'Tất cả' },
                    { value: 'active', label: 'Đang kích hoạt' },
                    { value: 'inactive', label: 'Tạm dừng' },
                    { value: 'findings', label: 'Cần rà soát' },
                  ]}
                />
                <Button icon={<DownloadOutlined />} onClick={exportCampaignLibrary}>
                  Xuất CSV
                </Button>
              </Space>
            )}
          >
            <Table<AccessReviewCampaign>
              rowKey="key"
              size="middle"
              loading={workspaceQuery.isLoading}
              dataSource={filteredCampaigns}
              columns={campaignColumns}
              pagination={{ pageSize: 6, hideOnSinglePage: true }}
              onRow={(record) => ({
                onClick: () => setCampaignSelection(record.key),
              })}
              rowClassName={(record) => (record.key === selectedCampaign?.key ? 'ant-table-row-selected' : '')}
            />
          </Card>
        </Col>

        <Col xs={24} xl={13}>
          <Card
            title="Không gian rà soát"
            style={PANEL_STYLE}
            bodyStyle={{ padding: 18 }}
            extra={selectedCampaign ? (
              <Space>
                <Button
                  icon={<EyeOutlined />}
                  loading={previewMutation.isPending}
                  onClick={() => {
                    void handlePreview(selectedCampaign, selectedTargetIds);
                  }}
                >
                  {selectedTargetIds.length ? 'Xem trước lựa chọn' : 'Xem trước chiến dịch'}
                </Button>
                <Button
                  type="primary"
                  disabled={previewData?.manual_selection_required ? selectedTargetIds.length === 0 : !selectedCampaign}
                  loading={applyMutation.isPending}
                  onClick={() => {
                    void handleApply(selectedCampaign);
                  }}
                >
                  Áp dụng rà soát
                </Button>
              </Space>
            ) : null}
          >
            {!selectedCampaign ? (
              <Empty description="Chưa có chiến dịch nào. Hãy tạo chiến dịch đầu tiên." />
            ) : (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <div>
                  <Space wrap size={[8, 8]}>
                    <Text strong style={{ fontSize: 16 }}>{selectedCampaign.name}</Text>
                    <Tag color={toneColor(selectedCampaign.tone)}>{selectedCampaign.scope_label}</Tag>
                    <Tag>{selectedCampaign.review_action_label}</Tag>
                    <Tag color={selectedCampaign.is_active ? 'green' : 'default'}>
                      {selectedCampaign.is_active ? 'Đang kích hoạt' : 'Tạm dừng'}
                    </Tag>
                  </Space>
                  <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                    {selectedCampaign.description || 'Chiến dịch này được thiết kế để rà soát truy cập theo phạm vi đã chọn.'}
                  </Paragraph>
                </div>

                {selectedCampaign.warnings.length ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="Điểm cần lưu ý của chiến dịch"
                    description={(
                      <Space direction="vertical" size={4}>
                        {selectedCampaign.warnings.map((warning) => (
                          <Text key={warning}>{warning}</Text>
                        ))}
                      </Space>
                    )}
                  />
                ) : null}

                <Descriptions
                  size="small"
                  column={{ xs: 1, md: 2, xl: 3 }}
                  bordered
                  items={[
                    { key: 'targets', label: 'Tài khoản khớp', children: selectedCampaign.matched_user_count },
                    { key: 'privileged', label: 'Đặc quyền', children: selectedCampaign.privileged_match_count },
                    { key: 'window', label: 'Cửa sổ ngủ quên', children: `${selectedCampaign.inactivity_days} ngày` },
                    { key: 'roles', label: 'Vai trò', children: renderCompactTags(selectedCampaign.roles, 'Không lọc vai trò') },
                    { key: 'teams', label: 'Nhóm', children: renderCompactTags(selectedCampaign.teams, 'Không lọc nhóm') },
                    { key: 'checklist', label: 'Danh mục kiểm tra', children: selectedCampaign.checklist_count || 'Chưa có danh mục kiểm tra' },
                  ]}
                />

                {!previewData ? (
                  <Card size="small" title="Mẫu xem trước" style={{ borderRadius: 16 }}>
                    {selectedCampaign.preview_users.length ? (
                      <List
                        dataSource={selectedCampaign.preview_users}
                        renderItem={(item) => (
                          <List.Item key={item.id}>
                            <Space direction="vertical" size={2} style={{ width: '100%' }}>
                              <Space wrap>
                                <Text strong>{item.full_name}</Text>
                                <Tag>{item.username}</Tag>
                                {item.is_privileged ? <Tag color="volcano">Đặc quyền</Tag> : null}
                              </Space>
                              <Text type="secondary">{item.impact}</Text>
                            </Space>
                          </List.Item>
                        )}
                      />
                    ) : (
                      <Empty description="Chưa có mẫu đối tượng. Hãy xem trước chiến dịch để rà soát phạm vi." />
                    )}
                  </Card>
                ) : (
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <Row gutter={[12, 12]}>
                      <Col xs={24} md={12}>
                        <Card size="small" title="Tóm tắt xem trước" style={{ borderRadius: 16 }}>
                          <Space direction="vertical" size={6}>
                            <Text>{previewData.summary.selected_users} đã chọn / {previewData.summary.matched_users} khớp</Text>
                            <Text type="secondary">{previewData.summary.privileged_users} đặc quyền - {previewData.summary.locked_users} đã khóa</Text>
                            <Text type="secondary">{previewData.summary.dormant_users} ngủ quên - {previewData.summary.users_with_access} còn quyền</Text>
                          </Space>
                        </Card>
                      </Col>
                      <Col xs={24} md={12}>
                        <Card size="small" title="Kiểm tra trước khi áp dụng" style={{ borderRadius: 16 }}>
                          <List
                            size="small"
                            dataSource={previewData.preflight_checks}
                            renderItem={(item) => (
                              <List.Item key={item.key}>
                                <Space direction="vertical" size={2}>
                                  <Space wrap>
                                    <Tag color={severityColor(item.status === 'blocked' ? 'error' : item.status === 'warning' ? 'warning' : 'info')}>
                                      {item.status.toUpperCase()}
                                    </Tag>
                                    <Text strong>{item.title}</Text>
                                  </Space>
                                  <Text type="secondary">{item.description}</Text>
                                </Space>
                              </List.Item>
                            )}
                          />
                        </Card>
                      </Col>
                    </Row>

                    {previewData.warnings.length ? (
                      <Alert
                        type={previewData.manual_selection_required ? 'error' : 'warning'}
                        showIcon
                        message={previewData.manual_selection_required ? 'Bắt buộc chọn thủ công trước khi áp dụng' : 'Cảnh báo từ bản xem trước'}
                        description={(
                          <Space direction="vertical" size={4}>
                            {previewData.warnings.map((warning) => (
                              <Text key={warning}>{warning}</Text>
                            ))}
                          </Space>
                        )}
                      />
                    ) : null}

                    <Card
                      size="small"
                      title="Điều phối lựa chọn an toàn"
                      style={{ borderRadius: 16 }}
                    >
                      <Space size={[8, 8]} wrap>
                        <Button onClick={() => applySelectionPreset('all')}>Chọn tất cả</Button>
                        <Button onClick={() => applySelectionPreset('risk')}>Chọn tài khoản rủi ro</Button>
                        <Button onClick={() => applySelectionPreset('privileged')}>Chọn tài khoản đặc quyền</Button>
                        <Button onClick={() => applySelectionPreset('locked')}>Chọn tài khoản đã khóa</Button>
                        <Button onClick={() => applySelectionPreset('clear')}>Xóa lựa chọn</Button>
                        <Tag color="blue">Đang chọn {selectedTargetIds.length} tài khoản</Tag>
                      </Space>
                    </Card>

                    <Table<AccessReviewTargetUser>
                      rowKey="id"
                      size="middle"
                      dataSource={previewData.target_users}
                      columns={targetColumns}
                      pagination={{ pageSize: 6, hideOnSinglePage: true }}
                      rowSelection={{
                        selectedRowKeys: selectedTargetIds,
                        onChange: (keys) => setSelectedTargetIds(keys as number[]),
                      }}
                    />

                    {previewData.skipped_users.length ? (
                      <Card size="small" title="Tài khoản được bảo vệ nên bị bỏ qua" style={{ borderRadius: 16 }}>
                        <List
                          dataSource={previewData.skipped_users}
                          renderItem={(item) => (
                            <List.Item key={item.id}>
                              <Space direction="vertical" size={2}>
                                <Space wrap>
                                  <Text strong>{item.full_name}</Text>
                                  <Tag>{item.username}</Tag>
                                </Space>
                                <Text type="secondary">{item.impact}</Text>
                              </Space>
                            </List.Item>
                          )}
                        />
                      </Card>
                    ) : null}

                    <Input.TextArea
                      rows={3}
                      placeholder="Ghi chú thêm cho đợt rà soát này"
                      value={applyNote}
                      onChange={(event) => setApplyNote(event.target.value)}
                    />
                  </Space>
                )}
              </Space>
            )}
          </Card>
        </Col>

        <Col xs={24} xl={11}>
          <Card
            title="Danh sách theo dõi quản trị"
            style={PANEL_STYLE}
            bodyStyle={{ padding: 18 }}
            extra={(
              <Space>
                <Select<WatchlistSeverityFilter>
                  value={watchlistSeverity}
                  onChange={setWatchlistSeverity}
                  style={{ width: 170 }}
                  options={[
                    { value: 'all', label: 'Mọi mức độ' },
                    { value: 'error', label: 'Nguy cơ cao' },
                    { value: 'warning', label: 'Cảnh báo' },
                    { value: 'info', label: 'Thông tin' },
                  ]}
                />
                <Button icon={<DownloadOutlined />} onClick={exportWatchlist}>
                  Xuất CSV
                </Button>
              </Space>
            )}
          >
            <Table<AccessReviewWatchlistItem>
              rowKey={(record) => `${record.campaign_key}-${record.title}`}
              size="small"
              pagination={false}
              dataSource={filteredWatchlist}
              columns={watchlistColumns}
              locale={{ emptyText: 'Không có mục trong danh sách theo dõi.' }}
            />
          </Card>
        </Col>

        <Col xs={24} xl={13}>
          <Card
            title="Hoạt động gần đây"
            style={PANEL_STYLE}
            bodyStyle={{ padding: 18 }}
            extra={(
              <Space>
                <Input.Search
                  allowClear
                  placeholder="Tìm theo tóm tắt, người thao tác hoặc mã đối tượng"
                  value={activitySearch}
                  onChange={(event) => setActivitySearch(event.target.value)}
                  style={{ width: 260 }}
                />
                <Select<ActivityKindFilter>
                  value={activityKindFilter}
                  onChange={setActivityKindFilter}
                  style={{ width: 160 }}
                  options={[
                    { value: 'all', label: 'Mọi loại' },
                    { value: 'campaign', label: 'Chiến dịch' },
                    { value: 'review', label: 'Đợt rà soát' },
                  ]}
                />
                <Button icon={<DownloadOutlined />} onClick={exportActivity}>
                  Xuất CSV
                </Button>
              </Space>
            )}
          >
            <Table<AccessReviewActivityItem>
              rowKey="id"
              size="small"
              pagination={false}
              loading={activityQuery.isLoading}
              dataSource={filteredActivity}
              columns={activityColumns}
              locale={{ emptyText: 'Chưa có hoạt động rà soát truy cập.' }}
            />
          </Card>
        </Col>
      </Row>

      <Modal
        open={isPresetModalOpen}
        title="Lưu mẫu lọc access review"
        okText="Lưu mẫu"
        cancelText="Đóng"
        onOk={() => void saveNamedPreset()}
        onCancel={() => {
          setIsPresetModalOpen(false);
          setPresetName('');
        }}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Lưu nhanh tổ hợp bộ lọc chiến dịch, watchlist và activity để đội quản trị mở lại đúng góc nhìn rà soát truy cập.
          </Paragraph>
          <Input
            data-testid="access-review-preset-name"
            placeholder="Ví dụ: Dormant privileged cuối tuần"
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            onPressEnter={() => void saveNamedPreset()}
          />
        </Space>
      </Modal>

      <Drawer
        open={drawerOpen}
        title={editingCampaign ? 'Chỉnh sửa chiến dịch rà soát truy cập' : 'Tạo chiến dịch rà soát truy cập'}
        width={560}
        onClose={() => {
          setDrawerOpen(false);
          setEditingCampaign(null);
        }}
        destroyOnClose
        extra={(
          <Space>
            <Button
              onClick={() => {
                setDrawerOpen(false);
                setEditingCampaign(null);
              }}
            >
              Hủy
            </Button>
            <Button type="primary" loading={saveMutation.isPending} onClick={() => void handleSaveCampaign()}>
              Lưu chiến dịch
            </Button>
          </Space>
        )}
      >
        <Form<CampaignFormValues> form={form} layout="vertical" initialValues={DEFAULT_FORM_VALUES}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Khóa chiến dịch" name="key" rules={[{ required: true, message: 'Vui lòng nhập khóa chiến dịch.' }]}>
                <Input placeholder="dormant-finance-review" disabled={Boolean(editingCampaign)} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Tông màu" name="tone">
                <Select options={TONE_OPTIONS.map((item) => ({ value: item.value, label: item.label }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Tên chiến dịch" name="name" rules={[{ required: true, message: 'Vui lòng nhập tên chiến dịch.' }]}>
            <Input placeholder="Rà soát truy cập tài khoản tài chính ngủ quên" />
          </Form.Item>
          <Form.Item label="Mô tả" name="description">
            <Input.TextArea rows={3} placeholder="Mô tả mục tiêu của đợt rà soát và những điểm nhóm cần kiểm tra." />
          </Form.Item>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Phạm vi" name="scope">
                <Select options={scopeOptions.map((item) => ({ value: item.value, label: item.label }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Hành động rà soát" name="review_action">
                <Select options={actionOptions.map((item) => ({ value: item.value, label: item.label }))} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Bộ lọc vai trò" name="role_ids">
                <Select
                  mode="multiple"
                  allowClear
                  optionFilterProp="label"
                  options={roleOptions.map((item) => ({
                    value: item.id,
                    label: `${item.name} (${item.code})`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Bộ lọc nhóm" name="team_ids">
                <Select
                  mode="multiple"
                  allowClear
                  optionFilterProp="label"
                  options={teamOptions.map((item) => ({
                    value: item.id,
                    label: `${item.name} (${item.code})`,
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="Cửa sổ ngủ quên (ngày)" name="inactivity_days">
            <Input type="number" min={1} max={365} />
          </Form.Item>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item label="Đang kích hoạt" name="is_active" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Bao gồm tài khoản khóa" name="include_locked" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Chỉ lấy tài khoản hoạt động" name="only_active_users" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="Danh mục kiểm tra" name="checklist_text">
            <Input.TextArea rows={5} placeholder={'Xác nhận đầu mối phê duyệt\nKiểm tra nhóm đang gán\nXác thực nhu cầu kinh doanh'} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
