import { useState, useCallback, useMemo } from 'react';
import {
  Table,
  Button,
  Modal,
  Space,
  Tag,
  Switch,
  Tooltip,
  Form,
  Input,
  Select,
  InputNumber,
  message,
  Popconfirm,
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
import { ColumnChooser, QuickClearIcon } from '../../components';
import { useColumnSettings } from '../../hooks/useColumnSettings';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { getEntityTypeLabel } from '../../utils/constants';

const PAGE_KEY = 'workflow-task-templates-list';

const ENTITY_TYPE_OPTIONS = [
  { value: 'SalesOrder', label: 'Đơn hàng' },
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
  'entity_type', 'trigger', 'title_template', 'priority',
  'due_in_days', 'depends_on_previous', 'is_blocking', 'is_active', 'actions',
];

interface FilterValues {
  entity_type: string;
  trigger: string;
  is_active: string;
}

const EMPTY_FILTERS: FilterValues = { entity_type: '', trigger: '', is_active: '' };

function serializeFilters(f: FilterValues) {
  return JSON.stringify(f);
}
function parseFilters(s: string): FilterValues {
  try { return JSON.parse(s) as FilterValues; } catch { return EMPTY_FILTERS; }
}

export default function WorkflowTaskTemplateList() {
  const queryClient = useQueryClient();

  // ── Search / Filter intent ──────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState('');
  const [filterValues, setFilterValues] = useState<FilterValues>(EMPTY_FILTERS);

  const { intentSearch, intentFilters, setIntentImmediate } = useSearchFilterIntent<FilterValues>({
    searchInput,
    filterValues,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters,
    parseFilters,
  });

  const handleFilterChange = useCallback(
    (key: keyof FilterValues, value: string) => {
      setFilterValues((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const clearFilters = useCallback(() => {
    setSearchInput('');
    setFilterValues(EMPTY_FILTERS);
    setIntentImmediate('', EMPTY_FILTERS);
  }, [setIntentImmediate]);

  const hasFilter =
    !!searchInput ||
    !!filterValues.entity_type ||
    !!filterValues.trigger ||
    !!filterValues.is_active;

  // ── Column settings ─────────────────────────────────────────────────────
  const { visibleColumns, handleVisibleColumnsChange } = useColumnSettings(PAGE_KEY, {
    defaultVisibleColumns: DEFAULT_VISIBLE_COLUMNS,
  });

  // ── Data query ───────────────────────────────────────────────────────────
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

  // Client-side search on title_template
  const displayData = useMemo(() => {
    if (!intentSearch) return templates;
    const q = intentSearch.toLowerCase();
    return templates.filter(
      (t) =>
        t.title_template.toLowerCase().includes(q) ||
        t.description_template.toLowerCase().includes(q) ||
        t.entity_type.toLowerCase().includes(q)
    );
  }, [templates, intentSearch]);

  // ── Mutations ────────────────────────────────────────────────────────────
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['workflow-task-templates'] });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: workflowTaskTemplatesApi.create,
    onSuccess: () => { message.success('Đã tạo mẫu nhiệm vụ.'); invalidate(); setFormOpen(false); },
    onError: () => message.error('Lỗi khi tạo mẫu nhiệm vụ.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<WorkflowTaskTemplatePayload> }) =>
      workflowTaskTemplatesApi.update(id, payload),
    onSuccess: () => { message.success('Đã cập nhật mẫu nhiệm vụ.'); invalidate(); setFormOpen(false); },
    onError: () => message.error('Lỗi khi cập nhật mẫu nhiệm vụ.'),
  });

  const deleteMutation = useMutation({
    mutationFn: workflowTaskTemplatesApi.delete,
    onSuccess: () => { message.success('Đã xóa mẫu nhiệm vụ.'); invalidate(); },
    onError: () => message.error('Lỗi khi xóa mẫu nhiệm vụ.'),
  });

  const [playbookOpen, setPlaybookOpen] = useState(false);
  const [playbookEntityType, setPlaybookEntityType] = useState<'SalesOrder' | 'Product' | 'Customer'>('SalesOrder');
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

  const applyPlaybookMutation = useMutation({
    mutationFn: () =>
      workflowTaskTemplatesApi.applyPlaybook({
        entity_type: playbookEntityType,
        scenario: playbookScenario,
        overwrite_existing: overwriteExisting,
      }),
    onSuccess: (res) => {
      message.success(
        `Đã áp dụng bộ mẫu: tạo mới ${res.created_count}, cập nhật ${res.updated_count}, bỏ qua ${res.skipped_count}.`
      );
      invalidate();
      setPlaybookOpen(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(msg || 'Không thể áp dụng bộ mẫu.');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      workflowTaskTemplatesApi.update(id, { is_active }),
    onSuccess: () => invalidate(),
    onError: () => message.error('Lỗi khi thay đổi trạng thái.'),
  });

  // ── Form modal ───────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<WorkflowTaskTemplateItem | null>(null);
  const [assignRuleText, setAssignRuleText] = useState('{}');
  const [form] = Form.useForm<WorkflowTaskTemplatePayload>();

  const setAssignRulePreset = useCallback((preset: 'none' | 'role-sales' | 'user-example') => {
    if (preset === 'none') {
      setAssignRuleText('{}');
      return;
    }
    if (preset === 'role-sales') {
      setAssignRuleText('{\n  "type": "role",\n  "value": "Sales"\n}');
      return;
    }
    setAssignRuleText('{\n  "type": "user",\n  "id": 1\n}');
  }, []);

  const openCreate = useCallback(() => {
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
  }, [form, setFormOpen, setEditRecord]);

  const openEdit = useCallback((record: WorkflowTaskTemplateItem) => {
    setEditRecord(record);
    setAssignRuleText(JSON.stringify(record.assign_rule ?? {}, null, 2));
    form.setFieldsValue({
      entity_type: record.entity_type,
      trigger: record.trigger,
      title_template: record.title_template,
      description_template: record.description_template,
      assign_rule: record.assign_rule,
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
  }, [form, setFormOpen, setEditRecord]);

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
            message.error('Quy tắc gán người phải là JSON object.');
            return;
          }
        } catch {
          message.error('Quy tắc gán người không đúng định dạng JSON.');
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
  }, [form, editRecord, createMutation, updateMutation, assignRuleText]);

  // ── Table columns ─────────────────────────────────────────────────────────
  const allColumnDefs: ColumnsType<WorkflowTaskTemplateItem> = useMemo(() => [
    {
      key: 'entity_type',
      dataIndex: 'entity_type',
      title: 'Loại đối tượng',
      width: 150,
      render: (v: string) => <Tag>{getEntityTypeLabel(v)}</Tag>,
    },
    {
      key: 'trigger',
      dataIndex: 'trigger',
      title: 'Sự kiện',
      width: 140,
      render: (v: WftTrigger) => (
        <Tag color="blue">{WFT_TRIGGER_LABELS[v] ?? v}</Tag>
      ),
    },
    {
      key: 'title_template',
      dataIndex: 'title_template',
      title: 'Tiêu đề mẫu',
      ellipsis: true,
      render: (v: string, record) => (
        <Tooltip title={record.description_template || undefined}>
          <span style={{ fontWeight: 500 }}>{v}</span>
        </Tooltip>
      ),
    },
    {
      key: 'priority',
      dataIndex: 'priority',
      title: 'Ưu tiên',
      width: 110,
      render: (v: TaskPriority) => (
        <Tag color={TASK_PRIORITY_COLORS[v]}>{TASK_PRIORITY_LABELS[v] ?? v}</Tag>
      ),
    },
    {
      key: 'due_in_days',
      dataIndex: 'due_in_days',
      title: 'Hạn (ngày)',
      width: 100,
      align: 'center',
      render: (v: number) => v ?? '-',
    },
    {
      key: 'depends_on_previous',
      dataIndex: 'depends_on_previous',
      title: 'Phụ thuộc trước',
      width: 130,
      align: 'center',
      render: (v: boolean) => (
        v ? <Tag color="gold">Có</Tag> : <Tag color="default">Không</Tag>
      ),
    },
    {
      key: 'is_blocking',
      dataIndex: 'is_blocking',
      title: 'Chặn SX',
      width: 90,
      align: 'center',
      render: (v: boolean) =>
        v ? <Tag color="red">Có</Tag> : <Tag color="default">Không</Tag>,
    },
    {
      key: 'tags',
      dataIndex: 'tags',
      title: 'Nhãn',
      width: 160,
      render: (tags: string[]) =>
        tags?.length > 0
          ? tags.map((t) => <Tag key={t} style={{ marginBottom: 2 }}>{t}</Tag>)
          : '-',
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
      render: (v: boolean, record) => (
        <Switch
          checked={v}
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
      width: 120,
      render: (v: string) => v ? new Date(v).toLocaleDateString('vi-VN') : '-',
    },
    {
      key: 'actions',
      title: 'Thao tác',
      width: 110,
      fixed: 'right' as const,
      render: (_: unknown, record: WorkflowTaskTemplateItem) => (
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
  ], [openEdit, deleteMutation, toggleActiveMutation]);

  const columns = useMemo(
    () => allColumnDefs.filter((c) => visibleColumns.includes(c.key as string)),
    [allColumnDefs, visibleColumns]
  );

  return (
    <div style={{ padding: '16px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            <ThunderboltOutlined style={{ color: '#1677ff', marginRight: 8 }} />
            Mẫu nhiệm vụ quy trình
          </h2>
          <p style={{ margin: '2px 0 0', color: '#666', fontSize: 13 }}>
            Tự động sinh task theo sự kiện chuyển trạng thái (đơn hàng, sản phẩm…)
          </p>
        </div>
        <Space>
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
        </Space>
      </div>

      {/* Filter bar */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
          padding: '10px 12px',
          background: '#f5f5f5',
          borderRadius: 8,
          border: '1px solid #e8e8e8',
          marginBottom: 12,
        }}
      >
        <Input
          placeholder="Tìm tiêu đề mẫu, mô tả..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ width: 240 }}
          suffix={
            searchInput
              ? <QuickClearIcon onClear={() => setSearchInput('')} title="Xóa tìm kiếm" />
              : undefined
          }
        />

        <Select
          placeholder="Loại đối tượng"
          allowClear={false}
          value={filterValues.entity_type || undefined}
          onChange={(v) => handleFilterChange('entity_type', v ?? '')}
          options={ENTITY_TYPE_OPTIONS}
          style={{ width: 210 }}
          suffixIcon={
            filterValues.entity_type
              ? <QuickClearIcon onClear={() => handleFilterChange('entity_type', '')} title="Xóa bộ lọc" />
              : undefined
          }
        />

        <Select
          placeholder="Sự kiện kích hoạt"
          allowClear={false}
          value={filterValues.trigger || undefined}
          onChange={(v) => handleFilterChange('trigger', v ?? '')}
          options={TRIGGER_OPTIONS}
          style={{ width: 180 }}
          suffixIcon={
            filterValues.trigger
              ? <QuickClearIcon onClear={() => handleFilterChange('trigger', '')} title="Xóa bộ lọc" />
              : undefined
          }
        />

        <Select
          placeholder="Kích hoạt"
          allowClear={false}
          value={filterValues.is_active || undefined}
          onChange={(v) => handleFilterChange('is_active', v ?? '')}
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

        {hasFilter && (
          <Button size="small" onClick={clearFilters} style={{ color: '#ff4d4f' }}>
            Xóa bộ lọc
          </Button>
        )}

        <span style={{ marginLeft: 'auto', color: '#888', fontSize: 13 }}>
          {displayData.length} mẫu
        </span>
      </div>

      {/* Table */}
      <Table<WorkflowTaskTemplateItem>
        rowKey="id"
        dataSource={displayData}
        columns={columns}
        loading={isFetching}
        size="small"
        scroll={{ x: 900 }}
        pagination={{
          pageSize: 50,
          showSizeChanger: true,
          showTotal: (total) => `${total} mẫu`,
        }}
      />

      {/* Form modal: Create / Edit */}
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
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
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
                  (placeholder: {'{entity_code}'}, {'{entity_type}'}, {'{trigger}'})
                </span>
              </span>
            }
            rules={[{ required: true, message: 'Bắt buộc.' }]}
          >
            <Input placeholder="VD: Kiểm tra đơn hàng {entity_code} trước khi duyệt" />
          </Form.Item>

          <Form.Item name="description_template" label="Mô tả (tùy chọn)">
            <Input.TextArea rows={3} placeholder="Mô tả chi tiết nhiệm vụ…" />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="priority" label="Ưu tiên">
              <Select options={PRIORITY_OPTIONS} />
            </Form.Item>
            <Form.Item name="due_in_days" label="Hạn hoàn thành (ngày)">
              <InputNumber min={0} max={365} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="sort_order" label="Thứ tự">
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
            tooltip="Để trống = chặn tất cả. VD: RELEASE, APPROVE"
          >
            <Input placeholder="VD: RELEASE" />
          </Form.Item>

          <Form.Item
            name="tags"
            label="Nhãn (tags)"
          >
            <Select
              mode="tags"
              placeholder="Nhập nhãn rồi Enter"
              tokenSeparators={[',']}
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Form.Item
            label={
              <span>
                Quy tắc gán người
                <span style={{ color: '#888', fontSize: 12, marginLeft: 6 }}>
                  (JSON object — để trống: không gán)
                </span>
              </span>
            }
            tooltip={`Ví dụ:\n{} - không gán\n{"type":"user","id":5} - gán theo ID\n{"type":"role","value":"Sales"} - gán theo role`}
          >
            <Space size={6} style={{ marginBottom: 8, flexWrap: 'wrap' }}>
              <Button size="small" onClick={() => setAssignRulePreset('none')}>
                Không gán
              </Button>
              <Button size="small" onClick={() => setAssignRulePreset('role-sales')}>
                Mẫu theo role Sales
              </Button>
              <Button size="small" onClick={() => setAssignRulePreset('user-example')}>
                Mẫu theo user ID
              </Button>
            </Space>
            <Input.TextArea
              rows={4}
              value={assignRuleText}
              placeholder='{"type":"role","value":"Sales"}'
              onChange={(e) => setAssignRuleText(e.target.value)}
            />
            <div style={{ marginTop: 6, color: '#8c8c8c', fontSize: 12, lineHeight: 1.4 }}>
              Gợi ý: dùng <b>role</b> khi muốn hệ thống tự chọn người theo vai trò; dùng <b>user</b> khi chỉ định đúng 1 người.
              Nếu không chắc, hãy để <b>{'{}'}</b> để tạo task trước rồi giao thủ công sau.
            </div>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Áp dụng bộ mẫu quy trình"
        open={playbookOpen}
        onCancel={() => setPlaybookOpen(false)}
        onOk={() => applyPlaybookMutation.mutate()}
        okText="Áp dụng"
        cancelText="Hủy"
        confirmLoading={applyPlaybookMutation.isPending}
        width={820}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space wrap>
            <Select<'SalesOrder' | 'Product' | 'Customer'>
              value={playbookEntityType}
              onChange={(v) => {
                setPlaybookEntityType(v);
                setPlaybookScenario(undefined);
              }}
              options={ENTITY_TYPE_OPTIONS.map((x) => ({ value: x.value as 'SalesOrder' | 'Product' | 'Customer', label: x.label }))}
              style={{ width: 240 }}
            />
            <Select<string>
              value={playbookScenario}
              onChange={setPlaybookScenario}
              options={(playbookQuery.data?.available_scenarios ?? []).map((s) => ({
                value: s,
                label: s === 'STANDARD_ORDER' ? 'Đơn hàng tiêu chuẩn' : s,
              }))}
              placeholder="Chọn kịch bản"
              style={{ width: 280 }}
              loading={playbookQuery.isFetching}
            />
            <span style={{ color: '#666', fontSize: 13 }}>
              Ghi đè mẫu trùng:
            </span>
            <Switch checked={overwriteExisting} onChange={setOverwriteExisting} />
          </Space>

          {playbookQuery.data?.description ? (
            <div style={{ color: '#666', fontSize: 13 }}>
              {playbookQuery.data.description}
            </div>
          ) : null}

          <Table
            size="small"
            loading={playbookQuery.isLoading}
            rowKey={(r) => `${r.trigger}-${r.sort_order}-${r.title_template}`}
            dataSource={playbookQuery.data?.items ?? []}
            pagination={false}
            columns={[
              { title: 'Thứ tự', dataIndex: 'sort_order', key: 'sort_order', width: 70 },
              {
                title: 'Sự kiện',
                dataIndex: 'trigger',
                key: 'trigger',
                width: 100,
                render: (v: WftTrigger) => WFT_TRIGGER_LABELS[v] ?? v,
              },
              {
                title: 'Tiêu đề mẫu',
                dataIndex: 'title_template',
                key: 'title_template',
                render: (v: string) => normalizeStepTitle(v),
              },
              { title: 'Hạn (ngày)', dataIndex: 'due_in_days', key: 'due_in_days', width: 90 },
              {
                title: 'Ưu tiên',
                dataIndex: 'priority',
                key: 'priority',
                width: 90,
                render: (v: TaskPriority) => TASK_PRIORITY_LABELS[v] ?? v,
              },
              {
                title: 'Phụ thuộc',
                dataIndex: 'depends_on_previous',
                key: 'depends_on_previous',
                width: 90,
                render: (v: boolean) => (v ? 'Có' : 'Không'),
              },
            ]}
          />
        </Space>
      </Modal>
    </div>
  );
}
