import { expect, test, type Page, type Route } from '@playwright/test';

test.use({ channel: 'msedge', video: 'off' });

type DispatchStatus = 'READY' | 'WARNING' | 'BLOCKER';

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

const unit = { id: 1, code: 'CAI', name: 'Cai', is_active: true };
const warehouse = { id: 1, code: 'WH-UAT', name: 'Kho UAT' };

const productReadinessItem = {
  id: 501,
  code: 'P-UAT-READINESS',
  name: 'San pham UAT readiness',
  category: null,
  category_name: '',
  unit: unit.id,
  unit_name: unit.name,
  description: '',
  product_kind: 'SPECIFIC',
  requires_order_spec: false,
  requires_order_operations_review: false,
  size_order: '',
  size_production: '',
  cost_price: '0',
  sale_price: '0',
  min_stock: '0',
  delivery_tolerance: '',
  commission_per_unit: '',
  commission_percent: '',
  process_xa: null,
  process_in: null,
  process_boi: null,
  process_can_mang: null,
  process_be: null,
  process_chap: null,
  process_dong: null,
  process_dan: null,
  process_khac: null,
  operations: [],
  routing_steps: [],
  film_code: '',
  color_count: 0,
  print_color_1: '',
  print_color_2: '',
  print_color_3: '',
  print_color_4: '',
  print_color_5: '',
  mold_code: '',
  waterproof: '',
  note_other: '',
  note: '',
  parent: null,
  components: [],
  bundle_definition: null,
  status: 'ACTIVE',
  is_active: true,
  created_at: '2026-05-24T00:00:00Z',
  updated_at: '2026-05-24T00:00:00Z',
};

const snapshotProduct = {
  ...productReadinessItem,
  id: 701,
  code: 'P-UAT-SNAPSHOT',
  name: 'San pham UAT snapshot',
  product_kind: 'GENERIC',
  requires_order_spec: true,
  requires_order_operations_review: true,
  process_in: 20000,
  sale_price: '40000',
};

const auditProduct = {
  ...productReadinessItem,
  id: 801,
  code: 'P-UAT-AUDIT',
  name: 'San pham UAT audit',
};

const products = [productReadinessItem, snapshotProduct, auditProduct];

const productReadiness = {
  product_id: productReadinessItem.id,
  product_code: productReadinessItem.code,
  product_name: productReadinessItem.name,
  status: 'BLOCKER',
  is_ready: false,
  workflow_blocking: false,
  summary: {
    blocker_count: 1,
    warning_count: 2,
    issue_count: 3,
    operation_count: 0,
    routing_step_count: 0,
    active_work_center_count: 0,
    active_machine_count: 0,
    print_color_count: 0,
  },
  issues: [
    {
      code: 'ROUTING_MISSING',
      severity: 'BLOCKER',
      category: 'routing',
      message: 'San pham chua co routing/cong doan hieu luc.',
      workflow_blocking: false,
      details: {},
    },
    {
      code: 'MACHINE_CATALOG_MISSING',
      severity: 'WARNING',
      category: 'resource',
      message: 'Chua co machine dang hoat dong cho lap ke hoach.',
      workflow_blocking: false,
      details: {},
    },
    {
      code: 'PRINT_COLORS_MISSING',
      severity: 'WARNING',
      category: 'print_metadata',
      message: 'San pham co cong doan in nhung chua co thong tin mau in.',
      workflow_blocking: false,
      details: {},
    },
  ],
  rules: { workflow_enforced: false },
};

const salesOrder = {
  id: 9001,
  code: 'SO-UAT-001',
  doc_type: 'SO',
  order_date: '2026-05-24',
  delivery_date: '2026-05-30',
  status: 'DRAFT',
  reference: '',
  customer: null,
  customer_name: '',
  currency: 'VND',
  exchange_rate: '1.000000',
  subtotal: '400000.00',
  discount_total: '0.00',
  tax_total: '0.00',
  total: '400000.00',
  notes: '',
  version: 0,
  created_at: '2026-05-24T00:00:00Z',
  updated_at: '2026-05-24T00:00:00Z',
  lines: [
    {
      id: 9101,
      line_number: 1,
      product: snapshotProduct.id,
      internal_product_code: snapshotProduct.code,
      product_code: snapshotProduct.code,
      product_name: snapshotProduct.name,
      product_name_snapshot: snapshotProduct.name,
      trace_code: 'P-UAT-SNAPSHOT|20260524|SO-UAT-001|L001',
      uom: 'CAI',
      qty: '10.0000',
      unit_price: '40000.00',
      discount_pct: '0.00',
      tax_pct: '0.00',
      line_subtotal: '400000.00',
      discount_amount: '0.00',
      tax_amount: '0.00',
      line_total: '400000.00',
      remaining_reservation_qty: '10.0000',
      shipped_qty_total: '0.0000',
      delivered_qty_total: '0.0000',
      product_snapshot: {
        schema_version: 2,
        product_id: snapshotProduct.id,
        product_code: snapshotProduct.code,
        product_name: snapshotProduct.name,
        code: snapshotProduct.code,
        name: snapshotProduct.name,
        product_kind: 'GENERIC',
        requires_order_spec: true,
        requires_order_operations_review: true,
        order_spec_confirmed: false,
        order_operations_reviewed: false,
        unit_name: unit.name,
        size_order: '',
        size_production: '',
        process_in: 20000,
        film_code: '',
        color_count: 0,
        print_colors: [],
        operations: [],
        routing_steps: [],
      },
      delivery_plans: [
        {
          id: 9201,
          delivery_date: '2026-05-30',
          qty: '10.0000',
          shipped_qty: '0.0000',
          delivered_qty: '0.0000',
          remaining_qty: '10.0000',
          planned_carrier: null,
          planned_carrier_name: '',
          delivery_rule: 'PARTIAL_ALLOWED',
          note: '',
        },
      ],
    },
  ],
};

const baseOperation = {
  id: 7001,
  sequence: 10,
  step_code: 'IN',
  step_name: 'In',
  source_field: 'routing_steps',
  route_step_no: 1,
  display_step: 1,
  display_order: 1,
  step_type: 'REQUIRED',
  group_code: '',
  is_required: true,
  allow_parallel: false,
  source_operation_code: 'IN',
  rate_per_hour: '100',
  planned_qty: '100',
  completed_qty: '0',
  scrap_qty: '0',
  planned_date: '2026-05-24',
  planned_shift: 'FULLDAY',
  planned_shift_label: 'Ca ngay',
  priority_rank: 10,
  dispatch_sequence: 100,
  work_center_code: 'WC-IN',
  work_center_name: 'To In',
  machine_code: 'M-IN-01',
  machine_name: 'May In 01',
  estimated_runtime_hours: '1.00',
  setup_minutes: 0,
  block_reason_code: '',
  block_reason_label: '',
  block_reason_note: '',
  dispatch_owner: 'Planner',
  handover_status: '',
  handover_status_label: '',
  handover_receiver: '',
  handover_note: '',
  handover_at: null,
  status: 'READY',
  started_at: null,
  finished_at: null,
  skipped_at: null,
  skipped_by: null,
  skipped_by_display: '',
  skip_reason: '',
  note: '',
  material_readiness: 'READY',
  dependency_state: 'CLEAR',
  risk_state: 'ON_TRACK',
  previous_step_code: null,
  previous_step_name: null,
  next_step_code: null,
  next_step_name: null,
  remaining_issue_qty: '0',
  remaining_issue_line_count: 0,
  created_at: '2026-05-24T00:00:00Z',
  updated_at: '2026-05-24T00:00:00Z',
};

const productionOrder = {
  id: 8001,
  code: 'MO-UAT-001',
  doc_type: 'MO',
  order_date: '2026-05-24',
  planned_start_date: '2026-05-24',
  planned_end_date: '2026-05-26',
  status: 'RELEASED',
  reference: 'SO-UAT-001',
  sales_order: salesOrder.id,
  sales_order_code: salesOrder.code,
  sales_order_line: 9101,
  sales_order_line_number: 1,
  production_demand: 6001,
  production_demand_code: 'DEMAND-UAT-001',
  production_demand_display_code: 'DEMAND-UAT-001',
  production_demand_key: 'SO-UAT-001-L001-20260530',
  production_demand_qty_required: '100',
  production_demand_qty_planned: '100',
  production_demand_qty_released: '100',
  production_demand_qty_completed: '0',
  production_demand_qty_remaining_to_plan: '0',
  production_demand_qty_remaining_to_release: '0',
  production_demand_planning_status: 'FULLY_PLANNED',
  production_demand_production_status: 'FULLY_RELEASED',
  product: snapshotProduct.id,
  product_code: snapshotProduct.code,
  product_name: snapshotProduct.name,
  trace_code: 'P-UAT-SNAPSHOT|20260524|SO-UAT-001|L001',
  qr_value: 'MO-UAT-001',
  product_snapshot: salesOrder.lines[0].product_snapshot,
  planned_qty: '100',
  produced_qty: '0',
  remaining_qty: '100',
  scrap_qty: '0',
  unit_cost_estimate: '0',
  estimated_output_value: '0',
  target_warehouse: warehouse.id,
  target_warehouse_name: warehouse.name,
  target_location: null,
  target_location_name: null,
  notes: 'Created from SalesOrder snapshot v2',
  reject_reason: '',
  cancel_reason: '',
  version: 0,
  material_requirements: [
    {
      id: 1,
      line_number: 1,
      material_product: auditProduct.id,
      material_product_code: auditProduct.code,
      material_product_name: auditProduct.name,
      required_qty: '12',
      issued_qty: '0',
      remaining_issue_qty: '12',
      source_warehouse: warehouse.id,
      source_warehouse_name: warehouse.name,
      source_location: null,
      source_location_name: null,
      note: '',
    },
  ],
  operations: [baseOperation],
  created_at: '2026-05-24T00:00:00Z',
  updated_at: '2026-05-24T00:00:00Z',
};

const productionDemand = {
  id: 6001,
  demand_code: 'DEMAND-UAT-001',
  demand_key: 'SO-UAT-001-L001-20260530',
  sales_order: salesOrder.id,
  sales_order_code: salesOrder.code,
  sales_order_line: 9101,
  sales_order_line_number: 1,
  delivery_plan: 9201,
  delivery_plan_date: '2026-05-30',
  delivery_plan_display: '2026-05-30 / 10',
  product: snapshotProduct.id,
  product_display_code: snapshotProduct.code,
  product_display_name: snapshotProduct.name,
  customer_id_snapshot: null,
  customer_name_snapshot: '',
  customer_display: 'Khach UAT',
  product_code: snapshotProduct.code,
  product_name: snapshotProduct.name,
  product_kind: 'GENERIC',
  unit_name: unit.name,
  size_order: '',
  size_production: '',
  print_colors: [],
  operations_summary: [],
  routing_summary: [],
  qty_required: '100',
  qty_planned: '100',
  qty_released: '100',
  qty_completed: '0',
  qty_remaining_to_plan: '0',
  qty_remaining_to_release: '0',
  qty_remaining_to_complete: '100',
  planning_bucket: 'not_due',
  is_held: false,
  order_date: '2026-05-24',
  delivery_date: '2026-05-30',
  production_due_date: '2026-05-28',
  planning_due_date: '2026-05-25',
  reminder_date: null,
  planning_status: 'FULLY_PLANNED',
  production_status: 'FULLY_RELEASED',
  priority: 'HIGH',
  assigned_planner: null,
  assigned_planner_name: '',
  notes: 'Handoff from SalesOrder snapshot v2',
  reminder_note: '',
  hold_reason: '',
  source: 'SALES_ORDER',
  created_by: 1,
  updated_by: 1,
  created_at: '2026-05-24T00:00:00Z',
  updated_at: '2026-05-24T00:00:00Z',
  production_orders: [{
    id: productionOrder.id,
    code: productionOrder.code,
    status: productionOrder.status,
    planned_qty: productionOrder.planned_qty,
    produced_qty: productionOrder.produced_qty,
    scrap_qty: productionOrder.scrap_qty,
    planned_start_date: productionOrder.planned_start_date,
    planned_end_date: productionOrder.planned_end_date,
    released_at: '2026-05-24T08:00:00Z',
    completed_at: null,
    operation_count: productionOrder.operations.length,
  }],
};

function readyIssue(status: DispatchStatus, code: string, category: string, message: string) {
  return { code, severity: status, category, message, workflow_blocking: false, details: {} };
}

function makePlanningCard(id: number, status: DispatchStatus) {
  const issue = status === 'READY'
    ? null
    : status === 'WARNING'
      ? readyIssue('WARNING', 'MATERIAL_NOT_READY', 'material', 'Vat tu chua duoc cap day du.')
      : readyIssue('BLOCKER', 'WAIT_PREVIOUS_STEP', 'dependency', 'Cong doan dang cho cong doan truoc hoan tat.');
  const operation = {
    ...baseOperation,
    id,
    status: status === 'BLOCKER' ? 'PENDING' : 'READY',
    dependency_state: status === 'BLOCKER' ? 'WAIT_PREVIOUS_STEP' : 'CLEAR',
    previous_step_code: status === 'BLOCKER' ? 'IN' : null,
    previous_step_name: status === 'BLOCKER' ? 'In' : null,
    planned_date: status === 'WARNING' ? null : '2026-05-24',
    planned_shift: status === 'WARNING' ? '' : 'FULLDAY',
    planned_shift_label: status === 'WARNING' ? '' : 'Ca ngay',
  };
  const materials = {
    material_readiness: status === 'WARNING' ? 'WAITING' : 'READY',
    material_readiness_label: status === 'WARNING' ? 'Cho vat tu' : 'San chay',
    remaining_issue_qty: status === 'WARNING' ? '12' : '0',
    remaining_issue_line_count: status === 'WARNING' ? 1 : 0,
    issue_count: 0,
    receipt_count: 0,
    ready_to_run: status === 'READY',
    source_availability_issues: status === 'WARNING' && issue ? [issue] : [],
  };
  return {
    card_key: `uat-card-${id}`,
    bucket: { key: status === 'WARNING' ? 'UNSCHEDULED' : 'TODAY', label: status === 'WARNING' ? 'Chua xep' : 'Hom nay', sort_order: 1, date: '2026-05-24' },
    order: {
      id,
      code: status === 'READY' ? 'MO-UAT-READY' : status === 'WARNING' ? 'MO-UAT-WARN' : 'MO-UAT-BLOCK',
      status: 'RELEASED',
      product_id: snapshotProduct.id,
      product_code: snapshotProduct.code,
      product_name: snapshotProduct.name,
      planned_qty: '100',
      produced_qty: '0',
      remaining_qty: '100',
      planned_start_date: '2026-05-24',
      planned_end_date: '2026-05-26',
      reference: salesOrder.code,
    },
    operation,
    sales: {
      sales_order_id: salesOrder.id,
      sales_order_code: salesOrder.code,
      sales_order_line_id: 9101,
      sales_order_line_number: 1,
      customer_code: 'C-UAT',
      customer_name: 'Khach UAT',
      delivery_due_date: '2026-05-30',
    },
    materials,
    exceptions: {
      risk_state: status === 'BLOCKER' ? 'BLOCKED' : status === 'WARNING' ? 'UNSCHEDULED' : 'ON_TRACK',
      risk_state_label: status === 'BLOCKER' ? 'Dang nghen' : status === 'WARNING' ? 'Chua xep' : 'Dung ke hoach',
      dependency_state: status === 'BLOCKER' ? 'WAIT_PREVIOUS_STEP' : 'CLEAR',
      dependency_state_label: status === 'BLOCKER' ? 'Cho cong doan truoc' : 'Khong bi chan',
      block_reason_code: '',
      block_reason_label: '',
      block_reason_note: '',
      overdue_days: 0,
      days_to_delivery: 7,
      delivery_gap_days: 5,
      is_overdue: false,
      is_unscheduled: status === 'WARNING',
      needs_attention: status !== 'READY',
    },
    shop_floor: {
      dispatch_owner: 'Planner',
      handover_status: '',
      handover_status_label: '',
      handover_receiver: '',
      handover_note: '',
      handover_at: null,
    },
    capacity: {
      work_center_code: status === 'WARNING' ? '' : 'WC-IN',
      work_center_name: status === 'WARNING' ? '' : 'To In',
      machine_code: status === 'WARNING' ? '' : 'M-IN-01',
      machine_name: status === 'WARNING' ? '' : 'May In 01',
      shift_key: status === 'WARNING' ? 'UNASSIGNED' : 'FULLDAY',
      shift_label: status === 'WARNING' ? 'Chua xep ca' : 'Ca ngay',
      runtime_hours: '1.00',
      setup_hours: '0.00',
      scheduled_hours: '1.00',
      active_scheduled_hours: '1.00',
      shift_capacity_hours: '8.00',
      work_center_capacity_hours: '8.00',
      machine_capacity_hours: '8.00',
      work_center_load_hours: '1.00',
      machine_load_hours: '1.00',
      work_center_load_ratio: '0.125',
      machine_load_ratio: '0.125',
      work_center_catalog_matched: status !== 'WARNING',
      machine_catalog_matched: status !== 'WARNING',
      capacity_state: status === 'WARNING' ? 'UNASSIGNED_MACHINE' : 'BALANCED',
      capacity_state_label: status === 'WARNING' ? 'Chua gan may' : 'Tai on dinh',
      over_capacity: false,
      unassigned_machine: status === 'WARNING',
      unassigned_work_center: false,
    },
    actions: {
      production_order_url: `/production-orders/${id}`,
      sales_fulfillment_url: '/shipments',
      material_issue_url: '/production-issues',
      production_receipt_url: '/production-receipts',
      scan_center_url: '/shipments/scan',
    },
    product_readiness: {
      product_id: snapshotProduct.id,
      product_code: snapshotProduct.code,
      product_name: snapshotProduct.name,
      status: status === 'BLOCKER' ? 'BLOCKER' : status,
      is_ready: status === 'READY',
      workflow_blocking: false,
      summary: { blocker_count: status === 'BLOCKER' ? 1 : 0, warning_count: status === 'WARNING' ? 1 : 0, issue_count: status === 'READY' ? 0 : 1 },
      issues: issue ? [issue] : [],
      rules: { workflow_enforced: false },
    },
    ready_to_dispatch: {
      status,
      is_ready: status === 'READY',
      workflow_blocking: false,
      summary: {
        blocker_count: status === 'BLOCKER' ? 1 : 0,
        warning_count: status === 'WARNING' ? 1 : 0,
        issue_count: status === 'READY' ? 0 : 1,
        product_readiness_status: status === 'BLOCKER' ? 'BLOCKER' : 'READY',
        material_readiness: materials.material_readiness,
        dependency_state: operation.dependency_state,
        capacity_state: status === 'WARNING' ? 'UNASSIGNED_MACHINE' : 'BALANCED',
      },
      issues: issue ? [issue] : [],
      rules: { advisory_only: true, workflow_enforced: false },
    },
  };
}

const planningCards = [
  makePlanningCard(8101, 'READY'),
  makePlanningCard(8102, 'WARNING'),
  makePlanningCard(8103, 'BLOCKER'),
];

const planningSummary = {
  total_orders: 3,
  total_operations: 3,
  overdue_operations: 0,
  ready_to_run_count: 1,
  ready_to_dispatch_count: 1,
  dispatch_warning_count: 1,
  dispatch_blocker_count: 1,
  wait_material_count: 1,
  wait_previous_step_count: 1,
  machine_down_count: 0,
  over_capacity_count: 0,
  at_limit_count: 0,
  unassigned_machine_count: 1,
  unassigned_work_center_count: 0,
  unscheduled_count: 1,
  blocked_count: 1,
  in_progress_count: 0,
  handover_ready_count: 0,
  handover_accepted_count: 0,
  affected_sales_order_count: 1,
  avg_days_to_deadline: 7,
  bucket_counts: { OVERDUE: 0, TODAY: 2, TOMORROW: 0, UPCOMING: 0, UNSCHEDULED: 1 },
  risk_counts: { DONE: 0, UNSCHEDULED: 1, OVERDUE: 0, BLOCKED: 1, AT_RISK: 0, ON_TRACK: 1 },
  capacity_state_counts: { BALANCED: 2, AT_LIMIT: 0, OVER_CAPACITY: 0, UNASSIGNED_MACHINE: 1, UNASSIGNED_WORK_CENTER: 0 },
  dispatch_status_counts: { READY: 1, WARNING: 1, BLOCKER: 1 },
  total_runtime_hours: '3.00',
  total_setup_hours: '0.00',
  total_scheduled_hours: '3.00',
  over_capacity_slot_count: 0,
  shift_loads: [],
};

const planningBoard = {
  summary: planningSummary,
  scope_summary: planningSummary,
  lanes: [
    {
      key: 'IN',
      step_code: 'IN',
      step_name: 'In',
      sequence: 1,
      total_cards: planningCards.length,
      bucket_count: 2,
      shift_loads: [],
      buckets: [
        { key: 'TODAY', label: 'Hom nay', sort_order: 1, count: 2, cards: [planningCards[0], planningCards[2]] },
        { key: 'UNSCHEDULED', label: 'Chua xep', sort_order: 5, count: 1, cards: [planningCards[1]] },
      ],
    },
  ],
  watchlist: [],
  exception_groups: [],
  dispatch_groups: [],
  work_center_groups: [],
  machine_queues: [],
  capacity_calendar: [],
  rebalance_suggestions: [],
  dispatch_owner_groups: [],
  sales_watch: [],
  material_watch: [],
  work_center_watch: [],
  machine_watch: [],
  delivery_watch: [],
  unscheduled_watch: [],
  shift_watch: [],
  date_watch: [],
  dispatch_owner_capacity_watch: [],
  step_watch: [],
  rebalance_summary: [],
};

const inventoryTransactions = [
  {
    id: 101,
    code: 'INVTX-UAT-STOCKTAKE',
    transaction_type: 'ADJUSTMENT_IN',
    status: 'POSTED',
    transaction_date: '2026-05-24',
    reference: 'STKT-UAT-001',
    reason: 'Kiem ton',
    note: '',
    product: auditProduct.id,
    product_code: auditProduct.code,
    product_name: auditProduct.name,
    warehouse: warehouse.id,
    warehouse_name: warehouse.name,
    location: null,
    location_name: null,
    target_warehouse: null,
    target_warehouse_name: null,
    target_location: null,
    target_location_name: null,
    quantity: '4',
    unit_cost: '0',
    amount: '0.00',
    stocktake: 501,
    stocktake_code: 'STKT-UAT-001',
    stocktake_line: 502,
    stocktake_line_number: 1,
    source_type: 'STOCKTAKE',
    source_label: 'Kiem ton',
    source_code: 'STKT-UAT-001',
    source_document_type: 'STOCKTAKE',
    source_warnings: [],
    source_audit: {
      type: 'STOCKTAKE',
      label: 'Kiem ton',
      document_type: 'STOCKTAKE',
      code: 'STKT-UAT-001',
      reference: 'STKT-UAT-001',
      warning_flags: [],
      related: { stocktake_id: 501, stocktake_code: 'STKT-UAT-001' },
    },
    posted_at: '2026-05-24T08:00:00Z',
    posted_by: 1,
    cancelled_at: null,
    cancelled_by: null,
    cancel_reason: '',
    created_at: '2026-05-24T08:00:00Z',
    updated_at: '2026-05-24T08:00:00Z',
  },
  {
    id: 102,
    code: 'INVTX-UAT-PURCHASE',
    transaction_type: 'RECEIPT',
    status: 'POSTED',
    transaction_date: '2026-05-24',
    reference: 'GRN-UAT-001',
    reason: 'Nhap mua hang',
    note: '',
    product: auditProduct.id,
    product_code: auditProduct.code,
    product_name: auditProduct.name,
    warehouse: warehouse.id,
    warehouse_name: warehouse.name,
    location: null,
    location_name: null,
    target_warehouse: null,
    target_warehouse_name: null,
    target_location: null,
    target_location_name: null,
    quantity: '5',
    unit_cost: '0',
    amount: '0.00',
    purchase_order: 201,
    purchase_order_code: 'PO-UAT-001',
    purchase_order_line: null,
    purchase_receipt: 202,
    purchase_receipt_code: 'GRN-UAT-001',
    source_type: 'PURCHASE',
    source_label: 'Mua hang',
    source_code: 'GRN-UAT-001',
    source_document_type: 'PURCHASE_RECEIPT',
    source_warnings: [],
    source_audit: {
      type: 'PURCHASE',
      label: 'Mua hang',
      document_type: 'PURCHASE_RECEIPT',
      code: 'GRN-UAT-001',
      reference: 'GRN-UAT-001',
      warning_flags: [],
      related: { purchase_order_id: 201, purchase_order_code: 'PO-UAT-001', purchase_receipt_id: 202, purchase_receipt_code: 'GRN-UAT-001' },
    },
    posted_at: '2026-05-24T08:00:00Z',
    posted_by: 1,
    cancelled_at: null,
    cancelled_by: null,
    cancel_reason: '',
    created_at: '2026-05-24T08:00:00Z',
    updated_at: '2026-05-24T08:00:00Z',
  },
  {
    id: 103,
    code: 'INVTX-UAT-PRODUCTION',
    transaction_type: 'ISSUE',
    status: 'POSTED',
    transaction_date: '2026-05-24',
    reference: 'PMI-UAT-001',
    reason: 'Cap vat tu san xuat',
    note: '',
    product: auditProduct.id,
    product_code: auditProduct.code,
    product_name: auditProduct.name,
    warehouse: warehouse.id,
    warehouse_name: warehouse.name,
    location: null,
    location_name: null,
    target_warehouse: null,
    target_warehouse_name: null,
    target_location: null,
    target_location_name: null,
    quantity: '2',
    unit_cost: '0',
    amount: '0.00',
    production_order: productionOrder.id,
    production_order_code: productionOrder.code,
    production_issue: 302,
    production_issue_code: 'PMI-UAT-001',
    production_receipt: null,
    production_receipt_code: null,
    source_type: 'PRODUCTION',
    source_label: 'San xuat',
    source_code: 'PMI-UAT-001',
    source_document_type: 'PRODUCTION_ISSUE',
    source_warnings: ['PRODUCTION_REFERENCE_ONLY'],
    source_audit: {
      type: 'PRODUCTION',
      label: 'San xuat',
      document_type: 'PRODUCTION_ISSUE',
      code: 'PMI-UAT-001',
      reference: 'PMI-UAT-001',
      warning_flags: ['PRODUCTION_REFERENCE_ONLY'],
      related: { production_order_id: productionOrder.id, production_order_code: productionOrder.code, production_issue_id: 302, production_issue_code: 'PMI-UAT-001' },
    },
    posted_at: '2026-05-24T08:00:00Z',
    posted_by: 1,
    cancelled_at: null,
    cancelled_by: null,
    cancel_reason: '',
    created_at: '2026-05-24T08:00:00Z',
    updated_at: '2026-05-24T08:00:00Z',
  },
];

const observabilityWorkspace = {
  capabilities: {
    can_view_operations_log: true,
    can_view_workflow: true,
    can_manage_workflow: true,
    can_simulate_scheduler_failure: true,
    can_manage_user_directory: true,
    can_view_rbac_audit: true,
    can_manage_module_permissions: true,
  },
  health: {
    status: 'healthy',
    app_env: 'uat-mock',
    server_time: '2026-05-24T09:00:00Z',
    checks: {
      database: { status: 'ok', message: 'Database OK' },
      migrations: { status: 'ok', message: 'No pending migrations' },
      queue: { status: 'ok', queued_items: 0 },
      data: { status: 'ok' },
    },
  },
  monitoring: {
    backup: {
      status: 'ok',
      message: 'Backup verified',
      backup_count: 1,
      latest_backup: {
        path: 'D:/ERP-Carton-2D-snapshot-db-backups/20260524_220757',
        name: '20260524_220757',
        age_hours: 1.25,
        has_database_dump: true,
        has_media: false,
        has_manifest: true,
        has_backup_manifest: true,
        restore_drill_status: 'ok',
      },
      restore_drill_status: 'ok',
    },
    email_delivery: {
      hours_window: 24,
      status_counts: { SUCCESS: 1, FAILED: 0, PENDING: 0 },
      failure_rate_pct: 0,
      latest_failure: null,
      status: 'ok',
    },
    alert_channels: {
      app_env: 'uat-mock',
      channels: [{ key: 'email', label: 'Email', configured: true, summary: 'filebased/local' }],
      configured_count: 1,
      required_channel_count: 1,
      required_channels: ['email'],
      missing_required_channels: [],
      default_from_email_configured: true,
      server_email_configured: true,
      incident_runbook_configured: true,
      incident_contact_count: 1,
      recommended_command: 'python manage.py alert_channel_readiness',
      warning_count: 0,
      warnings: [],
      status: 'ok',
    },
    alert_readiness: {
      generated_at: '2026-05-24T09:00:00Z',
      config: {
        channels: [{ key: 'email', label: 'Email', configured: true, summary: 'filebased/local' }],
        configured_count: 1,
        required_channel_count: 1,
        required_channels: ['email'],
        missing_required_channels: [],
        warning_count: 0,
        warnings: [],
        status: 'ok',
      },
      delivery: { status: 'ok', warnings: [], status_counts: { SUCCESS: 1, FAILED: 0, PENDING: 0 } },
      email_delivery: { status: 'ok', status_counts: { SUCCESS: 1, FAILED: 0, PENDING: 0 }, failure_rate_pct: 0 },
      incident_response: { runbook_url: 'local-runbook', contacts: ['ops@example.local'] },
      recommended_commands: [],
      warnings: [],
      overall_status: 'ok',
    },
    alert_delivery: {
      hours_window: 24,
      configured_count: 1,
      configured_channels: ['email'],
      status_counts: { SUCCESS: 1, FAILED: 0, PENDING: 0 },
      warning_count: 0,
      warnings: [],
      status: 'ok',
    },
    alert_drill: {
      recommended_command: 'python manage.py send_test_alert --channels email --json --require-success',
    },
    database: { slow_query_threshold_ms: 500 },
    performance: {
      slow_query_threshold_ms: 500,
      datasets: [],
      summary: { tracked_dataset_count: 0, warning_count: 0, critical_count: 0 },
      recommended_commands: [],
      warnings: [],
      status: 'ok',
    },
    release_hygiene: {
      branch: 'feature/sales-snapshot-v2',
      commit_sha: '305da2c',
      latest_tag: 'checkpoint-9f-planning-dispatch-scenario-hardening-v1',
      counts: { modified: 0, added: 0, deleted: 0, renamed: 0, conflicts: 0, untracked: 0 },
      total_changes: 0,
      open_changes: [],
      migration_candidates: [],
      artifact_candidates: [],
      recommended_commands: [],
      warnings: [],
      status: 'ok',
    },
    go_live_handoff: { recommended_command: 'python manage.py go_live_handoff --json' },
    incident_response: { runbook_url: 'local-runbook', contacts: ['ops@example.local'] },
  },
  workflow: {
    job_status: { enabled: true, interval_minutes: 5, lock_active: false, last_run_at: '2026-05-24T08:55:00Z', next_run_at: '2026-05-24T09:00:00Z' },
    health: { status_counts: { FAILED: 0, SKIPPED_LOCKED: 0 }, auto_disabled: false, consecutive_failures: 0 },
    incidents: { items: [], total: 0 },
  },
  access_exception: {
    summary: { requests_pending: 0, requests_overdue: 0, sla_requests_overdue: 0, guided_remediation_critical: 0, continuity_departments_overdue: 0, sla_escalations_due: 0, high_risk_requests: 0 },
    scheduler_status: null,
    automation_policy: null,
    recent_activity: [],
  },
  access_review: { recent_activity: [] },
  provisioning: { recent_activity: [] },
  offboarding: { recent_activity: [] },
  governance: {
    recent_activity: [],
    rbac_history_meta: { users: [], changed_types: [], anomalies_24h_count: 0 },
  },
  business_flows: {
    finance: null,
    workforce: null,
    purchasing: null,
    production: null,
  },
  approval_audit: {
    domains: [],
    recent_activity: [],
    hot_items: [],
    queue_rows: [],
    queue_summary: { total_pending: 0, high_priority: 0, overdue: 0 },
    timeline_7d: [],
  },
  audit_spotlight: {
    hours_window: 24,
    total_events: 0,
    sensitive_events: 0,
    high_severity_events: 0,
    domains: [],
    top_actors: [],
    hot_entities: [],
    timeline_7d: [],
    recent_activity: [],
    retention_policy: {
      retention_days: 365,
      total_events: 0,
      expired_events: 0,
      oldest_event_at: null,
      purge_recommended: false,
      last_run: null,
      recommended_command: '',
    },
    export_options: { formats: ['json'], max_rows: 1000 },
    incident_response: { runbook_url: 'local-runbook', contacts: ['ops@example.local'], bundle_command: '' },
    generated_at: '2026-05-24T09:00:00Z',
  },
  generated_at: '2026-05-24T09:00:00Z',
};

const emptyPage = { count: 0, next: null, previous: null, results: [] };

async function setupMockApi(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access_token', 'mock-access-token');
    window.localStorage.setItem(
      'user',
      JSON.stringify({ id: 1, username: 'uat_admin', is_staff: true, is_superuser: true, roles: [] }),
    );
  });

  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/users/me/') {
      return json(route, {
        id: 1,
        username: 'uat_admin',
        is_staff: true,
        is_superuser: true,
        is_active: true,
        is_locked: false,
        roles: [],
      });
    }

    if (path.startsWith('/api/preferences/')) {
      if (method === 'GET') return json(route, { config: {} });
      return json(route, { config: request.postDataJSON()?.config ?? {} });
    }

    if (path === '/api/notifications/unread/' && method === 'GET') return json(route, []);

    if (path === '/api/products/products/' && method === 'GET') return json(route, { count: products.length, next: null, previous: null, results: products });
    if (path === `/api/products/products/${productReadinessItem.id}/` && method === 'GET') return json(route, productReadinessItem);
    if (path === `/api/products/products/${productReadinessItem.id}/readiness/` && method === 'GET') return json(route, productReadiness);
    if (path === '/api/products/units/' && method === 'GET') return json(route, { count: 1, next: null, previous: null, results: [unit] });

    if (path === '/api/sales/orders/summary/' && method === 'GET') {
      return json(route, {
        total_orders: 1,
        draft_count: 1,
        submitted_count: 0,
        approved_count: 0,
        posted_count: 0,
        void_count: 0,
        pending_approval_count: 0,
        overdue_delivery_count: 0,
        due_today_count: 0,
        due_soon_count: 0,
        posted_total: '0.00',
      });
    }
    if (path === '/api/sales/orders/' && method === 'GET') return json(route, { count: 1, next: null, previous: null, results: [salesOrder] });
    if (path === `/api/sales/orders/${salesOrder.id}/` && method === 'GET') return json(route, salesOrder);
    if (path === '/api/customers/' && method === 'GET') return json(route, emptyPage);

    if (path === '/api/production/demands/summary/' && method === 'GET') {
      return json(route, {
        total: 1,
        held: 0,
        cancelled: 0,
        no_date: 0,
        overdue: 0,
        due_today: 0,
        upcoming_7_days: 1,
        not_due: 1,
        partially_planned: 0,
        fully_planned: 1,
        no_production_needed: 0,
        not_released: 0,
        in_progress: 0,
        completed: 0,
      });
    }
    if (path === '/api/production/demands/' && method === 'GET') return json(route, { count: 1, next: null, previous: null, results: [productionDemand] });
    if (path === `/api/production/demands/${productionDemand.id}/` && method === 'GET') return json(route, productionDemand);

    if (path === '/api/production/orders/summary/' && method === 'GET') {
      return json(route, {
        total_orders: 1,
        draft_count: 0,
        submitted_count: 0,
        approved_count: 0,
        released_count: 1,
        in_progress_count: 0,
        completed_count: 0,
        cancelled_count: 0,
        pending_approval_count: 0,
        active_count: 1,
        overdue_plan_count: 0,
        active_remaining_qty: '100',
        ready_operation_count: 1,
        planner_digest: { blocked_count: 0, warning_count: 0, ready_count: 1 },
      });
    }
    if (path === '/api/production/orders/planning_board/' && method === 'GET') return json(route, planningBoard);
    if (path === '/api/production/orders/capacity_options/' && method === 'GET') {
      return json(route, {
        work_centers: [{ id: 1, code: 'WC-IN', name: 'To In', default_capacity_hours: '8.00', description: '', sort_order: 1, is_active: true, created_at: '2026-05-24T00:00:00Z', updated_at: '2026-05-24T00:00:00Z' }],
        machines: [{ id: 1, code: 'M-IN-01', name: 'May In 01', work_center: 1, work_center_code: 'WC-IN', work_center_name: 'To In', default_capacity_hours: '8.00', description: '', sort_order: 1, is_active: true, created_at: '2026-05-24T00:00:00Z', updated_at: '2026-05-24T00:00:00Z' }],
      });
    }
    if (path === '/api/production/orders/' && method === 'GET') return json(route, { count: 1, next: null, previous: null, results: [productionOrder] });
    if (path === `/api/production/orders/${productionOrder.id}/` && method === 'GET') return json(route, productionOrder);
    if (path === `/api/production/orders/${productionOrder.id}/approval_history/` && method === 'GET') return json(route, []);
    if (path === `/api/production/orders/${productionOrder.id}/next_states/` && method === 'GET') return json(route, { next_states: [] });
    if (path.startsWith(`/api/production/orders/${productionOrder.id}/`) && method === 'GET') return json(route, emptyPage);

    if (path === '/api/inventory/warehouses/' && method === 'GET') return json(route, { count: 1, next: null, previous: null, results: [warehouse] });
    if (path === '/api/inventory/locations/' && method === 'GET') return json(route, emptyPage);
    if (path === '/api/inventory/transactions/nxt_report/' && method === 'GET') {
      return json(route, {
        date_from: url.searchParams.get('date_from') ?? '2026-05-01',
        date_to: url.searchParams.get('date_to') ?? '2026-05-31',
        results: [
          {
            product_id: auditProduct.id,
            product_code: auditProduct.code,
            product_name: auditProduct.name,
            warehouse_id: warehouse.id,
            warehouse_code: warehouse.code,
            warehouse_name: warehouse.name,
            opening_qty: '10',
            in_qty: '9',
            out_qty: '2',
            closing_qty: '17',
          },
        ],
      });
    }
    if (path === '/api/inventory/transactions/' && method === 'GET') {
      return json(route, { count: inventoryTransactions.length, next: null, previous: null, results: inventoryTransactions });
    }

    if (path === '/api/users/admin_observability_workspace/' && method === 'GET') return json(route, observabilityWorkspace);

    if (method === 'GET') return json(route, emptyPage);
    return json(route, {});
  });
}

test('ERP main UAT mock pack covers readiness, handoff, planning, inventory, and ops signals', async ({ page }) => {
  await setupMockApi(page);

  await page.goto('/products');
  await expect(page.getByText(productReadinessItem.code, { exact: true }).first()).toBeVisible();
  await page.getByText(productReadinessItem.code, { exact: true }).first().click();
  await expect(page.getByTestId('product-readiness-panel')).toBeVisible();
  await expect(page.getByTestId('product-readiness-status')).toContainText('BLOCKER');
  await expect(page.getByTestId('product-readiness-blocker-count')).toContainText('1 BLOCKER');
  await expect(page.getByTestId('product-readiness-warning-count')).toContainText('2 WARNING');

  await page.goto('/sales-orders');
  await expect(page.getByText(salesOrder.code)).toBeVisible();
  await page.getByTestId(`sales-order-edit-${salesOrder.id}`).click();
  await expect(page.getByTestId('sales-snapshot-readiness-panel')).toBeVisible();
  await expect(page.getByTestId('sales-snapshot-readiness-status')).toContainText('WARNING');
  await expect(page.getByText(snapshotProduct.code)).toBeVisible();

  await page.goto('/production-demands');
  await expect(page.getByText(productionDemand.demand_code)).toBeVisible();
  await page.getByText(productionDemand.demand_code).click();
  await expect(page.getByText(productionOrder.code)).toBeVisible();
  await expect(page.getByText(salesOrder.code).first()).toBeVisible();

  await page.goto('/production-orders');
  await expect(page.getByTestId('production-orders-command-strip')).toBeVisible();
  await expect(page.getByText(productionOrder.code)).toBeVisible();
  await page.getByTestId(`production-order-view-${productionOrder.id}`).click();
  await expect(page.getByTestId('production-order-detail-panel')).toBeVisible();
  await expect(page.getByTestId('production-order-detail-panel')).toContainText(productionDemand.demand_code);
  await expect(page.getByTestId('production-order-detail-panel')).toContainText(snapshotProduct.code);

  await page.goto('/production-planning');
  await expect(page.getByTestId('production-planning-ready-to-dispatch-panel')).toBeVisible();
  await expect(page.getByTestId('production-planning-ready-to-dispatch-ready').first()).toBeVisible();
  await expect(page.getByTestId('production-planning-ready-to-dispatch-warning').first()).toBeVisible();
  await expect(page.getByTestId('production-planning-ready-to-dispatch-blocker').first()).toBeVisible();
  await page.getByTestId('production-planning-quick-dispatch-warning').click();
  await expect(page).toHaveURL(/ready_to_dispatch=WARNING/);
  await expect(page.getByText('MO-UAT-WARN')).toBeVisible();

  await page.goto('/inventory-transactions');
  await expect(page.getByTestId('inventory-transactions-command-strip')).toBeVisible();
  await expect(page.getByTestId('inventory-nxt-panel')).toBeVisible();
  await expect(page.getByTestId('inventory-source-audit-102')).toBeVisible();
  await expect(page.getByTestId('inventory-source-audit-103')).toBeVisible();
  await expect(page.getByTestId('inventory-nxt-table')).toContainText(auditProduct.code);

  await page.goto('/admin/observability');
  await expect(page.getByTestId('admin-observability-run-alert-drill')).toBeVisible();
  await expect(page.getByTestId('admin-observability-export-handoff')).toBeVisible();
  await expect(page.getByText('Alert delivery: ok')).toBeVisible();
  await expect(page.getByText('Dirty files: 0')).toBeVisible();
});
