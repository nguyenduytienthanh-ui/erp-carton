import { useMemo, useState } from 'react';
import { Button, Card, Col, Empty, List, Modal, Row, Segmented, Select, Space, Spin, Statistic, Switch, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tasksApi, type TaskItem } from '../../api/tasks';
import { operationsApi, type OperationLogItem } from '../../api/operations';
import { notificationsApi } from '../../api/notifications';
import { usersApi, getUserDisplayName } from '../../api/users';
import { useRealtimePollingInterval } from '../../hooks/useRealtimePollingInterval';

const { Text, Title } = Typography;

type RiskEntityItem = {
  entity_code: string;
  open_tasks: number;
  overdue_tasks: number;
  blocking_tasks: number;
  help_tasks: number;
  urgent_tasks: number;
  owner_hint: string;
  risk_score: number;
};

type WorkloadItem = {
  owner: string;
  total_open: number;
  overdue: number;
  blocking: number;
  urgent: number;
  help: number;
};

type ReportWindow = 'TODAY' | '7D' | '30D';
type ShiftFilter = 'ALL' | 'MORNING' | 'AFTERNOON' | 'NIGHT';
type EscalationPreset = 'LIGHT' | 'STANDARD' | 'STRICT';
type EscalationLevel = 'L1' | 'L2' | 'L3';
type PlaybookApplyScope = 'ALL' | 'L2_PLUS' | 'L3_ONLY';
type BreachReasonCode =
  | 'WAIT_MATERIAL'
  | 'WAIT_DIE'
  | 'MACHINE_DOWN'
  | 'WAIT_APPROVAL'
  | 'STAFF_SHORTAGE'
  | 'WAIT_PREVIOUS_STEP'
  | 'CUSTOMER_CHANGE'
  | 'OTHER';
type ExecutiveActionType =
  | 'PLAYBOOK_APPLY'
  | 'COPY_CHECKLIST'
  | 'BULK_REMIND'
  | 'SINGLE_REMIND'
  | 'EXPORT_REPORT'
  | 'COPY_HANDOVER'
  | 'QUICK_ASSIGN'
  | 'REBALANCE_APPLY';

type ExecutiveActionLogItem = {
  id: string;
  actionType: ExecutiveActionType;
  detail: string;
  relatedCount: number;
  createdAt: string;
};

type ShiftPriorityBucket = 'RED' | 'AMBER' | 'WATCH';

type ShiftPriorityItem = {
  id: number;
  entityCode: string;
  title: string;
  owner: string;
  assignedTo: number | null;
  bucket: ShiftPriorityBucket;
  score: number;
  reason: string;
  escalationLevel: EscalationLevel | '-';
  overdueDays: number;
};

type QuickAssignDuePlan = 'KEEP' | 'TODAY' | 'PLUS_1' | 'PLUS_2';
type QuickAssignBulkTarget = 'RED' | 'AMBER';

type OwnerCapacityItem = {
  userId: number;
  name: string;
  username: string;
  open: number;
  overdue: number;
  blocking: number;
  urgent: number;
  help: number;
  capacityScore: number;
  status: 'AVAILABLE' | 'BALANCED' | 'OVERLOAD';
};

type RebalanceSuggestionItem = {
  taskId: number;
  entityCode: string;
  title: string;
  fromUserId: number | null;
  fromOwner: string;
  toUserId: number;
  toOwner: string;
  bucket: ShiftPriorityBucket;
};

const REPORT_WINDOW_OPTIONS: Array<{ value: ReportWindow; label: string }> = [
  { value: 'TODAY', label: 'Hôm nay' },
  { value: '7D', label: '7 ngày' },
  { value: '30D', label: '30 ngày' },
];

const SHIFT_OPTIONS: Array<{ value: ShiftFilter; label: string }> = [
  { value: 'ALL', label: 'Tất cả ca' },
  { value: 'MORNING', label: 'Ca sáng' },
  { value: 'AFTERNOON', label: 'Ca chiều' },
  { value: 'NIGHT', label: 'Ca đêm' },
];

const PLAYBOOK_SCOPE_OPTIONS: Array<{ value: PlaybookApplyScope; label: string }> = [
  { value: 'ALL', label: 'Áp dụng mọi mức' },
  { value: 'L2_PLUS', label: 'Chỉ L2/L3' },
  { value: 'L3_ONLY', label: 'Chỉ L3' },
];

const ESCALATION_PRESET_CONFIG: Record<
EscalationPreset,
{ label: string; warnHours: number; breachHours: number; level1Hours: number; level2Hours: number; level3Hours: number }
> = {
  LIGHT: { label: 'Nhẹ', warnHours: 24, breachHours: 24, level1Hours: 8, level2Hours: 24, level3Hours: 48 },
  STANDARD: { label: 'Chuẩn 4/8/24', warnHours: 16, breachHours: 16, level1Hours: 4, level2Hours: 8, level3Hours: 24 },
  STRICT: { label: 'Nghiêm ngặt', warnHours: 8, breachHours: 8, level1Hours: 2, level2Hours: 4, level3Hours: 12 },
};

const BREACH_REASON_LABELS: Record<BreachReasonCode, string> = {
  WAIT_MATERIAL: 'Chờ vật tư/giấy/mực',
  WAIT_DIE: 'Chờ khuôn/bế',
  MACHINE_DOWN: 'Máy dừng/sự cố máy',
  WAIT_APPROVAL: 'Chờ duyệt',
  STAFF_SHORTAGE: 'Thiếu nhân lực',
  WAIT_PREVIOUS_STEP: 'Chờ công đoạn trước',
  CUSTOMER_CHANGE: 'Khách đổi/yêu cầu lại',
  OTHER: 'Khác/Chưa rõ',
};

const EXEC_ACTION_LABELS: Record<ExecutiveActionType, string> = {
  PLAYBOOK_APPLY: 'Áp dụng playbook',
  COPY_CHECKLIST: 'Copy checklist',
  BULK_REMIND: 'Nhắc quá hạn hàng loạt',
  SINGLE_REMIND: 'Nhắc quá hạn 1 task',
  EXPORT_REPORT: 'Xuất báo cáo CSV',
  COPY_HANDOVER: 'Copy bàn giao ca',
  QUICK_ASSIGN: 'Giao việc nhanh',
  REBALANCE_APPLY: 'Điều phối cân bằng tải',
};

const SHIFT_BUCKET_LABELS: Record<ShiftPriorityBucket, string> = {
  RED: 'Ưu tiên đỏ',
  AMBER: 'Ưu tiên vàng',
  WATCH: 'Theo dõi',
};

const BREACH_PLAYBOOK_TEMPLATES: Record<
BreachReasonCode,
{ title: string; owner: string; targetSlaHours: number; steps: string[] }
> = {
  WAIT_MATERIAL: {
    title: 'Playbook thiếu vật tư',
    owner: 'Kế hoạch vật tư + Mua hàng',
    targetSlaHours: 4,
    steps: [
      'Xác nhận tồn kho và ETA vật tư trong 30 phút.',
      'Khóa thay đổi lịch máy liên quan để tránh xung đột.',
      'Thông báo tổ in/bế về phương án ưu tiên khi vật tư về.',
    ],
  },
  WAIT_DIE: {
    title: 'Playbook chờ khuôn/bế',
    owner: 'Bộ phận khuôn + Điều độ',
    targetSlaHours: 4,
    steps: [
      'Xác nhận trạng thái khuôn hiện tại và người phụ trách.',
      'Đánh dấu đơn thay thế nếu khuôn chưa sẵn sàng > 2h.',
      'Escalate cho quản đốc nếu vượt mốc cam kết.',
    ],
  },
  MACHINE_DOWN: {
    title: 'Playbook máy dừng',
    owner: 'Bảo trì + Quản đốc xưởng',
    targetSlaHours: 2,
    steps: [
      'Mở ticket bảo trì ngay và ước lượng downtime.',
      'Điều phối đơn khẩn sang máy/line thay thế.',
      'Cập nhật ETA mới cho các đơn bị ảnh hưởng.',
    ],
  },
  WAIT_APPROVAL: {
    title: 'Playbook chờ duyệt',
    owner: 'Kinh doanh + Quản lý duyệt',
    targetSlaHours: 2,
    steps: [
      'Gắn cờ duyệt nhanh cho đơn có SLA đỏ.',
      'Nhắc cấp duyệt qua thông báo ưu tiên cao.',
      'Nếu quá 2h, escalte lên quản lý cấp trên.',
    ],
  },
  STAFF_SHORTAGE: {
    title: 'Playbook thiếu nhân lực',
    owner: 'Tổ trưởng + HR vận hành',
    targetSlaHours: 8,
    steps: [
      'Phân bổ lại tải công việc từ người quá tải.',
      'Tăng cường nhân sự thay ca/tăng cường tạm thời.',
      'Rà soát lại danh sách task ưu tiên bắt buộc trong ca.',
    ],
  },
  WAIT_PREVIOUS_STEP: {
    title: 'Playbook nghẽn công đoạn trước',
    owner: 'Điều độ liên công đoạn',
    targetSlaHours: 4,
    steps: [
      'Xác định công đoạn gốc đang nghẽn.',
      'Đẩy escalation vào task gốc thay vì task ngọn.',
      'Cập nhật lại thứ tự ưu tiên liên công đoạn.',
    ],
  },
  CUSTOMER_CHANGE: {
    title: 'Playbook đổi yêu cầu khách',
    owner: 'Kinh doanh + Kế hoạch',
    targetSlaHours: 6,
    steps: [
      'Khóa phiên bản đơn cũ và xác nhận thay đổi chính thức.',
      'Đánh giá tác động đến khuôn, giấy, lịch máy.',
      'Tái cam kết thời điểm giao mới với khách.',
    ],
  },
  OTHER: {
    title: 'Playbook điều hành chung',
    owner: 'Điều hành trung tâm',
    targetSlaHours: 8,
    steps: [
      'Gán người chịu trách nhiệm chính cho từng case.',
      'Chuẩn hóa nguyên nhân trên task để theo dõi kỳ sau.',
      'Cập nhật checklist xử lý và bài học kinh nghiệm.',
    ],
  },
};

function inferBreachReason(task: TaskItem): BreachReasonCode {
  const raw = `${task.help_reason || ''} ${task.last_update_note || ''} ${task.description || ''} ${(task.tags || []).join(' ')}`.toLowerCase();
  if (task.depends_on_info && task.depends_on_info.status !== 'DONE') return 'WAIT_PREVIOUS_STEP';
  if (raw.includes('giay') || raw.includes('vật tư') || raw.includes('vat tu') || raw.includes('mực') || raw.includes('muc') || raw.includes('nguyen lieu')) {
    return 'WAIT_MATERIAL';
  }
  if (raw.includes('khuon') || raw.includes('khuôn') || raw.includes('be') || raw.includes('bế')) {
    return 'WAIT_DIE';
  }
  if (raw.includes('may') || raw.includes('máy') || raw.includes('hong') || raw.includes('hỏng') || raw.includes('su co') || raw.includes('sự cố')) {
    return 'MACHINE_DOWN';
  }
  if (raw.includes('duyet') || raw.includes('duyệt') || raw.includes('phe duyet') || raw.includes('phê duyệt') || raw.includes('approval')) {
    return 'WAIT_APPROVAL';
  }
  if (raw.includes('thieu nguoi') || raw.includes('thiếu người') || raw.includes('thieu nhan su') || raw.includes('thiếu nhân sự') || raw.includes('qua tai')) {
    return 'STAFF_SHORTAGE';
  }
  if (raw.includes('khach doi') || raw.includes('khách đổi') || raw.includes('doi mau') || raw.includes('đổi mẫu') || raw.includes('yeu cau moi') || raw.includes('yêu cầu mới')) {
    return 'CUSTOMER_CHANGE';
  }
  return 'OTHER';
}

function getShiftByTime(ts: string | null | undefined): ShiftFilter {
  if (!ts) return 'ALL';
  const hour = dayjs(ts).hour();
  if (hour >= 6 && hour < 14) return 'MORNING';
  if (hour >= 14 && hour < 22) return 'AFTERNOON';
  return 'NIGHT';
}

function inReportWindow(ts: string | null | undefined, window: ReportWindow): boolean {
  if (!ts) return false;
  const value = dayjs(ts);
  const now = dayjs();
  if (window === 'TODAY') return value.isSame(now, 'day');
  if (window === '7D') return value.isAfter(now.subtract(7, 'day'));
  return value.isAfter(now.subtract(30, 'day'));
}

function calcRiskScore(tasks: TaskItem[]): number {
  return tasks.reduce((sum, t) => {
    let score = 1;
    if (t.priority === 'HIGH') score += 2;
    if (t.priority === 'URGENT') score += 4;
    if (t.is_blocking) score += 4;
    if (t.needs_help) score += 3;
    if (t.due_date && dayjs(t.due_date).isBefore(dayjs(), 'day')) score += 5;
    return sum + score;
  }, 0);
}

export default function ExecutiveCockpit() {
  const [liveSync, setLiveSync] = useState(true);
  const [reportWindow, setReportWindow] = useState<ReportWindow>('TODAY');
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>('ALL');
  const [escalationPreset, setEscalationPreset] = useState<EscalationPreset>('STANDARD');
  const [playbookScope, setPlaybookScope] = useState<PlaybookApplyScope>('L2_PLUS');
  const [actionLogs, setActionLogs] = useState<ExecutiveActionLogItem[]>([]);
  const [quickAssignTaskId, setQuickAssignTaskId] = useState<number | null>(null);
  const [quickAssignUserId, setQuickAssignUserId] = useState<number | null>(null);
  const [quickAssignDuePlan, setQuickAssignDuePlan] = useState<QuickAssignDuePlan>('KEEP');
  const [quickAssignBulkTarget, setQuickAssignBulkTarget] = useState<QuickAssignBulkTarget | null>(null);
  const [quickAssignBulkUserId, setQuickAssignBulkUserId] = useState<number | null>(null);
  const [quickAssignBulkDuePlan, setQuickAssignBulkDuePlan] = useState<QuickAssignDuePlan>('KEEP');
  const [rebalanceModalOpen, setRebalanceModalOpen] = useState(false);
  const [selectedRebalanceTaskIds, setSelectedRebalanceTaskIds] = useState<number[]>([]);
  const queryClient = useQueryClient();
  const pollingInterval = useRealtimePollingInterval({
    enabled: liveSync,
    activeMs: 20_000,
    hiddenMs: false,
  });

  const openTasksQuery = useQuery({
    queryKey: ['executive-cockpit-open-tasks'],
    queryFn: () =>
      tasksApi.list({
        is_open: true,
        ordering_mode: 'quick_queue',
      }),
    staleTime: 10_000,
    refetchInterval: pollingInterval,
    refetchIntervalInBackground: false,
  });

  const failedOpsQuery = useQuery({
    queryKey: ['executive-cockpit-failed-ops'],
    queryFn: () =>
      operationsApi.list({
        include_all: true,
        success: 'FAILED',
        limit: 30,
      }),
    staleTime: 15_000,
    refetchInterval: pollingInterval,
    refetchIntervalInBackground: false,
  });

  const unreadNotificationsQuery = useQuery({
    queryKey: ['executive-cockpit-unread-count'],
    queryFn: () => notificationsApi.unreadCount(),
    staleTime: 10_000,
    refetchInterval: pollingInterval,
    refetchIntervalInBackground: false,
  });

  const activeUsersQuery = useQuery({
    queryKey: ['executive-cockpit-active-users'],
    queryFn: () => usersApi.list(),
    staleTime: 60_000,
  });

  const taskData = openTasksQuery.data ?? [];
  const failedOps = failedOpsQuery.data?.items ?? [];
  const appendActionLog = (entry: {
    actionType: ExecutiveActionType;
    detail: string;
    relatedCount?: number;
  }) => {
    setActionLogs((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        actionType: entry.actionType,
        detail: entry.detail,
        relatedCount: entry.relatedCount ?? 0,
        createdAt: dayjs().toISOString(),
      },
      ...prev,
    ].slice(0, 30));
  };
  const remindMutation = useMutation({
    mutationFn: (taskId: number) => tasksApi.remindOverdue(taskId),
    onSuccess: (res) => {
      message.success(`Đã gửi ${res.sent_count} thông báo nhắc quá hạn.`);
      appendActionLog({
        actionType: 'SINGLE_REMIND',
        detail: `Nhắc quá hạn 1 task, gửi ${res.sent_count} thông báo.`,
        relatedCount: 1,
      });
      void queryClient.invalidateQueries({ queryKey: ['executive-cockpit-open-tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['executive-cockpit-unread-count'] });
      void queryClient.invalidateQueries({ queryKey: ['header-notifications-unread'] });
    },
    onError: () => {
      message.error('Không thể gửi nhắc quá hạn.');
    },
  });
  const bulkRemindMutation = useMutation({
    mutationFn: (taskIds: number[]) =>
      tasksApi.bulkAction({
        action: 'REMIND_OVERDUE',
        task_ids: taskIds,
      }),
    onSuccess: (res) => {
      message.success(
        `Đã chạy nhắc quá hạn hàng loạt: thành công ${res.success_count}/${res.processed_count}, gửi ${res.reminder_sent_count} thông báo.`
      );
      appendActionLog({
        actionType: 'BULK_REMIND',
        detail: `Nhắc hàng loạt ${res.processed_count} task, thành công ${res.success_count}, gửi ${res.reminder_sent_count} thông báo.`,
        relatedCount: res.processed_count,
      });
      void queryClient.invalidateQueries({ queryKey: ['executive-cockpit-open-tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['executive-cockpit-unread-count'] });
      void queryClient.invalidateQueries({ queryKey: ['header-notifications-unread'] });
      void queryClient.invalidateQueries({ queryKey: ['task-inbox-list'] });
      void queryClient.invalidateQueries({ queryKey: ['task-inbox-summary'] });
    },
    onError: () => {
      message.error('Không thể chạy nhắc quá hạn hàng loạt.');
    },
  });

  const taskSummary = useMemo(() => {
    const overdue = taskData.filter((t) => t.due_date && dayjs(t.due_date).isBefore(dayjs(), 'day')).length;
    const dueToday = taskData.filter((t) => t.due_date && dayjs(t.due_date).isSame(dayjs(), 'day')).length;
    const blocking = taskData.filter((t) => t.is_blocking).length;
    const needHelp = taskData.filter((t) => t.needs_help).length;
    const dependencyBlocked = taskData.filter((t) => t.depends_on_info && t.depends_on_info.status !== 'DONE').length;
    const urgent = taskData.filter((t) => t.priority === 'URGENT').length;
    const staleMoreThan2Days = taskData.filter((t) => dayjs().diff(dayjs(t.updated_at), 'day') >= 2).length;
    return {
      totalOpen: taskData.length,
      overdue,
      dueToday,
      blocking,
      needHelp,
      dependencyBlocked,
      urgent,
      staleMoreThan2Days,
    };
  }, [taskData]);

  const workloadByOwner = useMemo<WorkloadItem[]>(() => {
    const map = new Map<string, WorkloadItem>();
    taskData.forEach((t) => {
      const owner = t.assigned_to_info?.full_name || t.assigned_to_info?.username || 'Chưa giao';
      const current = map.get(owner) ?? {
        owner,
        total_open: 0,
        overdue: 0,
        blocking: 0,
        urgent: 0,
        help: 0,
      };
      current.total_open += 1;
      if (t.is_blocking) current.blocking += 1;
      if (t.needs_help) current.help += 1;
      if (t.priority === 'URGENT') current.urgent += 1;
      if (t.due_date && dayjs(t.due_date).isBefore(dayjs(), 'day')) current.overdue += 1;
      map.set(owner, current);
    });
    return Array.from(map.values()).sort((a, b) => (b.overdue * 10 + b.blocking * 5 + b.total_open) - (a.overdue * 10 + a.blocking * 5 + a.total_open)).slice(0, 10);
  }, [taskData]);

  const topRiskEntities = useMemo<RiskEntityItem[]>(() => {
    const groups = new Map<string, TaskItem[]>();
    taskData.forEach((t) => {
      const key = t.entity_code || `${t.entity_type}#${t.entity_id}`;
      const list = groups.get(key) ?? [];
      list.push(t);
      groups.set(key, list);
    });
    return Array.from(groups.entries())
      .map(([entity_code, tasks]) => {
        const overdueTasks = tasks.filter((t) => t.due_date && dayjs(t.due_date).isBefore(dayjs(), 'day')).length;
        const blockingTasks = tasks.filter((t) => t.is_blocking).length;
        const helpTasks = tasks.filter((t) => t.needs_help).length;
        const urgentTasks = tasks.filter((t) => t.priority === 'URGENT').length;
        return {
          entity_code,
          open_tasks: tasks.length,
          overdue_tasks: overdueTasks,
          blocking_tasks: blockingTasks,
          help_tasks: helpTasks,
          urgent_tasks: urgentTasks,
          owner_hint: tasks.find((x) => x.assigned_to_info)?.assigned_to_info?.full_name || 'Chưa giao',
          risk_score: calcRiskScore(tasks),
        };
      })
      .sort((a, b) => b.risk_score - a.risk_score)
      .slice(0, 12);
  }, [taskData]);

  const escalationCandidates = useMemo<Array<TaskItem & { overdue_days: number; overdue_hours: number; escalation_level: EscalationLevel }>>(() => {
    const preset = ESCALATION_PRESET_CONFIG[escalationPreset];
    return taskData
      .filter((t) => t.due_date && dayjs(t.due_date).isBefore(dayjs(), 'day'))
      .map((t) => ({
        ...t,
        overdue_days: dayjs().startOf('day').diff(dayjs(t.due_date), 'day'),
        overdue_hours: Math.max(0, Math.floor(dayjs().diff(dayjs(t.due_date).endOf('day'), 'hour', true))),
        escalation_level: (
          Math.max(0, Math.floor(dayjs().diff(dayjs(t.due_date).endOf('day'), 'hour', true))) >= preset.level3Hours
            ? 'L3'
            : Math.max(0, Math.floor(dayjs().diff(dayjs(t.due_date).endOf('day'), 'hour', true))) >= preset.level2Hours
              ? 'L2'
              : 'L1'
        ) as EscalationLevel,
      }))
      .sort((a, b) => {
        const pa = (a.priority === 'URGENT' ? 4 : a.priority === 'HIGH' ? 3 : a.priority === 'MEDIUM' ? 2 : 1);
        const pb = (b.priority === 'URGENT' ? 4 : b.priority === 'HIGH' ? 3 : b.priority === 'MEDIUM' ? 2 : 1);
        const levelWeightA = a.escalation_level === 'L3' ? 30 : a.escalation_level === 'L2' ? 20 : 10;
        const levelWeightB = b.escalation_level === 'L3' ? 30 : b.escalation_level === 'L2' ? 20 : 10;
        return (b.overdue_days * 10 + pb * 5 + (b.is_blocking ? 10 : 0) + levelWeightB)
          - (a.overdue_days * 10 + pa * 5 + (a.is_blocking ? 10 : 0) + levelWeightA);
      })
      .slice(0, 12);
  }, [taskData, escalationPreset]);

  const escalationBuckets = useMemo(() => {
    const level1Ids = escalationCandidates.filter((x) => x.escalation_level === 'L1').map((x) => x.id);
    const level2Ids = escalationCandidates.filter((x) => x.escalation_level === 'L2').map((x) => x.id);
    const level3Ids = escalationCandidates.filter((x) => x.escalation_level === 'L3').map((x) => x.id);
    return { level1Ids, level2Ids, level3Ids };
  }, [escalationCandidates]);

  const startShiftPriority = useMemo(() => {
    const now = dayjs();
    const candidates: ShiftPriorityItem[] = taskData
      .filter((task) => {
        const isOverdue = !!task.due_date && dayjs(task.due_date).isBefore(now, 'day');
        const isDueToday = !!task.due_date && dayjs(task.due_date).isSame(now, 'day');
        return isOverdue || isDueToday || task.priority === 'URGENT' || task.is_blocking || task.needs_help;
      })
      .map((task) => {
        const isOverdue = !!task.due_date && dayjs(task.due_date).isBefore(now, 'day');
        const overdueDays = isOverdue ? now.startOf('day').diff(dayjs(task.due_date), 'day') : 0;
        const escalationMatch = escalationCandidates.find((x) => x.id === task.id);
        const escalationLevel: EscalationLevel | '-' = escalationMatch ? escalationMatch.escalation_level : '-';
        const reason = BREACH_REASON_LABELS[inferBreachReason(task)];
        let score = 0;
        if (isOverdue) score += overdueDays * 12;
        if (task.priority === 'URGENT') score += 18;
        else if (task.priority === 'HIGH') score += 12;
        if (task.is_blocking) score += 14;
        if (task.needs_help) score += 8;
        if (task.depends_on_info && task.depends_on_info.status !== 'DONE') score += 7;
        if (escalationLevel === 'L3') score += 20;
        else if (escalationLevel === 'L2') score += 12;
        else if (escalationLevel === 'L1') score += 6;
        const bucket: ShiftPriorityBucket = score >= 40 ? 'RED' : score >= 24 ? 'AMBER' : 'WATCH';
        return {
          id: task.id,
          entityCode: task.entity_code || `#${task.entity_id}`,
          title: task.title,
          owner: task.assigned_to_info?.full_name || task.assigned_to_info?.username || 'Chưa giao',
          assignedTo: task.assigned_to,
          bucket,
          score,
          reason,
          escalationLevel,
          overdueDays,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    return {
      items: candidates,
      redIds: candidates.filter((x) => x.bucket === 'RED').map((x) => x.id),
      amberIds: candidates.filter((x) => x.bucket === 'AMBER').map((x) => x.id),
      watchIds: candidates.filter((x) => x.bucket === 'WATCH').map((x) => x.id),
    };
  }, [taskData, escalationCandidates]);

  const slaHealth = useMemo(() => {
    const preset = ESCALATION_PRESET_CONFIG[escalationPreset];
    let onTrack = 0;
    let warning = 0;
    let breached = 0;
    taskData.forEach((task) => {
      if (!task.due_date) {
        onTrack += 1;
        return;
      }
      const due = dayjs(task.due_date).endOf('day');
      const hoursToDue = due.diff(dayjs(), 'hour', true);
      if (hoursToDue < 0 && Math.abs(hoursToDue) >= preset.breachHours) {
        breached += 1;
      } else if (hoursToDue <= preset.warnHours) {
        warning += 1;
      } else {
        onTrack += 1;
      }
    });
    return {
      onTrack,
      warning,
      breached,
      warnHours: preset.warnHours,
      breachHours: preset.breachHours,
    };
  }, [taskData, escalationPreset]);

  const reportTaskScope = useMemo(() => {
    return taskData.filter((t) => {
      const ts = t.updated_at || t.created_at;
      if (!inReportWindow(ts, reportWindow)) return false;
      if (shiftFilter === 'ALL') return true;
      return getShiftByTime(ts) === shiftFilter;
    });
  }, [taskData, reportWindow, shiftFilter]);

  const reportFailedOpsScope = useMemo(() => {
    return failedOps.filter((op) => {
      if (!inReportWindow(op.created_at, reportWindow)) return false;
      if (shiftFilter === 'ALL') return true;
      return getShiftByTime(op.created_at) === shiftFilter;
    });
  }, [failedOps, reportWindow, shiftFilter]);

  const reportSummary = useMemo(() => {
    const touched = reportTaskScope.length;
    const overdue = reportTaskScope.filter((t) => t.due_date && dayjs(t.due_date).isBefore(dayjs(), 'day')).length;
    const blocking = reportTaskScope.filter((t) => t.is_blocking).length;
    const urgent = reportTaskScope.filter((t) => t.priority === 'URGENT').length;
    const needHelp = reportTaskScope.filter((t) => t.needs_help).length;
    const doneRate = touched > 0
      ? Math.round((reportTaskScope.filter((t) => t.status === 'DONE').length / touched) * 100)
      : 0;
    return {
      touched,
      overdue,
      blocking,
      urgent,
      needHelp,
      failedOps: reportFailedOpsScope.length,
      doneRate,
    };
  }, [reportTaskScope, reportFailedOpsScope.length]);

  const reportTopActions = useMemo(() => {
    const map = new Map<string, number>();
    reportFailedOpsScope.forEach((op) => {
      const key = `${op.source} / ${op.action}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return Array.from(map.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [reportFailedOpsScope]);

  const breachReasonBoard = useMemo(() => {
    const breached = escalationCandidates.filter((item) => item.escalation_level === 'L3' || item.overdue_days >= 2);
      const grouped = new Map<BreachReasonCode, { code: BreachReasonCode; count: number; sampleTasks: Array<TaskItem & { overdue_days: number; escalation_level: EscalationLevel }> }>();
    breached.forEach((task) => {
      const code = inferBreachReason(task);
      const current = grouped.get(code) ?? { code, count: 0, sampleTasks: [] };
      current.count += 1;
      if (current.sampleTasks.length < 5) current.sampleTasks.push(task);
      grouped.set(code, current);
    });
    const summary = Array.from(grouped.values()).sort((a, b) => b.count - a.count);
    return {
      totalBreached: breached.length,
      summary,
      topCases: breached
        .slice()
        .sort((a, b) => (b.overdue_days * 10 + (b.is_blocking ? 10 : 0)) - (a.overdue_days * 10 + (a.is_blocking ? 10 : 0)))
        .slice(0, 8),
    };
  }, [escalationCandidates]);

  const handoverHighlights = useMemo(() => {
    const topEscalations = escalationCandidates.slice(0, 5).map((task, idx) => {
      const owner = task.assigned_to_info?.full_name || task.assigned_to_info?.username || 'Chưa giao';
      const reason = BREACH_REASON_LABELS[inferBreachReason(task)];
      return `${idx + 1}. ${task.entity_code || `#${task.entity_id}`} - ${task.title} | ${task.escalation_level} | trễ ${task.overdue_days} ngày | ${owner} | ${reason}`;
    });
    const topReasons = breachReasonBoard.summary
      .slice(0, 3)
      .map((item) => `${BREACH_REASON_LABELS[item.code]} (${item.count})`);
    return { topEscalations, topReasons };
  }, [escalationCandidates, breachReasonBoard.summary]);

  const ownerCapacityBoard = useMemo(() => {
    const users = activeUsersQuery.data ?? [];
    const map = new Map<number, OwnerCapacityItem>();
    users.forEach((u) => {
      map.set(u.id, {
        userId: u.id,
        name: getUserDisplayName(u),
        username: u.username,
        open: 0,
        overdue: 0,
        blocking: 0,
        urgent: 0,
        help: 0,
        capacityScore: 0,
        status: 'AVAILABLE',
      });
    });

    taskData.forEach((task) => {
      if (task.assigned_to == null) return;
      const current = map.get(task.assigned_to);
      if (!current) return;
      current.open += 1;
      if (task.due_date && dayjs(task.due_date).isBefore(dayjs(), 'day')) current.overdue += 1;
      if (task.is_blocking) current.blocking += 1;
      if (task.priority === 'URGENT') current.urgent += 1;
      if (task.needs_help) current.help += 1;
    });

    const items = Array.from(map.values()).map((item) => {
      const capacityScore =
        item.open + item.overdue * 3 + item.blocking * 4 + item.urgent * 3 + item.help * 2;
      const status: OwnerCapacityItem['status'] =
        capacityScore >= 20 || item.overdue >= 3 || item.blocking >= 3
          ? 'OVERLOAD'
          : capacityScore >= 9
            ? 'BALANCED'
            : 'AVAILABLE';
      return { ...item, capacityScore, status };
    });

    return {
      topOverload: items
        .filter((x) => x.status === 'OVERLOAD')
        .sort((a, b) => b.capacityScore - a.capacityScore)
        .slice(0, 5),
      topAvailable: items
        .filter((x) => x.status === 'AVAILABLE')
        .sort((a, b) => a.capacityScore - b.capacityScore)
        .slice(0, 5),
      topBalanced: items
        .filter((x) => x.status === 'BALANCED')
        .sort((a, b) => a.capacityScore - b.capacityScore)
        .slice(0, 5),
    };
  }, [activeUsersQuery.data, taskData]);

  const rebalanceSuggestions = useMemo<RebalanceSuggestionItem[]>(() => {
    const availableReceivers = [...ownerCapacityBoard.topAvailable, ...ownerCapacityBoard.topBalanced]
      .slice(0, 5);
    const overloadIds = new Set(ownerCapacityBoard.topOverload.map((x) => x.userId));
    if (!availableReceivers.length || !overloadIds.size) return [];

    const candidates = startShiftPriority.items.filter(
      (item) =>
        item.assignedTo != null &&
        overloadIds.has(item.assignedTo) &&
        (item.bucket === 'RED' || item.bucket === 'AMBER')
    );
    if (!candidates.length) return [];

    let cursor = 0;
    return candidates.slice(0, 8).map((task) => {
      const receiver = availableReceivers[cursor % availableReceivers.length];
      cursor += 1;
      return {
        taskId: task.id,
        entityCode: task.entityCode,
        title: task.title,
        fromUserId: task.assignedTo,
        fromOwner: task.owner,
        toUserId: receiver.userId,
        toOwner: receiver.name,
        bucket: task.bucket,
      };
    });
  }, [ownerCapacityBoard.topAvailable, ownerCapacityBoard.topBalanced, ownerCapacityBoard.topOverload, startShiftPriority.items]);

  const selectedRebalanceSuggestions = useMemo(
    () => rebalanceSuggestions.filter((item) => selectedRebalanceTaskIds.includes(item.taskId)),
    [rebalanceSuggestions, selectedRebalanceTaskIds]
  );

  const activePlaybooks = useMemo(() => {
    return breachReasonBoard.summary.slice(0, 4).map((item) => {
      const template = BREACH_PLAYBOOK_TEMPLATES[item.code] ?? BREACH_PLAYBOOK_TEMPLATES.OTHER;
      const relatedTasks = escalationCandidates.filter((task) => inferBreachReason(task) === item.code);
      const level1TaskIds = relatedTasks.filter((task) => task.escalation_level === 'L1').map((task) => task.id);
      const level2TaskIds = relatedTasks.filter((task) => task.escalation_level === 'L2').map((task) => task.id);
      const level3TaskIds = relatedTasks.filter((task) => task.escalation_level === 'L3').map((task) => task.id);
      return {
        reasonCode: item.code,
        reasonLabel: BREACH_REASON_LABELS[item.code],
        caseCount: item.count,
        level1TaskIds,
        level2TaskIds,
        level3TaskIds,
        ...template,
      };
    });
  }, [breachReasonBoard.summary, escalationCandidates]);

  const pickTaskIdsByPlaybookScope = (item: (typeof activePlaybooks)[number]) => {
    if (playbookScope === 'L3_ONLY') return item.level3TaskIds;
    if (playbookScope === 'L2_PLUS') return [...item.level2TaskIds, ...item.level3TaskIds];
    return [...item.level1TaskIds, ...item.level2TaskIds, ...item.level3TaskIds];
  };

  const runBulkRemind = (taskIds: number[], sourceLabel: string) => {
    if (!taskIds.length) {
      message.info(`Không có task phù hợp cho thao tác: ${sourceLabel}.`);
      return;
    }
    appendActionLog({
      actionType: 'BULK_REMIND',
      detail: `${sourceLabel}: yêu cầu nhắc ${taskIds.length} task.`,
      relatedCount: taskIds.length,
    });
    bulkRemindMutation.mutate(taskIds);
  };

  const resolveDueDateByPlan = (plan: QuickAssignDuePlan, currentDueDate: string | null) => {
    if (plan === 'KEEP') return currentDueDate;
    if (plan === 'TODAY') return dayjs().format('YYYY-MM-DD');
    if (plan === 'PLUS_1') return dayjs().add(1, 'day').format('YYYY-MM-DD');
    return dayjs().add(2, 'day').format('YYYY-MM-DD');
  };

  const refreshTaskRelatedQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ['executive-cockpit-open-tasks'] });
    void queryClient.invalidateQueries({ queryKey: ['task-inbox-list'] });
    void queryClient.invalidateQueries({ queryKey: ['task-inbox-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['executive-cockpit-unread-count'] });
    void queryClient.invalidateQueries({ queryKey: ['header-notifications-unread'] });
  };

  const quickAssignMutation = useMutation({
    mutationFn: async (params: { taskId: number; assignedTo: number | null; duePlan: QuickAssignDuePlan }) => {
      const currentTask = taskData.find((t) => t.id === params.taskId);
      if (!currentTask) throw new Error('TASK_NOT_FOUND');

      const nextDueDate = resolveDueDateByPlan(params.duePlan, currentTask.due_date);
      const currentDueDate = currentTask.due_date ? dayjs(currentTask.due_date).format('YYYY-MM-DD') : null;
      const dueChanged = (nextDueDate ?? null) !== (currentDueDate ?? null);
      const assigneeChanged = params.assignedTo !== currentTask.assigned_to;

      if (!assigneeChanged && !dueChanged) {
        return { changed: false, task: currentTask, dueDate: nextDueDate, assignee: params.assignedTo };
      }

      if (assigneeChanged) {
        await tasksApi.reassign(
          params.taskId,
          params.assignedTo,
          `Điều hành giao nhanh từ cockpit (${SHIFT_BUCKET_LABELS[startShiftPriority.items.find((x) => x.id === params.taskId)?.bucket || 'WATCH']})`
        );
      }
      if (dueChanged) {
        await tasksApi.update(params.taskId, { due_date: nextDueDate });
      }
      const latestTask = taskData.find((t) => t.id === params.taskId) ?? currentTask;
      return { changed: true, task: latestTask, dueDate: nextDueDate, assignee: params.assignedTo };
    },
    onSuccess: (res) => {
      if (!res.changed) {
        message.info('Không có thay đổi để lưu.');
        return;
      }
      const assigneeName = activeUsersQuery.data?.find((u) => u.id === res.assignee);
      appendActionLog({
        actionType: 'QUICK_ASSIGN',
        detail: `Giao nhanh task ${res.task.entity_code || `#${res.task.entity_id}`} cho ${assigneeName ? getUserDisplayName(assigneeName) : 'Chưa giao'}; hạn ${res.dueDate || '-'}.`,
        relatedCount: 1,
      });
      message.success('Đã cập nhật giao việc nhanh.');
      setQuickAssignTaskId(null);
      refreshTaskRelatedQueries();
    },
    onError: () => {
      message.error('Không thể giao việc nhanh cho task này.');
    },
  });

  const quickAssignBulkMutation = useMutation({
    mutationFn: async (params: {
      taskIds: number[];
      assignedTo: number | null;
      duePlan: QuickAssignDuePlan;
      targetLabel: string;
    }) => {
      let changedCount = 0;
      for (const taskId of params.taskIds) {
        const currentTask = taskData.find((t) => t.id === taskId);
        if (!currentTask) continue;

        const nextDueDate = resolveDueDateByPlan(params.duePlan, currentTask.due_date);
        const currentDueDate = currentTask.due_date ? dayjs(currentTask.due_date).format('YYYY-MM-DD') : null;
        const dueChanged = (nextDueDate ?? null) !== (currentDueDate ?? null);
        const assigneeChanged = params.assignedTo !== currentTask.assigned_to;
        if (!assigneeChanged && !dueChanged) continue;

        if (assigneeChanged) {
          await tasksApi.reassign(
            taskId,
            params.assignedTo,
            `Điều hành giao nhanh hàng loạt (${params.targetLabel})`
          );
        }
        if (dueChanged) {
          await tasksApi.update(taskId, { due_date: nextDueDate });
        }
        changedCount += 1;
      }
      return { changedCount, requestedCount: params.taskIds.length, targetLabel: params.targetLabel };
    },
    onSuccess: (res) => {
      if (res.changedCount === 0) {
        message.info('Không có thay đổi để lưu cho nhóm đã chọn.');
        return;
      }
      const assigneeName = activeUsersQuery.data?.find((u) => u.id === quickAssignBulkUserId);
      appendActionLog({
        actionType: 'QUICK_ASSIGN',
        detail: `Giao nhanh hàng loạt ${res.targetLabel}: cập nhật ${res.changedCount}/${res.requestedCount} task cho ${assigneeName ? getUserDisplayName(assigneeName) : 'Chưa giao'}; hạn ${quickAssignBulkDuePlan}.`,
        relatedCount: res.changedCount,
      });
      message.success(`Đã cập nhật ${res.changedCount}/${res.requestedCount} task.`);
      setQuickAssignBulkTarget(null);
      refreshTaskRelatedQueries();
    },
    onError: () => {
      message.error('Không thể giao nhanh hàng loạt cho nhóm đã chọn.');
    },
  });

  const rebalanceMutation = useMutation({
    mutationFn: async (items: RebalanceSuggestionItem[]) => {
      let changedCount = 0;
      for (const item of items) {
        const currentTask = taskData.find((t) => t.id === item.taskId);
        if (!currentTask) continue;
        if (currentTask.assigned_to === item.toUserId) continue;
        await tasksApi.reassign(
          item.taskId,
          item.toUserId,
          `Điều phối cân bằng tải từ cockpit (${item.fromOwner} -> ${item.toOwner})`
        );
        changedCount += 1;
      }
      return { changedCount, requestedCount: items.length };
    },
    onSuccess: (res) => {
      if (res.changedCount === 0) {
        message.info('Không có task cần điều phối thêm.');
        return;
      }
      appendActionLog({
        actionType: 'REBALANCE_APPLY',
        detail: `Điều phối cân bằng tải: cập nhật ${res.changedCount}/${res.requestedCount} task theo đề xuất tự động.`,
        relatedCount: res.changedCount,
      });
      message.success(`Đã điều phối ${res.changedCount}/${res.requestedCount} task.`);
      setRebalanceModalOpen(false);
      setSelectedRebalanceTaskIds([]);
      refreshTaskRelatedQueries();
    },
    onError: () => {
      message.error('Không thể áp dụng điều phối cân bằng tải.');
    },
  });

  const openQuickAssignModal = (item: ShiftPriorityItem) => {
    setQuickAssignTaskId(item.id);
    setQuickAssignUserId(item.assignedTo ?? null);
    setQuickAssignDuePlan('KEEP');
  };

  const openQuickAssignBulkModal = (target: QuickAssignBulkTarget) => {
    setQuickAssignBulkTarget(target);
    setQuickAssignBulkUserId(null);
    setQuickAssignBulkDuePlan('KEEP');
  };

  const applyPlaybookQuick = (item: (typeof activePlaybooks)[number]) => {
    const selectedTaskIds = pickTaskIdsByPlaybookScope(item);
    if (!selectedTaskIds.length) {
      message.info(`Không có task phù hợp cho playbook: ${item.reasonLabel}.`);
      return;
    }
    appendActionLog({
      actionType: 'PLAYBOOK_APPLY',
      detail: `${item.title} (${item.reasonLabel}) - scope ${playbookScope}, áp dụng ${Math.min(selectedTaskIds.length, 25)} task.`,
      relatedCount: selectedTaskIds.length,
    });
    runBulkRemind(selectedTaskIds.slice(0, 25), `Playbook ${item.reasonLabel}`);
  };

  const copyPlaybookChecklist = async (item: (typeof activePlaybooks)[number]) => {
    const selectedTaskIds = pickTaskIdsByPlaybookScope(item);
    const content = [
      `${item.title} - ${item.reasonLabel}`,
      `Owner: ${item.owner}`,
      `Scope áp dụng: ${PLAYBOOK_SCOPE_OPTIONS.find((x) => x.value === playbookScope)?.label || playbookScope}`,
      `Task phù hợp: ${selectedTaskIds.length}`,
      `SLA mục tiêu: ${item.targetSlaHours} giờ`,
      'Checklist:',
      ...item.steps.map((step, idx) => `${idx + 1}. ${step}`),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(content);
      message.success('Đã copy checklist playbook.');
      appendActionLog({
        actionType: 'COPY_CHECKLIST',
        detail: `Copy checklist: ${item.title} (${item.reasonLabel}), scope ${playbookScope}.`,
        relatedCount: selectedTaskIds.length,
      });
    } catch {
      message.error('Không thể copy checklist playbook.');
    }
  };

  const exportExecutiveCsv = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines: string[] = [];
    lines.push('SECTION,KEY,VALUE');
    lines.push(`"REPORT","window","${reportWindow}"`);
    lines.push(`"REPORT","shift","${shiftFilter}"`);
    lines.push(`"SUMMARY","touched_tasks","${reportSummary.touched}"`);
    lines.push(`"SUMMARY","overdue_tasks","${reportSummary.overdue}"`);
    lines.push(`"SUMMARY","blocking_tasks","${reportSummary.blocking}"`);
    lines.push(`"SUMMARY","urgent_tasks","${reportSummary.urgent}"`);
    lines.push(`"SUMMARY","need_help_tasks","${reportSummary.needHelp}"`);
    lines.push(`"SUMMARY","failed_operations","${reportSummary.failedOps}"`);
    lines.push(`"SUMMARY","done_rate_percent","${reportSummary.doneRate}"`);
    lines.push('');
    lines.push('TOP_RISK_ENTITY,OPEN,OVERDUE,BLOCKING,HELP,URGENT,RISK_SCORE,OWNER');
    topRiskEntities.forEach((r) => {
      lines.push(
        [
          esc(r.entity_code),
          esc(r.open_tasks),
          esc(r.overdue_tasks),
          esc(r.blocking_tasks),
          esc(r.help_tasks),
          esc(r.urgent_tasks),
          esc(r.risk_score),
          esc(r.owner_hint),
        ].join(',')
      );
    });
    lines.push('');
    lines.push('FAILED_ACTION_GROUP,COUNT');
    reportTopActions.forEach((x) => {
      lines.push([esc(x.key), esc(x.count)].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `executive_report_${reportWindow}_${shiftFilter}_${dayjs().format('YYYYMMDD_HHmmss')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    message.success('Đã xuất báo cáo điều hành CSV.');
    appendActionLog({
      actionType: 'EXPORT_REPORT',
      detail: `Xuất CSV cửa sổ ${reportWindow}, ca ${shiftFilter}.`,
      relatedCount: reportSummary.touched,
    });
  };

  const copyHandoverBrief = async () => {
    const reportWindowLabel = REPORT_WINDOW_OPTIONS.find((x) => x.value === reportWindow)?.label || reportWindow;
    const shiftLabel = SHIFT_OPTIONS.find((x) => x.value === shiftFilter)?.label || shiftFilter;
    const content = [
      `TOM TAT BAN GIAO CA - ${dayjs().format('DD/MM/YYYY HH:mm')}`,
      `Khung bao cao: ${reportWindowLabel} | ${shiftLabel}`,
      `Task mo: ${taskSummary.totalOpen} | Qua han: ${taskSummary.overdue} | Blocking: ${taskSummary.blocking} | Can ho tro: ${taskSummary.needHelp}`,
      `SLA: Xanh ${slaHealth.onTrack} | Vang ${slaHealth.warning} | Do ${slaHealth.breached}`,
      `Nhom nguyen nhan breach chinh: ${handoverHighlights.topReasons.join(', ') || 'Khong co'}`,
      'Top case can ban giao uu tien:',
      ...(handoverHighlights.topEscalations.length > 0 ? handoverHighlights.topEscalations : ['- Khong co case qua han uu tien']),
      'Hanh dong de xuat:',
      '- Xu ly L3 truoc, sau do L2 theo playbook.',
      '- Cap nhat owner + ETA moi ngay trong task.',
      '- Xac nhan dong bo giua dieu do, van hanh va ban hang.',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(content);
      message.success('Da copy tom tat ban giao ca.');
      appendActionLog({
        actionType: 'COPY_HANDOVER',
        detail: `Copy tom tat ban giao (${reportWindow}/${shiftFilter}).`,
        relatedCount: handoverHighlights.topEscalations.length,
      });
    } catch {
      message.error('Khong the copy tom tat ban giao ca.');
    }
  };

  const workloadColumns: ColumnsType<WorkloadItem> = [
    { title: 'Người xử lý', dataIndex: 'owner', key: 'owner' },
    { title: 'Mở', dataIndex: 'total_open', key: 'total_open', width: 70 },
    { title: 'Quá hạn', dataIndex: 'overdue', key: 'overdue', width: 90, render: (v: number) => (v > 0 ? <Tag color="red">{v}</Tag> : <Tag color="green">0</Tag>) },
    { title: 'Blocking', dataIndex: 'blocking', key: 'blocking', width: 90 },
    { title: 'Khẩn', dataIndex: 'urgent', key: 'urgent', width: 80 },
  ];

  const riskColumns: ColumnsType<RiskEntityItem> = [
    { title: 'Mã đối tượng', dataIndex: 'entity_code', key: 'entity_code', width: 140 },
    { title: 'Điểm rủi ro', dataIndex: 'risk_score', key: 'risk_score', width: 110, render: (v: number) => <Tag color={v >= 20 ? 'red' : v >= 10 ? 'gold' : 'blue'}>{v}</Tag> },
    { title: 'Mở', dataIndex: 'open_tasks', key: 'open_tasks', width: 70 },
    { title: 'Quá hạn', dataIndex: 'overdue_tasks', key: 'overdue_tasks', width: 90 },
    { title: 'Blocking', dataIndex: 'blocking_tasks', key: 'blocking_tasks', width: 90 },
    { title: 'Cần hỗ trợ', dataIndex: 'help_tasks', key: 'help_tasks', width: 110 },
    { title: 'Khẩn', dataIndex: 'urgent_tasks', key: 'urgent_tasks', width: 80 },
    { title: 'Người phụ trách', dataIndex: 'owner_hint', key: 'owner_hint' },
  ];

  const isLoading = openTasksQuery.isLoading || failedOpsQuery.isLoading || unreadNotificationsQuery.isLoading;
  const quickAssignTask = useMemo(
    () => (quickAssignTaskId == null ? null : startShiftPriority.items.find((x) => x.id === quickAssignTaskId) ?? null),
    [quickAssignTaskId, startShiftPriority.items]
  );
  const quickAssignCurrentTaskDetail = useMemo(
    () => (quickAssignTaskId == null ? null : taskData.find((x) => x.id === quickAssignTaskId) ?? null),
    [quickAssignTaskId, taskData]
  );
  const quickAssignBulkTaskIds = useMemo(() => {
    if (quickAssignBulkTarget === 'RED') return startShiftPriority.redIds;
    if (quickAssignBulkTarget === 'AMBER') return startShiftPriority.amberIds;
    return [];
  }, [quickAssignBulkTarget, startShiftPriority.redIds, startShiftPriority.amberIds]);
  const quickAssignBulkTargetLabel = quickAssignBulkTarget === 'RED' ? 'nhóm đỏ' : 'nhóm vàng';

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card size="small">
        <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start">
          <div>
            <Title level={4} style={{ margin: 0 }}>Điều hành tổng hợp</Title>
            <Text type="secondary">Giám sát tắc nghẽn, SLA và rủi ro giao việc theo thời gian thực.</Text>
          </div>
          <Space size={8}>
            <Text type="secondary">Đồng bộ realtime</Text>
            <Switch checked={liveSync} onChange={setLiveSync} size="small" />
          </Space>
        </Space>
      </Card>

      <Card size="small">
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <Text strong>Báo cáo ca/ngày</Text>
            <Segmented<ReportWindow>
              value={reportWindow}
              onChange={setReportWindow}
              options={REPORT_WINDOW_OPTIONS}
            />
            <Select<ShiftFilter>
              value={shiftFilter}
              onChange={setShiftFilter}
              options={SHIFT_OPTIONS}
              style={{ width: 160 }}
            />
          </Space>
          <Button onClick={exportExecutiveCsv}>Xuất CSV điều hành</Button>
        </Space>
        <Row gutter={[12, 12]} style={{ marginTop: 10 }}>
          <Col xs={12} md={8} lg={4}><Statistic title="Task cập nhật" value={reportSummary.touched} /></Col>
          <Col xs={12} md={8} lg={4}><Statistic title="Quá hạn" value={reportSummary.overdue} /></Col>
          <Col xs={12} md={8} lg={4}><Statistic title="Blocking" value={reportSummary.blocking} /></Col>
          <Col xs={12} md={8} lg={4}><Statistic title="Khẩn" value={reportSummary.urgent} /></Col>
          <Col xs={12} md={8} lg={4}><Statistic title="Sự cố failed" value={reportSummary.failedOps} /></Col>
          <Col xs={12} md={8} lg={4}><Statistic title="Tỷ lệ DONE (%)" value={reportSummary.doneRate} /></Col>
        </Row>
        {reportTopActions.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Text type="secondary">Nhóm lỗi nổi bật:</Text>
            <Space wrap style={{ marginLeft: 8 }}>
              {reportTopActions.map((item) => (
                <Tag key={item.key} color="volcano">{item.key}: {item.count}</Tag>
              ))}
            </Space>
          </div>
        )}
      </Card>

      <Card size="small">
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <Text strong>SLA & Escalation policy</Text>
            <Segmented<EscalationPreset>
              value={escalationPreset}
              onChange={setEscalationPreset}
              options={[
                { value: 'LIGHT', label: ESCALATION_PRESET_CONFIG.LIGHT.label },
                { value: 'STANDARD', label: ESCALATION_PRESET_CONFIG.STANDARD.label },
                { value: 'STRICT', label: ESCALATION_PRESET_CONFIG.STRICT.label },
              ]}
            />
          </Space>
          <Text type="secondary">
            Cảnh báo trước {slaHealth.warnHours}h, breach từ {slaHealth.breachHours}h quá hạn.
          </Text>
        </Space>
        <Row gutter={[12, 12]} style={{ marginTop: 10 }}>
          <Col xs={8}><Statistic title="SLA xanh" value={slaHealth.onTrack} valueStyle={{ color: '#389e0d' }} /></Col>
          <Col xs={8}><Statistic title="SLA vàng" value={slaHealth.warning} valueStyle={{ color: '#d48806' }} /></Col>
          <Col xs={8}><Statistic title="SLA đỏ" value={slaHealth.breached} valueStyle={{ color: '#cf1322' }} /></Col>
        </Row>
      </Card>

      {isLoading ? (
        <Card size="small"><div style={{ textAlign: 'center', padding: 28 }}><Spin /></div></Card>
      ) : (
        <>
          <Row gutter={[12, 12]}>
            <Col xs={12} md={8} lg={4}><Card size="small"><Statistic title="Task mở" value={taskSummary.totalOpen} /></Card></Col>
            <Col xs={12} md={8} lg={4}><Card size="small"><Statistic title="Quá hạn" value={taskSummary.overdue} valueStyle={{ color: taskSummary.overdue > 0 ? '#cf1322' : undefined }} /></Card></Col>
            <Col xs={12} md={8} lg={4}><Card size="small"><Statistic title="Đến hạn hôm nay" value={taskSummary.dueToday} /></Card></Col>
            <Col xs={12} md={8} lg={4}><Card size="small"><Statistic title="Blocking" value={taskSummary.blocking} valueStyle={{ color: taskSummary.blocking > 0 ? '#cf1322' : undefined }} /></Card></Col>
            <Col xs={12} md={8} lg={4}><Card size="small"><Statistic title="Cần hỗ trợ" value={taskSummary.needHelp} valueStyle={{ color: taskSummary.needHelp > 0 ? '#d48806' : undefined }} /></Card></Col>
            <Col xs={12} md={8} lg={4}><Card size="small"><Statistic title="Thông báo chưa đọc" value={unreadNotificationsQuery.data?.count ?? 0} /></Card></Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24}>
              <Card size="small" title="Playbook phản ứng nhanh theo nguyên nhân">
                <Space wrap style={{ marginBottom: 10 }}>
                  <Text type="secondary">Phạm vi áp dụng nhanh:</Text>
                  <Select<PlaybookApplyScope>
                    value={playbookScope}
                    onChange={setPlaybookScope}
                    options={PLAYBOOK_SCOPE_OPTIONS}
                    style={{ width: 220 }}
                  />
                </Space>
                {activePlaybooks.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có playbook cần kích hoạt." />
                ) : (
                  <List
                    size="small"
                    dataSource={activePlaybooks}
                    renderItem={(item) => (
                      <List.Item
                        actions={[
                          <Button
                            key="run"
                            size="small"
                            type="primary"
                            loading={bulkRemindMutation.isPending}
                            onClick={() => applyPlaybookQuick(item)}
                          >
                            Áp dụng nhanh
                          </Button>,
                          <Button
                            key="copy"
                            size="small"
                            onClick={() => void copyPlaybookChecklist(item)}
                          >
                            Copy checklist
                          </Button>,
                        ]}
                      >
                        <Space direction="vertical" size={2} style={{ width: '100%' }}>
                          <Space wrap>
                            <Tag color="blue">{item.title}</Tag>
                            <Tag>{item.reasonLabel}</Tag>
                            <Tag color="gold">Case: {item.caseCount}</Tag>
                            <Tag color="geekblue">
                              L1/L2/L3: {item.level1TaskIds.length}/{item.level2TaskIds.length}/{item.level3TaskIds.length}
                            </Tag>
                            <Tag color="purple">Owner: {item.owner}</Tag>
                            <Tag color="volcano">SLA mục tiêu: {item.targetSlaHours}h</Tag>
                          </Space>
                          <Text type="secondary">
                            Bước đầu: {item.steps[0]}
                          </Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24}>
              <Card size="small" title="Nhật ký thao tác điều hành gần đây">
                {actionLogs.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có thao tác điều hành trong phiên làm việc này." />
                ) : (
                  <List
                    size="small"
                    dataSource={actionLogs}
                    renderItem={(log) => (
                      <List.Item>
                        <Space direction="vertical" size={0} style={{ width: '100%' }}>
                          <Space wrap>
                            <Tag color="blue">{EXEC_ACTION_LABELS[log.actionType]}</Tag>
                            <Text type="secondary">{dayjs(log.createdAt).format('DD/MM HH:mm:ss')}</Text>
                            <Tag>Liên quan: {log.relatedCount}</Tag>
                          </Space>
                          <Text>{log.detail}</Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24}>
              <Card
                size="small"
                title="Tóm tắt bàn giao ca (copy nhanh)"
                extra={<Button size="small" onClick={() => void copyHandoverBrief()}>Copy bàn giao</Button>}
              >
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <Text>
                    Tổng quan: Task mở {taskSummary.totalOpen}, quá hạn {taskSummary.overdue}, blocking {taskSummary.blocking}, cần hỗ trợ {taskSummary.needHelp}.
                  </Text>
                  <Text type="secondary">
                    SLA: Xanh {slaHealth.onTrack} • Vàng {slaHealth.warning} • Đỏ {slaHealth.breached}
                  </Text>
                  <Text type="secondary">
                    Nguyên nhân breach chính: {handoverHighlights.topReasons.join(', ') || 'Không có'}
                  </Text>
                  <List
                    size="small"
                    header={<Text strong>Top case cần bàn giao ưu tiên</Text>}
                    dataSource={handoverHighlights.topEscalations}
                    locale={{ emptyText: 'Không có case quá hạn ưu tiên.' }}
                    renderItem={(line) => <List.Item>{line}</List.Item>}
                  />
                </Space>
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24}>
              <Card size="small" title="Ưu tiên đầu ca (Top 10 trong 2 giờ đầu)">
                <Space wrap style={{ marginBottom: 10 }}>
                  <Tag color="red">Ưu tiên đỏ: {startShiftPriority.redIds.length}</Tag>
                  <Tag color="gold">Ưu tiên vàng: {startShiftPriority.amberIds.length}</Tag>
                  <Tag color="blue">Theo dõi: {startShiftPriority.watchIds.length}</Tag>
                  <Button
                    size="small"
                    danger
                    disabled={startShiftPriority.redIds.length === 0 || bulkRemindMutation.isPending}
                    loading={bulkRemindMutation.isPending}
                    onClick={() => runBulkRemind(startShiftPriority.redIds, 'Ưu tiên đầu ca - nhóm đỏ')}
                  >
                    Nhắc nhóm đỏ
                  </Button>
                  <Button
                    size="small"
                    disabled={startShiftPriority.amberIds.length === 0 || bulkRemindMutation.isPending}
                    loading={bulkRemindMutation.isPending}
                    onClick={() => runBulkRemind(startShiftPriority.amberIds, 'Ưu tiên đầu ca - nhóm vàng')}
                  >
                    Nhắc nhóm vàng
                  </Button>
                  <Button
                    size="small"
                    disabled={startShiftPriority.redIds.length === 0 || quickAssignBulkMutation.isPending}
                    loading={quickAssignBulkMutation.isPending && quickAssignBulkTarget === 'RED'}
                    onClick={() => openQuickAssignBulkModal('RED')}
                  >
                    Giao nhanh nhóm đỏ
                  </Button>
                  <Button
                    size="small"
                    disabled={startShiftPriority.amberIds.length === 0 || quickAssignBulkMutation.isPending}
                    loading={quickAssignBulkMutation.isPending && quickAssignBulkTarget === 'AMBER'}
                    onClick={() => openQuickAssignBulkModal('AMBER')}
                  >
                    Giao nhanh nhóm vàng
                  </Button>
                  <Button
                    size="small"
                    disabled={rebalanceSuggestions.length === 0 || rebalanceMutation.isPending}
                    loading={rebalanceMutation.isPending}
                    onClick={() => {
                      setSelectedRebalanceTaskIds(rebalanceSuggestions.map((item) => item.taskId));
                      setRebalanceModalOpen(true);
                    }}
                  >
                    Áp dụng điều phối đề xuất
                  </Button>
                  {ownerCapacityBoard.topAvailable[0] && (
                    <Tag color="green">
                      Gợi ý nhận việc: {ownerCapacityBoard.topAvailable[0].name}
                    </Tag>
                  )}
                </Space>
                {startShiftPriority.items.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có task nổi bật cho đầu ca." />
                ) : (
                  <Table<ShiftPriorityItem>
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={startShiftPriority.items}
                    columns={[
                      {
                        title: 'Mã',
                        dataIndex: 'entityCode',
                        key: 'entityCode',
                        width: 130,
                      },
                      {
                        title: 'Nhiệm vụ',
                        dataIndex: 'title',
                        key: 'title',
                        render: (_, r) => (
                          <Space direction="vertical" size={1}>
                            <Text strong>{r.title}</Text>
                            <Text type="secondary">{r.reason}</Text>
                          </Space>
                        ),
                      },
                      {
                        title: 'Người xử lý',
                        dataIndex: 'owner',
                        key: 'owner',
                        width: 170,
                      },
                      {
                        title: 'Nhóm',
                        dataIndex: 'bucket',
                        key: 'bucket',
                        width: 120,
                        render: (bucket: ShiftPriorityBucket) => (
                          <Tag color={bucket === 'RED' ? 'red' : bucket === 'AMBER' ? 'gold' : 'blue'}>
                            {SHIFT_BUCKET_LABELS[bucket]}
                          </Tag>
                        ),
                      },
                      {
                        title: 'Esc',
                        dataIndex: 'escalationLevel',
                        key: 'escalationLevel',
                        width: 80,
                        render: (v: EscalationLevel | '-') => (
                          v === '-' ? <Tag>-</Tag> : <Tag color={v === 'L3' ? 'red' : v === 'L2' ? 'gold' : 'blue'}>{v}</Tag>
                        ),
                      },
                      {
                        title: 'Trễ',
                        dataIndex: 'overdueDays',
                        key: 'overdueDays',
                        width: 80,
                        render: (v: number) => (v > 0 ? <Tag color="volcano">{v} ngày</Tag> : <Tag>0</Tag>),
                      },
                      {
                        title: 'Thao tác',
                        key: 'actions',
                        width: 140,
                        render: (_, r) => (
                          <Button size="small" onClick={() => openQuickAssignModal(r)}>
                            Giao nhanh
                          </Button>
                        ),
                      },
                    ]}
                  />
                )}
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} lg={11}>
              <Card size="small" title="SLA breach reason board">
                {breachReasonBoard.totalBreached === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có nhóm vi phạm SLA nổi bật." />
                ) : (
                  <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <Text type="secondary">Tổng case breach trọng yếu: {breachReasonBoard.totalBreached}</Text>
                    <Space wrap>
                      {breachReasonBoard.summary.map((item) => (
                        <Tag
                          key={item.code}
                          color={item.count >= 5 ? 'red' : item.count >= 3 ? 'volcano' : 'gold'}
                        >
                          {BREACH_REASON_LABELS[item.code]}: {item.count}
                        </Tag>
                      ))}
                    </Space>
                    <List
                      size="small"
                      dataSource={breachReasonBoard.summary.slice(0, 6)}
                      renderItem={(item) => (
                        <List.Item>
                          <Space direction="vertical" size={0} style={{ width: '100%' }}>
                            <Text strong>{BREACH_REASON_LABELS[item.code]}</Text>
                            <Text type="secondary">
                              Ví dụ: {(item.sampleTasks[0]?.entity_code || '-')}, {(item.sampleTasks[0]?.title || '-')}
                            </Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Space>
                )}
              </Card>
            </Col>
            <Col xs={24} lg={13}>
              <Card size="small" title="Case breach nghiêm trọng (ưu tiên xử lý)">
                {breachReasonBoard.topCases.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có case breach nghiêm trọng." />
                ) : (
                  <Table<(TaskItem & { overdue_days: number; escalation_level: EscalationLevel })>
                    rowKey="id"
                    size="small"
                    pagination={{ pageSize: 6, showSizeChanger: false }}
                    dataSource={breachReasonBoard.topCases}
                    columns={[
                      {
                        title: 'Mã',
                        key: 'entity_code',
                        width: 120,
                        render: (_, r) => r.entity_code || `#${r.entity_id}`,
                      },
                      {
                        title: 'Nhiệm vụ',
                        key: 'title',
                        render: (_, r) => (
                          <Space direction="vertical" size={1}>
                            <Text strong>{r.title}</Text>
                            <Text type="secondary">{BREACH_REASON_LABELS[inferBreachReason(r)]}</Text>
                          </Space>
                        ),
                      },
                      {
                        title: 'Trễ',
                        key: 'overdue_days',
                        width: 90,
                        render: (_, r) => <Tag color="red">{r.overdue_days} ngày</Tag>,
                      },
                      {
                        title: 'Mức',
                        key: 'escalation_level',
                        width: 80,
                        render: (_, r) => <Tag color={r.escalation_level === 'L3' ? 'red' : 'gold'}>{r.escalation_level}</Tag>,
                      },
                    ]}
                  />
                )}
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} lg={14}>
              <Card size="small" title="Top rủi ro theo mã hàng/đối tượng">
                {topRiskEntities.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có dữ liệu rủi ro." />
                ) : (
                  <Table<RiskEntityItem>
                    rowKey="entity_code"
                    size="small"
                    columns={riskColumns}
                    dataSource={topRiskEntities}
                    pagination={{ pageSize: 6, showSizeChanger: false }}
                  />
                )}
              </Card>
            </Col>
            <Col xs={24} lg={10}>
              <Card size="small" title="Tải công việc theo người xử lý">
                {workloadByOwner.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có phân công." />
                ) : (
                  <Table<WorkloadItem>
                    rowKey="owner"
                    size="small"
                    columns={workloadColumns}
                    dataSource={workloadByOwner}
                    pagination={false}
                  />
                )}
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} lg={12}>
              <Card size="small" title="Điều phối tải đầu ca - Người có nguy cơ quá tải">
                {ownerCapacityBoard.topOverload.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dấu hiệu quá tải nổi bật." />
                ) : (
                  <List
                    size="small"
                    dataSource={ownerCapacityBoard.topOverload}
                    renderItem={(item) => (
                      <List.Item>
                        <Space direction="vertical" size={1} style={{ width: '100%' }}>
                          <Space wrap>
                            <Tag color="red">{item.name}</Tag>
                            <Tag>Điểm tải: {item.capacityScore}</Tag>
                            <Tag color="volcano">Quá hạn: {item.overdue}</Tag>
                            <Tag color="gold">Blocking: {item.blocking}</Tag>
                          </Space>
                          <Text type="secondary">
                            Mở {item.open} • Khẩn {item.urgent} • Cần hỗ trợ {item.help} - khuyến nghị không giao thêm đầu ca.
                          </Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card size="small" title="Điều phối tải đầu ca - Người sẵn sàng nhận việc">
                {ownerCapacityBoard.topAvailable.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có người sẵn sàng nhận thêm việc." />
                ) : (
                  <List
                    size="small"
                    dataSource={ownerCapacityBoard.topAvailable}
                    renderItem={(item) => (
                      <List.Item>
                        <Space direction="vertical" size={1} style={{ width: '100%' }}>
                          <Space wrap>
                            <Tag color="green">{item.name}</Tag>
                            <Tag color="blue">Điểm tải: {item.capacityScore}</Tag>
                            <Tag>Mở: {item.open}</Tag>
                            <Tag>Quá hạn: {item.overdue}</Tag>
                          </Space>
                          <Text type="secondary">
                            Khuyến nghị ưu tiên nhận task nhóm vàng hoặc task L1/L2 để cân bằng tải.
                          </Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} lg={12}>
              <Card size="small" title="Cảnh báo tiến độ">
                <Space wrap>
                  <Tag color={taskSummary.dependencyBlocked > 0 ? 'gold' : 'green'}>
                    Chờ công đoạn trước: {taskSummary.dependencyBlocked}
                  </Tag>
                  <Tag color={taskSummary.urgent > 0 ? 'red' : 'blue'}>
                    Task khẩn: {taskSummary.urgent}
                  </Tag>
                  <Tag color={taskSummary.staleMoreThan2Days > 0 ? 'volcano' : 'green'}>
                    Không cập nhật {'>='} 2 ngày: {taskSummary.staleMoreThan2Days}
                  </Tag>
                </Space>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card size="small" title="Sự cố vận hành gần nhất">
                {failedOps.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có sự cố thất bại mới." />
                ) : (
                  <List<OperationLogItem>
                    size="small"
                    dataSource={failedOps.slice(0, 8)}
                    renderItem={(item) => (
                      <List.Item>
                        <Space direction="vertical" size={1} style={{ width: '100%' }}>
                          <Space wrap>
                            <Tag color="red">{item.action}</Tag>
                            <Tag>{item.source}</Tag>
                            <Text type="secondary">{item.created_at ? dayjs(item.created_at).format('DD/MM HH:mm:ss') : '-'}</Text>
                          </Space>
                          <Text>{item.message || '-'}</Text>
                          <Text type="secondary">{item.entity_type} • {item.entity_code || `#${item.entity_id}`}</Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24}>
              <Card size="small" title="Danh sách cần escalation (quá hạn ưu tiên)">
                {escalationCandidates.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có task cần escalation." />
                ) : (
                  <Table<(TaskItem & { overdue_days: number })>
                    rowKey="id"
                    size="small"
                    dataSource={escalationCandidates}
                    pagination={{ pageSize: 8, showSizeChanger: false }}
                    columns={[
                      {
                        title: 'Mã',
                        key: 'entity_code',
                        width: 130,
                        render: (_, r) => r.entity_code || `#${r.entity_id}`,
                      },
                      {
                        title: 'Nhiệm vụ',
                        key: 'title',
                        render: (_, r) => (
                          <Space direction="vertical" size={1}>
                            <Text strong>{r.title}</Text>
                            <Space size={6} wrap>
                              {r.is_blocking && <Tag color="red">Blocking</Tag>}
                              {r.needs_help && <Tag color="gold">Cần hỗ trợ</Tag>}
                              <Tag color={r.priority === 'URGENT' ? 'red' : r.priority === 'HIGH' ? 'orange' : 'blue'}>
                                {r.priority_display}
                              </Tag>
                            </Space>
                          </Space>
                        ),
                      },
                      {
                        title: 'Người xử lý',
                        key: 'owner',
                        width: 170,
                        render: (_, r) => r.assigned_to_info?.full_name || r.assigned_to_info?.username || 'Chưa giao',
                      },
                      {
                        title: 'Trễ (ngày)',
                        dataIndex: 'overdue_days',
                        key: 'overdue_days',
                        width: 100,
                        render: (v: number) => <Tag color={v >= 3 ? 'red' : 'volcano'}>{v}</Tag>,
                      },
                      {
                        title: 'Mức',
                        dataIndex: 'escalation_level',
                        key: 'escalation_level',
                        width: 90,
                        render: (v: 'L1' | 'L2' | 'L3') => (
                          <Tag color={v === 'L3' ? 'red' : v === 'L2' ? 'gold' : 'blue'}>{v}</Tag>
                        ),
                      },
                      {
                        title: 'Thao tác',
                        key: 'actions',
                        width: 160,
                        render: (_, r) => (
                          <Button
                            size="small"
                            loading={remindMutation.isPending || bulkRemindMutation.isPending}
                            onClick={() => remindMutation.mutate(r.id)}
                          >
                            Nhắc ngay
                          </Button>
                        ),
                      },
                    ]}
                  />
                )}
                <Space wrap style={{ marginTop: 10 }}>
                  <Button
                    size="small"
                    disabled={escalationBuckets.level1Ids.length === 0 || bulkRemindMutation.isPending}
                    loading={bulkRemindMutation.isPending}
                    onClick={() => runBulkRemind(escalationBuckets.level1Ids, 'Escalation mức L1')}
                  >
                    Nhắc mức L1 ({escalationBuckets.level1Ids.length})
                  </Button>
                  <Button
                    size="small"
                    disabled={escalationBuckets.level2Ids.length === 0 || bulkRemindMutation.isPending}
                    loading={bulkRemindMutation.isPending}
                    onClick={() => runBulkRemind(escalationBuckets.level2Ids, 'Escalation mức L2')}
                  >
                    Nhắc mức L2 ({escalationBuckets.level2Ids.length})
                  </Button>
                  <Button
                    danger
                    size="small"
                    disabled={escalationBuckets.level3Ids.length === 0 || bulkRemindMutation.isPending}
                    loading={bulkRemindMutation.isPending}
                    onClick={() => runBulkRemind(escalationBuckets.level3Ids, 'Escalation mức L3')}
                  >
                    Nhắc mức L3 ({escalationBuckets.level3Ids.length})
                  </Button>
                </Space>
              </Card>
            </Col>
          </Row>
        </>
      )}
      <Modal
        title="Giao việc nhanh từ điều hành"
        open={quickAssignTask != null}
        onCancel={() => setQuickAssignTaskId(null)}
        confirmLoading={quickAssignMutation.isPending}
        onOk={() => {
          if (quickAssignTaskId == null) return;
          quickAssignMutation.mutate({
            taskId: quickAssignTaskId,
            assignedTo: quickAssignUserId,
            duePlan: quickAssignDuePlan,
          });
        }}
        okText="Lưu giao việc"
      >
        {quickAssignTask ? (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Text strong>{quickAssignTask.entityCode} - {quickAssignTask.title}</Text>
            <Text type="secondary">Người hiện tại: {quickAssignTask.owner}</Text>
            <Text type="secondary">
              Hạn hiện tại: {quickAssignCurrentTaskDetail?.due_date ? dayjs(quickAssignCurrentTaskDetail.due_date).format('DD/MM/YYYY') : 'Chưa đặt'}
            </Text>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Text>Chọn người xử lý</Text>
              <Select<number>
                value={quickAssignUserId ?? -1}
                onChange={(v) => setQuickAssignUserId(v === -1 ? null : v)}
                showSearch
                optionFilterProp="label"
                placeholder="Chọn người xử lý"
                style={{ width: '100%' }}
                options={[
                  { value: -1, label: '-- Chưa giao --' },
                  ...(activeUsersQuery.data ?? []).map((u) => ({
                    value: u.id,
                    label: `${getUserDisplayName(u)} (${u.username})`,
                  })),
                ]}
              />
            </Space>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Text>Hạn xử lý</Text>
              <Segmented<QuickAssignDuePlan>
                value={quickAssignDuePlan}
                onChange={setQuickAssignDuePlan}
                options={[
                  { value: 'KEEP', label: 'Giữ hạn' },
                  { value: 'TODAY', label: 'Hôm nay' },
                  { value: 'PLUS_1', label: '+1 ngày' },
                  { value: 'PLUS_2', label: '+2 ngày' },
                ]}
              />
            </Space>
          </Space>
        ) : null}
      </Modal>
      <Modal
        title={`Giao nhanh hàng loạt - ${quickAssignBulkTargetLabel}`}
        open={quickAssignBulkTarget != null}
        onCancel={() => setQuickAssignBulkTarget(null)}
        confirmLoading={quickAssignBulkMutation.isPending}
        onOk={() => {
          if (quickAssignBulkTarget == null || quickAssignBulkTaskIds.length === 0) return;
          quickAssignBulkMutation.mutate({
            taskIds: quickAssignBulkTaskIds,
            assignedTo: quickAssignBulkUserId,
            duePlan: quickAssignBulkDuePlan,
            targetLabel: quickAssignBulkTargetLabel,
          });
        }}
        okText="Lưu hàng loạt"
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Text type="secondary">
            Số task trong nhóm: {quickAssignBulkTaskIds.length}
          </Text>
          {ownerCapacityBoard.topAvailable[0] && (
            <Button
              size="small"
              onClick={() => {
                setQuickAssignBulkUserId(ownerCapacityBoard.topAvailable[0].userId);
                message.info(`Đã chọn gợi ý: ${ownerCapacityBoard.topAvailable[0].name}`);
              }}
            >
              Chọn gợi ý tốt nhất ({ownerCapacityBoard.topAvailable[0].name})
            </Button>
          )}
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Text>Chọn người xử lý</Text>
            <Select<number>
              value={quickAssignBulkUserId ?? -1}
              onChange={(v) => setQuickAssignBulkUserId(v === -1 ? null : v)}
              showSearch
              optionFilterProp="label"
              placeholder="Chọn người xử lý"
              style={{ width: '100%' }}
              options={[
                { value: -1, label: '-- Chưa giao --' },
                ...(activeUsersQuery.data ?? []).map((u) => ({
                  value: u.id,
                  label: `${getUserDisplayName(u)} (${u.username})`,
                })),
              ]}
            />
          </Space>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Text>Hạn xử lý</Text>
            <Segmented<QuickAssignDuePlan>
              value={quickAssignBulkDuePlan}
              onChange={setQuickAssignBulkDuePlan}
              options={[
                { value: 'KEEP', label: 'Giữ hạn' },
                { value: 'TODAY', label: 'Hôm nay' },
                { value: 'PLUS_1', label: '+1 ngày' },
                { value: 'PLUS_2', label: '+2 ngày' },
              ]}
            />
          </Space>
        </Space>
      </Modal>
      <Modal
        title="Điều phối cân bằng tải đề xuất"
        open={rebalanceModalOpen}
        onCancel={() => {
          setRebalanceModalOpen(false);
          setSelectedRebalanceTaskIds([]);
        }}
        confirmLoading={rebalanceMutation.isPending}
        onOk={() => {
          if (selectedRebalanceSuggestions.length === 0) {
            message.info('Vui lòng chọn ít nhất 1 task để điều phối.');
            return;
          }
          rebalanceMutation.mutate(selectedRebalanceSuggestions);
        }}
        okText="Áp dụng điều phối"
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Text type="secondary">
            Đề xuất chuyển việc từ người quá tải sang người sẵn sàng nhận: {rebalanceSuggestions.length} task.
          </Text>
          {rebalanceSuggestions.length > 0 && (
            <Space wrap>
              <Tag color="blue">Đã chọn: {selectedRebalanceSuggestions.length}</Tag>
              <Button
                size="small"
                onClick={() => setSelectedRebalanceTaskIds(rebalanceSuggestions.map((item) => item.taskId))}
              >
                Chọn tất cả
              </Button>
              <Button
                size="small"
                onClick={() =>
                  setSelectedRebalanceTaskIds(
                    rebalanceSuggestions.filter((item) => item.bucket === 'RED').map((item) => item.taskId)
                  )
                }
              >
                Chỉ nhóm đỏ
              </Button>
              <Button
                size="small"
                onClick={() =>
                  setSelectedRebalanceTaskIds(
                    rebalanceSuggestions.filter((item) => item.bucket === 'AMBER').map((item) => item.taskId)
                  )
                }
              >
                Chỉ nhóm vàng
              </Button>
              <Button size="small" onClick={() => setSelectedRebalanceTaskIds([])}>
                Bỏ chọn
              </Button>
            </Space>
          )}
          {rebalanceSuggestions.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có đề xuất phù hợp." />
          ) : (
            <Table<RebalanceSuggestionItem>
              rowKey="taskId"
              size="small"
              pagination={false}
              dataSource={rebalanceSuggestions}
              rowSelection={{
                selectedRowKeys: selectedRebalanceTaskIds,
                onChange: (keys) => setSelectedRebalanceTaskIds(keys.map((k) => Number(k))),
              }}
              columns={[
                {
                  title: 'Mã',
                  dataIndex: 'entityCode',
                  key: 'entityCode',
                  width: 120,
                },
                {
                  title: 'Nhiệm vụ',
                  dataIndex: 'title',
                  key: 'title',
                },
                {
                  title: 'Nhóm',
                  dataIndex: 'bucket',
                  key: 'bucket',
                  width: 90,
                  render: (v: ShiftPriorityBucket) => (
                    <Tag color={v === 'RED' ? 'red' : 'gold'}>{v}</Tag>
                  ),
                },
                {
                  title: 'Từ',
                  dataIndex: 'fromOwner',
                  key: 'fromOwner',
                  width: 130,
                },
                {
                  title: 'Sang',
                  dataIndex: 'toOwner',
                  key: 'toOwner',
                  width: 130,
                },
              ]}
            />
          )}
        </Space>
      </Modal>
    </Space>
  );
}
