import { useState, useCallback } from 'react';
import { Button, Modal, Space, Tooltip, Select, Table, Tag, message } from 'antd';
import { LockOutlined, ProjectOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import TaskPanel from '../TaskPanel/TaskPanel';
import {
  workflowTaskTemplatesApi,
  WFT_TRIGGER_LABELS,
  type WftTrigger,
  type GeneratePreviewItem,
} from '../../api/workflowTaskTemplates';
import { TASK_PRIORITY_LABELS, TASK_PRIORITY_COLORS, type TaskPriority } from '../../api/tasks';

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
    onError: () => message.error('Lỗi khi xem trước.'),
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
      message.success(`Đã tạo ${data.created_count} nhiệm vụ từ template.`);
      onGenerated();
      onClose();
    },
    onError: () => message.error('Lỗi khi sinh nhiệm vụ.'),
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
      ellipsis: true,
      render: (v: string, r: GeneratePreviewItem) => (
        <span style={{ color: r.would_skip ? '#bfbfbf' : undefined, textDecoration: r.would_skip ? 'line-through' : undefined }}>
          {v}
        </span>
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
          Áp dụng mẫu nhiệm vụ — {entityCode || entityType}
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
              onClick={() => generateMutation.mutate()}
              loading={generateMutation.isPending}
              icon={<ThunderboltOutlined />}
            >
              Tạo {toCreate.length} nhiệm vụ
            </Button>
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
          placeholder="Chọn trigger (sự kiện)..."
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
            Chưa có mẫu nào cho loại đối tượng "{entityType}". Hãy tạo mẫu trong trang Quản lý template.
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
            {blockingCount > 0 && (
              <Tooltip title="Có blocking task đang chặn sản xuất">
                <LockOutlined style={{ color: '#ff4d4f' }} />
              </Tooltip>
            )}
          </Space>
        )}
        open={open}
        onCancel={onClose}
        footer={
          <Space>
            {entityId && (
              <Tooltip title="Sinh nhiệm vụ tự động từ mẫu workflow">
                <Button
                  icon={<ThunderboltOutlined />}
                  onClick={() => setApplyTemplateOpen(true)}
                  style={{ color: '#faad14', borderColor: '#faad14' }}
                >
                  Áp template
                </Button>
              </Tooltip>
            )}
            <Button onClick={onClose}>Đóng</Button>
          </Space>
        }
        width={720}
        destroyOnClose
      >
        {entityId ? (
          <TaskPanel
            entityType={entityType}
            entityId={entityId}
            entityCode={entityCode}
            onTasksChange={invalidateAll}
          />
        ) : null}
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
