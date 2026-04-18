/**
 * TaskPanel — Panel giao nhiệm vụ hiện đại.
 * Tính năng: tạo, chỉnh sửa, giao lại, báo cần hỗ trợ, ghi chú tiến độ, bỏ blocking.
 */
import { useState, useCallback, useMemo, useDeferredValue } from 'react';
import type React from 'react';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Input,
  Mentions,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Upload,
  message,
} from 'antd';
import type { UploadFile } from 'antd';
import {
  AlertOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileImageOutlined,
  FileOutlined,
  LockOutlined,
  MessageOutlined,
  PaperClipOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SwapOutlined,
  UnlockOutlined,
  UserOutlined,
  WarningOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  tasksApi,
  TASK_PRIORITY_COLORS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type TaskItem,
  type TaskCreatePayload,
  type TaskPriority,
} from '../../api/tasks';
import { commentsApi, type CommentItem } from '../../api/comments';
import { attachmentsApi, isImageFile, type AttachmentItem } from '../../api/attachments';
import { usersApi, getUserDisplayName } from '../../api/users';
import { storage } from '../../utils/storage';
import CommentBox from '../CommentBox/CommentBox';
import { SafeText as Text } from '../SafeText';
const TASK_ACTIVITY_READ_KEY = 'task_activity_read_map_v1';

const SUMMARY_TILE_STYLE = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: '14px 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentUser() {
  return storage.getUser() as {
    id: number;
    username: string;
    is_staff?: boolean;
    is_superuser?: boolean;
  } | null;
}

function loadTaskActivityReadMap(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(TASK_ACTIVITY_READ_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveTaskActivityReadMap(map: Record<string, string>) {
  try {
    window.localStorage.setItem(TASK_ACTIVITY_READ_KEY, JSON.stringify(map));
  } catch {
    // Ignore localStorage quota/permission errors in UI helper.
  }
}

type UserList = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  teams?: Array<{ id: number; code: string; name: string }>;
  roles?: Array<{ id: number; code: string; name: string }>;
}[];

interface AssigneeDirectoryState {
  users: UserList;
  roles: Array<{ id: number; code: string; name: string }>;
  teams: Array<{ id: number; code: string; name: string }>;
  search: string;
  setSearch: (value: string) => void;
  roleId?: number;
  setRoleId: (value?: number) => void;
  teamId?: number;
  setTeamId: (value?: number) => void;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  TODO: <ClockCircleOutlined style={{ color: '#8c8c8c' }} />,
  IN_PROGRESS: <PlayCircleOutlined style={{ color: '#1677ff' }} />,
  DONE: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
  CANCELLED: <CloseCircleOutlined style={{ color: '#ff4d4f' }} />,
};

const PRIORITY_OPTIONS = [
  { value: 'LOW', label: '🔵 Thấp' },
  { value: 'MEDIUM', label: '🟡 Trung bình' },
  { value: 'HIGH', label: '🟠 Cao' },
  { value: 'URGENT', label: '🔴 Khẩn cấp' },
];

/** Hook: lấy danh sách người dùng để @mention trong Mentions component */
const TASK_PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  URGENT: 4,
};

function getOverdueDays(task: TaskItem) {
  return task.due_date && dayjs(task.due_date).isBefore(dayjs(), 'day')
    ? dayjs().startOf('day').diff(dayjs(task.due_date), 'day')
    : 0;
}

function getTaskRiskScore(task: TaskItem) {
  const overdueDays = getOverdueDays(task);
  const dependencyBlocked = task.depends_on_info && task.depends_on_info.status !== 'DONE' ? 1 : 0;
  return (
    (task.is_blocking ? 400 : 0) +
    (task.needs_help ? 280 : 0) +
    overdueDays * 18 +
    (TASK_PRIORITY_WEIGHT[task.priority as TaskPriority] ?? 1) * 25 +
    dependencyBlocked * 60
  );
}

function useMentionOptions() {
  const [opts, setOpts] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const handleSearch = useCallback(async (text: string) => {
    setLoading(true);
    try {
      const users = await usersApi.list({ search: text });
      setOpts(users.map((u) => ({ value: u.username, label: `${getUserDisplayName(u)} (@${u.username})` })));
    } finally {
      setLoading(false);
    }
  }, []);
  return { opts, loading, handleSearch };
}

function renderAssigneeDirectoryFilters(directory: AssigneeDirectoryState) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
      <Input
        size="small"
        value={directory.search}
        onChange={(event) => directory.setSearch(event.target.value)}
        placeholder="Tìm người theo tên, tài khoản hoặc email..."
      />
      <Select
        size="small"
        allowClear
        virtual={false}
        value={directory.teamId}
        placeholder="Lọc theo nhóm"
        onChange={(value) => directory.setTeamId(value ?? undefined)}
        options={directory.teams.map((team) => ({ value: team.id, label: `${team.code} - ${team.name}` }))}
      />
      <Select
        size="small"
        allowClear
        virtual={false}
        value={directory.roleId}
        placeholder="Lọc theo vai trò"
        onChange={(value) => directory.setRoleId(value ?? undefined)}
        options={directory.roles.map((role) => ({ value: role.id, label: `${role.code} - ${role.name}` }))}
      />
    </div>
  );
}

// ─── Form fields (render function, không phải component) ──────────────────────

interface FormValues {
  title: string;
  description?: string;
  assigned_to?: number;
  depends_on?: number;
  priority: TaskPriority;
  is_pinned?: boolean;
  tags?: string[];
  is_blocking: boolean;
  due_date?: dayjs.Dayjs;
}

function renderFormFields(
  directory: AssigneeDirectoryState,
  tasks: TaskItem[],
  currentTaskId?: number,
) {
  const dependencyOptions = tasks
    .filter((t) => t.id !== currentTaskId)
    .map((t) => ({
      value: t.id,
      label: `${t.title} (${t.status_display})`,
    }));

  return (
    <>
      <Form.Item
        name="title"
        label="Tiêu đề nhiệm vụ"
        rules={[{ required: true, message: 'Vui lòng nhập tiêu đề' }]}
        style={{ marginBottom: 10 }}
      >
        <Input placeholder="VD: Thay phim in mã TH-001, Làm khuôn bế mới..." />
      </Form.Item>

      <Form.Item name="description" label="Mô tả chi tiết" style={{ marginBottom: 10 }}>
        <Input.TextArea rows={2} placeholder="Thông tin thêm, yêu cầu kỹ thuật... (tuỳ chọn)" />
      </Form.Item>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Form.Item name="is_pinned" label="Ghim ưu tiên" valuePropName="checked" initialValue={false} style={{ marginBottom: 10 }}>
          <Switch size="small" />
        </Form.Item>
        <Form.Item name="tags" label="Nhãn" style={{ marginBottom: 10 }}>
          <Select
            mode="tags"
            tokenSeparators={[',', ' ']}
            placeholder="VD: phim_in, khuon_be, qc"
            options={[]}
            virtual={false}
          />
        </Form.Item>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Form.Item name="assigned_to" label="Người thực hiện" style={{ marginBottom: 10 }}>
          <div>
            {renderAssigneeDirectoryFilters(directory)}
            <Select
              showSearch
              allowClear
              placeholder="Chọn người..."
              filterOption={false}
              onSearch={directory.setSearch}
              virtual={false}
              options={directory.users.map((u) => ({
                value: u.id,
                label: [
                  getUserDisplayName(u),
                  u.teams?.[0]?.name,
                  u.roles?.[0]?.name ? `(${u.roles[0].name})` : '',
                ].filter(Boolean).join(' - '),
              }))}
            />
          </div>
        </Form.Item>
        <Form.Item name="due_date" label="Hạn hoàn thành" style={{ marginBottom: 10 }}>
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} placeholder="Chọn ngày..." />
        </Form.Item>
      </div>

      <Form.Item name="depends_on" label="Phụ thuộc công đoạn" style={{ marginBottom: 10 }}>
        <Select
          showSearch
          allowClear
          placeholder="Không phụ thuộc / Chọn nhiệm vụ cần hoàn thành trước..."
          filterOption={(input, opt) => String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
          options={dependencyOptions}
          virtual={false}
        />
      </Form.Item>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}>
        <Form.Item name="priority" label="Ưu tiên" initialValue="MEDIUM" style={{ marginBottom: 10 }}>
          <Select options={PRIORITY_OPTIONS} virtual={false} />
        </Form.Item>
        <Form.Item
          name="is_blocking"
          label={
            <Tooltip title="Bật = sản phẩm bị khóa cho đến khi nhiệm vụ hoàn thành">
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <LockOutlined /> Chặn
              </span>
            </Tooltip>
          }
          valuePropName="checked"
          initialValue={false}
          style={{ marginBottom: 10 }}
        >
          <Switch size="small" />
        </Form.Item>
      </div>
    </>
  );
}

// ─── TaskDetailDrawer ─────────────────────────────────────────────────────────

interface TaskDetailDrawerProps {
  task: TaskItem;
  open: boolean;
  onClose: () => void;
}

function TaskDetailDrawer({ task, open, onClose }: TaskDetailDrawerProps) {
  const [uploading, setUploading] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const commentKey = ['task-comments', task.id];
  const attachKey = ['task-attachments', task.id];

  const { data: comments = [], isLoading: loadingComments, refetch: refetchComments } = useQuery({
    queryKey: commentKey,
    queryFn: () => commentsApi.list('Task', task.id),
    enabled: open,
    staleTime: 0,
  });

  const { data: attachments = [], isLoading: loadingAttach, refetch: refetchAttach } = useQuery({
    queryKey: attachKey,
    queryFn: () => attachmentsApi.list('Task', task.id),
    enabled: open,
    staleTime: 0,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => attachmentsApi.delete(id),
    onSuccess: () => { void refetchAttach(); },
    onError: () => { void message.error('Xóa file thất bại.'); },
  });

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      await attachmentsApi.upload('Task', task.id, file);
      void message.success(`Đã tải lên "${file.name}"`);
      void refetchAttach();
    } catch {
      void message.error('Tải file thất bại, thử lại.');
    } finally {
      setUploading(false);
      setFileList([]);
    }
    return false; // prevent default Upload behavior
  };

  const currentUser = getCurrentUser();
  const latestCommentAt = comments[0]?.created_at ?? null;
  const latestAttachmentAt = attachments[0]?.uploaded_at ?? null;
  const latestActivityAt = [task.last_update_at, latestCommentAt, latestAttachmentAt]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => dayjs(b).valueOf() - dayjs(a).valueOf())[0] ?? null;
  const isOverdue = Boolean(
    task.due_date
    && (task.status === 'TODO' || task.status === 'IN_PROGRESS')
    && dayjs(task.due_date).isBefore(dayjs(), 'day')
  );

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MessageOutlined style={{ color: '#597ef7' }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>{task.title}</span>
          <Tag color={TASK_PRIORITY_COLORS[task.priority as TaskPriority]} style={{ marginLeft: 4 }}>
            {TASK_PRIORITY_LABELS[task.priority as TaskPriority]}
          </Tag>
        </div>
      }
      open={open}
      onClose={onClose}
      width={480}
      zIndex={1060}
      styles={{ body: { padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 0 } }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 14,
          padding: '12px 14px',
          borderRadius: 12,
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
        }}
      >
        <Tag color={TASK_PRIORITY_COLORS[task.priority as TaskPriority]}>{TASK_PRIORITY_LABELS[task.priority as TaskPriority]}</Tag>
        <Tag>{TASK_STATUS_LABELS[task.status]}</Tag>
        {task.due_date ? (
          <Tag color={isOverdue ? 'error' : 'default'}>
            Hạn: {dayjs(task.due_date).format('DD/MM/YYYY')}
          </Tag>
        ) : null}
        <Tag color="blue">Bình luận: {comments.length}</Tag>
        <Tag color="cyan">Tệp: {attachments.length}</Tag>
        {latestActivityAt ? <Tag>Cập nhật gần nhất: {dayjs(latestActivityAt).format('DD/MM HH:mm')}</Tag> : null}
      </div>

      {/* ── File đính kèm ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text strong style={{ fontSize: 13 }}>
            <PaperClipOutlined style={{ marginRight: 6, color: '#595959' }} />
            File đính kèm {attachments.length > 0 && <Tag style={{ marginLeft: 4 }}>{attachments.length}</Tag>}
          </Text>
          <Upload
            beforeUpload={(file) => { void handleUpload(file); return false; }}
            fileList={fileList}
            onChange={({ fileList: fl }) => setFileList(fl)}
            showUploadList={false}
            multiple={false}
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt"
          >
            <Button size="small" icon={<PaperClipOutlined />} loading={uploading}>
              Tải tệp
            </Button>
          </Upload>
        </div>

        {loadingAttach ? (
          <div style={{ textAlign: 'center', padding: 8 }}><Spin size="small" /></div>
        ) : attachments.length === 0 ? (
          <div style={{ color: '#bfbfbf', fontSize: 12, padding: '4px 0' }}>Chưa có file đính kèm</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {attachments.map((att) => (
              <AttachmentRow
                key={att.id}
                att={att}
                canDelete={!!(currentUser?.id === att.uploaded_by || currentUser?.is_staff || currentUser?.is_superuser)}
                onDelete={() => deleteMutation.mutate(att.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ height: 1, background: '#f0f0f0', margin: '0 0 14px' }} />

      {/* ── Bình luận ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Text strong style={{ fontSize: 13, marginBottom: 10, display: 'block' }}>
          <MessageOutlined style={{ marginRight: 6, color: '#597ef7' }} />
          Bình luận {comments.length > 0 && <Tag style={{ marginLeft: 4 }}>{comments.length}</Tag>}
        </Text>

        {/* Comment list */}
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12, maxHeight: 340 }}>
          {loadingComments ? (
            <div style={{ textAlign: 'center', padding: 16 }}><Spin size="small" /></div>
          ) : comments.length === 0 ? (
            <div style={{ color: '#bfbfbf', fontSize: 12, padding: '4px 0' }}>Chưa có bình luận</div>
          ) : (
            comments.map((c) => <CommentRow key={c.id} comment={c} />)
          )}
        </div>

        {/* CommentBox */}
        <CommentBox
          entityType="Task"
          entityId={task.id}
          onSuccess={() => { void refetchComments(); }}
          placeholder="Viết bình luận, cập nhật tiến độ... (@ để đề cập người dùng)"
        />
      </div>
    </Drawer>
  );
}

// ─── AttachmentRow ────────────────────────────────────────────────────────────

function AttachmentRow({ att, canDelete, onDelete }: { att: AttachmentItem; canDelete: boolean; onDelete: () => void }) {
  const isImg = isImageFile(att.filename);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, background: '#fafafa',
      border: '1px solid #f0f0f0', borderRadius: 8, padding: '6px 10px',
    }}>
      {isImg && att.file_url ? (
        <img src={att.file_url} alt={att.filename}
          style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, flexShrink: 0, cursor: 'pointer' }}
          onClick={() => window.open(att.file_url!, '_blank')}
        />
      ) : (
        <div style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f0f0', borderRadius: 4, flexShrink: 0 }}>
          {isImg ? <FileImageOutlined style={{ color: '#1677ff', fontSize: 18 }} /> : <FileOutlined style={{ color: '#595959', fontSize: 18 }} />}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {att.filename}
        </Text>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {att.file_size_display} · {dayjs(att.uploaded_at).format('DD/MM/YYYY HH:mm')}
          {att.uploaded_by_username && ` · ${att.uploaded_by_username}`}
        </Text>
      </div>
      <Space size={4}>
        {att.file_url && (
          <Tooltip title="Tải xuống">
            <Button type="text" size="small" icon={<DownloadOutlined />}
              onClick={() => window.open(att.file_url!, '_blank')} />
          </Tooltip>
        )}
        {canDelete && (
          <Tooltip title="Xóa file">
            <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={onDelete} />
          </Tooltip>
        )}
      </Space>
    </div>
  );
}

// ─── CommentRow ───────────────────────────────────────────────────────────────

function CommentRow({ comment }: { comment: CommentItem }) {
  const initials = (comment.created_by_name || comment.created_by_username || '?').slice(0, 2).toUpperCase();
  const colors = ['#667eea', '#48bb78', '#ed8936', '#e53e3e', '#38b2ac', '#9f7aea', '#ed64a6'];
  const color = colors[(comment.created_by_username || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length];
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
      <Avatar size={28} style={{ background: color, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
        {initials}
      </Avatar>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <Text strong style={{ fontSize: 12 }}>{comment.created_by_name || comment.created_by_username}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(comment.created_at).format('DD/MM HH:mm')}</Text>
        </div>
        <div style={{
          background: '#f5f5f5', borderRadius: '0 8px 8px 8px',
          padding: '6px 10px', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {comment.content}
        </div>
      </div>
    </div>
  );
}

// ─── TaskCard ─────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: TaskItem;
  users: UserList;
  assigneeDirectory: AssigneeDirectoryState;
  onRefresh: () => void;
  onEdit: (task: TaskItem) => void;
  lastReadAt?: string;
  onMarkRead: (taskId: number, at?: string | null) => void;
  queueRank?: number;
}

function TaskCard({ task, users, assigneeDirectory, onRefresh, onEdit, lastReadAt, onMarkRead, queueRank }: TaskCardProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [helpReason, setHelpReason] = useState('');
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [reassignTo, setReassignTo] = useState<number | null>(null);
  const [reassignNote, setReassignNote] = useState('');
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const helpMention = useMentionOptions();
  const noteMention = useMentionOptions();
  const reassignMention = useMentionOptions();

  const user = getCurrentUser();
  const isOpen = task.status === 'TODO' || task.status === 'IN_PROGRESS';
  const isDone = task.status === 'DONE';
  const isCancelled = task.status === 'CANCELLED';
  const isOverdue = isOpen && task.due_date && dayjs(task.due_date).isBefore(dayjs(), 'day');
  const isDueToday = isOpen && task.due_date && dayjs(task.due_date).isSame(dayjs(), 'day');

  // So sánh ID cẩn thận: ép về số để tránh type mismatch từ localStorage
  const userId = user?.id ? Number(user.id) : null;
  const isAssigned = userId !== null && Number(task.assigned_to) === userId;
  // Hiển thị nút cho tất cả task mở — backend kiểm soát quyền thực sự
  const canManage = true;   // edit, chuyển, bỏ blocking
  const canInvolved = true; // ghi chú
  const canUnblock = task.is_blocking && isOpen;
  const dependencyBlocked = isOpen && !!task.depends_on_info && task.depends_on_info.status !== 'DONE';
  const activityCount = (task.comment_count ?? 0) + (task.attachment_count ?? 0);
  const hasAnyActivity = activityCount > 0;
  const hasUnreadActivity = task.activity_updated_at
    ? (lastReadAt ? dayjs(task.activity_updated_at).isAfter(dayjs(lastReadAt)) : hasAnyActivity)
    : false;
  const lastTouchedAt = task.activity_updated_at || task.last_update_at || task.updated_at || task.created_at;

  const do_ = async (action: string, fn: () => Promise<TaskItem>) => {
    setLoading(action);
    try {
      await fn();
      void message.success(
        action === 'start' ? 'Đã bắt đầu nhiệm vụ.' :
        action === 'complete' ? 'Đã hoàn thành nhiệm vụ.' :
        action === 'cancel' ? 'Đã hủy.' :
        action === 'help' ? 'Đã gửi yêu cầu hỗ trợ.' :
        action === 'resolve' ? 'Đã xác nhận hỗ trợ xong.' :
        action === 'reassign' ? 'Đã chuyển nhiệm vụ.' :
        action === 'note' ? 'Đã lưu ghi chú.' :
        action === 'remind' ? 'Đã gửi nhắc quá hạn.' :
        action === 'unblock' ? 'Đã gỡ trạng thái chặn.' : 'Thành công.'
      );
      onRefresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      void message.error(msg ?? 'Thao tác thất bại, thử lại.');
    } finally {
      setLoading(null);
    }
  };

  // Background color
  const bgColor = task.needs_help && isOpen ? '#fff7e6'
    : isDone ? '#f6ffed'
    : isCancelled ? '#f9f9f9'
    : task.is_blocking && isOpen ? '#fff2f0'
    : isOverdue ? '#fffbe6'
    : '#fafafa';
  const borderColor = task.needs_help && isOpen ? '#ffd591'
    : isDone ? '#b7eb8f'
    : isCancelled ? '#e8e8e8'
    : task.is_blocking && isOpen ? '#ffa39e'
    : isOverdue ? '#ffe58f'
    : '#f0f0f0';

  return (
    <div
      style={{
        background: bgColor, border: `1px solid ${borderColor}`, borderRadius: 10,
        padding: '12px 14px', marginBottom: 10, transition: 'box-shadow 0.15s', position: 'relative',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
    >
      {/* Edit button — creator/manager */}
      {canManage && !isDone && !isCancelled && (
        <Tooltip title="Chỉnh sửa nhiệm vụ">
          <Button type="text" size="small" icon={<EditOutlined style={{ fontSize: 13 }} />}
            onClick={() => onEdit(task)}
            style={{ position: 'absolute', top: 8, right: 8, color: '#8c8c8c', padding: '0 4px', height: 24 }}
          />
        </Tooltip>
      )}

      {/* Header: status icon + title + tags */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6, paddingRight: canManage ? 28 : 0 }}>
        <span style={{ marginTop: 2, flexShrink: 0 }}>{STATUS_ICON[task.status]}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {queueRank ? (
              <Tag color={queueRank <= 3 ? 'volcano' : 'gold'} style={{ margin: 0, fontWeight: 600 }}>
                #{queueRank}
              </Tag>
            ) : null}
            <Text strong style={{
              fontSize: 14,
              textDecoration: isDone || isCancelled ? 'line-through' : 'none',
              color: isDone || isCancelled ? '#8c8c8c' : 'inherit',
            }}>
              {task.title}
            </Text>

            {task.needs_help && isOpen && (
              <Tag icon={<AlertOutlined />} color="warning" style={{ margin: 0, fontWeight: 600 }}>
                Cần hỗ trợ
              </Tag>
            )}
            {task.is_pinned && (
              <Tag color="magenta" style={{ margin: 0, fontWeight: 600 }}>Ghim</Tag>
            )}
            {task.is_blocking && isOpen && (
              <Tooltip title="Nhiệm vụ này đang chặn sản xuất">
                <Tag icon={<LockOutlined />} color="error" style={{ margin: 0, cursor: 'default' }}>Chặn</Tag>
              </Tooltip>
            )}
            {isOverdue && !task.needs_help && (
              <Tag icon={<WarningOutlined />} color="warning" style={{ margin: 0, cursor: 'default' }}>Quá hạn</Tag>
            )}
            {isDueToday && !isOverdue && (
              <Tag color="gold" style={{ margin: 0, cursor: 'default' }}>Đến hạn hôm nay</Tag>
            )}
            <Tag color={TASK_PRIORITY_COLORS[task.priority as TaskPriority]} style={{ margin: 0 }}>
              {TASK_PRIORITY_LABELS[task.priority as TaskPriority]}
            </Tag>
            <Tag style={{ margin: 0, color: '#595959' }}>{TASK_STATUS_LABELS[task.status]}</Tag>
          </div>

          {task.description && (
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 3, lineHeight: 1.5 }}>
              {task.description}
            </Text>
          )}
          {!!task.tags?.length && (
            <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {task.tags.map((tag) => (
                <Tag key={tag} style={{ marginInlineEnd: 0 }}>#{tag}</Tag>
              ))}
            </div>
          )}

          {/* Help reason */}
          {task.needs_help && task.help_reason && (
            <div style={{ marginTop: 6, background: '#fff3cd', border: '1px solid #ffd591', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}>
              <AlertOutlined style={{ color: '#d46b08', marginRight: 4 }} />
              <Text style={{ color: '#874d00', fontSize: 12 }}>{task.help_reason}</Text>
            </div>
          )}

          {/* Last progress note */}
          {task.last_update_note && (
            <div style={{ marginTop: 6, background: '#f0f5ff', border: '1px solid #adc6ff', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}>
              <MessageOutlined style={{ color: '#2f54eb', marginRight: 4 }} />
              <Text style={{ color: '#1d3461', fontSize: 12 }}>{task.last_update_note}</Text>
              {task.last_updated_by_info && (
                <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                  · {task.last_updated_by_info.full_name}
                  {task.last_update_at ? ` · ${dayjs(task.last_update_at).format('DD/MM HH:mm')}` : ''}
                </Text>
              )}
            </div>
          )}
          {task.depends_on_info && task.depends_on_info.status !== 'DONE' && (
            <div style={{ marginTop: 6, background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}>
              <ClockCircleOutlined style={{ color: '#d48806', marginRight: 4 }} />
              <Text style={{ color: '#ad6800', fontSize: 12 }}>
                Chờ công đoạn trước: {task.depends_on_info.title} ({task.depends_on_info.status_display})
              </Text>
            </div>
          )}
        </div>
      </div>

      {/* Meta: assignee, due, created by */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: isOpen ? 10 : 0 }}>
        {task.assigned_to_info ? (
          <Space size={4}>
            <Avatar size={18} icon={<UserOutlined />} style={{ background: '#1677ff', flexShrink: 0 }} />
            <Text type="secondary" style={{ fontSize: 12 }}>{task.assigned_to_info.full_name}</Text>
          </Space>
        ) : (
          <Text type="secondary" style={{ fontSize: 12, fontStyle: 'italic' }}>Chưa giao cho ai</Text>
        )}
        {task.due_date && (
          <Space size={4}>
            <ClockCircleOutlined style={{ fontSize: 11, color: isOverdue ? '#fa8c16' : '#8c8c8c' }} />
            <Text style={{ fontSize: 12, color: isOverdue ? '#d46b08' : '#8c8c8c' }}>
              Hạn: {dayjs(task.due_date).format('DD/MM/YYYY')}
            </Text>
          </Space>
        )}
          {isOverdue && (
            <Tag color="error" style={{ marginInlineStart: -6 }}>Quá hạn</Tag>
          )}
        {task.assigned_by_info && (
          <Text type="secondary" style={{ fontSize: 11 }}>Giao bởi: {task.assigned_by_info.full_name}</Text>
        )}
        {task.completed_at && (
          <Text type="secondary" style={{ fontSize: 11 }}>✓ {dayjs(task.completed_at).format('DD/MM HH:mm')}</Text>
        )}
        {activityCount > 0 && (
          <Tag color={hasUnreadActivity ? 'processing' : 'default'} style={{ marginInlineEnd: 0 }}>
            Trao đổi: {activityCount}
          </Tag>
        )}
        {lastTouchedAt && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            Cập nhật: {dayjs(lastTouchedAt).format('DD/MM HH:mm')}
          </Text>
        )}
      </div>

      {/* Action buttons */}
      {isOpen && (
        <Space size={6} wrap>
          {task.status === 'TODO' && (
            <Tooltip title={dependencyBlocked ? 'Nhiệm vụ phụ thuộc chưa hoàn thành' : 'Bắt đầu nhiệm vụ'}>
              <Button size="small" type="primary" ghost icon={<PlayCircleOutlined />}
                disabled={dependencyBlocked}
                loading={loading === 'start'} onClick={() => void do_('start', () => tasksApi.start(task.id))}>
                Bắt đầu
              </Button>
            </Tooltip>
          )}
          {isOverdue && (
            <Tooltip title="Gửi nhắc quá hạn cho người liên quan">
              <Button
                size="small"
                icon={<WarningOutlined />}
                loading={loading === 'remind'}
                onClick={async () => {
                  setLoading('remind');
                  try {
                    const result = await tasksApi.remindOverdue(task.id);
                    if (result.sent_count > 0) {
                      void message.success(`Đã gửi ${result.sent_count} thông báo nhắc quá hạn.`);
                    } else {
                      void message.warning('Vừa nhắc gần đây, tạm thời chưa gửi thêm để tránh spam.');
                    }
                    onRefresh();
                  } catch (err: unknown) {
                    const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
                    void message.error(msg ?? 'Không thể gửi nhắc quá hạn.');
                  } finally {
                    setLoading(null);
                  }
                }}
                style={{ borderColor: '#faad14', color: '#d48806' }}
              >
                Nhắc quá hạn
              </Button>
            </Tooltip>
          )}
          <Button size="small" type="primary" icon={<CheckCircleOutlined />}
            loading={loading === 'complete'}
            onClick={() => void do_('complete', () => tasksApi.complete(task.id))}
            style={{ background: '#52c41a', borderColor: '#52c41a' }}>
            Hoàn thành
          </Button>
          <Button size="small" danger ghost icon={<CloseCircleOutlined />}
            loading={loading === 'cancel'} onClick={() => void do_('cancel', () => tasksApi.cancel(task.id))}>
            Hủy
          </Button>

          {/* Ghi chú tiến độ — mọi người liên quan */}
          {canInvolved && (
            <Tooltip title="Ghi chú tiến độ, vướng mắc...">
              <Button size="small" icon={<MessageOutlined />}
                onClick={() => { setNoteText(task.last_update_note ?? ''); setNoteModalOpen(true); }}
                style={{ borderColor: '#597ef7', color: '#597ef7' }}>
                Ghi chú
              </Button>
            </Tooltip>
          )}

          {/* Báo cần hỗ trợ — hiện khi chưa báo */}
          {!task.needs_help && (
            <Tooltip title="Báo người giao việc biết bạn đang vướng mắc">
              <Button size="small" icon={<AlertOutlined />}
                loading={loading === 'help'}
                onClick={() => { setHelpReason(''); setHelpModalOpen(true); }}
                style={{ borderColor: '#fa8c16', color: '#fa8c16' }}>
                Cần hỗ trợ
              </Button>
            </Tooltip>
          )}

          {/* Đã giải quyết hỗ trợ — hiện khi đang cần hỗ trợ */}
          {task.needs_help && (
            <Tooltip title="Xác nhận đã hỗ trợ xong, gỡ cờ cần hỗ trợ">
              <Button size="small" icon={<CheckOutlined />}
                loading={loading === 'resolve'}
                onClick={() => void do_('resolve', () => tasksApi.resolveHelp(task.id))}
                style={{ borderColor: '#52c41a', color: '#52c41a' }}>
                Đã hỗ trợ
              </Button>
            </Tooltip>
          )}

          {/* Chuyển nhiệm vụ — assigned + manager/creator */}
          {(isAssigned || canManage) && (
            <Tooltip title="Chuyển nhiệm vụ sang người khác">
              <Button size="small" icon={<SwapOutlined />}
                onClick={() => {
                  assigneeDirectory.setSearch('');
                  assigneeDirectory.setRoleId(undefined);
                  assigneeDirectory.setTeamId(undefined);
                  setReassignTo(task.assigned_to);
                  setReassignNote('');
                  setReassignModalOpen(true);
                }}
                style={{ borderColor: '#722ed1', color: '#722ed1' }}>
                Chuyển
              </Button>
            </Tooltip>
          )}

          {/* Bỏ blocking — dùng Popconfirm để tránh z-index conflict */}
          {canUnblock && (
            <Popconfirm
              title="Bỏ trạng thái chặn của nhiệm vụ này?"
              description="Sản phẩm sẽ có thể sản xuất bình thường."
              okText="Xác nhận bỏ chặn"
              cancelText="Hủy"
              okButtonProps={{ danger: false, type: 'primary' }}
              onConfirm={() => void do_('unblock', () => tasksApi.unblock(task.id, ''))}
            >
              <Button size="small" icon={<UnlockOutlined />}
                loading={loading === 'unblock'}
                style={{ borderColor: '#fa8c16', color: '#fa8c16' }}>
                Bỏ chặn
              </Button>
            </Popconfirm>
          )}
        </Space>
      )}

      {/* Modal: Báo cần hỗ trợ */}
      <Modal
        title={<Space><AlertOutlined style={{ color: '#fa8c16' }} />Báo cần hỗ trợ</Space>}
        open={helpModalOpen}
        onCancel={() => setHelpModalOpen(false)}
        onOk={() => {
          void do_('help', () => tasksApi.requestHelp(task.id, helpReason));
          setHelpModalOpen(false);
        }}
        okText="Gửi báo cáo"
        okButtonProps={{ style: { background: '#fa8c16', borderColor: '#fa8c16' } }}
        cancelText="Hủy" width={440} zIndex={1050}
      >
        <div style={{ paddingTop: 4 }}>
          <Text style={{ display: 'block', marginBottom: 8 }}>
            Mô tả vướng mắc{' '}
            <Text type="secondary" style={{ fontSize: 12 }}>(@ để đề cập người cần hỗ trợ)</Text>
          </Text>
          <Mentions
            value={helpReason} onChange={setHelpReason}
            onSearch={helpMention.handleSearch} options={helpMention.opts}
            loading={helpMention.loading} filterOption={false}
            autoSize={{ minRows: 3, maxRows: 6 }} autoFocus
            placeholder="VD: @admin máy hỏng, cần kỹ thuật hỗ trợ gấp..."
            maxLength={300}
            style={{ width: '100%' }}
          />
        </div>
      </Modal>

      {/* Modal: Chuyển nhiệm vụ */}
      <Modal
        title={<Space><SwapOutlined style={{ color: '#722ed1' }} />Chuyển nhiệm vụ</Space>}
        open={reassignModalOpen}
        onCancel={() => setReassignModalOpen(false)}
        onOk={() => {
          void do_('reassign', () => tasksApi.reassign(task.id, reassignTo, reassignNote));
          setReassignModalOpen(false);
        }}
        okText="Xác nhận chuyển"
        okButtonProps={{ style: { background: '#722ed1', borderColor: '#722ed1' } }}
        cancelText="Hủy" width={460} zIndex={1050}
      >
        <div style={{ paddingTop: 4 }}>
          {/* Hiển thị tiến độ hiện tại để tham khảo khi chuyển */}
          {task.last_update_note && (
            <div style={{
              background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6,
              padding: '8px 12px', marginBottom: 12, fontSize: 13,
            }}>
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>
                Ghi chú tiến độ hiện tại (sẽ được giữ lại cho người nhận):
              </Text>
              <Text style={{ color: '#389e0d' }}>{task.last_update_note}</Text>
            </div>
          )}
          {task.needs_help && (
            <div style={{
              background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6,
              padding: '8px 12px', marginBottom: 12, fontSize: 13,
            }}>
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>
                Trạng thái hỗ trợ hiện tại (sẽ tự động đặt lại sau khi chuyển):
              </Text>
              <Text style={{ color: '#d46b08' }}>{task.help_reason || 'Đã báo cần hỗ trợ'}</Text>
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <Text style={{ display: 'block', marginBottom: 6 }}>Chuyển sang người</Text>
            {renderAssigneeDirectoryFilters(assigneeDirectory)}
            <Select
              showSearch
              allowClear
              virtual={false}
              placeholder="Chọn người thực hiện mới..."
              style={{ width: '100%' }}
              value={reassignTo ?? undefined}
              onChange={(v) => setReassignTo(v ?? null)}
              filterOption={false}
              onSearch={assigneeDirectory.setSearch}
              options={users.map((u) => ({
                value: u.id,
                label: [
                  getUserDisplayName(u),
                  u.teams?.[0]?.name,
                  u.roles?.[0]?.name ? `(${u.roles[0].name})` : '',
                ].filter(Boolean).join(' - '),
              }))}
            />
          </div>
          <Text style={{ display: 'block', marginBottom: 6 }}>
            Lý do chuyển giao{' '}
            <Text type="secondary" style={{ fontSize: 12 }}>(sẽ ghi vào bình luận · @ để đề cập người liên quan)</Text>
          </Text>
          <Mentions
            value={reassignNote} onChange={setReassignNote}
            onSearch={reassignMention.handleSearch} options={reassignMention.opts}
            loading={reassignMention.loading} filterOption={false}
            autoSize={{ minRows: 2, maxRows: 4 }}
            placeholder="VD: @admin anh A đang bận, chuyển cho anh B xử lý..."
            maxLength={300}
            style={{ width: '100%' }}
          />
        </div>
      </Modal>

      {/* Modal: Ghi chú tiến độ */}
      <Modal
        title={<Space><MessageOutlined style={{ color: '#597ef7' }} />Ghi chú tiến độ</Space>}
        open={noteModalOpen}
        onCancel={() => setNoteModalOpen(false)}
        onOk={() => {
          if (!noteText.trim()) { void message.warning('Vui lòng nhập nội dung ghi chú.'); return; }
          void do_('note', () => tasksApi.addNote(task.id, noteText.trim()));
          setNoteModalOpen(false);
        }}
        okText="Lưu ghi chú"
        okButtonProps={{ style: { background: '#597ef7', borderColor: '#597ef7' } }}
        cancelText="Hủy" width={460} zIndex={1050}
      >
        <div style={{ paddingTop: 4 }}>
          <Text style={{ display: 'block', marginBottom: 8 }}>
            Cập nhật tiến độ{' '}
            <Text type="secondary" style={{ fontSize: 12 }}>(@ để đề cập người liên quan)</Text>
          </Text>
          <Mentions
            value={noteText} onChange={setNoteText}
            onSearch={noteMention.handleSearch} options={noteMention.opts}
            loading={noteMention.loading} filterOption={false}
            autoSize={{ minRows: 3, maxRows: 6 }} autoFocus
            placeholder="VD: @admin đã liên hệ nhà cung cấp, dự kiến xong 28/02..."
            maxLength={500}
            style={{ width: '100%' }}
          />
        </div>
      </Modal>

      {/* Nút mở bình luận & file */}
      <div
        style={{
          marginTop: 10, paddingTop: 8, borderTop: '1px dashed #f0f0f0',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        }}
      >
        <Badge count={hasUnreadActivity ? activityCount : 0} size="small" offset={[2, 2]}>
          <Button
            type="text" size="small"
            icon={<MessageOutlined style={{ color: '#597ef7' }} />}
            onClick={() => {
              onMarkRead(task.id, task.activity_updated_at ?? dayjs().toISOString());
              setDetailOpen(true);
            }}
            style={{ color: '#597ef7', fontSize: 12 }}
          >
            Trao đổi &amp; tệp
          </Button>
        </Badge>
      </div>

      {/* Drawer: chi tiết, bình luận, file đính kèm */}
      <TaskDetailDrawer
        task={task}
        open={detailOpen}
        onClose={() => {
          onMarkRead(task.id, dayjs().toISOString());
          setDetailOpen(false);
          onRefresh();
        }}
      />
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export interface TaskPanelProps {
  entityType: string;
  entityId: number;
  entityCode?: string;
  onTasksChange?: () => void;
}

type TaskPanelSortMode = 'RISK' | 'DUE_ASC' | 'UPDATED_DESC' | 'PRIORITY_DESC';

export default function TaskPanel({ entityType, entityId, entityCode, onTasksChange }: TaskPanelProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);
  const [quickFilter, setQuickFilter] = useState<'ALL' | 'OVERDUE' | 'HELP' | 'BLOCKING' | 'DEPENDENCY'>('ALL');
  const [quickHandleMode, setQuickHandleMode] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const deferredSearchInput = useDeferredValue(searchInput);
  const [sortMode, setSortMode] = useState<TaskPanelSortMode>('RISK');
  const [showClosedTasks, setShowClosedTasks] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [assigneeRoleId, setAssigneeRoleId] = useState<number | undefined>(undefined);
  const [assigneeTeamId, setAssigneeTeamId] = useState<number | undefined>(undefined);
  const [createForm] = Form.useForm<FormValues>();
  const [editForm] = Form.useForm<FormValues>();
  const queryClient = useQueryClient();
  const [taskActivityReadMap, setTaskActivityReadMap] = useState<Record<string, string>>(loadTaskActivityReadMap);
  const resetAssigneeDirectory = useCallback(() => {
    setAssigneeSearch('');
    setAssigneeRoleId(undefined);
    setAssigneeTeamId(undefined);
  }, []);

  const queryKey = useMemo(() => ['tasks', entityType, entityId], [entityType, entityId]);

  const { data: tasks = [], isLoading, refetch } = useQuery({
    queryKey,
    queryFn: () => tasksApi.list({ entity_type: entityType, entity_id: entityId }),
    enabled: !!entityId,
    staleTime: 0,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users-for-task', assigneeSearch, assigneeRoleId ?? null, assigneeTeamId ?? null],
    queryFn: () => usersApi.list({
      search: assigneeSearch.trim() || undefined,
      role: assigneeRoleId,
      team: assigneeTeamId,
      is_active: true,
    }),
    staleTime: 60_000,
  });

  const { data: roleOptions = [] } = useQuery({
    queryKey: ['task-role-options'],
    queryFn: () => usersApi.listRoles(),
    staleTime: 300_000,
  });

  const { data: teamOptions = [] } = useQuery({
    queryKey: ['task-team-options'],
    queryFn: () => usersApi.listTeams(),
    staleTime: 300_000,
  });

  const assigneeDirectory = useMemo<AssigneeDirectoryState>(() => ({
    users,
    roles: roleOptions,
    teams: teamOptions,
    search: assigneeSearch,
    setSearch: setAssigneeSearch,
    roleId: assigneeRoleId,
    setRoleId: setAssigneeRoleId,
    teamId: assigneeTeamId,
    setTeamId: setAssigneeTeamId,
  }), [users, roleOptions, teamOptions, assigneeSearch, assigneeRoleId, assigneeTeamId]);

  const invalidate = useCallback(() => {
    void refetch();
    void queryClient.invalidateQueries({ queryKey: ['products'], refetchType: 'all' });
    onTasksChange?.();
  }, [refetch, queryClient, onTasksChange]);

  const markTaskActivityRead = useCallback((taskId: number, at?: string | null) => {
    const readAt = at || dayjs().toISOString();
    setTaskActivityReadMap((prev) => {
      const next = { ...prev, [String(taskId)]: readAt };
      saveTaskActivityReadMap(next);
      return next;
    });
  }, []);

  // ── Create ──────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: tasksApi.create,
    onSuccess: () => {
      void message.success('Đã tạo nhiệm vụ.');
      createForm.resetFields();
      setShowCreateForm(false);
      invalidate();
    },
    onError: () => { void message.error('Không thể tạo nhiệm vụ, thử lại.'); },
  });

  const handleCreateFinish = (values: FormValues) => {
    const payload: TaskCreatePayload = {
      entity_type: entityType, entity_id: entityId, entity_code: entityCode ?? '',
      title: values.title, description: values.description ?? '',
      assigned_to: values.assigned_to ?? null,
      depends_on: values.depends_on ?? null,
      priority: values.priority ?? 'MEDIUM',
      is_pinned: !!values.is_pinned,
      tags: (values.tags ?? []).map((x) => String(x).trim().toLowerCase()).filter(Boolean),
      is_blocking: values.is_blocking ?? false,
      due_date: values.due_date ? values.due_date.format('YYYY-MM-DD') : null,
    };
    if (payload.is_blocking) {
      void message.warning({ content: `Mã hàng ${entityCode ?? `#${entityId}`} sẽ bị khóa sản xuất. Nếu cần, hãy dùng thao tác "Bỏ chặn" sau đó.`, duration: 4 });
    }
    createMutation.mutate(payload);
  };

  // ── Edit ────────────────────────────────────────────────────────────────────
  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<TaskCreatePayload> }) => tasksApi.update(id, data),
    onSuccess: () => {
      void message.success('Đã lưu thay đổi.');
      setEditingTask(null);
      editForm.resetFields();
      invalidate();
    },
    onError: () => { void message.error('Lưu thất bại, thử lại.'); },
  });

  const openEditModal = (task: TaskItem) => {
    resetAssigneeDirectory();
    setEditingTask(task);
    editForm.setFieldsValue({
      title: task.title, description: task.description,
      assigned_to: task.assigned_to ?? undefined,
      depends_on: task.depends_on ?? undefined,
      priority: task.priority as TaskPriority,
      is_pinned: !!task.is_pinned,
      tags: task.tags ?? [],
      is_blocking: task.is_blocking,
      due_date: task.due_date ? dayjs(task.due_date) : undefined,
    });
  };

  const handleEditFinish = (values: FormValues) => {
    if (!editingTask) return;
    if (!editingTask.is_blocking && values.is_blocking) {
      void message.warning({ content: `Mã hàng ${entityCode ?? `#${entityId}`} sẽ bị khóa sản xuất sau khi lưu.`, duration: 4 });
    }
    editMutation.mutate({
      id: editingTask.id,
      data: {
        title: values.title, description: values.description ?? '',
        assigned_to: values.assigned_to ?? null,
        depends_on: values.depends_on ?? null,
        priority: values.priority, is_blocking: values.is_blocking,
        is_pinned: !!values.is_pinned,
        tags: (values.tags ?? []).map((x) => String(x).trim().toLowerCase()).filter(Boolean),
        due_date: values.due_date ? values.due_date.format('YYYY-MM-DD') : null,
      },
    });
  };

  // ── Derived ─────────────────────────────────────────────────────────────────
  const openTasks = tasks.filter((t) => t.status === 'TODO' || t.status === 'IN_PROGRESS');
  const doneTasks = tasks.filter((t) => t.status === 'DONE' || t.status === 'CANCELLED');
  const blockingCount = openTasks.filter((t) => t.is_blocking).length;
  const helpCount = openTasks.filter((t) => t.needs_help).length;
  const overdueCount = openTasks.filter((t) => t.due_date && dayjs(t.due_date).isBefore(dayjs(), 'day')).length;
  const dependencyBlockedCount = openTasks.filter((t) => t.depends_on_info && t.depends_on_info.status !== 'DONE').length;
  const dueTodayCount = openTasks.filter((t) => t.due_date && dayjs(t.due_date).isSame(dayjs(), 'day')).length;
  const unassignedCount = openTasks.filter((t) => !t.assigned_to).length;
  const hotCount = openTasks.filter((t) => t.priority === 'HIGH' || t.priority === 'URGENT').length;
  const filteredOpenTasks = openTasks.filter((t) => {
    if (quickFilter === 'OVERDUE') return !!(t.due_date && dayjs(t.due_date).isBefore(dayjs(), 'day'));
    if (quickFilter === 'HELP') return !!t.needs_help;
    if (quickFilter === 'BLOCKING') return !!t.is_blocking;
    if (quickFilter === 'DEPENDENCY') return !!(t.depends_on_info && t.depends_on_info.status !== 'DONE');
    return true;
  });
  const searchKeyword = deferredSearchInput.trim().toLowerCase();
  const matchesSearch = useCallback((task: TaskItem) => {
    if (!searchKeyword) return true;
    const haystack = [
      task.title,
      task.description,
      task.assigned_to_info?.full_name,
      task.assigned_by_info?.full_name,
      task.help_reason,
      task.last_update_note,
      task.entity_code,
      ...(task.tags ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(searchKeyword);
  }, [searchKeyword]);
  const compareRisk = useCallback((a: TaskItem, b: TaskItem) => {
    const scoreDiff = getTaskRiskScore(b) - getTaskRiskScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return dayjs(a.created_at).valueOf() - dayjs(b.created_at).valueOf();
  }, []);
  const compareBySortMode = useCallback((a: TaskItem, b: TaskItem) => {
    if (sortMode === 'DUE_ASC') {
      return (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31');
    }
    if (sortMode === 'UPDATED_DESC') {
      return (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || '');
    }
    if (sortMode === 'PRIORITY_DESC') {
      const diff = (TASK_PRIORITY_WEIGHT[b.priority as TaskPriority] ?? 0) - (TASK_PRIORITY_WEIGHT[a.priority as TaskPriority] ?? 0);
      if (diff !== 0) return diff;
    }
    return compareRisk(a, b);
  }, [compareRisk, sortMode]);
  const searchedOpenTasks = filteredOpenTasks.filter(matchesSearch);
  const searchedDoneTasks = doneTasks.filter(matchesSearch);
  const displayOpenTasks = (quickHandleMode ? [...searchedOpenTasks].sort(compareRisk) : [...searchedOpenTasks].sort(compareBySortMode));
  const displayDoneTasks = [...searchedDoneTasks].sort((a, b) => (b.completed_at || b.updated_at || '').localeCompare(a.completed_at || a.updated_at || ''));
  const quickQueueCount = displayOpenTasks.filter((t) => t.is_blocking || t.needs_help || getOverdueDays(t) > 0).length;
  const activeFilterTags: string[] = [];
  const tags = activeFilterTags;
    if (searchKeyword) tags.push(`Từ khóa: ${deferredSearchInput.trim()}`);
    if (quickFilter === 'OVERDUE') tags.push('Đang lọc: Quá hạn');
    if (quickFilter === 'HELP') tags.push('Đang lọc: Cần hỗ trợ');
    if (quickFilter === 'BLOCKING') tags.push('Đang lọc: Đang chặn');
    if (quickFilter === 'DEPENDENCY') tags.push('Đang lọc: Chờ công đoạn trước');
    if (quickHandleMode) tags.push(`Xử lý nhanh: Bật (${quickQueueCount})`);
    if (sortMode === 'DUE_ASC') tags.push('Sắp xếp: Hạn gần nhất');
    if (sortMode === 'UPDATED_DESC') tags.push('Sắp xếp: Cập nhật mới nhất');
    if (sortMode === 'PRIORITY_DESC') tags.push('Sắp xếp: Ưu tiên cao trước');
    if (showClosedTasks) tags.push('Đang hiện nhiệm vụ đã kết thúc');
  

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '0 2px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10,
        }}
      >
        {[
          { label: 'Đang mở', value: openTasks.length, tone: '#1d4ed8' },
          { label: 'Quá hạn', value: overdueCount, tone: '#dc2626' },
          { label: 'Đến hạn hôm nay', value: dueTodayCount, tone: '#d97706' },
          { label: 'Cần hỗ trợ', value: helpCount, tone: '#b45309' },
          { label: 'Chưa giao', value: unassignedCount, tone: '#7c3aed' },
          { label: 'Đã kết thúc', value: doneTasks.length, tone: '#0f766e' },
        ].map((item) => (
          <div key={item.label} style={SUMMARY_TILE_STYLE}>
            <Text type="secondary" style={{ fontSize: 12 }}>{item.label}</Text>
            <div style={{ fontSize: 28, fontWeight: 700, color: item.tone, lineHeight: 1.15, marginTop: 6 }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>

      {(overdueCount > 0 || helpCount > 0 || blockingCount > 0 || dependencyBlockedCount > 0) && (
        <Alert
          showIcon
          type={overdueCount > 0 || blockingCount > 0 ? 'warning' : 'info'}
          message="Đối tượng này đang có nhiệm vụ cần ưu tiên xử lý"
          description={[
            blockingCount > 0 ? `${blockingCount} nhiệm vụ đang chặn luồng sản xuất` : null,
            overdueCount > 0 ? `${overdueCount} nhiệm vụ quá hạn` : null,
            helpCount > 0 ? `${helpCount} nhiệm vụ đang cần hỗ trợ` : null,
            dependencyBlockedCount > 0 ? `${dependencyBlockedCount} nhiệm vụ đang chờ công đoạn trước` : null,
          ].filter(Boolean).join(' · ')}
        />
      )}

      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 18,
          padding: '14px 16px',
          background: '#ffffff',
          boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Space wrap>
            <Text strong style={{ fontSize: 16 }}>Điều phối nhiệm vụ</Text>
            <Tag color="processing" style={{ marginInlineEnd: 0 }}>
              Mã đối tượng: {entityCode || `#${entityId}`}
            </Tag>
            {hotCount > 0 && (
              <Tag color="volcano" style={{ marginInlineEnd: 0 }}>
                Ưu tiên cao/khẩn: {hotCount}
              </Tag>
            )}
          </Space>
          <Space wrap>
            <Button
              onClick={() => {
                setSearchInput('');
                setQuickFilter('ALL');
                setSortMode('RISK');
                setQuickHandleMode(false);
              }}
            >
              Đặt lại bộ lọc
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                resetAssigneeDirectory();
                setShowCreateForm((value) => !value);
              }}
            >
              {showCreateForm ? 'Ẩn biểu mẫu tạo' : 'Tạo nhiệm vụ'}
            </Button>
          </Space>
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Tìm theo tiêu đề, mô tả, người xử lý, nhãn..."
            allowClear
            style={{ width: 300 }}
          />
          <Select<TaskPanelSortMode>
            value={sortMode}
            onChange={setSortMode}
            style={{ width: 200 }}
            options={[
              { value: 'RISK', label: 'Rủi ro cao trước' },
              { value: 'DUE_ASC', label: 'Hạn gần nhất trước' },
              { value: 'UPDATED_DESC', label: 'Cập nhật mới nhất' },
              { value: 'PRIORITY_DESC', label: 'Ưu tiên cao trước' },
            ]}
          />
          <Button onClick={() => setShowClosedTasks((value) => !value)}>
            {showClosedTasks ? 'Ẩn nhiệm vụ đã kết thúc' : `Hiện nhiệm vụ đã kết thúc (${displayDoneTasks.length})`}
          </Button>
          <Tag
            color={quickHandleMode ? 'processing' : 'default'}
            style={{ cursor: 'pointer', marginInlineEnd: 0 }}
            onClick={() => setQuickHandleMode((value) => !value)}
          >
            {quickHandleMode ? `Xử lý nhanh: Bật (${quickQueueCount})` : 'Xử lý nhanh: Tắt'}
          </Tag>
        </div>

        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Tag
            color={quickFilter === 'ALL' ? 'processing' : 'default'}
            style={{ cursor: 'pointer', marginInlineEnd: 0 }}
            onClick={() => setQuickFilter('ALL')}
          >
            Tất cả ({openTasks.length})
          </Tag>
          {overdueCount > 0 && (
            <Tag
              color={quickFilter === 'OVERDUE' ? 'warning' : 'default'}
              style={{ cursor: 'pointer', marginInlineEnd: 0 }}
              onClick={() => setQuickFilter('OVERDUE')}
            >
              Quá hạn ({overdueCount})
            </Tag>
          )}
          {helpCount > 0 && (
            <Tag
              color={quickFilter === 'HELP' ? 'orange' : 'default'}
              style={{ cursor: 'pointer', marginInlineEnd: 0 }}
              onClick={() => setQuickFilter('HELP')}
            >
              Cần hỗ trợ ({helpCount})
            </Tag>
          )}
          {blockingCount > 0 && (
            <Tag
              color={quickFilter === 'BLOCKING' ? 'red' : 'default'}
              style={{ cursor: 'pointer', marginInlineEnd: 0 }}
              onClick={() => setQuickFilter('BLOCKING')}
            >
              Đang chặn ({blockingCount})
            </Tag>
          )}
          {dependencyBlockedCount > 0 && (
            <Tag
              color={quickFilter === 'DEPENDENCY' ? 'gold' : 'default'}
              style={{ cursor: 'pointer', marginInlineEnd: 0 }}
              onClick={() => setQuickFilter('DEPENDENCY')}
            >
              Chờ công đoạn trước ({dependencyBlockedCount})
            </Tag>
          )}
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>
            Hiển thị: {displayOpenTasks.length} nhiệm vụ mở
          </Tag>
        </div>

        {activeFilterTags.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {activeFilterTags.map((item) => (
              <Tag key={item}>{item}</Tag>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 24, color: '#8c8c8c' }}>Đang tải...</div>
      ) : openTasks.length === 0 && doneTasks.length === 0 ? (
        <Empty description="Chưa có nhiệm vụ nào cho đối tượng này" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '12px 0 8px' }} />
      ) : displayOpenTasks.length === 0 && (!showClosedTasks || displayDoneTasks.length === 0) ? (
        <Empty description="Không có nhiệm vụ khớp bộ lọc hiện tại" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '12px 0 8px' }} />
      ) : (
        <>
          {displayOpenTasks.map((t, idx) => (
            <TaskCard
              key={t.id}
              task={t}
              users={users}
              assigneeDirectory={assigneeDirectory}
              onRefresh={invalidate}
              onEdit={openEditModal}
              lastReadAt={taskActivityReadMap[String(t.id)]}
              onMarkRead={markTaskActivityRead}
              queueRank={quickHandleMode ? idx + 1 : undefined}
            />
          ))}
          {doneTasks.length > 0 && showClosedTasks && (
            <div style={{ marginTop: displayOpenTasks.length > 0 ? 8 : 0 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
                {displayDoneTasks.length} nhiệm vụ đã kết thúc
                <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
              </div>
              {displayDoneTasks.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  users={users}
                  assigneeDirectory={assigneeDirectory}
                  onRefresh={invalidate}
                  onEdit={openEditModal}
                  lastReadAt={taskActivityReadMap[String(t.id)]}
                  onMarkRead={markTaskActivityRead}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Create form */}
      {showCreateForm ? (
        <div style={{
          marginTop: 12, background: '#fff', border: '1px solid #d9d9d9',
          borderRadius: 10, padding: '14px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}>
          <div style={{ display: 'block', marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
            <PlusOutlined style={{ marginRight: 6, color: '#1677ff' }} />
            Tạo nhiệm vụ mới
          </div>
          <Form form={createForm} layout="vertical" size="small" onFinish={handleCreateFinish}>
            {renderFormFields(assigneeDirectory, tasks)}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
              <Button size="small" onClick={() => { setShowCreateForm(false); createForm.resetFields(); }}>Hủy</Button>
              <Button size="small" type="primary" htmlType="submit" loading={createMutation.isPending}>
                Tạo nhiệm vụ
              </Button>
            </div>
          </Form>
        </div>
      ) : null}

      {/* Edit Modal */}
      <Modal
        title={<Space><EditOutlined style={{ color: '#1677ff' }} />Chỉnh sửa nhiệm vụ</Space>}
        open={!!editingTask}
        onCancel={() => { setEditingTask(null); editForm.resetFields(); }}
        footer={null} width={520} destroyOnClose zIndex={1050}
      >
        <div style={{ paddingTop: 8 }}>
          <Form form={editForm} layout="vertical" size="small" onFinish={handleEditFinish}>
            {renderFormFields(assigneeDirectory, tasks, editingTask?.id)}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
              <Button size="small" onClick={() => { setEditingTask(null); editForm.resetFields(); }}>Hủy</Button>
              <Button size="small" type="primary" htmlType="submit" loading={editMutation.isPending}>
                Lưu thay đổi
              </Button>
            </div>
          </Form>
        </div>
      </Modal>
    </div>
  );
}

// ─── BlockingTasksBadge ────────────────────────────────────────────────────────

export function BlockingTasksBadge({ count, children }: { count: number; children?: React.ReactNode }) {
  if (!count) return <>{children}</>;
  return (
    <Badge
      count={
        <Tooltip title={`${count} nhiệm vụ chặn đang ảnh hưởng sản xuất`}>
          <LockOutlined style={{ color: '#ff4d4f', fontSize: 11 }} />
        </Tooltip>
      }
      offset={[-2, 2]}
    >
      {children}
    </Badge>
  );
}
