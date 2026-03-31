import { useState, useCallback, useMemo } from 'react';
import { Alert, Button, Modal, Space, Tabs, Tooltip, Select, Table, Tag, message } from 'antd';
import { BulbOutlined, LockOutlined, ProjectOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import TaskPanel from '../TaskPanel/TaskPanel';
import AIWorkBrief from '../AIWorkBrief/AIWorkBrief';
import {
  workflowTaskTemplatesApi,
  WFT_TRIGGER_LABELS,
  type WftTrigger,
  type GeneratePreviewItem,
} from '../../api/workflowTaskTemplates';
import { TASK_PRIORITY_LABELS, TASK_PRIORITY_COLORS, tasksApi, type TaskPriority } from '../../api/tasks';

const SUMMARY_TILE_STYLE = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: '14px 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
};

interface TaskWorkspaceModalProps {
  open: boolean;
  onClose: () => void;
  entityType: string;
  entityId: number | null;
  entityCode?: string;
  blockingCount?: number;
  titlePrefix?: string;
}

// ── Apply Template sub-modal ───────────────────────────────────────────────

interface ApplyTemplateModalProps {
  open: boolean;
  onClose: () => void;
  entityType: string;
  entityId: number;
  entityCode: string;
  onGenerated: () => void;
}

function ApplyTemplateModal({
  open,
  onClose,
  entityType,
  entityId,
  entityCode,
  onGenerated,
}: ApplyTemplateModalProps) {
  const [trigger, setTrigger] = useState<WftTrigger | ''>('');
  const [preview, setPreview] = useState<GeneratePreviewItem[]>([]);
  const [previewed, setPreviewed] = useState(false);

  const triggerOptions = Object.entries(WFT_TRIGGER_LABELS).map(([v, l]) => ({
    value: v,
    label: l,
  }));

  const { data: templates = [] } = useQuery({
    queryKey: ['workflow-task-templates', entityType],
    queryFn: () => workflowTaskTemplatesApi.list({ entity_type: entityType, is_active: true }),
    enabled: open,
    staleTime: 60_000,
  });

  const availableTriggers = [...new Set(templates.map((t) => t.trigger))];
  const filteredOptions = triggerOptions.filter((o) =>
    availableTriggers.includes(o.value as WftTrigger)
  );

  const previewMutation = useMutation({
    mutationFn: () =>
      workflowTaskTemplatesApi.previewGenerate({
        entity_type: entityType,
        entity_id: entityId,
        entity_code: entityCode,
        trigger: trigger as WftTrigger,
      }),
    onSuccess: (data) => {
      setPreview(data.preview);
      setPreviewed(true);
    },
    onError: () => message.error('Không thể xem trước mẫu nhiệm vụ.'),
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      workflowTaskTemplatesApi.generateForEntity({
        entity_type: entityType,
        entity_id: entityId,
        entity_code: entityCode,
        trigger: trigger as WftTrigger,
      }),
    onSuccess: (data) => {
      if (data.created_count === 0) {
        message.info('Tất cả nhiệm vụ từ mẫu đã tồn tại, không tạo thêm.');
      } else {
        message.success(`Đã tạo ${data.created_count} nhiệm vụ từ mẫu.`);
      }
      onGenerated();
      onClose();
    },
    onError: () => message.error('Không thể sinh nhiệm vụ từ mẫu.'),
  });

  const handleClose = useCallback(() => {
    setTrigger('');
    setPreview([]);
    setPreviewed(false);
    onClose();
  }, [onClose]);

  const toCreate = preview.filter((p) => !p.would_skip);
  const toSkip = preview.filter((p) => p.would_skip);

  const previewColumns = [
    {
      title: 'Tiêu đề',
      dataIndex: 'title',
      render: (v: string, r: GeneratePreviewItem) => (
        <div className="ant-table-cell-ellipsis" style={r.would_skip ? { color: '#bfbfbf', textDecoration: 'line-through' } : undefined}>
          {v}
        </div>
      ),
    },
    {
      title: 'Ưu tiên',
      dataIndex: 'priority',
      width: 100,
      render: (v: TaskPriority) => (
        <Tag color={TASK_PRIORITY_COLORS[v]}>{TASK_PRIORITY_LABELS[v]}</Tag>
      ),
    },
    {
      title: 'Hạn',
      dataIndex: 'due_date',
      width: 110,
      render: (v: string | null) => v ?? '-',
    },
    {
      title: 'Phụ thuộc',
      dataIndex: 'depends_on_source_key',
      width: 160,
      render: (v: string | null) => (v ? <Tag color="gold">Theo bước trước</Tag> : '-'),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'would_skip',
      width: 100,
      render: (skip: boolean) =>
        skip ? <Tag color="default">Bỏ qua</Tag> : <Tag color="green">Sẽ tạo</Tag>,
    },
  ];

  return (
    <Modal
      title={
        <Space>
          <ThunderboltOutlined style={{ color: '#faad14' }} />
          Áp dụng mẫu nhiệm vụ - {entityCode || entityType}
        </Space>
      }
      open={open}
      onCancel={handleClose}
      width={620}
      destroyOnClose
      footer={
        <Space>
          <Button onClick={handleClose}>Đóng</Button>
          {!previewed && (
            <Button
              onClick={() => previewMutation.mutate()}
              loading={previewMutation.isPending}
              disabled={!trigger}
            >
              Xem trước
            </Button>
          )}
          {previewed && toCreate.length > 0 && (
            <Button
              type="primary"
              onClick={() => {
                Modal.confirm({
                  title: 'Xác nhận tạo nhiệm vụ',
                  content: `Bạn sắp tạo ${toCreate.length} nhiệm vụ từ mẫu. Tiếp tục?`,
                  okText: 'Tạo',
                  cancelText: 'Hủy',
                  onOk: () => generateMutation.mutate(),
                  zIndex: 1070,
                });
              }}
              loading={generateMutation.isPending}
              disabled={generateMutation.isPending}
              icon={<ThunderboltOutlined />}
            >
              Tạo {toCreate.length} nhiệm vụ
            </Button>
          )}
          {previewed && toCreate.length === 0 && toSkip.length > 0 && (
            <Tag color="orange" style={{ lineHeight: '30px' }}>Tất cả đã tồn tại - không cần tạo thêm</Tag>
          )}
        </Space>
      }
      zIndex={1060}
    >
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
          Chọn sự kiện kích hoạt:
        </label>
        <Select
          placeholder="Chọn sự kiện kích hoạt..."
          options={filteredOptions.length > 0 ? filteredOptions : triggerOptions}
          value={trigger || undefined}
          onChange={(v) => {
            setTrigger(v as WftTrigger);
            setPreviewed(false);
            setPreview([]);
          }}
          style={{ width: '100%' }}
        />
        {filteredOptions.length === 0 && (
          <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>
            Chưa có mẫu nào cho loại đối tượng "{entityType}". Hãy tạo mẫu trong trang Quản lý mẫu nhiệm vụ.
          </div>
        )}
      </div>

      {previewed && (
        <div>
          <div style={{ marginBottom: 8, color: '#595959', fontSize: 13 }}>
            {toCreate.length > 0
              ? <span style={{ color: '#389e0d' }}>Sẽ tạo {toCreate.length} nhiệm vụ mới.</span>
              : <span style={{ color: '#ff4d4f' }}>Tất cả nhiệm vụ đã tồn tại, không tạo thêm.</span>}
            {toSkip.length > 0 && (
              <span style={{ marginLeft: 8, color: '#bfbfbf' }}>Bỏ qua {toSkip.length} đã tồn tại.</span>
            )}
          </div>
          <div style={{ marginBottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Tag color="green">Sẽ tạo: {toCreate.length}</Tag>
            <Tag color="default">Bỏ qua: {toSkip.length}</Tag>
            <Tag color="blue">Tổng preview: {preview.length}</Tag>
          </div>
          <Table
            size="small"
            rowKey="source_key"
            dataSource={preview}
            columns={previewColumns}
            pagination={false}
            style={{ fontSize: 12 }}
          />
        </div>
      )}
    </Modal>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────

export default function TaskWorkspaceModal({
  open,
  onClose,
  entityType,
  entityId,
  entityCode,
  blockingCount = 0,
  titlePrefix = 'Nhiệm vụ',
}: TaskWorkspaceModalProps) {
  const queryClient = useQueryClient();
  const [applyTemplateOpen, setApplyTemplateOpen] = useState(false);
  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks', entityType, entityId],
    queryFn: () => tasksApi.list({ entity_type: entityType, entity_id: entityId as number }),
    enabled: open && !!entityId,
    staleTime: 0,
  });
  const workspaceSummary = useMemo(() => {
    const openTasks = tasks.filter((task) => task.status === 'TODO' || task.status === 'IN_PROGRESS');
    const doneTasks = tasks.filter((task) => task.status === 'DONE' || task.status === 'CANCELLED');
    const latestActivityAt = [...tasks]
      .map((task) => task.activity_updated_at || task.last_update_at || task.updated_at || task.created_at)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => dayjs(b).valueOf() - dayjs(a).valueOf())[0] ?? null;
    return {
      total: tasks.length,
      open: openTasks.length,
      done: doneTasks.length,
      blocking: openTasks.filter((task) => task.is_blocking).length,
      help: openTasks.filter((task) => task.needs_help).length,
      overdue: openTasks.filter((task) => task.due_date && dayjs(task.due_date).isBefore(dayjs(), 'day')).length,
      latestActivityAt,
    };
  }, [tasks]);

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['products'], refetchType: 'all' });
    void queryClient.invalidateQueries({ queryKey: ['tasks'], refetchType: 'all' });
  }, [queryClient]);

  return (
    <>
      <Modal
        title={(
          <Space>
            <ProjectOutlined style={{ color: '#1677ff' }} />
            {`${titlePrefix}${entityCode ? ` - ${entityCode}` : ''}`}
            {Math.max(blockingCount, workspaceSummary.blocking) > 0 && (
              <Tooltip title="Có nhiệm vụ chặn đang ảnh hưởng sản xuất">
                <LockOutlined style={{ color: '#ff4d4f' }} />
              </Tooltip>
            )}
            <Tag color="processing">{entityType}</Tag>
          </Space>
        )}
        open={open}
        onCancel={onClose}
        footer={
          <Space>
            {entityId && (
              <Tooltip title="Sinh nhiệm vụ tự động từ mẫu quy trình">
                <Button
                  icon={<ThunderboltOutlined />}
                  onClick={() => setApplyTemplateOpen(true)}
                  style={{ color: '#faad14', borderColor: '#faad14' }}
                >
                  Áp dụng mẫu
                </Button>
              </Tooltip>
            )}
            <Button onClick={onClose}>Đóng</Button>
          </Space>
        }
        width={980}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 10,
            }}
          >
            {[
              { label: 'Tổng nhiệm vụ', value: workspaceSummary.total, tone: '#1d4ed8' },
              { label: 'Đang mở', value: workspaceSummary.open, tone: '#0f766e' },
              { label: 'Quá hạn', value: workspaceSummary.overdue, tone: '#dc2626' },
              { label: 'Cần hỗ trợ', value: workspaceSummary.help, tone: '#b45309' },
              { label: 'Đang chặn', value: workspaceSummary.blocking, tone: '#be123c' },
              { label: 'Đã kết thúc', value: workspaceSummary.done, tone: '#475569' },
            ].map((item) => (
              <div key={item.label} style={SUMMARY_TILE_STYLE}>
                <div style={{ fontSize: 12, color: '#64748b' }}>{item.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: item.tone, lineHeight: 1.15, marginTop: 6 }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          {(workspaceSummary.blocking > 0 || workspaceSummary.overdue > 0 || workspaceSummary.help > 0) && (
            <Alert
              showIcon
              type={workspaceSummary.blocking > 0 || workspaceSummary.overdue > 0 ? 'warning' : 'info'}
              message="Không gian xử lý đang có đầu việc cần ưu tiên"
              description={[
                workspaceSummary.blocking > 0 ? `${workspaceSummary.blocking} nhiệm vụ đang chặn luồng` : null,
                workspaceSummary.overdue > 0 ? `${workspaceSummary.overdue} nhiệm vụ quá hạn` : null,
                workspaceSummary.help > 0 ? `${workspaceSummary.help} nhiệm vụ cần hỗ trợ` : null,
                workspaceSummary.latestActivityAt ? `Cập nhật gần nhất: ${dayjs(workspaceSummary.latestActivityAt).format('DD/MM/YYYY HH:mm')}` : null,
              ].filter(Boolean).join(' · ')}
            />
          )}

          {entityId ? (
            <Tabs
              size="small"
              items={[
                {
                  key: 'tasks',
                  label: <Space size={4}><ThunderboltOutlined /><span>Nhiệm vụ</span></Space>,
                  children: (
                    <TaskPanel
                      entityType={entityType}
                      entityId={entityId}
                      entityCode={entityCode}
                      onTasksChange={invalidateAll}
                    />
                  ),
                },
                {
                  key: 'ai-brief',
                  label: <Space size={4}><BulbOutlined /><span>Trợ lý triển khai</span></Space>,
                  children: (
                    <AIWorkBrief
                      entityType={entityType}
                      entityId={entityId}
                      entityCode={entityCode}
                    />
                  ),
                },
              ]}
            />
          ) : null}
        </div>
      </Modal>

      {entityId && (
        <ApplyTemplateModal
          open={applyTemplateOpen}
          onClose={() => setApplyTemplateOpen(false)}
          entityType={entityType}
          entityId={entityId}
          entityCode={entityCode ?? ''}
          onGenerated={invalidateAll}
        />
      )}
    </>
  );
}
