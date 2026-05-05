export type ProductionOrderStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'RELEASED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';
export type ProductionOrderSourceFilter = 'ALL' | 'DEMAND' | 'MANUAL';

export type ProductionOperationStatus = 'PENDING' | 'READY' | 'IN_PROGRESS' | 'DONE' | 'SKIPPED';
export type ProductionOperationHandoverStatus = 'ACTIVE' | 'READY' | 'ACCEPTED';
export type ProductionPlanningShift = 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT' | 'FULLDAY';
export type ProductionCapacityState = 'BALANCED' | 'AT_LIMIT' | 'OVER_CAPACITY' | 'UNASSIGNED_MACHINE' | 'UNASSIGNED_WORK_CENTER';
export type ProductionOperationBlockReasonCode =
  | 'WAIT_MATERIAL'
  | 'WAIT_PREVIOUS_STEP'
  | 'WAIT_APPROVAL'
  | 'MACHINE_DOWN'
  | 'OTHER';
export type ProductionOperationMaterialReadiness = 'READY' | 'PARTIAL' | 'WAITING';
export type ProductionOperationDependencyState = 'ROOT' | 'CLEAR' | 'WAIT_PREVIOUS_STEP';
export type ProductionOperationRiskState = 'DONE' | 'UNSCHEDULED' | 'OVERDUE' | 'BLOCKED' | 'AT_RISK' | 'ON_TRACK';
export type ProductionIssueStatus = 'POSTED' | 'CANCELLED';
export type ProductionReceiptStatus = 'POSTED' | 'CANCELLED';
export type ProductionDemandPlanningStatus =
  | 'NOT_DUE'
  | 'UPCOMING'
  | 'DUE'
  | 'OVERDUE'
  | 'PARTIALLY_PLANNED'
  | 'FULLY_PLANNED'
  | 'NO_PRODUCTION_NEEDED'
  | 'CANCELLED';
export type ProductionDemandProductionStatus =
  | 'NOT_RELEASED'
  | 'PARTIALLY_RELEASED'
  | 'FULLY_RELEASED'
  | 'IN_PROGRESS'
  | 'PARTIALLY_COMPLETED'
  | 'COMPLETED'
  | 'PAUSED'
  | 'CANCELLED';
export type ProductionDemandPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type ProductionDemandProductKind = 'SPECIFIC' | 'GENERIC' | string;
export type ProductionDemandPlanningBucket = 'held' | 'cancelled' | 'no_date' | 'overdue' | 'due_today' | 'upcoming_7' | 'not_due';
export type ProductionPlanningBucketKey = 'OVERDUE' | 'TODAY' | 'TOMORROW' | 'UPCOMING' | 'UNSCHEDULED';
export type ProductionPlanningShiftFilter = ProductionPlanningShift | 'UNASSIGNED';
export type ProductionPlanningHandoverFilter = ProductionOperationHandoverStatus | 'NONE';
export type ProductionPlanningExceptionGroupKey = 'OVERDUE' | 'WAIT_MATERIAL' | 'WAIT_PREVIOUS_STEP' | 'UNSCHEDULED' | 'READY_TO_RUN';

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ProductionDemandLinkedOrder {
  id: number;
  code: string;
  status: ProductionOrderStatus;
  planned_qty: string;
  produced_qty: string;
  scrap_qty: string;
  planned_start_date?: string | null;
  planned_end_date?: string | null;
  released_at?: string | null;
  completed_at?: string | null;
  operation_count: number;
}

export interface ProductionDemand {
  id: number;
  demand_code?: string | null;
  demand_key: string;
  sales_order: number;
  sales_order_code?: string | null;
  sales_order_line: number;
  sales_order_line_number?: number | null;
  delivery_plan?: number | null;
  delivery_plan_date?: string | null;
  delivery_plan_display?: string;
  product?: number | null;
  product_display_code?: string | null;
  product_display_name?: string | null;
  customer_id_snapshot?: number | null;
  customer_name_snapshot?: string;
  customer_display?: string;
  product_code?: string;
  product_name?: string;
  product_kind?: ProductionDemandProductKind;
  unit_name?: string;
  size_order?: string;
  size_production?: string;
  print_colors?: unknown[] | string | null;
  operations_summary?: unknown[] | string | Record<string, unknown> | null;
  routing_summary?: unknown[] | string | Record<string, unknown> | null;
  qty_required: string;
  qty_planned: string;
  qty_released: string;
  qty_completed: string;
  qty_remaining_to_plan: string;
  qty_remaining_to_release: string;
  qty_remaining_to_complete: string;
  planning_bucket: ProductionDemandPlanningBucket;
  is_held: boolean;
  order_date?: string | null;
  delivery_date?: string | null;
  production_due_date?: string | null;
  planning_due_date?: string | null;
  reminder_date?: string | null;
  planning_status: ProductionDemandPlanningStatus;
  production_status: ProductionDemandProductionStatus;
  priority: ProductionDemandPriority;
  assigned_planner?: number | null;
  assigned_planner_name?: string | null;
  notes?: string;
  reminder_note?: string;
  hold_reason?: string;
  source?: string;
  created_by?: number | null;
  updated_by?: number | null;
  created_at: string;
  updated_at: string;
  production_orders?: ProductionDemandLinkedOrder[];
}

export interface ProductionDemandSummary {
  total: number;
  held: number;
  cancelled: number;
  no_date: number;
  overdue: number;
  due_today: number;
  upcoming_7_days: number;
  not_due: number;
  partially_planned: number;
  fully_planned: number;
  no_production_needed: number;
  not_released: number;
  in_progress: number;
  completed: number;
}

export interface ProductionDemandQueryParams {
  page?: number;
  page_size?: number;
  q?: string;
  search?: string;
  planning_status?: ProductionDemandPlanningStatus | string;
  production_status?: ProductionDemandProductionStatus | string;
  product_kind?: ProductionDemandProductKind;
  priority?: ProductionDemandPriority | string;
  planning_bucket?: ProductionDemandPlanningBucket | string;
  delivery_date_from?: string;
  delivery_date_to?: string;
  planning_due_date_from?: string;
  planning_due_date_to?: string;
  product_code?: string;
  customer?: string;
  assigned_planner?: number | string;
  sales_order?: number | string;
  sales_order_line?: number | string;
  delivery_plan?: number | string;
  product?: number | string;
  ordering?: string;
}

export interface ProductionDemandCreateOrderPayload {
  qty: string;
  planned_start_date?: string | null;
  planned_end_date?: string | null;
  note?: string;
}

export interface ProductionDemandCreateOrderResponse {
  message?: string;
  production_order_id: number;
  production_order_code: string;
  operation_count: number;
  production_order: ProductionOrder;
  production_demand: ProductionDemand;
}

export interface ProductionOperation {
  id: number;
  sequence: number;
  step_code: string;
  step_name: string;
  source_field?: string;
  route_step_no?: number | null;
  display_step?: number | null;
  display_order?: number | null;
  step_type?: string;
  group_code?: string;
  is_required?: boolean;
  allow_parallel?: boolean;
  source_operation_code?: string;
  rate_per_hour: string;
  planned_qty: string;
  completed_qty: string;
  scrap_qty: string;
  planned_date?: string | null;
  planned_shift?: ProductionPlanningShift | '';
  planned_shift_label?: string;
  priority_rank?: number;
  dispatch_sequence?: number;
  work_center_code?: string;
  work_center_name?: string;
  machine_code?: string;
  machine_name?: string;
  estimated_runtime_hours?: string;
  setup_minutes?: number;
  block_reason_code?: ProductionOperationBlockReasonCode | '';
  block_reason_label?: string;
  block_reason_note?: string;
  dispatch_owner?: string;
  handover_status?: ProductionOperationHandoverStatus | '';
  handover_status_label?: string;
  handover_receiver?: string;
  handover_note?: string;
  handover_at?: string | null;
  status: ProductionOperationStatus;
  started_at?: string | null;
  finished_at?: string | null;
  note?: string;
  material_readiness?: ProductionOperationMaterialReadiness;
  dependency_state?: ProductionOperationDependencyState;
  risk_state?: ProductionOperationRiskState;
  previous_step_code?: string | null;
  previous_step_name?: string | null;
  next_step_code?: string | null;
  next_step_name?: string | null;
  remaining_issue_qty?: string;
  remaining_issue_line_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ProductionPlanningCard {
  card_key: string;
  bucket: {
    key: ProductionPlanningBucketKey;
    label: string;
    sort_order: number;
    date?: string | null;
  };
  order: {
    id: number;
    code: string;
    status: ProductionOrderStatus;
    product_id?: number | null;
    product_code?: string | null;
    product_name?: string | null;
    planned_qty: string;
    produced_qty: string;
    remaining_qty: string;
    planned_start_date?: string | null;
    planned_end_date?: string | null;
    reference?: string | null;
  };
  operation: ProductionOperation;
  sales: {
    sales_order_id?: number | null;
    sales_order_code?: string | null;
    sales_order_line_id?: number | null;
    sales_order_line_number?: number | null;
    customer_code?: string | null;
    customer_name?: string | null;
    delivery_due_date?: string | null;
  };
  materials: {
    material_readiness: ProductionOperationMaterialReadiness;
    material_readiness_label: string;
    remaining_issue_qty: string;
    remaining_issue_line_count: number;
    issue_count: number;
    receipt_count: number;
    ready_to_run: boolean;
  };
  exceptions: {
    risk_state: ProductionOperationRiskState;
    risk_state_label: string;
    dependency_state: ProductionOperationDependencyState;
    dependency_state_label: string;
    block_reason_code?: ProductionOperationBlockReasonCode | '';
    block_reason_label?: string;
    block_reason_note?: string;
    overdue_days: number;
    days_to_delivery?: number | null;
    delivery_gap_days?: number | null;
    is_overdue: boolean;
    is_unscheduled: boolean;
    needs_attention: boolean;
  };
  shop_floor: {
    dispatch_owner?: string;
    handover_status?: ProductionOperationHandoverStatus | '';
    handover_status_label?: string;
    handover_receiver?: string;
    handover_note?: string;
    handover_at?: string | null;
  };
  capacity: {
    work_center_code?: string;
    work_center_name?: string;
    machine_code?: string;
    machine_name?: string;
    shift_key: ProductionPlanningShiftFilter;
    shift_label: string;
    runtime_hours: string;
    setup_hours: string;
    scheduled_hours: string;
    shift_capacity_hours: string;
    work_center_load_hours: string;
    machine_load_hours: string;
    work_center_load_ratio?: string | null;
    machine_load_ratio?: string | null;
    capacity_state: ProductionCapacityState;
    capacity_state_label: string;
    over_capacity: boolean;
    unassigned_machine: boolean;
    unassigned_work_center: boolean;
  };
  actions: {
    production_order_url: string;
    sales_fulfillment_url: string;
    material_issue_url: string;
    production_receipt_url: string;
    scan_center_url: string;
  };
}

export interface ProductionPlanningLaneBucket {
  key: ProductionPlanningBucketKey;
  label: string;
  sort_order: number;
  count: number;
  cards: ProductionPlanningCard[];
}

export interface ProductionPlanningShiftLoad {
  key: ProductionPlanningShiftFilter;
  label: string;
  sort_order: number;
  total_operations: number;
  ready_to_run_count: number;
  needs_attention_count: number;
  overdue_count: number;
  planned_qty: string;
}

export interface ProductionPlanningDispatchGroup {
  key: ProductionPlanningShiftFilter;
  label: string;
  sort_order: number;
  total_operations: number;
  ready_to_run_count: number;
  in_progress_count: number;
  blocked_count: number;
  handover_ready_count: number;
  handover_accepted_count: number;
  active_owner_count: number;
  owners: string[];
  cards: ProductionPlanningCard[];
}

export interface ProductionPlanningWorkCenterGroup {
  key: string;
  work_center_code: string;
  work_center_name: string;
  planned_date?: string | null;
  shift_key: ProductionPlanningShiftFilter;
  shift_label: string;
  sort_order: number;
  total_operations: number;
  ready_to_run_count: number;
  blocked_count: number;
  in_progress_count: number;
  runtime_hours: string;
  setup_hours: string;
  scheduled_hours: string;
  capacity_hours: string;
  load_ratio?: string | null;
  machine_count: number;
  overloaded: boolean;
  cards: ProductionPlanningCard[];
}

export interface ProductionPlanningMachineQueue {
  key: string;
  work_center_code: string;
  work_center_name: string;
  machine_code: string;
  machine_name: string;
  planned_date?: string | null;
  shift_key: ProductionPlanningShiftFilter;
  shift_label: string;
  sort_order: number;
  total_operations: number;
  ready_to_run_count: number;
  overdue_count: number;
  runtime_hours: string;
  setup_hours: string;
  scheduled_hours: string;
  capacity_hours: string;
  load_ratio?: string | null;
  overloaded: boolean;
  cards: ProductionPlanningCard[];
}

export interface ProductionPlanningDispatchOwnerGroup {
  key: string;
  dispatch_owner: string;
  total_operations: number;
  ready_to_run_count: number;
  blocked_count: number;
  overdue_count: number;
  handover_ready_count: number;
  affected_sales_order_count: number;
  focus_url: string;
}

export interface ProductionPlanningSalesWatchItem {
  key: string;
  sales_order_code: string;
  customer_code?: string | null;
  customer_name?: string | null;
  total_operations: number;
  overdue_count: number;
  wait_material_count: number;
  blocked_count: number;
  negative_delivery_gap_count: number;
  earliest_due_date?: string | null;
  focus_url: string;
  sales_fulfillment_url: string;
}

export interface ProductionPlanningMaterialWatchItem {
  key: string;
  material_product_code: string;
  material_product_name: string;
  internal_product_code?: string | null;
  total_orders: number;
  impacted_operations: number;
  wait_material_operations: number;
  remaining_issue_qty: string;
  affected_sales_order_count: number;
  sample_order_codes: string[];
  focus_url: string;
  material_issue_url: string;
}

export interface ProductionPlanningWorkCenterWatchItem {
  key: string;
  work_center_code: string;
  work_center_name?: string | null;
  total_operations: number;
  ready_to_run_count: number;
  blocked_count: number;
  overdue_count: number;
  overloaded_slot_count: number;
  at_limit_slot_count: number;
  total_scheduled_hours: string;
  total_capacity_hours: string;
  peak_load_ratio: string;
  machine_count: number;
  affected_sales_order_count: number;
  sample_order_codes: string[];
  hot_slot_date?: string | null;
  hot_shift_key?: ProductionPlanningShiftFilter | null;
  hot_shift_label?: string | null;
  focus_url: string;
}

export interface ProductionPlanningMachineWatchItem {
  key: string;
  machine_code: string;
  machine_name?: string | null;
  work_center_code?: string | null;
  work_center_name?: string | null;
  total_operations: number;
  ready_to_run_count: number;
  blocked_count: number;
  overdue_count: number;
  overloaded_queue_count: number;
  queue_count: number;
  total_scheduled_hours: string;
  total_capacity_hours: string;
  peak_load_ratio: string;
  affected_sales_order_count: number;
  sample_order_codes: string[];
  hot_queue_key?: string | null;
  hot_queue_date?: string | null;
  hot_shift_key?: ProductionPlanningShiftFilter | null;
  hot_shift_label?: string | null;
  focus_url: string;
}

export interface ProductionPlanningDeliveryWatchItem {
  key: string;
  delivery_due_date: string;
  total_operations: number;
  ready_to_run_count: number;
  blocked_count: number;
  overdue_count: number;
  wait_material_count: number;
  negative_delivery_gap_count: number;
  affected_sales_order_count: number;
  sample_sales_order_codes: string[];
  sample_order_codes: string[];
  focus_url: string;
}

export interface ProductionPlanningUnscheduledWatchItem {
  key: string;
  step_code: string;
  step_name?: string | null;
  total_operations: number;
  ready_to_run_count: number;
  wait_material_count: number;
  affected_order_count: number;
  affected_sales_order_count: number;
  sample_order_codes: string[];
  focus_url: string;
}

export interface ProductionPlanningShiftWatchItem {
  key: string;
  shift_key: ProductionPlanningShiftFilter;
  shift_label: string;
  total_operations: number;
  ready_to_run_count: number;
  blocked_count: number;
  overdue_count: number;
  needs_attention_count: number;
  overloaded_slot_count: number;
  at_limit_slot_count: number;
  total_scheduled_hours: string;
  total_capacity_hours: string;
  peak_load_ratio: string;
  affected_sales_order_count: number;
  sample_order_codes: string[];
  hot_date?: string | null;
  hot_date_label?: string | null;
  hot_window_state?: 'BALANCED' | 'AT_LIMIT' | 'OVER_CAPACITY';
  focus_url: string;
}

export interface ProductionPlanningDateWatchItem {
  key: string;
  date?: string | null;
  date_label: string;
  total_operations: number;
  ready_to_run_count: number;
  blocked_count: number;
  overdue_count: number;
  needs_attention_count: number;
  over_capacity_count: number;
  at_limit_count: number;
  total_scheduled_hours: string;
  peak_load_ratio: string;
  affected_sales_order_count: number;
  sample_order_codes: string[];
  hot_shift_key?: ProductionPlanningShiftFilter | null;
  hot_shift_label?: string | null;
  hot_window_state?: 'BALANCED' | 'AT_LIMIT' | 'OVER_CAPACITY';
  focus_url: string;
}

export interface ProductionPlanningDispatchOwnerCapacityWatchItem {
  key: string;
  dispatch_owner: string;
  total_operations: number;
  ready_to_run_count: number;
  blocked_count: number;
  overdue_count: number;
  needs_attention_count: number;
  over_capacity_count: number;
  at_limit_count: number;
  total_scheduled_hours: string;
  peak_load_ratio: string;
  affected_sales_order_count: number;
  sample_order_codes: string[];
  focus_url: string;
}

export interface ProductionPlanningStepWatchItem {
  key: string;
  step_code: string;
  step_name?: string | null;
  total_operations: number;
  ready_to_run_count: number;
  unscheduled_count: number;
  blocked_count: number;
  overdue_count: number;
  wait_material_count: number;
  affected_order_count: number;
  affected_sales_order_count: number;
  total_scheduled_hours: string;
  sample_order_codes: string[];
  focus_url: string;
}

export interface ProductionPlanningRebalanceSummaryItem {
  key: string;
  kind: 'ASSIGN_WORK_CENTER' | 'ASSIGN_MACHINE' | 'MOVE_WORK_CENTER' | 'MOVE_SHIFT' | 'MOVE_DAY';
  kind_label: string;
  dominant_severity: 'critical' | 'warning' | 'info';
  total_suggestions: number;
  critical_count: number;
  warning_count: number;
  info_count: number;
  sample_order_codes: string[];
  sample_titles: string[];
  suggestion_keys: string[];
  focus_url: string;
}

export interface ProductionPlanningLane {
  key: string;
  step_code: string;
  step_name: string;
  sequence: number;
  total_cards: number;
  bucket_count: number;
  shift_loads: ProductionPlanningShiftLoad[];
  buckets: ProductionPlanningLaneBucket[];
}

export interface ProductionPlanningSummary {
  total_orders: number;
  total_operations: number;
  overdue_operations: number;
  ready_to_run_count: number;
  wait_material_count: number;
  wait_previous_step_count: number;
  machine_down_count: number;
  over_capacity_count: number;
  at_limit_count: number;
  unassigned_machine_count: number;
  unassigned_work_center_count: number;
  unscheduled_count: number;
  blocked_count: number;
  in_progress_count: number;
  handover_ready_count: number;
  handover_accepted_count: number;
  affected_sales_order_count: number;
  avg_days_to_deadline?: number | null;
  bucket_counts: Record<ProductionPlanningBucketKey, number>;
  risk_counts: Record<ProductionOperationRiskState, number>;
  capacity_state_counts: Record<ProductionCapacityState, number>;
  total_runtime_hours: string;
  total_setup_hours: string;
  total_scheduled_hours: string;
  over_capacity_slot_count: number;
  shift_loads: ProductionPlanningShiftLoad[];
}

export interface ProductionPlanningCapacityCalendarShift {
  key: string;
  date?: string | null;
  shift_key: ProductionPlanningShiftFilter;
  shift_label: string;
  sort_order: number;
  total_operations: number;
  ready_to_run_count: number;
  needs_attention_count: number;
  blocked_count: number;
  over_capacity_count: number;
  at_limit_count: number;
  unassigned_machine_count: number;
  unassigned_work_center_count: number;
  runtime_hours: string;
  setup_hours: string;
  scheduled_hours: string;
  capacity_hours: string;
  load_ratio?: string | null;
  window_state: 'BALANCED' | 'AT_LIMIT' | 'OVER_CAPACITY';
  affected_sales_order_count: number;
}

export interface ProductionPlanningCapacityCalendarRow {
  key: string;
  date?: string | null;
  date_label: string;
  sort_order: number;
  total_operations: number;
  ready_to_run_count: number;
  needs_attention_count: number;
  blocked_count: number;
  over_capacity_count: number;
  at_limit_count: number;
  runtime_hours: string;
  setup_hours: string;
  scheduled_hours: string;
  affected_sales_order_count: number;
  shifts: ProductionPlanningCapacityCalendarShift[];
}

export interface ProductionPlanningRebalanceSuggestion {
  key: string;
  kind: 'ASSIGN_WORK_CENTER' | 'ASSIGN_MACHINE' | 'MOVE_WORK_CENTER' | 'MOVE_SHIFT' | 'MOVE_DAY';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  card_key: string;
  order_id: number;
  order_code: string;
  operation_id: number;
  operation_code: string;
  focus_url: string;
  focus_filters: Record<string, string | number | boolean>;
  suggested_changes: Partial<{
    planned_date: string | null;
    planned_shift: ProductionPlanningShiftFilter;
    work_center_code: string;
    work_center_name: string;
    machine_code: string;
    machine_name: string;
  }>;
  projected_source_load_ratio?: string | null;
  projected_target_load_ratio?: string | null;
  source: {
    planned_date?: string | null;
    shift_key?: ProductionPlanningShiftFilter | '';
    work_center_code?: string;
    work_center_name?: string;
    machine_code?: string;
    machine_name?: string;
    capacity_state?: ProductionCapacityState | '';
  };
  target: {
    planned_date?: string | null;
    shift_key?: ProductionPlanningShiftFilter | '';
    work_center_code?: string;
    work_center_name?: string;
    machine_code?: string;
    machine_name?: string;
  };
}

export interface ProductionPlanningExceptionGroup {
  key: ProductionPlanningExceptionGroupKey;
  label: string;
  count: number;
  severity: 'critical' | 'warning' | 'info' | 'success';
  description: string;
  filters: Record<string, string | number | boolean>;
  primary_action: {
    label: string;
    url: string;
  };
  secondary_action: {
    label: string;
    url: string;
  };
}

export interface ProductionPlanningBoardResponse {
  summary: ProductionPlanningSummary;
  scope_summary: ProductionPlanningSummary;
  lanes: ProductionPlanningLane[];
  watchlist: ProductionPlanningCard[];
  exception_groups: ProductionPlanningExceptionGroup[];
  dispatch_groups: ProductionPlanningDispatchGroup[];
  work_center_groups: ProductionPlanningWorkCenterGroup[];
  machine_queues: ProductionPlanningMachineQueue[];
  capacity_calendar: ProductionPlanningCapacityCalendarRow[];
  rebalance_suggestions: ProductionPlanningRebalanceSuggestion[];
  dispatch_owner_groups: ProductionPlanningDispatchOwnerGroup[];
  sales_watch: ProductionPlanningSalesWatchItem[];
  material_watch: ProductionPlanningMaterialWatchItem[];
  work_center_watch: ProductionPlanningWorkCenterWatchItem[];
  machine_watch: ProductionPlanningMachineWatchItem[];
  delivery_watch: ProductionPlanningDeliveryWatchItem[];
  unscheduled_watch: ProductionPlanningUnscheduledWatchItem[];
  shift_watch: ProductionPlanningShiftWatchItem[];
  date_watch: ProductionPlanningDateWatchItem[];
  dispatch_owner_capacity_watch: ProductionPlanningDispatchOwnerCapacityWatchItem[];
  step_watch: ProductionPlanningStepWatchItem[];
  rebalance_summary: ProductionPlanningRebalanceSummaryItem[];
}

export interface ProductionPlanningPreviewResponse {
  current: ProductionPlanningCard;
  preview: ProductionPlanningCard;
  impact: {
    bucket_changed: boolean;
    risk_changed: boolean;
    ready_to_run_changed: boolean;
    needs_attention_changed: boolean;
    days_to_delivery_delta?: number | null;
    delivery_gap_delta?: number | null;
    handover_status_changed: boolean;
    capacity_state_changed: boolean;
    work_center_changed: boolean;
    machine_changed: boolean;
    work_center_load_ratio_delta?: number | null;
  };
}

export interface ProductionPlanningBulkPreviewSummary {
  total_operations: number;
  ready_to_run_count: number;
  needs_attention_count: number;
  blocked_count: number;
  overdue_count: number;
  machine_down_count: number;
  over_capacity_count: number;
  at_limit_count: number;
  unassigned_machine_count: number;
  unassigned_work_center_count: number;
  handover_ready_count: number;
  handover_accepted_count: number;
  negative_delivery_gap_count: number;
  total_runtime_hours: string;
  total_setup_hours: string;
  total_scheduled_hours: string;
  shift_loads: ProductionPlanningShiftLoad[];
}

export interface ProductionPlanningBulkPreviewOperationImpact {
  bucket_changed: boolean;
  risk_changed: boolean;
  ready_to_run_changed: boolean;
  needs_attention_changed: boolean;
  delivery_gap_delta?: number | null;
  handover_status_changed: boolean;
  capacity_state_changed: boolean;
  work_center_changed: boolean;
  machine_changed: boolean;
  work_center_load_ratio_delta?: number | null;
}

export interface ProductionPlanningBulkPreviewOperation {
  order_id: number;
  order_code: string;
  operation_id: number;
  current: ProductionPlanningCard;
  preview: ProductionPlanningCard;
  impact: ProductionPlanningBulkPreviewOperationImpact;
  scenario?: {
    suggestion_key: string;
    suggestion_kind: string;
    suggestion_title: string;
    severity: string;
  };
}

export interface ProductionPlanningScenarioSummaryDelta {
  ready_to_run_delta: number;
  needs_attention_delta: number;
  over_capacity_delta: number;
  at_limit_delta: number;
  negative_delivery_gap_delta: number;
  total_scheduled_hours_delta: string;
  machine_down_delta: number;
}

export interface ProductionPlanningPreviewWindow {
  date?: string | null;
  date_label: string;
  score: number;
  shift: ProductionPlanningCapacityCalendarShift;
}

export interface ProductionPlanningBulkPreviewResponse {
  current_summary: ProductionPlanningBulkPreviewSummary;
  preview_summary: ProductionPlanningBulkPreviewSummary;
  summary_delta?: ProductionPlanningScenarioSummaryDelta;
  operations: ProductionPlanningBulkPreviewOperation[];
  capacity_windows?: ProductionPlanningPreviewWindow[];
  machine_queue_highlights?: ProductionPlanningMachineQueue[];
}

export interface ProductionPlannerDigestWindowFocus {
  key: string;
  date?: string | null;
  date_label: string;
  shift_key: string;
  shift_label: string;
  window_state: 'BALANCED' | 'AT_LIMIT' | 'OVER_CAPACITY';
  total_operations: number;
  needs_attention_count: number;
  over_capacity_count: number;
  at_limit_count: number;
  load_ratio?: string | null;
  focus_url: string;
}

export interface ProductionPlannerDigestQueueFocus {
  key: string;
  planned_date?: string | null;
  shift_key: string;
  shift_label: string;
  work_center_code: string;
  work_center_name: string;
  machine_code: string;
  machine_name: string;
  total_operations: number;
  ready_to_run_count: number;
  overdue_count: number;
  load_ratio?: string | null;
  overloaded: boolean;
  focus_url: string;
}

export interface ProductionPlannerDigestDispatchOwnerFocus {
  key: string;
  dispatch_owner: string;
  total_operations: number;
  ready_to_run_count: number;
  blocked_count: number;
  overdue_count: number;
  handover_ready_count: number;
  affected_sales_order_count: number;
  focus_url: string;
}

export interface ProductionPlannerDigestSalesFocus {
  key: string;
  sales_order_code: string;
  customer_code?: string | null;
  customer_name?: string | null;
  total_operations: number;
  overdue_count: number;
  wait_material_count: number;
  blocked_count: number;
  negative_delivery_gap_count: number;
  earliest_due_date?: string | null;
  focus_url: string;
  sales_fulfillment_url: string;
}

export interface ProductionPlannerDigestMaterialFocus {
  key: string;
  material_product_code: string;
  material_product_name: string;
  internal_product_code?: string | null;
  total_orders: number;
  impacted_operations: number;
  wait_material_operations: number;
  remaining_issue_qty: string;
  affected_sales_order_count: number;
  sample_order_codes: string[];
  focus_url: string;
  material_issue_url: string;
}

export interface ProductionPlannerDigest {
  overdue_operations: number;
  ready_to_run_count: number;
  wait_material_count: number;
  wait_previous_step_count: number;
  machine_down_count: number;
  over_capacity_count: number;
  at_limit_count: number;
  over_capacity_slot_count: number;
  unscheduled_count: number;
  blocked_count: number;
  handover_ready_count: number;
  handover_accepted_count: number;
  unassigned_machine_count: number;
  unassigned_work_center_count: number;
  affected_sales_order_count: number;
  hot_over_capacity_window?: ProductionPlannerDigestWindowFocus | null;
  hot_at_limit_window?: ProductionPlannerDigestWindowFocus | null;
  hot_machine_queue?: ProductionPlannerDigestQueueFocus | null;
  hot_dispatch_owner?: ProductionPlannerDigestDispatchOwnerFocus | null;
  hot_sales_order?: ProductionPlannerDigestSalesFocus | null;
  hot_material_wait?: ProductionPlannerDigestMaterialFocus | null;
  hot_work_center?: ProductionPlanningWorkCenterWatchItem | null;
  hot_machine?: ProductionPlanningMachineWatchItem | null;
  hot_delivery_date?: ProductionPlanningDeliveryWatchItem | null;
  hot_unscheduled_step?: ProductionPlanningUnscheduledWatchItem | null;
  hot_shift_watch?: ProductionPlanningShiftWatchItem | null;
  hot_date_watch?: ProductionPlanningDateWatchItem | null;
  hot_owner_capacity?: ProductionPlanningDispatchOwnerCapacityWatchItem | null;
  hot_step_watch?: ProductionPlanningStepWatchItem | null;
  hot_rebalance_summary?: ProductionPlanningRebalanceSummaryItem | null;
}

export interface ProductionOrderSummary {
  total_orders: number;
  draft_count: number;
  submitted_count: number;
  approved_count: number;
  released_count: number;
  in_progress_count: number;
  completed_count: number;
  cancelled_count: number;
  pending_approval_count: number;
  active_count: number;
  overdue_plan_count: number;
  active_remaining_qty: string;
  ready_operation_count: number;
  planner_digest: ProductionPlannerDigest;
}

export interface ProductionBulkUpdateOperationResult {
  order_id: number;
  order_code: string;
  operation: ProductionOperation;
  scenario?: {
    suggestion_key: string;
    suggestion_kind: string;
    suggestion_title: string;
    severity: string;
  };
}

export interface ProductionBulkUpdateResponse {
  updated_count: number;
  order_ids: number[];
  operations: ProductionBulkUpdateOperationResult[];
}

export interface ProductionMaterialRequirement {
  id?: number;
  line_number?: number;
  material_product: number;
  material_product_code?: string | null;
  material_product_name?: string | null;
  internal_product_code?: string;
  product_snapshot?: Record<string, unknown>;
  required_qty: string;
  issued_qty?: string;
  remaining_issue_qty?: string;
  source_warehouse?: number | null;
  source_warehouse_name?: string | null;
  source_location?: number | null;
  source_location_name?: string | null;
  note?: string;
}

export interface ProductionOrder {
  id: number;
  code: string;
  doc_type: string;
  order_date: string;
  planned_start_date?: string | null;
  planned_end_date?: string | null;
  status: ProductionOrderStatus;
  reference?: string;
  sales_order?: number | null;
  sales_order_code?: string | null;
  sales_order_line?: number | null;
  sales_order_line_number?: number | null;
  production_demand?: number | null;
  production_demand_code?: string | null;
  production_demand_display_code?: string | null;
  production_demand_key?: string | null;
  production_demand_qty_required?: string | null;
  production_demand_qty_planned?: string | null;
  production_demand_qty_released?: string | null;
  production_demand_qty_completed?: string | null;
  production_demand_qty_remaining_to_plan?: string | null;
  production_demand_qty_remaining_to_release?: string | null;
  production_demand_planning_status?: ProductionDemandPlanningStatus | null;
  production_demand_production_status?: ProductionDemandProductionStatus | null;
  product: number;
  product_code?: string | null;
  product_name?: string | null;
  trace_code?: string | null;
  qr_value?: string | null;
  product_snapshot?: Record<string, unknown>;
  planned_qty: string;
  produced_qty: string;
  remaining_qty?: string;
  scrap_qty: string;
  unit_cost_estimate: string;
  estimated_output_value: string;
  target_warehouse?: number | null;
  target_warehouse_name?: string | null;
  target_location?: number | null;
  target_location_name?: string | null;
  notes?: string;
  reject_reason?: string;
  cancel_reason?: string;
  version?: number;
  material_requirements: ProductionMaterialRequirement[];
  operations: ProductionOperation[];
  created_at: string;
  updated_at: string;
}

export interface ProductionIssueLine {
  id: number;
  line_number: number;
  material_requirement?: number | null;
  material_requirement_line_number?: number | null;
  material_product: number;
  material_product_code?: string | null;
  material_product_name?: string | null;
  product_snapshot?: Record<string, unknown>;
  warehouse?: number | null;
  warehouse_name?: string | null;
  location?: number | null;
  location_name?: string | null;
  quantity: string;
  unit_cost: string;
  line_total: string;
  note?: string;
  inventory_transaction?: number | null;
  inventory_transaction_code?: string | null;
}

export interface ProductionIssue {
  id: number;
  code: string;
  production_order: number;
  production_order_code?: string | null;
  issue_date: string;
  status: ProductionIssueStatus;
  reference?: string;
  total_qty: string;
  total_amount: string;
  note?: string;
  posted_at: string;
  posted_by?: number | null;
  cancelled_at?: string | null;
  cancelled_by?: number | null;
  cancel_reason?: string;
  created_at: string;
  updated_at: string;
  lines: ProductionIssueLine[];
}

export interface ProductionReceiptLine {
  id: number;
  line_number: number;
  product: number;
  product_code?: string | null;
  product_name?: string | null;
  trace_code?: string | null;
  qr_value?: string | null;
  bundle_count?: number | null;
  units_per_bundle?: string | null;
  pallet_count?: number | null;
  bundles_per_pallet?: string | null;
  packaging_summary?: string | null;
  product_snapshot?: Record<string, unknown>;
  quantity: string;
  unit_cost: string;
  line_total: string;
  note?: string;
  inventory_transaction?: number | null;
  inventory_transaction_code?: string | null;
}

export interface ProductionReceipt {
  id: number;
  code: string;
  production_order: number;
  production_order_code?: string | null;
  receipt_date: string;
  status: ProductionReceiptStatus;
  reference?: string;
  warehouse?: number | null;
  warehouse_name?: string | null;
  location?: number | null;
  location_name?: string | null;
  total_qty: string;
  total_amount: string;
  note?: string;
  posted_at: string;
  posted_by?: number | null;
  cancelled_at?: string | null;
  cancelled_by?: number | null;
  cancel_reason?: string;
  created_at: string;
  updated_at: string;
  lines: ProductionReceiptLine[];
}

export interface ProductionReceiptScanMatch {
  receipt_line_id: number;
  line_number: number;
  production_order_id?: number | null;
  production_order_code?: string | null;
  order_date?: string | null;
  receipt_date?: string | null;
  receipt_status?: ProductionReceiptStatus | string | null;
  product_id?: number | null;
  product_code?: string | null;
  product_name?: string | null;
  quantity: string;
  unit_cost?: string;
  line_total?: string;
  bundle_count?: number | null;
  units_per_bundle?: string | null;
  pallet_count?: number | null;
  bundles_per_pallet?: string | null;
  packaging_summary?: string | null;
  inventory_transaction_id?: number | null;
  inventory_transaction_code?: string | null;
  trace_code?: string | null;
  qr_value?: string | null;
}

export interface ProductionReceiptScanResponse {
  scan_status: string;
  match_mode?: string;
  receipt_id: number;
  receipt_code: string;
  match: ProductionReceiptScanMatch;
}

export interface ProductionOrderFormValues {
  order_date: string;
  planned_start_date?: string | null;
  planned_end_date?: string | null;
  reference?: string;
  sales_order?: number | null;
  sales_order_line?: number | null;
  product: number;
  planned_qty: number;
  unit_cost_estimate?: number;
  target_warehouse?: number | null;
  target_location?: number | null;
  notes?: string;
  version?: number;
  material_requirements?: Array<{
    line_number?: number;
    material_product: number;
    required_qty: number;
    source_warehouse?: number | null;
    source_location?: number | null;
    note?: string;
  }>;
}

export interface ProductionApprovalHistoryItem {
  action: string;
  action_label?: string;
  user?: string | null;
  comments?: string | null;
  created_at: string;
}

export interface ProductionWorkflowStateSummary {
  current: string;
  next_states: string[];
}
