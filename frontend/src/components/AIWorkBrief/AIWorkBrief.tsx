import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Input,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Tabs,
  Timeline,
  Typography,
  Upload,
  message,
} from 'antd';
import type { UploadFile } from 'antd';
import {
  BulbOutlined,
  CheckCircleOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DeploymentUnitOutlined,
  FileImageOutlined,
  FileTextOutlined,
  FlagOutlined,
  MessageOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { attachmentsApi, isImageFile } from '../../api/attachments';
import { commentsApi } from '../../api/comments';
import { tasksApi, TASK_PRIORITY_COLORS, TASK_PRIORITY_LABELS, type TaskPriority } from '../../api/tasks';
import {
  buildAiExecutionBrief,
  buildExecutionChecklist,
  buildExecutionDigests,
  buildExecutionReadiness,
  buildExecutionTimeline,
  formatStructuredSourceComment,
  formatWorkspaceRecordComment,
  getEntityExecutionPlaybook,
  parseStructuredSourceComment,
  parseWorkspaceRecordComment,
  type AiSourceKind,
  type WorkspaceRecordKind,
} from '../../utils/aiWorkBrief';

const { Text, Paragraph, Title } = Typography;
const { TextArea } = Input;

// ── Constants ──────────────────────────────────────────────────────────────────

const SOURCE_KIND_OPTIONS: { value: AiSourceKind; label: string; icon: ReactNode }[] = [
  { value: 'MEETING', label: 'Biên bản họp', icon: <MessageOutlined /> },
  { value: 'MESSAGE', label: 'Tin nhắn', icon: <MessageOutlined /> },
  { value: 'EMAIL', label: 'Email', icon: <FileTextOutlined /> },
  { value: 'IMAGE', label: 'Ghi chú hình ảnh', icon: <FileImageOutlined /> },
  { value: 'ADHOC', label: 'Việc ngoài luồng', icon: <FlagOutlined /> },
];

const RECORD_KIND_OPTIONS: { value: WorkspaceRecordKind; label: string }[] = [
  { value: 'DECISION', label: 'Quyết định' },
  { value: 'STAKEHOLDER', label: 'Stakeholder' },
  { value: 'HANDOVER', label: 'Bàn giao' },
];

const SIGNAL_SEVERITY_COLORS: Record<string, string> = {
  critical: 'error',
  warning: 'warning',
  info: 'processing',
  success: 'success',
};

// ── Types ──────────────────────────────────────────────────────────────────────

interface AIWorkBriefProps {
  entityType: string;
  entityId: number;
  entityCode?: string;
}

type AddSourceMode = 'none' | 'source' | 'record' | 'upload';

// ── Component ──────────────────────────────────────────────────────────────────

export default function AIWorkBrief({ entityType, entityId, entityCode }: AIWorkBriefProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();

  // Source/Record form state
  const [addMode, setAddMode] = useState<AddSourceMode>('none');
  const [sourceKind, setSourceKind] = useState<AiSourceKind>('MEETING');
  const [sourceContent, setSourceContent] = useState('');
  const [recordKind, setRecordKind] = useState<WorkspaceRecordKind>('DECISION');
  const [recordTitle, setRecordTitle] = useState('');
  const [recordDetails, setRecordDetails] = useState('');
  const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPriority, setTaskPriority] = useState<TaskPriority>('MEDIUM');

  // Data queries
  const commentsQuery = useQuery({
    queryKey: ['ai-work-brief-comments', entityType, entityId],
    queryFn: () => commentsApi.list(entityType, entityId),
    staleTime: 30_000,
  });

  const attachmentsQuery = useQuery({
    queryKey: ['ai-work-brief-attachments', entityType, entityId],
    queryFn: () => attachmentsApi.list(entityType, entityId),
    staleTime: 30_000,
  });

  const tasksQuery = useQuery({
    queryKey: ['ai-work-brief-tasks', entityType, entityId],
    queryFn: () => tasksApi.list({ entity_type: entityType, entity_id: entityId, page_size: 100 }),
    staleTime: 30_000,
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['ai-work-brief-comments', entityType, entityId] });
    void queryClient.invalidateQueries({ queryKey: ['ai-work-brief-attachments', entityType, entityId] });
    void queryClient.invalidateQueries({ queryKey: ['ai-work-brief-tasks', entityType, entityId] });
  }, [queryClient, entityType, entityId]);

  // Mutations
  const addSourceMutation = useMutation({
    mutationFn: () =>
      commentsApi.create({
        entity_type: entityType,
        entity_id: entityId,
        content: formatStructuredSourceComment(sourceKind, sourceContent),
      }),
    onSuccess: () => {
      messageApi.success('Đã lưu nguồn vào workspace.');
      setSourceContent('');
      setAddMode('none');
      invalidate();
    },
    onError: () => messageApi.error('Không thể lưu nguồn.'),
  });

  const addRecordMutation = useMutation({
    mutationFn: () =>
      commentsApi.create({
        entity_type: entityType,
        entity_id: entityId,
        content: formatWorkspaceRecordComment(recordKind, recordTitle, recordDetails),
      }),
    onSuccess: () => {
      messageApi.success('Đã lưu ghi nhận.');
      setRecordTitle('');
      setRecordDetails('');
      setAddMode('none');
      invalidate();
    },
    onError: () => messageApi.error('Không thể lưu ghi nhận.'),
  });

  const addTaskMutation = useMutation({
    mutationFn: (params: { title: string; priority: TaskPriority }) =>
      tasksApi.create({
        entity_type: entityType,
        entity_id: entityId,
        title: params.title,
        priority: params.priority,
      }),
    onSuccess: () => {
      messageApi.success('Đã tạo nhiệm vụ.');
      setTaskTitle('');
      invalidate();
    },
    onError: () => messageApi.error('Không thể tạo nhiệm vụ.'),
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (id: number) => commentsApi.delete(id),
    onSuccess: () => { messageApi.success('Đã xóa.'); invalidate(); },
    onError: () => messageApi.error('Không thể xóa.'),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => attachmentsApi.upload(entityType, entityId, file),
    onSuccess: () => { messageApi.success('Đã tải lên.'); setUploadFileList([]); invalidate(); },
    onError: () => messageApi.error('Không thể tải lên.'),
  });

  // Derived data
  const comments = useMemo(() => commentsQuery.data ?? [], [commentsQuery.data]);
  const attachments = useMemo(() => attachmentsQuery.data ?? [], [attachmentsQuery.data]);
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);

  const sources = useMemo(
    () => comments.map((c) => parseStructuredSourceComment(c)).filter(Boolean).map((x) => x!),
    [comments],
  );
  const records = useMemo(
    () => comments.map((c) => parseWorkspaceRecordComment(c)).filter(Boolean).map((x) => x!),
    [comments],
  );

  const brief = useMemo(
    () => buildAiExecutionBrief({ entityType, entityCode, comments, attachments, tasks }),
    [entityType, entityCode, comments, attachments, tasks],
  );
  const readiness = useMemo(
    () => buildExecutionReadiness({ sources, records, tasks, attachments }),
    [sources, records, tasks, attachments],
  );
  const checklist = useMemo(
    () => buildExecutionChecklist({ tasks, comments, attachments }),
    [tasks, comments, attachments],
  );
  const timeline = useMemo(
    () => buildExecutionTimeline({ comments, attachments }),
    [comments, attachments],
  );
  const digests = useMemo(
    () => buildExecutionDigests({ entityType, entityCode, brief, tasks, records }),
    [entityType, entityCode, brief, tasks, records],
  );
  const playbook = useMemo(
    () => getEntityExecutionPlaybook(entityType, entityCode),
    [entityType, entityCode],
  );

  // Copy to clipboard
  const copyText = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => messageApi.success(`Đã sao chép ${label}.`),
      () => messageApi.error('Không thể sao chép.'),
    );
  }, [messageApi]);

  const isLoading = commentsQuery.isLoading || attachmentsQuery.isLoading || tasksQuery.isLoading;

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 32 }}>
        <Spin />
        <div style={{ marginTop: 8, color: '#64748b' }}>Đang tải dữ liệu workspace...</div>
      </div>
    );
  }

  // ── Tab: Brief tổng hợp ────────────────────────────────────────────────────

  const renderBriefTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Readiness */}
      <Card size="small" title={<Space><ThunderboltOutlined /><span>Mức độ sẵn sàng triển khai</span></Space>}>
        <Row gutter={16} align="middle">
          <Col>
            <Progress
              type="circle"
              percent={readiness.score}
              size={80}
              status={readiness.tone === 'error' ? 'exception' : readiness.tone === 'warning' ? 'normal' : 'success'}
              strokeColor={
                readiness.tone === 'success' ? '#16a34a'
                  : readiness.tone === 'warning' ? '#d97706'
                    : '#dc2626'
              }
            />
          </Col>
          <Col flex="auto">
            <div style={{ fontWeight: 600, fontSize: 15 }}>{readiness.label}</div>
            <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>{readiness.description}</div>
          </Col>
        </Row>
      </Card>

      {/* Signals */}
      {brief.signals.length > 0 ? (
        <Card size="small" title={<Space><BulbOutlined /><span>Tín hiệu điều hành</span></Space>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {brief.signals.map((signal) => (
              <Alert
                key={signal.key}
                type={SIGNAL_SEVERITY_COLORS[signal.severity] as 'success' | 'info' | 'warning' | 'error'}
                message={signal.title}
                description={signal.detail}
                showIcon
              />
            ))}
          </div>
        </Card>
      ) : null}

      {/* Summary */}
      <Card size="small" title="Tổng quan nhanh">
        <div style={{ color: '#475569', fontSize: 14 }}>
          {brief.summary.map((line, i) => (
            <div key={i} style={{ marginBottom: 4 }}>• {line}</div>
          ))}
          {brief.summary.length === 0 ? (
            <Text type="secondary">Workspace chưa có nguồn đầu vào đáng kể.</Text>
          ) : null}
        </div>
      </Card>

      {/* Suggested Tasks */}
      {brief.suggestedTasks.length > 0 ? (
        <Card
          size="small"
          title={<Space><DeploymentUnitOutlined /><span>Đề xuất đầu việc tiếp theo</span></Space>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {brief.suggestedTasks.map((suggestion) => (
              <div
                key={suggestion.key}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '10px 12px',
                  background: '#f8fafc',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{suggestion.title}</div>
                    <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{suggestion.description}</div>
                    <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>{suggestion.reason}</div>
                  </div>
                  <Space direction="vertical" size={4} style={{ flexShrink: 0 }}>
                    <Tag color={TASK_PRIORITY_COLORS[suggestion.priority]} style={{ margin: 0 }}>
                      {TASK_PRIORITY_LABELS[suggestion.priority]}
                    </Tag>
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        setTaskTitle(suggestion.title);
                        setTaskPriority(suggestion.priority);
                      }}
                    >
                      Tạo task
                    </Button>
                  </Space>
                </div>
              </div>
            ))}
          </div>
          {taskTitle ? (
            <div style={{ marginTop: 12, padding: 10, background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
              <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Tạo nhiệm vụ nhanh</Text>
              <Input
                size="small"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                style={{ marginBottom: 6 }}
                placeholder="Tiêu đề nhiệm vụ"
              />
              <Space>
                <Select
                  size="small"
                  value={taskPriority}
                  onChange={setTaskPriority}
                  options={Object.entries(TASK_PRIORITY_LABELS).map(([v, l]) => ({ value: v, label: l }))}
                  style={{ width: 120 }}
                />
                <Button
                  size="small"
                  type="primary"
                  loading={addTaskMutation.isPending}
                  onClick={() => addTaskMutation.mutate({ title: taskTitle, priority: taskPriority })}
                >
                  Tạo
                </Button>
                <Button size="small" onClick={() => setTaskTitle('')}>Hủy</Button>
              </Space>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );

  // ── Tab: Nguồn đầu vào ─────────────────────────────────────────────────────

  const renderSourcesTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Add source form */}
      <Card
        size="small"
        title="Thêm nguồn mới"
        extra={
          <Space>
            <Button
              size="small"
              type={addMode === 'source' ? 'primary' : 'default'}
              icon={<MessageOutlined />}
              onClick={() => setAddMode(addMode === 'source' ? 'none' : 'source')}
            >
              Nguồn
            </Button>
            <Button
              size="small"
              type={addMode === 'record' ? 'primary' : 'default'}
              icon={<CheckSquareOutlined />}
              onClick={() => setAddMode(addMode === 'record' ? 'none' : 'record')}
            >
              Ghi nhận
            </Button>
            <Button
              size="small"
              type={addMode === 'upload' ? 'primary' : 'default'}
              icon={<UploadOutlined />}
              onClick={() => setAddMode(addMode === 'upload' ? 'none' : 'upload')}
            >
              Tải ảnh
            </Button>
          </Space>
        }
      >
        {addMode === 'source' ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Select
              style={{ width: '100%' }}
              value={sourceKind}
              onChange={setSourceKind}
              options={SOURCE_KIND_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <TextArea
              rows={4}
              placeholder="Nhập nội dung nguồn (biên bản họp, tin nhắn, email, ghi chú ảnh, việc ngoài luồng)..."
              value={sourceContent}
              onChange={(e) => setSourceContent(e.target.value)}
            />
            <Space>
              <Button
                type="primary"
                size="small"
                loading={addSourceMutation.isPending}
                disabled={!sourceContent.trim()}
                onClick={() => addSourceMutation.mutate()}
              >
                Lưu nguồn
              </Button>
              <Button size="small" onClick={() => setAddMode('none')}>Hủy</Button>
            </Space>
          </Space>
        ) : null}

        {addMode === 'record' ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Select
              style={{ width: '100%' }}
              value={recordKind}
              onChange={setRecordKind}
              options={RECORD_KIND_OPTIONS}
            />
            <Input
              placeholder="Tiêu đề ghi nhận (vd: Quyết định chốt phương án A)"
              value={recordTitle}
              onChange={(e) => setRecordTitle(e.target.value)}
            />
            <TextArea
              rows={3}
              placeholder="Chi tiết (người quyết định, ngày, nội dung cụ thể...)"
              value={recordDetails}
              onChange={(e) => setRecordDetails(e.target.value)}
            />
            <Space>
              <Button
                type="primary"
                size="small"
                loading={addRecordMutation.isPending}
                disabled={!recordTitle.trim() || !recordDetails.trim()}
                onClick={() => addRecordMutation.mutate()}
              >
                Lưu ghi nhận
              </Button>
              <Button size="small" onClick={() => setAddMode('none')}>Hủy</Button>
            </Space>
          </Space>
        ) : null}

        {addMode === 'upload' ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Tải ảnh hiện trường, biên bản, email chụp màn hình hoặc tài liệu liên quan.
            </Text>
            <Upload
              fileList={uploadFileList}
              beforeUpload={(file) => {
                setUploadFileList([file as unknown as UploadFile]);
                return false;
              }}
              onRemove={() => setUploadFileList([])}
              accept="image/*,.pdf,.docx,.xlsx,.csv"
              maxCount={1}
            >
              <Button icon={<UploadOutlined />}>Chọn file</Button>
            </Upload>
            <Space>
              <Button
                type="primary"
                size="small"
                loading={uploadMutation.isPending}
                disabled={uploadFileList.length === 0}
                onClick={() => {
                  if (uploadFileList[0]?.originFileObj) {
                    uploadMutation.mutate(uploadFileList[0].originFileObj as File);
                  }
                }}
              >
                Tải lên
              </Button>
              <Button size="small" onClick={() => setAddMode('none')}>Hủy</Button>
            </Space>
          </Space>
        ) : null}

        {addMode === 'none' ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Chọn loại nguồn để thêm vào workspace. Nguồn được dùng để AI phân tích và đề xuất đầu việc.
          </Text>
        ) : null}
      </Card>

      {/* Existing sources */}
      {sources.length === 0 && records.length === 0 && attachments.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Chưa có nguồn nào được thêm. Thêm biên bản họp, tin nhắn, email hoặc ảnh để AI phân tích."
        />
      ) : null}

      {sources.length > 0 ? (
        <Card size="small" title={<Space><MessageOutlined /><span>Nguồn đầu vào ({sources.length})</span></Space>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sources.map((src) => (
              <div key={src.commentId} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Space size={6}>
                    <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>{src.label}</Tag>
                    <Text type="secondary" style={{ fontSize: 11 }}>{src.createdByName}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(src.createdAt).format('DD/MM HH:mm')}</Text>
                  </Space>
                  <Button
                    type="text"
                    size="small"
                    danger
                    onClick={() => deleteCommentMutation.mutate(src.commentId)}
                  >
                    Xóa
                  </Button>
                </div>
                <Paragraph
                  style={{ fontSize: 12, color: '#334155', marginBottom: 0, whiteSpace: 'pre-wrap' }}
                  ellipsis={{ rows: 3, expandable: true, symbol: 'Xem thêm' }}
                >
                  {src.content}
                </Paragraph>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {records.length > 0 ? (
        <Card size="small" title={<Space><CheckSquareOutlined /><span>Ghi nhận vận hành ({records.length})</span></Space>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {records.map((rec) => (
              <div key={rec.commentId} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Space size={6}>
                    <Tag
                      color={rec.kind === 'DECISION' ? 'green' : rec.kind === 'STAKEHOLDER' ? 'purple' : 'orange'}
                      style={{ margin: 0, fontSize: 11 }}
                    >
                      {rec.kindLabel}
                    </Tag>
                    <Text style={{ fontSize: 13, fontWeight: 600 }}>{rec.title}</Text>
                  </Space>
                  <Button
                    type="text"
                    size="small"
                    danger
                    onClick={() => deleteCommentMutation.mutate(rec.commentId)}
                  >
                    Xóa
                  </Button>
                </div>
                <Text style={{ fontSize: 12, color: '#475569' }}>{rec.details}</Text>
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {rec.createdByName} — {dayjs(rec.createdAt).format('DD/MM HH:mm')}
                  </Text>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {attachments.length > 0 ? (
        <Card size="small" title={<Space><PaperClipOutlined /><span>Tài liệu đính kèm ({attachments.length})</span></Space>}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {attachments.map((att) => (
              <div
                key={att.id}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '6px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                }}
              >
                {isImageFile(att.filename) ? <FileImageOutlined style={{ color: '#2563eb' }} /> : <PaperClipOutlined />}
                <span>{att.filename}</span>
                <Text type="secondary" style={{ fontSize: 11 }}>({att.file_size_display})</Text>
                {att.file_url ? (
                  <Button
                    type="link"
                    size="small"
                    href={att.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ padding: 0, fontSize: 11 }}
                  >
                    Xem
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );

  // ── Tab: Checklist ─────────────────────────────────────────────────────────

  const renderChecklistTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Alert
        type="info"
        showIcon
        message="Checklist điều hành tự động dựa trên dữ liệu workspace hiện tại."
        style={{ fontSize: 12 }}
      />
      {checklist.map((item) => (
        <div
          key={item.key}
          style={{
            border: `1px solid ${item.done ? '#bbf7d0' : '#fde68a'}`,
            borderRadius: 8,
            padding: '10px 12px',
            background: item.done ? '#f0fdf4' : '#fffbeb',
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
          }}
        >
          <CheckCircleOutlined
            style={{
              color: item.done ? '#16a34a' : '#d97706',
              fontSize: 16,
              marginTop: 2,
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{item.label}</div>
            <div style={{ color: '#475569', fontSize: 12, marginTop: 2 }}>{item.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );

  // ── Tab: Timeline ──────────────────────────────────────────────────────────

  const renderTimelineTab = () => (
    <div>
      {timeline.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Chưa có sự kiện trong timeline. Thêm nguồn hoặc tải tài liệu để bắt đầu."
        />
      ) : (
        <Timeline
          items={timeline.map((entry) => ({
            key: entry.key,
            color: entry.kind === 'SOURCE' ? '#2563eb' : entry.kind === 'RECORD' ? '#16a34a' : '#7c3aed',
            dot: entry.kind === 'SOURCE' ? <MessageOutlined /> : entry.kind === 'RECORD' ? <CheckSquareOutlined /> : <PaperClipOutlined />,
            children: (
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
                  <Tag
                    color={entry.kind === 'SOURCE' ? 'blue' : entry.kind === 'RECORD' ? 'green' : 'purple'}
                    style={{ fontSize: 11, margin: 0 }}
                  >
                    {entry.label}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    <ClockCircleOutlined style={{ marginRight: 3 }} />
                    {dayjs(entry.createdAt).format('DD/MM HH:mm')} — {entry.actor}
                  </Text>
                </div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{entry.title}</div>
                <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{entry.detail}</div>
              </div>
            ),
          }))}
        />
      )}
    </div>
  );

  // ── Tab: Digest ────────────────────────────────────────────────────────────

  const renderDigestTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {[
        { key: 'operations', label: 'Vận hành', content: digests.operations },
        { key: 'handover', label: 'Bàn giao', content: digests.handover },
        { key: 'executive', label: 'Lãnh đạo', content: digests.executive },
      ].map((digest) => (
        <Card
          key={digest.key}
          size="small"
          title={digest.label}
          extra={
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => copyText(digest.content, `digest ${digest.label}`)}
            >
              Sao chép
            </Button>
          }
        >
          <pre
            style={{
              fontSize: 12,
              fontFamily: 'inherit',
              color: '#334155',
              whiteSpace: 'pre-wrap',
              margin: 0,
              background: '#f8fafc',
              borderRadius: 6,
              padding: '8px 10px',
              border: '1px solid #e2e8f0',
            }}
          >
            {digest.content}
          </pre>
        </Card>
      ))}
    </div>
  );

  // ── Tab: Playbook ──────────────────────────────────────────────────────────

  const renderPlaybookTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card size="small">
        <Title level={5} style={{ margin: 0 }}>{playbook.title}</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>{playbook.subtitle}</Text>
      </Card>

      <Card size="small" title="Trọng tâm triển khai">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {playbook.focusAreas.map((area, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <CheckCircleOutlined style={{ color: '#2563eb', marginTop: 3, flexShrink: 0 }} />
              <Text style={{ fontSize: 13 }}>{area}</Text>
            </div>
          ))}
        </div>
      </Card>

      <Card
        size="small"
        title="Câu hỏi điều hành gợi ý"
        extra={
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => copyText(playbook.prompts.map((p, i) => `${i + 1}. ${p}`).join('\n'), 'câu hỏi điều hành')}
          >
            Sao chép
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {playbook.prompts.map((prompt, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Tag style={{ flexShrink: 0, fontWeight: 700 }}>{i + 1}</Tag>
              <Text style={{ fontSize: 13 }}>{prompt}</Text>
            </div>
          ))}
        </div>
      </Card>

      <Button
        icon={<ReloadOutlined />}
        onClick={invalidate}
        size="small"
        style={{ alignSelf: 'flex-start' }}
      >
        Làm mới dữ liệu
      </Button>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  const donCount = checklist.filter((i) => i.done).length;

  return (
    <div>
      {contextHolder}
      <Checkbox.Group style={{ display: 'none' }} />
      <Tabs
        size="small"
        items={[
          {
            key: 'brief',
            label: (
              <Space size={4}>
                <ThunderboltOutlined />
                <span>Brief</span>
                {brief.signals.some((s) => s.severity === 'critical') ? (
                  <Tag color="red" style={{ margin: 0, fontSize: 10 }}>!</Tag>
                ) : null}
              </Space>
            ),
            children: renderBriefTab(),
          },
          {
            key: 'sources',
            label: (
              <Space size={4}>
                <MessageOutlined />
                <span>Nguồn</span>
                {sources.length + records.length + attachments.length > 0 ? (
                  <Tag style={{ margin: 0, fontSize: 10 }}>{sources.length + records.length + attachments.length}</Tag>
                ) : null}
              </Space>
            ),
            children: renderSourcesTab(),
          },
          {
            key: 'checklist',
            label: (
              <Space size={4}>
                <CheckSquareOutlined />
                <span>Checklist</span>
                <Tag style={{ margin: 0, fontSize: 10 }}>{donCount}/{checklist.length}</Tag>
              </Space>
            ),
            children: renderChecklistTab(),
          },
          {
            key: 'timeline',
            label: (
              <Space size={4}>
                <ClockCircleOutlined />
                <span>Timeline</span>
              </Space>
            ),
            children: renderTimelineTab(),
          },
          {
            key: 'digest',
            label: (
              <Space size={4}>
                <CopyOutlined />
                <span>Digest</span>
              </Space>
            ),
            children: renderDigestTab(),
          },
          {
            key: 'playbook',
            label: (
              <Space size={4}>
                <BulbOutlined />
                <span>Playbook</span>
              </Space>
            ),
            children: renderPlaybookTab(),
          },
        ]}
      />
    </div>
  );
}
