import { expect, test, type Page, type Route } from '@playwright/test';

test.use({ channel: 'msedge', video: 'off' });

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
  planned_date: '2026-05-26',
  planned_shift: 'MORNING',
  planned_shift_label: 'Ca sang',
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
  remaining_issue_qty: '0.0000',
  remaining_issue_line_count: 0,
  created_at: '2026-05-26T00:00:00Z',
  updated_at: '2026-05-26T00:00:00Z',
};

function makeOperation(id: number, overrides: Record<string, unknown>) {
  const operation = {
    ...baseOperation,
    id,
    ...overrides,
  };
  return {
    ...operation,
    execution_handoff: {
      state: overrides.executionState || 'ready',
      state_label: overrides.executionStateLabel || 'San sang',
      status: operation.status,
      status_label: overrides.statusLabel || 'San sang',
      is_active_execution: ['READY', 'IN_PROGRESS'].includes(String(operation.status)),
      is_terminal: ['DONE', 'SKIPPED'].includes(String(operation.status)),
      is_blocked: Boolean(operation.block_reason_code),
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
      last_action: overrides.lastAction || 'UPDATE',
      last_action_label: overrides.lastActionLabel || 'Planner update',
      last_actor: overrides.lastActor || 'planner_a',
      last_at: overrides.lastAt || '2026-05-26T08:00:00Z',
      last_note: overrides.lastNote || 'Planner updated execution context',
      audit_available: true,
      advisory_only: true,
      workflow_blocking: false,
    },
  };
}

const operations = [
  makeOperation(9001, {
    status: 'IN_PROGRESS',
    executionState: 'handover',
    executionStateLabel: 'Da ban giao',
    handover_status: 'ACCEPTED',
    handover_status_label: 'Da tiep quan',
    handover_receiver: 'To In',
    handover_note: 'Line accepted handover',
    handover_at: '2026-05-26T08:15:00Z',
    lastAction: 'HANDOVER',
    lastActionLabel: 'Handover accepted',
    lastActor: 'operator_a',
    lastAt: '2026-05-26T08:15:00Z',
    lastNote: 'Line accepted handover',
  }),
  makeOperation(9002, {
    sequence: 20,
    step_code: 'BE',
    step_name: 'Be',
    status: 'PENDING',
    executionState: 'blocked',
    executionStateLabel: 'Dang nghen',
    block_reason_code: 'WAIT_PREVIOUS_STEP',
    block_reason_label: 'Cho cong doan truoc',
    block_reason_note: 'Can hoan tat cong doan In',
    dependency_state: 'WAIT_PREVIOUS_STEP',
    lastAction: 'UPDATE',
    lastActionLabel: 'Planner block update',
    lastActor: 'planner_a',
    lastAt: '2026-05-26T09:00:00Z',
    lastNote: 'Waiting previous operation',
  }),
  makeOperation(9003, {
    sequence: 30,
    step_code: 'XA',
    step_name: 'Xa',
    status: 'SKIPPED',
    executionState: 'skipped',
    executionStateLabel: 'Bo qua',
    skipped_at: '2026-05-26T10:00:00Z',
    skipped_by: 1,
    skipped_by_display: 'operator_b',
    skip_reason: 'Bo qua theo lenh san xuat',
    lastAction: 'SKIP_OPERATION',
    lastActionLabel: 'Skip operation',
    lastActor: 'operator_b',
    lastAt: '2026-05-26T10:00:00Z',
    lastNote: 'Bo qua theo lenh san xuat',
  }),
  makeOperation(9004, {
    sequence: 40,
    step_code: 'DAN',
    step_name: 'Dan',
    status: 'DONE',
    executionState: 'done',
    executionStateLabel: 'Hoan tat',
    completed_qty: '100.0000',
    finished_at: '2026-05-26T11:00:00Z',
    lastAction: 'UPDATE',
    lastActionLabel: 'Done update',
    lastActor: 'operator_c',
    lastAt: '2026-05-26T11:00:00Z',
    lastNote: 'Completed operation',
  }),
];

const order = {
  id: 501,
  code: 'MO-AUDIT-501',
  doc_type: 'PRODUCTION_ORDER',
  order_date: '2026-05-26',
  planned_start_date: '2026-05-26',
  planned_end_date: '2026-05-27',
  status: 'IN_PROGRESS',
  reference: '',
  sales_order: null,
  sales_order_code: null,
  sales_order_line: null,
  sales_order_line_number: null,
  production_demand: 301,
  production_demand_code: 'PD-AUDIT-301',
  production_demand_display_code: 'PD-AUDIT-301',
  production_demand_key: 'PD-AUDIT-301',
  production_demand_qty_required: '100.0000',
  production_demand_qty_planned: '100.0000',
  production_demand_qty_released: '100.0000',
  production_demand_qty_completed: '0.0000',
  production_demand_qty_remaining_to_plan: '0.0000',
  production_demand_qty_remaining_to_release: '0.0000',
  production_demand_planning_status: 'FULLY_PLANNED',
  production_demand_production_status: 'IN_PROGRESS',
  product: 101,
  product_code: 'FG-AUDIT',
  product_name: 'Thanh pham audit',
  trace_code: 'TRACE-AUDIT',
  qr_value: 'TRACE-AUDIT',
  product_snapshot: {},
  planned_qty: '100.0000',
  produced_qty: '20.0000',
  remaining_qty: '80.0000',
  scrap_qty: '0.0000',
  unit_cost_estimate: '0.0000',
  estimated_output_value: '0.0000',
  target_warehouse: null,
  target_warehouse_name: 'Kho TP',
  target_location: null,
  target_location_name: 'A-01',
  notes: 'Lenh audit UI',
  reject_reason: '',
  cancel_reason: '',
  version: 1,
  material_requirements: [],
  operations,
  created_at: '2026-05-26T00:00:00Z',
  updated_at: '2026-05-26T11:00:00Z',
};

const orderSummary = {
  total_orders: 1,
  draft_count: 0,
  submitted_count: 0,
  approved_count: 0,
  released_count: 0,
  in_progress_count: 1,
  completed_count: 0,
  cancelled_count: 0,
  pending_approval_count: 0,
  active_count: 1,
  overdue_plan_count: 0,
  active_remaining_qty: '80.0000',
  ready_operation_count: 1,
  planner_digest: {
    overdue_operations: 0,
    ready_to_run_count: 1,
    wait_material_count: 0,
    wait_previous_step_count: 1,
    machine_down_count: 0,
    over_capacity_count: 0,
    at_limit_count: 0,
    over_capacity_slot_count: 0,
    unscheduled_count: 0,
    blocked_count: 1,
    handover_ready_count: 0,
    handover_accepted_count: 1,
    unassigned_machine_count: 0,
    unassigned_work_center_count: 0,
    affected_sales_order_count: 1,
  },
};

async function setupMockApi(page: Page) {
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

    if (path === '/api/notifications/unread/' && method === 'GET') {
      return json(route, []);
    }

    if (path === '/api/production/orders/summary/' && method === 'GET') {
      return json(route, orderSummary);
    }

    if (path === '/api/production/orders/' && method === 'GET') {
      return json(route, { count: 1, next: null, previous: null, results: [order] });
    }

    if (path === `/api/production/orders/${order.id}/` && method === 'GET') {
      return json(route, order);
    }

    if (
      path === `/api/production/orders/${order.id}/issue_overview/`
      || path === `/api/production/orders/${order.id}/receipt_overview/`
    ) {
      return json(route, { count: 0, next: null, previous: null, results: [] });
    }

    if (path === `/api/production/orders/${order.id}/approval_history/`) {
      return json(route, []);
    }

    if (path === `/api/production/orders/${order.id}/next_states/`) {
      return json(route, { current: 'IN_PROGRESS', next_states: ['COMPLETED'] });
    }

    if (method === 'GET') {
      return json(route, { count: 0, next: null, previous: null, results: [] });
    }
    return json(route, {});
  });
}

test('production order list and detail show execution audit payload', async ({ page }) => {
  await setupMockApi(page);

  await page.goto('/production-orders');

  await expect(page.getByTestId('production-orders-command-strip')).toBeVisible();
  await expect(page.getByTestId(`production-order-list-execution-audit-${order.id}`)).toContainText('Active: 1');
  await expect(page.getByTestId(`production-order-list-execution-audit-${order.id}`)).toContainText('Block: 1');
  await expect(page.getByTestId(`production-order-list-execution-audit-${order.id}`)).toContainText('Skip: 1');
  await expect(page.getByTestId(`production-order-list-execution-audit-${order.id}`)).toContainText('Done: 1');
  await expect(page.getByTestId(`production-order-list-execution-audit-${order.id}`)).toContainText('Done update');
  await expect(page.getByTestId(`production-order-list-execution-audit-${order.id}`)).toContainText('operator_c');

  await page.getByTestId(`production-order-view-${order.id}`).click();

  await expect(page.getByTestId('production-order-execution-audit-panel')).toBeVisible();
  await expect(page.getByTestId('production-order-execution-audit-panel')).toContainText('không chặn workflow');
  await expect(page.getByTestId('production-order-execution-audit-table')).toBeVisible();
  await expect(page.getByTestId('production-order-execution-audit-9001')).toContainText('Handover accepted');
  await expect(page.getByTestId('production-order-execution-audit-9001')).toContainText('operator_a');
  await expect(page.getByTestId('production-order-execution-exception-9001')).toContainText('Handover: Da tiep quan');
  await expect(page.getByTestId('production-order-execution-exception-9002')).toContainText('Block: Cho cong doan truoc');
  await expect(page.getByTestId('production-order-execution-exception-9002')).toContainText('Can hoan tat cong doan In');
  await expect(page.getByTestId('production-order-execution-exception-9003')).toContainText('Skip: Bo qua theo lenh san xuat');
  await expect(page.getByTestId('production-order-execution-audit-9003')).toContainText('Skip operation');
  await expect(page.getByTestId('production-order-execution-audit-9004')).toContainText('Done update');
  await expect(page.getByTestId('production-order-execution-audit-9004')).toContainText('Advisory');
});
