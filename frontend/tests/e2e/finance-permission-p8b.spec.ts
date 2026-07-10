import { expect, test, type Page, type Route } from '@playwright/test';
import path from 'node:path';

type Permission = { resource: string; action: string };

const receivable = {
  id: 301,
  code: 'P8B-AR-001',
  document_type: 'RECEIVABLE',
  source_sales_order: null,
  source_sales_order_code: null,
  customer: null,
  customer_code: 'CUS-P8B',
  customer_name: 'Customer P8B',
  customer_snapshot: { code: 'CUS-P8B', name: 'Customer P8B' },
  document_date: '2026-07-01',
  due_date: '2026-07-25',
  currency: 'VND',
  exchange_rate: '1.000000',
  subtotal_amount: '120000.00',
  tax_amount: '0.00',
  total_amount: '120000.00',
  settled_amount: '0.00',
  remaining_amount: '120000.00',
  days_overdue: 0,
  status: 'OPEN',
  reference: 'INV-P8B-001',
  note: '',
  version: 1,
  created_at: '2026-07-01T08:00:00Z',
  updated_at: '2026-07-01T08:00:00Z',
  settlements: [],
};

const payable = {
  id: 401,
  code: 'P8B-AP-001',
  document_type: 'PAYABLE',
  source_purchase_receipt: null,
  source_purchase_receipt_code: null,
  source_purchase_order_code: 'PO-P8B-001',
  supplier: null,
  supplier_code: 'SUP-P8B',
  supplier_name: 'Supplier P8B',
  supplier_snapshot: { code: 'SUP-P8B', name: 'Supplier P8B' },
  document_date: '2026-07-02',
  due_date: '2026-07-26',
  vendor_invoice_no: 'BILL-P8B-001',
  vendor_invoice_date: '2026-07-02',
  currency: 'VND',
  exchange_rate: '1.000000',
  subtotal_amount: '90000.00',
  tax_amount: '0.00',
  total_amount: '90000.00',
  adjusted_total_amount: '90000.00',
  adjustment_credit_amount: '0.00',
  adjustment_debit_amount: '0.00',
  settled_amount: '0.00',
  remaining_amount: '90000.00',
  days_overdue: 0,
  status: 'OPEN',
  reference: 'AP-P8B',
  note: '',
  version: 1,
  created_at: '2026-07-02T08:00:00Z',
  updated_at: '2026-07-02T08:00:00Z',
  settlements: [],
  adjustments: [],
};

const cashAccount = {
  id: 501,
  name: 'P8B Cash',
  account_type: 'CASH',
  balance: '5000000.00',
  current_balance: '5000000.00',
  note: '',
  is_active: true,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

const bankAccount = {
  id: 601,
  code: 'P8B-BANK',
  account_number: '000-P8B',
  account_name: 'ERP Carton P8B',
  bank_name: 'P8B Bank',
  branch: '',
  note: '',
  is_active: true,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

const glEntry = {
  id: 701,
  account: 801,
  account_name: 'P8B GL cash',
  account_code: 'P8B100',
  account_type: 'ASSET',
  posting_date: '2026-07-03',
  debit_amount: '125.00',
  credit_amount: '0.00',
  document_type: 'P8B',
  document_id: 301,
  document_code: 'P8B-GL-001',
  description: 'P8B GL read baseline',
  created_by: null,
  created_by_name: null,
  created_at: '2026-07-03T08:00:00Z',
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function paginated<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

function buildUser(username: string, permissions: Permission[]) {
  return {
    id: 980,
    username,
    is_staff: false,
    is_superuser: false,
    is_active: true,
    is_locked: false,
    roles: permissions.length
      ? [
          {
            code: 'P8B_FINANCE_PERMISSION_TEST',
            name: 'P8B Finance Permission Test',
            permissions,
          },
        ]
      : [],
  };
}

async function setupFinancePermissionMockApi(page: Page, permissions: Permission[], writes: string[] = []) {
  const user = buildUser(`p8b_${permissions.map((p) => p.action.toLowerCase()).join('_') || 'none'}`, permissions);
  let preferences: Record<string, unknown> = {};

  await page.addInitScript((storedUser) => {
    window.localStorage.setItem('access_token', 'mock-access-token');
    window.localStorage.setItem('refresh_token', 'mock-refresh-token');
    window.localStorage.setItem('user', JSON.stringify(storedUser));
  }, user);

  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const apiPath = url.pathname.replace(/^\/api\/api\//, '/api/');
    const method = request.method();

    if (apiPath === '/api/users/me/' && method === 'GET') return json(route, user);
    if (apiPath.startsWith('/api/preferences/')) {
      if (method === 'GET') return json(route, { config: preferences });
      preferences = request.postDataJSON()?.config ?? {};
      return json(route, { config: preferences });
    }
    if (apiPath === '/api/notifications/unread/' && method === 'GET') return json(route, []);
    if (apiPath === '/api/notifications/unread_count/' && method === 'GET') return json(route, { count: 0 });
    if (apiPath === '/api/notifications/live_updates/' && method === 'GET') {
      return json(route, { has_changes: false, latest_at: null, server_time: '2026-07-10T00:00:00Z', changed_count: 0, unread_count: 0 });
    }
    if (apiPath === '/api/tasks/my_summary/' && method === 'GET') {
      return json(route, { assigned_to_me: 0, created_by_me: 0, watching: 0, team_members: 0, overdue: 0 });
    }
    if (apiPath === '/api/tasks/live_updates/' && method === 'GET') {
      return json(route, { has_changes: false, latest_at: null, server_time: '2026-07-10T00:00:00Z', task_changed_count: 0, bulk_changed_count: 0, audit_changed_count: 0 });
    }

    if (apiPath === '/api/finance/receivables/' && method === 'GET') return json(route, paginated([receivable]));
    if (apiPath === '/api/finance/receivables/301/' && method === 'GET') return json(route, receivable);
    if (apiPath === '/api/finance/receivables/301/settlements/' && method === 'GET') return json(route, []);
    if (apiPath === '/api/finance/payables/' && method === 'GET') return json(route, paginated([payable]));
    if (apiPath === '/api/finance/payables/401/' && method === 'GET') return json(route, payable);
    if (apiPath === '/api/finance/payables/401/settlements/' && method === 'GET') return json(route, []);
    if (apiPath === '/api/finance/cash-accounts/' && method === 'GET') return json(route, paginated([cashAccount]));
    if (apiPath === '/api/finance/bank-accounts/' && method === 'GET') return json(route, paginated([bankAccount]));
    if (apiPath === '/api/finance/cash-transactions/' && method === 'GET') return json(route, paginated([]));
    if (apiPath === '/api/finance/general-ledger/' && method === 'GET') return json(route, paginated([glEntry]));
    if (apiPath === '/api/finance/general-ledger-accounts/' && method === 'GET') return json(route, paginated([]));
    if (apiPath === '/api/finance/general-ledger/trial_balance/' && method === 'GET') return json(route, []);

    if (method === 'GET') return json(route, paginated([]));

    if (apiPath.startsWith('/api/finance/')) writes.push(`${method} ${apiPath}`);
    return json(route, { error: 'Write blocked in P8B finance permission E2E' }, 403);
  });
}

async function evidenceScreenshot(page: Page, fileName: string) {
  const artifactDir = process.env.P8B_ARTIFACT_DIR;
  if (!artifactDir) return;
  await page.screenshot({ path: path.join(artifactDir, fileName), fullPage: false });
}

const financeViewPermission = [{ resource: 'FINANCE', action: 'VIEW' }];
const financeSettlePermission = [{ resource: 'FINANCE', action: 'SETTLE' }];
const financeAdjustPermission = [{ resource: 'FINANCE', action: 'ADJUST' }];
const financeGlPermission = [{ resource: 'FINANCE', action: 'GL' }];
const financeManagePermission = [{ resource: 'FINANCE', action: 'MANAGE' }];

test('P8B no-view user cannot enter Finance routes or command palette entries', async ({ page }) => {
  await setupFinancePermissionMockApi(page, []);

  await page.goto('/receivables');

  await expect(page).not.toHaveURL(/\/receivables$/);
  await expect(page.getByTestId('receivables-command-strip')).toHaveCount(0);
  await expect(page.locator('a[href="/receivables"]')).toHaveCount(0);

  await page.getByTestId('command-palette-open-button').click();
  const palette = page.getByTestId('command-palette-modal');
  await palette.getByTestId('command-palette-search-input').fill('receivables');
  await expect(page.getByTestId('command-palette-result-receivables')).toHaveCount(0);
  await evidenceScreenshot(page, '01-no-view-finance-blocked.png');
});

test('P8B view-only user can read AR/AP without settlement, adjust, or export controls', async ({ page }) => {
  const writes: string[] = [];
  await setupFinancePermissionMockApi(page, financeViewPermission, writes);

  await page.goto('/receivables');
  await expect(page.getByTestId('receivables-command-strip')).toBeVisible();
  await expect(page.getByText('P8B-AR-001')).toBeVisible();
  await expect(page.getByTestId('receivable-view-301')).toBeVisible();
  await expect(page.getByTestId('receivable-collect-301')).toHaveCount(0);
  await expect(page.getByTestId('receivable-cancel-301')).toHaveCount(0);
  await expect(page.getByTestId('receivables-export-csv')).toHaveCount(0);
  await evidenceScreenshot(page, '02-view-only-ar-list.png');

  await page.getByTestId('command-palette-open-button').click();
  const palette = page.getByTestId('command-palette-modal');
  await palette.getByTestId('command-palette-search-input').fill('receivables');
  await expect(page.getByTestId('command-palette-result-receivables')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/payables');
  await expect(page.getByTestId('payables-command-strip')).toBeVisible();
  await expect(page.getByText('P8B-AP-001')).toBeVisible();
  await expect(page.getByTestId('payable-view-401')).toBeVisible();
  await expect(page.getByTestId('payable-pay-401')).toHaveCount(0);
  await expect(page.getByTestId('payable-cancel-401')).toHaveCount(0);
  await expect(page.getByTestId('payables-export-csv')).toHaveCount(0);
  await evidenceScreenshot(page, '03-view-only-ap-list.png');

  expect(writes).toEqual([]);
});

test('P8B settle user sees settlement forms but no adjust or export controls', async ({ page }) => {
  const writes: string[] = [];
  await setupFinancePermissionMockApi(page, financeSettlePermission, writes);

  await page.goto('/receivables');
  await expect(page.getByTestId('receivable-collect-301')).toBeVisible();
  await expect(page.getByTestId('receivable-cancel-301')).toHaveCount(0);
  await expect(page.getByTestId('receivables-export-csv')).toHaveCount(0);
  await page.getByTestId('receivable-collect-301').click();
  await expect(page.getByText(/P8B-AR-001/).last()).toBeVisible();
  await evidenceScreenshot(page, '04-settle-ar-form-open-no-submit.png');
  await page.keyboard.press('Escape');

  await page.goto('/payables');
  await expect(page.getByTestId('payable-pay-401')).toBeVisible();
  await expect(page.getByTestId('payable-cancel-401')).toHaveCount(0);
  await expect(page.getByTestId('payables-export-csv')).toHaveCount(0);
  await page.getByTestId('payable-pay-401').click();
  await expect(page.getByText(/P8B-AP-001/).last()).toBeVisible();
  await evidenceScreenshot(page, '05-settle-ap-form-open-no-submit.png');

  expect(writes).toEqual([]);
});

test('P8B adjust user sees cancel controls but no settlement or export controls', async ({ page }) => {
  const writes: string[] = [];
  await setupFinancePermissionMockApi(page, financeAdjustPermission, writes);

  await page.goto('/receivables');
  await expect(page.getByTestId('receivable-cancel-301')).toBeVisible();
  await expect(page.getByTestId('receivable-collect-301')).toHaveCount(0);
  await expect(page.getByTestId('receivables-export-csv')).toHaveCount(0);
  await evidenceScreenshot(page, '06-adjust-ar-cancel-visible.png');

  await page.goto('/payables');
  await expect(page.getByTestId('payable-cancel-401')).toBeVisible();
  await expect(page.getByTestId('payable-pay-401')).toHaveCount(0);
  await expect(page.getByTestId('payables-export-csv')).toHaveCount(0);
  await evidenceScreenshot(page, '07-adjust-ap-cancel-visible.png');

  expect(writes).toEqual([]);
});

test('P8B GL user can access ledger route but not AR/AP routes', async ({ page }) => {
  await setupFinancePermissionMockApi(page, financeGlPermission);

  await page.goto('/general-ledger');
  await expect(page).toHaveURL(/\/general-ledger$/);
  await expect(page.getByText('P8B-GL-001')).toBeVisible();
  await evidenceScreenshot(page, '08-gl-user-ledger.png');

  await page.goto('/receivables');
  await expect(page).not.toHaveURL(/\/receivables$/);
  await expect(page.getByTestId('receivable-view-301')).toHaveCount(0);
});

test('P8B manage user keeps export and finance action controls visible', async ({ page }) => {
  const writes: string[] = [];
  await setupFinancePermissionMockApi(page, financeManagePermission, writes);

  await page.goto('/receivables');
  await expect(page.getByTestId('receivable-collect-301')).toBeVisible();
  await expect(page.getByTestId('receivable-cancel-301')).toBeVisible();
  await expect(page.getByTestId('receivables-export-csv')).toBeVisible();

  await page.goto('/payables');
  await expect(page.getByTestId('payable-pay-401')).toBeVisible();
  await expect(page.getByTestId('payable-cancel-401')).toBeVisible();
  await expect(page.getByTestId('payables-export-csv')).toBeVisible();
  await evidenceScreenshot(page, '09-manage-actions-visible.png');

  expect(writes).toEqual([]);
});

test('P8B mobile view-only AR/AP remains readable without write actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupFinancePermissionMockApi(page, financeViewPermission);

  await page.goto('/receivables');
  await expect(page.getByText('P8B-AR-001')).toBeVisible();
  await expect(page.getByTestId('receivable-collect-301')).toHaveCount(0);
  await evidenceScreenshot(page, '10-mobile-ar-view-only.png');

  await page.goto('/payables');
  await expect(page.getByText('P8B-AP-001')).toBeVisible();
  await expect(page.getByTestId('payable-pay-401')).toHaveCount(0);
  await evidenceScreenshot(page, '11-mobile-ap-view-only.png');
});
