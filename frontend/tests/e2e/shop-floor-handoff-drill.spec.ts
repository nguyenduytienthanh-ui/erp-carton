import { expect, test, type Page, type Route } from '@playwright/test';

test.use({ channel: 'msedge', video: 'off' });

type JsonRecord = Record<string, unknown>;
type OperationItem = { order_id: number; operation_id: number };
type RequestRecord = { endpoint: string; payload: JsonRecord };
type DrillStatus = 'READY' | 'WARNING' | 'BLOCKER';
type SignalPayload = JsonRecord & {
  items: OperationItem[];
  signal_code: string;
  note?: string;
  dispatch_owner?: string;
  handover_status?: string;
};
type HandoverPayload = JsonRecord & {
  items: OperationItem[];
  set_ready?: boolean;
  clear_previous_wait?: boolean;
  handover_status: string;
  handover_receiver?: string;
  handover_note?: string;
};
type SkipPayload = JsonRecord & {
  operation_id: number;
  reason: string;
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

const baseOperation = {
  id: 0,
  sequence: 10,
  step_code: 'IN',
  step_name: 'In',
  source_field: 'routing_steps',
  route_step_no: 1,
  display_step: 1,
  display_order: 10,
  step_type: 'REQUIRED',
  group_code: 'PRINT',
  is_required: true,
  allow_parallel: false,
  source_operation_code: 'IN',
  rate_per_hour: '100.00',
  planned_qty: '100.0000',
  completed_qty: '0.0000',
  scrap_qty: '0.0000',
  planned_date: '2026-05-28',
  planned_shift: 'MORNING',
  planned_shift_label: 'Morning',
  priority_rank: 10,
  dispatch_sequence: 100,
  work_center_code: 'WC-IN',
  work_center_name: 'Print team',
  machine_code: 'M-IN-01',
  machine_name: 'Printer 01',
  estimated_runtime_hours: '1.00',
  setup_minutes: 0,
  block_reason_code: '',
  block_reason_label: '',
  block_reason_note: '',
  dispatch_owner: 'Planner A',
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
  remaining_issue_qty: '0.0000',
  remaining_issue_line_count: 0,
  created_at: '2026-05-28T00:00:00Z',
  updated_at: '2026-05-28T00:00:00Z',
};

function optionalText(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function makeExecutionHandoff(operation: JsonRecord, overrides: JsonRecord = {}) {
  const blocked = Boolean(operation.block_reason_code);
  const terminal = ['DONE', 'SKIPPED'].includes(String(operation.status));
  const state = optionalText(
    overrides.state,
    operation.status === 'SKIPPED' ? 'skipped'
      : operation.status === 'DONE' ? 'done'
        : blocked ? 'blocked'
          : operation.handover_status ? 'handover'
            : String(operation.status).toLowerCase().replace('_', '-'),
  );
  return {
    state,
    state_label: optionalText(overrides.state_label, state),
    status: operation.status,
    status_label: optionalText(overrides.status_label, String(operation.status)),
    is_active_execution: ['READY', 'IN_PROGRESS'].includes(String(operation.status)) || state === 'handover',
    is_terminal: terminal,
    is_blocked: blocked,
    block_reason_code: operation.block_reason_code,
    block_reason_label: operation.block_reason_label,
    block_reason_note: operation.block_reason_note,
    dispatch_owner: operation.dispatch_owner,
    handover_status: operation.handover_status,
    handover_status_label: operation.handover_status_label,
    handover_receiver: operation.handover_receiver,
    handover_note: operation.handover_note,
    handover_at: operation.handover_at,
    skip_reason: operation.skip_reason,
    skipped_at: operation.skipped_at,
    skipped_by: operation.skipped_by,
    skipped_by_display: operation.skipped_by_display,
    last_action: optionalText(overrides.last_action, 'UPDATE'),
    last_action_label: optionalText(overrides.last_action_label, 'Planner update'),
    last_actor: optionalText(overrides.last_actor, 'planner_a'),
    last_at: optionalText(overrides.last_at, '2026-05-28T08:00:00Z'),
    last_note: optionalText(overrides.last_note, 'Planner updated execution context'),
    audit_available: true,
    advisory_only: true,
    workflow_blocking: false,
  };
}

function makeCard(
  id: number,
  drillStatus: DrillStatus,
  overrides: { operation?: JsonRecord; audit?: JsonRecord } = {},
) {
  const operation: JsonRecord = {
    ...baseOperation,
    id,
    sequence: id * 10,
    step_code: id === 3 ? 'BE' : 'IN',
    step_name: id === 3 ? 'Be' : 'In',
    status: drillStatus === 'BLOCKER' ? 'PENDING' : 'READY',
    dependency_state: drillStatus === 'BLOCKER' ? 'WAIT_PREVIOUS_STEP' : 'CLEAR',
    previous_step_code: drillStatus === 'BLOCKER' ? 'IN' : null,
    previous_step_name: drillStatus === 'BLOCKER' ? 'In' : null,
    block_reason_code: drillStatus === 'WARNING' ? 'WAIT_MATERIAL' : drillStatus === 'BLOCKER' ? 'WAIT_PREVIOUS_STEP' : '',
    block_reason_label: drillStatus === 'WARNING' ? 'Waiting material' : drillStatus === 'BLOCKER' ? 'Waiting previous step' : '',
    block_reason_note: drillStatus === 'WARNING' ? 'Need paper before running' : drillStatus === 'BLOCKER' ? 'Need previous operation first' : '',
    material_readiness: drillStatus === 'WARNING' ? 'WAITING' : 'READY',
    risk_state: drillStatus === 'BLOCKER' ? 'BLOCKED' : drillStatus === 'WARNING' ? 'AT_RISK' : 'ON_TRACK',
    remaining_issue_qty: drillStatus === 'WARNING' ? '12.0000' : '0.0000',
    remaining_issue_line_count: drillStatus === 'WARNING' ? 1 : 0,
    ...(overrides.operation ?? {}),
  };
  operation.execution_handoff = makeExecutionHandoff(operation, overrides.audit ?? {});
  return {
    card_key: `card-${id}`,
    bucket: { key: 'TODAY', label: 'Today', sort_order: 1, date: '2026-05-28' },
    order: {
      id: 500,
      code: 'MO-SHOP-FLOOR-500',
      status: 'IN_PROGRESS',
      product_id: 100,
      product_code: 'FG-SHOP',
      product_name: 'Shop-floor product',
      planned_qty: '100.0000',
      produced_qty: '0.0000',
      remaining_qty: '100.0000',
      planned_start_date: '2026-05-28',
      planned_end_date: '2026-05-29',
      reference: 'Shop-floor drill',
    },
    operation,
    sales: {
      sales_order_id: 700,
      sales_order_code: 'SO-SHOP-700',
      sales_order_line_id: 701,
      sales_order_line_number: 1,
      customer_code: 'C-SHOP',
      customer_name: 'Shop customer',
      delivery_due_date: '2026-05-30',
    },
    materials: {
      material_readiness: operation.material_readiness,
      material_readiness_label: drillStatus === 'WARNING' ? 'Waiting material' : 'Ready to run',
      remaining_issue_qty: operation.remaining_issue_qty,
      remaining_issue_line_count: operation.remaining_issue_line_count,
      issue_count: 0,
      receipt_count: 0,
      ready_to_run: drillStatus === 'READY',
      source_availability_issues: [],
    },
    exceptions: {
      risk_state: operation.risk_state,
      risk_state_label: drillStatus === 'BLOCKER' ? 'Blocked' : drillStatus === 'WARNING' ? 'Warning' : 'On track',
      dependency_state: operation.dependency_state,
      dependency_state_label: drillStatus === 'BLOCKER' ? 'Waiting previous step' : 'Clear',
      block_reason_code: operation.block_reason_code,
      block_reason_label: operation.block_reason_label,
      block_reason_note: operation.block_reason_note,
      overdue_days: 0,
      days_to_delivery: 2,
      delivery_gap_days: 1,
      is_overdue: false,
      is_unscheduled: false,
      needs_attention: drillStatus !== 'READY',
    },
    shop_floor: {
      dispatch_owner: operation.dispatch_owner,
      handover_status: operation.handover_status,
      handover_status_label: operation.handover_status_label,
      handover_receiver: operation.handover_receiver,
      handover_note: operation.handover_note,
      handover_at: operation.handover_at,
      last_action: operation.execution_handoff.last_action,
      last_action_label: operation.execution_handoff.last_action_label,
      last_actor: operation.execution_handoff.last_actor,
      last_at: operation.execution_handoff.last_at,
      last_note: operation.execution_handoff.last_note,
      audit_available: true,
    },
    execution_handoff: operation.execution_handoff,
    capacity: {
      work_center_code: 'WC-IN',
      work_center_name: 'Print team',
      machine_code: 'M-IN-01',
      machine_name: 'Printer 01',
      shift_key: 'MORNING',
      shift_label: 'Morning',
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
      work_center_catalog_matched: true,
      machine_catalog_matched: true,
      capacity_state: 'BALANCED',
      capacity_state_label: 'Balanced',
      over_capacity: false,
      unassigned_machine: false,
      unassigned_work_center: false,
    },
    actions: {
      production_order_url: '/production-orders?focus_id=500',
      sales_fulfillment_url: '/shipments',
      material_issue_url: '/production-issues',
      production_receipt_url: '/production-receipts',
      scan_center_url: '/shipments/scan',
    },
    product_readiness: {
      product_id: 100,
      product_code: 'FG-SHOP',
      product_name: 'Shop-floor product',
      status: drillStatus,
      is_ready: drillStatus === 'READY',
      workflow_blocking: false,
      summary: { blocker_count: drillStatus === 'BLOCKER' ? 1 : 0, warning_count: drillStatus === 'WARNING' ? 1 : 0, issue_count: drillStatus === 'READY' ? 0 : 1 },
      issues: [],
      rules: { workflow_enforced: false },
    },
    ready_to_dispatch: {
      status: drillStatus,
      is_ready: drillStatus === 'READY',
      workflow_blocking: false,
      summary: {
        blocker_count: drillStatus === 'BLOCKER' ? 1 : 0,
        warning_count: drillStatus === 'WARNING' ? 1 : 0,
        issue_count: drillStatus === 'READY' ? 0 : 1,
        product_readiness_status: drillStatus,
        material_readiness: operation.material_readiness,
        dependency_state: operation.dependency_state,
        capacity_state: 'BALANCED',
      },
      issues: [],
      rules: { advisory_only: true, workflow_enforced: false },
    },
  };
}

type MockCard = ReturnType<typeof makeCard>;

function refreshCard(card: MockCard, auditOverrides: JsonRecord = {}) {
  card.operation.execution_handoff = makeExecutionHandoff(card.operation, auditOverrides);
  card.execution_handoff = card.operation.execution_handoff;
  card.shop_floor = {
    ...card.shop_floor,
    dispatch_owner: card.operation.dispatch_owner,
    handover_status: card.operation.handover_status,
    handover_status_label: card.operation.handover_status_label,
    handover_receiver: card.operation.handover_receiver,
    handover_note: card.operation.handover_note,
    handover_at: card.operation.handover_at,
    last_action: card.operation.execution_handoff.last_action,
    last_action_label: card.operation.execution_handoff.last_action_label,
    last_actor: card.operation.execution_handoff.last_actor,
    last_at: card.operation.execution_handoff.last_at,
    last_note: card.operation.execution_handoff.last_note,
    audit_available: true,
  };
  card.exceptions = {
    ...card.exceptions,
    block_reason_code: card.operation.block_reason_code,
    block_reason_label: card.operation.block_reason_label,
    block_reason_note: card.operation.block_reason_note,
    risk_state: card.operation.block_reason_code ? 'BLOCKED' : card.operation.status === 'DONE' ? 'DONE' : 'ON_TRACK',
    risk_state_label: card.operation.block_reason_code ? 'Blocked' : card.operation.status === 'DONE' ? 'Done' : 'On track',
    needs_attention: Boolean(card.operation.block_reason_code),
  };
  card.materials = {
    ...card.materials,
    material_readiness: card.operation.block_reason_code === 'WAIT_MATERIAL' ? 'WAITING' : 'READY',
    material_readiness_label: card.operation.block_reason_code === 'WAIT_MATERIAL' ? 'Waiting material' : 'Ready to run',
    ready_to_run: !card.operation.block_reason_code && ['READY', 'IN_PROGRESS'].includes(String(card.operation.status)),
  };
}

const readyCard = makeCard(1, 'READY');
const warningCard = makeCard(2, 'WARNING');
const blockerCard = makeCard(3, 'BLOCKER');
const handoverCard = makeCard(4, 'READY');
const doneCard = makeCard(5, 'READY', {
  operation: {
    status: 'DONE',
    completed_qty: '100.0000',
    note: 'Completed shop-floor drill quantity',
    finished_at: '2026-05-28T11:00:00Z',
  },
  audit: {
    state: 'done',
    last_action: 'UPDATE',
    last_action_label: 'Done update',
    last_actor: 'operator_done',
    last_note: 'Completed shop-floor drill quantity',
  },
});

const cards = [readyCard, warningCard, blockerCard, handoverCard];

function makePlanningBoard() {
  const summary = {
    total_orders: 1,
    total_operations: cards.length,
    overdue_operations: 0,
    ready_to_run_count: cards.filter((card) => card.materials.ready_to_run).length,
    ready_to_dispatch_count: cards.filter((card) => card.ready_to_dispatch.status === 'READY').length,
    dispatch_warning_count: cards.filter((card) => card.ready_to_dispatch.status === 'WARNING').length,
    dispatch_blocker_count: cards.filter((card) => card.ready_to_dispatch.status === 'BLOCKER').length,
    wait_material_count: cards.filter((card) => card.operation.block_reason_code === 'WAIT_MATERIAL').length,
    wait_previous_step_count: cards.filter((card) => card.operation.dependency_state === 'WAIT_PREVIOUS_STEP').length,
    machine_down_count: cards.filter((card) => card.operation.block_reason_code === 'MACHINE_DOWN').length,
    over_capacity_count: 0,
    at_limit_count: 0,
    unassigned_machine_count: 0,
    unassigned_work_center_count: 0,
    unscheduled_count: 0,
    blocked_count: cards.filter((card) => card.operation.block_reason_code).length,
    in_progress_count: cards.filter((card) => card.operation.status === 'IN_PROGRESS').length,
    handover_ready_count: cards.filter((card) => card.operation.handover_status === 'READY').length,
    handover_accepted_count: cards.filter((card) => card.operation.handover_status === 'ACCEPTED').length,
    affected_sales_order_count: 1,
    avg_days_to_deadline: 2,
    bucket_counts: { OVERDUE: 0, TODAY: cards.length, TOMORROW: 0, UPCOMING: 0, UNSCHEDULED: 0 },
    risk_counts: { DONE: 0, UNSCHEDULED: 0, OVERDUE: 0, BLOCKED: 1, AT_RISK: 1, ON_TRACK: 2 },
    capacity_state_counts: { BALANCED: cards.length, AT_LIMIT: 0, OVER_CAPACITY: 0, UNASSIGNED_MACHINE: 0, UNASSIGNED_WORK_CENTER: 0 },
    dispatch_status_counts: { READY: 2, WARNING: 1, BLOCKER: 1 },
    total_runtime_hours: '4.00',
    total_setup_hours: '0.00',
    total_scheduled_hours: '4.00',
    over_capacity_slot_count: 0,
    shift_loads: [],
  };
  return {
    summary,
    scope_summary: summary,
    lanes: [{
      key: 'IN',
      step_code: 'IN',
      step_name: 'In',
      sequence: 1,
      total_cards: cards.length,
      bucket_count: 1,
      shift_loads: [],
      buckets: [{ key: 'TODAY', label: 'Today', sort_order: 1, count: cards.length, cards }],
    }],
    watchlist: cards,
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
}

function makeOrder() {
  const operations = [...cards.map((card) => card.operation), doneCard.operation];
  return {
    id: 500,
    code: 'MO-SHOP-FLOOR-500',
    doc_type: 'PRODUCTION_ORDER',
    order_date: '2026-05-28',
    planned_start_date: '2026-05-28',
    planned_end_date: '2026-05-29',
    status: 'IN_PROGRESS',
    reference: 'Shop-floor drill',
    sales_order: null,
    sales_order_code: 'SO-SHOP-700',
    sales_order_line: null,
    sales_order_line_number: 1,
    production_demand: 300,
    production_demand_code: 'PD-SHOP-300',
    production_demand_display_code: 'PD-SHOP-300',
    production_demand_key: 'PD-SHOP-300',
    production_demand_qty_required: '100.0000',
    production_demand_qty_planned: '100.0000',
    production_demand_qty_released: '100.0000',
    production_demand_qty_completed: '0.0000',
    production_demand_qty_remaining_to_plan: '0.0000',
    production_demand_qty_remaining_to_release: '0.0000',
    production_demand_planning_status: 'FULLY_PLANNED',
    production_demand_production_status: 'IN_PROGRESS',
    product: 100,
    product_code: 'FG-SHOP',
    product_name: 'Shop-floor product',
    trace_code: 'TRACE-SHOP',
    qr_value: 'TRACE-SHOP',
    product_snapshot: {},
    planned_qty: '100.0000',
    produced_qty: '0.0000',
    remaining_qty: '100.0000',
    scrap_qty: '0.0000',
    unit_cost_estimate: '0.0000',
    estimated_output_value: '0.0000',
    target_warehouse: null,
    target_warehouse_name: 'Finished warehouse',
    target_location: null,
    target_location_name: 'A-01',
    notes: 'Shop-floor handoff drill order',
    reject_reason: '',
    cancel_reason: '',
    version: 1,
    material_requirements: [],
    operations,
    created_at: '2026-05-28T00:00:00Z',
    updated_at: '2026-05-28T11:00:00Z',
  };
}

function operationResponse(card: MockCard) {
  return {
    order_id: card.order.id,
    order_code: card.order.code,
    operation: card.operation,
  };
}

async function setupMockApi(page: Page, records: RequestRecord[]) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access_token', 'mock-access-token');
    window.localStorage.setItem(
      'user',
      JSON.stringify({ username: 'uat_admin', is_staff: true, is_superuser: true, roles: [] }),
    );
  });

  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/users/me/') {
      return json(route, { id: 1, username: 'uat_admin', is_staff: true, is_superuser: true, is_active: true, is_locked: false, roles: [] });
    }

    if (path.startsWith('/api/preferences/')) {
      if (method === 'GET') return json(route, { config: {} });
      return json(route, { config: request.postDataJSON()?.config ?? {} });
    }

    if (path === '/api/notifications/unread/' && method === 'GET') {
      return json(route, []);
    }

    if (path === '/api/production/orders/planning_board/' && method === 'GET') {
      return json(route, makePlanningBoard());
    }

    if (path === '/api/production/orders/capacity_options/' && method === 'GET') {
      return json(route, { work_centers: [], machines: [] });
    }

    if (path === '/api/production/orders/shop_floor_signal/' && method === 'POST') {
      const payload = request.postDataJSON() as SignalPayload;
      records.push({ endpoint: 'shop_floor_signal', payload });
      const updated = payload.items.map((item) => {
        const card = cards.find((row) => row.order.id === item.order_id && row.operation.id === item.operation_id);
        if (!card) return null;
        if (payload.signal_code === 'CLEAR_TO_RUN' || payload.signal_code === 'READY') {
          card.operation.status = 'READY';
          card.operation.block_reason_code = '';
          card.operation.block_reason_label = '';
          card.operation.block_reason_note = '';
        } else {
          card.operation.block_reason_code = payload.signal_code;
          card.operation.block_reason_label = payload.signal_code === 'MACHINE_DOWN' ? 'Machine down' : 'Waiting material';
          card.operation.block_reason_note = payload.note || '';
        }
        card.operation.dispatch_owner = payload.dispatch_owner || card.operation.dispatch_owner;
        card.operation.handover_status = payload.handover_status || card.operation.handover_status || 'ACTIVE';
        card.operation.handover_status_label = card.operation.handover_status === 'ACTIVE' ? 'Active' : card.operation.handover_status;
        card.operation.handover_note = payload.note || card.operation.handover_note;
        refreshCard(card, {
          state: card.operation.block_reason_code ? 'blocked' : 'ready',
          last_action: 'SIGNAL',
          last_action_label: 'Shop-floor signal',
          last_actor: 'operator_signal',
          last_note: payload.note || payload.signal_code,
        });
        return operationResponse(card);
      }).filter(Boolean);
      return json(route, { updated_count: updated.length, order_ids: [500], operations: updated });
    }

    if (path === '/api/production/orders/shop_floor_handover/' && method === 'POST') {
      const payload = request.postDataJSON() as HandoverPayload;
      records.push({ endpoint: 'shop_floor_handover', payload });
      const updated = payload.items.map((item) => {
        const card = cards.find((row) => row.order.id === item.order_id && row.operation.id === item.operation_id);
        if (!card) return null;
        if (payload.set_ready) card.operation.status = 'READY';
        if (payload.clear_previous_wait && card.operation.block_reason_code === 'WAIT_PREVIOUS_STEP') {
          card.operation.block_reason_code = '';
          card.operation.block_reason_label = '';
          card.operation.block_reason_note = '';
        }
        card.operation.handover_status = payload.handover_status;
        card.operation.handover_status_label = payload.handover_status === 'ACCEPTED' ? 'Accepted' : 'Ready handover';
        card.operation.handover_receiver = payload.handover_receiver || 'Scan center';
        card.operation.handover_note = payload.handover_note || '';
        card.operation.handover_at = '2026-05-28T09:30:00Z';
        refreshCard(card, {
          state: 'handover',
          last_action: 'HANDOVER',
          last_action_label: 'Handover accepted',
          last_actor: 'operator_handover',
          last_note: payload.handover_note || payload.handover_status,
        });
        return operationResponse(card);
      }).filter(Boolean);
      return json(route, { updated_count: updated.length, order_ids: [500], operations: updated });
    }

    if (path === '/api/production/orders/500/skip_operation/' && method === 'POST') {
      const payload = request.postDataJSON() as SkipPayload;
      records.push({ endpoint: 'skip_operation', payload });
      const card = cards.find((row) => row.operation.id === Number(payload.operation_id));
      if (card) {
        card.operation.status = 'SKIPPED';
        card.operation.skip_reason = payload.reason;
        card.operation.skipped_by = 1;
        card.operation.skipped_by_display = 'operator_skip';
        card.operation.skipped_at = '2026-05-28T10:00:00Z';
        refreshCard(card, {
          state: 'skipped',
          last_action: 'SKIP_OPERATION',
          last_action_label: 'Skip operation',
          last_actor: 'operator_skip',
          last_note: payload.reason,
        });
      }
      return json(route, { message: 'Skipped', order_status: 'IN_PROGRESS', operation: card?.operation });
    }

    if (path === '/api/production/orders/summary/' && method === 'GET') {
      return json(route, {
        total_orders: 1,
        active_count: 1,
        ready_operation_count: cards.filter((card) => card.materials.ready_to_run).length,
        planner_digest: {
          blocked_count: cards.filter((card) => card.operation.block_reason_code).length,
          handover_accepted_count: cards.filter((card) => card.operation.handover_status === 'ACCEPTED').length,
        },
      });
    }

    if (path === '/api/production/orders/' && method === 'GET') {
      return json(route, { count: 1, next: null, previous: null, results: [makeOrder()] });
    }

    if (path === '/api/production/orders/500/' && method === 'GET') {
      return json(route, makeOrder());
    }

    if (
      path === '/api/production/orders/500/issue_overview/'
      || path === '/api/production/orders/500/receipt_overview/'
    ) {
      return json(route, { count: 0, next: null, previous: null, results: [] });
    }

    if (path === '/api/production/orders/500/approval_history/') {
      return json(route, []);
    }

    if (path === '/api/production/orders/500/next_states/') {
      return json(route, { current: 'IN_PROGRESS', next_states: ['COMPLETED'] });
    }

    if (method === 'GET') {
      return json(route, { count: 0, next: null, previous: null, results: [] });
    }
    return json(route, {});
  });
}

test('shop-floor handoff drill covers PlanningBoard actions and ProductionOrder audit detail', async ({ page }) => {
  const records: RequestRecord[] = [];
  await setupMockApi(page, records);

  await page.goto('/production-planning');

  await expect(page.getByTestId('production-planning-ready-to-dispatch-panel')).toBeVisible();
  await expect(page.getByTestId('production-planning-ready-to-dispatch-ready').first()).toBeVisible();
  await expect(page.getByTestId('production-planning-ready-to-dispatch-warning').first()).toBeVisible();
  await expect(page.getByTestId('production-planning-ready-to-dispatch-blocker').first()).toBeVisible();

  await page.getByTestId('production-planning-select-visible').click();
  await expect(page.getByTestId('production-planning-signal-clear-to-run')).toBeDisabled();
  await expect(page.getByTestId('production-planning-handover-accepted')).toBeDisabled();
  await page.getByTestId('production-planning-clear-selection').click();

  await page.getByTestId('production-planning-select-card-1').click();
  await page.getByTestId('production-planning-signal-machine-down').click();
  await expect.poll(() => records.some((item) => item.payload.signal_code === 'MACHINE_DOWN')).toBeTruthy();

  await page.getByTestId('production-planning-clear-selection').click();
  await page.getByTestId('production-planning-select-card-2').click();
  await page.getByTestId('production-planning-signal-wait-material').click();
  await expect.poll(() => records.some((item) => item.payload.signal_code === 'WAIT_MATERIAL')).toBeTruthy();

  await page.getByTestId('production-planning-clear-selection').click();
  await page.getByTestId('production-planning-select-card-4').click();
  await page.getByTestId('production-planning-signal-clear-to-run').click();
  await page.getByTestId('production-planning-handover-ready').click();
  await page.getByTestId('production-planning-handover-accepted').click();
  await expect.poll(() => records.some((item) => item.endpoint === 'shop_floor_handover' && item.payload.handover_status === 'ACCEPTED')).toBeTruthy();

  await page.getByTestId('production-planning-open-card-3').click();
  await expect(page.getByTestId('production-planning-detail-drawer')).toBeVisible();
  await page.getByTestId('production-planning-skip-operation').click();
  await page.getByTestId('production-planning-skip-reason').fill('Skip for shop-floor drill with audit reason');
  await page.getByTestId('production-planning-skip-submit').click();
  await expect.poll(() => records.some((item) => item.endpoint === 'skip_operation')).toBeTruthy();

  await page.goto('/production-orders');
  await page.getByTestId('production-order-view-500').click();

  await expect(page.getByTestId('production-order-execution-audit-panel')).toBeVisible();
  await expect(page.getByTestId('production-order-execution-audit-panel')).toContainText('không chặn workflow');
  await expect(page.getByTestId('production-order-execution-audit-table')).toBeVisible();
  await expect(page.getByTestId('production-order-execution-audit-1')).toContainText('Shop-floor signal');
  await expect(page.getByTestId('production-order-execution-audit-1')).toContainText('operator_signal');
  await expect(page.getByTestId('production-order-execution-audit-2')).toContainText('Shop-floor signal');
  await expect(page.getByTestId('production-order-execution-audit-3')).toContainText('Skip operation');
  await expect(page.getByTestId('production-order-execution-exception-3')).toContainText('Skip for shop-floor drill');
  await expect(page.getByTestId('production-order-execution-audit-4')).toContainText('Handover accepted');
  await expect(page.getByTestId('production-order-execution-exception-4')).toContainText('Handover: Accepted');
  await expect(page.getByTestId('production-order-execution-audit-5')).toContainText('Done update');
  await expect(page.getByTestId('production-order-execution-audit-5')).toContainText('Advisory');
});
