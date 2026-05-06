import { useDeferredValue, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
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
  RocketOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import PageHeader from '../../components/PageHeader/PageHeader';
import { adminApi } from '../../api/admin';
import { workflowTaskTemplatesApi, WFT_TRIGGER_LABELS } from '../../api/workflowTaskTemplates';
import { usersApi, type UserMention } from '../../api/users';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import type {
  OnboardingStudioActivityItem,
  OnboardingStudioPreset,
  OnboardingStudioPreviewResponse,
} from '../../types/admin';
import { getToastMessage } from '../../shared/apiError';
import { downloadCSV } from '../../utils/csvExport';
import { PAGES } from '../../utils/constants';

const { Text } = Typography;

type PresetStatusFilter = 'all' | 'active' | 'inactive' | 'attention';
type RolloutStrategySelection = 'preset' | 'merge' | 'replace';
type ActivityKindFilter = 'all' | 'preset' | 'rollout';
type OnboardingFilterSnapshot = {
  preset_search: string;
  preset_status: PresetStatusFilter;
  activity_kind_filter: ActivityKindFilter;
};
type OnboardingNamedPreset = {
  id: string;
  name: string;
  filters: OnboardingFilterSnapshot;
};

type PresetFormValues = {
  key: string;
  name: string;
  description: string;
  is_active: boolean;
  tone: string;
  access_strategy: 'merge' | 'replace';
  role_ids: number[];
  team_ids: number[];
  workflow_template_ids: number[];
  task_owner_mode: 'target_user' | 'template_rule';
  checklist_text: string;
  email_notifications_enabled: boolean;
  email_notification_types: string[];
};

const HERO_CARD_STYLE: CSSProperties = {
  borderRadius: 22,
  border: '1px solid #d6e3f2',
  background: 'linear-gradient(180deg, #ffffff 0%, #f3f9ff 100%)',
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
  { value: 'volcano', label: 'Đỏ cảnh báo' },
  { value: 'purple', label: 'Tím đậm' },
];

const DEFAULT_FORM_VALUES: PresetFormValues = {
  key: '',
  name: '',
  description: '',
  is_active: true,
  tone: 'blue',
  access_strategy: 'merge',
  role_ids: [],
  team_ids: [],
  workflow_template_ids: [],
  task_owner_mode: 'target_user',
  checklist_text: '',
  email_notifications_enabled: true,
  email_notification_types: [],
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

function actionColor(action: string): string {
  if (action === 'CREATE' || action === 'ACTIVATE') return 'green';
  if (action === 'DELETE') return 'volcano';
  if (action === 'DEACTIVATE') return 'orange';
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

function rolloutStrategyValue(value: RolloutStrategySelection): 'merge' | 'replace' | undefined {
  if (value === 'preset') return undefined;
  return value;
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

function describeDelta(
  beforeItems: Array<{ id: number; code: string; name: string }>,
  afterItems: Array<{ id: number; code: string; name: string }>,
) {
  const beforeMap = new Map(beforeItems.map((item) => [item.id, item.name || item.code]));
  const afterMap = new Map(afterItems.map((item) => [item.id, item.name || item.code]));
  const added = Array.from(afterMap.entries())
    .filter(([id]) => !beforeMap.has(id))
    .map(([, label]) => label);
  const removed = Array.from(beforeMap.entries())
    .filter(([id]) => !afterMap.has(id))
    .map(([, label]) => label);
  return { added, removed };
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

function DeltaCard({
  title,
  beforeItems,
  afterItems,
}: {
  title: string;
  beforeItems: Array<{ id: number; code: string; name: string }>;
  afterItems: Array<{ id: number; code: string; name: string }>;
}) {
  const delta = describeDelta(beforeItems, afterItems);
  return (
    <Card size="small" title={title} style={{ borderRadius: 16 }}>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <div>
          <Text type="secondary">Truoc rollout</Text>
          <div style={{ marginTop: 6 }}>{renderCompactTags(beforeItems, 'Chưa gán')}</div>
        </div>
        <div>
          <Text type="secondary">Sau rollout</Text>
          <div style={{ marginTop: 6 }}>{renderCompactTags(afterItems, 'Chưa gán')}</div>
        </div>
        <div>
          <Text type="secondary">Bien dong</Text>
          <div style={{ marginTop: 6 }}>
            <Space size={[6, 6]} wrap>
              {delta.added.map((item) => (
                <Tag color="green" key={`add-${item}`}>+ {item}</Tag>
              ))}
              {delta.removed.map((item) => (
                <Tag color="volcano" key={`remove-${item}`}>- {item}</Tag>
              ))}
              {!delta.added.length && !delta.removed.length ? <Tag>Không thay đổi</Tag> : null}
            </Space>
          </div>
        </div>
      </Space>
    </Card>
  );
}

function buildUserOptionLabel(user: UserMention): string {
  const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username;
  return `${fullName} (${user.username})`;
}

export default function OnboardingStudio() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [presetSearch, setPresetSearch] = useState('');
  const [presetStatus, setPresetStatus] = useState<PresetStatusFilter>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<OnboardingStudioPreset | null>(null);
  const [selectedPresetKey, setSelectedPresetKey] = useState<string>();
  const [selectedUserId, setSelectedUserId] = useState<number>();
  const [rolloutStrategy, setRolloutStrategy] = useState<RolloutStrategySelection>('preset');
  const [createTasks, setCreateTasks] = useState(true);
  const [userSearch, setUserSearch] = useState('');
  const [activityKindFilter, setActivityKindFilter] = useState<ActivityKindFilter>('all');
  const [selectedViewPresetId, setSelectedViewPresetId] = useState('NONE');
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const [previewData, setPreviewData] = useState<OnboardingStudioPreviewResponse | null>(null);
  const [form] = Form.useForm<PresetFormValues>();
  const deferredPresetSearch = useDeferredValue(presetSearch.trim().toLowerCase());
  const { config: savedConfig, saveConfig } = useUserPreferences(PAGES.ADMIN_ONBOARDING_STUDIO);

  const summaryQuery = useQuery({
    queryKey: ['admin-onboarding-studio-summary'],
    queryFn: adminApi.getOnboardingStudioSummary,
  });
  const rolesQuery = useQuery({
    queryKey: ['admin-onboarding-studio-roles'],
    queryFn: () => adminApi.listRoles({ page_size: 200 }),
  });
  const teamsQuery = useQuery({
    queryKey: ['admin-onboarding-studio-teams'],
    queryFn: () => adminApi.listTeams({ page_size: 200 }),
  });
  const templatesQuery = useQuery({
    queryKey: ['admin-onboarding-studio-templates'],
    queryFn: () => workflowTaskTemplatesApi.list(),
  });
  const activityQuery = useQuery({
    queryKey: ['admin-onboarding-studio-activity'],
    queryFn: () => adminApi.getOnboardingActivity({ limit: 18 }),
  });
  const userSearchQuery = useQuery({
    queryKey: ['admin-onboarding-studio-users', userSearch],
    queryFn: () => usersApi.list({ search: userSearch.trim() || undefined }),
    staleTime: 30_000,
  });

  const invalidateStudio = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-onboarding-studio-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-onboarding-studio-activity'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-onboarding-studio-users'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-user-directory'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-user-summary'] }),
    ]);
  };

  const savePresetMutation = useMutation({
    mutationFn: adminApi.saveOnboardingPreset,
    onSuccess: async (response) => {
      messageApi.success(response.action === 'CREATE' ? 'Đã tạo preset onboarding.' : 'Đã cập nhật preset onboarding.');
      await invalidateStudio();
      setDrawerOpen(false);
      setEditingPreset(null);
      if (!selectedPresetKey) {
        setSelectedPresetKey(response.preset.key);
      }
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Không thể lưu preset onboarding.'));
    },
  });

  const deletePresetMutation = useMutation({
    mutationFn: adminApi.deleteOnboardingPreset,
    onSuccess: async (response) => {
      messageApi.success('Đã xóa preset onboarding.');
      await invalidateStudio();
      if (selectedPresetKey === response.key) {
        setSelectedPresetKey(undefined);
        setPreviewData(null);
      }
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Không thể xóa preset onboarding.'));
    },
  });

  const previewMutation = useMutation({
    mutationFn: adminApi.previewOnboardingPreset,
    onSuccess: (response) => {
      setPreviewData(response);
      messageApi.success('Đã cập nhật xem trước rollout.');
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Không thể xem trước rollout.'));
    },
  });

  const applyMutation = useMutation({
    mutationFn: adminApi.applyOnboardingPreset,
    onSuccess: async () => {
      messageApi.success('Đã áp dụng preset onboarding cho người dùng.');
      await invalidateStudio();
      if (selectedPresetKey && selectedUserId) {
        previewMutation.mutate({
          preset_key: selectedPresetKey,
          user_id: selectedUserId,
          access_strategy: rolloutStrategyValue(rolloutStrategy),
        });
      }
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Không thể áp dụng preset onboarding.'));
    },
  });

  const presets = useMemo(() => summaryQuery.data?.presets ?? [], [summaryQuery.data?.presets]);
  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const workflowTemplates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const notificationTypeOptions = useMemo(
    () => summaryQuery.data?.notification_type_options ?? [],
    [summaryQuery.data?.notification_type_options],
  );
  const users = useMemo(() => userSearchQuery.data ?? [], [userSearchQuery.data]);
  const namedPresets = useMemo(() => {
    const raw = savedConfig?.saved_views;
    if (!Array.isArray(raw)) return [] as OnboardingNamedPreset[];
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id : '';
        const name = typeof record.name === 'string' ? record.name : '';
        const filters = record.filters;
        if (!id || !name || !filters || typeof filters !== 'object') return null;
        const filterRecord = filters as Record<string, unknown>;
        const presetStatusValue = filterRecord.preset_status;
        const activityKindFilterValue = filterRecord.activity_kind_filter;
        if (
          presetStatusValue !== 'all'
          && presetStatusValue !== 'active'
          && presetStatusValue !== 'inactive'
          && presetStatusValue !== 'attention'
        ) {
          return null;
        }
        if (
          activityKindFilterValue !== 'all'
          && activityKindFilterValue !== 'preset'
          && activityKindFilterValue !== 'rollout'
        ) {
          return null;
        }
        return {
          id,
          name,
          filters: {
            preset_search: typeof filterRecord.preset_search === 'string' ? filterRecord.preset_search : '',
            preset_status: presetStatusValue,
            activity_kind_filter: activityKindFilterValue,
          },
        } as OnboardingNamedPreset;
      })
      .filter((item): item is OnboardingNamedPreset => item !== null);
  }, [savedConfig?.saved_views]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId],
  );

  const selectedPreset = useMemo(
    () => presets.find((item) => item.key === selectedPresetKey) ?? null,
    [presets, selectedPresetKey],
  );

  const filteredPresets = useMemo(() => {
    return presets.filter((preset) => {
      if (presetStatus === 'active' && !preset.is_active) return false;
      if (presetStatus === 'inactive' && preset.is_active) return false;
      if (presetStatus === 'attention' && !preset.has_issues) return false;
      if (!deferredPresetSearch) return true;
      const haystack = [
        preset.key,
        preset.name,
        preset.description,
        ...preset.roles.map((item) => item.name),
        ...preset.teams.map((item) => item.name),
        ...preset.workflow_templates.map((item) => item.title_template),
      ].join(' ').toLowerCase();
      return haystack.includes(deferredPresetSearch);
    });
  }, [deferredPresetSearch, presetStatus, presets]);

  const roleOptions = useMemo(
    () => roles.map((role) => ({
      label: `${role.name || role.code} (${role.code})`,
      value: role.id,
    })),
    [roles],
  );
  const teamOptions = useMemo(
    () => teams.map((team) => ({
      label: `${team.name || team.code} (${team.code})`,
      value: team.id,
    })),
    [teams],
  );
  const workflowTemplateOptions = useMemo(
    () => workflowTemplates.map((template) => ({
      label: `${template.title_template} [${template.entity_type}/${template.trigger}]`,
      value: template.id,
    })),
    [workflowTemplates],
  );
  const userOptions = useMemo(
    () => users.map((user) => ({
      label: buildUserOptionLabel(user),
      value: user.id,
    })),
    [users],
  );

  const openCreateDrawer = (source?: OnboardingStudioPreset | null) => {
    const nextValues: PresetFormValues = source ? {
      key: source.key ? `${source.key}-copy` : '',
      name: source.name ? `${source.name} Copy` : '',
      description: source.description,
      is_active: source.is_active,
      tone: source.tone,
      access_strategy: source.access_strategy,
      role_ids: source.role_ids,
      team_ids: source.team_ids,
      workflow_template_ids: source.workflow_template_ids,
      task_owner_mode: source.task_owner_mode,
      checklist_text: buildChecklistText(source.checklist),
      email_notifications_enabled: source.email_notifications_enabled,
      email_notification_types: source.email_notification_types,
    } : DEFAULT_FORM_VALUES;
    setEditingPreset(null);
    form.setFieldsValue(nextValues);
    setDrawerOpen(true);
  };

  const openEditDrawer = (preset: OnboardingStudioPreset) => {
    setEditingPreset(preset);
    form.setFieldsValue({
      key: preset.key,
      name: preset.name,
      description: preset.description,
      is_active: preset.is_active,
      tone: preset.tone,
      access_strategy: preset.access_strategy,
      role_ids: preset.role_ids,
      team_ids: preset.team_ids,
      workflow_template_ids: preset.workflow_template_ids,
      task_owner_mode: preset.task_owner_mode,
      checklist_text: buildChecklistText(preset.checklist),
      email_notifications_enabled: preset.email_notifications_enabled,
      email_notification_types: preset.email_notification_types,
    });
    setDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setDrawerOpen(false);
    setEditingPreset(null);
    form.resetFields();
  };

  const handleSavePreset = async () => {
    const values = await form.validateFields();
    savePresetMutation.mutate({
      key: values.key.trim(),
      name: values.name.trim(),
      description: values.description?.trim() || '',
      is_active: values.is_active,
      tone: values.tone,
      access_strategy: values.access_strategy,
      role_ids: values.role_ids,
      team_ids: values.team_ids,
      workflow_template_ids: values.workflow_template_ids,
      task_owner_mode: values.task_owner_mode,
      checklist: parseChecklistText(values.checklist_text || ''),
      email_notifications_enabled: values.email_notifications_enabled,
      email_notification_types: values.email_notification_types,
    });
  };

  const handlePreview = () => {
    if (!selectedPresetKey || !selectedUserId) {
      messageApi.warning('Hãy chọn preset và người dùng để xem trước.');
      return;
    }
    previewMutation.mutate({
      preset_key: selectedPresetKey,
      user_id: selectedUserId,
      access_strategy: rolloutStrategyValue(rolloutStrategy),
    });
  };

  const handleApply = () => {
    if (!selectedPresetKey || !selectedUserId) {
      messageApi.warning('Hãy chọn preset và người dùng để áp dụng.');
      return;
    }
    applyMutation.mutate({
      preset_key: selectedPresetKey,
      user_id: selectedUserId,
      access_strategy: rolloutStrategyValue(rolloutStrategy),
      create_tasks: createTasks,
    });
  };

  const presetColumns: ColumnsType<OnboardingStudioPreset> = [
    {
      title: 'Preset',
      dataIndex: 'name',
      key: 'name',
      render: (_value: unknown, record) => (
        <Space direction="vertical" size={6}>
          <Space size={8} wrap>
            <Text strong>{record.name}</Text>
            <Tag color={toneColor(record.tone)}>{record.tone}</Tag>
            <Tag color={record.is_active ? 'green' : 'default'}>{record.is_active ? 'Hoạt động' : 'Tạm ngưng'}</Tag>
            {record.has_issues ? <Tag color="gold">Cần rà soát</Tag> : null}
          </Space>
          <Text type="secondary">{record.description || 'Preset rollout cho vai trò, nhóm, checklist, workflow và cấu hình email.'}</Text>
          <Space size={[6, 6]} wrap>
            <Tag>Khóa: {record.key}</Tag>
            <Tag color="blue">{record.access_strategy === 'merge' ? 'Hợp nhất quyền' : 'Thay thế quyền'}</Tag>
            <Tag color="cyan">{record.task_owner_mode === 'target_user' ? 'Đầu việc -> người dùng đích' : 'Đầu việc -> quy tắc mẫu'}</Tag>
          </Space>
        </Space>
      ),
    },
    {
      title: 'Coverage',
      key: 'coverage',
      width: 260,
      render: (_value: unknown, record) => (
        <Space size={[6, 6]} wrap>
          <Tag color="blue">{record.role_count} role</Tag>
          <Tag color="green">{record.team_count} team</Tag>
          <Tag color="purple">{record.workflow_template_count} workflow</Tag>
          <Tag color="gold">{record.checklist_count} checklist</Tag>
          <Tag color={record.email_notifications_enabled ? 'volcano' : 'default'}>
            {record.email_notifications_enabled ? `${record.email_notification_types.length || 0} email type` : 'Email off'}
          </Tag>
        </Space>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 220,
      render: (_value: unknown, record) => (
        <Space size={[4, 4]} wrap>
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => {
              setSelectedPresetKey(record.key);
              setPreviewData(null);
            }}
          >
            Chọn dùng
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditDrawer(record)}>
            Chỉnh sửa
          </Button>
          <Button size="small" icon={<CopyOutlined />} onClick={() => openCreateDrawer(record)}>
            Nhân bản
          </Button>
          <Button
            danger
            size="small"
            icon={<DeleteOutlined />}
            loading={deletePresetMutation.isPending}
            onClick={() => deletePresetMutation.mutate(record.key)}
          >
            Xóa
          </Button>
        </Space>
      ),
    },
  ];

  const previewSummary = previewData?.summary;
  const previewPreset = previewData?.preset ?? selectedPreset;
  const previewActivity = useMemo(
    () => activityQuery.data?.items ?? summaryQuery.data?.recent_activity ?? [],
    [activityQuery.data?.items, summaryQuery.data?.recent_activity],
  );
  const filteredActivity = useMemo(
    () => previewActivity.filter((item) => activityKindFilter === 'all' || item.kind === activityKindFilter),
    [activityKindFilter, previewActivity],
  );
  const attentionPresetCount = useMemo(
    () => presets.filter((item) => item.has_issues).length,
    [presets],
  );
  const presetsWithWorkflowCount = useMemo(
    () => presets.filter((item) => item.workflow_template_count > 0).length,
    [presets],
  );
  const presetsWithEmailCount = useMemo(
    () => presets.filter((item) => item.email_notifications_enabled).length,
    [presets],
  );
  const activePresetFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (presetSearch.trim()) tags.push(`Từ khóa: ${presetSearch.trim()}`);
    if (presetStatus === 'active') tags.push('Chỉ preset đang hoạt động');
    if (presetStatus === 'inactive') tags.push('Chỉ preset tạm ngưng');
    if (presetStatus === 'attention') tags.push('Ưu tiên preset cần rà soát');
    if (activityKindFilter === 'preset') tags.push('Nhật ký: Preset');
    if (activityKindFilter === 'rollout') tags.push('Nhật ký: Rollout');
    if (selectedViewPreset) tags.push(`Mẫu đang dùng: ${selectedViewPreset.name}`);
    return tags;
  }, [activityKindFilter, presetSearch, presetStatus, selectedViewPreset]);

  const buildCurrentSnapshot = (): OnboardingFilterSnapshot => ({
    preset_search: presetSearch,
    preset_status: presetStatus,
    activity_kind_filter: activityKindFilter,
  });

  const applySnapshot = (snapshot: OnboardingFilterSnapshot) => {
    setPresetSearch(snapshot.preset_search);
    setPresetStatus(snapshot.preset_status);
    setActivityKindFilter(snapshot.activity_kind_filter);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...savedConfig,
        ...buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem onboarding studio.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem onboarding studio.');
    }
  };

  const applySavedView = () => {
    const snapshot: OnboardingFilterSnapshot = {
      preset_search: typeof savedConfig?.preset_search === 'string' ? savedConfig.preset_search : '',
      preset_status: savedConfig?.preset_status === 'active'
        || savedConfig?.preset_status === 'inactive'
        || savedConfig?.preset_status === 'attention'
        ? savedConfig.preset_status
        : 'all',
      activity_kind_filter: savedConfig?.activity_kind_filter === 'preset'
        || savedConfig?.activity_kind_filter === 'rollout'
        ? savedConfig.activity_kind_filter
        : 'all',
    };
    applySnapshot(snapshot);
    messageApi.success('Đã khôi phục chế độ xem onboarding studio đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = viewPresetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: OnboardingNamedPreset = existing
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
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc onboarding studio.' : 'Đã lưu mẫu lọc onboarding studio mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc onboarding studio.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc onboarding studio.');
      return;
    }
    applySnapshot(preset.filters);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc onboarding studio để xóa.');
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
      messageApi.error('Không thể xóa mẫu lọc onboarding studio.');
    }
  };

  const exportPresets = () => {
    if (!filteredPresets.length) {
      messageApi.warning('Chưa có preset phù hợp để xuất CSV.');
      return;
    }
    downloadCSV(
      filteredPresets.map((preset) => ({
        'Khóa preset': preset.key,
        'Tên preset': preset.name,
        'Mô tả': preset.description || '',
        'Trạng thái': preset.is_active ? 'Hoạt động' : 'Tạm ngưng',
        'Chiến lược truy cập': preset.access_strategy === 'merge' ? 'Hợp nhất' : 'Thay thế',
        'Vai trò': preset.roles.map((item) => item.name || item.code).join(', '),
        'Nhóm': preset.teams.map((item) => item.name || item.code).join(', '),
        'Mẫu workflow': preset.workflow_templates.map((item) => item.title_template).join(', '),
        'Số checklist': preset.checklist_count,
        'Email thông báo': preset.email_notifications_enabled ? 'Bật' : 'Tắt',
      })),
      'onboarding-studio-presets',
    );
    messageApi.success('Đã xuất CSV danh mục preset onboarding.');
  };

  const exportActivity = () => {
    if (!filteredActivity.length) {
      messageApi.warning('Chưa có hoạt động onboarding phù hợp để xuất CSV.');
      return;
    }
    downloadCSV(
      filteredActivity.map((item) => ({
        'Thời điểm': formatDateTime(item.timestamp),
        'Loại': item.kind === 'rollout' ? 'Rollout' : 'Preset',
        'Hành động': item.action,
        'Tóm tắt': item.summary,
        'Người thực hiện': item.actor.full_name || item.actor.username || 'Hệ thống',
        'Trường thay đổi': item.changed_fields.join(', '),
      })),
      'onboarding-studio-activity',
    );
    messageApi.success('Đã xuất CSV hoạt động onboarding.');
  };

  const openWatchlistPreset = (presetKey: string) => {
    setSelectedPresetKey(presetKey);
    setPreviewData(null);
  };

  return (
    <>
      {contextHolder}
      <PageHeader
        title="Xưởng preset onboarding"
        subtitle="Trợ lý triển khai công việc: thiết kế preset rollout để triển khai quyền, nhóm, checklist và workflow cho người dùng một cách nhất quán."
        extra={[
          <Button
            key="reload"
            icon={<ReloadOutlined />}
            loading={summaryQuery.isFetching || activityQuery.isFetching}
            onClick={() => {
              void invalidateStudio();
            }}
          >
            Làm mới
          </Button>,
          <Button
            key="new"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openCreateDrawer(null)}
          >
            Tạo preset
          </Button>,
        ]}
      />

      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <Alert
          type={attentionPresetCount > 0 ? 'warning' : 'success'}
          showIcon
          message={attentionPresetCount > 0 ? 'Có preset cần ưu tiên rà soát' : 'Danh mục preset đang ổn định'}
          description={attentionPresetCount > 0
            ? `Hiện có ${attentionPresetCount} preset có tín hiệu thiếu coverage, cấu hình không đồng bộ hoặc cần rà soát trước khi rollout diện rộng.`
            : 'Các preset chính đang ở trạng thái sẵn sàng. Bạn có thể chuyển sang rollout hoặc xuất danh mục để bàn giao.'}
        />

        <Row gutter={[16, 16]}>
          <Col xs={24} md={12} xl={6}>
            <SummaryCard title="Tổng preset" value={summaryQuery.data?.summary.total_presets ?? 0} tint="#1677ff" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <SummaryCard title="Preset hoạt động" value={summaryQuery.data?.summary.active_presets ?? 0} tint="#16a34a" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <SummaryCard title="Rollout 30 ngày" value={summaryQuery.data?.summary.applied_30d ?? 0} tint="#f59e0b" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <SummaryCard title="Đầu việc tạo 30 ngày" value={summaryQuery.data?.summary.tasks_created_30d ?? 0} tint="#7c3aed" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <SummaryCard title="Preset cần rà soát" value={attentionPresetCount} tint="#dc2626" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <SummaryCard title="Có workflow" value={presetsWithWorkflowCount} tint="#0f766e" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <SummaryCard title="Bật email" value={presetsWithEmailCount} tint="#9333ea" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <SummaryCard title="Người dùng thiếu phân công" value={(summaryQuery.data?.summary.users_without_role ?? 0) + (summaryQuery.data?.summary.users_without_team ?? 0)} tint="#ea580c" />
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24}>
            <Card
              data-testid="onboarding-studio-command-strip"
              style={PANEL_STYLE}
              bodyStyle={{ padding: 18 }}
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <div data-testid="onboarding-studio-command-search">
                    <Input
                      allowClear
                      placeholder="Tìm preset theo tên, khóa hoặc workflow"
                      value={presetSearch}
                      onChange={(event) => setPresetSearch(event.target.value)}
                      style={{ width: 280 }}
                    />
                  </div>
                  <Select<PresetStatusFilter>
                    value={presetStatus}
                    onChange={(value) => setPresetStatus(value)}
                    style={{ width: 180 }}
                    options={[
                      { value: 'all', label: 'Tất cả preset' },
                      { value: 'active', label: 'Đang hoạt động' },
                      { value: 'inactive', label: 'Tạm ngưng' },
                      { value: 'attention', label: 'Cần rà soát' },
                    ]}
                  />
                  <Select<ActivityKindFilter>
                    value={activityKindFilter}
                    onChange={setActivityKindFilter}
                    style={{ width: 180 }}
                    options={[
                      { value: 'all', label: 'Mọi hoạt động' },
                      { value: 'preset', label: 'Preset' },
                      { value: 'rollout', label: 'Rollout' },
                    ]}
                  />
                </div>
                <Space wrap>
                  <Button data-testid="onboarding-studio-save-view" onClick={() => void saveCurrentView()}>
                    Lưu chế độ xem
                  </Button>
                  <Button data-testid="onboarding-studio-restore-view" onClick={applySavedView}>
                    Khôi phục
                  </Button>
                  <Button
                    data-testid="onboarding-studio-open-preset-modal"
                    onClick={() => setIsViewPresetModalOpen(true)}
                  >
                    Tạo mẫu lọc
                  </Button>
                  <div data-testid="onboarding-studio-preset-select">
                    <Select
                      value={selectedViewPresetId}
                      onChange={setSelectedViewPresetId}
                      style={{ width: 240 }}
                      options={[
                        { value: 'NONE', label: 'Chọn mẫu onboarding studio' },
                        ...namedPresets.map((preset) => ({ value: preset.id, label: preset.name })),
                      ]}
                    />
                  </div>
                  <Button data-testid="onboarding-studio-apply-preset" onClick={applyNamedPreset}>
                    Áp dụng mẫu
                  </Button>
                  <Button
                    danger
                    data-testid="onboarding-studio-delete-preset"
                    disabled={!selectedViewPreset}
                    onClick={() => void deleteNamedPreset()}
                  >
                    Xóa mẫu
                  </Button>
                </Space>
                {activePresetFilterTags.length ? (
                  <Space size={[8, 8]} wrap>
                    {activePresetFilterTags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </Space>
                ) : null}
              </Space>
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={14}>
            <Card
              title="Danh mục preset"
              extra={(
                <Button icon={<DownloadOutlined />} onClick={exportPresets}>Xuất CSV</Button>
              )}
              style={PANEL_STYLE}
            >
              <Table<OnboardingStudioPreset>
                rowKey="key"
                dataSource={filteredPresets}
                columns={presetColumns}
                pagination={{ pageSize: 6, hideOnSinglePage: filteredPresets.length <= 6 }}
                locale={{
                  emptyText: (
                    <Empty
                      description="Chưa có preset onboarding"
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                  ),
                }}
              />
            </Card>
          </Col>

          <Col xs={24} xl={10}>
            <Card
              title="Không gian rollout"
              style={PANEL_STYLE}
              extra={previewPreset ? <Tag color={toneColor(previewPreset.tone)}>{previewPreset.name}</Tag> : null}
            >
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Alert
                  type="info"
                  showIcon
                  message="Xem trước trước khi áp dụng"
                  description="Không gian này cho phép admin kiểm tra delta vai trò, nhóm, email và đầu việc onboarding trước khi rollout cho người dùng."
                />

                <Row gutter={[12, 12]}>
                  <Col span={24}>
                    <Text strong>Preset</Text>
                    <Select
                      placeholder="Chon preset"
                      style={{ width: '100%', marginTop: 8 }}
                      value={selectedPresetKey}
                      onChange={(value) => {
                        setSelectedPresetKey(value);
                        setPreviewData(null);
                      }}
                      options={presets.map((preset) => ({
                        value: preset.key,
                        label: `${preset.name}${preset.is_active ? '' : ' (tạm ngưng)'}`,
                        disabled: !preset.is_active,
                      }))}
                    />
                  </Col>
                  <Col span={24}>
                    <Text strong>Người dùng đích</Text>
                    <Select
                      showSearch
                      filterOption={false}
                      placeholder="Tìm người dùng theo tên hoặc username"
                      style={{ width: '100%', marginTop: 8 }}
                      value={selectedUserId}
                      onSearch={setUserSearch}
                      onChange={(value) => {
                        setSelectedUserId(value);
                        setPreviewData(null);
                      }}
                      options={userOptions}
                      notFoundContent={userSearchQuery.isFetching ? 'Đang tìm...' : 'Không có người dùng phù hợp'}
                    />
                  </Col>
                </Row>

                <div>
                  <Text strong>Chiến lược</Text>
                  <div style={{ marginTop: 8 }}>
                    <Radio.Group
                      value={rolloutStrategy}
                      onChange={(event) => {
                        setRolloutStrategy(event.target.value as RolloutStrategySelection);
                        setPreviewData(null);
                      }}
                    >
                      <Radio.Button value="preset">Theo preset</Radio.Button>
                      <Radio.Button value="merge">Ép hợp nhất</Radio.Button>
                      <Radio.Button value="replace">Ép thay thế</Radio.Button>
                    </Radio.Group>
                  </div>
                </div>

                <Space align="center">
                  <Switch checked={createTasks} onChange={setCreateTasks} />
                  <Text>Tạo đầu việc onboarding</Text>
                </Space>

                <Space>
                  <Button
                    type="default"
                    icon={<EyeOutlined />}
                    onClick={handlePreview}
                    loading={previewMutation.isPending}
                  >
                    Xem trước
                  </Button>
                  <Button
                    type="primary"
                    icon={<RocketOutlined />}
                    onClick={handleApply}
                    loading={applyMutation.isPending}
                    disabled={!selectedPresetKey || !selectedUserId}
                  >
                    Áp dụng preset
                  </Button>
                </Space>

                {previewData ? (
                  <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <Divider style={{ margin: '4px 0' }} />
                    <Alert
                      type="success"
                      showIcon
                      message={`${previewData.target_user.full_name} (${previewData.target_user.username})`}
                      description={`Xem trước cho preset ${previewData.preset.name}. Đầu việc mới: ${previewSummary?.task_new ?? 0}, đầu việc đã tồn tại: ${previewSummary?.task_existing ?? 0}.`}
                    />
                    <Descriptions
                      size="small"
                      column={1}
                      bordered
                      items={[
                        {
                          key: 'strategy',
                          label: 'Chiến lược truy cập',
                          children: previewData.access_strategy === 'merge' ? 'Hợp nhất quyền' : 'Thay thế quyền',
                        },
                        {
                          key: 'notification',
                          label: 'Email',
                          children: previewData.notification_after.email_notifications_enabled
                            ? `${previewData.notification_after.email_notification_types.length} loại thông báo`
                            : 'Tắt thông báo email',
                        },
                        {
                          key: 'task',
                          label: 'Đầu việc workflow',
                          children: `${previewSummary?.task_total ?? 0} mẫu workflow`,
                        },
                      ]}
                    />

                    <Row gutter={[12, 12]}>
                      <Col span={24} md={12}>
                        <DeltaCard
                          title="Delta vai trò"
                          beforeItems={previewData.roles_before}
                          afterItems={previewData.roles_after}
                        />
                      </Col>
                      <Col span={24} md={12}>
                        <DeltaCard
                          title="Delta nhóm"
                          beforeItems={previewData.teams_before}
                          afterItems={previewData.teams_after}
                        />
                      </Col>
                    </Row>

                    {previewData.checklist.length ? (
                      <Card size="small" title="Checklist bàn giao" style={{ borderRadius: 16 }}>
                        <List
                          size="small"
                          dataSource={previewData.checklist}
                          renderItem={(item) => <List.Item>{item}</List.Item>}
                        />
                      </Card>
                    ) : null}

                    <Card size="small" title="Xem trước đầu việc" style={{ borderRadius: 16 }}>
                      {previewData.task_preview.length ? (
                        <List
                          size="small"
                          dataSource={previewData.task_preview}
                          renderItem={(item) => (
                            <List.Item>
                              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                <Space size={[6, 6]} wrap>
                                  <Text strong>{item.title}</Text>
                                  <Tag color={item.would_skip ? 'default' : 'green'}>
                                    {item.would_skip ? 'Sẽ bỏ qua' : 'Sẽ tạo'}
                                  </Tag>
                                  <Tag color="blue">{item.priority}</Tag>
                                  <Tag>
                                    {item.entity_type}/
                                    {item.trigger in WFT_TRIGGER_LABELS ? WFT_TRIGGER_LABELS[item.trigger as keyof typeof WFT_TRIGGER_LABELS] : item.trigger}
                                  </Tag>
                                </Space>
                                <Text type="secondary">{item.description || item.template_title}</Text>
                                <Space size={[6, 6]} wrap>
                                  <Tag>Phụ trách: {item.assigned_to || 'Chưa phân công'}</Tag>
                                  <Tag>Hạn: {item.due_date || 'Chưa có hạn'}</Tag>
                                  {item.depends_on_source_key ? <Tag color="purple">Phụ thuộc bước trước</Tag> : null}
                                  {item.is_blocking ? <Tag color="volcano">Chặn luồng</Tag> : null}
                                </Space>
                              </Space>
                            </List.Item>
                          )}
                        />
                      ) : (
                        <Empty description="Preset này chưa gán mẫu workflow" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      )}
                    </Card>
                  </Space>
                ) : (
                  <Empty
                    description="Chọn preset và người dùng, sau đó xem trước để kiểm tra delta rollout"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                )}
              </Space>
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={10}>
            <Card title="Danh sách ưu tiên rollout" style={PANEL_STYLE}>
              {summaryQuery.data?.watchlist?.length ? (
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  {summaryQuery.data.watchlist.map((item) => (
                    <Alert
                      key={`${item.preset_key}-${item.title}`}
                      type={item.severity === 'error' ? 'error' : item.severity === 'warning' ? 'warning' : 'info'}
                      message={item.title}
                      description={item.description}
                      showIcon
                      action={(
                        <Button size="small" onClick={() => openWatchlistPreset(item.preset_key)}>
                          Mở preset
                        </Button>
                      )}
                    />
                  ))}
                </Space>
              ) : (
                <Empty description="Không có preset cần rà soát" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Col>

          <Col xs={24} xl={14}>
            <Card
              title="Nhật ký hoạt động"
              style={PANEL_STYLE}
              extra={(
                <Button icon={<DownloadOutlined />} onClick={exportActivity}>Xuất CSV</Button>
              )}
            >
              {filteredActivity.length ? (
                <List<OnboardingStudioActivityItem>
                  dataSource={filteredActivity}
                  renderItem={(item) => (
                    <List.Item>
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <Space size={[6, 6]} wrap>
                          <Tag color={actionColor(item.action)}>{item.action}</Tag>
                          <Tag color={item.kind === 'rollout' ? 'cyan' : severityColor('info')}>
                            {item.kind === 'rollout' ? 'Rollout' : 'Preset'}
                          </Tag>
                          <Text strong>{item.summary}</Text>
                        </Space>
                        <Text type="secondary">
                          {item.actor.full_name || item.actor.username || 'Hệ thống'} | {formatDateTime(item.timestamp)}
                        </Text>
                        {item.changed_fields.length ? (
                          <Space size={[6, 6]} wrap>
                            {item.changed_fields.map((field) => (
                              <Tag key={`${item.id}-${field}`}>{field}</Tag>
                            ))}
                          </Space>
                        ) : null}
                      </Space>
                    </List.Item>
                  )}
                />
              ) : (
                <Empty description="Chưa có hoạt động onboarding phù hợp" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Col>
        </Row>
      </Space>

      <Modal
        open={isViewPresetModalOpen}
        title="Lưu mẫu lọc trợ lý triển khai công việc"
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
            Lưu nhanh góc nhìn preset và nhật ký để đội triển khai mở lại đúng danh mục đang rà soát theo ca.
          </Text>
          <Input
            data-testid="onboarding-studio-preset-name"
            placeholder="Ví dụ: Ca sáng rà soát preset"
            value={viewPresetName}
            onChange={(event) => setViewPresetName(event.target.value)}
            onPressEnter={() => void saveNamedPreset()}
          />
        </Space>
      </Modal>

      <Drawer
        title="Studio preset"
        width={720}
        open={drawerOpen}
        onClose={handleCloseDrawer}
        destroyOnClose
        extra={(
          <Space>
            <Button onClick={handleCloseDrawer}>Hủy</Button>
            <Button type="primary" onClick={() => void handleSavePreset()} loading={savePresetMutation.isPending}>
              Lưu preset
            </Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={18} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Studio preset"
            description="Thiết kế preset onboarding theo kiểu gói lớn: vai trò, nhóm, workflow, checklist và email sẽ được rollout nhất quán cho người dùng."
          />

          <Form<PresetFormValues>
            form={form}
            layout="vertical"
            initialValues={DEFAULT_FORM_VALUES}
          >
            <Row gutter={[12, 12]}>
              <Col span={12}>
                <Form.Item
                  label="Khóa preset"
                  name="key"
                  rules={[{ required: true, message: 'Nhap key cho preset.' }]}
                >
                  <Input disabled={Boolean(editingPreset)} placeholder="ops-launch" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="Tên preset"
                  name="name"
                  rules={[{ required: true, message: 'Nhap ten preset.' }]}
                >
                  <Input placeholder="Ops Launch" />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item label="Mô tả" name="description">
                  <Input.TextArea rows={3} placeholder="Preset cho nhân sự mới vào line vận hành..." />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Tông màu" name="tone">
                  <Select options={TONE_OPTIONS} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Chiến lược truy cập" name="access_strategy">
                  <Select
                    options={[
                      { value: 'merge', label: 'Hợp nhất quyền' },
                      { value: 'replace', label: 'Thay thế quyền' },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Chế độ owner đầu việc" name="task_owner_mode">
                  <Select
                    options={[
                      { value: 'target_user', label: 'Đầu việc -> người dùng đích' },
                      { value: 'template_rule', label: 'Đầu việc -> quy tắc mẫu' },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Đang hoạt động" name="is_active" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item label="Vai trò" name="role_ids">
                  <Select mode="multiple" placeholder="Chọn vai trò" options={roleOptions} />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item label="Nhóm" name="team_ids">
                  <Select mode="multiple" placeholder="Chọn nhóm" options={teamOptions} />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item label="Mẫu workflow" name="workflow_template_ids">
                  <Select mode="multiple" placeholder="Chọn mẫu workflow" options={workflowTemplateOptions} />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item
                  label="Checklist"
                  name="checklist_text"
                  extra="Mỗi dòng là một mục checklist. Tối đa 8 dòng."
                >
                  <Input.TextArea rows={5} placeholder={'Welcome call\nReview SOP\nVerify access handoff'} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Thông báo email" name="email_notifications_enabled" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item label="Loại thông báo email" name="email_notification_types">
                  <Select
                    mode="multiple"
                    placeholder="Chọn loại email quan trọng"
                    options={notificationTypeOptions.map((item) => ({
                      value: item.value,
                      label: item.label,
                    }))}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form>

          {editingPreset ? (
            <Card size="small" title="Blueprint hiện tại" style={{ borderRadius: 16 }}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <div>
                  <Text type="secondary">Vai trò</Text>
                  <div style={{ marginTop: 6 }}>{renderCompactTags(editingPreset.roles, 'Chưa gán vai trò')}</div>
                </div>
                <div>
                  <Text type="secondary">Nhóm</Text>
                  <div style={{ marginTop: 6 }}>{renderCompactTags(editingPreset.teams, 'Chưa gán nhóm')}</div>
                </div>
                <div>
                  <Text type="secondary">Workflow</Text>
                  <div style={{ marginTop: 6 }}>
                    <Space size={[6, 6]} wrap>
                      {editingPreset.workflow_templates.length
                        ? editingPreset.workflow_templates.map((item) => (
                          <Tag key={item.id}>{item.title_template}</Tag>
                        ))
                        : <Tag>Chưa gán workflow</Tag>}
                    </Space>
                  </div>
                </div>
              </Space>
            </Card>
          ) : null}
        </Space>
      </Drawer>
    </>
  );
}
