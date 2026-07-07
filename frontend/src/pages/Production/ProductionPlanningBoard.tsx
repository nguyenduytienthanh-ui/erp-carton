import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Grid,
  Input,
  InputNumber,
  List,
  Modal,
  Progress,
  Segmented,
  Select,
  Skeleton,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AppstoreOutlined, ArrowDownOutlined, ArrowUpOutlined, CalendarOutlined, CopyOutlined, LinkOutlined, OrderedListOutlined, ReloadOutlined, TableOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { productionApi } from '../../api/production';
import { workflowTaskTemplatesApi } from '../../api/workflowTaskTemplates';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { getToastMessage } from '../../shared/apiError';
import type {
  ProductionCapacityState,
  ProductionOperationHandoverStatus,
  ProductionOperationDependencyState,
  ProductionOperationMaterialReadiness,
  ProductionOperationRiskState,
  ProductionOrderStatus,
  ProductionPlanningBoardResponse,
  ProductionPlanningBucketKey,
  ProductionPlanningCapacityCalendarShift,
  ProductionPlanningCard,
  ProductionPlanningHandoverFilter,
  ProductionPlanningMachineQueue,
  ProductionPlanningPreviewWindow,
  ProductionPlanningRebalanceSummaryItem,
  ProductionPlanningRebalanceSuggestion,
  ProductionPlanningSummary,
  ProductionReadinessIssue,
  ProductionReadyToDispatchStatus,
  ProductionPlanningShiftFilter,
  ProductionMachine,
  ProductionWorkCenter,
} from '../../types/production';
import { canPlanProductionOrders } from '../../utils/authz';
import { PAGES } from '../../utils/constants';
import { downloadCSV } from '../../utils/csvExport';

const { Title, Text } = Typography;

type ViewMode = 'BOARD' | 'LIST';
type ShiftFilter = 'ALL' | ProductionPlanningShiftFilter;
type HandoverFilter = 'ALL' | ProductionPlanningHandoverFilter;
type CapacityFilter = 'ALL' | ProductionCapacityState;
type RiskFilter = 'ALL' | ProductionOperationRiskState;
type MaterialFilter = 'ALL' | ProductionOperationMaterialReadiness;
type DependencyFilter = 'ALL' | ProductionOperationDependencyState;
type BucketFilter = 'ALL' | ProductionPlanningBucketKey;
type OrderStatusFilter = 'ALL' | ProductionOrderStatus;
type DispatchReadinessFilter = 'ALL' | ProductionReadyToDispatchStatus;
type Snapshot = {
  search: string;
  step_code: string;
  planned_date: string;
  delivery_due_date: string;
  planned_shift: ShiftFilter;
  handover_status: HandoverFilter;
  capacity_state: CapacityFilter;
  risk_state: RiskFilter;
  bucket_key: BucketFilter;
  order_status: OrderStatusFilter;
  dispatch_owner: string;
  work_center_code: string;
  machine_code: string;
  customer: string;
  sales_order_code: string;
  finished_product_code: string;
  material_product_code: string;
  material_readiness: MaterialFilter;
  dependency_state: DependencyFilter;
  ready_to_dispatch: DispatchReadinessFilter;
  ready_to_run: boolean;
  needs_attention: boolean;
  has_material_wait: boolean;
  has_previous_wait: boolean;
  view: ViewMode;
};
type NamedPreset = { id: string; name: string; snapshot: Snapshot };
type SavedScenario = {
  id: string;
  name: string;
  suggestion_keys: string[];
  snapshot: Snapshot;
  focus_window_date?: string;
  focus_window_shift?: ShiftFilter;
  queue_key?: string | null;
  updated_at: string;
  summary?: {
    suggestion_count: number;
    total_operations: number;
    over_capacity_delta: number;
    at_limit_delta: number;
    needs_attention_delta: number;
    total_scheduled_hours_delta: string;
  };
};
type DispatchPresetKey = 'DISPATCH_READY' | 'DISPATCH_WARNING' | 'DISPATCH_BLOCKER' | 'READY_TO_RUN' | 'UNASSIGNED_RESOURCE' | 'UNSCHEDULED_SCHEDULE' | 'OVER_CAPACITY' | 'OVERDUE' | 'WAIT_PREVIOUS_STEP';
type DispatchPresetSnapshot = Pick<Snapshot, 'planned_date' | 'planned_shift' | 'capacity_state' | 'risk_state' | 'bucket_key' | 'dependency_state' | 'ready_to_dispatch' | 'ready_to_run' | 'needs_attention' | 'has_material_wait' | 'has_previous_wait' | 'view'>;
type OperationReadinessMeta = {
  label: string;
  color: string;
  reason: string;
  canAdvance: boolean;
};
type BulkFormValues = {
  status?: string;
  planned_date?: dayjs.Dayjs | null;
  planned_shift?: string;
  priority_rank?: number | null;
  dispatch_sequence?: number | null;
  work_center_code?: string;
  work_center_name?: string;
  machine_code?: string;
  machine_name?: string;
  estimated_runtime_hours?: number | null;
  setup_minutes?: number | null;
  block_reason_code?: string;
  block_reason_note?: string;
  note?: string;
};
type QueueSequenceDraft = Record<string, number | null>;
type QueueSequenceDraftState = {
  scopeKey: string;
  values: QueueSequenceDraft;
};
type QueueSequenceRow = {
  key: string;
  card: ProductionPlanningCard;
  sequence: number;
  draftPosition: number;
  cumulativeHours: number;
  draftCumulativeHours: number;
  currentSequence: number;
  nextSequence: number | null;
  isInactive: boolean;
  canSequence: boolean;
  hasChanged: boolean;
};
type PlanningWarningSeverity = 'critical' | 'warning' | 'info';
type PlanningWarningItem = {
  key: string;
  title: string;
  reason: string;
  action: string;
  severity: PlanningWarningSeverity;
  count?: number;
};
type ReadyToDispatchActionItem = {
  key: string;
  title: string;
  action: string;
  severity: ProductionReadyToDispatchStatus;
  count?: number;
};
type PlanningWarningCounts = {
  overCapacityCount?: number;
  atLimitCount?: number;
  overdueCount?: number;
  deliveryRiskCount?: number;
  unassignedResourceCount?: number;
  unscheduledCount?: number;
  dependencyBlockedCount?: number;
  inactiveCount?: number;
};
type SkipFormValues = {
  reason?: string;
};

const riskColor: Record<ProductionOperationRiskState, string> = {
  DONE: 'success',
  UNSCHEDULED: 'default',
  OVERDUE: 'error',
  BLOCKED: 'volcano',
  AT_RISK: 'gold',
  ON_TRACK: 'processing',
};
const readinessColor: Record<ProductionOperationMaterialReadiness, string> = {
  READY: 'success',
  PARTIAL: 'gold',
  WAITING: 'error',
};
const readyToDispatchColor: Record<ProductionReadyToDispatchStatus, string> = {
  READY: 'success',
  WARNING: 'gold',
  BLOCKER: 'error',
};
const readyToDispatchLabel: Record<ProductionReadyToDispatchStatus, string> = {
  READY: 'READY',
  WARNING: 'WARNING',
  BLOCKER: 'BLOCKER',
};
const dependencyColor: Record<ProductionOperationDependencyState, string> = {
  ROOT: 'blue',
  CLEAR: 'success',
  WAIT_PREVIOUS_STEP: 'warning',
};
const handoverColor: Record<ProductionOperationHandoverStatus, string> = {
  ACTIVE: 'processing',
  READY: 'gold',
  ACCEPTED: 'success',
};
const statusColor = {
  PENDING: 'default',
  READY: 'processing',
  IN_PROGRESS: 'gold',
  DONE: 'success',
  SKIPPED: 'magenta',
} as const;
const operationStatusLabel = {
  PENDING: 'Chưa sẵn sàng',
  READY: 'Sẵn sàng',
  IN_PROGRESS: 'Đang làm',
  DONE: 'Hoàn thành',
  SKIPPED: 'Bỏ qua',
} as const;
const executionStateLabel: Record<string, string> = {
  pending: 'Chờ xử lý',
  ready: 'Sẵn sàng thực thi',
  'in-progress': 'Đang thực thi',
  done: 'Đã hoàn thành',
  skipped: 'Đã bỏ qua',
  blocked: 'Đang bị nghẽn',
  handover: 'Đã bàn giao',
};
const executionStateColor: Record<string, string> = {
  pending: 'default',
  ready: 'processing',
  'in-progress': 'gold',
  done: 'success',
  skipped: 'magenta',
  blocked: 'volcano',
  handover: 'cyan',
};
const isInactiveOperationStatus = (status?: string | null) => status === 'DONE' || status === 'SKIPPED';
const DEFAULT_DISPATCH_SEQUENCE = 100;
const DISPATCH_SEQUENCE_STEP = 10;
const EMPTY_QUEUE_SEQUENCE_DRAFT: QueueSequenceDraft = {};
const normalizeDispatchSequenceValue = (value?: string | number | null) => {
  const numberValue = Number(value ?? DEFAULT_DISPATCH_SEQUENCE);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.trunc(numberValue) : DEFAULT_DISPATCH_SEQUENCE;
};
const DEFAULT_SHIFT_FILTER_OPTIONS = [
  { label: 'Tất cả ca', value: 'ALL' },
  { label: 'Sáng', value: 'MORNING' },
  { label: 'Chiều', value: 'AFTERNOON' },
  { label: 'Tối', value: 'EVENING' },
  { label: 'Đêm', value: 'NIGHT' },
  { label: 'Cả ngày', value: 'FULLDAY' },
  { label: 'Chưa xếp ca', value: 'UNASSIGNED' },
];
const DEFAULT_SHIFT_FORM_OPTIONS = [
  { label: 'Chưa xếp ca', value: 'ALL' },
  { label: 'Sáng', value: 'MORNING' },
  { label: 'Chiều', value: 'AFTERNOON' },
  { label: 'Tối', value: 'EVENING' },
  { label: 'Đêm', value: 'NIGHT' },
  { label: 'Cả ngày', value: 'FULLDAY' },
];
const riskOptions = [
  { label: 'Tất cả rủi ro', value: 'ALL' },
  { label: 'Quá hạn', value: 'OVERDUE' },
  { label: 'Đang nghẽn', value: 'BLOCKED' },
  { label: 'Chưa xếp', value: 'UNSCHEDULED' },
  { label: 'Cần ưu tiên', value: 'AT_RISK' },
  { label: 'Đang bám kế hoạch', value: 'ON_TRACK' },
];
const materialOptions = [
  { label: 'Tất cả vật tư', value: 'ALL' },
  { label: 'Sẵn chạy', value: 'READY' },
  { label: 'Thiếu một phần', value: 'PARTIAL' },
  { label: 'Chờ vật tư', value: 'WAITING' },
];
const dependencyOptions = [
  { label: 'Tất cả phụ thuộc', value: 'ALL' },
  { label: 'Công đoạn đầu', value: 'ROOT' },
  { label: 'Không bị chặn', value: 'CLEAR' },
  { label: 'Chờ công đoạn trước', value: 'WAIT_PREVIOUS_STEP' },
];
const readyToDispatchOptions = [
  { label: 'Tất cả ready dispatch', value: 'ALL' },
  { label: 'READY', value: 'READY' },
  { label: 'WARNING', value: 'WARNING' },
  { label: 'BLOCKER', value: 'BLOCKER' },
];
const handoverOptions = [
  { label: 'Tất cả bàn giao', value: 'ALL' },
  { label: 'Đang thao tác', value: 'ACTIVE' },
  { label: 'Sẵn sàng bàn giao', value: 'READY' },
  { label: 'Đã nhận bàn giao', value: 'ACCEPTED' },
  { label: 'Chưa chốt', value: 'NONE' },
];
const capacityOptions = [
  { label: 'Tất cả công suất', value: 'ALL' },
  { label: 'Tải ổn định', value: 'BALANCED' },
  { label: 'Sắp kín tải', value: 'AT_LIMIT' },
  { label: 'Quá tải', value: 'OVER_CAPACITY' },
  { label: 'Chưa gán máy', value: 'UNASSIGNED_MACHINE' },
  { label: 'Chưa gán trung tâm công việc', value: 'UNASSIGNED_WORK_CENTER' },
];
const bucketOptions = [
  { label: 'Tất cả nhóm', value: 'ALL' },
  { label: 'Quá hạn', value: 'OVERDUE' },
  { label: 'Hôm nay', value: 'TODAY' },
  { label: 'Ngày mai', value: 'TOMORROW' },
  { label: 'Sắp tới', value: 'UPCOMING' },
  { label: 'Chưa xếp', value: 'UNSCHEDULED' },
];
const orderStatusOptions = [
  { label: 'Tất cả LSX', value: 'ALL' },
  { label: 'Nháp', value: 'DRAFT' },
  { label: 'Chờ duyệt', value: 'SUBMITTED' },
  { label: 'Đã duyệt', value: 'APPROVED' },
  { label: 'Từ chối', value: 'REJECTED' },
  { label: 'Đã phát lệnh', value: 'RELEASED' },
  { label: 'Đang sản xuất', value: 'IN_PROGRESS' },
  { label: 'Hoàn thành', value: 'COMPLETED' },
  { label: 'Đã hủy', value: 'CANCELLED' },
];
const blockReasonOptions = [
  { label: 'Không khóa', value: '' },
  { label: 'Chờ vật tư', value: 'WAIT_MATERIAL' },
  { label: 'Chờ công đoạn trước', value: 'WAIT_PREVIOUS_STEP' },
  { label: 'Chờ duyệt', value: 'WAIT_APPROVAL' },
  { label: 'Máy dừng', value: 'MACHINE_DOWN' },
  { label: 'Khác', value: 'OTHER' },
];
const dispatchPresetCards: Array<{ key: DispatchPresetKey; title: string; description: string; tone: string }> = [
  {
    key: 'DISPATCH_READY',
    title: 'READY dispatch',
    description: 'Đủ tín hiệu để đưa vào điều độ, chỉ là advisory.',
    tone: '#389e0d',
  },
  {
    key: 'DISPATCH_WARNING',
    title: 'WARNING dispatch',
    description: 'Có cảnh báo vật tư, lịch, công suất hoặc metadata.',
    tone: '#d48806',
  },
  {
    key: 'DISPATCH_BLOCKER',
    title: 'BLOCKER dispatch',
    description: 'Có lỗi readiness hoặc dependency cần xử lý trước.',
    tone: '#cf1322',
  },
  {
    key: 'READY_TO_RUN',
    title: 'Sẵn chạy',
    description: 'Công đoạn đủ điều kiện để đưa vào line.',
    tone: '#1677ff',
  },
  {
    key: 'UNASSIGNED_RESOURCE',
    title: 'Chưa gán máy/tổ',
    description: 'Cần chốt work center hoặc máy trước khi chạy.',
    tone: '#595959',
  },
  {
    key: 'UNSCHEDULED_SCHEDULE',
    title: 'Chưa gán ngày/ca',
    description: 'Cần xếp ngày kế hoạch hoặc ca sản xuất.',
    tone: '#8c8c8c',
  },
  {
    key: 'OVER_CAPACITY',
    title: 'Quá tải',
    description: 'Máy hoặc tổ đang vượt năng lực đã khai báo.',
    tone: '#cf1322',
  },
  {
    key: 'OVERDUE',
    title: 'Trễ',
    description: 'Công đoạn quá hạn hoặc tạo áp lực giao hàng.',
    tone: '#d4380d',
  },
  {
    key: 'WAIT_PREVIOUS_STEP',
    title: 'Chờ công đoạn trước',
    description: 'Bị chặn bởi dependency, không thao tác vượt thứ tự.',
    tone: '#fa8c16',
  },
];

const normalizeShift = (value: string | null): ShiftFilter =>
  value === 'MORNING' || value === 'AFTERNOON' || value === 'EVENING' || value === 'NIGHT' || value === 'FULLDAY' || value === 'UNASSIGNED' ? value : 'ALL';
const normalizeHandover = (value: string | null): HandoverFilter =>
  value === 'ACTIVE' || value === 'READY' || value === 'ACCEPTED' || value === 'NONE' ? value : 'ALL';
const normalizeCapacity = (value: string | null): CapacityFilter =>
  value === 'BALANCED' || value === 'AT_LIMIT' || value === 'OVER_CAPACITY' || value === 'UNASSIGNED_MACHINE' || value === 'UNASSIGNED_WORK_CENTER' ? value : 'ALL';
const normalizeRisk = (value: string | null): RiskFilter =>
  value === 'DONE' || value === 'UNSCHEDULED' || value === 'OVERDUE' || value === 'BLOCKED' || value === 'AT_RISK' || value === 'ON_TRACK' ? value : 'ALL';
const normalizeMaterial = (value: string | null): MaterialFilter =>
  value === 'READY' || value === 'PARTIAL' || value === 'WAITING' ? value : 'ALL';
const normalizeDependency = (value: string | null): DependencyFilter =>
  value === 'ROOT' || value === 'CLEAR' || value === 'WAIT_PREVIOUS_STEP' ? value : 'ALL';
const normalizeReadyToDispatch = (value: string | null): DispatchReadinessFilter =>
  value === 'READY' || value === 'WARNING' || value === 'BLOCKER' ? value : 'ALL';
const normalizeBucket = (value: string | null): BucketFilter =>
  value === 'OVERDUE' || value === 'TODAY' || value === 'TOMORROW' || value === 'UPCOMING' || value === 'UNSCHEDULED' ? value : 'ALL';
const normalizeOrderStatus = (value: string | null): OrderStatusFilter =>
  value === 'DRAFT' || value === 'SUBMITTED' || value === 'APPROVED' || value === 'REJECTED' || value === 'RELEASED' || value === 'IN_PROGRESS' || value === 'COMPLETED' || value === 'CANCELLED'
    ? value
    : 'ALL';
const buildWindowKey = (plannedDate?: string | null, shiftKey?: string | null) => `${plannedDate || 'UNSCHEDULED'}|${shiftKey || 'UNASSIGNED'}`;
const buildPlannerUrl = (params: Record<string, string | number | boolean | null | undefined>) => {
  const next = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '' || value === false) {
      return;
    }
    next.set(key, typeof value === 'boolean' ? '1' : String(value));
  });
  return `/production-planning${next.toString() ? `?${next.toString()}` : ''}`;
};

const buildSnapshotFromParams = (params: URLSearchParams): Snapshot => ({
  search: params.get('q') || params.get('search') || '',
  step_code: params.get('step_code') || '',
  planned_date: params.get('planned_date') || '',
  delivery_due_date: params.get('delivery_due_date') || '',
  planned_shift: normalizeShift(params.get('planned_shift')),
  handover_status: normalizeHandover(params.get('handover_status')),
  capacity_state: normalizeCapacity(params.get('capacity_state')),
  risk_state: normalizeRisk(params.get('risk_state')),
  bucket_key: normalizeBucket(params.get('bucket_key')),
  order_status: normalizeOrderStatus(params.get('order_status')),
  dispatch_owner: params.get('dispatch_owner') || '',
  work_center_code: params.get('work_center_code') || '',
  machine_code: params.get('machine_code') || '',
  customer: params.get('customer') || '',
  sales_order_code: params.get('sales_order_code') || '',
  finished_product_code: params.get('finished_product_code') || '',
  material_product_code: params.get('material_product_code') || '',
  material_readiness: normalizeMaterial(params.get('material_readiness')),
  dependency_state: normalizeDependency(params.get('dependency_state')),
  ready_to_dispatch: normalizeReadyToDispatch(params.get('ready_to_dispatch')),
  ready_to_run: params.get('ready_to_run') === '1',
  needs_attention: params.get('needs_attention') === '1',
  has_material_wait: params.get('has_material_wait') === '1',
  has_previous_wait: params.get('has_previous_wait') === '1',
  view: params.get('view') === 'LIST' ? 'LIST' : 'BOARD',
});

const formatDate = (value?: string | null) => (value ? dayjs(value).format('DD/MM/YYYY') : '--');
const formatDateTime = (value?: string | null) => (value ? dayjs(value).format('DD/MM/YYYY HH:mm') : '--');
const formatQty = (value?: string | number | null) => Number(value ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const formatHours = (value?: string | number | null) => `${Number(value ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}h`;
const flatCards = (workspace?: ProductionPlanningBoardResponse) => workspace?.lanes.flatMap((lane) => lane.buckets.flatMap((bucket) => bucket.cards)) ?? [];
const normalizeResourceCode = (value?: string | null) => String(value || '').trim().toUpperCase();
const buildWorkCenterLabel = (workCenter: ProductionWorkCenter) => `${workCenter.code} · ${workCenter.name || 'Chưa đặt tên'} · ${formatHours(workCenter.default_capacity_hours)}`;
const buildMachineLabel = (machine: ProductionMachine) => `${machine.code} · ${machine.name || 'Chưa đặt tên'} · ${machine.work_center_code} · ${formatHours(machine.default_capacity_hours)}`;
const buildLegacyResourceLabel = (code?: string | null, name?: string | null) => {
  const normalizedCode = String(code || '').trim();
  const normalizedName = String(name || '').trim();
  if (!normalizedCode) {
    return '';
  }
  return `${normalizedCode}${normalizedName ? ` · ${normalizedName}` : ''} · Ngoài danh mục`;
};
const sortResourceOptions = <T extends { code: string; name?: string; sort_order?: number }>(items: T[]) => [...items].sort((left, right) => (
  Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0)
  || String(left.name || '').localeCompare(String(right.name || ''), 'vi')
  || String(left.code || '').localeCompare(String(right.code || ''), 'vi')
));
const getOperationProgressPercent = (card: ProductionPlanningCard) => {
  const plannedQty = Number(card.operation.planned_qty || 0);
  if (!plannedQty) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((Number(card.operation.completed_qty || 0) / plannedQty) * 100)));
};
const formatDaysToDelivery = (value?: number | null) => {
  if (value === null || value === undefined) {
    return 'Không có ETA giao';
  }
  if (value < 0) {
    return `Trễ hạn giao ${Math.abs(value)} ngày`;
  }
  if (value === 0) {
    return 'Giao hôm nay';
  }
  return `Còn ${value} ngày tới hạn giao`;
};
const formatDeliveryGap = (value?: number | null) => {
  if (value === null || value === undefined) {
    return 'Chưa có khoảng đệm đến hạn giao';
  }
  if (value < 0) {
    return `Trễ ${Math.abs(value)} ngày so với hạn giao`;
  }
  if (value === 0) {
    return 'Sát hạn giao';
  }
  return `Còn đệm ${value} ngày trước hạn giao`;
};
const getHandoverColor = (value?: ProductionOperationHandoverStatus | '') => (value ? handoverColor[value as ProductionOperationHandoverStatus] : 'default');
const getExecutionHandoff = (card: ProductionPlanningCard): NonNullable<ProductionPlanningCard['execution_handoff']> => (
  card.execution_handoff || card.operation.execution_handoff || {}
);
const getExecutionState = (card: ProductionPlanningCard) => {
  const handoff = getExecutionHandoff(card);
  const explicitState = String(handoff.state || '').trim().toLowerCase();
  if (explicitState) {
    return explicitState;
  }
  if (String(handoff.block_reason_code || card.operation.block_reason_code || '').trim()) {
    return 'blocked';
  }
  if (card.operation.status === 'DONE') {
    return 'done';
  }
  if (card.operation.status === 'SKIPPED') {
    return 'skipped';
  }
  if (card.shop_floor.handover_status || handoff.handover_status) {
    return 'handover';
  }
  if (card.operation.status === 'IN_PROGRESS') {
    return 'in-progress';
  }
  if (card.operation.status === 'READY') {
    return 'ready';
  }
  return 'pending';
};
const getExecutionStateLabel = (card: ProductionPlanningCard) => {
  const handoff = getExecutionHandoff(card);
  const state = getExecutionState(card);
  return handoff.state_label || handoff.status_label || executionStateLabel[state] || state;
};
const getExecutionStateColor = (state: string) => executionStateColor[state] || 'default';
const getExecutionLastAction = (card: ProductionPlanningCard) => {
  const handoff = getExecutionHandoff(card);
  const action = String(handoff.last_action_label || card.shop_floor.last_action_label || handoff.last_action || card.shop_floor.last_action || '').trim();
  const actor = String(handoff.last_actor || card.shop_floor.last_actor || '').trim();
  const at = handoff.last_at || card.shop_floor.last_at || null;
  const note = String(handoff.last_note || card.shop_floor.last_note || '').trim();
  const auditAvailable = Boolean(
    handoff.audit_available
    || card.shop_floor.audit_available
    || action
    || actor
    || at
    || note,
  );
  return {
    action: action || 'Chưa có thao tác audit gần nhất',
    actor: actor || 'Chưa rõ người thao tác',
    at,
    note,
    auditAvailable,
  };
};
const renderExecutionHandoffTag = (card: ProductionPlanningCard) => {
  const state = getExecutionState(card);
  const testState = state.replace(/[^a-z0-9-]/gi, '-');
  return (
    <Tooltip title="Payload execution_handoff chỉ phục vụ theo dõi/audit, không chặn workflow.">
      <Tag color={getExecutionStateColor(state)} data-testid={`production-planning-execution-state-${testState}`}>
        {getExecutionStateLabel(card)}
      </Tag>
    </Tooltip>
  );
};
const renderExecutionAuditSummary = (card: ProductionPlanningCard, compact = false) => {
  const handoff = getExecutionHandoff(card);
  const lastAction = getExecutionLastAction(card);
  return (
    <Space
      direction="vertical"
      size={compact ? 2 : 4}
      data-testid={`production-planning-execution-audit-${card.operation.id}`}
      style={{ width: '100%' }}
    >
      <Space wrap size={4}>
        {renderExecutionHandoffTag(card)}
        {handoff.advisory_only || handoff.workflow_blocking === false ? <Tag color="default">Chỉ cảnh báo</Tag> : null}
      </Space>
      {lastAction.auditAvailable ? (
        <Space direction="vertical" size={0} style={{ width: '100%' }}>
          <Text type="secondary">{`Thao tác: ${lastAction.action}`}</Text>
          <Text type="secondary">{`Người: ${lastAction.actor} · Lúc: ${formatDateTime(lastAction.at)}`}</Text>
        </Space>
      ) : (
        <Text type="secondary">Chưa có audit thao tác gần nhất</Text>
      )}
      {!compact && lastAction.note ? <Text type="secondary">{lastAction.note}</Text> : null}
    </Space>
  );
};
const renderExecutionHandoffDetails = (card: ProductionPlanningCard) => {
  const handoff = getExecutionHandoff(card);
  const lastAction = getExecutionLastAction(card);
  const handoverStatus = handoff.handover_status_label || card.shop_floor.handover_status_label || 'Chưa chốt';
  const handoverReceiver = handoff.handover_receiver || card.shop_floor.handover_receiver || 'Chưa có người nhận';
  const handoverAt = handoff.handover_at || card.shop_floor.handover_at || null;
  const handoverNote = handoff.handover_note || card.shop_floor.handover_note || '';
  const blockReason = handoff.block_reason_label || card.operation.block_reason_label || card.exceptions.block_reason_label || 'Không có';
  const blockNote = handoff.block_reason_note || card.operation.block_reason_note || card.exceptions.block_reason_note || '';
  const skipReason = handoff.skip_reason || card.operation.skip_reason || '';
  const skippedAt = handoff.skipped_at || card.operation.skipped_at || null;
  const skippedBy = handoff.skipped_by_display || card.operation.skipped_by_display || '';
  return (
    <Card size="small" title="Audit thao tác sàn máy / bàn giao" data-testid="production-planning-execution-handoff-detail">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap>
          {renderExecutionHandoffTag(card)}
          <Tag color="default">Chỉ cảnh báo, không chặn workflow</Tag>
          {handoff.audit_available ?? card.shop_floor.audit_available ? <Tag color="blue">Có audit</Tag> : <Tag>Chưa có audit</Tag>}
        </Space>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div><strong>Trạng thái:</strong> {`${getExecutionStateLabel(card)} · ${operationStatusLabel[card.operation.status]}`}</div>
          <div><strong>Người phụ trách:</strong> {handoff.dispatch_owner || card.shop_floor.dispatch_owner || 'Chưa gán'}</div>
          <div><strong>Bàn giao:</strong> {`${handoverStatus} · ${handoverReceiver} · ${formatDateTime(handoverAt)}`}</div>
          <div><strong>Lý do nghẽn:</strong> {blockReason}</div>
          <div><strong>Bỏ qua:</strong> {skipReason ? `${skipReason} · ${skippedBy || 'Không rõ'} · ${formatDateTime(skippedAt)}` : 'Không bỏ qua'}</div>
          <div><strong>Thao tác gần nhất:</strong> {lastAction.action}</div>
          <div><strong>Người thao tác:</strong> {lastAction.actor}</div>
          <div><strong>Thời điểm:</strong> {formatDateTime(lastAction.at)}</div>
        </div>
        {lastAction.note ? <Alert type="info" showIcon message="Ghi chú thao tác gần nhất" description={lastAction.note} /> : null}
        {handoverNote ? <Text type="secondary">{`Ghi chú bàn giao: ${handoverNote}`}</Text> : null}
        {blockNote ? <Text type="secondary">{`Ghi chú nghẽn: ${blockNote}`}</Text> : null}
      </Space>
    </Card>
  );
};
const getCapacityColor = (value?: ProductionCapacityState | '') => {
  if (value === 'OVER_CAPACITY') return 'error';
  if (value === 'AT_LIMIT') return 'gold';
  if (value === 'UNASSIGNED_MACHINE' || value === 'UNASSIGNED_WORK_CENTER') return 'default';
  return 'processing';
};
const isDependencyBlocked = (card: ProductionPlanningCard) => (
  card.exceptions.dependency_state === 'WAIT_PREVIOUS_STEP'
  || card.operation.dependency_state === 'WAIT_PREVIOUS_STEP'
);
const canAdvanceOperation = (card: ProductionPlanningCard) => (
  !isDependencyBlocked(card)
  && !['DONE', 'SKIPPED'].includes(card.operation.status)
);
const isAdvancingStatus = (value?: unknown) => ['READY', 'IN_PROGRESS', 'DONE', 'SKIPPED'].includes(String(value || '').toUpperCase());
const isStatusChangeBlockedByDependency = (card: ProductionPlanningCard, status?: unknown) => (
  isDependencyBlocked(card)
  && isAdvancingStatus(status)
  && String(status || '').toUpperCase() !== card.operation.status
);
const getBlockedStatusChangeCount = (cards: ProductionPlanningCard[], status?: unknown) => (
  cards.filter((card) => isStatusChangeBlockedByDependency(card, status)).length
);
const getOperationReadinessMeta = (card: ProductionPlanningCard): OperationReadinessMeta => {
  if (card.operation.status === 'DONE') {
    return { label: 'Hoàn thành', color: 'success', reason: 'Công đoạn đã hoàn thành.', canAdvance: false };
  }
  if (card.operation.status === 'SKIPPED') {
    return { label: 'Bỏ qua', color: 'magenta', reason: 'Công đoạn đã được bỏ qua.', canAdvance: false };
  }
  if (card.operation.status === 'IN_PROGRESS') {
    return { label: 'Đang làm', color: 'gold', reason: 'Công đoạn đang được thực hiện.', canAdvance: true };
  }
  if (card.operation.status === 'READY') {
    return { label: 'Sẵn sàng', color: 'processing', reason: 'Công đoạn đã sẵn sàng để bắt đầu.', canAdvance: true };
  }
  if (isDependencyBlocked(card)) {
    const previousStep = card.operation.previous_step_name || card.operation.previous_step_code || 'công đoạn trước';
    return {
      label: 'Chờ công đoạn trước',
      color: 'warning',
      reason: `Cần hoàn thành ${previousStep} trước khi bắt đầu công đoạn này.`,
      canAdvance: false,
    };
  }
  return {
    label: 'Chưa sẵn sàng',
    color: 'default',
    reason: 'Công đoạn chưa được mở để bắt đầu.',
    canAdvance: canAdvanceOperation(card),
  };
};
const isReadyToDispatchStatus = (value?: string | null): value is ProductionReadyToDispatchStatus => (
  value === 'READY' || value === 'WARNING' || value === 'BLOCKER'
);
const getProductReadinessStatus = (card: ProductionPlanningCard): ProductionReadyToDispatchStatus | null => {
  const status = String((card.product_readiness as { status?: string } | undefined)?.status || '').trim().toUpperCase();
  return isReadyToDispatchStatus(status) ? status : null;
};
const getReadyToDispatchStatus = (card: ProductionPlanningCard): ProductionReadyToDispatchStatus => {
  const status = String(card.ready_to_dispatch?.status || '').trim().toUpperCase();
  if (isReadyToDispatchStatus(status)) {
    return status;
  }
  if (isInactiveOperationStatus(card.operation.status) || isDependencyBlocked(card) || String(card.operation.block_reason_code || '').trim()) {
    return 'BLOCKER';
  }
  if (
    getProductReadinessStatus(card) === 'WARNING'
    || card.materials.material_readiness !== 'READY'
    || !card.operation.planned_date
    || !String(card.operation.planned_shift || '').trim()
    || card.capacity.capacity_state !== 'BALANCED'
  ) {
    return 'WARNING';
  }
  return 'READY';
};
const buildFallbackReadyToDispatchIssues = (card: ProductionPlanningCard) => {
  const issues: NonNullable<ProductionPlanningCard['ready_to_dispatch']>['issues'] = [];
  const addIssue = (code: string, severity: ProductionReadyToDispatchStatus, category: string, message: string) => {
    issues.push({ code, severity, category, message, workflow_blocking: false, details: {} });
  };
  const productStatus = getProductReadinessStatus(card);
  if (productStatus === 'BLOCKER') {
    addIssue('PRODUCT_READINESS_BLOCKER', 'BLOCKER', 'product', 'Product/routing readiness đang có lỗi chặn.');
  } else if (productStatus === 'WARNING') {
    addIssue('PRODUCT_READINESS_WARNING', 'WARNING', 'product', 'Product/routing readiness đang có cảnh báo.');
  }
  if (isDependencyBlocked(card)) {
    addIssue('WAIT_PREVIOUS_STEP', 'BLOCKER', 'dependency', 'Công đoạn đang chờ công đoạn trước hoàn tất.');
  }
  if (String(card.operation.block_reason_code || '').trim()) {
    addIssue('BLOCK_REASON_ACTIVE', 'BLOCKER', 'operation', 'Công đoạn đang có lý do khóa/cảnh báo.');
  }
  if (isInactiveOperationStatus(card.operation.status)) {
    addIssue('OPERATION_INACTIVE', 'BLOCKER', 'operation', 'Công đoạn DONE/SKIPPED không còn trong hàng dispatch active.');
  }
  if (card.materials.material_readiness !== 'READY') {
    addIssue('MATERIAL_NOT_READY', 'WARNING', 'material', 'Vật tư chưa được cấp đầy đủ.');
  }
  if (!card.operation.planned_date || !String(card.operation.planned_shift || '').trim()) {
    addIssue('SCHEDULE_MISSING', 'WARNING', 'planning', 'Công đoạn chưa có ngày hoặc ca sản xuất.');
  }
  if (card.capacity.capacity_state === 'UNASSIGNED_WORK_CENTER') {
    addIssue('WORK_CENTER_MISSING', 'WARNING', 'resource', 'Công đoạn chưa gán tổ/work center.');
  } else if (card.capacity.capacity_state === 'UNASSIGNED_MACHINE') {
    addIssue('MACHINE_MISSING', 'WARNING', 'resource', 'Công đoạn chưa gán máy.');
  } else if (card.capacity.capacity_state === 'OVER_CAPACITY') {
    addIssue('CAPACITY_OVER_CAPACITY', 'WARNING', 'capacity', 'Tải công suất đang vượt giờ khả dụng.');
  } else if (card.capacity.capacity_state === 'AT_LIMIT') {
    addIssue('CAPACITY_AT_LIMIT', 'WARNING', 'capacity', 'Tải công suất đang gần chạm ngưỡng.');
  }
  return issues;
};
const getReadyToDispatchIssues = (card: ProductionPlanningCard) => (
  card.ready_to_dispatch?.issues?.length
    ? card.ready_to_dispatch.issues
    : buildFallbackReadyToDispatchIssues(card)
);
const getReadyToDispatchIssueTitle = (issue: { code?: string; category?: string }) => {
  const code = String(issue.code || '').toUpperCase();
  const category = String(issue.category || '').toLowerCase();
  if (code.includes('PRODUCT_READINESS')) return 'Routing/product readiness';
  if (code === 'WAIT_PREVIOUS_STEP') return 'Chờ công đoạn trước';
  if (code === 'BLOCK_REASON_ACTIVE') return 'Block reason';
  if (code === 'OPERATION_INACTIVE') return 'DONE/SKIPPED';
  if (code === 'WORK_CENTER_MISSING') return 'Thiếu tổ/work center';
  if (code === 'MACHINE_MISSING') return 'Thiếu máy';
  if (code === 'SCHEDULE_MISSING') return 'Thiếu lịch/ca';
  if (code.startsWith('CAPACITY_') || category === 'capacity') return 'Công suất';
  if (code.startsWith('MATERIAL_') || category === 'material') return 'Vật tư/tồn nguồn';
  if (code.includes('PRINT') || category === 'print_metadata') return 'Print metadata';
  return issue.code || 'Chỉ cảnh báo';
};
const getReadyToDispatchSummary = (card: ProductionPlanningCard) => {
  const issues = getReadyToDispatchIssues(card);
  if (!issues.length) {
    return 'Đủ tín hiệu ready-to-dispatch theo dữ liệu hiện tại.';
  }
  return issues.slice(0, 3).map(getReadyToDispatchIssueTitle).join(' · ');
};
const getReadyToDispatchActionItem = (
  issue: ProductionReadinessIssue,
  card: ProductionPlanningCard,
  index: number,
): ReadyToDispatchActionItem => {
  const code = String(issue.code || '').toUpperCase();
  const category = String(issue.category || '').toLowerCase();
  const previousStep = card.operation.previous_step_name || card.operation.previous_step_code || 'công đoạn trước';
  const blockReason = card.operation.block_reason_label || card.operation.block_reason_code || 'lý do nghẽn hiện tại';
  if (code.includes('PRODUCT_READINESS')) {
    return {
      key: `${card.card_key}-product-readiness-${index}`,
      title: 'Rà product/routing readiness',
      action: 'Mở sản phẩm để bổ sung routing, công đoạn, máy/tổ hoặc print metadata trước khi đưa xuống line.',
      severity: issue.severity,
    };
  }
  if (code === 'WAIT_PREVIOUS_STEP') {
    return {
      key: `${card.card_key}-dependency-${index}`,
      title: 'Chờ bàn giao công đoạn trước',
      action: `Theo dõi ${previousStep}; chỉ bỏ qua nếu có lý do và audit rõ ràng.`,
      severity: issue.severity,
    };
  }
  if (code === 'BLOCK_REASON_ACTIVE') {
    return {
      key: `${card.card_key}-block-reason-${index}`,
      title: 'Xử lý block reason',
      action: `Rà ${blockReason}; gỡ nghẽn hoặc cập nhật ghi chú trước khi dispatch.`,
      severity: issue.severity,
    };
  }
  if (code === 'OPERATION_INACTIVE') {
    return {
      key: `${card.card_key}-inactive-${index}`,
      title: 'Không dispatch active',
      action: 'Giữ DONE/SKIPPED để đối chiếu, không xếp lại queue hoặc tính tải active.',
      severity: issue.severity,
    };
  }
  if (code === 'WORK_CENTER_MISSING' || code === 'MACHINE_MISSING') {
    return {
      key: `${card.card_key}-resource-${index}`,
      title: 'Gán máy/tổ',
      action: 'Chọn work center và máy từ catalog hoặc xác nhận legacy code trước khi giao việc.',
      severity: issue.severity,
    };
  }
  if (code === 'SCHEDULE_MISSING') {
    return {
      key: `${card.card_key}-schedule-${index}`,
      title: 'Chốt ngày/ca',
      action: 'Dùng nạp lịch nhanh hoặc bulk update để gán ngày và ca sản xuất.',
      severity: issue.severity,
    };
  }
  if (code.startsWith('CAPACITY_') || category === 'capacity') {
    return {
      key: `${card.card_key}-capacity-${index}`,
      title: 'Rà tải công suất',
      action: 'Mở queue/capacity window để đổi máy, đổi ca hoặc giảm tải trước khi dispatch.',
      severity: issue.severity,
    };
  }
  if (code.startsWith('MATERIAL_') || category === 'material') {
    return {
      key: `${card.card_key}-material-${index}`,
      title: 'Kiểm tra vật tư/tồn nguồn',
      action: 'Đối chiếu cấp vật tư, kho nguồn và tồn khả dụng trước khi đẩy lên line.',
      severity: issue.severity,
    };
  }
  if (code.includes('PRINT') || category === 'print_metadata') {
    return {
      key: `${card.card_key}-print-${index}`,
      title: 'Bổ sung print metadata',
      action: 'Rà film/màu in/thông tin in quan trọng trước khi giao sản xuất.',
      severity: issue.severity,
    };
  }
  return {
    key: `${card.card_key}-advisory-${index}`,
    title: getReadyToDispatchIssueTitle(issue),
    action: issue.message || 'Rà cảnh báo trước khi dispatch.',
    severity: issue.severity,
  };
};
const getReadyToDispatchActionItems = (card: ProductionPlanningCard): ReadyToDispatchActionItem[] => {
  const issues = getReadyToDispatchIssues(card);
  if (!issues.length) {
    return [{
      key: `${card.card_key}-ready`,
      title: 'Có thể dispatch',
      action: 'Có thể đưa vào dispatch theo dữ liệu hiện tại; vẫn cần xác nhận thực tế tại line.',
      severity: 'READY',
    }];
  }
  return issues.map((issue, index) => getReadyToDispatchActionItem(issue, card, index));
};
const renderReadyToDispatchTag = (card: ProductionPlanningCard) => {
  const status = getReadyToDispatchStatus(card);
  const issues = getReadyToDispatchIssues(card);
  return (
    <Tooltip
      title={(
        <Space direction="vertical" size={2}>
          <span>{getReadyToDispatchSummary(card)}</span>
          <span>Chỉ cảnh báo/đánh giá, chưa chặn workflow.</span>
        </Space>
      )}
    >
      <Tag color={readyToDispatchColor[status]} data-testid={`production-planning-ready-to-dispatch-${status.toLowerCase()}`}>
        {readyToDispatchLabel[status]}
        {issues.length ? ` · ${issues.length}` : ''}
      </Tag>
    </Tooltip>
  );
};
const renderReadyToDispatchDetails = (card: ProductionPlanningCard, maxItems = 3) => {
  const issues = getReadyToDispatchIssues(card);
  if (!issues.length) {
    return <Text type="secondary">Không có cảnh báo ready-to-dispatch.</Text>;
  }
  return (
    <Space wrap size={4}>
      {issues.slice(0, maxItems).map((issue) => (
        <Tooltip key={`${card.card_key}-${issue.code}`} title={issue.message}>
          <Tag color={readyToDispatchColor[issue.severity]}>{getReadyToDispatchIssueTitle(issue)}</Tag>
        </Tooltip>
      ))}
      {issues.length > maxItems ? <Tag>{`+${issues.length - maxItems}`}</Tag> : null}
    </Space>
  );
};
const renderReadyToDispatchActions = (
  card: ProductionPlanningCard,
  maxItems = 4,
  testId = 'production-planning-ready-to-dispatch-actions',
) => (
  <List
    size="small"
    data-testid={testId}
    dataSource={getReadyToDispatchActionItems(card).slice(0, maxItems)}
    renderItem={(item) => (
      <List.Item>
        <List.Item.Meta
          title={<Space wrap><Tag color={readyToDispatchColor[item.severity]}>{item.title}</Tag></Space>}
          description={item.action}
        />
      </List.Item>
    )}
  />
);
const getSkippedByDisplay = (operation: ProductionPlanningCard['operation']) => {
  const display = String(operation.skipped_by_display || '').trim();
  if (display) {
    return display;
  }
  return operation.skipped_by ? `Người dùng #${operation.skipped_by}` : 'Không rõ';
};
const getSkipReasonDisplay = (operation: ProductionPlanningCard['operation']) => (
  String(operation.skip_reason || '').trim() || 'Không rõ'
);
const getSkippedAtDisplay = (operation: ProductionPlanningCard['operation']) => (
  operation.skipped_at ? formatDateTime(operation.skipped_at) : 'Chưa ghi nhận'
);
const renderOperationStatusTag = (operation: ProductionPlanningCard['operation']) => {
  const tag = <Tag color={statusColor[operation.status]}>{operationStatusLabel[operation.status]}</Tag>;
  if (operation.status !== 'SKIPPED') {
    return tag;
  }
  return (
    <Tooltip
      title={(
        <Space direction="vertical" size={0}>
          <span>{`Lý do: ${getSkipReasonDisplay(operation)}`}</span>
          <span>{`Người bỏ qua: ${getSkippedByDisplay(operation)}`}</span>
          <span>{`Thời điểm: ${getSkippedAtDisplay(operation)}`}</span>
        </Space>
      )}
    >
      {tag}
    </Tooltip>
  );
};
const getPlanningActionErrorMessage = (error: unknown) => {
  const rawMessage = getToastMessage(error);
  const normalized = rawMessage.toLowerCase();
  if (
    normalized.includes('chờ công đoạn trước')
    || normalized.includes('công đoạn trước chưa')
    || normalized.includes('cong doan truoc')
    || normalized.includes('wait_previous_step')
    || normalized.includes('wait previous step')
    || normalized.includes('dependency')
    || normalized.includes('phụ thuộc')
  ) {
    return 'Chưa thể thao tác công đoạn này vì công đoạn trước chưa hoàn thành. Vui lòng tải lại bàn điều độ nếu trạng thái vừa thay đổi.';
  }
  return rawMessage;
};
const getDependencyBlockedSelectionMessage = (count: number) => (
  count > 0
    ? `Có ${count} công đoạn đang chờ công đoạn trước. Bỏ chọn các công đoạn này trước khi đổi trạng thái.`
    : ''
);
const isPlanningDependencyError = (error: unknown) => {
  const normalized = getToastMessage(error).toLowerCase();
  return (
    normalized.includes('chờ công đoạn trước')
    || normalized.includes('công đoạn trước chưa')
    || normalized.includes('cong doan truoc')
    || normalized.includes('wait_previous_step')
    || normalized.includes('wait previous step')
    || normalized.includes('dependency')
    || normalized.includes('phụ thuộc')
  );
};
const formatCapacityLoad = (ratio?: string | number | null) => {
  if (ratio === null || ratio === undefined) {
    return '--';
  }
  return `${Math.round(Number(ratio) * 100)}%`;
};
const getWindowTone = (state?: 'BALANCED' | 'AT_LIMIT' | 'OVER_CAPACITY') => {
  if (state === 'OVER_CAPACITY') return { border: '#ffccc7', background: '#fff2f0', color: '#cf1322' };
  if (state === 'AT_LIMIT') return { border: '#ffe58f', background: '#fffbe6', color: '#d48806' };
  return { border: '#d9f7be', background: '#f6ffed', color: '#389e0d' };
};
const getSeverityColor = (severity?: 'critical' | 'warning' | 'info') => {
  if (severity === 'critical') return 'error';
  if (severity === 'warning') return 'gold';
  return 'blue';
};
const getPlanningWarningColor = (severity: PlanningWarningSeverity) => {
  if (severity === 'critical') return 'error';
  if (severity === 'warning') return 'gold';
  return 'blue';
};
const getPlanningWarningAlertType = (severity: PlanningWarningSeverity): 'error' | 'warning' | 'info' => {
  if (severity === 'critical') return 'error';
  if (severity === 'warning') return 'warning';
  return 'info';
};
const planningWarningSeverityRank: Record<PlanningWarningSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};
const sortPlanningWarnings = (items: PlanningWarningItem[]) => [...items].sort((left, right) => (
  planningWarningSeverityRank[right.severity] - planningWarningSeverityRank[left.severity]
  || (Number(right.count ?? 0) - Number(left.count ?? 0))
  || left.title.localeCompare(right.title, 'vi')
));
const getPlanningWarningTone = (items: PlanningWarningItem[]): PlanningWarningSeverity => {
  if (items.some((item) => item.severity === 'critical')) return 'critical';
  if (items.some((item) => item.severity === 'warning')) return 'warning';
  return 'info';
};
const buildPlanningWarningItemsFromCounts = (counts: PlanningWarningCounts): PlanningWarningItem[] => {
  const items: PlanningWarningItem[] = [];
  if (Number(counts.overCapacityCount ?? 0) > 0) {
    items.push({
      key: 'over-capacity',
      title: 'Quá tải',
      reason: 'Tải đang vượt năng lực đã tính trong planner.',
      action: 'Mở cockpit công suất hoặc queue máy để đổi ngày/ca/máy.',
      severity: 'critical',
      count: counts.overCapacityCount,
    });
  }
  if (Number(counts.overdueCount ?? 0) > 0) {
    items.push({
      key: 'overdue',
      title: 'Trễ kế hoạch',
      reason: 'Công đoạn active đã rơi vào nhóm quá hạn hoặc trễ giao.',
      action: 'Ưu tiên xử lý, đổi lịch hoặc bàn giao sớm cho ca hiện tại.',
      severity: 'critical',
      count: counts.overdueCount,
    });
  }
  if (Number(counts.atLimitCount ?? 0) > 0) {
    items.push({
      key: 'at-limit',
      title: 'Gần kín tải',
      reason: 'Slot công suất đang sát ngưỡng tải theo planner.',
      action: 'Không nhồi thêm việc nếu chưa rà lại queue và giờ active.',
      severity: 'warning',
      count: counts.atLimitCount,
    });
  }
  if (Number(counts.deliveryRiskCount ?? 0) > 0) {
    items.push({
      key: 'delivery-risk',
      title: 'Nguy cơ trễ',
      reason: 'Công đoạn có rủi ro tiến độ hoặc bộ đệm giao hàng xấu.',
      action: 'Rà hạn giao, ưu tiên và trạng thái bàn giao trước khi chốt ca.',
      severity: 'warning',
      count: counts.deliveryRiskCount,
    });
  }
  if (Number(counts.unassignedResourceCount ?? 0) > 0) {
    items.push({
      key: 'unassigned-resource',
      title: 'Thiếu máy/tổ',
      reason: 'Công đoạn chưa có work center hoặc máy để tính queue rõ ràng.',
      action: 'Gán work center/máy từ catalog hoặc giữ legacy code nếu cần.',
      severity: 'warning',
      count: counts.unassignedResourceCount,
    });
  }
  if (Number(counts.unscheduledCount ?? 0) > 0) {
    items.push({
      key: 'unscheduled',
      title: 'Chưa gán ngày/ca',
      reason: 'Công đoạn chưa có lịch đủ để vào ca điều độ.',
      action: 'Dùng nạp lịch nhanh hoặc bulk update để xếp ngày/ca.',
      severity: 'warning',
      count: counts.unscheduledCount,
    });
  }
  if (Number(counts.dependencyBlockedCount ?? 0) > 0) {
    items.push({
      key: 'dependency-blocked',
      title: 'Chờ công đoạn trước',
      reason: 'Công đoạn chưa đủ điều kiện để bắt đầu hoặc hoàn thành.',
      action: 'Theo dõi bàn giao công đoạn trước; chỉ bỏ qua khi có lý do/audit.',
      severity: 'warning',
      count: counts.dependencyBlockedCount,
    });
  }
  if (Number(counts.inactiveCount ?? 0) > 0) {
    items.push({
      key: 'inactive-done-skipped',
      title: 'DONE/SKIPPED inactive',
      reason: 'Công đoạn hoàn thành hoặc bỏ qua vẫn hiển thị để đối chiếu.',
      action: 'Không tính các dòng này vào giờ active hoặc tải queue.',
      severity: 'info',
      count: counts.inactiveCount,
    });
  }
  return sortPlanningWarnings(items);
};
const buildOperationWarnings = (card: ProductionPlanningCard): PlanningWarningItem[] => {
  if (isInactiveOperationStatus(card.operation.status)) {
    return [{
      key: 'inactive-done-skipped',
      title: 'Không tính active',
      reason: `${operationStatusLabel[card.operation.status]} chỉ để đối chiếu trạng thái.`,
      action: 'Không đưa công đoạn này vào tải active hoặc đổi thứ tự queue.',
      severity: 'info',
    }];
  }

  const counts: PlanningWarningCounts = {
    overCapacityCount: card.capacity.capacity_state === 'OVER_CAPACITY' || card.capacity.over_capacity ? 1 : 0,
    atLimitCount: card.capacity.capacity_state === 'AT_LIMIT' ? 1 : 0,
    overdueCount: card.exceptions.risk_state === 'OVERDUE' || card.exceptions.is_overdue ? 1 : 0,
    deliveryRiskCount: card.exceptions.risk_state === 'AT_RISK' ? 1 : 0,
    unassignedResourceCount: card.capacity.unassigned_machine || card.capacity.unassigned_work_center ? 1 : 0,
    unscheduledCount: !card.operation.planned_date || !card.operation.planned_shift ? 1 : 0,
    dependencyBlockedCount: isDependencyBlocked(card) ? 1 : 0,
  };
  const items = buildPlanningWarningItemsFromCounts(counts).map((item) => ({ ...item, count: undefined }));
  return items.map((item) => {
    if (item.key === 'over-capacity' || item.key === 'at-limit') {
      return {
        ...item,
        reason: `${card.capacity.capacity_state_label} · ${formatHours(card.capacity.scheduled_hours)} · tải WC ${formatCapacityLoad(card.capacity.work_center_load_ratio)}.`,
      };
    }
    if (item.key === 'overdue' || item.key === 'delivery-risk') {
      return {
        ...item,
        reason: `${card.exceptions.risk_state_label} · ${formatDaysToDelivery(card.exceptions.days_to_delivery)} · ${formatDeliveryGap(card.exceptions.delivery_gap_days)}.`,
      };
    }
    if (item.key === 'unassigned-resource') {
      return {
        ...item,
        reason: `${card.capacity.unassigned_work_center ? 'Chưa gán work center' : 'Đã có work center'} · ${card.capacity.unassigned_machine ? 'chưa gán máy' : 'đã có máy'}.`,
      };
    }
    if (item.key === 'unscheduled') {
      return {
        ...item,
        reason: `${card.operation.planned_date ? formatDate(card.operation.planned_date) : 'Chưa gán ngày'} · ${card.operation.planned_shift_label || 'chưa gán ca'}.`,
      };
    }
    if (item.key === 'dependency-blocked') {
      const previousStep = card.operation.previous_step_name || card.operation.previous_step_code || 'công đoạn trước';
      return {
        ...item,
        reason: `Đang chờ ${previousStep} trước khi chạy tiếp.`,
      };
    }
    return item;
  });
};
const renderPlanningWarningChips = (items: PlanningWarningItem[], maxItems = 4) => {
  const visibleItems = items.slice(0, maxItems);
  const hiddenCount = Math.max(items.length - visibleItems.length, 0);
  if (!visibleItems.length) {
    return null;
  }
  return (
    <Space wrap size={4} data-testid="production-planning-warning-chips">
      {visibleItems.map((item) => (
        <Tooltip key={item.key} title={`${item.reason} Nên làm: ${item.action}`}>
          <Tag color={getPlanningWarningColor(item.severity)}>{item.title}</Tag>
        </Tooltip>
      ))}
      {hiddenCount ? <Tag>{`+${hiddenCount} cảnh báo`}</Tag> : null}
    </Space>
  );
};
const getSummaryRatio = (summary?: ProductionPlanningSummary | null, scopeSummary?: ProductionPlanningSummary | null) => {
  const total = Number(scopeSummary?.total_operations ?? 0);
  if (!total) {
    return 0;
  }
  return Math.round((Number(summary?.total_operations ?? 0) / total) * 100);
};

export default function ProductionPlanningBoard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const screens = Grid.useBreakpoint();
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const isMobileViewport = viewportWidth < 576 || !screens.sm;
  const isTabletViewport = (viewportWidth >= 576 && viewportWidth < 992) || Boolean(screens.sm && !screens.lg);
  const isTouchViewport = viewportWidth < 992 || !screens.lg;
  const detailDrawerWidth = isMobileViewport ? viewportWidth : isTabletViewport ? Math.round(viewportWidth * 0.92) : 760;
  const bulkModalWidth = isMobileViewport ? Math.max(320, viewportWidth - 24) : isTabletViewport ? Math.round(viewportWidth * 0.9) : 920;
  const touchButtonStyle: CSSProperties | undefined = isTouchViewport ? { width: '100%', minHeight: 40 } : undefined;
  const touchButtonWrapperStyle: CSSProperties | undefined = isTouchViewport ? { width: '100%' } : undefined;
  const shopFloorActionGridStyle: CSSProperties = isTouchViewport
    ? {
        display: 'grid',
        gridTemplateColumns: isMobileViewport ? '1fr' : 'repeat(2, minmax(0, 1fr))',
        gap: 8,
        width: '100%',
      }
    : {
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
      };
  const shopFloorGroupGridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: isMobileViewport ? '1fr' : isTabletViewport ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: isTouchViewport ? 10 : 12,
  };
  const initial = useMemo(() => buildSnapshotFromParams(searchParams), [searchParams]);
  const [search, setSearch] = useState(initial.search);
  const [stepCode, setStepCode] = useState(initial.step_code);
  const [plannedDate, setPlannedDate] = useState(initial.planned_date);
  const [deliveryDueDate, setDeliveryDueDate] = useState(initial.delivery_due_date);
  const [plannedShift, setPlannedShift] = useState<ShiftFilter>(initial.planned_shift);
  const [handoverStatus, setHandoverStatus] = useState<HandoverFilter>(initial.handover_status);
  const [capacityState, setCapacityState] = useState<CapacityFilter>(initial.capacity_state);
  const [riskState, setRiskState] = useState<RiskFilter>(initial.risk_state);
  const [bucketKey, setBucketKey] = useState<BucketFilter>(initial.bucket_key);
  const [orderStatus, setOrderStatus] = useState<OrderStatusFilter>(initial.order_status);
  const [dispatchOwner, setDispatchOwner] = useState(initial.dispatch_owner);
  const [workCenterCode, setWorkCenterCode] = useState(initial.work_center_code);
  const [machineCode, setMachineCode] = useState(initial.machine_code);
  const [customer, setCustomer] = useState(initial.customer);
  const [salesOrderCode, setSalesOrderCode] = useState(initial.sales_order_code);
  const [finishedProductCode, setFinishedProductCode] = useState(initial.finished_product_code);
  const [materialProductCode, setMaterialProductCode] = useState(initial.material_product_code);
  const [materialReadiness, setMaterialReadiness] = useState<MaterialFilter>(initial.material_readiness);
  const [dependencyState, setDependencyState] = useState<DependencyFilter>(initial.dependency_state);
  const [readyToDispatch, setReadyToDispatch] = useState<DispatchReadinessFilter>(initial.ready_to_dispatch);
  const [readyToRunOnly, setReadyToRunOnly] = useState(initial.ready_to_run);
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(initial.needs_attention);
  const [hasMaterialWait, setHasMaterialWait] = useState(initial.has_material_wait);
  const [hasPreviousWait, setHasPreviousWait] = useState(initial.has_previous_wait);
  const [viewMode, setViewMode] = useState<ViewMode>(initial.view);
  const [activeDispatchPreset, setActiveDispatchPreset] = useState<DispatchPresetKey | null>(null);
  const [dispatchPresetBase, setDispatchPresetBase] = useState<DispatchPresetSnapshot | null>(null);
  const [productionOrderId, setProductionOrderId] = useState(searchParams.get('production_order_id') || '');
  const [focusOperationId, setFocusOperationId] = useState(searchParams.get('focus_operation_id') || '');
  const [focusWindowDate, setFocusWindowDate] = useState(searchParams.get('focus_window_date') || '');
  const [focusWindowShift, setFocusWindowShift] = useState<ShiftFilter>(normalizeShift(searchParams.get('focus_window_shift')));
  const [selectedCardKey, setSelectedCardKey] = useState<string | null>(null);
  const [selectedCardKeys, setSelectedCardKeys] = useState<string[]>([]);
  const [selectedSuggestionKeys, setSelectedSuggestionKeys] = useState<string[]>([]);
  const [selectedQueueKey, setSelectedQueueKey] = useState(searchParams.get('queue_key') || null);
  const [queueSequenceDraftState, setQueueSequenceDraftState] = useState<QueueSequenceDraftState>({ scopeKey: '', values: EMPTY_QUEUE_SEQUENCE_DRAFT });
  const [selectedPresetId, setSelectedPresetId] = useState('NONE');
  const [selectedScenarioId, setSelectedScenarioId] = useState('NONE');
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [isScenarioModalOpen, setIsScenarioModalOpen] = useState(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [isSkipModalOpen, setIsSkipModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [scenarioName, setScenarioName] = useState('');
  const [form] = Form.useForm();
  const [bulkForm] = Form.useForm<BulkFormValues>();
  const [skipForm] = Form.useForm<SkipFormValues>();
  const watchedStatus = Form.useWatch('status', form);
  const watchedPlannedDate = Form.useWatch('planned_date', form);
  const watchedPlannedShift = Form.useWatch('planned_shift', form);
  const watchedPriorityRank = Form.useWatch('priority_rank', form);
  const watchedDispatchSequence = Form.useWatch('dispatch_sequence', form);
  const watchedWorkCenterCode = Form.useWatch('work_center_code', form);
  const watchedWorkCenterName = Form.useWatch('work_center_name', form);
  const watchedMachineCode = Form.useWatch('machine_code', form);
  const watchedMachineName = Form.useWatch('machine_name', form);
  const watchedEstimatedRuntimeHours = Form.useWatch('estimated_runtime_hours', form);
  const watchedSetupMinutes = Form.useWatch('setup_minutes', form);
  const watchedBlockReasonCode = Form.useWatch('block_reason_code', form);
  const watchedBlockReasonNote = Form.useWatch('block_reason_note', form);
  const watchedBulkStatus = Form.useWatch('status', bulkForm);
  const watchedBulkPlannedDate = Form.useWatch('planned_date', bulkForm);
  const watchedBulkPlannedShift = Form.useWatch('planned_shift', bulkForm);
  const watchedBulkPriorityRank = Form.useWatch('priority_rank', bulkForm);
  const watchedBulkDispatchSequence = Form.useWatch('dispatch_sequence', bulkForm);
  const watchedBulkWorkCenterCode = Form.useWatch('work_center_code', bulkForm);
  const watchedBulkWorkCenterName = Form.useWatch('work_center_name', bulkForm);
  const watchedBulkMachineCode = Form.useWatch('machine_code', bulkForm);
  const watchedBulkMachineName = Form.useWatch('machine_name', bulkForm);
  const watchedBulkEstimatedRuntimeHours = Form.useWatch('estimated_runtime_hours', bulkForm);
  const watchedBulkSetupMinutes = Form.useWatch('setup_minutes', bulkForm);
  const watchedBulkBlockReasonCode = Form.useWatch('block_reason_code', bulkForm);
  const watchedBulkBlockReasonNote = Form.useWatch('block_reason_note', bulkForm);
  const watchedBulkNote = Form.useWatch('note', bulkForm);
  const { config, saveConfig } = useUserPreferences(PAGES.PRODUCTION_PLANNING);
  const configRecord = (config as Record<string, unknown>) || {};
  const shiftFilterOptions = DEFAULT_SHIFT_FILTER_OPTIONS;
  const shiftFormOptions = DEFAULT_SHIFT_FORM_OPTIONS;

  const snapshot: Snapshot = useMemo(() => ({
    search,
    step_code: stepCode,
    planned_date: plannedDate,
    delivery_due_date: deliveryDueDate,
    planned_shift: plannedShift,
    handover_status: handoverStatus,
    capacity_state: capacityState,
    risk_state: riskState,
    bucket_key: bucketKey,
    order_status: orderStatus,
    dispatch_owner: dispatchOwner,
    work_center_code: workCenterCode,
    machine_code: machineCode,
    customer,
    sales_order_code: salesOrderCode,
    finished_product_code: finishedProductCode,
    material_product_code: materialProductCode,
    material_readiness: materialReadiness,
    dependency_state: dependencyState,
    ready_to_dispatch: readyToDispatch,
    ready_to_run: readyToRunOnly,
    needs_attention: needsAttentionOnly,
    has_material_wait: hasMaterialWait,
    has_previous_wait: hasPreviousWait,
    view: viewMode,
  }), [bucketKey, capacityState, customer, deliveryDueDate, dependencyState, dispatchOwner, finishedProductCode, handoverStatus, hasMaterialWait, hasPreviousWait, machineCode, materialProductCode, materialReadiness, needsAttentionOnly, orderStatus, plannedDate, plannedShift, readyToDispatch, readyToRunOnly, riskState, salesOrderCode, search, stepCode, viewMode, workCenterCode]);

  const params = useMemo(() => {
    const next: Record<string, unknown> = {};
    if (search.trim()) next.search = search.trim();
    if (stepCode.trim()) next.step_code = stepCode.trim();
    if (plannedDate) {
      next.planned_date_from = plannedDate;
      next.planned_date_to = plannedDate;
    }
    if (deliveryDueDate) next.delivery_due_date = deliveryDueDate;
    if (plannedShift !== 'ALL') next.planned_shift = plannedShift;
    if (handoverStatus !== 'ALL') next.handover_status = handoverStatus;
    if (capacityState !== 'ALL') next.capacity_state = capacityState;
    if (riskState !== 'ALL') next.risk_state = riskState;
    if (bucketKey !== 'ALL') next.bucket_key = bucketKey;
    if (orderStatus !== 'ALL') next.order_status = orderStatus;
    if (dispatchOwner.trim()) next.dispatch_owner = dispatchOwner.trim();
    if (workCenterCode.trim()) next.work_center_code = workCenterCode.trim();
    if (machineCode.trim()) next.machine_code = machineCode.trim();
    if (customer.trim()) next.customer = customer.trim();
    if (salesOrderCode.trim()) next.sales_order_code = salesOrderCode.trim();
    if (finishedProductCode.trim()) next.finished_product_code = finishedProductCode.trim();
    if (materialProductCode.trim()) next.material_product_code = materialProductCode.trim();
    if (materialReadiness !== 'ALL') next.material_readiness = materialReadiness;
    if (dependencyState !== 'ALL') next.dependency_state = dependencyState;
    if (readyToRunOnly) next.ready_to_run = 1;
    if (needsAttentionOnly) next.needs_attention = 1;
    if (hasMaterialWait) next.has_material_wait = 1;
    if (hasPreviousWait) next.has_previous_wait = 1;
    if (productionOrderId.trim()) next.production_order_id = productionOrderId.trim();
    return next;
  }, [bucketKey, capacityState, customer, deliveryDueDate, dependencyState, dispatchOwner, finishedProductCode, handoverStatus, hasMaterialWait, hasPreviousWait, machineCode, materialProductCode, materialReadiness, needsAttentionOnly, orderStatus, plannedDate, plannedShift, productionOrderId, readyToRunOnly, riskState, salesOrderCode, search, stepCode, workCenterCode]);

  const syncSearch = useMemo(() => {
    const next = new URLSearchParams();
    if (search.trim()) next.set('q', search.trim());
    if (stepCode.trim()) next.set('step_code', stepCode.trim());
    if (plannedDate) next.set('planned_date', plannedDate);
    if (deliveryDueDate) next.set('delivery_due_date', deliveryDueDate);
    if (plannedShift !== 'ALL') next.set('planned_shift', plannedShift);
    if (handoverStatus !== 'ALL') next.set('handover_status', handoverStatus);
    if (capacityState !== 'ALL') next.set('capacity_state', capacityState);
    if (riskState !== 'ALL') next.set('risk_state', riskState);
    if (bucketKey !== 'ALL') next.set('bucket_key', bucketKey);
    if (orderStatus !== 'ALL') next.set('order_status', orderStatus);
    if (dispatchOwner.trim()) next.set('dispatch_owner', dispatchOwner.trim());
    if (workCenterCode.trim()) next.set('work_center_code', workCenterCode.trim());
    if (machineCode.trim()) next.set('machine_code', machineCode.trim());
    if (customer.trim()) next.set('customer', customer.trim());
    if (salesOrderCode.trim()) next.set('sales_order_code', salesOrderCode.trim());
    if (finishedProductCode.trim()) next.set('finished_product_code', finishedProductCode.trim());
    if (materialProductCode.trim()) next.set('material_product_code', materialProductCode.trim());
    if (materialReadiness !== 'ALL') next.set('material_readiness', materialReadiness);
    if (dependencyState !== 'ALL') next.set('dependency_state', dependencyState);
    if (readyToDispatch !== 'ALL') next.set('ready_to_dispatch', readyToDispatch);
    if (readyToRunOnly) next.set('ready_to_run', '1');
    if (needsAttentionOnly) next.set('needs_attention', '1');
    if (hasMaterialWait) next.set('has_material_wait', '1');
    if (hasPreviousWait) next.set('has_previous_wait', '1');
    if (productionOrderId.trim()) next.set('production_order_id', productionOrderId.trim());
    if (focusOperationId.trim()) next.set('focus_operation_id', focusOperationId.trim());
    if (focusWindowDate) next.set('focus_window_date', focusWindowDate);
    if (focusWindowShift !== 'ALL') next.set('focus_window_shift', focusWindowShift);
    if (selectedQueueKey) next.set('queue_key', selectedQueueKey);
    if (viewMode !== 'BOARD') next.set('view', viewMode);
    return next.toString();
  }, [bucketKey, capacityState, customer, deliveryDueDate, dependencyState, dispatchOwner, finishedProductCode, focusOperationId, focusWindowDate, focusWindowShift, handoverStatus, hasMaterialWait, hasPreviousWait, machineCode, materialProductCode, materialReadiness, needsAttentionOnly, orderStatus, plannedDate, plannedShift, productionOrderId, readyToDispatch, readyToRunOnly, riskState, salesOrderCode, search, selectedQueueKey, stepCode, viewMode, workCenterCode]);

  useEffect(() => {
    if (syncSearch !== searchParams.toString()) {
      navigate({ search: syncSearch ? `?${syncSearch}` : '' }, { replace: true });
    }
  }, [navigate, searchParams, syncSearch]);

  const workspaceQuery = useQuery({
    queryKey: ['production-planning-board', params],
    queryFn: () => productionApi.getPlanningBoard(params),
  });
  const capacityOptionsQuery = useQuery({
    queryKey: ['production-capacity-options'],
    queryFn: productionApi.getCapacityOptions,
  });
  const workspace = workspaceQuery.data;
  const capacityOptionData = capacityOptionsQuery.data;
  const serverCards = useMemo(() => flatCards(workspace), [workspace]);
  const cards = useMemo(
    () => (readyToDispatch === 'ALL'
      ? serverCards
      : serverCards.filter((card) => getReadyToDispatchStatus(card) === readyToDispatch)),
    [readyToDispatch, serverCards],
  );
  const displayLanes = useMemo(() => {
    if (!workspace) {
      return [];
    }
    if (readyToDispatch === 'ALL') {
      return workspace.lanes;
    }
    return workspace.lanes.map((lane) => {
      const buckets = lane.buckets.map((bucket) => {
        const bucketCards = bucket.cards.filter((card) => getReadyToDispatchStatus(card) === readyToDispatch);
        return { ...bucket, count: bucketCards.length, cards: bucketCards };
      });
      return {
        ...lane,
        total_cards: buckets.reduce((total, bucket) => total + bucket.cards.length, 0),
        buckets,
      };
    }).filter((lane) => lane.total_cards > 0);
  }, [readyToDispatch, workspace]);
  const selectedCard = useMemo(() => {
    if (selectedCardKey) {
      const matchedByKey = cards.find((card) => card.card_key === selectedCardKey);
      if (matchedByKey) {
        return matchedByKey;
      }
    }
    if (focusOperationId.trim()) {
      return cards.find((card) => String(card.operation.id) === focusOperationId.trim()) ?? null;
    }
    return null;
  }, [cards, focusOperationId, selectedCardKey]);
  const stepOptions = useMemo(() => [{ value: '', label: 'Tất cả công đoạn' }, ...((workspace?.lanes ?? []).map((lane) => ({ value: lane.step_code, label: `${lane.step_code} · ${lane.step_name}` })))], [workspace?.lanes]);
  const namedPresets = useMemo<NamedPreset[]>(() => Array.isArray(configRecord.saved_views) ? (configRecord.saved_views as NamedPreset[]) : [], [configRecord.saved_views]);
  const savedScenarios = useMemo<SavedScenario[]>(() => Array.isArray(configRecord.saved_scenarios) ? (configRecord.saved_scenarios as SavedScenario[]) : [], [configRecord.saved_scenarios]);
  const selectedPreset = useMemo(() => namedPresets.find((item) => item.id === selectedPresetId) ?? null, [namedPresets, selectedPresetId]);
  const selectedSavedScenario = useMemo(() => savedScenarios.find((item) => item.id === selectedScenarioId) ?? null, [savedScenarios, selectedScenarioId]);
  const canPlanProduction = canPlanProductionOrders();
  const canEditSelectedCard = Boolean(canPlanProduction && selectedCard && ['RELEASED', 'IN_PROGRESS'].includes(selectedCard.order.status));
  const canSkipSelectedCard = Boolean(
    canEditSelectedCard
      && selectedCard
      && ['PENDING', 'READY', 'IN_PROGRESS'].includes(selectedCard.operation.status),
  );
  const activeSelectedCardKeys = useMemo(
    () => selectedCardKeys.filter((cardKey) => cards.some((card) => card.card_key === cardKey)),
    [cards, selectedCardKeys],
  );
  const selectedCards = useMemo(
    () => activeSelectedCardKeys.map((cardKey) => cards.find((card) => card.card_key === cardKey)).filter(Boolean) as ProductionPlanningCard[],
    [activeSelectedCardKeys, cards],
  );
  const activeLoadCards = useMemo(
    () => cards.filter((card) => !isInactiveOperationStatus(card.operation.status)),
    [cards],
  );
  const planningUsabilitySummary = useMemo(() => ({
    totalVisibleCount: cards.length,
    activeCount: activeLoadCards.length,
    inactiveDoneSkippedCount: cards.length - activeLoadCards.length,
    activeScheduledHours: activeLoadCards.reduce((total, card) => total + Number(card.capacity.scheduled_hours || 0), 0),
    readyDispatchCount: activeLoadCards.filter((card) => getReadyToDispatchStatus(card) === 'READY').length,
    dispatchWarningCount: activeLoadCards.filter((card) => getReadyToDispatchStatus(card) === 'WARNING').length,
    dispatchBlockerCount: activeLoadCards.filter((card) => getReadyToDispatchStatus(card) === 'BLOCKER').length,
    readyCount: activeLoadCards.filter((card) => card.materials.ready_to_run).length,
    waitMaterialCount: activeLoadCards.filter((card) => card.materials.material_readiness === 'WAITING' || card.operation.block_reason_code === 'WAIT_MATERIAL').length,
    waitPreviousCount: activeLoadCards.filter(isDependencyBlocked).length,
    overCapacityCount: activeLoadCards.filter((card) => card.capacity.capacity_state === 'OVER_CAPACITY' || card.capacity.over_capacity).length,
    atLimitCount: activeLoadCards.filter((card) => card.capacity.capacity_state === 'AT_LIMIT').length,
    overdueCount: activeLoadCards.filter((card) => card.exceptions.risk_state === 'OVERDUE').length,
    deliveryRiskCount: activeLoadCards.filter((card) => card.exceptions.risk_state === 'AT_RISK').length,
    unassignedMachineCount: activeLoadCards.filter((card) => card.capacity.unassigned_machine).length,
    unassignedWorkCenterCount: activeLoadCards.filter((card) => card.capacity.unassigned_work_center).length,
    unassignedResourceCount: activeLoadCards.filter((card) => card.capacity.unassigned_machine || card.capacity.unassigned_work_center).length,
    unscheduledCount: activeLoadCards.filter((card) => !card.operation.planned_date || !card.operation.planned_shift).length,
  }), [activeLoadCards, cards.length]);
  const readyToDispatchReasonSummary = useMemo(() => {
    const reasonCounts = new Map<string, { title: string; count: number; status: ProductionReadyToDispatchStatus }>();
    activeLoadCards.forEach((card) => {
      getReadyToDispatchIssues(card).forEach((issue) => {
        const title = getReadyToDispatchIssueTitle(issue);
        const current = reasonCounts.get(title);
        if (current) {
          current.count += 1;
          if (readyToDispatchColor[issue.severity] === 'error') {
            current.status = issue.severity;
          }
          return;
        }
        reasonCounts.set(title, { title, count: 1, status: issue.severity });
      });
    });
    return [...reasonCounts.values()].sort((left, right) => right.count - left.count || left.title.localeCompare(right.title, 'vi')).slice(0, 6);
  }, [activeLoadCards]);
  const readyToDispatchActionSummary = useMemo(() => {
    const actionCounts = new Map<string, ReadyToDispatchActionItem>();
    activeLoadCards.forEach((card) => {
      getReadyToDispatchActionItems(card)
        .filter((item) => item.severity !== 'READY')
        .forEach((item) => {
          const key = `${item.title}|${item.action}`;
          const current = actionCounts.get(key);
          if (current) {
            current.count = (current.count ?? 0) + 1;
            if (readyToDispatchColor[item.severity] === 'error') {
              current.severity = item.severity;
            }
            return;
          }
          actionCounts.set(key, { ...item, key, count: 1 });
        });
    });
    return [...actionCounts.values()].sort((left, right) => (right.count ?? 0) - (left.count ?? 0) || left.title.localeCompare(right.title, 'vi')).slice(0, 5);
  }, [activeLoadCards]);
  const planningWarningItems = useMemo(() => buildPlanningWarningItemsFromCounts({
    overCapacityCount: planningUsabilitySummary.overCapacityCount,
    atLimitCount: planningUsabilitySummary.atLimitCount,
    overdueCount: planningUsabilitySummary.overdueCount,
    deliveryRiskCount: planningUsabilitySummary.deliveryRiskCount,
    unassignedResourceCount: planningUsabilitySummary.unassignedResourceCount,
    unscheduledCount: planningUsabilitySummary.unscheduledCount,
    dependencyBlockedCount: planningUsabilitySummary.waitPreviousCount,
    inactiveCount: planningUsabilitySummary.inactiveDoneSkippedCount,
  }), [planningUsabilitySummary]);
  const activeWorkCenters = useMemo(() => sortResourceOptions(capacityOptionData?.work_centers ?? []), [capacityOptionData?.work_centers]);
  const activeMachines = useMemo(
    () => [...(capacityOptionData?.machines ?? [])].sort((left, right) => (
      String(left.work_center_code || '').localeCompare(String(right.work_center_code || ''), 'vi')
      || Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0)
      || String(left.name || '').localeCompare(String(right.name || ''), 'vi')
      || String(left.code || '').localeCompare(String(right.code || ''), 'vi')
    )),
    [capacityOptionData?.machines],
  );
  const workCenterByCode = useMemo(() => {
    const map = new Map<string, ProductionWorkCenter>();
    activeWorkCenters.forEach((item) => map.set(normalizeResourceCode(item.code), item));
    return map;
  }, [activeWorkCenters]);
  const machineByCode = useMemo(() => {
    const map = new Map<string, ProductionMachine>();
    activeMachines.forEach((item) => map.set(normalizeResourceCode(item.code), item));
    return map;
  }, [activeMachines]);
  const hasCapacityCatalog = activeWorkCenters.length > 0 || activeMachines.length > 0;
  const getWorkCenterOptions = (currentCode?: string | null, currentName?: string | null) => {
    const options = activeWorkCenters.map((item) => ({ value: item.code, label: buildWorkCenterLabel(item) }));
    const normalizedCurrent = normalizeResourceCode(currentCode);
    const currentValue = String(currentCode || '').trim();
    if (currentValue && !workCenterByCode.has(normalizedCurrent)) {
      options.unshift({ value: currentValue, label: buildLegacyResourceLabel(currentValue, currentName) });
    }
    return options;
  };
  const getMachineOptions = (workCenterValue?: string | null, currentCode?: string | null, currentName?: string | null) => {
    const selectedWorkCenter = normalizeResourceCode(workCenterValue);
    const machines = selectedWorkCenter
      ? activeMachines.filter((item) => normalizeResourceCode(item.work_center_code) === selectedWorkCenter)
      : activeMachines;
    const options = machines.map((item) => ({ value: item.code, label: buildMachineLabel(item) }));
    const normalizedCurrent = normalizeResourceCode(currentCode);
    const currentValue = String(currentCode || '').trim();
    if (currentValue && !machineByCode.has(normalizedCurrent)) {
      options.unshift({ value: currentValue, label: buildLegacyResourceLabel(currentValue, currentName) });
    }
    return options;
  };
  const applyWorkCenterToForm = (targetForm: typeof form | typeof bulkForm, value?: string | null) => {
    const code = String(value || '').trim();
    if (!code) {
      targetForm.setFieldsValue({
        work_center_code: '',
        work_center_name: '',
        machine_code: '',
        machine_name: '',
      });
      return;
    }
    const matchedWorkCenter = workCenterByCode.get(normalizeResourceCode(code));
    const currentMachineCode = String(targetForm.getFieldValue('machine_code') || '').trim();
    const currentMachine = machineByCode.get(normalizeResourceCode(currentMachineCode));
    const values: Record<string, string> = {
      work_center_code: matchedWorkCenter?.code ?? code,
    };
    if (matchedWorkCenter) {
      values.work_center_name = matchedWorkCenter.name;
    }
    if (
      currentMachine
      && normalizeResourceCode(currentMachine.work_center_code) !== normalizeResourceCode(matchedWorkCenter?.code ?? code)
    ) {
      values.machine_code = '';
      values.machine_name = '';
    }
    targetForm.setFieldsValue(values);
  };
  const applyMachineToForm = (targetForm: typeof form | typeof bulkForm, value?: string | null) => {
    const code = String(value || '').trim();
    if (!code) {
      targetForm.setFieldsValue({ machine_code: '', machine_name: '' });
      return;
    }
    const matchedMachine = machineByCode.get(normalizeResourceCode(code));
    if (matchedMachine) {
      targetForm.setFieldsValue({
        machine_code: matchedMachine.code,
        machine_name: matchedMachine.name,
        work_center_code: matchedMachine.work_center_code,
        work_center_name: matchedMachine.work_center_name,
      });
      return;
    }
    targetForm.setFieldsValue({ machine_code: code, machine_name: '' });
  };
  const handleWorkCenterFilterChange = (value?: string | null) => {
    const code = String(value || '').trim();
    setWorkCenterCode(code);
    if (!code) {
      setMachineCode('');
      return;
    }
    const currentMachine = machineByCode.get(normalizeResourceCode(machineCode));
    if (currentMachine && normalizeResourceCode(currentMachine.work_center_code) !== normalizeResourceCode(code)) {
      setMachineCode('');
    }
  };
  const handleMachineFilterChange = (value?: string | null) => {
    const code = String(value || '').trim();
    const matchedMachine = machineByCode.get(normalizeResourceCode(code));
    setMachineCode(matchedMachine?.code ?? code);
    if (matchedMachine) {
      setWorkCenterCode(matchedMachine.work_center_code);
    }
  };
  const blockedSelectedCards = useMemo(() => selectedCards.filter(isDependencyBlocked), [selectedCards]);
  const blockedSelectedCount = blockedSelectedCards.length;
  const selectedCardReadiness = selectedCard ? getOperationReadinessMeta(selectedCard) : null;
  const selectedCardDependencyBlocked = Boolean(selectedCard && isDependencyBlocked(selectedCard));
  const selectedBlockedReason = selectedCardReadiness?.reason || 'Công đoạn này đang chờ công đoạn trước hoàn thành.';
  const selectedCardWarnings = useMemo(
    () => (selectedCard ? buildOperationWarnings(selectedCard) : []),
    [selectedCard],
  );
  const blockedSelectionMessage = getDependencyBlockedSelectionMessage(blockedSelectedCount);
  const activeSelectedSuggestionKeys = useMemo(
    () => selectedSuggestionKeys.filter((suggestionKey) => (workspace?.rebalance_suggestions ?? []).some((item) => item.key === suggestionKey)),
    [selectedSuggestionKeys, workspace?.rebalance_suggestions],
  );
  const selectedRebalanceSuggestions = useMemo(
    () => activeSelectedSuggestionKeys
      .map((suggestionKey) => (workspace?.rebalance_suggestions ?? []).find((item) => item.key === suggestionKey))
      .filter(Boolean) as ProductionPlanningRebalanceSuggestion[],
    [activeSelectedSuggestionKeys, workspace?.rebalance_suggestions],
  );
  const selectedCapacityWindow = useMemo(() => {
    const nextWindowKey = buildWindowKey(
      focusWindowDate || null,
      focusWindowShift !== 'ALL' ? focusWindowShift : null,
    );
    return (workspace?.capacity_calendar ?? [])
      .flatMap((row) => row.shifts)
      .find((shift) => shift.key === nextWindowKey) ?? null;
  }, [focusWindowDate, focusWindowShift, workspace?.capacity_calendar]);
  const windowQueueHighlights = useMemo(
    () => (selectedCapacityWindow
      ? (workspace?.machine_queues ?? []).filter((queue) => queue.planned_date === selectedCapacityWindow.date && queue.shift_key === selectedCapacityWindow.shift_key)
      : []),
    [selectedCapacityWindow, workspace?.machine_queues],
  );
  const windowWorkCenterHighlights = useMemo(
    () => (selectedCapacityWindow
      ? (workspace?.work_center_groups ?? []).filter((group) => group.planned_date === selectedCapacityWindow.date && group.shift_key === selectedCapacityWindow.shift_key)
      : []),
    [selectedCapacityWindow, workspace?.work_center_groups],
  );
  const plannerReturnUrl = useMemo(() => `/production-planning${syncSearch ? `?${syncSearch}` : ''}`, [syncSearch]);
  const plannerFilterSummary = useMemo(() => {
    const tags = [
      search.trim() ? `Tìm kiếm ${search.trim()}` : '',
      stepCode.trim() ? `Công đoạn ${stepCode.trim()}` : '',
      plannedDate ? `Ngày ${formatDate(plannedDate)}` : '',
      deliveryDueDate ? `Hạn giao ${formatDate(deliveryDueDate)}` : '',
      plannedShift !== 'ALL' ? `Ca ${shiftFilterOptions.find((item) => item.value === plannedShift)?.label || plannedShift}` : '',
      handoverStatus !== 'ALL' ? `Bàn giao ${handoverOptions.find((item) => item.value === handoverStatus)?.label || handoverStatus}` : '',
      capacityState !== 'ALL' ? `Công suất ${capacityOptions.find((item) => item.value === capacityState)?.label || capacityState}` : '',
      bucketKey !== 'ALL' ? `Nhóm ${bucketOptions.find((item) => item.value === bucketKey)?.label || bucketKey}` : '',
      dispatchOwner.trim() ? `Người phụ trách ${dispatchOwner.trim()}` : '',
      workCenterCode.trim() ? `Trung tâm công việc ${workCenterCode.trim()}` : '',
      machineCode.trim() ? `Máy ${machineCode.trim()}` : '',
      readyToDispatch !== 'ALL' ? `Ready dispatch ${readyToDispatch}` : '',
      readyToRunOnly ? 'Chỉ sẵn chạy' : '',
      needsAttentionOnly ? 'Chỉ cần xử lý' : '',
      hasMaterialWait ? 'Chỉ chờ vật tư' : '',
      hasPreviousWait ? 'Chỉ chờ công đoạn trước' : '',
      productionOrderId.trim() ? `LSX ${productionOrderId.trim()}` : '',
    ].filter(Boolean);
    return tags.length ? tags.join(' | ') : 'Toàn bộ planner';
  }, [bucketKey, capacityState, deliveryDueDate, dispatchOwner, handoverStatus, hasMaterialWait, hasPreviousWait, machineCode, needsAttentionOnly, plannedDate, plannedShift, productionOrderId, readyToDispatch, readyToRunOnly, search, shiftFilterOptions, stepCode, workCenterCode]);
  const plannerHandoverPack = useMemo(() => {
    const watchItems = (workspace?.watchlist ?? []).slice(0, 4);
    return [
      'GOI BAN GIAO PLANNER',
      `Bộ lọc: ${plannerFilterSummary}`,
      `Tổng công đoạn: ${workspace?.summary.total_operations ?? 0}`,
      `Ready dispatch: ${workspace?.summary.ready_to_dispatch_count ?? planningUsabilitySummary.readyDispatchCount}`,
      `Warning dispatch: ${workspace?.summary.dispatch_warning_count ?? planningUsabilitySummary.dispatchWarningCount}`,
      `Blocker dispatch: ${workspace?.summary.dispatch_blocker_count ?? planningUsabilitySummary.dispatchBlockerCount}`,
      `Quá hạn: ${workspace?.summary.overdue_operations ?? 0}`,
      `Sẵn chạy: ${workspace?.summary.ready_to_run_count ?? 0}`,
      `Chờ vật tư: ${workspace?.summary.wait_material_count ?? 0}`,
      `Chờ công đoạn trước: ${workspace?.summary.wait_previous_step_count ?? 0}`,
      `Quá tải: ${workspace?.summary.over_capacity_count ?? 0}`,
      `Chưa gán máy: ${workspace?.summary.unassigned_machine_count ?? 0}`,
      `Chưa xếp: ${workspace?.summary.unscheduled_count ?? 0}`,
      `SO ảnh hưởng giao hàng: ${workspace?.summary.affected_sales_order_count ?? 0}`,
      watchItems.length ? 'Watchlist ưu tiên:' : '',
      ...watchItems.map((card) => (
        `- ${card.order.code} | ${card.operation.step_code} | ${card.exceptions.risk_state_label} | ${card.operation.planned_shift_label || 'Chưa xếp ca'}`
      )),
    ].filter(Boolean);
  }, [plannerFilterSummary, planningUsabilitySummary.dispatchBlockerCount, planningUsabilitySummary.dispatchWarningCount, planningUsabilitySummary.readyDispatchCount, workspace]);
  const plannerHandoverRoute = useMemo(() => {
    const selectedPairs = activeSelectedCardKeys
      .map((cardKey) => cards.find((card) => card.card_key === cardKey))
      .filter(Boolean)
      .slice(0, 10)
      .map((card) => `${card!.order.id}:${card!.operation.id}`);
    const selectedOperationIds = activeSelectedCardKeys
      .map((cardKey) => cards.find((card) => card.card_key === cardKey)?.operation.id)
      .filter((value): value is number => Boolean(value))
      .slice(0, 10)
      .map((value) => String(value));
    const selectedOrderIds = activeSelectedCardKeys
      .map((cardKey) => cards.find((card) => card.card_key === cardKey)?.order.id)
      .filter((value): value is number => Boolean(value))
      .filter((value, index, array) => array.indexOf(value) === index)
      .slice(0, 10)
      .map((value) => String(value));
    const next = new URLSearchParams({
      role: 'handover',
      preset: 'overview',
      focus: 'session',
      planner_digest: `Quá hạn ${workspace?.summary.overdue_operations ?? 0} | Sẵn chạy ${workspace?.summary.ready_to_run_count ?? 0} | Chờ vật tư ${workspace?.summary.wait_material_count ?? 0}`,
      planner_return_to: plannerReturnUrl,
    });
    if (plannedDate) next.set('planner_date', plannedDate);
    if (plannedShift !== 'ALL') next.set('planner_shift', plannedShift);
    if (bucketKey !== 'ALL') next.set('planner_bucket', bucketKey);
    if (stepCode.trim()) next.set('planner_step_code', stepCode.trim());
    if (handoverStatus !== 'ALL') next.set('planner_handover_status', handoverStatus);
    if (capacityState !== 'ALL') next.set('planner_capacity_state', capacityState);
    if (dispatchOwner.trim()) next.set('planner_dispatch_owner', dispatchOwner.trim());
    if (workCenterCode.trim()) next.set('planner_work_center_code', workCenterCode.trim());
    if (machineCode.trim()) next.set('planner_machine_code', machineCode.trim());
    if (selectedPairs.length) next.set('planner_pairs', selectedPairs.join('|'));
    if (selectedOperationIds.length) next.set('planner_operation_ids', selectedOperationIds.join(','));
    if (selectedOrderIds.length) next.set('planner_order_ids', selectedOrderIds.join(','));
    if (workspace?.watchlist?.length) {
      next.set(
        'planner_watch',
        workspace.watchlist
          .slice(0, 3)
          .map((card) => `${card.order.code}/${card.operation.step_code}/${card.exceptions.risk_state_label}`)
          .join(' | '),
      );
    }
    return `/shipments/scan?${next.toString()}`;
  }, [activeSelectedCardKeys, bucketKey, capacityState, cards, dispatchOwner, handoverStatus, machineCode, plannedDate, plannedShift, plannerReturnUrl, stepCode, workCenterCode, workspace]);
  const capacityPressureWindows = useMemo(() => (
    (workspace?.capacity_calendar ?? [])
      .flatMap((row) => row.shifts.map((shift) => ({
        row,
        shift,
        score:
          (shift.over_capacity_count * 100)
          + (shift.at_limit_count * 60)
          + (shift.needs_attention_count * 20)
          + (shift.blocked_count * 15)
          + (Number(shift.load_ratio ?? 0) * 100),
      })))
      .filter((item) => item.shift.total_operations > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 6)
  ), [workspace?.capacity_calendar]);
  const capacityDigestPack = useMemo(() => {
    const scopeSummary = workspace?.scope_summary;
    const windows = capacityPressureWindows.slice(0, 3);
    const suggestions = (workspace?.rebalance_suggestions ?? []).slice(0, 3);
    return [
      'TOM TAT CONG SUAT PLANNER',
      `Bộ lọc: ${plannerFilterSummary}`,
      `Đang hiển thị ${workspace?.summary.total_operations ?? 0}/${scopeSummary?.total_operations ?? 0} công đoạn (${getSummaryRatio(workspace?.summary, scopeSummary)}%)`,
      `Quá tải ${workspace?.summary.over_capacity_count ?? 0}/${scopeSummary?.over_capacity_count ?? 0} · Gần kín tải ${workspace?.summary.at_limit_count ?? 0}/${scopeSummary?.at_limit_count ?? 0}`,
      `Chưa gán máy ${workspace?.summary.unassigned_machine_count ?? 0} · Chưa gán WC ${workspace?.summary.unassigned_work_center_count ?? 0}`,
      `Slot quá tải ${workspace?.summary.over_capacity_slot_count ?? 0} · Tổng giờ xếp ${formatHours(workspace?.summary.total_scheduled_hours ?? 0)}`,
      workspace?.shift_watch?.[0] ? `Ca nóng: ${workspace.shift_watch[0].shift_label} · ${workspace.shift_watch[0].total_operations} công đoạn · Tải ${formatCapacityLoad(workspace.shift_watch[0].peak_load_ratio)}` : '',
      workspace?.date_watch?.[0] ? `Ngày nóng: ${workspace.date_watch[0].date ? formatDate(workspace.date_watch[0].date) : workspace.date_watch[0].date_label} · ${workspace.date_watch[0].total_operations} công đoạn` : '',
      windows.length ? 'Cửa sổ cần chú ý:' : '',
      ...windows.map(({ row, shift }) => `- ${row.date_label} / ${shift.shift_label}: ${shift.total_operations} công đoạn · Tải ${formatCapacityLoad(shift.load_ratio)} · Nghẽn ${shift.needs_attention_count}`),
      suggestions.length ? 'Đề xuất cân tải:' : '',
      ...suggestions.map((item) => `- ${item.title}`),
    ].filter(Boolean);
  }, [capacityPressureWindows, plannerFilterSummary, workspace]);
  const hotDispatchOwner = workspace?.dispatch_owner_groups?.[0] ?? null;
  const hotSalesWatch = workspace?.sales_watch?.[0] ?? null;
  const hotMaterialWatch = workspace?.material_watch?.[0] ?? null;
  const hotWorkCenterWatch = workspace?.work_center_watch?.[0] ?? null;
  const hotMachineWatch = workspace?.machine_watch?.[0] ?? null;
  const hotDeliveryWatch = workspace?.delivery_watch?.[0] ?? null;
  const hotUnscheduledWatch = workspace?.unscheduled_watch?.[0] ?? null;
  const hotShiftWatch = workspace?.shift_watch?.[0] ?? null;
  const hotDateWatch = workspace?.date_watch?.[0] ?? null;
  const hotOwnerCapacityWatch = workspace?.dispatch_owner_capacity_watch?.[0] ?? null;
  const hotStepWatch = workspace?.step_watch?.[0] ?? null;
  const hotRebalanceSummary = workspace?.rebalance_summary?.[0] ?? null;
  const rebalancePreviewPayload = useMemo(() => {
    if (!selectedRebalanceSuggestions.length) {
      return null;
    }
    return {
      items: selectedRebalanceSuggestions.map((item) => ({
        order_id: item.order_id,
        operation_id: item.operation_id,
        suggestion_key: item.key,
        suggestion_kind: item.kind,
        suggestion_title: item.title,
        severity: item.severity,
        suggested_changes: item.suggested_changes,
      })),
    };
  }, [selectedRebalanceSuggestions]);
  const windowFocusLink = useMemo(() => {
    if (!selectedCapacityWindow) {
      return '';
    }
    return buildPlannerUrl({
      planned_date: selectedCapacityWindow.date,
      planned_shift: selectedCapacityWindow.shift_key,
      focus_window_date: selectedCapacityWindow.date,
      focus_window_shift: selectedCapacityWindow.shift_key,
      capacity_state: selectedCapacityWindow.window_state === 'OVER_CAPACITY'
        ? 'OVER_CAPACITY'
        : selectedCapacityWindow.window_state === 'AT_LIMIT'
          ? 'AT_LIMIT'
          : '',
    });
  }, [selectedCapacityWindow]);
  const openCard = (card: ProductionPlanningCard) => {
    setSelectedCardKey(card.card_key);
    setFocusOperationId(String(card.operation.id));
  };
  const toggleCardSelection = (card: ProductionPlanningCard) => {
    setSelectedCardKeys((current) => (
      current.includes(card.card_key)
        ? current.filter((item) => item !== card.card_key)
        : [...current, card.card_key]
    ));
  };
  const setDateAnchor = (offsetDays: number) => {
    const anchor = plannedDate ? dayjs(plannedDate) : dayjs();
    setPlannedDate(anchor.add(offsetDays, 'day').format('YYYY-MM-DD'));
  };
  const buildDispatchPresetSnapshot = (): DispatchPresetSnapshot => ({
    planned_date: plannedDate,
    planned_shift: plannedShift,
    capacity_state: capacityState,
    risk_state: riskState,
    bucket_key: bucketKey,
    dependency_state: dependencyState,
    ready_to_dispatch: readyToDispatch,
    ready_to_run: readyToRunOnly,
    needs_attention: needsAttentionOnly,
    has_material_wait: hasMaterialWait,
    has_previous_wait: hasPreviousWait,
    view: viewMode,
  });
  const applyDispatchPresetSnapshot = (saved: DispatchPresetSnapshot) => {
    setPlannedDate(saved.planned_date);
    setPlannedShift(saved.planned_shift);
    setCapacityState(saved.capacity_state);
    setRiskState(saved.risk_state);
    setBucketKey(saved.bucket_key);
    setDependencyState(saved.dependency_state);
    setReadyToDispatch(saved.ready_to_dispatch);
    setReadyToRunOnly(saved.ready_to_run);
    setNeedsAttentionOnly(saved.needs_attention);
    setHasMaterialWait(saved.has_material_wait);
    setHasPreviousWait(saved.has_previous_wait);
    setViewMode(saved.view);
  };
  const resetDispatchPreset = () => {
    if (dispatchPresetBase) {
      applyDispatchPresetSnapshot(dispatchPresetBase);
    } else {
      setReadyToRunOnly(false);
      setNeedsAttentionOnly(false);
      setHasMaterialWait(false);
      setHasPreviousWait(false);
      setCapacityState('ALL');
      setRiskState('ALL');
      setBucketKey('ALL');
      setDependencyState('ALL');
      setReadyToDispatch('ALL');
    }
    setActiveDispatchPreset(null);
    setDispatchPresetBase(null);
  };
  const applyDispatchPreset = (preset: DispatchPresetKey) => {
    const base = dispatchPresetBase ?? buildDispatchPresetSnapshot();
    applyDispatchPresetSnapshot(base);
    setDispatchPresetBase(base);
    setActiveDispatchPreset(preset);
    setViewMode('BOARD');
    if (preset === 'DISPATCH_READY') {
      setReadyToDispatch('READY');
      return;
    }
    if (preset === 'DISPATCH_WARNING') {
      setReadyToDispatch('WARNING');
      return;
    }
    if (preset === 'DISPATCH_BLOCKER') {
      setReadyToDispatch('BLOCKER');
      return;
    }
    if (preset === 'READY_TO_RUN') {
      setReadyToRunOnly(true);
      return;
    }
    if (preset === 'UNASSIGNED_RESOURCE') {
      const unassignedMachineCount = planningUsabilitySummary.unassignedMachineCount;
      const unassignedWorkCenterCount = planningUsabilitySummary.unassignedWorkCenterCount;
      setCapacityState(unassignedWorkCenterCount > unassignedMachineCount ? 'UNASSIGNED_WORK_CENTER' : 'UNASSIGNED_MACHINE');
      return;
    }
    if (preset === 'UNSCHEDULED_SCHEDULE') {
      setPlannedDate('');
      setPlannedShift('ALL');
      setBucketKey('UNSCHEDULED');
      return;
    }
    if (preset === 'OVER_CAPACITY') {
      setCapacityState('OVER_CAPACITY');
      return;
    }
    if (preset === 'OVERDUE') {
      setPlannedDate('');
      setBucketKey('OVERDUE');
      setRiskState('OVERDUE');
      return;
    }
    setDependencyState('WAIT_PREVIOUS_STEP');
    setHasPreviousWait(true);
  };
  const isDispatchPresetFilterActive = (preset: DispatchPresetKey) => {
    if (preset === 'DISPATCH_READY') {
      return readyToDispatch === 'READY';
    }
    if (preset === 'DISPATCH_WARNING') {
      return readyToDispatch === 'WARNING';
    }
    if (preset === 'DISPATCH_BLOCKER') {
      return readyToDispatch === 'BLOCKER';
    }
    if (preset === 'READY_TO_RUN') {
      return readyToRunOnly;
    }
    if (preset === 'UNASSIGNED_RESOURCE') {
      return capacityState === 'UNASSIGNED_MACHINE' || capacityState === 'UNASSIGNED_WORK_CENTER';
    }
    if (preset === 'UNSCHEDULED_SCHEDULE') {
      return bucketKey === 'UNSCHEDULED';
    }
    if (preset === 'OVER_CAPACITY') {
      return capacityState === 'OVER_CAPACITY';
    }
    if (preset === 'OVERDUE') {
      return bucketKey === 'OVERDUE' || riskState === 'OVERDUE';
    }
    return dependencyState === 'WAIT_PREVIOUS_STEP' || hasPreviousWait;
  };
  const isDispatchPresetActive = (preset: DispatchPresetKey) => (
    activeDispatchPreset === preset || (!activeDispatchPreset && isDispatchPresetFilterActive(preset))
  );
  const getDispatchPresetCount = (preset: DispatchPresetKey) => {
    if (preset === 'DISPATCH_READY') return planningUsabilitySummary.readyDispatchCount;
    if (preset === 'DISPATCH_WARNING') return planningUsabilitySummary.dispatchWarningCount;
    if (preset === 'DISPATCH_BLOCKER') return planningUsabilitySummary.dispatchBlockerCount;
    if (preset === 'READY_TO_RUN') return planningUsabilitySummary.readyCount;
    if (preset === 'UNASSIGNED_RESOURCE') return planningUsabilitySummary.unassignedResourceCount;
    if (preset === 'UNSCHEDULED_SCHEDULE') return planningUsabilitySummary.unscheduledCount;
    if (preset === 'OVER_CAPACITY') return planningUsabilitySummary.overCapacityCount;
    if (preset === 'OVERDUE') return planningUsabilitySummary.overdueCount;
    return planningUsabilitySummary.waitPreviousCount;
  };
  const getDispatchPresetDetail = (preset: DispatchPresetKey) => {
    if (preset === 'DISPATCH_READY') {
      return 'Chỉ cảnh báo sạch, chưa chặn workflow';
    }
    if (preset === 'DISPATCH_WARNING') {
      return 'Cần rà vật tư, lịch, tài nguyên hoặc metadata';
    }
    if (preset === 'DISPATCH_BLOCKER') {
      return 'Cần xử lý readiness/dependency/block reason';
    }
    if (preset === 'UNASSIGNED_RESOURCE') {
      return `Máy ${planningUsabilitySummary.unassignedMachineCount} · Tổ ${planningUsabilitySummary.unassignedWorkCenterCount}`;
    }
    if (preset === 'UNSCHEDULED_SCHEDULE') {
      return 'Lọc nhóm chưa xếp ngày/ca';
    }
    if (preset === 'OVER_CAPACITY') {
      return `Active ${planningUsabilitySummary.activeCount} · Không tính DONE/SKIPPED`;
    }
    if (preset === 'OVERDUE') {
      return `Ảnh hưởng ${workspace?.summary.affected_sales_order_count ?? 0} SO`;
    }
    if (preset === 'WAIT_PREVIOUS_STEP') {
      return 'Giữ dependency, không thao tác vượt bước';
    }
    return `Active ${planningUsabilitySummary.activeCount}`;
  };
  const hasDispatchPresetFocus = dispatchPresetCards.some((preset) => isDispatchPresetFilterActive(preset.key));
  const handleCopyPlannerHandover = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      messageApi.error('Trinh duyet hien tai khong ho tro sao chep nhanh.');
      return;
    }
    try {
      await navigator.clipboard.writeText(plannerHandoverPack.join('\n'));
      messageApi.success('Đã sao chép gói bàn giao planner.');
    } catch {
      messageApi.error('Không thể sao chép gói bàn giao planner.');
    }
  };
  const handleCopyCapacityDigest = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      messageApi.error('Trinh duyet hien tai khong ho tro sao chep nhanh.');
      return;
    }
    try {
      await navigator.clipboard.writeText(capacityDigestPack.join('\n'));
      messageApi.success('Đã sao chép tóm tắt công suất planner.');
    } catch {
      messageApi.error('Không thể sao chép tóm tắt công suất planner.');
    }
  };
  const handleCopyPlannerDeepLink = async (path: string, successMessage: string) => {
    if (!path) {
      messageApi.info('Chưa có deeplink để sao chép.');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      messageApi.error('Trình duyệt hiện tại không hỗ trợ sao chép nhanh.');
      return;
    }
    try {
      const fullPath = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;
      await navigator.clipboard.writeText(fullPath);
      messageApi.success(successMessage);
    } catch {
      messageApi.error('Không thể sao chép deeplink planner.');
    }
  };
  const applyCapacityWindow = (shift: ProductionPlanningCapacityCalendarShift) => {
    setPlannedDate(shift.date || '');
    setPlannedShift((shift.shift_key || 'UNASSIGNED') as ShiftFilter);
    setFocusWindowDate(shift.date || '');
    setFocusWindowShift((shift.shift_key || 'UNASSIGNED') as ShiftFilter);
    setSelectedQueueKey(null);
    setViewMode('BOARD');
  };
  const applyExceptionGroupFilters = (filters: Record<string, string | number | boolean>) => {
    setBucketKey(normalizeBucket(typeof filters.bucket_key === 'string' ? filters.bucket_key : null));
    setPlannedShift(normalizeShift(typeof filters.planned_shift === 'string' ? filters.planned_shift : null));
    setReadyToRunOnly(Boolean(filters.ready_to_run));
    setNeedsAttentionOnly(Boolean(filters.needs_attention));
    setHasMaterialWait(Boolean(filters.has_material_wait));
    setHasPreviousWait(Boolean(filters.has_previous_wait));
    setViewMode('BOARD');
  };
  const applyRebalanceSuggestion = (suggestion: ProductionPlanningRebalanceSuggestion) => {
    const matchedCard = cards.find((card) => card.card_key === suggestion.card_key);
    if (!matchedCard) {
      messageApi.info('Công đoạn gợi ý không còn trong bộ lọc hiện tại.');
      return;
    }
    openCard(matchedCard);
    const nextValues = {
      status: matchedCard.operation.status,
      planned_date: suggestion.suggested_changes.planned_date
        ? dayjs(suggestion.suggested_changes.planned_date)
        : (matchedCard.operation.planned_date ? dayjs(matchedCard.operation.planned_date) : null),
      planned_shift: suggestion.suggested_changes.planned_shift || matchedCard.operation.planned_shift || 'ALL',
      priority_rank: matchedCard.operation.priority_rank ?? 100,
      dispatch_sequence: matchedCard.operation.dispatch_sequence ?? 100,
      work_center_code: suggestion.suggested_changes.work_center_code ?? matchedCard.operation.work_center_code ?? '',
      work_center_name: suggestion.suggested_changes.work_center_name ?? matchedCard.operation.work_center_name ?? '',
      machine_code: suggestion.suggested_changes.machine_code ?? matchedCard.operation.machine_code ?? '',
      machine_name: suggestion.suggested_changes.machine_name ?? matchedCard.operation.machine_name ?? '',
      estimated_runtime_hours: matchedCard.operation.estimated_runtime_hours ? Number(matchedCard.operation.estimated_runtime_hours) : 0,
      setup_minutes: matchedCard.operation.setup_minutes ?? 0,
      block_reason_code: matchedCard.operation.block_reason_code || '',
      block_reason_note: matchedCard.operation.block_reason_note || '',
      note: matchedCard.operation.note || '',
    };
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        form.setFieldsValue(nextValues);
      }, 0);
    } else {
      form.setFieldsValue(nextValues);
    }
    messageApi.success('Đã nạp đề xuất vào drawer điều độ.');
  };
  const toggleRebalanceSuggestionSelection = (suggestion: ProductionPlanningRebalanceSuggestion) => {
    setSelectedSuggestionKeys((current) => (
      current.includes(suggestion.key)
        ? current.filter((item) => item !== suggestion.key)
        : [...current, suggestion.key]
    ));
  };
  const openQueueDetail = (queue: ProductionPlanningMachineQueue) => {
    setFocusWindowDate(queue.planned_date || '');
    setFocusWindowShift((queue.shift_key || 'UNASSIGNED') as ShiftFilter);
    setSelectedQueueKey(queue.key);
  };
  const handleSelectAllRebalanceSuggestions = () => {
    setSelectedSuggestionKeys((workspace?.rebalance_suggestions ?? []).map((item) => item.key));
  };
  const handleClearRebalanceSuggestions = () => {
    setSelectedSuggestionKeys([]);
  };
  const handleSelectRebalanceSummary = (summary: ProductionPlanningRebalanceSummaryItem) => {
    if (!summary.suggestion_keys.length) {
      messageApi.info('Nhóm gợi ý này chưa có đề xuất hợp lệ để chọn.');
      return;
    }
    setSelectedSuggestionKeys(summary.suggestion_keys);
    messageApi.success(`Đã chọn ${summary.suggestion_keys.length} gợi ý ${summary.kind_label.toLowerCase()}.`);
  };
  const handleApplySelectedRebalance = async () => {
    if (!rebalancePreviewPayload) {
      messageApi.info('Chọn ít nhất một gợi ý cân tải để áp dụng.');
      return;
    }
    await rebalanceApplyMutation.mutateAsync();
  };
  const handleCopyRebalanceScenario = async () => {
    if (!rebalanceScenarioPack.length) {
      messageApi.info('Chưa có scenario cân tải để sao chép.');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      messageApi.error('Trình duyệt hiện tại không hỗ trợ sao chép nhanh.');
      return;
    }
    try {
      await navigator.clipboard.writeText(rebalanceScenarioPack.join('\n'));
      messageApi.success('Đã sao chép tóm tắt scenario cân tải.');
    } catch {
      messageApi.error('Không thể sao chép scenario cân tải.');
    }
  };

  useEffect(() => {
    if (!selectedCard) {
      form.resetFields();
      return;
    }
    form.setFieldsValue({
      status: selectedCard.operation.status,
      planned_date: selectedCard.operation.planned_date ? dayjs(selectedCard.operation.planned_date) : null,
      planned_shift: selectedCard.operation.planned_shift || 'ALL',
      priority_rank: selectedCard.operation.priority_rank ?? 100,
      dispatch_sequence: selectedCard.operation.dispatch_sequence ?? 100,
      work_center_code: selectedCard.operation.work_center_code || '',
      work_center_name: selectedCard.operation.work_center_name || '',
      machine_code: selectedCard.operation.machine_code || '',
      machine_name: selectedCard.operation.machine_name || '',
      estimated_runtime_hours: selectedCard.operation.estimated_runtime_hours ? Number(selectedCard.operation.estimated_runtime_hours) : 0,
      setup_minutes: selectedCard.operation.setup_minutes ?? 0,
      block_reason_code: selectedCard.operation.block_reason_code || '',
      block_reason_note: selectedCard.operation.block_reason_note || '',
      note: selectedCard.operation.note || '',
    });
  }, [form, selectedCard]);

  const issueQuery = useQuery({ queryKey: ['production-planning-issues', selectedCard?.order.id], queryFn: () => productionApi.getOrderIssueOverview(selectedCard!.order.id), enabled: Boolean(selectedCard?.order.id) });
  const receiptQuery = useQuery({ queryKey: ['production-planning-receipts', selectedCard?.order.id], queryFn: () => productionApi.getOrderReceiptOverview(selectedCard!.order.id), enabled: Boolean(selectedCard?.order.id) });
  const timelineQuery = useQuery({
    queryKey: ['production-planning-timeline', selectedCard?.order.id],
    queryFn: () => workflowTaskTemplatesApi.getPipelineTimeline({ entity_type: 'ProductionOrder', entity_id: selectedCard!.order.id, limit: 20 }),
    enabled: Boolean(selectedCard?.order.id),
  });

  const buildOperationPayload = (values: Record<string, unknown>) => {
    if (!selectedCard) throw new Error('Thiếu công đoạn.');
    return {
      operation_id: selectedCard.operation.id,
      status: values.status as string,
      planned_date: values.planned_date ? dayjs(values.planned_date as dayjs.Dayjs).format('YYYY-MM-DD') : null,
      planned_shift: values.planned_shift === 'ALL' ? '' : (values.planned_shift as string),
      priority_rank: values.priority_rank as number,
      dispatch_sequence: values.dispatch_sequence as number,
      work_center_code: String(values.work_center_code || '').trim(),
      work_center_name: String(values.work_center_name || '').trim(),
      machine_code: String(values.machine_code || '').trim(),
      machine_name: String(values.machine_name || '').trim(),
      estimated_runtime_hours: values.estimated_runtime_hours as number,
      setup_minutes: values.setup_minutes as number,
      block_reason_code: (values.block_reason_code as string) || '',
      block_reason_note: String(values.block_reason_note || '').trim(),
      note: String(values.note || '').trim(),
    };
  };

  const previewPayload = useMemo(() => {
    if (!selectedCard) {
      return null;
    }
    const nextPlannedDate = watchedPlannedDate !== undefined
      ? watchedPlannedDate
      : (selectedCard.operation.planned_date ? dayjs(selectedCard.operation.planned_date) : null);
    const nextPlannedShift = watchedPlannedShift ?? (selectedCard.operation.planned_shift || 'ALL');
    return {
      operation_id: selectedCard.operation.id,
      status: (watchedStatus || selectedCard.operation.status) as string,
      planned_date: nextPlannedDate ? dayjs(nextPlannedDate as dayjs.Dayjs).format('YYYY-MM-DD') : null,
      planned_shift: nextPlannedShift === 'ALL' ? '' : String(nextPlannedShift),
      priority_rank: watchedPriorityRank ?? selectedCard.operation.priority_rank ?? 100,
      dispatch_sequence: watchedDispatchSequence ?? selectedCard.operation.dispatch_sequence ?? 100,
      work_center_code: String(watchedWorkCenterCode ?? selectedCard.operation.work_center_code ?? '').trim(),
      work_center_name: String(watchedWorkCenterName ?? selectedCard.operation.work_center_name ?? '').trim(),
      machine_code: String(watchedMachineCode ?? selectedCard.operation.machine_code ?? '').trim(),
      machine_name: String(watchedMachineName ?? selectedCard.operation.machine_name ?? '').trim(),
      estimated_runtime_hours: watchedEstimatedRuntimeHours ?? Number(selectedCard.operation.estimated_runtime_hours ?? 0),
      setup_minutes: watchedSetupMinutes ?? selectedCard.operation.setup_minutes ?? 0,
      block_reason_code: String(watchedBlockReasonCode ?? selectedCard.operation.block_reason_code ?? ''),
      block_reason_note: String(watchedBlockReasonNote ?? selectedCard.operation.block_reason_note ?? '').trim(),
      note: String(form.getFieldValue('note') ?? selectedCard.operation.note ?? '').trim(),
    };
  }, [
    form,
    selectedCard,
    watchedBlockReasonCode,
    watchedBlockReasonNote,
    watchedDispatchSequence,
    watchedEstimatedRuntimeHours,
    watchedMachineCode,
    watchedMachineName,
    watchedPlannedDate,
    watchedPlannedShift,
    watchedPriorityRank,
    watchedSetupMinutes,
    watchedStatus,
    watchedWorkCenterCode,
    watchedWorkCenterName,
  ]);

  const previewBlockedBySkip = Boolean(previewPayload?.status === 'SKIPPED');
  const previewBlockedByValidation = Boolean(
    previewPayload
      && (
        (previewPayload.block_reason_code === 'OTHER' && !String(previewPayload.block_reason_note || '').trim())
        || (String(previewPayload.machine_code || '').trim() && !String(previewPayload.work_center_code || '').trim())
        || previewBlockedBySkip
        || (selectedCard && isStatusChangeBlockedByDependency(selectedCard, previewPayload.status))
      ),
  );
  const previewBlockedByDependency = Boolean(selectedCard && previewPayload && isStatusChangeBlockedByDependency(selectedCard, previewPayload.status));
  const hasPreviewChanges = Boolean(
    selectedCard
      && previewPayload
      && (
        previewPayload.status !== selectedCard.operation.status
        || (previewPayload.planned_date || null) !== (selectedCard.operation.planned_date || null)
        || (previewPayload.planned_shift || '') !== (selectedCard.operation.planned_shift || '')
        || Number(previewPayload.priority_rank ?? 100) !== Number(selectedCard.operation.priority_rank ?? 100)
        || Number(previewPayload.dispatch_sequence ?? 100) !== Number(selectedCard.operation.dispatch_sequence ?? 100)
        || (previewPayload.work_center_code || '') !== (selectedCard.operation.work_center_code || '')
        || (previewPayload.work_center_name || '') !== (selectedCard.operation.work_center_name || '')
        || (previewPayload.machine_code || '') !== (selectedCard.operation.machine_code || '')
        || (previewPayload.machine_name || '') !== (selectedCard.operation.machine_name || '')
        || Number(previewPayload.estimated_runtime_hours ?? 0) !== Number(selectedCard.operation.estimated_runtime_hours ?? 0)
        || Number(previewPayload.setup_minutes ?? 0) !== Number(selectedCard.operation.setup_minutes ?? 0)
        || (previewPayload.block_reason_code || '') !== (selectedCard.operation.block_reason_code || '')
        || (previewPayload.block_reason_note || '') !== (selectedCard.operation.block_reason_note || '')
        || (previewPayload.note || '') !== (selectedCard.operation.note || '')
      ),
  );
  const previewQuery = useQuery({
    queryKey: ['production-planning-preview', selectedCard?.order.id, previewPayload],
    queryFn: () => productionApi.previewOperationUpdate(selectedCard!.order.id, previewPayload!),
    enabled: Boolean(selectedCard && canEditSelectedCard && previewPayload && hasPreviewChanges && !previewBlockedByValidation),
  });
  const previewHighlights = useMemo(() => {
    const data = previewQuery.data;
    if (!data) {
      return [];
    }
    const highlights: string[] = [];
    if (data.impact.bucket_changed) {
      highlights.push(`${data.current.bucket.label} -> ${data.preview.bucket.label}`);
    }
    if (data.impact.risk_changed) {
      highlights.push(`${data.current.exceptions.risk_state_label} -> ${data.preview.exceptions.risk_state_label}`);
    }
    if (data.impact.ready_to_run_changed) {
      highlights.push(data.preview.materials.ready_to_run ? 'Công đoạn sẽ sang trạng thái sẵn chạy.' : 'Công đoạn không còn sẵn chạy.');
    }
    if (data.impact.ready_to_dispatch_changed) {
      highlights.push(`Ready-to-dispatch: ${getReadyToDispatchStatus(data.current)} -> ${getReadyToDispatchStatus(data.preview)}.`);
    }
    if (data.impact.needs_attention_changed) {
      highlights.push(data.preview.exceptions.needs_attention ? 'Cần xử lý liên phòng ban sau khi đổi lịch.' : 'Mức cần xử lý sẽ giảm sau khi cập nhật.');
    }
    if (data.impact.delivery_gap_delta !== null && data.impact.delivery_gap_delta !== undefined && data.impact.delivery_gap_delta !== 0) {
      highlights.push(
        data.impact.delivery_gap_delta > 0
          ? `Bộ đệm giao hàng dự kiến rộng hơn ${data.impact.delivery_gap_delta} ngày.`
          : `Bộ đệm giao hàng sẽ giảm ${Math.abs(data.impact.delivery_gap_delta)} ngày sau khi cập nhật.`,
      );
    }
    if (data.impact.handover_status_changed) {
      highlights.push(`Bàn giao: ${data.current.shop_floor.handover_status_label || 'Chưa chốt'} -> ${data.preview.shop_floor.handover_status_label || 'Chưa chốt'}`);
    }
    if (data.impact.capacity_state_changed) {
      highlights.push(`Công suất: ${data.current.capacity.capacity_state_label} -> ${data.preview.capacity.capacity_state_label}`);
    }
    if (data.impact.work_center_changed) {
      highlights.push(`Trung tâm công việc: ${data.current.capacity.work_center_name || data.current.capacity.work_center_code || 'Chưa gán'} -> ${data.preview.capacity.work_center_name || data.preview.capacity.work_center_code || 'Chưa gán'}`);
    }
    if (data.impact.machine_changed) {
      highlights.push(`Máy: ${data.current.capacity.machine_name || data.current.capacity.machine_code || 'Chưa gán'} -> ${data.preview.capacity.machine_name || data.preview.capacity.machine_code || 'Chưa gán'}`);
    }
    if (data.impact.work_center_load_ratio_delta !== null && data.impact.work_center_load_ratio_delta !== undefined && data.impact.work_center_load_ratio_delta !== 0) {
      highlights.push(
        data.impact.work_center_load_ratio_delta > 0
          ? `Tải work center tăng thêm ${Math.round(data.impact.work_center_load_ratio_delta * 100)}%.`
          : `Tải work center giảm ${Math.abs(Math.round(data.impact.work_center_load_ratio_delta * 100))}%.`,
      );
    }
    return highlights;
  }, [previewQuery.data]);

  const updateMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      if (!selectedCard) throw new Error('Thiếu công đoạn.');
      return productionApi.updateOperation(selectedCard.order.id, buildOperationPayload(values));
    },
    onSuccess: async () => {
      messageApi.success('Đã cập nhật công đoạn.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['production-planning-board'] }),
        queryClient.invalidateQueries({ queryKey: ['production-planning-issues'] }),
        queryClient.invalidateQueries({ queryKey: ['production-planning-receipts'] }),
        queryClient.invalidateQueries({ queryKey: ['production-planning-timeline'] }),
      ]);
    },
    onError: (error) => {
      messageApi.error(getPlanningActionErrorMessage(error));
      void queryClient.invalidateQueries({ queryKey: ['production-planning-board'] });
    },
  });
  const skipMutation = useMutation({
    mutationFn: (values: SkipFormValues) => {
      if (!selectedCard) throw new Error('Thiếu công đoạn.');
      const reason = String(values.reason || '').trim();
      return productionApi.skipOperation(selectedCard.order.id, {
        operation_id: selectedCard.operation.id,
        reason,
      });
    },
    onSuccess: async (result) => {
      const operationLabel = result.operation?.step_name || result.operation?.step_code || selectedCard?.operation.step_name || 'công đoạn';
      messageApi.success(`Đã bỏ qua công đoạn ${operationLabel}.`);
      setIsSkipModalOpen(false);
      skipForm.resetFields();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['production-planning-board'] }),
        queryClient.invalidateQueries({ queryKey: ['production-planning-issues'] }),
        queryClient.invalidateQueries({ queryKey: ['production-planning-receipts'] }),
        queryClient.invalidateQueries({ queryKey: ['production-planning-timeline'] }),
        queryClient.invalidateQueries({ queryKey: ['production-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['production-orders-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['production-order-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['production-demands'] }),
        queryClient.invalidateQueries({ queryKey: ['production-demands-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['production-demand-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-production-summary'] }),
      ]);
    },
    onError: (error) => {
      messageApi.error(getPlanningActionErrorMessage(error));
      void queryClient.invalidateQueries({ queryKey: ['production-planning-board'] });
    },
  });
  const buildBulkChanges = (values: BulkFormValues) => {
    const changes: Record<string, unknown> = {};
    if (values.status) {
      changes.status = values.status;
    }
    if (values.planned_date) {
      changes.planned_date = dayjs(values.planned_date).format('YYYY-MM-DD');
    }
    if (values.planned_shift) {
      changes.planned_shift = values.planned_shift === '__CLEAR__' ? '' : values.planned_shift;
    }
    if (values.priority_rank !== undefined && values.priority_rank !== null) {
      changes.priority_rank = values.priority_rank;
    }
    if (values.dispatch_sequence !== undefined && values.dispatch_sequence !== null) {
      changes.dispatch_sequence = values.dispatch_sequence;
    }
    if (values.work_center_code !== undefined) {
      changes.work_center_code = String(values.work_center_code || '').trim();
    }
    if (values.work_center_name !== undefined) {
      changes.work_center_name = String(values.work_center_name || '').trim();
    }
    if (values.machine_code !== undefined) {
      changes.machine_code = String(values.machine_code || '').trim();
    }
    if (values.machine_name !== undefined) {
      changes.machine_name = String(values.machine_name || '').trim();
    }
    if (values.estimated_runtime_hours !== undefined && values.estimated_runtime_hours !== null) {
      changes.estimated_runtime_hours = values.estimated_runtime_hours;
    }
    if (values.setup_minutes !== undefined && values.setup_minutes !== null) {
      changes.setup_minutes = values.setup_minutes;
    }
    if (values.block_reason_code) {
      changes.block_reason_code = values.block_reason_code === '__CLEAR__' ? '' : values.block_reason_code;
      if (values.block_reason_code === '__CLEAR__') {
        changes.block_reason_note = '';
      }
    }
    if (String(values.block_reason_note || '').trim()) {
      changes.block_reason_note = String(values.block_reason_note || '').trim();
    }
    if (String(values.note || '').trim()) {
      changes.note = String(values.note || '').trim();
    }
    return changes;
  };
  const bulkSelectionSummary = useMemo(() => {
    const activeCards = selectedCards.filter((card) => !isInactiveOperationStatus(card.operation.status));
    const activeScheduledHours = activeCards.reduce((total, card) => total + Number(card.capacity.scheduled_hours || 0), 0);
    return {
      total: selectedCards.length,
      activeCount: activeCards.length,
      activeScheduledHours,
      readyCount: activeCards.filter((card) => card.materials.ready_to_run).length,
      dependencyBlockedCount: activeCards.filter(isDependencyBlocked).length,
      doneOrSkippedCount: selectedCards.filter((card) => card.operation.status === 'DONE' || card.operation.status === 'SKIPPED').length,
      overCapacityCount: activeCards.filter((card) => card.capacity.capacity_state === 'OVER_CAPACITY' || card.capacity.over_capacity).length,
      atLimitCount: activeCards.filter((card) => card.capacity.capacity_state === 'AT_LIMIT').length,
      deliveryRiskCount: activeCards.filter((card) => card.exceptions.risk_state === 'AT_RISK').length,
      unassignedResourceCount: activeCards.filter((card) => card.capacity.unassigned_machine || card.capacity.unassigned_work_center).length,
      unscheduledCount: activeCards.filter((card) => !card.operation.planned_date || !card.operation.planned_shift).length,
    };
  }, [selectedCards]);
  const bulkSelectionWarnings = useMemo(() => buildPlanningWarningItemsFromCounts({
    overCapacityCount: bulkSelectionSummary.overCapacityCount,
    atLimitCount: bulkSelectionSummary.atLimitCount,
    deliveryRiskCount: bulkSelectionSummary.deliveryRiskCount,
    unassignedResourceCount: bulkSelectionSummary.unassignedResourceCount,
    unscheduledCount: bulkSelectionSummary.unscheduledCount,
    dependencyBlockedCount: bulkSelectionSummary.dependencyBlockedCount,
    inactiveCount: bulkSelectionSummary.doneOrSkippedCount,
  }), [bulkSelectionSummary]);
  const bulkTargetSummary = useMemo(() => {
    const items = [
      watchedBulkPlannedDate ? `Ngày ${formatDate(dayjs(watchedBulkPlannedDate).format('YYYY-MM-DD'))}` : '',
      watchedBulkPlannedShift ? `Ca ${watchedBulkPlannedShift === '__CLEAR__' ? 'Bỏ xếp ca' : shiftFormOptions.find((item) => item.value === watchedBulkPlannedShift)?.label || watchedBulkPlannedShift}` : '',
      watchedBulkWorkCenterCode ? `Tổ ${workCenterByCode.get(normalizeResourceCode(watchedBulkWorkCenterCode))?.name || watchedBulkWorkCenterName || watchedBulkWorkCenterCode}` : '',
      watchedBulkMachineCode ? `Máy ${machineByCode.get(normalizeResourceCode(watchedBulkMachineCode))?.name || watchedBulkMachineName || watchedBulkMachineCode}` : '',
      watchedBulkDispatchSequence ? `Seq ${watchedBulkDispatchSequence}` : '',
      watchedBulkPriorityRank ? `Ưu tiên ${watchedBulkPriorityRank}` : '',
      watchedBulkEstimatedRuntimeHours !== undefined && watchedBulkEstimatedRuntimeHours !== null ? `Runtime ${formatHours(watchedBulkEstimatedRuntimeHours)}` : '',
      watchedBulkSetupMinutes !== undefined && watchedBulkSetupMinutes !== null ? `Setup ${watchedBulkSetupMinutes} phút` : '',
    ].filter(Boolean);
    return items.length ? items.join(' · ') : 'Chưa chọn thay đổi điều độ.';
  }, [
    machineByCode,
    shiftFormOptions,
    watchedBulkDispatchSequence,
    watchedBulkEstimatedRuntimeHours,
    watchedBulkMachineCode,
    watchedBulkMachineName,
    watchedBulkPlannedDate,
    watchedBulkPlannedShift,
    watchedBulkPriorityRank,
    watchedBulkSetupMinutes,
    watchedBulkWorkCenterCode,
    watchedBulkWorkCenterName,
    workCenterByCode,
  ]);
  const bulkPreviewPayload = useMemo(() => {
    if (!selectedCards.length || !isBulkModalOpen) {
      return null;
    }
    const changes = buildBulkChanges({
      status: watchedBulkStatus,
      planned_date: watchedBulkPlannedDate,
      planned_shift: watchedBulkPlannedShift,
      priority_rank: watchedBulkPriorityRank,
      dispatch_sequence: watchedBulkDispatchSequence,
      work_center_code: watchedBulkWorkCenterCode,
      work_center_name: watchedBulkWorkCenterName,
      machine_code: watchedBulkMachineCode,
      machine_name: watchedBulkMachineName,
      estimated_runtime_hours: watchedBulkEstimatedRuntimeHours,
      setup_minutes: watchedBulkSetupMinutes,
      block_reason_code: watchedBulkBlockReasonCode,
      block_reason_note: watchedBulkBlockReasonNote,
      note: watchedBulkNote,
    });
    if (!Object.keys(changes).length) {
      return null;
    }
    return {
      items: selectedCards.map((card) => ({
        order_id: card.order.id,
        operation_id: card.operation.id,
      })),
      changes,
    };
  }, [isBulkModalOpen, selectedCards, watchedBulkBlockReasonCode, watchedBulkBlockReasonNote, watchedBulkDispatchSequence, watchedBulkEstimatedRuntimeHours, watchedBulkMachineCode, watchedBulkMachineName, watchedBulkNote, watchedBulkPlannedDate, watchedBulkPlannedShift, watchedBulkPriorityRank, watchedBulkSetupMinutes, watchedBulkStatus, watchedBulkWorkCenterCode, watchedBulkWorkCenterName]);
  const bulkPreviewBlockedBySkip = Boolean(bulkPreviewPayload?.changes.status === 'SKIPPED');
  const bulkPreviewBlockedByValidation = Boolean(
    bulkPreviewPayload
      && (
        (bulkPreviewPayload.changes.block_reason_code === 'OTHER' && !String(bulkPreviewPayload.changes.block_reason_note || '').trim())
        || (String(bulkPreviewPayload.changes.machine_code || '').trim() && !String(bulkPreviewPayload.changes.work_center_code || '').trim())
        || bulkPreviewBlockedBySkip
        || getBlockedStatusChangeCount(selectedCards, bulkPreviewPayload.changes.status) > 0
      ),
  );
  const bulkPreviewBlockedByDependency = Boolean(
    bulkPreviewPayload
    && getBlockedStatusChangeCount(selectedCards, bulkPreviewPayload.changes.status) > 0
  );
  const bulkPreviewQuery = useQuery({
    queryKey: ['production-planning-bulk-preview', bulkPreviewPayload],
    queryFn: () => productionApi.previewBulkUpdateOperations(bulkPreviewPayload!),
    enabled: Boolean(canPlanProduction && bulkPreviewPayload && !bulkPreviewBlockedByValidation),
  });
  useEffect(() => {
    if (previewQuery.error && isPlanningDependencyError(previewQuery.error)) {
      void queryClient.invalidateQueries({ queryKey: ['production-planning-board'] });
    }
  }, [previewQuery.error, queryClient]);
  useEffect(() => {
    if (bulkPreviewQuery.error && isPlanningDependencyError(bulkPreviewQuery.error)) {
      void queryClient.invalidateQueries({ queryKey: ['production-planning-board'] });
    }
  }, [bulkPreviewQuery.error, queryClient]);
  const bulkUpdateMutation = useMutation({
    mutationFn: (values: BulkFormValues) => {
      const changes = buildBulkChanges(values);
      if (!Object.keys(changes).length) {
        throw new Error('Chưa có thay đổi nào để áp dụng hàng loạt.');
      }
      if (changes.block_reason_code === 'OTHER' && !String(changes.block_reason_note || '').trim()) {
        throw new Error('Vui lòng mô tả rõ lý do nghẽn khi chọn Khác.');
      }
      if (String(changes.machine_code || '').trim() && !String(changes.work_center_code || '').trim()) {
        throw new Error('Cần nhập work center trước khi gán máy.');
      }
      const blockedStatusChangeCount = getBlockedStatusChangeCount(selectedCards, changes.status);
      if (blockedStatusChangeCount > 0) {
        throw new Error(getDependencyBlockedSelectionMessage(blockedStatusChangeCount));
      }
      return productionApi.bulkUpdateOperations({
        items: selectedCards.map((card) => ({
          order_id: card.order.id,
          operation_id: card.operation.id,
        })),
        changes,
      });
    },
    onSuccess: async (result) => {
      messageApi.success(`Đã cập nhật ${result.updated_count} công đoạn.`);
      setIsBulkModalOpen(false);
      bulkForm.resetFields();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['production-planning-board'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-production-summary'] }),
      ]);
    },
    onError: (error) => {
      messageApi.error(getPlanningActionErrorMessage(error));
      void queryClient.invalidateQueries({ queryKey: ['production-planning-board'] });
    },
  });
  const rebalancePreviewQuery = useQuery({
    queryKey: ['production-planning-rebalance-preview', rebalancePreviewPayload],
    queryFn: () => productionApi.previewRebalanceSuggestions(rebalancePreviewPayload!),
    enabled: Boolean(canPlanProduction && rebalancePreviewPayload),
  });
  const rebalanceApplyMutation = useMutation({
    mutationFn: () => productionApi.applyRebalanceSuggestions(rebalancePreviewPayload!),
    onSuccess: async (result) => {
      messageApi.success(`Da ap dung ${result.updated_count} goi y rebalance.`);
      setSelectedSuggestionKeys([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['production-planning-board'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-production-summary'] }),
      ]);
    },
    onError: (error) => {
      messageApi.error(getPlanningActionErrorMessage(error));
      void queryClient.invalidateQueries({ queryKey: ['production-planning-board'] });
    },
  });
  const queueCandidates = useMemo(() => {
    const merged = new Map<string, ProductionPlanningMachineQueue>();
    (workspace?.machine_queues ?? []).forEach((queue) => {
      merged.set(queue.key, queue);
    });
    (rebalancePreviewQuery.data?.machine_queue_highlights ?? []).forEach((queue) => {
      if (!merged.has(queue.key)) {
        merged.set(queue.key, queue);
      }
    });
    return Array.from(merged.values());
  }, [rebalancePreviewQuery.data?.machine_queue_highlights, workspace?.machine_queues]);
  const selectedQueue = useMemo(
    () => queueCandidates.find((queue) => queue.key === selectedQueueKey) ?? null,
    [queueCandidates, selectedQueueKey],
  );
  const queueDetailCards = useMemo(() => {
    if (!selectedQueue) {
      return [];
    }
    const currentCards = cards
      .filter((card) => (
        String(card.capacity.machine_code || '').trim().toUpperCase() === String(selectedQueue.machine_code || '').trim().toUpperCase()
        && String(card.capacity.work_center_code || '').trim().toUpperCase() === String(selectedQueue.work_center_code || '').trim().toUpperCase()
        && String(card.operation.planned_date || '') === String(selectedQueue.planned_date || '')
        && String(card.capacity.shift_key || '').trim().toUpperCase() === String(selectedQueue.shift_key || '').trim().toUpperCase()
      ))
      .sort((left, right) => (
        Number(left.operation.dispatch_sequence ?? 99999) - Number(right.operation.dispatch_sequence ?? 99999)
        || Number(left.operation.priority_rank ?? 99999) - Number(right.operation.priority_rank ?? 99999)
        || String(left.order.code || '').localeCompare(String(right.order.code || ''))
      ));
    if (currentCards.length) {
      return currentCards;
    }
    return (rebalancePreviewQuery.data?.operations ?? [])
      .map((item) => item.preview)
      .filter((card) => (
        String(card.capacity.machine_code || '').trim().toUpperCase() === String(selectedQueue.machine_code || '').trim().toUpperCase()
        && String(card.capacity.work_center_code || '').trim().toUpperCase() === String(selectedQueue.work_center_code || '').trim().toUpperCase()
        && String(card.operation.planned_date || '') === String(selectedQueue.planned_date || '')
        && String(card.capacity.shift_key || '').trim().toUpperCase() === String(selectedQueue.shift_key || '').trim().toUpperCase()
      ))
      .sort((left, right) => (
        Number(left.operation.dispatch_sequence ?? 99999) - Number(right.operation.dispatch_sequence ?? 99999)
        || Number(left.operation.priority_rank ?? 99999) - Number(right.operation.priority_rank ?? 99999)
        || String(left.order.code || '').localeCompare(String(right.order.code || ''))
      ));
  }, [cards, rebalancePreviewQuery.data?.operations, selectedQueue]);
  const queueDetailRows = useMemo(() => {
    return queueDetailCards.reduce<Array<{ key: string; card: ProductionPlanningCard; sequence: number; cumulativeHours: number }>>((rows, card, index) => {
      const previousHours = rows[rows.length - 1]?.cumulativeHours ?? 0;
      return [
        ...rows,
        {
          key: card.card_key,
          card,
          sequence: index + 1,
          cumulativeHours: previousHours + Number(card.capacity.scheduled_hours || 0),
        },
      ];
    }, []);
  }, [queueDetailCards]);
  const queueDetailSignature = useMemo(
    () => queueDetailRows.map((row) => `${row.key}:${row.card.operation.dispatch_sequence ?? ''}:${row.card.operation.status}`).join('|'),
    [queueDetailRows],
  );
  const queueSequenceDraftScopeKey = `${selectedQueueKey || ''}:${queueDetailSignature}`;
  const queueSequenceDraft = queueSequenceDraftState.scopeKey === queueSequenceDraftScopeKey
    ? queueSequenceDraftState.values
    : EMPTY_QUEUE_SEQUENCE_DRAFT;
  const queueSequenceRows = useMemo<QueueSequenceRow[]>(() => {
    const draftRows = queueDetailRows.map((row) => {
      const currentSequence = normalizeDispatchSequenceValue(row.card.operation.dispatch_sequence);
      const draftValue = Object.prototype.hasOwnProperty.call(queueSequenceDraft, row.key)
        ? queueSequenceDraft[row.key]
        : currentSequence;
      const nextSequence = draftValue === null ? null : normalizeDispatchSequenceValue(draftValue);
      const isInactive = isInactiveOperationStatus(row.card.operation.status);
      const canSequence = !isInactive && ['RELEASED', 'IN_PROGRESS'].includes(row.card.order.status);
      return {
        ...row,
        draftPosition: row.sequence,
        draftCumulativeHours: row.cumulativeHours,
        currentSequence,
        nextSequence,
        isInactive,
        canSequence,
        hasChanged: canSequence && nextSequence !== null && nextSequence !== currentSequence,
      };
    });
    return [...draftRows]
      .sort((left, right) => (
        (left.nextSequence ?? 99999) - (right.nextSequence ?? 99999)
        || Number(left.card.operation.priority_rank ?? 99999) - Number(right.card.operation.priority_rank ?? 99999)
        || String(left.card.order.code || '').localeCompare(String(right.card.order.code || ''), 'vi')
      ))
      .reduce<QueueSequenceRow[]>((rows, row, index) => {
        const previousHours = rows[rows.length - 1]?.draftCumulativeHours ?? 0;
        const draftCumulativeHours = previousHours + (row.isInactive ? 0 : Number(row.card.capacity.scheduled_hours || 0));
        return [
          ...rows,
          {
            ...row,
            draftPosition: index + 1,
            draftCumulativeHours,
          },
        ];
      }, []);
  }, [queueDetailRows, queueSequenceDraft]);
  const queueEditableRows = useMemo(
    () => queueSequenceRows.filter((row) => row.canSequence),
    [queueSequenceRows],
  );
  const queueSequenceChangedRows = useMemo(
    () => queueEditableRows.filter((row) => row.hasChanged),
    [queueEditableRows],
  );
  const queueSequenceInvalidRows = useMemo(
    () => queueEditableRows.filter((row) => row.nextSequence === null || row.nextSequence < 1 || row.nextSequence > 99999 || !Number.isInteger(row.nextSequence)),
    [queueEditableRows],
  );
  const queueSequenceDuplicateValues = useMemo(() => {
    const counts = new Map<number, number>();
    queueEditableRows.forEach((row) => {
      if (row.nextSequence !== null) {
        counts.set(row.nextSequence, (counts.get(row.nextSequence) ?? 0) + 1);
      }
    });
    return Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([sequence]) => sequence);
  }, [queueEditableRows]);
  const queueSequenceSummary = useMemo(() => ({
    total: queueSequenceRows.length,
    activeCount: queueSequenceRows.filter((row) => !row.isInactive).length,
    editableCount: queueEditableRows.length,
    changedCount: queueSequenceChangedRows.length,
    inactiveCount: queueSequenceRows.filter((row) => row.isInactive).length,
    lockedOrderCount: queueSequenceRows.filter((row) => !row.isInactive && !row.canSequence).length,
    dependencyBlockedCount: queueEditableRows.filter((row) => isDependencyBlocked(row.card)).length,
    activeScheduledHours: queueSequenceRows.filter((row) => !row.isInactive).reduce((total, row) => total + Number(row.card.capacity.scheduled_hours || 0), 0),
  }), [queueEditableRows, queueSequenceChangedRows.length, queueSequenceRows]);
  const queueWarningItems = useMemo(() => {
    const items = buildPlanningWarningItemsFromCounts({
      overCapacityCount: selectedQueue?.overloaded ? 1 : 0,
      unscheduledCount: selectedQueue && (!selectedQueue.planned_date || !selectedQueue.shift_key) ? 1 : 0,
      dependencyBlockedCount: queueSequenceSummary.dependencyBlockedCount,
      inactiveCount: queueSequenceSummary.inactiveCount,
    });
    return items.map((item) => {
      if (item.key === 'over-capacity' && selectedQueue) {
        return {
          ...item,
          title: 'Queue quá tải',
          reason: `Tải queue ${formatCapacityLoad(selectedQueue.load_ratio)} · ${formatHours(selectedQueue.scheduled_hours)}/${formatHours(selectedQueue.capacity_hours)}.`,
          action: 'Giảm giờ active, đổi máy hoặc dời ngày/ca trước khi chốt queue.',
        };
      }
      if (item.key === 'dependency-blocked') {
        return {
          ...item,
          reason: `${queueSequenceSummary.dependencyBlockedCount} công đoạn active đang chờ công đoạn trước.`,
        };
      }
      if (item.key === 'inactive-done-skipped') {
        return {
          ...item,
          reason: `${queueSequenceSummary.inactiveCount} công đoạn DONE/SKIPPED vẫn hiển thị để đối chiếu.`,
        };
      }
      return item;
    });
  }, [queueSequenceSummary.dependencyBlockedCount, queueSequenceSummary.inactiveCount, selectedQueue]);
  const queueSequenceMutation = useMutation({
    mutationFn: async () => {
      if (!selectedQueue) {
        throw new Error('Chưa chọn queue máy.');
      }
      if (!queueSequenceChangedRows.length) {
        throw new Error('Chưa có thay đổi thứ tự dispatch.');
      }
      if (queueSequenceInvalidRows.length) {
        throw new Error('Thứ tự dispatch phải là số nguyên từ 1 đến 99999.');
      }
      if (queueSequenceDuplicateValues.length) {
        throw new Error(`Thứ tự dispatch bị trùng: ${queueSequenceDuplicateValues.join(', ')}.`);
      }
      for (const row of queueSequenceChangedRows) {
        await productionApi.updateOperation(row.card.order.id, {
          operation_id: row.card.operation.id,
          dispatch_sequence: row.nextSequence,
        });
      }
      return { updatedCount: queueSequenceChangedRows.length };
    },
    onSuccess: async (result) => {
      messageApi.success(`Đã cập nhật thứ tự dispatch cho ${result.updatedCount} công đoạn.`);
      setQueueSequenceDraftState({ scopeKey: queueSequenceDraftScopeKey, values: EMPTY_QUEUE_SEQUENCE_DRAFT });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['production-planning-board'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-production-summary'] }),
      ]);
    },
    onError: (error) => {
      messageApi.error(getPlanningActionErrorMessage(error));
      void queryClient.invalidateQueries({ queryKey: ['production-planning-board'] });
    },
  });
  const queueFocusLink = useMemo(() => {
    if (!selectedQueue) {
      return '';
    }
    return buildPlannerUrl({
      view: 'LIST',
      machine_code: selectedQueue.machine_code,
      work_center_code: selectedQueue.work_center_code,
      planned_date: selectedQueue.planned_date,
      planned_shift: selectedQueue.shift_key,
      focus_window_date: selectedQueue.planned_date,
      focus_window_shift: selectedQueue.shift_key,
      queue_key: selectedQueue.key,
    });
  }, [selectedQueue]);
  const handleQueueSequenceChange = (rowKey: string, value: number | null) => {
    setQueueSequenceDraftState((current) => {
      const values = current.scopeKey === queueSequenceDraftScopeKey ? current.values : EMPTY_QUEUE_SEQUENCE_DRAFT;
      return { scopeKey: queueSequenceDraftScopeKey, values: { ...values, [rowKey]: value } };
    });
  };
  const handleNormalizeQueueSequence = () => {
    if (!queueEditableRows.length) {
      messageApi.info('Queue này chưa có công đoạn active để đánh thứ tự.');
      return;
    }
    const nextDraft: QueueSequenceDraft = {};
    queueSequenceRows.forEach((row) => {
      if (!row.isInactive) {
        nextDraft[row.key] = row.draftPosition * DISPATCH_SEQUENCE_STEP;
      }
    });
    setQueueSequenceDraftState({ scopeKey: queueSequenceDraftScopeKey, values: nextDraft });
    messageApi.info('Đã nạp thứ tự 10/20/30 theo queue đang hiển thị.');
  };
  const handleMoveQueueSequenceRow = (rowKey: string, direction: -1 | 1) => {
    const rowIndex = queueEditableRows.findIndex((row) => row.key === rowKey);
    const targetRow = queueEditableRows[rowIndex + direction];
    if (rowIndex < 0 || !targetRow) {
      return;
    }
    const currentRow = queueEditableRows[rowIndex];
    setQueueSequenceDraftState((current) => {
      const values = current.scopeKey === queueSequenceDraftScopeKey ? current.values : EMPTY_QUEUE_SEQUENCE_DRAFT;
      return {
        scopeKey: queueSequenceDraftScopeKey,
        values: {
          ...values,
          [currentRow.key]: targetRow.nextSequence,
          [targetRow.key]: currentRow.nextSequence,
        },
      };
    });
  };
  const handleResetQueueSequenceDraft = () => {
    setQueueSequenceDraftState({ scopeKey: queueSequenceDraftScopeKey, values: EMPTY_QUEUE_SEQUENCE_DRAFT });
  };
  const handleApplyQueueSequence = async () => {
    if (!canPlanProduction) {
      messageApi.warning('Tài khoản hiện tại chưa có quyền điều độ sản xuất.');
      return;
    }
    await queueSequenceMutation.mutateAsync();
  };
  const rebalanceScenarioPack = (() => {
    const data = rebalancePreviewQuery.data;
    if (!data) {
      return [];
    }
    return [
      'SCENARIO REBALANCE',
      `Bộ lọc: ${plannerFilterSummary}`,
      `Gợi ý được chọn: ${selectedRebalanceSuggestions.length}`,
      `Sẵn chạy ${data.current_summary.ready_to_run_count} -> ${data.preview_summary.ready_to_run_count} (${(data.summary_delta?.ready_to_run_delta ?? 0) >= 0 ? '+' : ''}${data.summary_delta?.ready_to_run_delta ?? 0})`,
      `Cần xử lý ${data.current_summary.needs_attention_count} -> ${data.preview_summary.needs_attention_count} (${(data.summary_delta?.needs_attention_delta ?? 0) >= 0 ? '+' : ''}${data.summary_delta?.needs_attention_delta ?? 0})`,
      `Quá tải ${data.current_summary.over_capacity_count} -> ${data.preview_summary.over_capacity_count} (${(data.summary_delta?.over_capacity_delta ?? 0) >= 0 ? '+' : ''}${data.summary_delta?.over_capacity_delta ?? 0})`,
      `Gần kín tải ${data.current_summary.at_limit_count} -> ${data.preview_summary.at_limit_count} (${(data.summary_delta?.at_limit_delta ?? 0) >= 0 ? '+' : ''}${data.summary_delta?.at_limit_delta ?? 0})`,
      `Tổng giờ xếp lịch ${formatHours(data.current_summary.total_scheduled_hours)} -> ${formatHours(data.preview_summary.total_scheduled_hours)}`,
      ...(data.operations.slice(0, 4).map((item) => `- ${item.order_code} / ${item.preview.operation.step_code}: ${item.preview.capacity.capacity_state_label}`)),
    ];
  })();
  const shopFloorSignalMutation = useMutation({
    mutationFn: (payload: { signalCode: string; note: string; handoverStatus?: string }) => productionApi.shopFloorSignal({
      items: selectedCards.map((card) => ({
        order_id: card.order.id,
        operation_id: card.operation.id,
      })),
      signal_code: payload.signalCode,
      note: payload.note,
      dispatch_owner: dispatchOwner.trim() || undefined,
      handover_status: payload.handoverStatus,
    }),
    onSuccess: async (result) => {
      messageApi.success(`Đã gửi tín hiệu floor cho ${result.updated_count} công đoạn.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['production-planning-board'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-production-summary'] }),
      ]);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const shopFloorHandoverMutation = useMutation({
    mutationFn: (payload: { handoverStatus: string; note: string; clearPreviousWait?: boolean; setReady?: boolean }) => productionApi.shopFloorHandover({
      items: selectedCards.map((card) => ({
        order_id: card.order.id,
        operation_id: card.operation.id,
      })),
      handover_status: payload.handoverStatus,
      dispatch_owner: dispatchOwner.trim() || undefined,
      handover_receiver: 'Trung tâm quét QR',
      handover_note: payload.note,
      clear_previous_wait: payload.clearPreviousWait,
      set_ready: payload.setReady,
    }),
    onSuccess: async (result) => {
      messageApi.success(`Đã chốt handover cho ${result.updated_count} công đoạn.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['production-planning-board'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-production-summary'] }),
      ]);
    },
    onError: (error) => {
      messageApi.error(getPlanningActionErrorMessage(error));
      void queryClient.invalidateQueries({ queryKey: ['production-planning-board'] });
    },
  });

  const runQuickUpdate = (patch: Record<string, unknown>) => {
    if (!selectedCard || !canEditSelectedCard) {
      return;
    }
    if (String(patch.status || '').toUpperCase() === 'SKIPPED') {
      messageApi.warning('Vui lòng dùng nút Bỏ qua và nhập lý do.');
      return;
    }
    if (isStatusChangeBlockedByDependency(selectedCard, patch.status)) {
      messageApi.warning(getOperationReadinessMeta(selectedCard).reason);
      return;
    }
    const currentValues = form.getFieldsValue();
    void updateMutation.mutateAsync({ ...currentValues, ...patch });
  };
  const stageQuickScheduleChange = (patch: Record<string, unknown>) => {
    if (!selectedCard || !canEditSelectedCard) {
      return;
    }
    form.setFieldsValue(patch);
    messageApi.info('Đã nạp vào form điều độ. Kiểm tra preview trước khi cập nhật.');
  };
  const handleOpenSkipModal = () => {
    if (!selectedCard || !canSkipSelectedCard) {
      return;
    }
    skipForm.resetFields();
    setIsSkipModalOpen(true);
  };
  const handleSubmitSkip = async () => {
    const values = await skipForm.validateFields();
    const reason = String(values.reason || '').trim();
    if (!reason) {
      skipForm.setFields([{ name: 'reason', errors: ['Vui lòng nhập lý do bỏ qua công đoạn.'] }]);
      return;
    }
    await skipMutation.mutateAsync({ reason });
  };
  const handleOpenBulkModal = () => {
    if (!selectedCards.length) {
      messageApi.info('Chọn ít nhất một công đoạn trên planner để cập nhật hàng loạt.');
      return;
    }
    bulkForm.resetFields();
    setIsBulkModalOpen(true);
  };
  const handleSubmitBulk = async () => {
    const values = await bulkForm.validateFields();
    if (String(values.status || '').toUpperCase() === 'SKIPPED') {
      messageApi.warning('Không hỗ trợ bỏ qua hàng loạt. Vui lòng dùng nút Bỏ qua trong từng công đoạn và nhập lý do.');
      return;
    }
    await bulkUpdateMutation.mutateAsync(values);
  };
  const handleSendShopFloorSignal = async (signalCode: string, note: string, handoverStatus?: string) => {
    if (!selectedCards.length) {
      messageApi.info('Chọn ít nhất một công đoạn để gửi tín hiệu floor.');
      return;
    }
    if (signalCode === 'CLEAR_TO_RUN' && blockedSelectedCount > 0) {
      messageApi.warning(`Có ${blockedSelectedCount} công đoạn đang chờ công đoạn trước. Không thể báo sẵn chạy cho nhóm này.`);
      return;
    }
    await shopFloorSignalMutation.mutateAsync({ signalCode, note, handoverStatus });
  };
  const handleSendShopFloorHandover = async (handoverStatusValue: string, note: string, options?: { clearPreviousWait?: boolean; setReady?: boolean }) => {
    if (!selectedCards.length) {
      messageApi.info('Chọn ít nhất một công đoạn để chốt handover.');
      return;
    }
    if (options?.setReady && blockedSelectedCount > 0) {
      messageApi.warning(`Có ${blockedSelectedCount} công đoạn đang chờ công đoạn trước. Không thể set ready qua handover.`);
      return;
    }
    await shopFloorHandoverMutation.mutateAsync({
      handoverStatus: handoverStatusValue,
      note,
      clearPreviousWait: options?.clearPreviousWait,
      setReady: options?.setReady,
    });
  };
  const renderOperationMetaTags = (card: ProductionPlanningCard) => {
    const readiness = getOperationReadinessMeta(card);
    const stepLabel = card.operation.display_step ?? card.operation.route_step_no;
    return (
      <Space wrap size={4}>
        {renderReadyToDispatchTag(card)}
        <Tooltip title={readiness.reason}>
          <Tag color={readiness.color}>{readiness.label}</Tag>
        </Tooltip>
        {renderOperationStatusTag(card.operation)}
        {renderExecutionHandoffTag(card)}
        {stepLabel ? <Tag>{`Bước ${stepLabel}`}</Tag> : null}
        {card.operation.group_code ? <Tag>{`Nhóm ${card.operation.group_code}`}</Tag> : null}
        {card.operation.allow_parallel ? (
          <Tooltip title="Các công đoạn cùng bước có thể được điều độ song song khi backend mở READY.">
            <Tag color="cyan">Có thể chạy song song</Tag>
          </Tooltip>
        ) : null}
      </Space>
    );
  };

  const listColumns: ColumnsType<ProductionPlanningCard> = [
    {
      title: 'LSX / mã hàng',
      key: 'order',
      width: 240,
      render: (_, card) => (
        <Space direction="vertical" size={2}>
          <strong>{`${card.order.code} · ${card.order.product_code || card.order.product_name || ''}`}</strong>
          <span style={{ color: 'rgba(0,0,0,0.65)' }}>{`${card.sales.customer_name || card.sales.sales_order_code || 'Chưa gắn SO'} · SL ${formatQty(card.order.planned_qty)}`}</span>
          <Text type="secondary">{formatDaysToDelivery(card.exceptions.days_to_delivery)}</Text>
        </Space>
      ),
    },
    {
      title: 'Công đoạn',
      key: 'step',
      width: 250,
      render: (_, card) => (
        <Space direction="vertical" size={6}>
          <span>{`${card.operation.step_code} · ${card.operation.step_name}`}</span>
          {renderOperationMetaTags(card)}
          <Text type="secondary">{card.exceptions.dependency_state_label}</Text>
        </Space>
      ),
    },
    {
      title: 'Ready dispatch',
      key: 'ready-to-dispatch',
      width: 220,
      render: (_, card) => (
        <Space direction="vertical" size={6}>
          {renderReadyToDispatchTag(card)}
          {renderReadyToDispatchDetails(card, 2)}
        </Space>
      ),
    },
    { title: 'Kế hoạch', key: 'schedule', width: 160, render: (_, card) => <Space direction="vertical" size={2}><span>{formatDate(card.operation.planned_date)}</span><span style={{ color: 'rgba(0,0,0,0.65)' }}>{card.operation.planned_shift_label || 'Chưa xếp ca'}</span></Space> },
    {
      title: 'Công suất',
      key: 'capacity',
      width: 220,
      render: (_, card) => (
        <Space direction="vertical" size={6}>
          <Tag color={getCapacityColor(card.capacity.capacity_state)}>{card.capacity.capacity_state_label}</Tag>
          <Text type="secondary">{`${card.capacity.work_center_name || card.capacity.work_center_code || 'Chưa gán WC'} · ${card.capacity.machine_name || card.capacity.machine_code || 'Chưa gán máy'}`}</Text>
          <Text type="secondary">{`${formatHours(card.capacity.scheduled_hours)} · Tải ${formatCapacityLoad(card.capacity.work_center_load_ratio)}`}</Text>
        </Space>
      ),
    },
    {
      title: 'Rủi ro',
      key: 'risk',
      width: 220,
      render: (_, card) => (
        <Space direction="vertical" size={6}>
          <Tag color={riskColor[card.exceptions.risk_state]}>{card.exceptions.risk_state_label}</Tag>
          {renderPlanningWarningChips(buildOperationWarnings(card), 3)}
          <Text type="secondary">{card.exceptions.block_reason_label || 'Không khóa'}</Text>
        </Space>
      ),
    },
    {
      title: 'Vật tư',
      key: 'materials',
      width: 180,
      render: (_, card) => (
        <Space direction="vertical" size={6}>
          <Tag color={readinessColor[card.materials.material_readiness]}>{card.materials.material_readiness_label}</Tag>
          <Text type="secondary">{`Còn thiếu ${formatQty(card.materials.remaining_issue_qty)}`}</Text>
          {card.materials.ready_to_run ? <Tag color="success">Sẵn chạy</Tag> : null}
        </Space>
      ),
    },
    {
      title: 'Shop-floor',
      key: 'shop-floor',
      width: 260,
      render: (_, card) => (
        <Space direction="vertical" size={6}>
          {card.shop_floor.handover_status ? (
            <Tag color={getHandoverColor(card.shop_floor.handover_status)}>{card.shop_floor.handover_status_label}</Tag>
          ) : (
            <Tag>Chưa chốt handover</Tag>
          )}
          <Text type="secondary">{card.shop_floor.dispatch_owner || 'Chưa gán người phụ trách'}</Text>
          {renderExecutionAuditSummary(card, true)}
          <Text type="secondary">{formatDeliveryGap(card.exceptions.delivery_gap_days)}</Text>
        </Space>
      ),
    },
    {
      title: 'Tiến độ',
      key: 'progress',
      width: 170,
      render: (_, card) => {
        const readiness = getOperationReadinessMeta(card);
        return (
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            {renderOperationStatusTag(card.operation)}
            <Tooltip title={readiness.reason}>
              <Tag color={readiness.color}>{readiness.label}</Tag>
            </Tooltip>
            <Progress percent={getOperationProgressPercent(card)} size="small" showInfo={false} />
            <Text type="secondary">{`${formatQty(card.operation.completed_qty)}/${formatQty(card.operation.planned_qty)}`}</Text>
          </Space>
        );
      },
    },
    { title: 'Tác vụ', key: 'action', width: 120, fixed: 'right', render: (_, card) => <Button type="primary" size="small" onClick={() => openCard(card)}>Xem</Button> },
  ];

  const activeTags = [
    search.trim() ? { key: 'search', label: `Tìm kiếm: ${search.trim()}`, onClose: () => setSearch('') } : null,
    stepCode.trim() ? { key: 'step_code', label: `Công đoạn: ${stepCode.trim()}`, onClose: () => setStepCode('') } : null,
    plannedDate ? { key: 'planned_date', label: `Ngày: ${formatDate(plannedDate)}`, onClose: () => setPlannedDate('') } : null,
    deliveryDueDate ? { key: 'delivery_due_date', label: `Hạn giao: ${formatDate(deliveryDueDate)}`, onClose: () => setDeliveryDueDate('') } : null,
    plannedShift !== 'ALL' ? { key: 'planned_shift', label: `Ca: ${shiftFilterOptions.find((item) => item.value === plannedShift)?.label || plannedShift}`, onClose: () => setPlannedShift('ALL') } : null,
    handoverStatus !== 'ALL' ? { key: 'handover_status', label: `Handover: ${handoverOptions.find((item) => item.value === handoverStatus)?.label || handoverStatus}`, onClose: () => setHandoverStatus('ALL') } : null,
    capacityState !== 'ALL' ? { key: 'capacity_state', label: `Công suất: ${capacityOptions.find((item) => item.value === capacityState)?.label || capacityState}`, onClose: () => setCapacityState('ALL') } : null,
    riskState !== 'ALL' ? { key: 'risk_state', label: `Rủi ro: ${riskOptions.find((item) => item.value === riskState)?.label || riskState}`, onClose: () => setRiskState('ALL') } : null,
    bucketKey !== 'ALL' ? { key: 'bucket_key', label: `Nhóm: ${bucketOptions.find((item) => item.value === bucketKey)?.label || bucketKey}`, onClose: () => setBucketKey('ALL') } : null,
    orderStatus !== 'ALL' ? { key: 'order_status', label: `LSX: ${orderStatusOptions.find((item) => item.value === orderStatus)?.label || orderStatus}`, onClose: () => setOrderStatus('ALL') } : null,
    dispatchOwner.trim() ? { key: 'dispatch_owner', label: `Người phụ trách: ${dispatchOwner.trim()}`, onClose: () => setDispatchOwner('') } : null,
    workCenterCode.trim() ? { key: 'work_center_code', label: `Work center: ${workCenterByCode.get(normalizeResourceCode(workCenterCode))?.name || workCenterCode.trim()}`, onClose: () => handleWorkCenterFilterChange('') } : null,
    machineCode.trim() ? { key: 'machine_code', label: `Máy: ${machineByCode.get(normalizeResourceCode(machineCode))?.name || machineCode.trim()}`, onClose: () => setMachineCode('') } : null,
    customer.trim() ? { key: 'customer', label: `Khách hàng: ${customer.trim()}`, onClose: () => setCustomer('') } : null,
    salesOrderCode.trim() ? { key: 'sales_order_code', label: `SO: ${salesOrderCode.trim()}`, onClose: () => setSalesOrderCode('') } : null,
    finishedProductCode.trim() ? { key: 'finished_product_code', label: `Mã hàng: ${finishedProductCode.trim()}`, onClose: () => setFinishedProductCode('') } : null,
    materialProductCode.trim() ? { key: 'material_product_code', label: `NVL: ${materialProductCode.trim()}`, onClose: () => setMaterialProductCode('') } : null,
    materialReadiness !== 'ALL' ? { key: 'material_readiness', label: `Vật tư: ${materialOptions.find((item) => item.value === materialReadiness)?.label || materialReadiness}`, onClose: () => setMaterialReadiness('ALL') } : null,
    dependencyState !== 'ALL' ? { key: 'dependency_state', label: `Phụ thuộc: ${dependencyOptions.find((item) => item.value === dependencyState)?.label || dependencyState}`, onClose: () => setDependencyState('ALL') } : null,
    readyToDispatch !== 'ALL' ? { key: 'ready_to_dispatch', label: `Ready dispatch: ${readyToDispatch}`, onClose: () => setReadyToDispatch('ALL') } : null,
    readyToRunOnly ? { key: 'ready_to_run', label: 'Chỉ sẵn chạy', onClose: () => setReadyToRunOnly(false) } : null,
    needsAttentionOnly ? { key: 'needs_attention', label: 'Chỉ cần xử lý', onClose: () => setNeedsAttentionOnly(false) } : null,
    hasMaterialWait ? { key: 'has_material_wait', label: 'Chỉ thiếu vật tư', onClose: () => setHasMaterialWait(false) } : null,
    hasPreviousWait ? { key: 'has_previous_wait', label: 'Chỉ chờ công đoạn trước', onClose: () => setHasPreviousWait(false) } : null,
    productionOrderId.trim() ? { key: 'production_order_id', label: `Ngữ cảnh LSX: ${productionOrderId.trim()}`, onClose: () => setProductionOrderId('') } : null,
    selectedCapacityWindow ? { key: 'focus_window', label: `Khoanh cửa sổ: ${selectedCapacityWindow.date ? formatDate(selectedCapacityWindow.date) : 'Chưa xếp lịch'} · ${selectedCapacityWindow.shift_label}`, onClose: () => { setFocusWindowDate(''); setFocusWindowShift('ALL'); } } : null,
    selectedQueue ? { key: 'queue_key', label: `Queue máy: ${selectedQueue.machine_name || selectedQueue.machine_code || 'Chưa gán máy'}`, onClose: () => setSelectedQueueKey(null) } : null,
    selectedSavedScenario ? { key: 'saved_scenario', label: `Scenario: ${selectedSavedScenario.name}`, onClose: () => setSelectedScenarioId('NONE') } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; onClose: () => void }>;

  const applySnapshot = (saved: Snapshot) => {
    setSearch(saved.search || '');
    setStepCode(saved.step_code || '');
    setPlannedDate(saved.planned_date || '');
    setDeliveryDueDate(saved.delivery_due_date || '');
    setPlannedShift(normalizeShift(saved.planned_shift));
    setHandoverStatus(normalizeHandover(saved.handover_status));
    setCapacityState(normalizeCapacity(saved.capacity_state));
    setRiskState(normalizeRisk(saved.risk_state));
    setBucketKey(normalizeBucket(saved.bucket_key));
    setOrderStatus(normalizeOrderStatus(saved.order_status));
    setDispatchOwner(saved.dispatch_owner || '');
    setWorkCenterCode(saved.work_center_code || '');
    setMachineCode(saved.machine_code || '');
    setCustomer(saved.customer || '');
    setSalesOrderCode(saved.sales_order_code || '');
    setFinishedProductCode(saved.finished_product_code || '');
    setMaterialProductCode(saved.material_product_code || '');
    setMaterialReadiness(normalizeMaterial(saved.material_readiness));
    setDependencyState(normalizeDependency(saved.dependency_state));
    setReadyToDispatch(normalizeReadyToDispatch(saved.ready_to_dispatch ?? null));
    setReadyToRunOnly(Boolean(saved.ready_to_run));
    setNeedsAttentionOnly(Boolean(saved.needs_attention));
    setHasMaterialWait(Boolean(saved.has_material_wait));
    setHasPreviousWait(Boolean(saved.has_previous_wait));
    setFocusWindowDate('');
    setFocusWindowShift('ALL');
    setSelectedQueueKey(null);
    setSelectedSuggestionKeys([]);
    setViewMode(saved.view === 'LIST' ? 'LIST' : 'BOARD');
  };

  const handleReset = () => {
    applySnapshot({
      search: '',
      step_code: '',
      planned_date: '',
      delivery_due_date: '',
      planned_shift: 'ALL',
      handover_status: 'ALL',
      capacity_state: 'ALL',
      risk_state: 'ALL',
      bucket_key: 'ALL',
      order_status: 'ALL',
      dispatch_owner: '',
      work_center_code: '',
      machine_code: '',
      customer: '',
      sales_order_code: '',
      finished_product_code: '',
      material_product_code: '',
      material_readiness: 'ALL',
      dependency_state: 'ALL',
      ready_to_dispatch: 'ALL',
      ready_to_run: false,
      needs_attention: false,
      has_material_wait: false,
      has_previous_wait: false,
      view: 'BOARD',
    });
    setProductionOrderId('');
    setFocusOperationId('');
    setFocusWindowDate('');
    setFocusWindowShift('ALL');
    setSelectedQueueKey(null);
    setSelectedSuggestionKeys([]);
    setSelectedPresetId('NONE');
    setSelectedScenarioId('NONE');
  };

  const applyPlannerFocusUrl = (url: string) => {
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.pathname !== '/production-planning') {
        navigate(url);
        return;
      }
      const nextParams = parsed.searchParams;
      applySnapshot(buildSnapshotFromParams(nextParams));
      setProductionOrderId(nextParams.get('production_order_id') || '');
      setFocusOperationId(nextParams.get('focus_operation_id') || '');
      setFocusWindowDate(nextParams.get('focus_window_date') || '');
      setFocusWindowShift(normalizeShift(nextParams.get('focus_window_shift')));
      setSelectedQueueKey(nextParams.get('queue_key') || null);
      setSelectedCardKey(null);
      setSelectedPresetId('NONE');
      setSelectedScenarioId('NONE');
    } catch {
      navigate(url);
    }
  };

  const handleSaveCurrentView = async () => {
    await saveConfig({ ...configRecord, last_snapshot: snapshot });
    messageApi.success('Đã lưu chế độ xem planner.');
  };

  const handleRestoreView = () => {
    const saved = configRecord.last_snapshot as Snapshot | undefined;
    if (!saved) {
      messageApi.info('Chưa có chế độ xem đã lưu.');
      return;
    }
    applySnapshot(saved);
    setSelectedScenarioId('NONE');
    setSelectedPresetId('NONE');
  };

  const handleSavePreset = async () => {
    const name = presetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu planner.');
      return;
    }
    const nextPreset = {
      id: selectedPresetId !== 'NONE' ? selectedPresetId : `planning-${Date.now()}`,
      name,
      snapshot,
    };
    await saveConfig({
      ...configRecord,
      saved_views: [...namedPresets.filter((item) => item.id !== nextPreset.id), nextPreset],
    });
    setSelectedPresetId(nextPreset.id);
    setPresetName('');
    setIsPresetModalOpen(false);
    messageApi.success('Đã lưu mẫu planner.');
  };

  const handleApplyPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      messageApi.info('Chọn mẫu planner để áp dụng.');
      return;
    }
    applySnapshot(preset.snapshot);
    setSelectedScenarioId('NONE');
  };

  const handleDeletePreset = async () => {
    if (selectedPresetId === 'NONE') return;
    await saveConfig({ ...configRecord, saved_views: namedPresets.filter((item) => item.id !== selectedPresetId) });
    setSelectedPresetId('NONE');
    messageApi.success('Đã xóa mẫu planner.');
  };

  const handleSaveScenario = async () => {
    const name = scenarioName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên scenario rebalance.');
      return;
    }
    if (!selectedRebalanceSuggestions.length) {
      messageApi.info('Chọn ít nhất một gợi ý rebalance trước khi lưu scenario.');
      return;
    }
    const nextScenario: SavedScenario = {
      id: selectedScenarioId !== 'NONE' ? selectedScenarioId : `planning-scenario-${Date.now()}`,
      name,
      suggestion_keys: selectedRebalanceSuggestions.map((item) => item.key),
      snapshot,
      focus_window_date: focusWindowDate,
      focus_window_shift: focusWindowShift !== 'ALL' ? focusWindowShift : undefined,
      queue_key: selectedQueueKey,
      updated_at: dayjs().toISOString(),
      summary: {
        suggestion_count: selectedRebalanceSuggestions.length,
        total_operations: rebalancePreviewQuery.data?.operations.length ?? 0,
        over_capacity_delta: rebalancePreviewQuery.data?.summary_delta?.over_capacity_delta ?? 0,
        at_limit_delta: rebalancePreviewQuery.data?.summary_delta?.at_limit_delta ?? 0,
        needs_attention_delta: rebalancePreviewQuery.data?.summary_delta?.needs_attention_delta ?? 0,
        total_scheduled_hours_delta: rebalancePreviewQuery.data?.summary_delta?.total_scheduled_hours_delta ?? '0.00',
      },
    };
    await saveConfig({
      ...configRecord,
      saved_scenarios: [...savedScenarios.filter((item) => item.id !== nextScenario.id), nextScenario],
    });
    setSelectedScenarioId(nextScenario.id);
    setScenarioName('');
    setIsScenarioModalOpen(false);
    messageApi.success('Da luu scenario rebalance.');
  };

  const applySavedScenarioRecord = (scenario: SavedScenario | null) => {
    if (!scenario) {
      messageApi.info('Chon scenario da luu de ap dung.');
      return;
    }
    setSelectedScenarioId(scenario.id);
    applySnapshot(scenario.snapshot);
    setFocusWindowDate(scenario.focus_window_date || '');
    setFocusWindowShift(scenario.focus_window_shift || 'ALL');
    setSelectedQueueKey(scenario.queue_key || null);
    setSelectedSuggestionKeys(scenario.suggestion_keys || []);
    setViewMode(scenario.snapshot.view === 'LIST' ? 'LIST' : 'BOARD');
    messageApi.success('Đã nạp scenario đã lưu vào planner.');
  };
  const handleApplySavedScenario = () => {
    applySavedScenarioRecord(selectedSavedScenario);
  };

  const handleDeleteSavedScenario = async () => {
    if (selectedScenarioId === 'NONE') {
      return;
    }
    await saveConfig({
      ...configRecord,
      saved_scenarios: savedScenarios.filter((item) => item.id !== selectedScenarioId),
    });
    setSelectedScenarioId('NONE');
    messageApi.success('Da xoa scenario da luu.');
  };

  const handleExportScenario = () => {
    if (rebalancePreviewQuery.data?.operations.length) {
      downloadCSV(rebalancePreviewQuery.data.operations.map((item) => ({
        Scenario: item.scenario?.suggestion_title || 'Scenario rebalance',
        'Mã LSX': item.order_code,
        'Công đoạn': `${item.preview.operation.step_code} - ${item.preview.operation.step_name}`,
        'Ngày mới': item.preview.operation.planned_date || '',
        'Ca mới': item.preview.operation.planned_shift_label || '',
        'Work center mới': item.preview.capacity.work_center_name || item.preview.capacity.work_center_code || '',
        'Máy mới': item.preview.capacity.machine_name || item.preview.capacity.machine_code || '',
        'Công suất mới': item.preview.capacity.capacity_state_label,
        'Rủi ro mới': item.preview.exceptions.risk_state_label,
      })), 'scenario-rebalance-planner');
      return;
    }
    if (!selectedSavedScenario) {
      messageApi.info('Chưa có scenario nào để xuất CSV.');
      return;
    }
    downloadCSV([{
      'Ten scenario': selectedSavedScenario.name,
      'So goi y': selectedSavedScenario.summary?.suggestion_count ?? selectedSavedScenario.suggestion_keys.length,
      'Tổng công đoạn preview': selectedSavedScenario.summary?.total_operations ?? 0,
      'Delta quá tải': selectedSavedScenario.summary?.over_capacity_delta ?? 0,
      'Delta gần kín tải': selectedSavedScenario.summary?.at_limit_delta ?? 0,
      'Delta cần xử lý': selectedSavedScenario.summary?.needs_attention_delta ?? 0,
      'Delta giờ xếp lịch': selectedSavedScenario.summary?.total_scheduled_hours_delta ?? '0.00',
      'Cập nhật lúc': selectedSavedScenario.updated_at,
    }], 'scenario-library-planner');
  };

  const handleExport = () => {
    if (!cards.length) return;
    downloadCSV(cards.map((card) => ({
      'Mã LSX': card.order.code,
      'Mã hàng': card.order.product_code || '',
      'SO': card.sales.sales_order_code || '',
      'Khách hàng': card.sales.customer_name || '',
      'Công đoạn': `${card.operation.step_code} - ${card.operation.step_name}`,
      'Ngày kế hoạch': card.operation.planned_date || '',
      'Ca': card.operation.planned_shift_label || '',
      'Work center': card.capacity.work_center_name || card.capacity.work_center_code || '',
      'Máy': card.capacity.machine_name || card.capacity.machine_code || '',
      'Công suất': card.capacity.capacity_state_label,
      'Ready dispatch': getReadyToDispatchStatus(card),
      'Lý do ready dispatch': getReadyToDispatchSummary(card),
      'Rủi ro': card.exceptions.risk_state_label,
      'Vật tư': card.materials.material_readiness_label,
    })), 'ban-ke-hoach-cong-doan');
  };

  if (workspaceQuery.isLoading && !workspace) {
    return <Skeleton active paragraph={{ rows: 12 }} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}
      <Card bordered={false} style={{ borderRadius: 20 }}>
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>Điều độ sản xuất</Title>
              <Text type="secondary">Bàn kế hoạch công đoạn theo ngày, ca, điểm nghẽn và ảnh hưởng giao hàng trên một command center riêng.</Text>
            </div>
            <Space wrap>
              <Button icon={<ReloadOutlined />} onClick={() => void workspaceQuery.refetch()}>Tải lại</Button>
              <Button onClick={() => void handleSaveCurrentView()} data-testid="production-planning-save-view">Lưu chế độ xem</Button>
              {canPlanProduction ? <Button icon={<CalendarOutlined />} onClick={handleExport} disabled={!cards.length}>Xuất CSV</Button> : null}
            </Space>
          </div>
          <Alert
            showIcon
            type={planningUsabilitySummary.overdueCount > 0 ? 'warning' : 'success'}
            message={planningUsabilitySummary.overdueCount > 0 ? `${planningUsabilitySummary.overdueCount} công đoạn active đang trễ.` : 'Planner đang bám đúng nhịp theo bộ lọc hiện tại.'}
            description={`Tải active: ${planningUsabilitySummary.activeCount}/${planningUsabilitySummary.totalVisibleCount} công đoạn · DONE/SKIPPED: ${planningUsabilitySummary.inactiveDoneSkippedCount} không tính vào tải active · Ảnh hưởng ngày giao: ${workspace?.summary.affected_sales_order_count ?? 0} SO`}
          />
          <Card
            size="small"
            data-testid="production-planning-warning-panel"
            title="Cảnh báo điều độ"
            extra={<Tag color={getPlanningWarningColor(getPlanningWarningTone(planningWarningItems))}>{`${planningWarningItems.length} nhóm cảnh báo`}</Tag>}
          >
            {planningWarningItems.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
                {planningWarningItems.slice(0, 8).map((item) => (
                  <div
                    key={item.key}
                    data-testid={`production-planning-warning-${item.key}`}
                    style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}
                  >
                    <Space wrap size={6}>
                      <Tag color={getPlanningWarningColor(item.severity)}>{item.title}</Tag>
                      <Text strong>{item.count ?? 0}</Text>
                    </Space>
                    <Text type="secondary">{`Lý do: ${item.reason}`}</Text>
                    <Text type="secondary">{`Nên làm: ${item.action}`}</Text>
                  </div>
                ))}
              </div>
            ) : (
              <Alert type="success" showIcon message="Chưa có cảnh báo điều độ lớn trong bộ lọc hiện tại." description="Planner chỉ tính tải active; DONE/SKIPPED vẫn hiển thị để đối chiếu nhưng không làm tăng tải." />
            )}
          </Card>
          <Card
            size="small"
            data-testid="production-planning-ready-to-dispatch-panel"
            title="Ready-to-dispatch advisory"
            extra={<Tag color={planningUsabilitySummary.dispatchBlockerCount ? 'error' : planningUsabilitySummary.dispatchWarningCount ? 'gold' : 'success'}>Chỉ cảnh báo</Tag>}
          >
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Space wrap>
                <Tag color="success">{`READY ${planningUsabilitySummary.readyDispatchCount}`}</Tag>
                <Tag color="gold">{`WARNING ${planningUsabilitySummary.dispatchWarningCount}`}</Tag>
                <Tag color="error">{`BLOCKER ${planningUsabilitySummary.dispatchBlockerCount}`}</Tag>
              </Space>
              <Text type="secondary">
                Kết hợp product/routing readiness, dependency, block reason, DONE/SKIPPED, lịch/ca, máy/tổ, công suất, vật tư/tồn nguồn và print metadata. Trạng thái này chưa chặn workflow.
              </Text>
              <Space wrap>
                {readyToDispatchReasonSummary.length ? readyToDispatchReasonSummary.map((item) => (
                  <Tag key={item.title} color={readyToDispatchColor[item.status]}>
                    {`${item.title}: ${item.count}`}
                  </Tag>
                )) : <Tag color="success">Không có lý do cảnh báo</Tag>}
              </Space>
              {readyToDispatchActionSummary.length ? (
                <div
                  data-testid="production-planning-ready-to-dispatch-action-plan"
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8 }}
                >
                  {readyToDispatchActionSummary.map((item) => (
                    <div key={item.key} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10 }}>
                      <Space direction="vertical" size={4}>
                        <Space wrap>
                          <Tag color={readyToDispatchColor[item.severity]}>{item.title}</Tag>
                          <Text strong>{item.count ?? 0}</Text>
                        </Space>
                        <Text type="secondary">{item.action}</Text>
                      </Space>
                    </div>
                  ))}
                </div>
              ) : (
                <Alert type="success" showIcon message="Các công đoạn active đang đủ tín hiệu dispatch trong bộ lọc hiện tại." />
              )}
            </Space>
          </Card>
          <Card
            size="small"
            data-testid="production-planning-dispatch-presets"
            title="Điều độ nhanh"
            extra={<Button size="small" onClick={resetDispatchPreset} disabled={!hasDispatchPresetFocus && !dispatchPresetBase}>Bỏ preset</Button>}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
              {dispatchPresetCards.map((preset) => {
                const active = isDispatchPresetActive(preset.key);
                return (
                  <button
                    key={preset.key}
                    type="button"
                    data-testid={`production-planning-preset-${preset.key.toLowerCase()}`}
                    onClick={() => applyDispatchPreset(preset.key)}
                    style={{
                      border: active ? '1px solid #1677ff' : '1px solid #d9e2f2',
                      borderRadius: 8,
                      padding: 12,
                      minHeight: 118,
                      textAlign: 'left',
                      background: active ? '#f0f7ff' : '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Text strong>{preset.title}</Text>
                      <Text type="secondary">{preset.description}</Text>
                    </Space>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <Text style={{ color: preset.tone, fontSize: 24, fontWeight: 700 }}>{getDispatchPresetCount(preset.key)}</Text>
                      <Text type="secondary" style={{ textAlign: 'right' }}>{getDispatchPresetDetail(preset.key)}</Text>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
          {hotDispatchOwner || hotSalesWatch || hotMaterialWatch || hotWorkCenterWatch || hotMachineWatch || hotDeliveryWatch || hotUnscheduledWatch || hotShiftWatch || hotDateWatch || hotOwnerCapacityWatch || hotStepWatch || hotRebalanceSummary ? (
            <Card size="small" data-testid="production-planning-focus-highlights" title="Điểm nóng cần mở nhanh">
              <Space wrap>
                {hotDispatchOwner ? (
                  <Button onClick={() => applyPlannerFocusUrl(hotDispatchOwner.focus_url)}>
                    {`Owner: ${hotDispatchOwner.dispatch_owner} (${hotDispatchOwner.total_operations})`}
                  </Button>
                ) : null}
                {hotSalesWatch ? (
                  <Button onClick={() => applyPlannerFocusUrl(hotSalesWatch.focus_url)}>
                    {`SO: ${hotSalesWatch.sales_order_code} (${hotSalesWatch.total_operations})`}
                  </Button>
                ) : null}
                {hotMaterialWatch ? (
                  <Button onClick={() => applyPlannerFocusUrl(hotMaterialWatch.focus_url)}>
                    {`Vật tư: ${hotMaterialWatch.material_product_code} (${hotMaterialWatch.wait_material_operations})`}
                  </Button>
                ) : null}
                {hotWorkCenterWatch ? (
                  <Button onClick={() => applyPlannerFocusUrl(hotWorkCenterWatch.focus_url)}>
                    {`WC: ${hotWorkCenterWatch.work_center_code} (${hotWorkCenterWatch.total_operations})`}
                  </Button>
                ) : null}
                {hotMachineWatch ? (
                  <Button onClick={() => applyPlannerFocusUrl(hotMachineWatch.focus_url)}>
                    {`Máy: ${hotMachineWatch.machine_code} (${hotMachineWatch.total_operations})`}
                  </Button>
                ) : null}
                {hotDeliveryWatch ? (
                  <Button onClick={() => applyPlannerFocusUrl(hotDeliveryWatch.focus_url)}>
                    {`Giao: ${formatDate(hotDeliveryWatch.delivery_due_date)} (${hotDeliveryWatch.total_operations})`}
                  </Button>
                ) : null}
                {hotUnscheduledWatch ? (
                  <Button onClick={() => applyPlannerFocusUrl(hotUnscheduledWatch.focus_url)}>
                    {`Chưa xếp: ${hotUnscheduledWatch.step_code} (${hotUnscheduledWatch.total_operations})`}
                  </Button>
                ) : null}
                {hotShiftWatch ? (
                  <Button onClick={() => applyPlannerFocusUrl(hotShiftWatch.focus_url)}>
                    {`Ca: ${hotShiftWatch.shift_label} (${hotShiftWatch.total_operations})`}
                  </Button>
                ) : null}
                {hotDateWatch ? (
                  <Button onClick={() => applyPlannerFocusUrl(hotDateWatch.focus_url)}>
                    {`Ngay: ${hotDateWatch.date ? formatDate(hotDateWatch.date) : hotDateWatch.date_label} (${hotDateWatch.total_operations})`}
                  </Button>
                ) : null}
                {hotOwnerCapacityWatch ? (
                  <Button onClick={() => applyPlannerFocusUrl(hotOwnerCapacityWatch.focus_url)}>
                    {`Owner tai: ${hotOwnerCapacityWatch.dispatch_owner} (${hotOwnerCapacityWatch.total_operations})`}
                  </Button>
                ) : null}
                {hotStepWatch ? (
                  <Button onClick={() => applyPlannerFocusUrl(hotStepWatch.focus_url)}>
                    {`Công đoạn: ${hotStepWatch.step_code} (${hotStepWatch.total_operations})`}
                  </Button>
                ) : null}
                {hotRebalanceSummary ? (
                  <Button onClick={() => applyPlannerFocusUrl(hotRebalanceSummary.focus_url)}>
                    {`Rebalance: ${hotRebalanceSummary.kind_label} (${hotRebalanceSummary.total_suggestions})`}
                  </Button>
                ) : null}
              </Space>
            </Card>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            <Card size="small"><Statistic title="Tổng lệnh" value={workspace?.summary.total_orders ?? 0} /></Card>
            <Card size="small"><Statistic title="Active" value={planningUsabilitySummary.activeCount} /></Card>
            <Card size="small"><Statistic title="DONE/SKIPPED" value={planningUsabilitySummary.inactiveDoneSkippedCount} valueStyle={{ color: '#722ed1' }} /></Card>
            <Card size="small"><Statistic title="READY dispatch" value={planningUsabilitySummary.readyDispatchCount} valueStyle={{ color: '#389e0d' }} /></Card>
            <Card size="small"><Statistic title="WARNING dispatch" value={planningUsabilitySummary.dispatchWarningCount} valueStyle={{ color: '#d48806' }} /></Card>
            <Card size="small"><Statistic title="BLOCKER dispatch" value={planningUsabilitySummary.dispatchBlockerCount} valueStyle={{ color: '#cf1322' }} /></Card>
            <Card size="small"><Statistic title="Quá hạn active" value={planningUsabilitySummary.overdueCount} valueStyle={{ color: '#cf1322' }} /></Card>
            <Card size="small"><Statistic title="Sẵn chạy active" value={planningUsabilitySummary.readyCount} valueStyle={{ color: '#1677ff' }} /></Card>
            <Card size="small"><Statistic title="Chờ vật tư active" value={planningUsabilitySummary.waitMaterialCount} valueStyle={{ color: '#d48806' }} /></Card>
            <Card size="small"><Statistic title="Chờ công đoạn trước" value={planningUsabilitySummary.waitPreviousCount} valueStyle={{ color: '#fa8c16' }} /></Card>
            <Card size="small"><Statistic title="Quá tải active" value={planningUsabilitySummary.overCapacityCount} valueStyle={{ color: '#cf1322' }} /></Card>
            <Card size="small"><Statistic title="Gần kín tải" value={planningUsabilitySummary.atLimitCount} valueStyle={{ color: '#d48806' }} /></Card>
            <Card size="small"><Statistic title="Chưa gán máy" value={planningUsabilitySummary.unassignedMachineCount} valueStyle={{ color: '#595959' }} /></Card>
            <Card size="small"><Statistic title="Chưa gán WC" value={planningUsabilitySummary.unassignedWorkCenterCount} valueStyle={{ color: '#8c8c8c' }} /></Card>
            <Card size="small"><Statistic title="Máy dừng" value={workspace?.summary.machine_down_count ?? 0} valueStyle={{ color: '#cf1322' }} /></Card>
            <Card size="small"><Statistic title="Sẵn sàng bàn giao" value={workspace?.summary.handover_ready_count ?? 0} valueStyle={{ color: '#722ed1' }} /></Card>
            <Card size="small"><Statistic title="Đã nhận bàn giao" value={workspace?.summary.handover_accepted_count ?? 0} valueStyle={{ color: '#389e0d' }} /></Card>
            <Card size="small"><Statistic title="Chưa gán ngày/ca" value={planningUsabilitySummary.unscheduledCount} /></Card>
            <Card size="small"><Statistic title="Giờ active" value={planningUsabilitySummary.activeScheduledHours} precision={2} suffix="h" /></Card>
          </div>
          <Space wrap>
            <Button type={bucketKey === 'OVERDUE' ? 'primary' : 'default'} onClick={() => { setBucketKey(bucketKey === 'OVERDUE' ? 'ALL' : 'OVERDUE'); setNeedsAttentionOnly(false); }} data-testid="production-planning-quick-overdue">
              Quá hạn ({planningUsabilitySummary.overdueCount})
            </Button>
            <Button type={bucketKey === 'UNSCHEDULED' ? 'primary' : 'default'} onClick={() => { setBucketKey(bucketKey === 'UNSCHEDULED' ? 'ALL' : 'UNSCHEDULED'); setNeedsAttentionOnly(false); }}>
              Chưa xếp ({planningUsabilitySummary.unscheduledCount})
            </Button>
            <Button type={readyToDispatch === 'READY' ? 'primary' : 'default'} onClick={() => setReadyToDispatch((current) => (current === 'READY' ? 'ALL' : 'READY'))} data-testid="production-planning-quick-dispatch-ready">
              READY dispatch ({planningUsabilitySummary.readyDispatchCount})
            </Button>
            <Button type={readyToDispatch === 'WARNING' ? 'primary' : 'default'} onClick={() => setReadyToDispatch((current) => (current === 'WARNING' ? 'ALL' : 'WARNING'))} data-testid="production-planning-quick-dispatch-warning">
              WARNING dispatch ({planningUsabilitySummary.dispatchWarningCount})
            </Button>
            <Button type={readyToDispatch === 'BLOCKER' ? 'primary' : 'default'} onClick={() => setReadyToDispatch((current) => (current === 'BLOCKER' ? 'ALL' : 'BLOCKER'))} data-testid="production-planning-quick-dispatch-blocker">
              BLOCKER dispatch ({planningUsabilitySummary.dispatchBlockerCount})
            </Button>
            <Button type={readyToRunOnly ? 'primary' : 'default'} onClick={() => setReadyToRunOnly((current) => !current)} data-testid="production-planning-quick-ready">
              Sẵn chạy ({planningUsabilitySummary.readyCount})
            </Button>
            <Button type={hasMaterialWait ? 'primary' : 'default'} onClick={() => setHasMaterialWait((current) => !current)}>
              Chờ vật tư ({planningUsabilitySummary.waitMaterialCount})
            </Button>
            <Button type={hasPreviousWait ? 'primary' : 'default'} onClick={() => setHasPreviousWait((current) => !current)}>
              Chờ công đoạn trước ({planningUsabilitySummary.waitPreviousCount})
            </Button>
            <Button type={capacityState === 'OVER_CAPACITY' ? 'primary' : 'default'} onClick={() => setCapacityState((current) => (current === 'OVER_CAPACITY' ? 'ALL' : 'OVER_CAPACITY'))} data-testid="production-planning-quick-over-capacity">
              Quá tải ({planningUsabilitySummary.overCapacityCount})
            </Button>
            <Button type={capacityState === 'AT_LIMIT' ? 'primary' : 'default'} onClick={() => setCapacityState((current) => (current === 'AT_LIMIT' ? 'ALL' : 'AT_LIMIT'))} data-testid="production-planning-quick-at-limit">
              Gần kín tải ({planningUsabilitySummary.atLimitCount})
            </Button>
            <Button type={capacityState === 'UNASSIGNED_MACHINE' ? 'primary' : 'default'} onClick={() => setCapacityState((current) => (current === 'UNASSIGNED_MACHINE' ? 'ALL' : 'UNASSIGNED_MACHINE'))}>
              Chưa gán máy ({planningUsabilitySummary.unassignedMachineCount})
            </Button>
            <Button type={capacityState === 'UNASSIGNED_WORK_CENTER' ? 'primary' : 'default'} onClick={() => setCapacityState((current) => (current === 'UNASSIGNED_WORK_CENTER' ? 'ALL' : 'UNASSIGNED_WORK_CENTER'))}>
              Chưa gán WC ({planningUsabilitySummary.unassignedWorkCenterCount})
            </Button>
            <Button type={handoverStatus === 'READY' ? 'primary' : 'default'} onClick={() => setHandoverStatus((current) => (current === 'READY' ? 'ALL' : 'READY'))}>
              Sẵn sàng bàn giao ({workspace?.summary.handover_ready_count ?? 0})
            </Button>
            <Button type={riskState === 'BLOCKED' && hasMaterialWait === false && hasPreviousWait === false ? 'primary' : 'default'} onClick={() => { setRiskState(riskState === 'BLOCKED' ? 'ALL' : 'BLOCKED'); setHasMaterialWait(false); setHasPreviousWait(false); }}>
              Nhóm nghẽn ({workspace?.summary.blocked_count ?? 0})
            </Button>
            <Button type={needsAttentionOnly ? 'primary' : 'default'} onClick={() => setNeedsAttentionOnly((current) => !current)} data-testid="production-planning-quick-attention">
              Cần xử lý ({(workspace?.summary.risk_counts?.OVERDUE ?? 0) + (workspace?.summary.risk_counts?.BLOCKED ?? 0) + (workspace?.summary.risk_counts?.UNSCHEDULED ?? 0) + (workspace?.summary.risk_counts?.AT_RISK ?? 0)})
            </Button>
          </Space>
          <Card size="small" data-testid="production-planning-shift-loads" title="Dispatch theo ca">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              {(workspace?.summary.shift_loads ?? []).map((shift) => (
                <button
                  key={shift.key}
                  type="button"
                  data-testid={`production-planning-shift-${String(shift.key).toLowerCase()}`}
                  onClick={() => setPlannedShift(plannedShift === shift.key ? 'ALL' : (shift.key as ShiftFilter))}
                  style={{
                    border: plannedShift === shift.key ? '1px solid #1677ff' : '1px solid #d9e2f2',
                    borderRadius: 12,
                    padding: 12,
                    textAlign: 'left',
                    background: plannedShift === shift.key ? '#f0f7ff' : '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{shift.label}</strong>
                    <Tag color={shift.overdue_count ? 'error' : shift.needs_attention_count ? 'warning' : 'blue'}>{shift.total_operations}</Tag>
                  </div>
                  <Text type="secondary">{`Sẵn chạy ${shift.ready_to_run_count} · Cần xử lý ${shift.needs_attention_count}`}</Text>
                  <Text type="secondary">{`Quá hạn ${shift.overdue_count} · SL ${formatQty(shift.planned_qty)}`}</Text>
                </button>
              ))}
            </div>
          </Card>
          <Card size="small" data-testid="production-planning-capacity-cockpit" title="Cockpit công suất">
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                <Card size="small"><Statistic title="Tổng giờ chạy" value={Number(workspace?.summary.total_runtime_hours ?? 0)} precision={2} suffix="h" /></Card>
                <Card size="small"><Statistic title="Tổng giờ setup" value={Number(workspace?.summary.total_setup_hours ?? 0)} precision={2} suffix="h" /></Card>
                <Card size="small"><Statistic title="Tổng giờ xếp lịch" value={Number(workspace?.summary.total_scheduled_hours ?? 0)} precision={2} suffix="h" /></Card>
                <Card size="small"><Statistic title="Slot quá tải" value={workspace?.summary.over_capacity_slot_count ?? 0} valueStyle={{ color: '#cf1322' }} /></Card>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <Card size="small" data-testid="production-planning-scope-compare" title="So sánh với toàn scope">
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Text type="secondary">{`Đang hiện ${workspace?.summary.total_operations ?? 0}/${workspace?.scope_summary?.total_operations ?? 0} công đoạn (${getSummaryRatio(workspace?.summary, workspace?.scope_summary)}%).`}</Text>
                    <Text type="secondary">{`Quá tải ${workspace?.summary.over_capacity_count ?? 0}/${workspace?.scope_summary?.over_capacity_count ?? 0} · Gần kín tải ${workspace?.summary.at_limit_count ?? 0}/${workspace?.scope_summary?.at_limit_count ?? 0}`}</Text>
                    <Text type="secondary">{`Chưa gán máy ${workspace?.summary.unassigned_machine_count ?? 0}/${workspace?.scope_summary?.unassigned_machine_count ?? 0} · Chưa gán WC ${workspace?.summary.unassigned_work_center_count ?? 0}/${workspace?.scope_summary?.unassigned_work_center_count ?? 0}`}</Text>
                    <Button icon={<CopyOutlined />} onClick={() => void handleCopyCapacityDigest()} data-testid="production-planning-copy-capacity-digest">
                      Sao chép tóm tắt công suất
                    </Button>
                  </Space>
                </Card>
                <Card size="small" data-testid="production-planning-pressure-windows" title="Cửa sổ công suất cần chú ý">
                  <List
                    size="small"
                    dataSource={capacityPressureWindows}
                    locale={{ emptyText: 'Chưa có cửa sổ công suất nào cần lưu ý.' }}
                    renderItem={({ row, shift }) => (
                      <List.Item
                        style={{
                          border: selectedCapacityWindow?.key === shift.key ? '1px solid #1677ff' : '1px solid transparent',
                          borderRadius: 12,
                          paddingInline: 12,
                        }}
                        actions={[
                          <Button key="focus" size="small" onClick={() => applyCapacityWindow(shift)}>
                            Khoanh
                          </Button>,
                        ]}
                      >
                        <List.Item.Meta
                          title={`${row.date_label} · ${shift.shift_label}`}
                          description={`Tải ${formatCapacityLoad(shift.load_ratio)} · ${shift.total_operations} công đoạn · Cần xử lý ${shift.needs_attention_count}`}
                        />
                      </List.Item>
                    )}
                  />
                </Card>
                <Card size="small" data-testid="production-planning-window-focus" title="Cửa sổ đang khoanh">
                  {selectedCapacityWindow ? (
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                      <Alert
                        showIcon
                        type={selectedCapacityWindow.window_state === 'OVER_CAPACITY' ? 'error' : selectedCapacityWindow.window_state === 'AT_LIMIT' ? 'warning' : 'info'}
                        message={`${selectedCapacityWindow.date ? formatDate(selectedCapacityWindow.date) : 'Chưa xếp lịch'} · ${selectedCapacityWindow.shift_label}`}
                        description={`Tải ${formatCapacityLoad(selectedCapacityWindow.load_ratio)} · ${selectedCapacityWindow.total_operations} công đoạn · Cần xử lý ${selectedCapacityWindow.needs_attention_count}`}
                      />
                      <Text type="secondary">{`Hàng chờ máy ${windowQueueHighlights.length} · Work center ${windowWorkCenterHighlights.length}`}</Text>
                      <Space wrap>
                        <Button size="small" onClick={() => void handleCopyPlannerDeepLink(windowFocusLink, 'Đã sao chép deeplink cửa sổ công suất.')}>
                          Sao chép deeplink
                        </Button>
                        <Button size="small" onClick={() => { setFocusWindowDate(''); setFocusWindowShift('ALL'); }}>
                          Bỏ khoanh
                        </Button>
                      </Space>
                      <List
                        size="small"
                        dataSource={windowQueueHighlights.slice(0, 3)}
                        locale={{ emptyText: 'Không có hàng chờ máy trong cửa sổ đang khoanh.' }}
                        renderItem={(queue) => (
                          <List.Item
                            actions={[
                              <Button key="queue" size="small" onClick={() => openQueueDetail(queue)}>
                                Xem hàng chờ
                              </Button>,
                            ]}
                          >
                            <List.Item.Meta
                              title={`${queue.machine_name || queue.machine_code || 'Chưa gán máy'} · ${queue.total_operations} công đoạn`}
                              description={`${queue.work_center_name || queue.work_center_code || 'Chưa gán WC'} · Tải ${formatCapacityLoad(queue.load_ratio)}`}
                            />
                          </List.Item>
                        )}
                      />
                    </Space>
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chon mot cua so ngay/ca de khoanh queue va line can dieu do." />
                  )}
                </Card>
              </div>
              <Card size="small" data-testid="production-planning-capacity-calendar" title="Lich tai theo ngay / ca">
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {(workspace?.capacity_calendar ?? []).length ? (
                    (workspace?.capacity_calendar ?? []).map((row) => (
                      <div key={row.key} style={{ border: '1px solid #f0f0f0', borderRadius: 12, padding: 12, background: '#fff' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                          <Space direction="vertical" size={2}>
                            <strong>{row.date ? formatDate(row.date) : row.date_label}</strong>
                            <Text type="secondary">{`${row.total_operations} công đoạn · ${formatHours(row.scheduled_hours)} · SO ảnh hưởng ${row.affected_sales_order_count}`}</Text>
                          </Space>
                          <Space wrap>
                            <Tag color={row.over_capacity_count ? 'error' : row.at_limit_count ? 'gold' : 'success'}>
                              {row.over_capacity_count ? `Quá tải ${row.over_capacity_count}` : row.at_limit_count ? `Gần kín tải ${row.at_limit_count}` : 'Tải ổn định'}
                            </Tag>
                            <Button size="small" onClick={() => { setPlannedDate(row.date || ''); setPlannedShift('ALL'); }}>
                              Loc ngay
                            </Button>
                          </Space>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                          {row.shifts.map((shift) => {
                            const tone = getWindowTone(shift.window_state);
                            return (
                              <button
                                key={shift.key}
                                type="button"
                                onClick={() => applyCapacityWindow(shift)}
                                style={{
                                  border: selectedCapacityWindow?.key === shift.key ? '2px solid #1677ff' : `1px solid ${tone.border}`,
                                  borderRadius: 12,
                                  background: selectedCapacityWindow?.key === shift.key ? '#e6f4ff' : tone.background,
                                  color: tone.color,
                                  padding: 12,
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  minHeight: 110,
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                                  <strong>{shift.shift_label}</strong>
                                  <Tag color={shift.window_state === 'OVER_CAPACITY' ? 'error' : shift.window_state === 'AT_LIMIT' ? 'gold' : 'success'}>
                                    {shift.total_operations}
                                  </Tag>
                                </div>
                                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)' }}>{`Tải ${formatCapacityLoad(shift.load_ratio)} · ${formatHours(shift.scheduled_hours)}/${formatHours(shift.capacity_hours)}`}</div>
                                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)' }}>{`Sẵn chạy ${shift.ready_to_run_count} · Nghẽn ${shift.needs_attention_count}`}</div>
                                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)' }}>{`Quá tải ${shift.over_capacity_count} · Thiếu máy ${shift.unassigned_machine_count}`}</div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có lịch tải theo bộ lọc hiện tại." />
                  )}
                </Space>
              </Card>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                <Card size="small" title="Tải theo work center">
                  <List
                    size="small"
                    dataSource={(workspace?.work_center_groups ?? []).slice(0, 6)}
                    locale={{ emptyText: 'Chưa có work center theo bộ lọc hiện tại.' }}
                    renderItem={(group) => (
                      <List.Item
                        style={{
                          border: selectedCapacityWindow?.date === group.planned_date && selectedCapacityWindow?.shift_key === group.shift_key ? '1px solid #1677ff' : '1px solid transparent',
                          borderRadius: 12,
                          paddingInline: 12,
                        }}
                        actions={[
                          <Button key="focus" size="small" onClick={() => { setWorkCenterCode(group.work_center_code || ''); setFocusWindowDate(group.planned_date || ''); setFocusWindowShift((group.shift_key || 'UNASSIGNED') as ShiftFilter); setViewMode('BOARD'); }}>
                            Khoanh
                          </Button>,
                        ]}
                      >
                        <List.Item.Meta
                          title={`${group.work_center_name || group.work_center_code || 'Chưa gán'} · ${group.shift_label}`}
                          description={`Tải ${formatCapacityLoad(group.load_ratio)} · ${formatHours(group.scheduled_hours)}/${formatHours(group.capacity_hours)} · ${group.total_operations} công đoạn`}
                        />
                      </List.Item>
                    )}
                  />
                </Card>
                <Card size="small" title="Hàng chờ theo máy">
                  <List
                    size="small"
                    dataSource={(workspace?.machine_queues ?? []).slice(0, 6)}
                    locale={{ emptyText: 'Chưa có hàng chờ máy theo bộ lọc hiện tại.' }}
                    renderItem={(queue) => (
                      <List.Item
                        style={{
                          border: selectedQueueKey === queue.key ? '1px solid #1677ff' : '1px solid transparent',
                          borderRadius: 12,
                          paddingInline: 12,
                        }}
                        actions={[
                          <Button key="queue" size="small" type={selectedQueueKey === queue.key ? 'primary' : 'default'} onClick={() => openQueueDetail(queue)}>
                            Xem hàng chờ
                          </Button>,
                          <Button key="focus" size="small" onClick={() => { setMachineCode(queue.machine_code || ''); setFocusWindowDate(queue.planned_date || ''); setFocusWindowShift((queue.shift_key || 'UNASSIGNED') as ShiftFilter); setViewMode('LIST'); }}>
                            Mở danh sách
                          </Button>,
                        ]}
                      >
                        <List.Item.Meta
                          title={`${queue.machine_name || queue.machine_code || 'Chưa gán máy'} · ${queue.shift_label}`}
                          description={`${queue.work_center_name || queue.work_center_code || 'Chưa gán WC'} · ${queue.total_operations} công đoạn · ${formatHours(queue.scheduled_hours)}`}
                        />
                      </List.Item>
                    )}
                  />
                </Card>
                <Card size="small" data-testid="production-planning-rebalance-suggestions" title="Đề xuất cân tải">
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Space wrap>
                      <Tag color={selectedRebalanceSuggestions.length ? 'processing' : 'default'}>
                        {`${selectedRebalanceSuggestions.length} gợi ý đang chọn`}
                      </Tag>
                      <Button size="small" onClick={handleSelectAllRebalanceSuggestions} disabled={!(workspace?.rebalance_suggestions ?? []).length}>
                        Chọn tất cả
                      </Button>
                      <Button size="small" onClick={handleClearRebalanceSuggestions} disabled={!selectedRebalanceSuggestions.length}>
                        Bỏ chọn
                      </Button>
                    </Space>
                    <List
                      size="small"
                      dataSource={workspace?.rebalance_suggestions ?? []}
                      locale={{ emptyText: 'Chưa có đề xuất cân tải theo bộ lọc hiện tại.' }}
                      renderItem={(item) => (
                        <List.Item
                          style={{
                            border: activeSelectedSuggestionKeys.includes(item.key) ? '1px solid #1677ff' : '1px solid #f0f0f0',
                            borderRadius: 12,
                            paddingInline: 12,
                            marginBottom: 8,
                          }}
                          actions={[
                            <Button key="select" size="small" type={activeSelectedSuggestionKeys.includes(item.key) ? 'primary' : 'default'} onClick={() => toggleRebalanceSuggestionSelection(item)}>
                              {activeSelectedSuggestionKeys.includes(item.key) ? 'Bỏ chọn' : 'Thêm scenario'}
                            </Button>,
                            <Button key="focus" size="small" onClick={() => applyPlannerFocusUrl(item.focus_url)}>
                              Khoanh
                            </Button>,
                            <Button key="apply" size="small" type="primary" onClick={() => applyRebalanceSuggestion(item)}>
                              Nạp vào form
                            </Button>,
                          ]}
                        >
                          <List.Item.Meta
                            title={(
                              <Space wrap>
                                <span>{item.title}</span>
                                <Tag color={getSeverityColor(item.severity)}>{item.kind}</Tag>
                              </Space>
                            )}
                            description={`${item.description}${item.projected_source_load_ratio ? ` · Tải nguồn còn ${formatCapacityLoad(item.projected_source_load_ratio)}` : ''}${item.projected_target_load_ratio ? ` · Tải đích ${formatCapacityLoad(item.projected_target_load_ratio)}` : ''}`}
                          />
                        </List.Item>
                      )}
                    />
                    {selectedRebalanceSuggestions.length ? (
                      <Card size="small" data-testid="production-planning-rebalance-scenario" title="Scenario rebalance">
                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                          <Space wrap>
                            <Button icon={<CopyOutlined />} onClick={() => void handleCopyRebalanceScenario()} disabled={!rebalancePreviewQuery.data}>
                              Sao chép scenario
                            </Button>
                            <Button onClick={() => { setScenarioName(selectedSavedScenario?.name || ''); setIsScenarioModalOpen(true); }} disabled={!selectedRebalanceSuggestions.length}>
                              Lưu scenario
                            </Button>
                            <Button onClick={handleExportScenario} disabled={!rebalancePreviewQuery.data && selectedScenarioId === 'NONE'}>
                              Xuất CSV scenario
                            </Button>
                            <Button type="primary" onClick={() => void handleApplySelectedRebalance()} loading={rebalanceApplyMutation.isPending} disabled={!rebalancePreviewQuery.data}>
                              Áp dụng gợi ý đã chọn
                            </Button>
                          </Space>
                          {rebalancePreviewQuery.error ? (
                            <Alert
                              showIcon
                              type="error"
                              message="Không thể mô phỏng scenario cân tải."
                              description={getToastMessage(rebalancePreviewQuery.error)}
                              action={<Button size="small" onClick={() => void rebalancePreviewQuery.refetch()}>Thử lại</Button>}
                            />
                          ) : rebalancePreviewQuery.data ? (
                            <Space direction="vertical" size={10} style={{ width: '100%' }}>
                              <Text type="secondary">{`Sẵn chạy ${rebalancePreviewQuery.data.current_summary.ready_to_run_count} -> ${rebalancePreviewQuery.data.preview_summary.ready_to_run_count} · Cần xử lý ${rebalancePreviewQuery.data.current_summary.needs_attention_count} -> ${rebalancePreviewQuery.data.preview_summary.needs_attention_count}`}</Text>
                              <Text type="secondary">{`Quá tải ${rebalancePreviewQuery.data.current_summary.over_capacity_count} -> ${rebalancePreviewQuery.data.preview_summary.over_capacity_count} · Gần kín tải ${rebalancePreviewQuery.data.current_summary.at_limit_count} -> ${rebalancePreviewQuery.data.preview_summary.at_limit_count}`}</Text>
                              <Text type="secondary">{`Tổng giờ xếp lịch ${formatHours(rebalancePreviewQuery.data.current_summary.total_scheduled_hours)} -> ${formatHours(rebalancePreviewQuery.data.preview_summary.total_scheduled_hours)} · Delta ${formatHours(rebalancePreviewQuery.data.summary_delta?.total_scheduled_hours_delta ?? 0)}`}</Text>
                              <List
                                size="small"
                                dataSource={rebalancePreviewQuery.data.operations.slice(0, 4)}
                                renderItem={(item) => (
                                  <List.Item
                                    actions={[
                                      <Button key="open" size="small" onClick={() => openCard(item.preview)}>
                                        Mở công đoạn
                                      </Button>,
                                    ]}
                                  >
                                    <List.Item.Meta
                                      title={`${item.order_code} · ${item.preview.operation.step_code}`}
                                      description={`${item.preview.capacity.capacity_state_label} · ${item.preview.operation.planned_shift_label || 'Chưa xếp ca'} · ${item.scenario?.suggestion_title || 'Scenario rebalance'}`}
                                    />
                                  </List.Item>
                                )}
                              />
                              {(rebalancePreviewQuery.data.capacity_windows ?? []).length ? (
                                <List
                                  size="small"
                                  header="Cua so cong suat sau rebalance"
                                  dataSource={(rebalancePreviewQuery.data.capacity_windows ?? []).slice(0, 3)}
                                  renderItem={(item: ProductionPlanningPreviewWindow) => (
                                    <List.Item
                                      actions={[
                                        <Button key="focus" size="small" onClick={() => applyCapacityWindow(item.shift)}>
                                          Khoanh
                                        </Button>,
                                      ]}
                                    >
                                      <List.Item.Meta
                                        title={`${item.date_label} · ${item.shift.shift_label}`}
                                        description={`Tải ${formatCapacityLoad(item.shift.load_ratio)} · ${item.shift.total_operations} công đoạn`}
                                      />
                                    </List.Item>
                                  )}
                                />
                              ) : null}
                              {(rebalancePreviewQuery.data.machine_queue_highlights ?? []).length ? (
                                <List
                                  size="small"
                                  header="Hàng chờ máy dự kiến"
                                  dataSource={(rebalancePreviewQuery.data.machine_queue_highlights ?? []).slice(0, 3)}
                                  renderItem={(queue) => (
                                    <List.Item
                                      actions={[
                                        <Button key="queue" size="small" onClick={() => openQueueDetail(queue)}>
                                          Xem hàng chờ
                                        </Button>,
                                      ]}
                                    >
                                      <List.Item.Meta
                                        title={`${queue.machine_name || queue.machine_code || 'Chưa gán máy'} · ${queue.shift_label}`}
                                        description={`${queue.work_center_name || queue.work_center_code || 'Chưa gán WC'} · ${queue.total_operations} công đoạn · Tải ${formatCapacityLoad(queue.load_ratio)}`}
                                      />
                                    </List.Item>
                                  )}
                                />
                              ) : null}
                            </Space>
                          ) : (
                            <Skeleton active paragraph={{ rows: 3 }} />
                          )}
                        </Space>
                      </Card>
                    ) : null}
                    <Card size="small" data-testid="production-planning-saved-scenarios" title="Thư viện scenario">
                      <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        <Text type="secondary">
                          Lưu lại nhóm gợi ý cân tải để liên phòng ban mở đúng scenario, khoanh hàng chờ/cửa sổ nóng và tiếp tục điều độ trong ca sau.
                        </Text>
                        <List
                          size="small"
                          dataSource={savedScenarios.slice().reverse().slice(0, 6)}
                          locale={{ emptyText: 'Chưa có scenario cân tải nào đã lưu.' }}
                          renderItem={(item) => (
                            <List.Item
                              style={{
                                border: selectedScenarioId === item.id ? '1px solid #1677ff' : '1px solid #f0f0f0',
                                borderRadius: 12,
                                paddingInline: 12,
                              }}
                              actions={[
                                <Button key="select" size="small" type={selectedScenarioId === item.id ? 'primary' : 'default'} onClick={() => setSelectedScenarioId(item.id)}>
                                  {selectedScenarioId === item.id ? 'Đang chọn' : 'Chọn'}
                                </Button>,
                                <Button key="apply" size="small" onClick={() => applySavedScenarioRecord(item)}>
                                  Nạp
                                </Button>,
                              ]}
                            >
                              <List.Item.Meta
                                title={item.name}
                                description={`Gợi ý ${item.summary?.suggestion_count ?? item.suggestion_keys.length} · Preview ${item.summary?.total_operations ?? 0} công đoạn · Delta quá tải ${item.summary?.over_capacity_delta ?? 0}`}
                              />
                            </List.Item>
                          )}
                        />
                      </Space>
                    </Card>
                  </Space>
                </Card>
              </div>
            </Space>
          </Card>
          <Card size="small" data-testid="production-planning-handover-pack" title="Gói bàn giao planner">
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Text type="secondary">
                Chốt nhanh tóm tắt điều độ hiện tại để giao ca, đổi kho hoặc mở Quét QR kiện với đúng ngữ cảnh planner.
              </Text>
              <Space wrap>
                <Button icon={<CopyOutlined />} onClick={() => void handleCopyPlannerHandover()} data-testid="production-planning-copy-handover">
                  Sao chép gói planner
                </Button>
                <Button type="primary" href={plannerHandoverRoute} data-testid="production-planning-open-scan-handover">
                  Mở giao ca Quét QR kiện
                </Button>
              </Space>
              <div style={{ border: '1px solid #f0f0f0', borderRadius: 12, background: '#fff', padding: 12 }}>
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  {plannerHandoverPack.map((line) => (
                    <Text key={line} type={line.startsWith('GOI BAN GIAO') ? undefined : 'secondary'}>
                      {line}
                    </Text>
                  ))}
                </Space>
              </div>
            </Space>
          </Card>
          <Card size="small" data-testid="production-planning-floor-dispatch" title="Dispatch floor theo ca">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              {(workspace?.dispatch_groups ?? []).map((group) => (
                <Card
                  key={group.key}
                  size="small"
                  title={group.label}
                  extra={<Tag color={group.blocked_count ? 'error' : group.ready_to_run_count ? 'processing' : 'default'}>{group.total_operations}</Tag>}
                >
                  <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <Text type="secondary">{`Sẵn chạy ${group.ready_to_run_count} · Đang làm ${group.in_progress_count} · Nghẽn ${group.blocked_count}`}</Text>
                    <Text type="secondary">{`Sẵn sàng bàn giao ${group.handover_ready_count} · Đã nhận bàn giao ${group.handover_accepted_count}`}</Text>
                    <Text type="secondary">{group.owners.length ? `Người phụ trách: ${group.owners.join(', ')}` : 'Chưa gán người phụ trách'}</Text>
                    <Space wrap>
                      <Button size="small" onClick={() => setPlannedShift(plannedShift === group.key ? 'ALL' : (group.key as ShiftFilter))}>
                        Khoanh ca
                      </Button>
                      {group.cards[0] ? (
                        <Button size="small" type="primary" href={group.cards[0].actions.scan_center_url}>
                          Mở Quét QR kiện
                        </Button>
                      ) : null}
                    </Space>
                    <List
                      size="small"
                      dataSource={group.cards}
                      locale={{ emptyText: 'Không có công đoạn trong ca này.' }}
                      renderItem={(card) => (
                        <List.Item
                          actions={[
                            <Button key="select" size="small" type={activeSelectedCardKeys.includes(card.card_key) ? 'primary' : 'default'} onClick={() => toggleCardSelection(card)}>
                              {activeSelectedCardKeys.includes(card.card_key) ? 'Bỏ chọn' : 'Chọn'}
                            </Button>,
                            <Button key="open" size="small" type="link" onClick={() => openCard(card)}>Chi tiết</Button>,
                          ]}
                        >
                          <List.Item.Meta
                            title={`${card.order.code} · ${card.operation.step_code}`}
                            description={`${card.sales.customer_name || card.order.product_code || 'Không rõ khách'} · ${card.shop_floor.dispatch_owner || 'Chưa gán người'} · ${formatDeliveryGap(card.exceptions.delivery_gap_days)}`}
                          />
                        </List.Item>
                      )}
                    />
                  </Space>
                </Card>
              ))}
            </div>
          </Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            <Card size="small" data-testid="production-planning-owner-focus" title="Người phụ trách cần chú ý">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Text type="secondary">
                  Gom backlog theo người phụ trách để trưởng ca mở đúng hàng chờ, chốt bàn giao và giảm điểm nghẽn trong ca.
                </Text>
                <List
                  size="small"
                  dataSource={workspace?.dispatch_owner_groups ?? []}
                  locale={{ emptyText: 'Chưa có người phụ trách nổi bật theo bộ lọc hiện tại.' }}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key="focus" size="small" onClick={() => applyPlannerFocusUrl(item.focus_url)}>
                          Mở planner
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={`${item.dispatch_owner} · ${item.total_operations} công đoạn`}
                        description={`Quá hạn ${item.overdue_count} · Nghẽn ${item.blocked_count} · Sẵn sàng bàn giao ${item.handover_ready_count} · SO ${item.affected_sales_order_count}`}
                      />
                    </List.Item>
                  )}
                />
              </Space>
            </Card>
            <Card size="small" data-testid="production-planning-sales-watch" title="SO ảnh hưởng giao hàng">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Text type="secondary">
                  Chốt nhanh SO đang bị kế hoạch sản xuất tác nghẽn để liên phòng ban quay về planner hoặc Đơn hàng xuất đúng ngữ cảnh.
                </Text>
                <List
                  size="small"
                  dataSource={workspace?.sales_watch ?? []}
                  locale={{ emptyText: 'Chưa có SO nào nổi bật trong planner hiện tại.' }}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key="focus" size="small" onClick={() => applyPlannerFocusUrl(item.focus_url)}>
                          Khoanh planner
                        </Button>,
                        <Button key="sales" size="small" href={item.sales_fulfillment_url}>
                          Mở sales
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={`${item.sales_order_code}${item.customer_name ? ` · ${item.customer_name}` : ''}`}
                        description={`Quá hạn ${item.overdue_count} · Chờ vật tư ${item.wait_material_count} · Nghẽn ${item.blocked_count}${item.earliest_due_date ? ` · Giao ${formatDate(item.earliest_due_date)}` : ''}`}
                      />
                    </List.Item>
                  )}
                />
              </Space>
            </Card>
            <Card size="small" data-testid="production-planning-material-watch" title="Vật tư gây tắc line">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Text type="secondary">
                  Tổng hợp nhanh các mã NVL đang kéo planner chậm lại để đối chiếu cấp phát và quay lại lane đang chờ vật tư.
                </Text>
                <List
                  size="small"
                  dataSource={workspace?.material_watch ?? []}
                  locale={{ emptyText: 'Chưa có mã NVL nào đang tắc planner theo bộ lọc hiện tại.' }}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key="focus" size="small" onClick={() => applyPlannerFocusUrl(item.focus_url)}>
                          Khoanh planner
                        </Button>,
                        <Button key="issue" size="small" href={item.material_issue_url}>
                          Mở cấp vật tư
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={`${item.material_product_code} · ${item.material_product_name}`}
                        description={`Chờ ${item.wait_material_operations}/${item.impacted_operations} công đoạn · Còn thiếu ${formatQty(item.remaining_issue_qty)} · LSX ${item.sample_order_codes.join(', ') || '--'}`}
                      />
                    </List.Item>
                  )}
                />
              </Space>
            </Card>
            <Card size="small" data-testid="production-planning-work-center-watch" title="Work center cần giải áp">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Text type="secondary">
                  Gom các work center đang nóng theo tải, nghẽn và số công đoạn để planner khoanh đúng cụm cần cân tải.
                </Text>
                <List
                  size="small"
                  dataSource={workspace?.work_center_watch ?? []}
                  locale={{ emptyText: 'Chưa có work center nào vượt ngưỡng theo bộ lọc hiện tại.' }}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key="focus" size="small" onClick={() => applyPlannerFocusUrl(item.focus_url)}>
                          Khoanh planner
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={`${item.work_center_name || item.work_center_code} · ${item.total_operations} công đoạn`}
                        description={`Quá tải ${item.overloaded_slot_count} slot · Gần kín ${item.at_limit_slot_count} · Tải đỉnh ${formatCapacityLoad(item.peak_load_ratio)} · LSX ${item.sample_order_codes.join(', ') || '--'}`}
                      />
                    </List.Item>
                  )}
                />
              </Space>
            </Card>
            <Card size="small" data-testid="production-planning-machine-watch" title="Hàng chờ máy nóng nhất">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Text type="secondary">
                  Dùng để mở thẳng hàng chờ máy nóng nhất theo ca và dispatch sequence, tránh planner bị đầy tải cục bộ.
                </Text>
                <List
                  size="small"
                  dataSource={workspace?.machine_watch ?? []}
                  locale={{ emptyText: 'Chưa có hàng chờ máy nào nổi bật theo bộ lọc hiện tại.' }}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key="focus" size="small" onClick={() => applyPlannerFocusUrl(item.focus_url)}>
                          Mở hàng chờ
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={`${item.machine_name || item.machine_code} · ${item.total_operations} công đoạn`}
                        description={`Hàng chờ ${item.queue_count} slot · Quá tải ${item.overloaded_queue_count} · Tải đỉnh ${formatCapacityLoad(item.peak_load_ratio)} · LSX ${item.sample_order_codes.join(', ') || '--'}`}
                      />
                    </List.Item>
                  )}
                />
              </Space>
            </Card>
            <Card size="small" data-testid="production-planning-delivery-watch" title="Cam kết giao hàng cần giữ">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Text type="secondary">
                  Gom theo ngày giao để liên phòng ban nhìn nhanh cửa sổ cam kết nào đang cần planner quay lại giải áp.
                </Text>
                <List
                  size="small"
                  dataSource={workspace?.delivery_watch ?? []}
                  locale={{ emptyText: 'Chưa có cửa sổ giao hàng nào cần theo dõi sát theo bộ lọc hiện tại.' }}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key="focus" size="small" onClick={() => applyPlannerFocusUrl(item.focus_url)}>
                          Khoanh planner
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={`${formatDate(item.delivery_due_date)} · ${item.total_operations} công đoạn`}
                        description={`Trễ cam kết ${item.negative_delivery_gap_count} · Quá hạn ${item.overdue_count} · Chờ vật tư ${item.wait_material_count} · SO ${item.sample_sales_order_codes.join(', ') || '--'}`}
                      />
                    </List.Item>
                  )}
                />
              </Space>
            </Card>
            <Card size="small" data-testid="production-planning-unscheduled-watch" title="Cụm công đoạn chưa xếp">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Text type="secondary">
                  Tính gom theo công đoạn chưa xếp lịch để planner chốt ngày-ca nhanh và đẩy xuống floor mà không bỏ sót.
                </Text>
                <List
                  size="small"
                  dataSource={workspace?.unscheduled_watch ?? []}
                  locale={{ emptyText: 'Không còn cụm công đoạn chưa xếp nào theo bộ lọc hiện tại.' }}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key="focus" size="small" onClick={() => applyPlannerFocusUrl(item.focus_url)}>
                          Mở planner
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={`${item.step_code}${item.step_name ? ` · ${item.step_name}` : ''}`}
                        description={`Công đoạn treo ${item.total_operations} · Chờ vật tư ${item.wait_material_count} · LSX ${item.sample_order_codes.join(', ') || '--'}`}
                      />
                    </List.Item>
                  )}
                />
              </Space>
            </Card>
            <Card size="small" data-testid="production-planning-shift-watch" title="Ca đang nóng trong horizon">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Text type="secondary">
                  Gom theo ca trên toàn horizon để planner nhìn nhanh ca nào đang ôm tải, nghẽn và backlog lớn nhất.
                </Text>
                <List
                  size="small"
                  dataSource={workspace?.shift_watch ?? []}
                  locale={{ emptyText: 'Chưa có ca nào đang nổi bật theo bộ lọc hiện tại.' }}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key="focus" size="small" onClick={() => applyPlannerFocusUrl(item.focus_url)}>
                          Khoanh planner
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={`${item.shift_label} · ${item.total_operations} công đoạn`}
                        description={`Quá tải ${item.overloaded_slot_count} slot · Gần kín ${item.at_limit_slot_count} · Tải đỉnh ${formatCapacityLoad(item.peak_load_ratio)} · LSX ${item.sample_order_codes.join(', ') || '--'}`}
                      />
                    </List.Item>
                  )}
                />
              </Space>
            </Card>
            <Card size="small" data-testid="production-planning-date-watch" title="Ngày / horizon cần quay lại">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Text type="secondary">
                  Chốt nhanh ngày nào đang cần giải áp tải, nghẽn và cụm lệnh dày đặc trong horizon hiện tại.
                </Text>
                <List
                  size="small"
                  dataSource={workspace?.date_watch ?? []}
                  locale={{ emptyText: 'Chưa có ngày nào nổi bật theo bộ lọc hiện tại.' }}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key="focus" size="small" onClick={() => applyPlannerFocusUrl(item.focus_url)}>
                          Mở ngày
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={`${item.date ? formatDate(item.date) : item.date_label} · ${item.total_operations} công đoạn`}
                        description={`Quá tải ${item.over_capacity_count} · Gần kín ${item.at_limit_count} · Tải đỉnh ${formatCapacityLoad(item.peak_load_ratio)} · LSX ${item.sample_order_codes.join(', ') || '--'}`}
                      />
                    </List.Item>
                  )}
                />
              </Space>
            </Card>
            <Card size="small" data-testid="production-planning-owner-capacity-watch" title="Người phụ trách ôm tải / backlog">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Text type="secondary">
                  Xem người phụ trách nào đang ôm backlog và tải nóng để trưởng ca đổi người, đổi line hoặc chốt bàn giao sớm.
                </Text>
                <List
                  size="small"
                  dataSource={workspace?.dispatch_owner_capacity_watch ?? []}
                  locale={{ emptyText: 'Chưa có người phụ trách nào ôm tải nổi bật theo bộ lọc hiện tại.' }}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key="focus" size="small" onClick={() => applyPlannerFocusUrl(item.focus_url)}>
                          Mở người phụ trách
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={`${item.dispatch_owner} · ${item.total_operations} công đoạn`}
                        description={`Quá tải ${item.over_capacity_count} · Gần kín ${item.at_limit_count} · Nghẽn ${item.blocked_count} · Tải đỉnh ${formatCapacityLoad(item.peak_load_ratio)}`}
                      />
                    </List.Item>
                  )}
                />
              </Space>
            </Card>
            <Card size="small" data-testid="production-planning-step-watch" title="Công đoạn cần chốt lại">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Text type="secondary">
                  Tổng hợp công đoạn đang treo, nghẽn hoặc đầy backlog để planner chốt thứ tự ưu tiên theo từng bước.
                </Text>
                <List
                  size="small"
                  dataSource={workspace?.step_watch ?? []}
                  locale={{ emptyText: 'Chưa có công đoạn nào cần khoanh thêm theo bộ lọc hiện tại.' }}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key="focus" size="small" onClick={() => applyPlannerFocusUrl(item.focus_url)}>
                          Mở cụm
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={`${item.step_code}${item.step_name ? ` · ${item.step_name}` : ''} · ${item.total_operations} công đoạn`}
                        description={`Chưa xếp ${item.unscheduled_count} · Nghẽn ${item.blocked_count} · Chờ vật tư ${item.wait_material_count} · LSX ${item.sample_order_codes.join(', ') || '--'}`}
                      />
                    </List.Item>
                  )}
                />
              </Space>
            </Card>
            <Card size="small" data-testid="production-planning-rebalance-summary" title="Tổng hợp nhóm cân tải">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Text type="secondary">
                  Chọn nhanh cả cụm gợi ý cân tải theo loại, thay vì phải tick từng đề xuất một cách thủ công.
                </Text>
                <List
                  size="small"
                  dataSource={workspace?.rebalance_summary ?? []}
                  locale={{ emptyText: 'Chưa có nhóm cân tải nào nổi bật theo bộ lọc hiện tại.' }}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key="select" size="small" onClick={() => handleSelectRebalanceSummary(item)}>
                          Chọn gợi ý
                        </Button>,
                        <Button key="focus" size="small" onClick={() => applyPlannerFocusUrl(item.focus_url)}>
                          Khoanh planner
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={<Space wrap><Tag color={getSeverityColor(item.dominant_severity)}>{item.kind_label}</Tag><span>{`${item.total_suggestions} gợi ý`}</span></Space>}
                        description={`Nghiêm trọng ${item.critical_count} · Cảnh báo ${item.warning_count} · LSX ${item.sample_order_codes.join(', ') || '--'}`}
                      />
                    </List.Item>
                  )}
                />
              </Space>
            </Card>
          </div>
        </Space>
      </Card>
      <Card bordered={false} className="command-center-panel" data-testid="production-planning-bulk-strip">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <Title level={5} style={{ margin: 0 }}>Bảng thao tác sàn máy</Title>
              <Text type="secondary">
                Chọn công đoạn rồi xử lý theo nhóm tín hiệu, bàn giao hoặc cập nhật kết quả. Mọi thao tác vẫn ghi audit từng dòng.
              </Text>
            </div>
            <Space wrap>
              <Tag color={selectedCards.length ? 'blue' : 'default'}>{`Đang chọn ${selectedCards.length}/${cards.length}`}</Tag>
              <Button onClick={() => setSelectedCardKeys(cards.map((card) => card.card_key))} disabled={!cards.length} data-testid="production-planning-select-visible">
                Chọn toàn bộ đang lọc
              </Button>
              <Button onClick={() => setSelectedCardKeys([])} disabled={!selectedCards.length} data-testid="production-planning-clear-selection">
                Bỏ chọn
              </Button>
              <Button href={plannerHandoverRoute} disabled={!selectedCards.length} data-testid="production-planning-open-scan-selected">
                Mở Quét QR kiện theo chọn
              </Button>
            </Space>
          </div>
          {selectedCards.length ? (
            <Space wrap>
              {selectedCards.slice(0, 8).map((card) => (
                <Tag key={card.card_key} closable onClose={(event) => { event.preventDefault(); toggleCardSelection(card); }}>
                  {`${card.order.code} · ${card.operation.step_code}`}
                </Tag>
              ))}
              {selectedCards.length > 8 ? <Tag>{`+${selectedCards.length - 8} công đoạn`}</Tag> : null}
            </Space>
          ) : (
            <Text type="secondary">Chọn công đoạn trong board hoặc bảng danh sách để mở bảng thao tác.</Text>
          )}
          <div style={shopFloorGroupGridStyle}>
            <div data-testid="production-planning-floor-signal-group" style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Text strong>Tín hiệu sàn máy</Text>
                <Text type="secondary">Báo nghẽn hoặc xác nhận công đoạn đã sẵn sàng chạy lại.</Text>
                <div style={shopFloorActionGridStyle}>
                  <Button size={isTouchViewport ? 'middle' : 'small'} style={touchButtonStyle} onClick={() => void handleSendShopFloorSignal('MACHINE_DOWN', 'Floor báo máy dừng, cần đổi line', 'ACTIVE')} disabled={!canPlanProduction || !selectedCards.length} data-testid="production-planning-signal-machine-down">
                    Báo máy dừng
                  </Button>
                  <Button size={isTouchViewport ? 'middle' : 'small'} style={touchButtonStyle} onClick={() => void handleSendShopFloorSignal('WAIT_MATERIAL', 'Floor báo chờ cấp vật tư trước khi vào máy', 'ACTIVE')} disabled={!canPlanProduction || !selectedCards.length} data-testid="production-planning-signal-wait-material">
                    Báo chờ vật tư
                  </Button>
                  <Tooltip title={blockedSelectedCount ? blockedSelectionMessage : ''}>
                    <span style={touchButtonWrapperStyle}>
                      <Button size={isTouchViewport ? 'middle' : 'small'} style={touchButtonStyle} onClick={() => void handleSendShopFloorSignal('CLEAR_TO_RUN', 'Floor đã sẵn sàng tiếp tục', 'ACTIVE')} disabled={!canPlanProduction || !selectedCards.length || blockedSelectedCount > 0} data-testid="production-planning-signal-clear-to-run">
                        Báo sẵn chạy
                      </Button>
                    </span>
                  </Tooltip>
                </div>
              </Space>
            </div>
            <div data-testid="production-planning-handover-action-group" style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Text strong>Bàn giao</Text>
                <Text type="secondary">Chốt sẵn sàng bàn giao hoặc xác nhận người nhận đã tiếp quản.</Text>
                <div style={shopFloorActionGridStyle}>
                  <Tooltip title={blockedSelectedCount ? blockedSelectionMessage : ''}>
                    <span style={touchButtonWrapperStyle}>
                      <Button size={isTouchViewport ? 'middle' : 'small'} style={touchButtonStyle} onClick={() => void handleSendShopFloorHandover('READY', 'Đã chốt xong gói bàn giao cho ca sau', { setReady: true })} disabled={!canPlanProduction || !selectedCards.length || blockedSelectedCount > 0} data-testid="production-planning-handover-ready">
                        Bàn giao sẵn sàng
                      </Button>
                    </span>
                  </Tooltip>
                  <Tooltip title={blockedSelectedCount ? blockedSelectionMessage : ''}>
                    <span style={touchButtonWrapperStyle}>
                      <Button size={isTouchViewport ? 'middle' : 'small'} style={touchButtonStyle} onClick={() => void handleSendShopFloorHandover('ACCEPTED', 'Người nhận đã tiếp quản và clear cho công đoạn trước', { clearPreviousWait: true, setReady: true })} disabled={!canPlanProduction || !selectedCards.length || blockedSelectedCount > 0} data-testid="production-planning-handover-accepted">
                        Đã nhận bàn giao
                      </Button>
                    </span>
                  </Tooltip>
                </div>
              </Space>
            </div>
            <div data-testid="production-planning-result-action-group" style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Text strong>Cập nhật kết quả</Text>
                <Text type="secondary">Skip, done và update cần đủ lý do/số lượng rồi xem tác động trước khi lưu.</Text>
                <div style={shopFloorActionGridStyle}>
                  <Button size={isTouchViewport ? 'middle' : 'small'} style={touchButtonStyle} type="primary" onClick={handleOpenBulkModal} disabled={!canPlanProduction || !selectedCards.length} data-testid="production-planning-open-bulk-modal">
                    Cập nhật hàng loạt
                  </Button>
                  <Tag color="default" style={isTouchViewport ? { marginInlineEnd: 0, textAlign: 'center', lineHeight: '38px', minHeight: 40 } : undefined}>Chỉ cảnh báo, không chặn workflow</Tag>
                </div>
              </Space>
            </div>
          </div>
        </Space>
      </Card>
      <div className="command-center-grid">
        <section className="command-center-panel">
          <div className="command-center-panel-header"><div><div className="command-center-panel-kicker">Watchlist</div><div className="command-center-panel-title">Ngoại lệ cần xử lý trước</div><div className="command-center-panel-subtitle">Gom công đoạn quá hạn, nghẽn và chưa xếp để điều độ liên phòng ban dễ theo dõi.</div></div></div>
          <div className="command-center-watchlist" data-testid="production-planning-watchlist">
            {(workspace?.watchlist ?? []).length ? workspace!.watchlist.map((card) => (
              <button key={card.card_key} type="button" data-testid={`production-planning-watch-${card.operation.id}`} className={`command-center-watch-item command-center-watch-item--${card.exceptions.risk_state === 'OVERDUE' ? 'critical' : card.exceptions.needs_attention ? 'warning' : 'steady'}`} onClick={() => openCard(card)}>
                <div className="command-center-watch-title">{`${card.order.code} · ${card.order.product_code || card.operation.step_name}`}</div>
                <div className="command-center-watch-detail">{`${card.exceptions.risk_state_label} · ${card.operation.step_name} · ${card.sales.customer_name || card.sales.sales_order_code || 'Chưa gắn SO'}`}</div>
                <div className="command-center-watch-detail">{`${card.materials.ready_to_run ? 'Sẵn chạy' : card.materials.material_readiness_label} · ${card.shop_floor.handover_status_label || 'Chưa chốt bàn giao'} · ${formatDaysToDelivery(card.exceptions.days_to_delivery)}`}</div>
              </button>
            )) : <div className="command-center-empty">Chưa có ngoại lệ planner theo bộ lọc hiện tại.</div>}
          </div>
        </section>
        <section className="command-center-panel">
          <div className="command-center-panel-header"><div><div className="command-center-panel-kicker">Playbook</div><div className="command-center-panel-title">Nhịp điều độ gợi ý</div><div className="command-center-panel-subtitle">Bắt đầu từ watchlist, chốt ngày/ca rồi dùng drawer để rà vật tư, workflow và chứng từ liên quan.</div></div></div>
          <div className="command-center-playbook">
            <div className="command-center-playbook-item"><div className="command-center-playbook-title">1. Chốt lane quá hạn trước</div><div className="command-center-playbook-detail">Đây là nhóm ảnh hưởng ngày giao nhanh nhất và cần đưa vào ưu tiên điều độ ngay.</div></div>
            <div className="command-center-playbook-item"><div className="command-center-playbook-title">2. Xem đủ vật tư + phụ thuộc</div><div className="command-center-playbook-detail">Một công đoạn chỉ thực sự sẵn chạy khi đủ vật tư và không bị chặn bởi công đoạn trước.</div></div>
            <div className="command-center-playbook-item"><div className="command-center-playbook-title">3. Mở drilldown để chốt</div><div className="command-center-playbook-detail">Từ drawer có thể cập nhật nhanh, mở issue/receipt overview và nhảy sang Đơn hàng xuất hoặc LSX.</div></div>
          </div>
        </section>
      </div>

      <section className="command-center-panel" data-testid="production-planning-exception-cockpit">
        <div className="command-center-panel-header">
          <div>
            <div className="command-center-panel-kicker">Exception cockpit</div>
            <div className="command-center-panel-title">Cockpit ngoại lệ liên phòng ban</div>
            <div className="command-center-panel-subtitle">Khoanh nhanh từng nhóm nghẽn theo vật tư, bàn giao công đoạn, quá hạn và sẵn chạy theo ca.</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {(workspace?.exception_groups ?? []).map((group) => (
            <Card
              key={group.key}
              size="small"
              title={group.label}
              extra={<Tag color={group.severity === 'critical' ? 'error' : group.severity === 'warning' ? 'gold' : group.severity === 'success' ? 'success' : 'blue'}>{group.count}</Tag>}
              data-testid={`production-planning-exception-${group.key.toLowerCase()}`}
            >
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Text type="secondary">{group.description}</Text>
                <Text type="secondary">{group.primary_action.label}</Text>
                <Space wrap>
                  <Button type="primary" disabled={!group.count} onClick={() => applyExceptionGroupFilters(group.filters)} data-testid={`production-planning-exception-apply-${group.key.toLowerCase()}`}>
                    Khoanh trên planner
                  </Button>
                  <Button disabled={!group.count} href={group.secondary_action.url} target="_blank" rel="noreferrer" data-testid={`production-planning-exception-open-${group.key.toLowerCase()}`}>
                    {group.secondary_action.label}
                  </Button>
                </Space>
              </Space>
            </Card>
          ))}
        </div>
      </section>

      {viewMode === 'BOARD' ? (
        <section className="command-center-panel" data-testid="production-planning-board">
          <div className="command-center-panel-header"><div><div className="command-center-panel-kicker">Swimlane theo công đoạn</div><div className="command-center-panel-title">Điều độ từng bước sản xuất</div><div className="command-center-panel-subtitle">Trong mỗi lane, thẻ được nhóm theo quá hạn, hôm nay, ngày mai, sắp tới và chưa xếp.</div></div></div>
          {displayLanes.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {displayLanes.map((lane) => (
                <Card
                  key={lane.key}
                  size="small"
                  title={`${lane.step_code} · ${lane.step_name}`}
                  extra={(
                    <Space wrap size={6}>
                      <Tag>{lane.total_cards}</Tag>
                      {lane.shift_loads.map((shift) => (
                        <Tag key={`${lane.key}-${shift.key}`} color={shift.overdue_count ? 'error' : shift.needs_attention_count ? 'gold' : 'blue'}>
                          {`${shift.label}: ${shift.total_operations}`}
                        </Tag>
                      ))}
                    </Space>
                  )}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                    {lane.buckets.map((bucket) => (
                      <div key={`${lane.key}-${bucket.key}`} style={{ border: '1px solid #eef2f7', borderRadius: 14, padding: 12, background: '#fafcff', display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong>{bucket.label}</strong><Tag>{bucket.count}</Tag></div>
                        {bucket.cards.length ? bucket.cards.map((card) => (
                          <div key={card.card_key} style={{ border: '1px solid #dbe7f3', borderRadius: 12, padding: 12, background: '#fff', display: 'flex', flexDirection: 'column', gap: 8, opacity: isDependencyBlocked(card) ? 0.78 : 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                              <Space wrap>
                                <Tag color={riskColor[card.exceptions.risk_state]}>{card.exceptions.risk_state_label}</Tag>
                                <Tooltip title={getOperationReadinessMeta(card).reason}>
                                  <Tag color={getOperationReadinessMeta(card).color}>{getOperationReadinessMeta(card).label}</Tag>
                                </Tooltip>
                                {renderReadyToDispatchTag(card)}
                                {renderOperationStatusTag(card.operation)}
                                {renderExecutionHandoffTag(card)}
                                <Tag color={readinessColor[card.materials.material_readiness]}>{card.materials.material_readiness_label}</Tag>
                                <Tag color={getCapacityColor(card.capacity.capacity_state)}>{card.capacity.capacity_state_label}</Tag>
                                {card.operation.display_step || card.operation.route_step_no ? <Tag>{`Bước ${card.operation.display_step ?? card.operation.route_step_no}`}</Tag> : null}
                                {card.operation.group_code ? <Tag>{`Nhóm ${card.operation.group_code}`}</Tag> : null}
                                {card.operation.allow_parallel ? <Tag color="cyan">Có thể chạy song song</Tag> : null}
                                {card.shop_floor.handover_status ? (
                                  <Tag color={getHandoverColor(card.shop_floor.handover_status)}>{card.shop_floor.handover_status_label}</Tag>
                                ) : null}
                              </Space>
                              {renderPlanningWarningChips(buildOperationWarnings(card), 4)}
                              <Space size={4}>
                                <Button
                                  size="small"
                                  type={activeSelectedCardKeys.includes(card.card_key) ? 'primary' : 'default'}
                                  onClick={() => toggleCardSelection(card)}
                                  data-testid={`production-planning-select-card-${card.operation.id}`}
                                >
                                  {activeSelectedCardKeys.includes(card.card_key) ? 'Bỏ chọn' : 'Chọn'}
                                </Button>
                                <Button size="small" type="link" onClick={() => openCard(card)} data-testid={`production-planning-open-card-${card.operation.id}`}>
                                  Chi tiết
                                </Button>
                              </Space>
                            </div>
                            <div style={{ fontWeight: 700 }}>{`${card.order.code} · ${card.order.product_code || card.order.product_name || ''}`}</div>
                            <div style={{ color: 'rgba(0,0,0,0.65)' }}>{`${card.sales.customer_name || card.sales.sales_order_code || 'Chưa gắn SO'} · ${card.operation.planned_shift_label || 'Chưa xếp ca'} · ${card.shop_floor.dispatch_owner || 'Chưa gán floor owner'}`}</div>
                            <div style={{ color: 'rgba(0,0,0,0.65)', fontSize: 12 }}>{`${card.capacity.work_center_name || card.capacity.work_center_code || 'Chưa gán WC'} · ${card.capacity.machine_name || card.capacity.machine_code || 'Chưa gán máy'} · ${formatHours(card.capacity.scheduled_hours)}`}</div>
                            <Progress percent={getOperationProgressPercent(card)} size="small" showInfo={false} />
                            <div style={{ color: 'rgba(0,0,0,0.65)', fontSize: 12 }}>{`${card.exceptions.dependency_state_label} · Còn thiếu ${formatQty(card.materials.remaining_issue_qty)} · Tải ${formatCapacityLoad(card.capacity.work_center_load_ratio)}`}</div>
                            <div>{renderReadyToDispatchDetails(card, 3)}</div>
                            {renderExecutionAuditSummary(card, true)}
                            <div data-testid="production-planning-card-dispatch-summary" style={{ color: 'rgba(0,0,0,0.65)', fontSize: 12 }}>
                              {`Việc tiếp theo: ${getReadyToDispatchActionItems(card)[0]?.action || 'Rà tín hiệu dispatch.'}`}
                            </div>
                            <div style={{ color: 'rgba(0,0,0,0.65)', fontSize: 12 }}>{`${formatDaysToDelivery(card.exceptions.days_to_delivery)} · ${formatDeliveryGap(card.exceptions.delivery_gap_days)}`}</div>
                          </div>
                        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có thẻ trong bucket này." />}
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          ) : <Empty description="Chưa có công đoạn nào khớp với bộ lọc planner." image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        </section>
      ) : (
        <section className="command-center-panel" data-testid="production-planning-table">
          <div className="command-center-panel-header"><div><div className="command-center-panel-kicker">Danh sách liên phòng ban</div><div className="command-center-panel-title">Bảng planner công đoạn</div><div className="command-center-panel-subtitle">Dạng bảng để rà SO, khách hàng, vật tư và nghẽn theo từng công đoạn.</div></div></div>
          <Table
            rowKey="card_key"
            rowSelection={{
              selectedRowKeys: activeSelectedCardKeys,
              onChange: (keys) => setSelectedCardKeys(keys as string[]),
            }}
            columns={listColumns}
            dataSource={cards}
            loading={workspaceQuery.isFetching}
            pagination={{ pageSize: 12, showSizeChanger: true }}
            scroll={{ x: 1780 }}
            locale={{ emptyText: <Empty description="Chưa có thẻ planner nào theo bộ lọc hiện tại." image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          />
        </section>
      )}

      {workspaceQuery.error ? (
        <Alert showIcon type="error" data-testid="production-planning-workspace-alert" message="Không thể tải planner." description={getToastMessage(workspaceQuery.error, 'Hãy thử tải lại để cập nhật bàn kế hoạch công đoạn.')} action={<Button size="small" type="primary" data-testid="production-planning-retry-workspace" loading={workspaceQuery.isFetching} onClick={() => void workspaceQuery.refetch()}>Thử lại</Button>} />
      ) : null}

      <Card bordered={false} className="command-center-panel" data-testid="production-planning-command-strip">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div className="workspace-toolbar-group">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm LSX, mã hàng, SO..." style={{ width: 260 }} data-testid="production-planning-search" />
            <Select value={stepCode} onChange={setStepCode} options={stepOptions} style={{ width: 220 }} data-testid="production-planning-step-filter" />
            <DatePicker value={plannedDate ? dayjs(plannedDate) : null} onChange={(value) => setPlannedDate(value ? value.format('YYYY-MM-DD') : '')} format="DD/MM/YYYY" placeholder="Lọc theo ngày" style={{ width: 170 }} data-testid="production-planning-date-filter" />
            <DatePicker value={deliveryDueDate ? dayjs(deliveryDueDate) : null} onChange={(value) => setDeliveryDueDate(value ? value.format('YYYY-MM-DD') : '')} format="DD/MM/YYYY" placeholder="Hạn giao" style={{ width: 160 }} data-testid="production-planning-delivery-date-filter" />
            <Space wrap size={6}>
              <Button size="small" onClick={() => setDateAnchor(-1)} data-testid="production-planning-date-prev">Ngày trước</Button>
              <Button size="small" onClick={() => setPlannedDate(dayjs().format('YYYY-MM-DD'))} data-testid="production-planning-date-today">Hôm nay</Button>
              <Button size="small" onClick={() => setPlannedDate(dayjs().add(1, 'day').format('YYYY-MM-DD'))} data-testid="production-planning-date-tomorrow">Ngày mai</Button>
              <Button size="small" onClick={() => setPlannedDate('')} data-testid="production-planning-date-clear">Bỏ ngày</Button>
            </Space>
            <Select value={plannedShift} onChange={(value) => setPlannedShift(value as ShiftFilter)} options={shiftFilterOptions} style={{ width: 160 }} data-testid="production-planning-shift-filter" />
            <Select value={handoverStatus} onChange={(value) => setHandoverStatus(value as HandoverFilter)} options={handoverOptions} style={{ width: 190 }} data-testid="production-planning-handover-filter" />
            <Select value={capacityState} onChange={(value) => setCapacityState(value as CapacityFilter)} options={capacityOptions} style={{ width: 190 }} data-testid="production-planning-capacity-filter" />
            <Select value={riskState} onChange={(value) => setRiskState(value as RiskFilter)} options={riskOptions} style={{ width: 180 }} data-testid="production-planning-risk-filter" />
            <Select value={bucketKey} onChange={(value) => setBucketKey(value as BucketFilter)} options={bucketOptions} style={{ width: 170 }} data-testid="production-planning-bucket-filter" />
            <Select value={orderStatus} onChange={(value) => setOrderStatus(value as OrderStatusFilter)} options={orderStatusOptions} style={{ width: 180 }} data-testid="production-planning-order-status-filter" />
            <Select value={materialReadiness} onChange={(value) => setMaterialReadiness(value as MaterialFilter)} options={materialOptions} style={{ width: 180 }} />
            <Select value={dependencyState} onChange={(value) => setDependencyState(value as DependencyFilter)} options={dependencyOptions} style={{ width: 200 }} />
            <Select value={readyToDispatch} onChange={(value) => setReadyToDispatch(value as DispatchReadinessFilter)} options={readyToDispatchOptions} style={{ width: 190 }} data-testid="production-planning-ready-to-dispatch-filter" />
          </div>
          <div className="workspace-toolbar-group">
            <Input value={dispatchOwner} onChange={(event) => setDispatchOwner(event.target.value)} placeholder="Người phụ trách floor" style={{ width: 200 }} data-testid="production-planning-dispatch-owner-filter" />
            <AutoComplete
              allowClear
              value={workCenterCode}
              onChange={handleWorkCenterFilterChange}
              options={getWorkCenterOptions(workCenterCode)}
              filterOption={(inputValue, option) => String(option?.label ?? option?.value ?? '').toLowerCase().includes(inputValue.toLowerCase())}
              placeholder={hasCapacityCatalog ? 'Tổ / work center' : 'Work center'}
              style={{ width: 190 }}
              data-testid="production-planning-work-center-filter"
            />
            <AutoComplete
              allowClear
              value={machineCode}
              onChange={handleMachineFilterChange}
              options={getMachineOptions(workCenterCode, machineCode)}
              filterOption={(inputValue, option) => String(option?.label ?? option?.value ?? '').toLowerCase().includes(inputValue.toLowerCase())}
              placeholder={hasCapacityCatalog ? 'Máy theo tổ' : 'Máy'}
              style={{ width: 190 }}
              data-testid="production-planning-machine-filter"
            />
            <Input value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Khách hàng" style={{ width: 180 }} data-testid="production-planning-customer-filter" />
            <Input value={salesOrderCode} onChange={(event) => setSalesOrderCode(event.target.value)} placeholder="Mã SO" style={{ width: 150 }} data-testid="production-planning-sales-order-filter" />
            <Input value={finishedProductCode} onChange={(event) => setFinishedProductCode(event.target.value)} placeholder="Mã hàng" style={{ width: 150 }} data-testid="production-planning-finished-product-filter" />
            <Input value={materialProductCode} onChange={(event) => setMaterialProductCode(event.target.value)} placeholder="Mã NVL" style={{ width: 150 }} data-testid="production-planning-material-product-filter" />
            <span data-testid="production-planning-ready-to-run"><Space size={6}><Switch checked={readyToRunOnly} onChange={setReadyToRunOnly} />Chỉ sẵn chạy</Space></span>
            <span data-testid="production-planning-needs-attention"><Space size={6}><Switch checked={needsAttentionOnly} onChange={setNeedsAttentionOnly} />Chỉ cần xử lý</Space></span>
            <span data-testid="production-planning-material-wait"><Space size={6}><Switch checked={hasMaterialWait} onChange={setHasMaterialWait} />Chỉ thiếu vật tư</Space></span>
            <span data-testid="production-planning-previous-wait"><Space size={6}><Switch checked={hasPreviousWait} onChange={setHasPreviousWait} />Chỉ chờ công đoạn trước</Space></span>
            <Segmented value={viewMode} onChange={(value) => setViewMode(value as ViewMode)} options={[{ label: 'Board', value: 'BOARD', icon: <AppstoreOutlined /> }, { label: 'Danh sách', value: 'LIST', icon: <TableOutlined /> }]} data-testid="production-planning-view-mode" />
            <Button onClick={handleRestoreView} data-testid="production-planning-restore-view">Khôi phục</Button>
            <Button onClick={() => setIsPresetModalOpen(true)} data-testid="production-planning-open-preset-modal">Tạo mẫu</Button>
            <Select value={selectedPresetId} onChange={setSelectedPresetId} options={[{ value: 'NONE', label: 'Chọn mẫu planner' }, ...namedPresets.map((item) => ({ value: item.id, label: item.name }))]} style={{ width: 220 }} data-testid="production-planning-preset-select" />
            <Button onClick={handleApplyPreset} data-testid="production-planning-apply-preset">Áp dụng</Button>
            <Button danger disabled={selectedPresetId === 'NONE'} onClick={() => void handleDeletePreset()}>Xóa mẫu</Button>
            <Button onClick={() => { setScenarioName(selectedSavedScenario?.name || ''); setIsScenarioModalOpen(true); }} disabled={!selectedRebalanceSuggestions.length} data-testid="production-planning-open-scenario-modal">Lưu scenario</Button>
            <Select value={selectedScenarioId} onChange={setSelectedScenarioId} options={[{ value: 'NONE', label: 'Chọn scenario rebalance' }, ...savedScenarios.map((item) => ({ value: item.id, label: item.name }))]} style={{ width: 240 }} data-testid="production-planning-scenario-select" />
            <Button onClick={handleApplySavedScenario} disabled={selectedScenarioId === 'NONE'} data-testid="production-planning-apply-scenario">Nạp scenario</Button>
            <Button danger disabled={selectedScenarioId === 'NONE'} onClick={() => void handleDeleteSavedScenario()}>Xóa scenario</Button>
            <Button onClick={handleReset}>Xóa bộ lọc</Button>
          </div>
          <div className="workspace-toolbar-group">
            <Space wrap>{activeTags.length ? activeTags.map((tag) => <Tag key={tag.key} closable onClose={(event) => { event.preventDefault(); tag.onClose(); }}>{tag.label}</Tag>) : <Tag color="default">Đang xem toàn bộ planner</Tag>}</Space>
          </div>
          {productionOrderId.trim() ? (
            <Alert
              type="info"
              showIcon
              message={`Planner đang khoanh theo LSX #${productionOrderId.trim()}`}
              description="Đây là deeplink từ lệnh sản xuất hoặc màn liên quan. Có thể đóng tag 'Ngữ cảnh LSX' ở trên để quay lại toàn bộ planner."
            />
          ) : null}
        </Space>
      </Card>

      <Modal
        open={isBulkModalOpen}
        title={`Cập nhật hàng loạt ${selectedCards.length} công đoạn`}
        width={bulkModalWidth}
        style={isTouchViewport ? { maxWidth: 'calc(100vw - 24px)' } : undefined}
        onCancel={() => {
          setIsBulkModalOpen(false);
          bulkForm.resetFields();
        }}
        onOk={() => void handleSubmitBulk()}
        okText="Áp dụng hàng loạt"
        okButtonProps={{ disabled: !bulkPreviewQuery.data || bulkPreviewBlockedByValidation || bulkPreviewBlockedByDependency }}
        confirmLoading={bulkUpdateMutation.isPending}
        data-testid="production-planning-bulk-modal"
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Bulk action chỉ áp dụng cho những công đoạn đang được chọn."
            description="Nếu có lệnh chưa phát lệnh hoặc dữ liệu không hợp lệ, backend sẽ chặn để tránh phá vỡ kế hoạch hiện tại."
          />
          <Card size="small" data-testid="production-planning-bulk-selection-summary" title="Tóm tắt nhóm đang chọn">
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                <Card size="small"><Statistic title="Công đoạn" value={bulkSelectionSummary.total} /></Card>
                <Card size="small"><Statistic title="Active" value={bulkSelectionSummary.activeCount} /></Card>
                <Card size="small"><Statistic title="Giờ active" value={bulkSelectionSummary.activeScheduledHours} precision={2} suffix="h" /></Card>
                <Card size="small"><Statistic title="Sẵn chạy" value={bulkSelectionSummary.readyCount} valueStyle={{ color: '#1677ff' }} /></Card>
                <Card size="small"><Statistic title="Chờ trước" value={bulkSelectionSummary.dependencyBlockedCount} valueStyle={{ color: '#fa8c16' }} /></Card>
                <Card size="small"><Statistic title="DONE/SKIPPED" value={bulkSelectionSummary.doneOrSkippedCount} valueStyle={{ color: '#722ed1' }} /></Card>
                <Card size="small"><Statistic title="Quá tải" value={bulkSelectionSummary.overCapacityCount} valueStyle={{ color: '#cf1322' }} /></Card>
                <Card size="small"><Statistic title="Gần kín" value={bulkSelectionSummary.atLimitCount} valueStyle={{ color: '#d48806' }} /></Card>
                <Card size="small"><Statistic title="Nguy cơ trễ" value={bulkSelectionSummary.deliveryRiskCount} valueStyle={{ color: '#d48806' }} /></Card>
              </div>
              <Alert
                showIcon
                type={bulkPreviewPayload ? 'info' : 'warning'}
                message="Mục tiêu cập nhật"
                description={bulkTargetSummary}
              />
            </Space>
          </Card>
          {bulkSelectionWarnings.length ? (
            <Card size="small" data-testid="production-planning-bulk-warning-panel" title="Cảnh báo nhóm chọn">
              <List
                size="small"
                dataSource={bulkSelectionWarnings.slice(0, 8)}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      title={<Space wrap><Tag color={getPlanningWarningColor(item.severity)}>{item.title}</Tag><Text strong>{item.count ?? 0}</Text></Space>}
                      description={`Lý do: ${item.reason} · Nên làm: ${item.action}`}
                    />
                  </List.Item>
                )}
              />
            </Card>
          ) : null}
          {blockedSelectedCount ? (
            <Alert
              type="warning"
              showIcon
              message="Một số công đoạn đang chờ công đoạn trước."
              description="Có thể tiếp tục xếp ngày/ca, gán máy hoặc ghi chú nghẽn, nhưng không thể đổi sang READY/IN_PROGRESS/DONE/SKIPPED cho các công đoạn này."
            />
          ) : null}
          {bulkSelectionSummary.doneOrSkippedCount ? (
            <Alert
              type="warning"
              showIcon
              message={`${bulkSelectionSummary.doneOrSkippedCount} công đoạn đã DONE/SKIPPED trong nhóm chọn.`}
              description="Các công đoạn này vẫn nằm trong nhóm chọn để backend kiểm soát hợp lệ, nhưng không tính vào giờ active của nhóm."
            />
          ) : null}
          {bulkSelectionSummary.overCapacityCount || bulkSelectionSummary.unassignedResourceCount || bulkSelectionSummary.unscheduledCount ? (
            <Alert
              type="info"
              showIcon
              message="Cảnh báo điều độ trong nhóm chọn"
              description={`Quá tải ${bulkSelectionSummary.overCapacityCount} · Gần kín ${bulkSelectionSummary.atLimitCount} · Thiếu máy/tổ ${bulkSelectionSummary.unassignedResourceCount} · Chưa gán ngày/ca ${bulkSelectionSummary.unscheduledCount}`}
            />
          ) : null}
          <div style={shopFloorActionGridStyle}>
            <Button size={isTouchViewport ? 'middle' : 'small'} style={touchButtonStyle} onClick={() => bulkForm.setFieldsValue({ planned_date: dayjs(), planned_shift: 'FULLDAY' })} data-testid="production-planning-bulk-today">
              Xếp hôm nay
            </Button>
            <Button size={isTouchViewport ? 'middle' : 'small'} style={touchButtonStyle} onClick={() => bulkForm.setFieldsValue({ planned_date: dayjs().add(1, 'day'), planned_shift: 'FULLDAY' })} data-testid="production-planning-bulk-tomorrow">
              Xếp ngày mai
            </Button>
            <Button size={isTouchViewport ? 'middle' : 'small'} style={touchButtonStyle} onClick={() => bulkForm.setFieldsValue({ block_reason_code: 'WAIT_MATERIAL', block_reason_note: 'Chờ cấp vật tư trước khi vào máy' })} data-testid="production-planning-bulk-wait-material">
              Đánh dấu chờ vật tư
            </Button>
            <Button size={isTouchViewport ? 'middle' : 'small'} style={touchButtonStyle} onClick={() => bulkForm.setFieldsValue({ block_reason_code: 'WAIT_PREVIOUS_STEP', block_reason_note: 'Chờ công đoạn trước bàn giao' })}>
              Chờ công đoạn trước
            </Button>
            <Tooltip title={blockedSelectedCount ? blockedSelectionMessage : ''}>
              <span style={touchButtonWrapperStyle}>
                <Button size={isTouchViewport ? 'middle' : 'small'} style={touchButtonStyle} onClick={() => bulkForm.setFieldsValue({ status: 'READY', block_reason_code: '__CLEAR__', block_reason_note: '' })} disabled={blockedSelectedCount > 0} data-testid="production-planning-bulk-ready">
                  Đánh dấu sẵn chạy
                </Button>
              </span>
            </Tooltip>
            <Button size={isTouchViewport ? 'middle' : 'small'} style={touchButtonStyle} onClick={() => bulkForm.setFieldsValue({ block_reason_code: '__CLEAR__', block_reason_note: '' })} data-testid="production-planning-bulk-clear-block">
              Gỡ nghẽn
            </Button>
          </div>
          <Form form={bulkForm} layout="vertical">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <Form.Item name="status" label="Trạng thái">
                <Select
                  allowClear
                  options={[
                    { value: 'PENDING', label: 'Chưa bắt đầu' },
                    { value: 'READY', label: 'Sẵn sàng', disabled: getBlockedStatusChangeCount(selectedCards, 'READY') > 0 },
                    { value: 'IN_PROGRESS', label: 'Đang làm', disabled: getBlockedStatusChangeCount(selectedCards, 'IN_PROGRESS') > 0 },
                    { value: 'DONE', label: 'Hoàn thành', disabled: getBlockedStatusChangeCount(selectedCards, 'DONE') > 0 },
                    { value: 'SKIPPED', label: 'Bỏ qua (dùng nút Bỏ qua)', disabled: true },
                  ]}
                />
              </Form.Item>
              <Form.Item name="planned_date" label="Ngày kế hoạch">
                <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="planned_shift" label="Ca">
                <Select
                  allowClear
                  options={[
                    { value: '__CLEAR__', label: 'Bỏ xếp ca' },
                    ...shiftFormOptions.filter((item) => item.value !== 'ALL'),
                  ]}
                />
              </Form.Item>
              <Form.Item name="priority_rank" label="Ưu tiên">
                <InputNumber min={1} max={9999} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="dispatch_sequence" label="Thứ tự dispatch">
                <InputNumber min={1} max={99999} style={{ width: '100%' }} />
              </Form.Item>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <Form.Item name="work_center_code" label="Work center code">
                <AutoComplete
                  allowClear
                  options={getWorkCenterOptions(watchedBulkWorkCenterCode, watchedBulkWorkCenterName)}
                  onChange={(value) => applyWorkCenterToForm(bulkForm, value)}
                  filterOption={(inputValue, option) => String(option?.label ?? option?.value ?? '').toLowerCase().includes(inputValue.toLowerCase())}
                  placeholder={hasCapacityCatalog ? 'Chọn hoặc nhập work center' : 'Gán cùng một work center cho nhóm đang chọn'}
                  data-testid="production-planning-bulk-work-center-code"
                />
              </Form.Item>
              <Form.Item name="work_center_name" label="Tên work center">
                <Input placeholder="Tên để planner dễ đọc" />
              </Form.Item>
              <Form.Item
                name="machine_code"
                label="Mã máy"
                dependencies={['work_center_code']}
                rules={[
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (String(value || '').trim() && !String(getFieldValue('work_center_code') || '').trim()) {
                        return Promise.reject(new Error('Cần nhập work center trước khi gán máy.'));
                      }
                      return Promise.resolve();
                    },
                  }),
                ]}
              >
                <AutoComplete
                  allowClear
                  options={getMachineOptions(watchedBulkWorkCenterCode, watchedBulkMachineCode, watchedBulkMachineName)}
                  onChange={(value) => applyMachineToForm(bulkForm, value)}
                  filterOption={(inputValue, option) => String(option?.label ?? option?.value ?? '').toLowerCase().includes(inputValue.toLowerCase())}
                  placeholder={hasCapacityCatalog ? 'Chọn hoặc nhập máy' : 'Gán máy cho toàn bộ nhóm đang chọn'}
                  data-testid="production-planning-bulk-machine-code"
                />
              </Form.Item>
              <Form.Item name="machine_name" label="Tên máy">
                <Input placeholder="Tên hiển thị trên planner" />
              </Form.Item>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <Form.Item name="estimated_runtime_hours" label="Giờ chạy dự kiến">
                <InputNumber min={0} max={999} step={0.25} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="setup_minutes" label="Phút setup">
                <InputNumber min={0} max={9999} style={{ width: '100%' }} />
              </Form.Item>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <Form.Item name="block_reason_code" label="Lý do nghẽn">
                <Select
                  allowClear
                  options={[
                    { value: '__CLEAR__', label: 'Gỡ nghẽn' },
                    ...blockReasonOptions.filter((item) => item.value),
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="block_reason_note"
                label="Mô tả nghẽn"
                dependencies={['block_reason_code']}
                rules={[
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (getFieldValue('block_reason_code') === 'OTHER' && !String(value || '').trim()) {
                        return Promise.reject(new Error('Vui lòng mô tả rõ lý do nghẽn khi chọn Khác.'));
                      }
                      return Promise.resolve();
                    },
                  }),
                ]}
              >
                <Input placeholder="Ví dụ: đợi line trước, chờ cấp bồi, đợi QA xác nhận..." />
              </Form.Item>
            </div>
            <Form.Item name="note" label="Ghi chú cập nhật">
              <Input.TextArea rows={3} placeholder="Ghi chú áp dụng chung cho các công đoạn đang chọn." />
            </Form.Item>
          </Form>
          {!bulkPreviewPayload ? (
            <Alert
              type="warning"
              showIcon
              message="Chọn thay đổi để xem preview trước khi áp dụng."
              description="Nút áp dụng hàng loạt chỉ mở sau khi planner đã mô phỏng tác động của ngày/ca/tổ/máy, trạng thái hoặc lý do nghẽn."
            />
          ) : bulkPreviewBlockedByValidation ? (
            <Alert
              type="info"
              showIcon
              message={bulkPreviewBlockedBySkip ? 'Không hỗ trợ bỏ qua hàng loạt.' : bulkPreviewBlockedByDependency ? 'Không thể đổi trạng thái khi còn công đoạn chờ công đoạn trước.' : 'Bổ sung đủ thông tin để preview bulk.'}
              description={bulkPreviewBlockedBySkip ? 'Bỏ qua công đoạn phải thao tác từng công đoạn và nhập lý do để ghi audit.' : bulkPreviewBlockedByDependency ? blockedSelectionMessage : 'Nếu gán máy hàng loạt thì cần chốt work center; khi chọn lý do nghẽn là Khác thì cần mô tả cụ thể.'}
            />
          ) : bulkPreviewQuery.data ? (
            <Card size="small" data-testid="production-planning-bulk-preview">
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Text strong>Mô phỏng tác động trước khi áp dụng</Text>
                <Alert
                  type={(bulkPreviewQuery.data.preview_summary.over_capacity_count > bulkPreviewQuery.data.current_summary.over_capacity_count || bulkPreviewQuery.data.preview_summary.negative_delivery_gap_count > 0) ? 'warning' : 'info'}
                  showIcon
                  data-testid="production-planning-bulk-preview-warning-summary"
                  message="Cảnh báo sau preview"
                  description={`Quá tải ${bulkPreviewQuery.data.current_summary.over_capacity_count} -> ${bulkPreviewQuery.data.preview_summary.over_capacity_count} · Gần kín ${bulkPreviewQuery.data.current_summary.at_limit_count} -> ${bulkPreviewQuery.data.preview_summary.at_limit_count} · Thiếu máy/tổ ${bulkPreviewQuery.data.preview_summary.unassigned_machine_count + bulkPreviewQuery.data.preview_summary.unassigned_work_center_count} · Giao hàng bị trễ ${bulkPreviewQuery.data.preview_summary.negative_delivery_gap_count}. DONE/SKIPPED trong nhóm chọn vẫn không tính giờ active.`}
                />
                <Text type="secondary">
                  {`Sẵn chạy ${bulkPreviewQuery.data.current_summary.ready_to_run_count} -> ${bulkPreviewQuery.data.preview_summary.ready_to_run_count} · Cần xử lý ${bulkPreviewQuery.data.current_summary.needs_attention_count} -> ${bulkPreviewQuery.data.preview_summary.needs_attention_count}`}
                </Text>
                <Text type="secondary">
                  {`Máy dừng ${bulkPreviewQuery.data.preview_summary.machine_down_count} · Sẵn sàng bàn giao ${bulkPreviewQuery.data.preview_summary.handover_ready_count} · Giao hàng bị trễ ${bulkPreviewQuery.data.preview_summary.negative_delivery_gap_count}`}
                </Text>
                <Text type="secondary">
                  {`Quá tải ${bulkPreviewQuery.data.current_summary.over_capacity_count} -> ${bulkPreviewQuery.data.preview_summary.over_capacity_count} · Chưa gán máy ${bulkPreviewQuery.data.current_summary.unassigned_machine_count} -> ${bulkPreviewQuery.data.preview_summary.unassigned_machine_count}`}
                </Text>
                <Text type="secondary">
                  {`Tổng giờ xếp lịch ${formatHours(bulkPreviewQuery.data.current_summary.total_scheduled_hours)} -> ${formatHours(bulkPreviewQuery.data.preview_summary.total_scheduled_hours)}`}
                </Text>
                <List
                  size="small"
                  dataSource={bulkPreviewQuery.data.operations.slice(0, 4)}
                  locale={{ emptyText: 'Chưa có thay đổi mô phỏng.' }}
                  renderItem={(item) => (
                    <List.Item>
                      <List.Item.Meta
                        title={`${item.order_code} · ${item.preview.operation.step_code}`}
                        description={`${item.current.exceptions.risk_state_label} -> ${item.preview.exceptions.risk_state_label} · ${item.preview.capacity.capacity_state_label} · ${formatDeliveryGap(item.preview.exceptions.delivery_gap_days)}`}
                      />
                    </List.Item>
                  )}
                />
              </Space>
            </Card>
          ) : bulkPreviewQuery.error ? (
            <Alert
              type="error"
              showIcon
              message="Không xem trước được bulk action."
              description={getPlanningActionErrorMessage(bulkPreviewQuery.error)}
            />
          ) : bulkPreviewQuery.isFetching ? (
            <Card size="small" data-testid="production-planning-bulk-preview">
              <Skeleton active paragraph={{ rows: 2 }} title={false} />
            </Card>
          ) : null}
        </Space>
      </Modal>

      <Modal
        title="Bỏ qua công đoạn"
        open={isSkipModalOpen}
        onCancel={() => {
          setIsSkipModalOpen(false);
          skipForm.resetFields();
        }}
        onOk={() => void handleSubmitSkip()}
        okText="Xác nhận bỏ qua"
        cancelText="Hủy"
        confirmLoading={skipMutation.isPending}
        okButtonProps={{ danger: true, disabled: !selectedCard, 'data-testid': 'production-planning-skip-submit' }}
        data-testid="production-planning-skip-modal"
      >
        {selectedCard ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              showIcon
              type={selectedCardDependencyBlocked ? 'warning' : 'info'}
              message={`${selectedCard.operation.step_code} · ${selectedCard.operation.step_name}`}
              description={(
                <Space direction="vertical" size={2}>
                  <span>{`LSX: ${selectedCard.order.code}`}</span>
                  <span>{`Trạng thái hiện tại: ${operationStatusLabel[selectedCard.operation.status]}`}</span>
                  <span>{`Bước: ${selectedCard.operation.display_step ?? selectedCard.operation.route_step_no ?? 'Theo sequence'}${selectedCard.operation.group_code ? ` · Nhóm ${selectedCard.operation.group_code}` : ''}`}</span>
                  {selectedCardDependencyBlocked ? <span>Ngoại lệ có audit: công đoạn này đang chờ công đoạn trước.</span> : null}
                </Space>
              )}
            />
            <Text type="secondary">
              Bỏ qua công đoạn này sẽ được ghi audit và có thể mở công đoạn kế tiếp nếu đủ điều kiện.
            </Text>
            <Form form={skipForm} layout="vertical">
              <Form.Item
                name="reason"
                label="Lý do bỏ qua"
                rules={[
                  { required: true, message: 'Vui lòng nhập lý do bỏ qua công đoạn.' },
                  { max: 500, message: 'Lý do tối đa 500 ký tự.' },
                  {
                    validator(_, value) {
                      if (!String(value || '').trim()) {
                        return Promise.reject(new Error('Vui lòng nhập lý do bỏ qua công đoạn.'));
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <Input.TextArea
                  rows={4}
                  maxLength={500}
                  showCount
                  placeholder="Ví dụ: công đoạn này không cần chạy do quy cách đơn hàng đã thay đổi."
                  disabled={skipMutation.isPending}
                  data-testid="production-planning-skip-reason"
                />
              </Form.Item>
            </Form>
          </Space>
        ) : null}
      </Modal>

      <Drawer
        title={selectedQueue ? `${selectedQueue.machine_name || selectedQueue.machine_code || 'Queue máy'} · ${selectedQueue.shift_label}` : 'Queue theo máy'}
        width={detailDrawerWidth}
        open={Boolean(selectedQueue)}
        onClose={() => setSelectedQueueKey(null)}
        data-testid="production-planning-queue-drawer"
      >
        {selectedQueue ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              showIcon
              type={selectedQueue.overloaded ? 'error' : 'info'}
              message={`${selectedQueue.work_center_name || selectedQueue.work_center_code || 'Chưa gán WC'} · ${selectedQueue.total_operations} công đoạn`}
              description={`${selectedQueue.planned_date ? formatDate(selectedQueue.planned_date) : 'Chưa xếp ngày'} · Tải ${formatCapacityLoad(selectedQueue.load_ratio)} · ${formatHours(selectedQueue.scheduled_hours)}/${formatHours(selectedQueue.capacity_hours)}`}
            />
            {queueWarningItems.length ? (
              <Alert
                showIcon
                type={getPlanningWarningAlertType(getPlanningWarningTone(queueWarningItems))}
                data-testid="production-planning-queue-warning-panel"
                message="Cảnh báo queue máy"
                description={queueWarningItems.slice(0, 4).map((item) => `${item.title}: ${item.reason} Nên làm: ${item.action}`).join(' · ')}
              />
            ) : (
              <Alert
                showIcon
                type="success"
                data-testid="production-planning-queue-warning-panel"
                message="Queue chưa có cảnh báo lớn."
                description="Giờ active đang tách riêng với DONE/SKIPPED để tránh hiểu sai tải máy."
              />
            )}
            <Space wrap>
              <Button size="small" icon={<LinkOutlined />} onClick={() => void handleCopyPlannerDeepLink(queueFocusLink, 'Đã sao chép deeplink queue máy.')}>
                Copy deeplink
              </Button>
              <Button size="small" onClick={() => { setMachineCode(selectedQueue.machine_code || ''); setViewMode('LIST'); }}>
                Mở list cùng bộ lọc
              </Button>
            </Space>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <Card size="small"><Statistic title="Công đoạn" value={selectedQueue.total_operations} /></Card>
              <Card size="small"><Statistic title="Sẵn chạy" value={selectedQueue.ready_to_run_count} /></Card>
              <Card size="small"><Statistic title="Quá hạn" value={selectedQueue.overdue_count} /></Card>
              <Card size="small"><Statistic title="Giờ xếp lịch" value={Number(selectedQueue.scheduled_hours || 0)} precision={2} suffix="h" /></Card>
            </div>
            <Card
              size="small"
              title={<Space><OrderedListOutlined /> <span>Thứ tự chạy theo máy</span></Space>}
              data-testid="production-planning-queue-sequence-card"
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                  <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10 }}><Statistic title="Đang hiển thị" value={queueSequenceSummary.total} /></div>
                  <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10 }}><Statistic title="Active" value={queueSequenceSummary.activeCount} /></div>
                  <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10 }}><Statistic title="Có thể xếp" value={queueSequenceSummary.editableCount} /></div>
                  <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10 }}><Statistic title="Giờ active" value={queueSequenceSummary.activeScheduledHours} precision={2} suffix="h" /></div>
                  <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10 }}><Statistic title="Đã đổi seq" value={queueSequenceSummary.changedCount} valueStyle={{ color: queueSequenceSummary.changedCount ? '#1677ff' : undefined }} /></div>
                </div>
                <Space wrap>
                  <Button size="small" onClick={handleNormalizeQueueSequence} disabled={!queueEditableRows.length || queueSequenceMutation.isPending} data-testid="production-planning-queue-normalize">
                    Chuẩn hóa 10/20/30
                  </Button>
                  <Button size="small" onClick={handleResetQueueSequenceDraft} disabled={!Object.keys(queueSequenceDraft).length || queueSequenceMutation.isPending} data-testid="production-planning-queue-reset-sequence">
                    Khôi phục thứ tự
                  </Button>
                  <Button size="small" onClick={() => setSelectedCardKeys(queueEditableRows.map((row) => row.card.card_key))} disabled={!queueEditableRows.length}>
                    Chọn active queue
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => void handleApplyQueueSequence()}
                    loading={queueSequenceMutation.isPending}
                    disabled={!canPlanProduction || !queueSequenceChangedRows.length || queueSequenceInvalidRows.length > 0 || queueSequenceDuplicateValues.length > 0}
                    data-testid="production-planning-queue-apply-sequence"
                  >
                    Áp dụng thứ tự
                  </Button>
                </Space>
                {!canPlanProduction ? (
                  <Alert type="info" showIcon message="Tài khoản hiện tại chưa có quyền điều độ sản xuất." />
                ) : queueSequenceDuplicateValues.length ? (
                  <Alert type="warning" showIcon message="Thứ tự dispatch đang bị trùng." description={`Seq trùng: ${queueSequenceDuplicateValues.join(', ')}. Cần đổi về các số khác nhau trước khi áp dụng.`} />
                ) : queueSequenceInvalidRows.length ? (
                  <Alert type="warning" showIcon message="Có thứ tự dispatch chưa hợp lệ." description="Seq mới phải là số nguyên từ 1 đến 99999." />
                ) : queueSequenceChangedRows.length ? (
                  <Alert
                    type="info"
                    showIcon
                    message="Xem trước thứ tự dispatch"
                    description={`Sẽ cập nhật ${queueSequenceChangedRows.length} công đoạn trong queue đang mở. DONE/SKIPPED không được tính là tải active và không nằm trong gói đổi seq.`}
                    data-testid="production-planning-queue-sequence-preview"
                  />
                ) : (
                  <Alert type="info" showIcon message="Chưa có thay đổi thứ tự." description="Có thể bấm lên/xuống hoặc nhập seq mới, sau đó áp dụng để lưu thứ tự chạy theo máy." />
                )}
                {queueSequenceSummary.inactiveCount || queueSequenceSummary.lockedOrderCount || queueSequenceSummary.dependencyBlockedCount ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="Lưu ý khi xếp queue"
                    description={`DONE/SKIPPED: ${queueSequenceSummary.inactiveCount} · LSX chưa cho điều độ: ${queueSequenceSummary.lockedOrderCount} · Chờ công đoạn trước: ${queueSequenceSummary.dependencyBlockedCount}. Thao tác này chỉ đổi dispatch_sequence, không đổi trạng thái công đoạn.`}
                  />
                ) : null}
              </Space>
            </Card>
            <List
              size="small"
              dataSource={queueSequenceRows}
              data-testid="production-planning-queue-list"
              locale={{ emptyText: 'Không còn công đoạn nào trong queue máy theo bộ lọc hiện tại.' }}
              renderItem={(item) => {
                const editableIndex = queueEditableRows.findIndex((row) => row.key === item.key);
                const canEditSequenceRow = canPlanProduction && item.canSequence;
                return (
                  <List.Item
                    data-testid="production-planning-queue-sequence-row"
                    actions={[
                      <Tooltip key="up" title="Đưa lên trước">
                        <span>
                          <Button
                            size="small"
                            icon={<ArrowUpOutlined />}
                            disabled={!canEditSequenceRow || editableIndex <= 0 || queueSequenceMutation.isPending}
                            onClick={() => handleMoveQueueSequenceRow(item.key, -1)}
                            data-testid="production-planning-queue-move-up"
                          />
                        </span>
                      </Tooltip>,
                      <Tooltip key="down" title="Đưa xuống sau">
                        <span>
                          <Button
                            size="small"
                            icon={<ArrowDownOutlined />}
                            disabled={!canEditSequenceRow || editableIndex < 0 || editableIndex >= queueEditableRows.length - 1 || queueSequenceMutation.isPending}
                            onClick={() => handleMoveQueueSequenceRow(item.key, 1)}
                            data-testid="production-planning-queue-move-down"
                          />
                        </span>
                      </Tooltip>,
                      <Button key="open" size="small" type="primary" onClick={() => openCard(item.card)}>
                        Mở công đoạn
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={(
                        <Space wrap>
                          <Text strong>{`${item.draftPosition}. ${item.card.order.code} · ${item.card.operation.step_code}`}</Text>
                          {renderOperationStatusTag(item.card.operation)}
                          <Tag color={isDependencyBlocked(item.card) ? 'warning' : dependencyColor[item.card.exceptions.dependency_state]}>{item.card.exceptions.dependency_state_label}</Tag>
                          {item.hasChanged ? <Tag color="processing">{`${item.currentSequence} -> ${item.nextSequence}`}</Tag> : null}
                        </Space>
                      )}
                      description={(
                        <Space direction="vertical" size={6} style={{ width: '100%' }}>
                          <Text type="secondary">
                            {`${item.card.sales.customer_name || item.card.sales.sales_order_code || 'Chưa gắn SO'} · Ưu tiên ${item.card.operation.priority_rank ?? 100} · Lũy kế active ${formatHours(item.draftCumulativeHours)} · ${item.card.exceptions.risk_state_label}`}
                          </Text>
                          {renderPlanningWarningChips(buildOperationWarnings(item.card), 3)}
                          <Space wrap>
                            <Tag>{`Seq hiện tại ${item.currentSequence}`}</Tag>
                            <InputNumber
                              min={1}
                              max={99999}
                              precision={0}
                              value={item.nextSequence}
                              disabled={!canEditSequenceRow || queueSequenceMutation.isPending}
                              onChange={(value) => handleQueueSequenceChange(item.key, value === null ? null : Number(value))}
                              style={{ width: 110 }}
                              data-testid="production-planning-queue-sequence-input"
                            />
                            <Tag color={getCapacityColor(item.card.capacity.capacity_state)}>{item.card.capacity.capacity_state_label}</Tag>
                            <Tag>{formatHours(item.card.capacity.scheduled_hours)}</Tag>
                            {item.isInactive ? <Tag color="default">Không tính active</Tag> : null}
                            {!item.isInactive && !item.canSequence ? <Tag color="default">LSX chưa cho điều độ</Tag> : null}
                          </Space>
                        </Space>
                      )}
                    />
                  </List.Item>
                );
              }}
            />
          </Space>
        ) : null}
      </Drawer>

      <Drawer
        title={selectedCard ? `${selectedCard.order.code} · ${selectedCard.operation.step_code} · ${selectedCard.operation.step_name}` : 'Chi tiết công đoạn'}
        width={detailDrawerWidth}
        open={Boolean(selectedCard)}
        destroyOnClose={false}
        onClose={() => { setSelectedCardKey(null); setFocusOperationId(''); }}
        data-testid="production-planning-detail-drawer"
        extra={selectedCard ? (
          <Space wrap>
            <Button href={selectedCard.actions.production_order_url} target="_blank" rel="noreferrer" icon={<LinkOutlined />}>{'M\u1edf LSX'}</Button>
            <Button href={selectedCard.actions.sales_fulfillment_url} target="_blank" rel="noreferrer" icon={<LinkOutlined />}>Đơn hàng xuất</Button>
            <Button href={selectedCard.actions.material_issue_url} target="_blank" rel="noreferrer">Issue overview</Button>
            <Button href={selectedCard.actions.production_receipt_url} target="_blank" rel="noreferrer">Receipt overview</Button>
            <Button href={selectedCard.actions.scan_center_url} target="_blank" rel="noreferrer">Quét QR kiện</Button>
          </Space>
        ) : null}
      >
        {selectedCard ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              showIcon
              type={selectedCard.exceptions.needs_attention ? 'warning' : 'success'}
              message={`${selectedCard.operation.step_name} · ${selectedCard.exceptions.risk_state_label}`}
              description={`${selectedCard.sales.customer_name || selectedCard.sales.sales_order_code || 'Chưa gắn SO'} · Hạn giao ${formatDate(selectedCard.sales.delivery_due_date)}`}
            />
            <Space wrap>
              {renderReadyToDispatchTag(selectedCard)}
              <Tag color={riskColor[selectedCard.exceptions.risk_state]}>{selectedCard.exceptions.risk_state_label}</Tag>
              <Tag color={readinessColor[selectedCard.materials.material_readiness]}>{selectedCard.materials.material_readiness_label}</Tag>
              <Tag color={dependencyColor[selectedCard.exceptions.dependency_state]}>{selectedCard.exceptions.dependency_state_label}</Tag>
              {selectedCardReadiness ? (
                <Tooltip title={selectedCardReadiness.reason}>
                  <Tag color={selectedCardReadiness.color}>{selectedCardReadiness.label}</Tag>
                </Tooltip>
              ) : null}
              {renderOperationStatusTag(selectedCard.operation)}
              {renderExecutionHandoffTag(selectedCard)}
              {selectedCard.operation.display_step || selectedCard.operation.route_step_no ? <Tag>{`Bước ${selectedCard.operation.display_step ?? selectedCard.operation.route_step_no}`}</Tag> : null}
              {selectedCard.operation.group_code ? <Tag>{`Nhóm ${selectedCard.operation.group_code}`}</Tag> : null}
              {selectedCard.operation.allow_parallel ? <Tag color="cyan">Có thể chạy song song</Tag> : null}
              {selectedCard.shop_floor.handover_status ? <Tag color={getHandoverColor(selectedCard.shop_floor.handover_status)}>{selectedCard.shop_floor.handover_status_label}</Tag> : null}
              {selectedCard.operation.block_reason_label ? <Tag color="volcano">{selectedCard.operation.block_reason_label}</Tag> : null}
            </Space>
            <Card size="small" title="READY/WARNING/BLOCKER - chỉ cảnh báo" data-testid="production-planning-ready-to-dispatch-detail">
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Space wrap>
                  {renderReadyToDispatchTag(selectedCard)}
                  <Tag color="default">Chỉ cảnh báo, chưa chặn workflow</Tag>
                </Space>
                <Text type="secondary">{getReadyToDispatchSummary(selectedCard)}</Text>
                {renderReadyToDispatchDetails(selectedCard, 8)}
                <div>
                  <Text strong>Việc cần làm trước dispatch</Text>
                  {renderReadyToDispatchActions(selectedCard, 6)}
                </div>
              </Space>
            </Card>
            {renderExecutionHandoffDetails(selectedCard)}
            <Card size="small" title="Cảnh báo cần xử lý" data-testid="production-planning-detail-warning-panel">
              {selectedCardWarnings.length ? (
                <List
                  size="small"
                  dataSource={selectedCardWarnings.slice(0, 6)}
                  renderItem={(item) => (
                    <List.Item>
                      <List.Item.Meta
                        title={<Space wrap><Tag color={getPlanningWarningColor(item.severity)}>{item.title}</Tag><Text>{item.reason}</Text></Space>}
                        description={`Nên làm: ${item.action}`}
                      />
                    </List.Item>
                  )}
                />
              ) : (
                <Alert type="success" showIcon message="Chưa có cảnh báo cần xử lý cho công đoạn này." description="Công đoạn đang đủ dữ liệu điều độ theo trạng thái hiện tại." />
              )}
            </Card>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <Card size="small">
                <Statistic
                  title="Tiến độ công đoạn"
                  value={Number(selectedCard.operation.planned_qty || 0) ? Math.round((Number(selectedCard.operation.completed_qty || 0) / Number(selectedCard.operation.planned_qty || 1)) * 100) : 0}
                  suffix="%"
                />
              </Card>
              <Card size="small"><Statistic title="SL còn thiếu NVL" value={Number(selectedCard.materials.remaining_issue_qty || 0)} precision={2} /></Card>
              <Card size="small"><Statistic title="Phiếu cấp VT" value={selectedCard.materials.issue_count || 0} /></Card>
              <Card size="small"><Statistic title="Phiếu nhập TP" value={selectedCard.materials.receipt_count || 0} /></Card>
            </div>
            <Card size="small" title="Tổng quan công đoạn">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <div><strong>Mã hàng:</strong> {[selectedCard.order.product_code, selectedCard.order.product_name].filter(Boolean).join(' · ') || '-'}</div>
                <div><strong>Khách hàng / SO:</strong> {selectedCard.sales.customer_name || selectedCard.sales.sales_order_code || '-'}</div>
                <div><strong>Kế hoạch:</strong> {`${formatDate(selectedCard.operation.planned_date)} · ${selectedCard.operation.planned_shift_label || 'Chưa xếp ca'}`}</div>
                <div><strong>Ưu tiên:</strong> {selectedCard.operation.priority_rank ?? 100}</div>
                <div><strong>Dispatch seq:</strong> {selectedCard.operation.dispatch_sequence ?? 100}</div>
                <div><strong>Hạn giao:</strong> {formatDaysToDelivery(selectedCard.exceptions.days_to_delivery)}</div>
                <div><strong>Bộ đệm giao hàng:</strong> {formatDeliveryGap(selectedCard.exceptions.delivery_gap_days)}</div>
                <div><strong>Work center / máy:</strong> {`${selectedCard.capacity.work_center_name || selectedCard.capacity.work_center_code || 'Chưa gán WC'} · ${selectedCard.capacity.machine_name || selectedCard.capacity.machine_code || 'Chưa gán máy'}`}</div>
                <div><strong>Công suất:</strong> {`${selectedCard.capacity.capacity_state_label} · ${formatHours(selectedCard.capacity.scheduled_hours)} · Tải ${formatCapacityLoad(selectedCard.capacity.work_center_load_ratio)}`}</div>
                <div><strong>Người phụ trách sàn máy:</strong> {selectedCard.shop_floor.dispatch_owner || 'Chưa gán'}</div>
                <div><strong>Bàn giao:</strong> {selectedCard.shop_floor.handover_status_label || 'Chưa chốt'}</div>
                <div><strong>Routing step:</strong> {selectedCard.operation.display_step ? `Bước ${selectedCard.operation.display_step}` : selectedCard.operation.route_step_no ? `Route ${selectedCard.operation.route_step_no}` : 'Theo thứ tự sequence'}</div>
                <div><strong>Nhóm routing:</strong> {selectedCard.operation.group_code || 'Không có'}</div>
                <div><strong>Song song:</strong> {selectedCard.operation.allow_parallel ? 'Có thể chạy song song trong cùng bước' : 'Không đánh dấu song song'}</div>
                <div><strong>Công đoạn trước:</strong> {selectedCard.operation.previous_step_name || selectedCard.operation.previous_step_code || 'Không có'}</div>
                <div><strong>Công đoạn sau:</strong> {selectedCard.operation.next_step_name || selectedCard.operation.next_step_code || 'Không có'}</div>
                <div><strong>Ngày bắt đầu / kết thúc:</strong> {`${formatDateTime(selectedCard.operation.started_at)} → ${formatDateTime(selectedCard.operation.finished_at)}`}</div>
                <div><strong>Tham chiếu:</strong> {selectedCard.order.reference || '-'}</div>
              </div>
              {selectedCard.exceptions.block_reason_note ? <div style={{ marginTop: 12 }}><strong>Ghi chú nghẽn:</strong> {selectedCard.exceptions.block_reason_note}</div> : null}
              {selectedCard.shop_floor.handover_note ? <div style={{ marginTop: 12 }}><strong>Ghi chú bàn giao:</strong> {selectedCard.shop_floor.handover_note}</div> : null}
              {selectedCard.operation.status === 'SKIPPED' ? (
                <Alert
                  showIcon
                  type="info"
                  style={{ marginTop: 12 }}
                  message="Công đoạn đã được bỏ qua"
                  description={(
                    <Space direction="vertical" size={2}>
                      <span>{`Lý do: ${getSkipReasonDisplay(selectedCard.operation)}`}</span>
                      <span>{`Người bỏ qua: ${getSkippedByDisplay(selectedCard.operation)}`}</span>
                      <span>{`Thời điểm: ${getSkippedAtDisplay(selectedCard.operation)}`}</span>
                    </Space>
                  )}
                />
              ) : null}
            </Card>
            <Card size="small" title="Cập nhật kết quả / Bỏ qua - Hoàn tất">
              {!canEditSelectedCard ? (
                <Alert
                  type="info"
                  showIcon
                  message="LSX chưa ở trạng thái có thể điều độ trực tiếp."
                  description="Planner chỉ cho phép cập nhật công đoạn khi lệnh đã phát lệnh hoặc đang sản xuất."
                  style={{ marginBottom: 16 }}
                />
              ) : null}
              {canEditSelectedCard && selectedCardDependencyBlocked ? (
                <Alert
                  type="warning"
                  showIcon
                  message="Công đoạn đang chờ công đoạn trước."
                  description="Công đoạn này chưa sẵn sàng để bắt đầu hoặc hoàn thành vì đang chờ công đoạn trước. Nếu cần bỏ qua công đoạn, hãy dùng nút Bỏ qua và nhập lý do; thao tác này sẽ được ghi audit."
                  style={{ marginBottom: 16 }}
                />
              ) : null}
              {canEditSelectedCard ? (
                <Alert
                  type="info"
                  showIcon
                  message="Thao tác trong drawer vẫn chỉ cảnh báo và ghi audit."
                  description="Sau khi nạp ngày/ca/máy/tổ hoặc đổi trạng thái, kiểm tra thẻ Tác động dự kiến rồi bấm Cập nhật công đoạn. Bỏ qua cần nhập lý do riêng để ghi audit."
                  style={{ marginBottom: 16 }}
                />
              ) : null}
              {canEditSelectedCard ? (
                <Space direction="vertical" size={10} style={{ width: '100%', marginBottom: 16 }}>
                  <Space direction="vertical" size={6}>
                    <Text strong>Nạp lịch nhanh</Text>
                    <Space wrap>
                      <Button onClick={() => stageQuickScheduleChange({ planned_date: dayjs(), planned_shift: form.getFieldValue('planned_shift') || 'FULLDAY' })} data-testid="production-planning-quick-schedule-today">
                        Nạp hôm nay
                      </Button>
                      <Button onClick={() => stageQuickScheduleChange({ planned_date: dayjs().add(1, 'day'), planned_shift: form.getFieldValue('planned_shift') || 'FULLDAY' })} data-testid="production-planning-quick-schedule-tomorrow">
                        Nạp ngày mai
                      </Button>
                      <Button onClick={() => stageQuickScheduleChange({ planned_date: null, planned_shift: 'ALL' })} data-testid="production-planning-quick-clear-schedule">
                        Xóa lịch
                      </Button>
                      <Button onClick={() => stageQuickScheduleChange({ work_center_code: '', work_center_name: '', machine_code: '', machine_name: '' })} data-testid="production-planning-quick-clear-resource">
                        Xóa máy/tổ
                      </Button>
                    </Space>
                  </Space>
                  <Space direction="vertical" size={6}>
                    <Text strong>Tín hiệu sàn máy / kết quả</Text>
                    <Text type="secondary">Bỏ qua cần lý do riêng; hoàn tất/cập nhật kiểm tra Tác động dự kiến trước khi lưu.</Text>
                    <div style={shopFloorActionGridStyle}>
                      <Button size={isTouchViewport ? 'middle' : undefined} style={touchButtonStyle} onClick={() => runQuickUpdate({ block_reason_code: 'WAIT_MATERIAL', block_reason_note: form.getFieldValue('block_reason_note') || 'Chờ cấp vật tư trước khi vào máy' })}>
                        Báo chờ vật tư
                      </Button>
                      <Button size={isTouchViewport ? 'middle' : undefined} style={touchButtonStyle} onClick={() => runQuickUpdate({ block_reason_code: 'WAIT_PREVIOUS_STEP', block_reason_note: form.getFieldValue('block_reason_note') || 'Chờ công đoạn trước bàn giao' })}>
                        Báo chờ công đoạn trước
                      </Button>
                      {canSkipSelectedCard ? (
                        <Tooltip title={selectedCardDependencyBlocked ? 'Ngoại lệ có audit: bỏ qua công đoạn này dù đang chờ công đoạn trước.' : 'Bỏ qua công đoạn này và ghi lý do/audit.'}>
                          <Button size={isTouchViewport ? 'middle' : undefined} style={touchButtonStyle} danger onClick={handleOpenSkipModal} loading={skipMutation.isPending} data-testid="production-planning-skip-operation">
                            Bỏ qua
                          </Button>
                        </Tooltip>
                      ) : null}
                      <Tooltip title={selectedCardDependencyBlocked ? selectedBlockedReason : ''}>
                        <span style={touchButtonWrapperStyle}>
                          <Button size={isTouchViewport ? 'middle' : undefined} style={touchButtonStyle} onClick={() => runQuickUpdate({ status: 'READY', block_reason_code: '', block_reason_note: '' })} disabled={selectedCardDependencyBlocked}>
                            Báo sẵn chạy
                          </Button>
                        </span>
                      </Tooltip>
                      <Button size={isTouchViewport ? 'middle' : undefined} style={touchButtonStyle} onClick={() => runQuickUpdate({ block_reason_code: '', block_reason_note: '' })}>
                        Gỡ nghẽn
                      </Button>
                    </div>
                  </Space>
                </Space>
              ) : null}
              {canEditSelectedCard && previewBlockedByValidation ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message={previewBlockedBySkip ? 'Bỏ qua công đoạn cần lý do riêng.' : previewBlockedByDependency ? 'Công đoạn chưa sẵn sàng để đổi trạng thái.' : 'Bổ sung mô tả nghẽn để xem trước tác động.'}
                  description={previewBlockedBySkip ? 'Vui lòng dùng nút Bỏ qua để nhập lý do và ghi audit.' : previewBlockedByDependency ? selectedBlockedReason : 'Khi chọn lý do nghẽn là Khác hoặc gán máy, planner cần nhập đủ thông tin mới tính được preview.'}
                />
              ) : null}
              {canEditSelectedCard && !previewBlockedByValidation && hasPreviewChanges && previewQuery.error ? (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="Không xem trước được tác động điều độ."
                  description={getPlanningActionErrorMessage(previewQuery.error)}
                  action={<Button size="small" onClick={() => void previewQuery.refetch()}>Thử lại</Button>}
                />
              ) : null}
              {canEditSelectedCard && !previewBlockedByValidation && hasPreviewChanges && previewQuery.data ? (
                <Card size="small" style={{ marginBottom: 16 }} data-testid="production-planning-preview-card" title="Tác động dự kiến">
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Space wrap>
                      <Tag color={previewQuery.data.preview.exceptions.needs_attention ? 'gold' : previewQuery.data.preview.materials.ready_to_run ? 'success' : 'blue'}>
                        {previewQuery.data.preview.exceptions.risk_state_label}
                      </Tag>
                      <Tag color={previewQuery.data.preview.materials.ready_to_run ? 'success' : readinessColor[previewQuery.data.preview.materials.material_readiness]}>
                        {previewQuery.data.preview.materials.ready_to_run ? 'Sẵn chạy' : previewQuery.data.preview.materials.material_readiness_label}
                      </Tag>
                      {renderReadyToDispatchTag(previewQuery.data.preview)}
                      <Tag>{`${previewQuery.data.current.bucket.label} -> ${previewQuery.data.preview.bucket.label}`}</Tag>
                      <Tag>{`${previewQuery.data.current.operation.planned_shift_label || 'Chưa xếp ca'} -> ${previewQuery.data.preview.operation.planned_shift_label || 'Chưa xếp ca'}`}</Tag>
                      <Tag color={getCapacityColor(previewQuery.data.preview.capacity.capacity_state)}>
                        {`${previewQuery.data.current.capacity.capacity_state_label} -> ${previewQuery.data.preview.capacity.capacity_state_label}`}
                      </Tag>
                      {previewQuery.data.preview.shop_floor.handover_status ? <Tag>{previewQuery.data.preview.shop_floor.handover_status_label}</Tag> : null}
                    </Space>
                    <Text type="secondary">{`Dự kiến hạn giao: ${formatDaysToDelivery(previewQuery.data.preview.exceptions.days_to_delivery)} · ${formatDeliveryGap(previewQuery.data.preview.exceptions.delivery_gap_days)}`}</Text>
                    <Text type="secondary">{`Work center / máy: ${previewQuery.data.preview.capacity.work_center_name || previewQuery.data.preview.capacity.work_center_code || 'Chưa gán WC'} · ${previewQuery.data.preview.capacity.machine_name || previewQuery.data.preview.capacity.machine_code || 'Chưa gán máy'} · Tải ${formatCapacityLoad(previewQuery.data.preview.capacity.work_center_load_ratio)}`}</Text>
                    {renderReadyToDispatchActions(previewQuery.data.preview, 3, 'production-planning-preview-dispatch-actions')}
                    <Space direction="vertical" size={4}>
                      {previewHighlights.length ? previewHighlights.map((item) => <Text key={item} type="secondary">{`- ${item}`}</Text>) : <Text type="secondary">Thay đổi này chưa làm đổi bucket/rủi ro chính.</Text>}
                    </Space>
                  </Space>
                </Card>
              ) : null}
              {canEditSelectedCard && !previewBlockedByValidation && hasPreviewChanges && previewQuery.isFetching && !previewQuery.data ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="Dang tinh tac dong dieu do..."
                />
              ) : null}
              <Form
                layout="vertical"
                form={form}
                onFinish={(values) => {
                  if (String((values as Record<string, unknown>).status || '').toUpperCase() === 'SKIPPED') {
                    messageApi.warning('Vui lòng dùng nút Bỏ qua và nhập lý do.');
                    return;
                  }
                  if (selectedCard && isStatusChangeBlockedByDependency(selectedCard, (values as Record<string, unknown>).status)) {
                    messageApi.warning(selectedBlockedReason);
                    return;
                  }
                  void updateMutation.mutateAsync(values);
                }}
                data-testid="production-planning-quick-update-form"
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                  <Form.Item name="status" label="Trạng thái">
                    <Select
                      disabled={!canEditSelectedCard}
                      options={[
                        { value: 'PENDING', label: 'Chưa bắt đầu' },
                        { value: 'READY', label: 'Sẵn sàng', disabled: Boolean(selectedCard && isStatusChangeBlockedByDependency(selectedCard, 'READY')) },
                        { value: 'IN_PROGRESS', label: 'Đang làm', disabled: Boolean(selectedCard && isStatusChangeBlockedByDependency(selectedCard, 'IN_PROGRESS')) },
                        { value: 'DONE', label: 'Hoàn thành', disabled: Boolean(selectedCard && isStatusChangeBlockedByDependency(selectedCard, 'DONE')) },
                        { value: 'SKIPPED', label: 'Bỏ qua (dùng nút Bỏ qua)', disabled: true },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="planned_date" label="Ngày kế hoạch">
                    <DatePicker disabled={!canEditSelectedCard} format="DD/MM/YYYY" style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="planned_shift" label="Ca">
                    <Select disabled={!canEditSelectedCard} options={shiftFormOptions} />
                  </Form.Item>
                  <Form.Item name="priority_rank" label="Ưu tiên">
                    <InputNumber disabled={!canEditSelectedCard} min={1} max={9999} style={{ width: '100%' }} data-testid="production-planning-priority-input" />
                  </Form.Item>
                  <Form.Item name="dispatch_sequence" label="Thứ tự dispatch">
                    <InputNumber disabled={!canEditSelectedCard} min={1} max={99999} style={{ width: '100%' }} data-testid="production-planning-dispatch-sequence-input" />
                  </Form.Item>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                  <Form.Item name="work_center_code" label="Work center code">
                    <AutoComplete
                      allowClear
                      disabled={!canEditSelectedCard}
                      options={getWorkCenterOptions(watchedWorkCenterCode, watchedWorkCenterName)}
                      onChange={(value) => applyWorkCenterToForm(form, value)}
                      filterOption={(inputValue, option) => String(option?.label ?? option?.value ?? '').toLowerCase().includes(inputValue.toLowerCase())}
                      placeholder={hasCapacityCatalog ? 'Chọn hoặc nhập work center' : 'VD: IN, BE, DONGGOI'}
                      data-testid="production-planning-work-center-code-input"
                    />
                  </Form.Item>
                  <Form.Item name="work_center_name" label="Tên work center">
                    <Input disabled={!canEditSelectedCard} placeholder="Tên để planner dễ đọc" />
                  </Form.Item>
                  <Form.Item
                    name="machine_code"
                    label="Mã máy"
                    dependencies={['work_center_code']}
                    rules={[
                      ({ getFieldValue }) => ({
                        validator(_, value) {
                          if (String(value || '').trim() && !String(getFieldValue('work_center_code') || '').trim()) {
                            return Promise.reject(new Error('Cần nhập work center trước khi gán máy.'));
                          }
                          return Promise.resolve();
                        },
                      }),
                    ]}
                  >
                    <AutoComplete
                      allowClear
                      disabled={!canEditSelectedCard}
                      options={getMachineOptions(watchedWorkCenterCode, watchedMachineCode, watchedMachineName)}
                      onChange={(value) => applyMachineToForm(form, value)}
                      filterOption={(inputValue, option) => String(option?.label ?? option?.value ?? '').toLowerCase().includes(inputValue.toLowerCase())}
                      placeholder={hasCapacityCatalog ? 'Chọn hoặc nhập máy' : 'VD: MAY-IN-01'}
                      data-testid="production-planning-machine-code-input"
                    />
                  </Form.Item>
                  <Form.Item name="machine_name" label="Tên máy">
                    <Input disabled={!canEditSelectedCard} placeholder="Tên hiển thị trên planner" />
                  </Form.Item>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                  <Form.Item name="estimated_runtime_hours" label="Giờ chạy dự kiến">
                    <InputNumber disabled={!canEditSelectedCard} min={0} max={999} step={0.25} style={{ width: '100%' }} data-testid="production-planning-runtime-input" />
                  </Form.Item>
                  <Form.Item name="setup_minutes" label="Phút setup">
                    <InputNumber disabled={!canEditSelectedCard} min={0} max={9999} style={{ width: '100%' }} data-testid="production-planning-setup-input" />
                  </Form.Item>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  <Form.Item name="block_reason_code" label="Lý do nghẽn">
                    <Select disabled={!canEditSelectedCard} options={blockReasonOptions} />
                  </Form.Item>
                  <Form.Item
                    name="block_reason_note"
                    label="Mô tả nghẽn"
                    dependencies={['block_reason_code']}
                    rules={[
                      ({ getFieldValue }) => ({
                        validator(_, value) {
                          if (getFieldValue('block_reason_code') === 'OTHER' && !String(value || '').trim()) {
                            return Promise.reject(new Error('Vui lòng mô tả rõ lý do nghẽn khi chọn Khác.'));
                          }
                          return Promise.resolve();
                        },
                      }),
                    ]}
                  >
                    <Input disabled={!canEditSelectedCard} placeholder="Ví dụ: chờ giấy lớp 2 hoặc máy đang bảo trì" />
                  </Form.Item>
                </div>
                <Form.Item name="note" label="Ghi chú công đoạn">
                  <Input.TextArea disabled={!canEditSelectedCard} rows={3} placeholder="Ghi chú bàn giao, lưu ý vật tư hoặc rủi ro cần theo dõi." />
                </Form.Item>
                <Space wrap>
                  <Button type="primary" htmlType="submit" loading={updateMutation.isPending} disabled={!canEditSelectedCard} data-testid="production-planning-quick-update-submit">Cập nhật công đoạn</Button>
                  <Button onClick={() => form.resetFields()}>Khôi phục form</Button>
                </Space>
              </Form>
            </Card>
            <Card size="small" title="Issue overview">
              {issueQuery.error ? (
                <Alert
                  type="error"
                  showIcon
                  message="Không tải được issue overview."
                  description={getToastMessage(issueQuery.error)}
                  action={<Button size="small" onClick={() => void issueQuery.refetch()}>Thử lại</Button>}
                />
              ) : (
                <List
                  loading={issueQuery.isLoading}
                  dataSource={issueQuery.data?.results ?? []}
                  locale={{ emptyText: 'Chưa có chứng từ cấp vật tư cho LSX này.' }}
                  renderItem={(item) => (
                    <List.Item>
                      <Space direction="vertical" size={2}>
                        <strong>{item.code}</strong>
                        <Text type="secondary">{`${formatDate(item.issue_date)} · ${formatQty(item.total_qty)} · ${item.reference || 'Không có tham chiếu'}`}</Text>
                      </Space>
                    </List.Item>
                  )}
                />
              )}
            </Card>
            <Card size="small" title="Receipt overview">
              {receiptQuery.error ? (
                <Alert
                  type="error"
                  showIcon
                  message="Không tải được receipt overview."
                  description={getToastMessage(receiptQuery.error)}
                  action={<Button size="small" onClick={() => void receiptQuery.refetch()}>Thử lại</Button>}
                />
              ) : (
                <List
                  loading={receiptQuery.isLoading}
                  dataSource={receiptQuery.data?.results ?? []}
                  locale={{ emptyText: 'Chưa có chứng từ nhập thành phẩm cho LSX này.' }}
                  renderItem={(item) => (
                    <List.Item>
                      <Space direction="vertical" size={2}>
                        <strong>{item.code}</strong>
                        <Text type="secondary">{`${formatDate(item.receipt_date)} · ${formatQty(item.total_qty)} · ${item.reference || 'Không có tham chiếu'}`}</Text>
                      </Space>
                    </List.Item>
                  )}
                />
              )}
            </Card>
            <Card size="small" title="Timeline workflow">
              {timelineQuery.isLoading ? (
                <Skeleton active paragraph={{ rows: 4 }} />
              ) : timelineQuery.error ? (
                <Alert
                  type="error"
                  showIcon
                  message="Không tải được timeline workflow."
                  description={getToastMessage(timelineQuery.error)}
                  action={<Button size="small" onClick={() => void timelineQuery.refetch()}>Thử lại</Button>}
                />
              ) : timelineQuery.data?.items?.length ? (
                <Timeline
                  items={timelineQuery.data.items.map((item) => ({
                    color: item.action === 'FAIL' ? 'red' : item.action === 'MOVE' ? 'blue' : 'green',
                    children: (
                      <Space direction="vertical" size={0}>
                        <strong>{`${item.action} · ${item.to_step || 'N/A'}`}</strong>
                        <Text type="secondary">{`${item.actor || 'Hệ thống'} · ${formatDateTime(item.created_at)}`}</Text>
                        {item.note ? <span>{item.note}</span> : null}
                      </Space>
                    ),
                  }))}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có timeline workflow cho LSX này." />
              )}
            </Card>
          </Space>
        ) : null}
      </Drawer>
      <Modal
        open={isScenarioModalOpen}
        title={selectedSavedScenario ? 'Cập nhật scenario rebalance' : 'Lưu scenario rebalance'}
        okText="Lưu scenario"
        cancelText="Dong"
        okButtonProps={{ 'data-testid': 'production-planning-save-scenario-submit' }}
        cancelButtonProps={{ 'data-testid': 'production-planning-save-scenario-cancel' }}
        onOk={() => void handleSaveScenario()}
        onCancel={() => {
          setIsScenarioModalOpen(false);
          setScenarioName('');
        }}
        data-testid="production-planning-scenario-modal"
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text type="secondary">
            Lưu lại nhóm gợi ý, bộ lọc planner và điểm khoanh queue/window hiện tại để đội điều độ mở lại đúng ngữ cảnh trong ca sau.
          </Text>
          <Input value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} placeholder="Ví dụ: Rebalance ca chiều line Xa" data-testid="production-planning-scenario-name" />
        </Space>
      </Modal>
      <Modal
        open={isPresetModalOpen}
        title={selectedPreset ? 'Cập nhật mẫu planner' : 'Lưu mẫu planner'}
        okText="Lưu mẫu"
        cancelText="Đóng"
        onOk={() => void handleSavePreset()}
        onCancel={() => {
          setIsPresetModalOpen(false);
          setPresetName('');
        }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text type="secondary">Lưu nhanh bộ lọc hiện tại để liên phòng ban mở đúng góc nhìn theo ca, công đoạn hoặc cụm khách hàng.</Text>
          <Input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Ví dụ: Planner ca sáng corrugator" data-testid="production-planning-preset-name" />
        </Space>
      </Modal>
    </div>
  );
}
