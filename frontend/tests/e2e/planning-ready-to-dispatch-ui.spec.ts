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

const readyIssue = (status: DispatchStatus, code: string, category: string, message: string) => ({
  code,
  severity: status,
  category,
  message,
  workflow_blocking: false,
  details: {},
});

const baseOperation = {
  id: 0,
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
  planned_date: '2026-05-23',
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
  created_at: '2026-05-23T00:00:00Z',
  updated_at: '2026-05-23T00:00:00Z',
};

function makeCard(id: number, status: DispatchStatus, overrides: Record<string, unknown> = {}) {
  const issue = status === 'READY'
    ? null
    : status === 'WARNING'
      ? readyIssue('WARNING', 'MATERIAL_NOT_READY', 'material', 'Vat tu chua duoc cap day du.')
      : readyIssue('BLOCKER', 'WAIT_PREVIOUS_STEP', 'dependency', 'Cong doan dang cho cong doan truoc hoan tat.');
  const operation = {
    ...baseOperation,
    id,
    step_code: id === 3 ? 'BE' : 'IN',
    step_name: id === 3 ? 'Be' : 'In',
    status: status === 'BLOCKER' ? 'PENDING' : 'READY',
    dependency_state: status === 'BLOCKER' ? 'WAIT_PREVIOUS_STEP' : 'CLEAR',
    previous_step_code: status === 'BLOCKER' ? 'IN' : null,
    previous_step_name: status === 'BLOCKER' ? 'In' : null,
    planned_date: status === 'WARNING' ? null : '2026-05-23',
    planned_shift: status === 'WARNING' ? '' : 'FULLDAY',
    planned_shift_label: status === 'WARNING' ? '' : 'Ca ngay',
    ...(overrides.operation as Record<string, unknown> | undefined),
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
    card_key: `card-${id}`,
    bucket: { key: status === 'WARNING' ? 'UNSCHEDULED' : 'TODAY', label: status === 'WARNING' ? 'Chua xep' : 'Hom nay', sort_order: 1, date: '2026-05-23' },
    order: {
      id,
      code: status === 'READY' ? 'MO-READY' : status === 'WARNING' ? 'MO-WARN' : 'MO-BLOCK',
      status: 'RELEASED',
      product_id: 100 + id,
      product_code: `P-${id}`,
      product_name: `San pham ${id}`,
      planned_qty: '100',
      produced_qty: '0',
      remaining_qty: '100',
      planned_start_date: '2026-05-23',
      planned_end_date: '2026-05-24',
      reference: '',
    },
    operation,
    sales: {
      sales_order_id: id,
      sales_order_code: `SO-${id}`,
      sales_order_line_id: id,
      sales_order_line_number: 1,
      customer_code: `C-${id}`,
      customer_name: `Khach ${id}`,
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
      product_id: 100 + id,
      product_code: `P-${id}`,
      product_name: `San pham ${id}`,
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

const cards = [
  makeCard(1, 'READY'),
  makeCard(2, 'WARNING'),
  makeCard(3, 'BLOCKER'),
];

const summary = {
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
  affected_sales_order_count: 3,
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
  summary,
  scope_summary: summary,
  lanes: [
    {
      key: 'IN',
      step_code: 'IN',
      step_name: 'In',
      sequence: 1,
      total_cards: cards.length,
      bucket_count: 2,
      shift_loads: [],
      buckets: [
        { key: 'TODAY', label: 'Hom nay', sort_order: 1, count: 2, cards: [cards[0], cards[2]] },
        { key: 'UNSCHEDULED', label: 'Chua xep', sort_order: 5, count: 1, cards: [cards[1]] },
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

    if (path === '/api/production/orders/planning_board/' && method === 'GET') {
      return json(route, planningBoard);
    }

    if (path === '/api/production/orders/capacity_options/' && method === 'GET') {
      return json(route, {
        work_centers: [{ id: 1, code: 'WC-IN', name: 'To In', default_capacity_hours: '8.00', description: '', sort_order: 1, is_active: true, created_at: '2026-05-23T00:00:00Z', updated_at: '2026-05-23T00:00:00Z' }],
        machines: [{ id: 1, code: 'M-IN-01', name: 'May In 01', work_center: 1, work_center_code: 'WC-IN', work_center_name: 'To In', default_capacity_hours: '8.00', description: '', sort_order: 1, is_active: true, created_at: '2026-05-23T00:00:00Z', updated_at: '2026-05-23T00:00:00Z' }],
      });
    }

    if (method === 'GET') {
      return json(route, { count: 0, next: null, previous: null, results: [] });
    }
    return json(route, {});
  });
}

test('planning board shows ready-to-dispatch badges, panel, and quick filter', async ({ page }) => {
  await setupMockApi(page);

  await page.goto('/production-planning');

  await expect(page.getByTestId('production-planning-ready-to-dispatch-panel')).toBeVisible();
  await expect(page.getByTestId('production-planning-ready-to-dispatch-ready').first()).toBeVisible();
  await expect(page.getByTestId('production-planning-ready-to-dispatch-warning').first()).toBeVisible();
  await expect(page.getByTestId('production-planning-ready-to-dispatch-blocker').first()).toBeVisible();
  await expect(page.getByTestId('production-planning-ready-to-dispatch-action-plan')).toContainText('Kiểm tra vật tư/tồn nguồn');
  await expect(page.getByTestId('production-planning-ready-to-dispatch-action-plan')).toContainText('Chờ bàn giao công đoạn trước');

  await page.getByTestId('production-planning-quick-dispatch-warning').click();
  await expect(page).toHaveURL(/ready_to_dispatch=WARNING/);
  await expect(page.getByText('MO-WARN')).toBeVisible();
  await expect(page.getByText('MO-READY')).toHaveCount(0);
  await expect(page.getByText('MO-BLOCK')).toHaveCount(0);
  await expect(page.getByTestId('production-planning-card-dispatch-summary').first()).toContainText('Đối chiếu cấp vật tư');

  await page.getByRole('button', { name: 'Chi tiết' }).click();
  await expect(page.getByTestId('production-planning-ready-to-dispatch-detail')).toBeVisible();
  await expect(page.getByTestId('production-planning-ready-to-dispatch-detail')).toContainText('WARNING');
  await expect(page.getByTestId('production-planning-ready-to-dispatch-actions')).toContainText('Kiểm tra vật tư/tồn nguồn');
});
