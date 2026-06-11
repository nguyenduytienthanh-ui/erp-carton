import { expect, test, type Page, type Route } from '@playwright/test';

test.use({ channel: 'msedge', video: 'off' });

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

const paginated = <T>(results: T[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

const emptyPage = paginated([]);

const user = {
  id: 1,
  username: 'uat_admin',
  is_staff: true,
  is_superuser: true,
  is_active: true,
  is_locked: false,
  roles: [],
};

const purchaseRequest = {
  id: 1001,
  code: 'PR-OWNER-001',
  request_date: '2026-06-01',
  status: 'SUBMITTED',
  reference: 'OWNER-REQ',
  notes: 'Need approval before buying board stock.',
  lines: [],
  created_at: '2026-06-01T08:00:00Z',
  updated_at: '2026-06-01T09:00:00Z',
};

const purchaseOrder = {
  id: 2001,
  code: 'PO-OWNER-001',
  order_date: '2026-06-01',
  expected_date: '2026-06-08',
  status: 'APPROVED',
  supplier: 1,
  supplier_code: 'SUP-01',
  supplier_name: 'Owner Supplier',
  warehouse: 1,
  warehouse_name: 'Main Warehouse',
  location: 1,
  location_name: 'A-01',
  payment_terms_days: 30,
  subtotal: '1200000',
  tax_total: '0',
  total: '1200000',
  notes: '',
  lines: [
    {
      id: 2101,
      product: 301,
      product_code: 'MAT-BOARD',
      product_name: 'Board sheet',
      quantity: '20',
      ordered_qty: '20',
      received_qty: '8',
      remaining_qty: '12',
      unit_price: '60000',
      line_total: '1200000',
    },
  ],
  created_at: '2026-06-01T08:00:00Z',
  updated_at: '2026-06-02T08:00:00Z',
};

const receivable = {
  id: 3001,
  code: 'AR-OWNER-001',
  customer: 1,
  customer_name: 'Owner Customer',
  source_type: 'SALES_ORDER',
  source_id: 1,
  source_code: 'SO-OWNER-001',
  document_date: '2026-05-01',
  due_date: '2026-05-15',
  status: 'OVERDUE',
  total_amount: '1500000',
  paid_amount: '500000',
  outstanding_amount: '1000000',
  days_overdue: 27,
  note: 'Partial collection needs owner follow-up.',
  created_at: '2026-05-01T08:00:00Z',
  updated_at: '2026-06-01T08:00:00Z',
};

const payable = {
  id: 3101,
  code: 'AP-OWNER-001',
  supplier: 1,
  supplier_name: 'Owner Supplier',
  source_type: 'PURCHASE_ORDER',
  source_id: 2001,
  source_code: 'PO-OWNER-001',
  document_date: '2026-05-03',
  due_date: '2026-05-20',
  status: 'PARTIAL',
  total_amount: '900000',
  paid_amount: '300000',
  outstanding_amount: '600000',
  days_overdue: 20,
  note: 'Partial payment needs cash check.',
  created_at: '2026-05-03T08:00:00Z',
  updated_at: '2026-06-01T08:00:00Z',
};

const arSummary = {
  count: 3,
  open_count: 2,
  settled_count: 1,
  overdue_count: 2,
  total_amount: '3000000',
  paid_amount: '1000000',
  remaining_amount: '2000000',
  overdue_amount: '1500000',
};

const apSummary = {
  count: 2,
  open_count: 1,
  settled_count: 1,
  overdue_count: 1,
  total_amount: '1800000',
  paid_amount: '900000',
  remaining_amount: '900000',
  overdue_amount: '600000',
};

const cashSummary = {
  date_from: '2026-06-01',
  date_to: '2026-06-11',
  total_income: '700000',
  total_expense: '1200000',
  cash_delta: '-500000',
  transactions_count: 2,
};

const cashTransaction = {
  id: 3201,
  transaction_date: '2026-06-10',
  transaction_type: 'EXPENSE',
  source_type: 'BANK',
  amount: '1200000',
  cash_account: null,
  cash_account_name: '',
  bank_account: 1,
  bank_account_code: 'BANK-01',
  bank_account_name: 'Main bank',
  category: 1,
  category_name: 'Supplier payment',
  reference: 'PAY-OWNER-001',
  reason: 'Cash out for overdue payable',
  created_at: '2026-06-10T08:00:00Z',
  updated_at: '2026-06-10T08:00:00Z',
};

const reportRow = {
  id: 4001,
  name: 'Owner stale report',
  code: 'RPT-OWNER-001',
  description: 'Owner needs a refreshed operational snapshot.',
  report_type: 'FINANCE',
  report_type_label: 'Finance',
  status: 'READY',
  status_label: 'Ready',
  is_system: false,
  schedule_enabled: false,
  schedule_frequency: 'NONE',
  schedule_frequency_label: 'None',
  next_run_at: null,
  last_generated_at: null,
  last_run_status: 'SUCCESS',
  generated_by_name: '',
  run_count: 0,
  created_at: '2026-05-01T08:00:00Z',
  updated_at: '2026-06-01T08:00:00Z',
};

const task = {
  id: 5001,
  entity_type: 'Product',
  entity_id: 301,
  entity_code: 'FG-OWNER-001',
  title: 'Confirm owner path before release',
  description: 'Owner needs a clear next step.',
  assigned_to: 1,
  assigned_to_info: { id: 1, username: 'uat_admin', full_name: 'UAT Admin' },
  assigned_by: 1,
  assigned_by_info: { id: 1, username: 'uat_admin', full_name: 'UAT Admin' },
  depends_on: null,
  depends_on_info: null,
  status: 'TODO',
  status_display: 'Cho thuc hien',
  priority: 'URGENT',
  priority_display: 'Khan cap',
  is_pinned: true,
  tags: ['owner-path'],
  is_blocking: true,
  blocks_action: 'release',
  due_date: '2026-06-01',
  completed_at: null,
  needs_help: true,
  help_reason: 'Need owner decision.',
  help_requested_at: '2026-06-01T10:00:00Z',
  last_update_note: 'Waiting owner confirmation.',
  last_update_at: '2026-06-02T08:00:00Z',
  last_updated_by: 1,
  last_updated_by_info: { id: 1, username: 'uat_admin', full_name: 'UAT Admin' },
  comment_count: 2,
  attachment_count: 0,
  activity_updated_at: '2026-06-02T08:00:00Z',
  watchers_count: 1,
  is_watching: true,
  created_at: '2026-06-01T08:00:00Z',
  updated_at: '2026-06-02T08:00:00Z',
  is_open: true,
};

const notification = {
  id: 6001,
  recipient: 1,
  notification_type: 'approval_request',
  type_display: 'Approval request',
  title: 'Approve owner salary advance',
  message: 'A salary advance is waiting for approval.',
  entity_type: 'SalaryAdvance',
  entity_id: 7001,
  actor: 1,
  actor_username: 'uat_admin',
  is_read: false,
  read_at: null,
  created_at: '2026-06-02T08:00:00Z',
};

const salaryAdvance = {
  id: 7001,
  employee: 1,
  employee_code: 'EMP-001',
  employee_name: 'Owner Operator',
  advance_date: '2026-06-01',
  month: '2026-06',
  amount: '2500000',
  reason: 'Owner approval coverage',
  approved_by_name: '',
  note: 'Need L1 approval.',
  status: 'ACTIVE',
  approval_status: 'PENDING_L1',
  required_approval_level: 2,
  disbursement_status: 'PENDING',
  disbursement_transaction_id: null,
  disbursed_at: null,
  submitted_at: '2026-06-01T08:00:00Z',
  submitted_by: 1,
  approved_level1_at: null,
  approved_level1_by: null,
  approved_level2_at: null,
  approved_level2_by: null,
  rejected_at: null,
  rejected_by: null,
  rejection_reason: '',
  is_active: true,
  created_at: '2026-06-01T08:00:00Z',
  updated_at: '2026-06-01T08:00:00Z',
};

const stockSummary = {
  stock_rows: 5,
  below_min_count: 1,
  total_on_hand_qty: '100',
  total_available_qty: '80',
  total_reserved_qty: '20',
};

const productionSummary = {
  total_orders: 1,
  active_count: 1,
  overdue_plan_count: 1,
  active_remaining_qty: '40',
};

const salesSummary = {
  total_orders: 2,
  draft_count: 0,
  submitted_count: 1,
  approved_count: 0,
  posted_count: 1,
  void_count: 0,
  pending_approval_count: 1,
  overdue_delivery_count: 1,
  due_today_count: 0,
  due_soon_count: 0,
  posted_total: '2000000',
};

const purchasingSummary = {
  total_orders: 2,
  draft_count: 0,
  submitted_count: 0,
  approved_count: 1,
  partial_received_count: 1,
  received_count: 0,
  cancelled_count: 0,
  pending_approval_count: 1,
  waiting_receipt_count: 2,
  overdue_receipt_count: 2,
  open_value: '1200000',
};

const financeMonthlySummary = {
  month: '2026-06',
  total_income: '700000',
  total_expense: '1200000',
  total_transfer: '0',
  cash_delta: '-500000',
  total_advance: '2500000',
  total_settlement_spent: '0',
  total_settlement_refund: '0',
  advance_net_delta: '2500000',
  transactions_count: 2,
  advances_count: 1,
};

const financePreclose = {
  month: '2026-06',
  can_lock: true,
  blockers: [],
  warnings: [{ code: 'AR_OVERDUE', message: 'Receivable follow-up is still pending.' }],
};

const payrollReconciliation = {
  month: '2026-06',
  payroll_total: '0',
  posted_total: '0',
  delta: '0',
  payroll_count: 0,
  posted_count: 0,
  is_balanced: true,
};

const trialBalance = [
  { account_code: '111', account_name: 'Cash', account_type: 'ASSET', debit: '1000000', credit: '0' },
  { account_code: '511', account_name: 'Revenue', account_type: 'REVENUE', debit: '0', credit: '1000000' },
  { account_code: 'TOTAL', account_name: 'Total', account_type: '', debit: '1000000', credit: '1000000' },
];

const salaryApprovalPolicy = {
  sla_hours_l1: 8,
  sla_hours_l2: 16,
  remind_every_hours: 4,
  escalation_hours_l1: 12,
  escalation_hours_l2: 24,
  escalation_cooldown_hours: 6,
  window_days: 30,
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
    const method = request.method();
    const path = url.pathname.replace(/^\/api\/api\//, '/api/');

    if (path === '/api/users/me/' && method === 'GET') return json(route, user);

    if (path.startsWith('/api/preferences/')) {
      if (method === 'GET') return json(route, { config: {} });
      return json(route, { config: request.postDataJSON()?.config ?? {} });
    }

    if (path === '/api/notifications/unread/' && method === 'GET') return json(route, [notification]);
    if (path === '/api/notifications/unread_count/' && method === 'GET') return json(route, { count: 1 });
    if (path === '/api/notifications/live_updates/' && method === 'GET') {
      return json(route, { has_changes: false, latest_at: null, server_time: '2026-06-11T00:00:00Z', changed_count: 0, unread_count: 1 });
    }
    if (path === '/api/notifications/' && method === 'GET') return json(route, [notification]);

    if (path === '/api/tasks/my_summary/' && method === 'GET') {
      return json(route, { assigned_to_me: 1, created_by_me: 0, watching: 1, team_members: 0, overdue: 1 });
    }
    if (path === '/api/tasks/live_updates/' && method === 'GET') {
      return json(route, { has_changes: false, latest_at: null, server_time: '2026-06-11T00:00:00Z', task_changed_count: 0, bulk_changed_count: 0, audit_changed_count: 0 });
    }
    if (path === '/api/tasks/bulk_history/' && method === 'GET') return json(route, { items: [], total: 0 });
    if (path === '/api/tasks/' && method === 'GET') return json(route, { count: 1, results: [task] });

    if (path === '/api/purchasing/requests/' && method === 'GET') return json(route, paginated([purchaseRequest]));
    if (path === `/api/purchasing/requests/${purchaseRequest.id}/approval_history/` && method === 'GET') return json(route, []);
    if (path === `/api/purchasing/requests/${purchaseRequest.id}/` && method === 'GET') return json(route, purchaseRequest);

    if (path === '/api/purchasing/orders/summary/' && method === 'GET') return json(route, purchasingSummary);
    if (path === '/api/purchasing/orders/' && method === 'GET') return json(route, paginated([purchaseOrder]));
    if (path === `/api/purchasing/orders/${purchaseOrder.id}/receipt_overview/` && method === 'GET') return json(route, { count: 0, results: [] });
    if (path === `/api/purchasing/orders/${purchaseOrder.id}/approval_history/` && method === 'GET') return json(route, []);
    if (path === `/api/purchasing/orders/${purchaseOrder.id}/next_states/` && method === 'GET') {
      return json(route, { current: 'APPROVED', next_states: ['PARTIAL_RECEIVED', 'RECEIVED'] });
    }
    if (path === `/api/purchasing/orders/${purchaseOrder.id}/` && method === 'GET') return json(route, purchaseOrder);
    if (path === '/api/purchasing/suppliers/' && method === 'GET') return json(route, emptyPage);

    if (path === '/api/finance/receivables/summary/' && method === 'GET') return json(route, arSummary);
    if (path === '/api/finance/receivables/' && method === 'GET') return json(route, paginated([receivable]));
    if (path === `/api/finance/receivables/${receivable.id}/` && method === 'GET') return json(route, receivable);
    if (path === '/api/finance/payables/summary/' && method === 'GET') return json(route, apSummary);
    if (path === '/api/finance/payables/' && method === 'GET') return json(route, paginated([payable]));
    if (path === `/api/finance/payables/${payable.id}/` && method === 'GET') return json(route, payable);
    if (path === '/api/finance/cash-transactions/cash_flow_summary/' && method === 'GET') return json(route, cashSummary);
    if (path === '/api/finance/cash-transactions/' && method === 'GET') return json(route, paginated([cashTransaction]));
    if (path === '/api/finance/cash-accounts/' && method === 'GET') return json(route, emptyPage);
    if (path === '/api/finance/bank-accounts/' && method === 'GET') return json(route, emptyPage);
    if (path === '/api/finance/cash-transactions/locked_months/' && method === 'GET') return json(route, { months: [] });
    if (path === '/api/finance/cash-transactions/preclose_check/' && method === 'GET') return json(route, financePreclose);
    if (path === '/api/finance/cash-transactions/payroll_reconciliation/' && method === 'GET') return json(route, payrollReconciliation);
    if (path === '/api/finance/cash-transactions/monthly_summary/' && method === 'GET') return json(route, financeMonthlySummary);
    if (path === '/api/finance/cash-transactions/trend_12m/' && method === 'GET') {
      return json(route, { items: [{ month: '2026-06', cash_delta: '-500000', total_income: '700000', total_expense: '1200000', advance_net_delta: '2500000' }] });
    }
    if (path === '/api/finance/general-ledger/trial_balance/' && method === 'GET') return json(route, trialBalance);

    if (path === '/api/reports/custom/summary/' && method === 'GET') {
      return json(route, {
        total_count: 1,
        scheduled_count: 0,
        system_count: 0,
        run_count: 0,
        generated_count: 1,
        finalized_count: 0,
        draft_count: 0,
        archived_count: 0,
      });
    }
    if (path === '/api/reports/custom/history/' && method === 'GET') return json(route, emptyPage);
    if (path === '/api/reports/custom/' && method === 'GET') return json(route, paginated([reportRow]));

    if (path === '/api/sales/orders/summary/' && method === 'GET') return json(route, salesSummary);
    if (path === '/api/sales/orders/' && method === 'GET') return json(route, paginated([]));
    if (path === '/api/production/orders/summary/' && method === 'GET') return json(route, productionSummary);
    if (path === '/api/inventory/stock/summary/' && method === 'GET') return json(route, stockSummary);
    if (path === '/api/inventory/warehouses/' && method === 'GET') return json(route, emptyPage);
    if (path === '/api/inventory/locations/' && method === 'GET') return json(route, emptyPage);

    if (path === '/api/workforce/employees/' && method === 'GET') {
      return json(route, paginated([{ id: 1, code: 'EMP-001', full_name: 'Owner Operator', is_active: true }]));
    }
    if (path === '/api/workforce/salary-advances/' && method === 'GET') return json(route, paginated([salaryAdvance]));
    if (path === '/api/workforce/salary-advances/approval_queue/' && method === 'GET') {
      return json(route, { pending_l1_count: 1, pending_l2_count: 0, items: [salaryAdvance] });
    }
    if (path === '/api/workforce/salary-advances/approval_sla_overview/' && method === 'GET') {
      return json(route, {
        policy: salaryApprovalPolicy,
        pending_l1_count: 1,
        pending_l2_count: 0,
        overdue_l1_count: 1,
        overdue_l2_count: 0,
        escalation_l1_count: 1,
        escalation_l2_count: 0,
        approved_window_days: 30,
        approved_count: 0,
        avg_lead_hours: 9.5,
        top_blocked_submitters: [{ username: 'owner_operator', pending_count: 1, total_amount: '2500000', max_wait_hours: 10 }],
      });
    }
    if (path === '/api/workforce/salary-advances/approval_sla_reminder_history/' && method === 'GET') {
      return json(route, { days: 30, summary: { total_sent: 0, total_read: 0, total_unread: 0, overall_read_rate: 0 }, items: [] });
    }
    if (path === '/api/workforce/salary-advances/approval_sla_policy/' && method === 'GET') return json(route, salaryApprovalPolicy);
    if (path === `/api/workforce/salary-advances/${salaryAdvance.id}/approval_history/` && method === 'GET') return json(route, []);

    if (path === '/api/activity/operations_log_meta/' && method === 'GET') {
      return json(route, { actions: [], sources: [], recent_failed_count_24h: 0 });
    }

    if (method === 'GET') return json(route, emptyPage);
    return json(route, {});
  });
}

test('purchasing owner paths show request and order next-step guidance without backend login', async ({ page }) => {
  await setupMockApi(page);

  await page.goto('/purchase-requests');
  await expect(page.getByText('PR-OWNER-001')).toBeVisible();
  await expect(page.getByTestId('purchase-request-next-step-1001')).toContainText(/duyet|duyệt/i);

  await page.goto('/purchase-orders');
  await expect(page.getByTestId('purchase-orders-command-strip')).toBeVisible();
  await expect(page.getByText('PO-OWNER-001')).toBeVisible();
  await expect(page.getByTestId('purchase-order-next-step-2001')).toContainText('12');
  await expect(page.getByTestId('purchase-order-submit-2001')).toBeDisabled();
  await expect(page.getByTestId('purchase-order-submit-2001')).toHaveAttribute('title', /gửi duyệt|gui duyet|Nháp|Nhap/i);
  await page.getByTestId('purchase-order-view-2001').click();
  await expect(page.getByTestId('purchase-order-detail-next-step')).toContainText('12');
});

test('finance reporting and dashboard owner paths show next-step context with safe mocks', async ({ page }) => {
  await setupMockApi(page);

  await page.goto('/');
  await expect(page.getByText(/Hôm nay nên nhìn gì trước/i)).toBeVisible();
  await expect(page.getByText(/2 khoản phải thu đã quá hạn/i)).toBeVisible();
  await expect(page.getByTestId('dashboard-restore-salary-advance')).toBeVisible();

  await page.goto('/receivables');
  await expect(page.getByTestId('receivables-command-strip')).toBeVisible();
  await expect(page.getByText('AR-OWNER-001').first()).toBeVisible();
  await expect(page.getByText('Owner next step').first()).toBeVisible();

  await page.goto('/payables');
  await expect(page.getByTestId('payables-command-strip')).toBeVisible();
  await expect(page.getByText('AP-OWNER-001').first()).toBeVisible();
  await expect(page.getByText('Owner next step').first()).toBeVisible();

  await page.goto('/cash-book');
  await expect(page.getByText('PAY-OWNER-001')).toBeVisible();
  await expect(page.getByText(/Việc tiếp theo/i).first()).toBeVisible();

  await page.goto('/finance-summary');
  await expect(page.getByText(/Việc nên làm tiếp theo/i)).toBeVisible();
  await expect(page.getByText(/Đã cân bằng/i)).toBeVisible();

  await page.goto('/trial-balance');
  await expect(page.getByText(/Bảng cân đối/i).first()).toBeVisible();
  await expect(page.getByText(/Cân đối/i).first()).toBeVisible();

  await page.goto('/reports');
  await expect(page.getByTestId('reports-center-command-strip')).toBeVisible();
  await expect(page.getByText('Owner stale report')).toBeVisible();
  await expect(page.getByText(/Việc tiếp theo/i).first()).toBeVisible();

  await page.goto('/bi-dashboard');
  await expect(page.getByTestId('bi-dashboard-command-strip')).toBeVisible();
  await expect(page.getByText(/Phải thu/i).first()).toBeVisible();
  await expect(page.getByText(/2 quá hạn/i).first()).toBeVisible();
});

test('operations approval and workforce owner paths show guidance without delivery side effects', async ({ page }) => {
  await setupMockApi(page);

  await page.goto('/task-inbox');
  await expect(page.getByTestId('task-inbox-command-strip')).toBeVisible();
  await expect(page.getByText('Confirm owner path before release')).toBeVisible();
  await expect(page.getByText(/Tiếp theo:/i).first()).toBeVisible();

  await page.goto('/task-operations');
  await expect(page.getByTestId('task-operations-command-strip')).toBeVisible();
  await expect(page.getByText('FG-OWNER-001').first()).toBeVisible();
  await expect(page.getByText(/Tiếp theo:/i).first()).toBeVisible();

  await page.goto('/notifications');
  await expect(page.getByTestId('notification-center-command-strip')).toBeVisible();
  await expect(page.getByText('Approve owner salary advance').first()).toBeVisible();
  await expect(page.getByText(/Tiếp theo:/i).first()).toBeVisible();

  await page.goto('/salary-advance');
  await expect(page.getByText('EMP-001')).toBeVisible();
  await expect(page.getByText(/Bước tiếp theo/i).first()).toBeVisible();
  await expect(page.getByText(/quá hạn SLA/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Sửa/i }).first()).toBeDisabled();
});
