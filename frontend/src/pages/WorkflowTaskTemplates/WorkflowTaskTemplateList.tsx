import { useState, useCallback, useMemo, type CSSProperties } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  BookOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  workflowTaskTemplatesApi,
  WFT_TRIGGER_LABELS,
  type WorkflowTaskTemplateItem,
  type WorkflowTaskTemplatePayload,
  type WftTrigger,
} from '../../api/workflowTaskTemplates';
import { TASK_PRIORITY_LABELS, TASK_PRIORITY_COLORS, type TaskPriority } from '../../api/tasks';
import ColumnChooser from '../../components/ColumnChooser';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useColumnSettings } from '../../hooks/useColumnSettings';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { getEntityTypeLabel, PAGES } from '../../utils/constants';

const PAGE_KEY = PAGES.WORKFLOW_TASK_TEMPLATE_LIST;

const SUMMARY_TILE_STYLE: CSSProperties = {
  minHeight: 116,
  borderRadius: 18,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  background: 'linear-gradient(160deg, #ffffff 0%, #f7fbff 100%)',
  border: '1px solid #d6e4ff',
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)',
};

const ENTITY_TYPE_OPTIONS = [
  { value: 'SalesOrder', label: 'Đơn hàng' },
  { value: 'PurchaseOrder', label: 'Đơn mua' },
  { value: 'ProductionOrder', label: 'Lệnh sản xuất' },
  { value: 'Product', label: 'Sản phẩm' },
  { value: 'Customer', label: 'Khách hàng' },
];

const TRIGGER_OPTIONS = Object.entries(WFT_TRIGGER_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const PRIORITY_OPTIONS = Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const ALL_COLUMNS: { key: string; title: string; required?: boolean }[] = [
  { key: 'entity_type', title: 'Loại đối tượng', required: true },
  { key: 'trigger', title: 'Sự kiện' },
  { key: 'title_template', title: 'Tiêu đề mẫu', required: true },
  { key: 'priority', title: 'Ưu tiên' },
  { key: 'due_in_days', title: 'Hạn (ngày)' },
  { key: 'depends_on_previous', title: 'Phụ thuộc trước' },
  { key: 'is_blocking', title: 'Chặn SX' },
  { key: 'tags', title: 'Nhãn' },
  { key: 'sort_order', title: 'Thứ tự' },
  { key: 'is_active', title: 'Kích hoạt' },
  { key: 'created_at', title: 'Ngày tạo' },
  { key: 'actions', title: 'Thao tác', required: true },
];

const DEFAULT_VISIBLE_COLUMNS = [
  'entity_type',
  'trigger',
  'title_template',
  'priority',
  'due_in_days',
  'depends_on_previous',
  'is_blocking',
  'is_active',
  'actions',
];

interface FilterValues {
  entity_type: string;
  trigger: string;
  is_active: string;
}

type WorkflowTaskTemplateViewSnapshot = FilterValues & {
  search: string;
};

type WorkflowTaskTemplateNamedPreset = {
  id: string;
  name: string;
  filters: WorkflowTaskTemplateViewSnapshot;
};

const EMPTY_FILTERS: FilterValues = { entity_type: '', trigger: '', is_active: '' };

function serializeFilters(filters: FilterValues) {
  return JSON.stringify(filters);
}

function parseFilters(value: string): FilterValues {
  try {
    return JSON.parse(value) as FilterValues;
  } catch {
    return EMPTY_FILTERS;
  }
}

function parseViewSnapshot(value: unknown): WorkflowTaskTemplateViewSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const isActiveValue = obj.is_active;
  return {
    search: typeof obj.search === 'string' ? obj.search : '',
    entity_type: typeof obj.entity_type === 'string' ? obj.entity_type : '',
    trigger: typeof obj.trigger === 'string' ? obj.trigger : '',
    is_active: isActiveValue === 'true' || isActiveValue === 'false' ? isActiveValue : '',
  };
}

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

function getEntityTypeOptionLabel(value: string) {
  return ENTITY_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? getEntityTypeLabel(value);
}

function getAssignRuleSummary(assignRule: Record<string, unknown>) {
  const keys = Object.keys(assignRule ?? {});
  if (!keys.length) {
    return { label: 'Giao thủ công', color: 'default' };
  }

  const type = typeof assignRule.type === 'string' ? assignRule.type.toLowerCase() : '';
  if (type === 'role' && typeof assignRule.value === 'string' && assignRule.value.trim()) {
    return { label: `Vai trò: ${assignRule.value}`, color: 'purple' };
  }
  if (type === 'user' && typeof assignRule.id === 'number') {
    return { label: `Người dùng #${assignRule.id}`, color: 'cyan' };
  }

  return { label: 'Quy tắc tùy chỉnh', color: 'geekblue' };
}

function getScenarioLabel(value: string | undefined) {
  if (!value) return 'Chưa chọn';
  if (value === 'STANDARD_ORDER') return 'Đơn hàng tiêu chuẩn';
  return value.replace(/_/g, ' ');
}

export default function WorkflowTaskTemplateList() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filterValues, setFilterValues] = useState<FilterValues>(EMPTY_FILTERS);
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const {
    config: savedConfig,
    saveConfig,
    isLoading: isPreferencesLoading,
  } = useUserPreferences(PAGES.WORKFLOW_TASK_TEMPLATE_LIST);

  const { intentSearch, intentFilters, setIntentImmediate } = useSearchFilterIntent<FilterValues>({
    searchInput,
    filterValues,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters,
    parseFilters,
  });

  const handleFilterChange = useCallback((key: keyof FilterValues, value: string) => {
    setFilterValues((previous) => ({ ...previous, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setSearchInput('');
    setFilterValues(EMPTY_FILTERS);
    setIntentImmediate('', EMPTY_FILTERS);
    setSelectedPresetId(undefined);
  }, [setIntentImmediate]);

  const hasFilter = !!searchInput || !!filterValues.entity_type || !!filterValues.trigger || !!filterValues.is_active;

  const { visibleColumns, handleVisibleColumnsChange } = useColumnSettings(PAGE_KEY, {
    defaultVisibleColumns: DEFAULT_VISIBLE_COLUMNS,
  });

  const { data: templates = [], isFetching, refetch } = useQuery({
    queryKey: ['workflow-task-templates', intentSearch, intentFilters.entity_type, intentFilters.trigger, intentFilters.is_active],
    queryFn: () => {
      const params: Record<string, unknown> = {};
      if (intentFilters.entity_type) params.entity_type = intentFilters.entity_type;
      if (intentFilters.trigger) params.trigger = intentFilters.trigger;
      if (intentFilters.is_active !== '') params.is_active = intentFilters.is_active === 'true';
      return workflowTaskTemplatesApi.list(params as Parameters<typeof workflowTaskTemplatesApi.list>[0]);
    },
    staleTime: 30_000,
  });

  const displayData = useMemo(() => {
    if (!intentSearch) return templates;
    const query = intentSearch.toLowerCase();
    return templates.filter(
      (template) =>
        template.title_template.toLowerCase().includes(query) ||
        template.description_template.toLowerCase().includes(query) ||
        template.entity_type.toLowerCase().includes(query)
    );
  }, [templates, intentSearch]);

  const displaySummary = useMemo(() => {
    const entityCoverage = new Set(displayData.map((template) => template.entity_type)).size;
    return {
      total: displayData.length,
      active: displayData.filter((template) => template.is_active).length,
      inactive: displayData.filter((template) => !template.is_active).length,
      blocking: displayData.filter((template) => template.is_blocking).length,
      dependent: displayData.filter((template) => template.depends_on_previous).length,
      highPriority: displayData.filter((template) => template.priority === 'HIGH' || template.priority === 'URGENT').length,
      autoAssign: displayData.filter((template) => Object.keys(template.assign_rule ?? {}).length > 0).length,
      manualTrigger: displayData.filter((template) => template.trigger === 'MANUAL').length,
      entityCoverage,
    };
  }, [displayData]);

  const boardAlert = useMemo(() => {
    if (!displaySummary.total) {
      return {
        type: 'info' as const,
        message: 'Chưa có mẫu nào khớp với điều kiện hiện tại.',
        description: 'Hãy nới bộ lọc hoặc tạo mẫu mới để bổ sung vào kho workflow.',
      };
    }
    if (displaySummary.inactive > 0 || displaySummary.blocking > 0) {
      return {
        type: 'warning' as const,
        message: 'Kho mẫu đang có những policy cần rà soát.',
        description: `Có ${displaySummary.inactive} mẫu đang tắt, ${displaySummary.blocking} mẫu chặn sản xuất và ${displaySummary.highPriority} mẫu ở mức ưu tiên cao.`,
      };
    }
    return {
      type: 'success' as const,
      message: 'Kho mẫu đang ổn định và sẵn sàng cho tự động hóa.',
      description: `${displaySummary.active}/${displaySummary.total} mẫu đang bật, phủ ${displaySummary.entityCoverage} nhóm đối tượng và ${displaySummary.autoAssign} mẫu đã có quy tắc giao việc tự động.`,
    };
  }, [displaySummary]);

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (searchInput.trim()) tags.push(`Tìm kiếm: ${searchInput.trim()}`);
    if (filterValues.entity_type) tags.push(`Đối tượng: ${getEntityTypeOptionLabel(filterValues.entity_type)}`);
    if (filterValues.trigger) tags.push(`Sự kiện: ${WFT_TRIGGER_LABELS[filterValues.trigger as WftTrigger] ?? filterValues.trigger}`);
    if (filterValues.is_active) tags.push(`Trạng thái: ${filterValues.is_active === 'true' ? 'Đang bật' : 'Đã tắt'}`);
    return tags;
  }, [filterValues.entity_type, filterValues.is_active, filterValues.trigger, searchInput]);

  const configRecord = savedConfig as Record<string, unknown>;
  const namedPresets = useMemo(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) return [] as WorkflowTaskTemplateNamedPreset[];
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const obj = item as Record<string, unknown>;
        const id = typeof obj.id === 'string' ? obj.id : '';
        const name = typeof obj.name === 'string' ? obj.name : '';
        const filters = parseViewSnapshot(obj.filters);
        if (!id || !name || !filters) return null;
        return { id, name, filters };
      })
      .filter((value): value is WorkflowTaskTemplateNamedPreset => value !== null);
  }, [configRecord.saved_views]);

  const selectedPreset = useMemo(
    () => namedPresets.find((preset) => preset.id === selectedPresetId) ?? null,
    [namedPresets, selectedPresetId]
  );

  const savedViewSnapshot = useMemo(() => {
    const directSnapshot = parseViewSnapshot(configRecord.saved_view_snapshot);
    if (directSnapshot) return directSnapshot;
    return parseViewSnapshot({
      search: configRecord.search,
      entity_type: configRecord.entity_type,
      trigger: configRecord.trigger,
      is_active: configRecord.is_active,
    });
  }, [configRecord.entity_type, configRecord.is_active, configRecord.saved_view_snapshot, configRecord.search, configRecord.trigger]);

  const commandContextTags = useMemo(() => {
    if (!selectedPreset) return activeFilterTags;
    return [...activeFilterTags, `Mẫu đang dùng: ${selectedPreset.name}`];
  }, [activeFilterTags, selectedPreset]);

  const buildCurrentSnapshot = useCallback(
    (): WorkflowTaskTemplateViewSnapshot => ({
      search: searchInput,
      entity_type: filterValues.entity_type,
      trigger: filterValues.trigger,
      is_active: filterValues.is_active,
    }),
    [filterValues.entity_type, filterValues.is_active, filterValues.trigger, searchInput]
  );

  const applySnapshot = useCallback((snapshot: WorkflowTaskTemplateViewSnapshot) => {
    const nextFilters: FilterValues = {
      entity_type: snapshot.entity_type,
      trigger: snapshot.trigger,
      is_active: snapshot.is_active,
    };
    setSearchInput(snapshot.search);
    setFilterValues(nextFilters);
    setIntentImmediate(snapshot.search, nextFilters);
  }, [setIntentImmediate]);

  const saveCurrentView = useCallback(async () => {
    const currentSnapshot = buildCurrentSnapshot();
    try {
      await saveConfig({
        ...savedConfig,
        ...currentSnapshot,
        saved_view_snapshot: currentSnapshot,
        saved_views: namedPresets,
      });
      message.success('Đã lưu chế độ xem kho mẫu.');
    } catch {
      message.error('Không thể lưu chế độ xem kho mẫu.');
    }
  }, [buildCurrentSnapshot, namedPresets, saveConfig, savedConfig]);

  const applySavedView = useCallback(() => {
    if (!savedViewSnapshot) {
      message.warning('Chưa có chế độ xem đã lưu.');
      return;
    }
    applySnapshot(savedViewSnapshot);
    message.success('Đã áp dụng chế độ xem đã lưu.');
  }, [applySnapshot, savedViewSnapshot]);

  const saveNamedPreset = useCallback(async () => {
    const name = presetName.trim();
    if (!name) {
      message.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: WorkflowTaskTemplateNamedPreset = existing
      ? { ...existing, name, filters: currentSnapshot }
      : { id: `${Date.now()}`, name, filters: currentSnapshot };
    const nextPresets = existing
      ? namedPresets.map((item) => (item.id === existing.id ? nextPreset : item))
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
  }, [buildCurrentSnapshot, namedPresets, presetName, saveConfig, savedConfig]);

  const applyNamedPreset = useCallback(() => {
    if (!selectedPreset) {
      message.warning('Vui lòng chọn mẫu lọc.');
      return;
    }
    applySnapshot(selectedPreset.filters);
    message.success(`Đã áp dụng mẫu lọc "${selectedPreset.name}".`);
  }, [applySnapshot, selectedPreset]);

  const deleteNamedPreset = useCallback(async () => {
    if (!selectedPreset) {
      message.warning('Vui lòng chọn mẫu lọc để xóa.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const nextPresets = namedPresets.filter((item) => item.id !== selectedPreset.id);
    try {
      await saveConfig({
        ...savedConfig,
        ...currentSnapshot,
        saved_view_snapshot: currentSnapshot,
        saved_views: nextPresets,
      });
      setSelectedPresetId(undefined);
      message.success(`Đã xóa mẫu lọc "${selectedPreset.name}".`);
    } catch {
      message.error('Không thể xóa mẫu lọc.');
    }
  }, [buildCurrentSnapshot, namedPresets, saveConfig, savedConfig, selectedPreset]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['workflow-task-templates'] });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: workflowTaskTemplatesApi.create,
    onSuccess: () => {
      message.success('Đã tạo mẫu nhiệm vụ.');
      invalidate();
      setFormOpen(false);
    },
    onError: () => message.error('Lỗi khi tạo mẫu nhiệm vụ.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<WorkflowTaskTemplatePayload> }) =>
      workflowTaskTemplatesApi.update(id, payload),
    onSuccess: () => {
      message.success('Đã cập nhật mẫu nhiệm vụ.');
      invalidate();
      setFormOpen(false);
    },
    onError: () => message.error('Lỗi khi cập nhật mẫu nhiệm vụ.'),
  });

  const deleteMutation = useMutation({
    mutationFn: workflowTaskTemplatesApi.delete,
    onSuccess: () => {
      message.success('Đã xóa mẫu nhiệm vụ.');
      invalidate();
    },
    onError: () => message.error('Lỗi khi xóa mẫu nhiệm vụ.'),
  });

  const [playbookOpen, setPlaybookOpen] = useState(false);
  const [playbookEntityType, setPlaybookEntityType] = useState<string>('SalesOrder');
  const [playbookScenario, setPlaybookScenario] = useState<string | undefined>(undefined);
  const [overwriteExisting, setOverwriteExisting] = useState(false);

  const playbookQuery = useQuery({
    queryKey: ['workflow-playbook-suggestions', playbookEntityType, playbookScenario],
    queryFn: () =>
      workflowTaskTemplatesApi.getPlaybookSuggestions({
        entity_type: playbookEntityType,
        scenario: playbookScenario,
      }),
    enabled: playbookOpen,
    staleTime: 30_000,
  });

  const playbookSummary = useMemo(() => {
    const items = playbookQuery.data?.items ?? [];
    return {
      total: items.length,
      blocking: items.filter((item) => item.is_blocking).length,
      dependent: items.filter((item) => item.depends_on_previous).length,
      highPriority: items.filter((item) => item.priority === 'HIGH' || item.priority === 'URGENT').length,
      triggerCount: new Set(items.map((item) => item.trigger)).size,
    };
  }, [playbookQuery.data]);

  const applyPlaybookMutation = useMutation({
    mutationFn: () =>
      workflowTaskTemplatesApi.applyPlaybook({
        entity_type: playbookEntityType,
        scenario: playbookScenario,
        overwrite_existing: overwriteExisting,
      }),
    onSuccess: (result) => {
      message.success(
        `Đã áp dụng bộ mẫu: tạo mới ${result.created_count}, cập nhật ${result.updated_count}, bỏ qua ${result.skipped_count}.`
      );
      invalidate();
      setPlaybookOpen(false);
    },
    onError: (error: unknown) => {
      const messageText = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(messageText || 'Không thể áp dụng bộ mẫu.');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      workflowTaskTemplatesApi.update(id, { is_active }),
    onSuccess: () => invalidate(),
    onError: () => message.error('Lỗi khi thay đổi trạng thái.'),
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<WorkflowTaskTemplateItem | null>(null);
  const [assignRuleText, setAssignRuleText] = useState('{}');
  const [form] = Form.useForm<WorkflowTaskTemplatePayload>();

  const setAssignRulePreset = (preset: 'none' | 'role-sales' | 'user-example') => {
    if (preset === 'none') {
      setAssignRuleText('{}');
      return;
    }
    if (preset === 'role-sales') {
      setAssignRuleText('{\n  "type": "role",\n  "value": "Sales"\n}');
      return;
    }
    setAssignRuleText('{\n  "type": "user",\n  "id": 1\n}');
  };

  const openCreate = () => {
    setEditRecord(null);
    setAssignRuleText('{}');
    form.resetFields();
    form.setFieldsValue({
      priority: 'MEDIUM',
      due_in_days: 3,
      is_blocking: false,
      depends_on_previous: true,
      is_active: true,
      sort_order: 0,
      tags: [],
      assign_rule: {},
    });
    setFormOpen(true);
  };

  const openEdit = (record: WorkflowTaskTemplateItem) => {
    setEditRecord(record);
    setAssignRuleText(JSON.stringify(record.assign_rule ?? {}, null, 2));
    form.setFieldsValue({
      entity_type: record.entity_type,
      trigger: record.trigger,
      title_template: record.title_template,
      description_template: record.description_template,
      due_in_days: record.due_in_days,
      priority: record.priority,
      is_blocking: record.is_blocking,
      depends_on_previous: record.depends_on_previous,
      blocks_action: record.blocks_action,
      tags: record.tags,
      sort_order: record.sort_order,
      is_active: record.is_active,
    });
    setFormOpen(true);
  };

  const handleFormSubmit = useCallback(() => {
    form.validateFields().then((values) => {
      let assignRule: Record<string, unknown> = {};
      const rawAssignRule = assignRuleText.trim();

      if (rawAssignRule) {
        try {
          const parsed = JSON.parse(rawAssignRule) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            assignRule = parsed as Record<string, unknown>;
          } else {
            message.error('Quy tắc gán người phải là một đối tượng JSON.');
            return;
          }
        } catch {
          message.error('Quy tắc gán người không đúng định dạng JSON hợp lệ.');
          return;
        }
      }

      const payload: WorkflowTaskTemplatePayload = {
        ...values,
        tags: Array.isArray(values.tags) ? values.tags : [],
        assign_rule: assignRule,
      };

      if (editRecord) {
        updateMutation.mutate({ id: editRecord.id, payload });
      } else {
        createMutation.mutate(payload);
      }
    });
  }, [assignRuleText, createMutation, editRecord, form, updateMutation]);

  const allColumnDefs: ColumnsType<WorkflowTaskTemplateItem> = [
    {
      key: 'entity_type',
      dataIndex: 'entity_type',
      title: 'Loại đối tượng',
      width: 150,
      render: (value: string) => <Tag>{getEntityTypeLabel(value)}</Tag>,
    },
    {
      key: 'trigger',
      dataIndex: 'trigger',
      title: 'Sự kiện',
      width: 140,
      render: (value: WftTrigger) => <Tag color="blue">{WFT_TRIGGER_LABELS[value] ?? value}</Tag>,
    },
    {
      key: 'title_template',
      dataIndex: 'title_template',
      title: 'Tiêu đề mẫu',
      render: (value: string, record) => {
        const assignRuleBadge = getAssignRuleSummary(record.assign_rule ?? {});
        return (
          <Space direction="vertical" size={4}>
            <Tooltip title={record.description_template || undefined}>
              <div className="ant-table-cell-ellipsis" style={{ fontWeight: 600 }}>
                {value}
              </div>
            </Tooltip>
            {record.description_template ? (
              <div style={{ color: '#595959', fontSize: 12, lineHeight: 1.5 }}>
                {record.description_template}
              </div>
            ) : null}
            <Space size={4} wrap>
              <Tag color={assignRuleBadge.color} style={{ marginInlineEnd: 0 }}>
                {assignRuleBadge.label}
              </Tag>
              {record.is_blocking ? (
                <Tag color="error" style={{ marginInlineEnd: 0 }}>
                  {record.blocks_action ? `Chặn: ${record.blocks_action}` : 'Chặn toàn bộ thao tác'}
                </Tag>
              ) : null}
              {!!record.tags?.length && record.tags.map((tag) => (
                <Tag key={tag} style={{ marginInlineEnd: 0 }}>
                  #{tag}
                </Tag>
              ))}
            </Space>
          </Space>
        );
      },
    },
    {
      key: 'priority',
      dataIndex: 'priority',
      title: 'Ưu tiên',
      width: 110,
      render: (value: TaskPriority) => (
        <Tag color={TASK_PRIORITY_COLORS[value]}>{TASK_PRIORITY_LABELS[value] ?? value}</Tag>
      ),
    },
    {
      key: 'due_in_days',
      dataIndex: 'due_in_days',
      title: 'Hạn (ngày)',
      width: 100,
      align: 'center',
      render: (value: number) => value ?? '-',
    },
    {
      key: 'depends_on_previous',
      dataIndex: 'depends_on_previous',
      title: 'Phụ thuộc trước',
      width: 130,
      align: 'center',
      render: (value: boolean) => (value ? <Tag color="gold">Có</Tag> : <Tag color="default">Không</Tag>),
    },
    {
      key: 'is_blocking',
      dataIndex: 'is_blocking',
      title: 'Chặn SX',
      width: 90,
      align: 'center',
      render: (value: boolean) => (value ? <Tag color="red">Có</Tag> : <Tag color="default">Không</Tag>),
    },
    {
      key: 'tags',
      dataIndex: 'tags',
      title: 'Nhãn',
      width: 160,
      render: (tags: string[]) =>
        tags?.length ? tags.map((tag) => <Tag key={tag} style={{ marginBottom: 2 }}>{tag}</Tag>) : '-',
    },
    {
      key: 'sort_order',
      dataIndex: 'sort_order',
      title: 'Thứ tự',
      width: 80,
      align: 'center',
    },
    {
      key: 'is_active',
      dataIndex: 'is_active',
      title: 'Kích hoạt',
      width: 100,
      align: 'center',
      render: (value: boolean, record) => (
        <Switch
          checked={value}
          size="small"
          loading={toggleActiveMutation.isPending}
          onChange={(checked) => toggleActiveMutation.mutate({ id: record.id, is_active: checked })}
        />
      ),
    },
    {
      key: 'created_at',
      dataIndex: 'created_at',
      title: 'Ngày tạo',
      width: 150,
      render: (value: string, record) => (
        <Space direction="vertical" size={2}>
          <div>{value ? new Date(value).toLocaleDateString('vi-VN') : '-'}</div>
          <div style={{ color: '#8c8c8c', fontSize: 12 }}>
            Cập nhật: {record.updated_at ? new Date(record.updated_at).toLocaleDateString('vi-VN') : '-'}
          </div>
        </Space>
      ),
    },
    {
      key: 'actions',
      title: 'Thao tác',
      width: 110,
      fixed: 'right' as const,
      render: (_value: unknown, record: WorkflowTaskTemplateItem) => (
        <Space size={4}>
          <Tooltip title="Chỉnh sửa">
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          </Tooltip>
          <Popconfirm
            title="Xóa mẫu nhiệm vụ này?"
            okText="Xóa"
            cancelText="Hủy"
            okButtonProps={{ danger: true }}
            onConfirm={() => deleteMutation.mutate(record.id)}
          >
            <Tooltip title="Xóa">
              <Button size="small" danger icon={<DeleteOutlined />} loading={deleteMutation.isPending} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const columns = allColumnDefs.filter((column) => visibleColumns.includes(column.key as string));

  return (
    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card size="small">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              <ThunderboltOutlined style={{ color: '#1677ff', marginRight: 8 }} />
              Mẫu nhiệm vụ quy trình
            </h2>
            <p style={{ margin: '4px 0 0', color: '#666', fontSize: 13 }}>
              Quản lý kho policy tạo việc tự động theo sự kiện nghiệp vụ, giữ cho workflow đồng nhất và dễ mở rộng.
            </p>
          </div>
          <Space wrap>
            <Button
              icon={<BookOutlined />}
              onClick={() => {
                setPlaybookEntityType('SalesOrder');
                setPlaybookScenario(undefined);
                setOverwriteExisting(false);
                setPlaybookOpen(true);
              }}
            >
              Áp dụng bộ mẫu
            </Button>
            <ColumnChooser
              columns={ALL_COLUMNS}
              visibleColumns={visibleColumns}
              onChange={handleVisibleColumnsChange}
            />
            <Tooltip title="Tải lại">
              <Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()} />
            </Tooltip>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Thêm mẫu
            </Button>
            {selectedPreset ? (
              <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                Mẫu đang dùng: {selectedPreset.name}
              </Tag>
            ) : null}
          </Space>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 12,
            marginBottom: 16,
          }}
        >
          {[
            { label: 'Tổng mẫu', value: displaySummary.total, tone: '#1677ff' },
            { label: 'Đang bật', value: displaySummary.active, tone: '#389e0d' },
            { label: 'Đang tắt', value: displaySummary.inactive, tone: '#d46b08' },
            { label: 'Chặn sản xuất', value: displaySummary.blocking, tone: '#cf1322' },
            { label: 'Phụ thuộc bước trước', value: displaySummary.dependent, tone: '#531dab' },
            { label: 'Ưu tiên cao', value: displaySummary.highPriority, tone: '#c41d7f' },
            { label: 'Có tự gán', value: displaySummary.autoAssign, tone: '#0958d9' },
            { label: 'Phủ đối tượng', value: displaySummary.entityCoverage, tone: '#08979c' },
          ].map((tile) => (
            <div key={tile.label} style={SUMMARY_TILE_STYLE}>
              <div style={{ color: '#666', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {tile.label}
              </div>
              <div style={{ fontSize: 30, lineHeight: 1, fontWeight: 700, color: tile.tone }}>{tile.value}</div>
              <div style={{ color: '#8c8c8c', fontSize: 12 }}>
                {tile.value === 0 ? 'Chưa phát sinh trong tập hiện tại' : 'Đang theo dõi trong kho mẫu'}
              </div>
            </div>
          ))}
        </div>

        <Alert type={boardAlert.type} showIcon message={boardAlert.message} description={boardAlert.description} />
      </Card>

      <Card size="small">
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <div data-testid="workflow-task-templates-search" style={{ display: 'inline-block' }}>
              <Input
                placeholder="Tìm tiêu đề mẫu, mô tả hoặc loại đối tượng..."
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                style={{ width: 280 }}
                suffix={
                  searchInput
                    ? <QuickClearIcon onClear={() => setSearchInput('')} title="Xóa tìm kiếm" />
                    : undefined
                }
              />
            </div>

            <div data-testid="workflow-task-templates-entity-filter" style={{ display: 'inline-block' }}>
              <Select
                placeholder="Loại đối tượng"
                value={filterValues.entity_type || undefined}
                onChange={(value) => handleFilterChange('entity_type', value ?? '')}
                options={ENTITY_TYPE_OPTIONS}
                style={{ width: 210 }}
                suffixIcon={
                  filterValues.entity_type
                    ? <QuickClearIcon onClear={() => handleFilterChange('entity_type', '')} title="Xóa bộ lọc" />
                    : undefined
                }
              />
            </div>

            <div data-testid="workflow-task-templates-trigger-filter" style={{ display: 'inline-block' }}>
              <Select
                placeholder="Sự kiện kích hoạt"
                value={filterValues.trigger || undefined}
                onChange={(value) => handleFilterChange('trigger', value ?? '')}
                options={TRIGGER_OPTIONS}
                style={{ width: 180 }}
                suffixIcon={
                  filterValues.trigger
                    ? <QuickClearIcon onClear={() => handleFilterChange('trigger', '')} title="Xóa bộ lọc" />
                    : undefined
                }
              />
            </div>

            <div data-testid="workflow-task-templates-status-filter" style={{ display: 'inline-block' }}>
              <Select
                placeholder="Kích hoạt"
                value={filterValues.is_active || undefined}
                onChange={(value) => handleFilterChange('is_active', value ?? '')}
                options={[
                  { value: 'true', label: 'Đang bật' },
                  { value: 'false', label: 'Đã tắt' },
                ]}
                style={{ width: 130 }}
                suffixIcon={
                  filterValues.is_active
                    ? <QuickClearIcon onClear={() => handleFilterChange('is_active', '')} title="Xóa bộ lọc" />
                    : undefined
                }
              />
            </div>

            {hasFilter ? (
              <Button size="small" onClick={clearFilters}>
                Xóa bộ lọc đang áp dụng
              </Button>
            ) : null}
          </Space>

          <Space wrap>
            {isFetching ? (
              <Tag color="processing" style={{ marginInlineEnd: 0 }}>
                Đang đồng bộ kho mẫu
              </Tag>
            ) : (
              <Tag color="success" style={{ marginInlineEnd: 0 }}>
                Sẵn sàng áp dụng cho workflow
              </Tag>
            )}
            <Tag color="blue" style={{ marginInlineEnd: 0 }}>
              Hiển thị: {displayData.length} mẫu
            </Tag>
            <Tag color="default" style={{ marginInlineEnd: 0 }}>
              Kích hoạt thủ công: {displaySummary.manualTrigger}
            </Tag>
            {savedViewSnapshot ? (
              <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                Có chế độ xem đã lưu
              </Tag>
            ) : null}
          </Space>
        </Space>

        <div
          data-testid="workflow-task-templates-command-strip"
          style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <Button
            data-testid="workflow-task-templates-save-view"
            onClick={() => void saveCurrentView()}
            disabled={isPreferencesLoading}
          >
            Lưu chế độ xem
          </Button>
          <Button
            data-testid="workflow-task-templates-restore-view"
            onClick={applySavedView}
            disabled={isPreferencesLoading}
          >
            Áp dụng chế độ đã lưu
          </Button>
          <Button
            data-testid="workflow-task-templates-open-preset-modal"
            onClick={() => {
              setPresetName(selectedPreset?.name ?? '');
              setIsPresetModalOpen(true);
            }}
            disabled={isPreferencesLoading}
          >
            Lưu mẫu mới
          </Button>
          <div data-testid="workflow-task-templates-preset-select" style={{ display: 'inline-block' }}>
            <Select<string>
              allowClear
              placeholder="Chọn mẫu lọc kho mẫu"
              value={selectedPresetId}
              onChange={(value) => setSelectedPresetId(value)}
              disabled={isPreferencesLoading}
              style={{ width: 220 }}
              options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
            />
          </div>
          <Button
            data-testid="workflow-task-templates-apply-preset"
            onClick={applyNamedPreset}
            disabled={isPreferencesLoading}
          >
            Áp dụng mẫu lọc
          </Button>
          <Button
            danger
            data-testid="workflow-task-templates-delete-preset"
            onClick={() => void deleteNamedPreset()}
            disabled={isPreferencesLoading}
          >
            Xóa mẫu lọc
          </Button>
        </div>

        {commandContextTags.length ? (
          <Space wrap size={8} style={{ marginTop: 12 }}>
            {commandContextTags.map((tag) => (
              <Tag key={tag} color="processing" style={{ marginInlineEnd: 0 }}>
                {tag}
              </Tag>
            ))}
          </Space>
        ) : null}
      </Card>

      <Card size="small">
        <Table<WorkflowTaskTemplateItem>
          rowKey="id"
          dataSource={displayData}
          columns={columns}
          loading={isFetching}
          size="small"
          locale={{
            emptyText: <Empty description="Chưa có mẫu nhiệm vụ phù hợp" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
          }}
          scroll={{ x: 1100 }}
          pagination={{
            pageSize: 50,
            showSizeChanger: true,
            showTotal: (total) => `${total} mẫu`,
          }}
        />
      </Card>

      <Modal
        title={editRecord ? 'Chỉnh sửa mẫu nhiệm vụ' : 'Thêm mẫu nhiệm vụ mới'}
        open={formOpen}
        onCancel={() => {
          setFormOpen(false);
          setAssignRuleText('{}');
        }}
        onOk={handleFormSubmit}
        okText={editRecord ? 'Lưu' : 'Tạo'}
        cancelText="Hủy"
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={700}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 8 }}>
          <Alert
            type="info"
            showIcon
            message="Biến mẫu có thể dùng trong tiêu đề"
            description="Có thể chèn {entity_code}, {entity_type}, {trigger} để hệ thống tự thay giá trị khi tạo nhiệm vụ thật."
          />

          <Form form={form} layout="vertical">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <Form.Item
                name="entity_type"
                label="Loại đối tượng"
                rules={[{ required: true, message: 'Bắt buộc.' }]}
              >
                <Select options={ENTITY_TYPE_OPTIONS} placeholder="Chọn loại đối tượng" />
              </Form.Item>

              <Form.Item
                name="trigger"
                label="Sự kiện kích hoạt"
                rules={[{ required: true, message: 'Bắt buộc.' }]}
              >
                <Select options={TRIGGER_OPTIONS} placeholder="Chọn sự kiện" />
              </Form.Item>
            </div>

            <Form.Item
              name="title_template"
              label={
                <span>
                  Tiêu đề nhiệm vụ
                  <span style={{ color: '#888', fontSize: 12, marginLeft: 6 }}>
                    (biến mẫu: {'{entity_code}'}, {'{entity_type}'}, {'{trigger}'})
                  </span>
                </span>
              }
              rules={[{ required: true, message: 'Bắt buộc.' }]}
            >
              <Input placeholder="Ví dụ: Kiểm tra đơn hàng {entity_code} trước khi duyệt" />
            </Form.Item>

            <Form.Item name="description_template" label="Mô tả nhiệm vụ (tùy chọn)">
              <Input.TextArea rows={3} placeholder="Mô tả chi tiết cách xử lý hoặc bối cảnh thực hiện..." />
            </Form.Item>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' }}>
              <Form.Item name="priority" label="Ưu tiên">
                <Select options={PRIORITY_OPTIONS} />
              </Form.Item>
              <Form.Item name="due_in_days" label="Hạn hoàn thành (ngày)">
                <InputNumber min={0} max={365} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="sort_order" label="Thứ tự hiển thị">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' }}>
              <Form.Item name="depends_on_previous" label="Phụ thuộc bước trước" valuePropName="checked">
                <Switch checkedChildren="Có" unCheckedChildren="Không" />
              </Form.Item>
              <Form.Item name="is_blocking" label="Chặn sản xuất" valuePropName="checked">
                <Switch checkedChildren="Có" unCheckedChildren="Không" />
              </Form.Item>
              <Form.Item name="is_active" label="Kích hoạt" valuePropName="checked">
                <Switch checkedChildren="Bật" unCheckedChildren="Tắt" />
              </Form.Item>
            </div>

            <Form.Item
              name="blocks_action"
              label="Hành động bị chặn"
              tooltip="Để trống nếu muốn khóa toàn bộ thao tác. Ví dụ: RELEASE, APPROVE."
            >
              <Input placeholder="Ví dụ: RELEASE" />
            </Form.Item>

            <Form.Item name="tags" label="Nhãn">
              <Select
                mode="tags"
                placeholder="Nhập nhãn rồi nhấn Enter"
                tokenSeparators={[',']}
                style={{ width: '100%' }}
              />
            </Form.Item>

            <Form.Item
              label={
                <span>
                  Quy tắc gán người
                  <span style={{ color: '#888', fontSize: 12, marginLeft: 6 }}>
                    (đối tượng JSON - để trống nếu giao thủ công)
                  </span>
                </span>
              }
              tooltip={`Ví dụ:\n{} - không gán\n{"type":"user","id":5} - giao cho người dùng có ID 5\n{"type":"role","value":"Sales"} - giao theo vai trò Kinh doanh`}
            >
              <Space size={6} style={{ marginBottom: 8, flexWrap: 'wrap' }}>
                <Button size="small" onClick={() => setAssignRulePreset('none')}>
                  Giao thủ công
                </Button>
                <Button size="small" onClick={() => setAssignRulePreset('role-sales')}>
                  Vai trò Kinh doanh
                </Button>
                <Button size="small" onClick={() => setAssignRulePreset('user-example')}>
                  Người dùng #1
                </Button>
              </Space>
              <Input.TextArea
                rows={4}
                value={assignRuleText}
                placeholder='{"type":"role","value":"Sales"}'
                onChange={(event) => setAssignRuleText(event.target.value)}
              />
              <div style={{ marginTop: 6, color: '#8c8c8c', fontSize: 12, lineHeight: 1.5 }}>
                Gợi ý: dùng <b>role</b> khi muốn hệ thống tự chọn người theo vai trò; dùng <b>user</b> khi muốn chỉ định đúng một người.
                Nếu chưa chắc, hãy để <b>{'{}'}</b> để tạo nhiệm vụ trước rồi giao thủ công sau.
              </div>
            </Form.Item>
          </Form>
        </Space>
      </Modal>

      <Modal
        title="Lưu mẫu lọc kho mẫu"
        open={isPresetModalOpen}
        onCancel={() => {
          setIsPresetModalOpen(false);
          setPresetName('');
        }}
        onOk={() => void saveNamedPreset()}
        okText="Lưu mẫu"
        cancelText="Hủy"
      >
        <Input
          data-testid="workflow-task-templates-preset-name"
          value={presetName}
          onChange={(event) => setPresetName(event.target.value)}
          placeholder="Ví dụ: Kho mẫu Sales / Chỉ mẫu đang bật"
          maxLength={80}
          autoFocus
        />
      </Modal>

      <Modal
        title="Áp dụng bộ mẫu quy trình"
        open={playbookOpen}
        onCancel={() => setPlaybookOpen(false)}
        onOk={() => applyPlaybookMutation.mutate()}
        okText="Áp dụng"
        cancelText="Hủy"
        confirmLoading={applyPlaybookMutation.isPending}
        width={920}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space wrap>
              <Select<string>
                value={playbookEntityType}
                onChange={(value) => {
                  setPlaybookEntityType(value);
                  setPlaybookScenario(undefined);
                }}
                options={ENTITY_TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                style={{ width: 240 }}
              />
              <Select<string>
                value={playbookScenario}
                onChange={setPlaybookScenario}
                options={(playbookQuery.data?.available_scenarios ?? []).map((scenario) => ({
                  value: scenario,
                  label: getScenarioLabel(scenario),
                }))}
                placeholder="Chọn kịch bản"
                style={{ width: 280 }}
                loading={playbookQuery.isFetching}
              />
            </Space>

            <Space wrap>
              <span style={{ color: '#666', fontSize: 13 }}>Ghi đè mẫu trùng:</span>
              <Switch checked={overwriteExisting} onChange={setOverwriteExisting} />
            </Space>
          </Space>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 12,
            }}
          >
            {[
              { label: 'Kịch bản', value: getScenarioLabel(playbookScenario), tone: '#1677ff' },
              { label: 'Bước đề xuất', value: playbookSummary.total, tone: '#0958d9' },
              { label: 'Bước chặn', value: playbookSummary.blocking, tone: '#cf1322' },
              { label: 'Có phụ thuộc', value: playbookSummary.dependent, tone: '#531dab' },
              { label: 'Ưu tiên cao', value: playbookSummary.highPriority, tone: '#c41d7f' },
              { label: 'Số sự kiện', value: playbookSummary.triggerCount, tone: '#08979c' },
            ].map((tile) => (
              <div key={tile.label} style={SUMMARY_TILE_STYLE}>
                <div style={{ color: '#666', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {tile.label}
                </div>
                <div
                  style={{
                    fontSize: typeof tile.value === 'number' ? 30 : 18,
                    lineHeight: 1.1,
                    fontWeight: 700,
                    color: tile.tone,
                  }}
                >
                  {tile.value}
                </div>
                <div style={{ color: '#8c8c8c', fontSize: 12 }}>
                  {typeof tile.value === 'number' && tile.value === 0 ? 'Chưa có đề xuất phù hợp' : 'Theo playbook đang chọn'}
                </div>
              </div>
            ))}
          </div>

          {overwriteExisting ? (
            <Alert
              type="warning"
              showIcon
              message="Chế độ ghi đè đang bật."
              description="Những mẫu trùng khóa có thể bị cập nhật lại theo playbook. Hãy kiểm tra kỹ trước khi áp dụng."
            />
          ) : null}

          {playbookQuery.data?.description ? (
            <Alert type="info" showIcon message="Mô tả playbook" description={playbookQuery.data.description} />
          ) : null}

          {playbookQuery.data?.meta?.message ? (
            <Alert type="info" showIcon message="Gợi ý hệ thống" description={playbookQuery.data.meta.message} />
          ) : null}

          {(playbookQuery.data?.items ?? []).length === 0 && !playbookQuery.isLoading ? (
            <Empty description="Chưa có bước mẫu cho kịch bản này" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Table
              size="small"
              loading={playbookQuery.isLoading}
              rowKey={(record) => `${record.trigger}-${record.sort_order}-${record.title_template}`}
              dataSource={playbookQuery.data?.items ?? []}
              pagination={false}
              scroll={{ x: 760 }}
              columns={[
                { title: 'Thứ tự', dataIndex: 'sort_order', key: 'sort_order', width: 70 },
                {
                  title: 'Sự kiện',
                  dataIndex: 'trigger',
                  key: 'trigger',
                  width: 110,
                  render: (value: WftTrigger) => WFT_TRIGGER_LABELS[value] ?? value,
                },
                {
                  title: 'Tiêu đề mẫu',
                  dataIndex: 'title_template',
                  key: 'title_template',
                  render: (value: string) => normalizeStepTitle(value),
                },
                { title: 'Hạn (ngày)', dataIndex: 'due_in_days', key: 'due_in_days', width: 90 },
                {
                  title: 'Ưu tiên',
                  dataIndex: 'priority',
                  key: 'priority',
                  width: 100,
                  render: (value: TaskPriority) => TASK_PRIORITY_LABELS[value] ?? value,
                },
                {
                  title: 'Phụ thuộc',
                  dataIndex: 'depends_on_previous',
                  key: 'depends_on_previous',
                  width: 90,
                  render: (value: boolean) => (value ? 'Có' : 'Không'),
                },
              ]}
            />
          )}
        </Space>
      </Modal>
    </div>
  );
}
