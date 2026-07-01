import { expect, test, type Page, type Route } from '@playwright/test';
import path from 'node:path';

type Permission = { resource: string; action: string };

const supplier = {
  id: 301,
  code: 'SUP-P4F2',
  name: 'Supplier P4F2',
  company_name: 'Supplier P4F2 Co',
  tax_code: '',
  phone: '',
  email: '',
  address: '',
  contact_person: '',
  contact_phone: '',
  payment_terms_days: 21,
  is_preferred: true,
  rating: 5,
  note: '',
  is_active: true,
  created_at: '2026-06-20T08:00:00Z',
  updated_at: '2026-06-20T08:00:00Z',
};

const product = {
  id: 401,
  code: 'MAT-P4F2',
  name: 'Material P4F2',
  unit: 1,
  unit_name: 'Cai',
  cost_price: '9900',
  sale_price: '15000',
  min_stock: '0',
  status: 'ACTIVE',
};

const warehouse = { id: 501, code: 'WH-P4F2', name: 'Warehouse P4F2', is_active: true };
const location = { id: 601, warehouse: warehouse.id, code: 'LOC-P4F2', name: 'Location P4F2', is_active: true };

const purchaseOrder = {
  id: 701,
  code: 'PO-P4F2-001',
  doc_type: 'PO',
  order_date: '2026-06-20',
  expected_receipt_date: '2026-06-23',
  status: 'DRAFT',
  reference: 'P4F2-REF',
  supplier: supplier.id,
  supplier_name: supplier.name,
  warehouse: warehouse.id,
  warehouse_name: warehouse.name,
  location: location.id,
  location_name: location.name,
  currency: 'VND',
  exchange_rate: '1.000000',
  payment_terms_days: 21,
  subtotal: '117500.00',
  discount_total: '0.00',
  tax_total: '9400.00',
  total: '126900.00',
  notes: '',
  version: 1,
  created_at: '2026-06-20T08:00:00Z',
  updated_at: '2026-06-20T08:00:00Z',
  lines: [
    {
      id: 801,
      line_number: 1,
      product: product.id,
      product_code: product.code,
      product_name: product.name,
      qty: '10.0000',
      received_qty: '0.0000',
      remaining_qty: '10.0000',
      unit_price: '11750.00',
      discount_pct: '0.00',
      tax_pct: '8.00',
      line_total: '126900.00',
      note: '',
    },
  ],
};

const receipt = {
  id: 901,
  code: 'REC-P4F2-001',
  purchase_order: purchaseOrder.id,
  purchase_order_code: purchaseOrder.code,
  supplier: supplier.id,
  supplier_name: supplier.name,
  receipt_date: '2026-06-21',
  warehouse: warehouse.id,
  warehouse_name: warehouse.name,
  location: location.id,
  location_name: location.name,
  status: 'POSTED',
  reference: 'REC-P4F2',
  total_qty: '10.0000',
  total_amount: '126900.00',
  can_cancel: true,
  cancel_block_reason: '',
  created_at: '2026-06-21T08:00:00Z',
  updated_at: '2026-06-21T08:00:00Z',
  lines: [
    {
      id: 902,
      purchase_order_line: 801,
      product: product.id,
      product_code: product.code,
      product_name: product.name,
      quantity: '10.0000',
      unit_cost: '11750.00',
      line_total: '126900.00',
      note: '',
    },
  ],
};

const purchaseReturn = {
  id: 1001,
  code: 'RET-P4F2-001',
  return_date: '2026-06-22',
  supplier: supplier.id,
  supplier_name: supplier.name,
  purchase_order: purchaseOrder.id,
  purchase_order_code: purchaseOrder.code,
  source_receipt: receipt.id,
  source_receipt_code: receipt.code,
  status: 'DRAFT',
  reference: 'RET-P4F2',
  return_reason: 'quality',
  return_notes: '',
  subtotal: '11750.00',
  tax_total: '940.00',
  total: '12690.00',
  version: 1,
  created_at: '2026-06-22T08:00:00Z',
  updated_at: '2026-06-22T08:00:00Z',
  lines: [
    {
      id: 1002,
      product: product.id,
      product_code: product.code,
      product_name: product.name,
      qty: '1.0000',
      unit_price: '11750.00',
      tax_pct: '8.00',
      line_total: '12690.00',
      note: '',
    },
  ],
};

const materialPrice = {
  id: 1101,
  product: product.id,
  product_code: product.code,
  product_name: product.name,
  supplier: supplier.id,
  supplier_code: supplier.code,
  supplier_name: supplier.name,
  unit_price: '11750.00',
  currency: 'VND',
  uom: 'CAI',
  effective_from: '2026-06-01',
  effective_to: null,
  min_quantity: null,
  note: '',
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
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
    id: 880,
    username,
    is_staff: false,
    is_superuser: false,
    is_active: true,
    is_locked: false,
    roles: [
      {
        code: 'P4F2_PURCHASING_PERMISSION_TEST',
        name: 'P4F2 Purchasing Permission Test',
        permissions,
      },
    ],
  };
}

async function setupPurchasingPermissionMockApi(page: Page, permissions: Permission[], writes: string[] = []) {
  const user = buildUser(`p4f2_${permissions.length || 'none'}`, permissions);
  let preferences: Record<string, unknown> = {};

  await page.addInitScript((storedUser) => {
    window.localStorage.setItem('access_token', 'mock-access-token');
    window.localStorage.setItem('refresh_token', 'mock-refresh-token');
    window.localStorage.setItem('user', JSON.stringify(storedUser));
  }, user);

  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/api\//, '/api/');
    const method = request.method();

    if (path === '/api/users/me/' && method === 'GET') return json(route, user);
    if (path.startsWith('/api/preferences/')) {
      if (method === 'GET') return json(route, { config: preferences });
      preferences = request.postDataJSON()?.config ?? {};
      return json(route, { config: preferences });
    }
    if (path === '/api/notifications/unread/' && method === 'GET') return json(route, []);
    if (path === '/api/notifications/unread_count/' && method === 'GET') return json(route, { count: 0 });
    if (path === '/api/notifications/live_updates/' && method === 'GET') {
      return json(route, { has_changes: false, latest_at: null, server_time: '2026-06-20T00:00:00Z', changed_count: 0, unread_count: 0 });
    }
    if (path === '/api/tasks/my_summary/' && method === 'GET') {
      return json(route, { assigned_to_me: 0, created_by_me: 0, watching: 0, team_members: 0, overdue: 0 });
    }
    if (path === '/api/tasks/live_updates/' && method === 'GET') {
      return json(route, { has_changes: false, latest_at: null, server_time: '2026-06-20T00:00:00Z', task_changed_count: 0, bulk_changed_count: 0, audit_changed_count: 0 });
    }

    if (path === '/api/purchasing/orders/' && method === 'GET') return json(route, paginated([purchaseOrder]));
    if (path === '/api/purchasing/orders/summary/' && method === 'GET') {
      return json(route, {
        total_orders: 1,
        draft_count: 1,
        submitted_count: 0,
        approved_count: 0,
        partial_received_count: 0,
        received_count: 0,
        cancelled_count: 0,
        pending_approval_count: 0,
        waiting_receipt_count: 0,
        overdue_receipt_count: 0,
        open_value: '126900.00',
      });
    }
    if (path === '/api/purchasing/orders/701/approval_history/' && method === 'GET') return json(route, []);
    if (path === '/api/purchasing/orders/701/receipt_overview/' && method === 'GET') return json(route, { count: 1, results: [receipt] });
    if (path === '/api/purchasing/orders/701/next_states/' && method === 'GET') return json(route, { current: 'DRAFT', next_states: ['SUBMITTED'] });
    if (path === '/api/purchasing/orders/701/' && method === 'GET') return json(route, purchaseOrder);

    if (path === '/api/purchasing/receipts/' && method === 'GET') return json(route, paginated([receipt]));
    if (path === '/api/purchasing/receipts/901/lifecycle_history/' && method === 'GET') return json(route, []);
    if (path === '/api/purchasing/receipts/901/next_states/' && method === 'GET') return json(route, { current: 'POSTED', next_states: ['CANCELLED'] });
    if (path === '/api/purchasing/receipts/901/returnable_lines/' && method === 'GET') {
      return json(route, [{ receipt_line: 902, product: product.id, product_code: product.code, product_name: product.name, returnable_qty: '1.0000' }]);
    }
    if (path === '/api/purchasing/receipts/901/' && method === 'GET') return json(route, receipt);

    if (path === '/api/purchasing/returns/' && method === 'GET') return json(route, paginated([purchaseReturn]));
    if (path === '/api/purchasing/returns/1001/approval_history/' && method === 'GET') return json(route, []);
    if (path === '/api/purchasing/returns/1001/lifecycle_history/' && method === 'GET') return json(route, []);
    if (path === '/api/purchasing/returns/1001/next_states/' && method === 'GET') return json(route, { current: 'DRAFT', next_states: ['SUBMITTED'] });
    if (path === '/api/purchasing/returns/1001/' && method === 'GET') return json(route, purchaseReturn);

    if (path === '/api/purchasing/material-prices/' && method === 'GET') return json(route, paginated([materialPrice]));
    if (path === '/api/purchasing/suppliers/' && method === 'GET') return json(route, paginated([supplier]));
    if (path === '/api/products/products/' && method === 'GET') return json(route, paginated([product]));
    if (path === '/api/inventory/warehouses/' && method === 'GET') return json(route, paginated([warehouse]));
    if (path === '/api/inventory/locations/' && method === 'GET') return json(route, paginated([location]));

    if (method === 'GET') return json(route, paginated([]));

    writes.push(`${method} ${path}`);
    return json(route, { error: 'Write blocked in P4F2 permission E2E' }, 403);
  });
}

async function evidenceScreenshot(page: Page, fileName: string) {
  const artifactDir = process.env.P4F2_ARTIFACT_DIR;
  if (!artifactDir) return;
  await page.screenshot({ path: path.join(artifactDir, fileName), fullPage: false });
}

const purchasingViewPermission = [{ resource: 'PURCHASING', action: 'VIEW' }];
const purchasingEditorPermissions = [
  { resource: 'PURCHASING', action: 'VIEW' },
  { resource: 'PURCHASING', action: 'MANAGE' },
  { resource: 'PURCHASEORDER', action: 'SUBMIT' },
  { resource: 'PURCHASEORDER', action: 'APPROVE' },
  { resource: 'PURCHASEORDER', action: 'REJECT' },
  { resource: 'PURCHASEORDER', action: 'RECEIVE' },
  { resource: 'PURCHASEORDER', action: 'CANCEL' },
];

test('P4F2 no-view user cannot enter Purchasing routes or command palette entries', async ({ page }) => {
  await setupPurchasingPermissionMockApi(page, []);

  await page.goto('/purchase-orders');

  await expect(page).not.toHaveURL(/\/purchase-orders$/);
  await expect(page.getByTestId('purchase-orders-command-strip')).toHaveCount(0);
  await expect(page.locator('a[href="/purchase-orders"]')).toHaveCount(0);

  await page.getByTestId('command-palette-open-button').click();
  const palette = page.getByTestId('command-palette-modal');
  await palette.getByTestId('command-palette-search-input').fill('purchase order');
  await expect(page.getByTestId('command-palette-result-purchase-orders')).toHaveCount(0);
  await evidenceScreenshot(page, '01-no-view-login-or-blocked.png');
});

test('P4F2 view-only user can read Purchasing screens without write or export controls', async ({ page }) => {
  const writes: string[] = [];
  await setupPurchasingPermissionMockApi(page, purchasingViewPermission, writes);

  await page.goto('/purchase-orders');
  await expect(page.getByTestId('purchase-orders-command-strip')).toBeVisible();
  await expect(page.getByText('PO-P4F2-001')).toBeVisible();
  await expect(page.getByTestId('purchase-orders-open-create')).toHaveCount(0);
  await expect(page.getByTestId('purchase-order-view-701')).toBeVisible();
  await expect(page.getByTestId('purchase-order-edit-701')).toHaveCount(0);
  await expect(page.getByTestId('purchase-order-submit-701')).toHaveCount(0);
  await expect(page.getByTestId('purchase-order-approve-701')).toHaveCount(0);
  await expect(page.getByTestId('purchase-order-receive-701')).toHaveCount(0);
  await expect(page.getByTestId('purchase-order-cancel-701')).toHaveCount(0);
  await evidenceScreenshot(page, '02-view-only-po-list.png');

  await page.getByTestId('command-palette-open-button').click();
  const palette = page.getByTestId('command-palette-modal');
  await palette.getByTestId('command-palette-search-input').fill('purchase order');
  await expect(page.getByTestId('command-palette-result-purchase-orders')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByTestId('purchase-order-view-701').click();
  await expect(page.getByTestId('purchase-order-detail-next-step')).toBeVisible();
  await evidenceScreenshot(page, '03-view-only-detail-no-actions.png');

  await page.goto('/material-prices');
  await expect(page.getByText('MAT-P4F2')).toBeVisible();
  await expect(page.getByTestId('material-prices-open-create')).toHaveCount(0);
  await expect(page.getByTestId('material-prices-export-csv')).toHaveCount(0);

  await page.goto('/purchase-receipts');
  await expect(page.getByTestId('purchase-receipts-command-strip')).toBeVisible();
  await expect(page.getByText('REC-P4F2-001')).toBeVisible();
  await expect(page.getByTestId('purchase-receipt-view-901')).toBeVisible();
  await expect(page.getByTestId('purchase-receipt-cancel-901')).toHaveCount(0);
  await evidenceScreenshot(page, '05-receipt-action-permissions.png');
  await page.getByTestId('purchase-receipt-view-901').click();
  await expect(page.getByTestId('purchase-receipt-detail-panel')).toBeVisible();

  await page.goto('/purchase-returns');
  await expect(page.getByTestId('purchase-returns-command-strip')).toBeVisible();
  await expect(page.getByText('RET-P4F2-001')).toBeVisible();
  await expect(page.getByTestId('purchase-returns-open-create')).toHaveCount(0);
  await expect(page.getByTestId('purchase-returns-export-csv')).toHaveCount(0);
  await expect(page.getByTestId('purchase-return-view-1001')).toBeVisible();
  await expect(page.getByTestId('purchase-return-edit-1001')).toHaveCount(0);
  await expect(page.getByTestId('purchase-return-submit-1001')).toHaveCount(0);
  await expect(page.getByTestId('purchase-return-post-1001')).toHaveCount(0);
  await expect(page.getByTestId('purchase-return-reverse-1001')).toHaveCount(0);
  await evidenceScreenshot(page, '06-return-action-permissions.png');
  await page.getByTestId('purchase-return-view-1001').click();
  await expect(page.getByTestId('purchase-return-detail-panel')).toBeVisible();

  expect(writes).toEqual([]);
});

test('P4F2 editor user keeps Purchasing write controls visible', async ({ page }) => {
  const writes: string[] = [];
  await setupPurchasingPermissionMockApi(page, purchasingEditorPermissions, writes);

  await page.goto('/purchase-orders');
  await expect(page.getByTestId('purchase-orders-open-create')).toBeVisible();
  await expect(page.getByTestId('purchase-order-edit-701')).toBeVisible();
  await expect(page.getByTestId('purchase-order-submit-701')).toBeVisible();
  await evidenceScreenshot(page, '04-editor-po-actions.png');

  await page.goto('/purchase-receipts');
  await expect(page.getByTestId('purchase-receipt-cancel-901')).toBeVisible();

  await page.goto('/purchase-returns');
  await expect(page.getByTestId('purchase-returns-open-create')).toBeVisible();
  await expect(page.getByTestId('purchase-returns-export-csv')).toBeVisible();
  await expect(page.getByTestId('purchase-return-edit-1001')).toBeVisible();
  await expect(page.getByTestId('purchase-return-submit-1001')).toBeVisible();

  expect(writes).toEqual([]);
});

test('P4F2 mobile view-only user gets read cards without write actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupPurchasingPermissionMockApi(page, purchasingViewPermission);

  await page.goto('/purchase-orders');

  await expect(page.getByTestId('purchase-order-mobile-list')).toBeVisible();
  await expect(page.getByTestId('purchase-order-mobile-card-701')).toBeVisible();
  await expect(page.getByTestId('purchase-orders-open-create')).toHaveCount(0);
  await expect(page.getByTestId('purchase-order-view-701')).toBeVisible();
  await expect(page.getByTestId('purchase-order-edit-701')).toHaveCount(0);
  await expect(page.getByTestId('purchase-order-submit-701')).toHaveCount(0);
  await evidenceScreenshot(page, '07-mobile-view-only.png');
});

test('P4F2 mobile editor user keeps Purchasing write actions available', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupPurchasingPermissionMockApi(page, purchasingEditorPermissions);

  await page.goto('/purchase-orders');

  await expect(page.getByTestId('purchase-order-mobile-list')).toBeVisible();
  await expect(page.getByTestId('purchase-order-mobile-card-701')).toBeVisible();
  await expect(page.getByTestId('purchase-orders-open-create')).toBeVisible();
  await expect(page.getByTestId('purchase-order-edit-701')).toBeVisible();
  await expect(page.getByTestId('purchase-order-submit-701')).toBeVisible();
  await evidenceScreenshot(page, '08-mobile-editor-actions.png');
});
