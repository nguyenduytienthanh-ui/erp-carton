import { expect, test, type Page, type Route } from '@playwright/test';

const supplier = {
  id: 301,
  code: 'SUP-P4B',
  name: 'Nhà cung cấp P4B',
  company_name: 'Công ty P4B',
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
  code: 'MAT-P4B',
  name: 'Giấy test P4B',
  unit: 1,
  unit_name: 'Cái',
  cost_price: '9900',
  sale_price: '15000',
  min_stock: '0',
  status: 'ACTIVE',
};

const warehouse = { id: 501, code: 'WH-P4B', name: 'Kho P4B', is_active: true };
const location = { id: 601, warehouse: warehouse.id, code: 'LOC-P4B', name: 'Kệ P4B', is_active: true };

const purchaseOrder = {
  id: 701,
  code: 'PO-P4B-001',
  doc_type: 'PO',
  order_date: '2026-06-20',
  expected_receipt_date: '2026-06-23',
  status: 'DRAFT',
  reference: 'P4B-REF',
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

async function setupPurchaseOrderMockApi(page: Page) {
  let preferences: Record<string, unknown> = {};
  let lastOrderPayload: Record<string, unknown> | null = null;

  await page.addInitScript(() => {
    window.localStorage.setItem('access_token', 'mock-access-token');
    window.localStorage.setItem('user', JSON.stringify({ username: 'uat_admin', is_staff: true, is_superuser: true, roles: [] }));
  });

  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname.replace(/^\/api\/api\//, '/api/');

    if (path === '/api/users/me/' && method === 'GET') {
      return json(route, { id: 1, username: 'uat_admin', is_staff: true, is_superuser: true, roles: [] });
    }
    if (path.startsWith('/api/preferences/')) {
      if (method === 'GET') return json(route, { config: preferences });
      preferences = request.postDataJSON()?.config ?? {};
      return json(route, { config: preferences });
    }
    if (path === '/api/notifications/unread_count/' && method === 'GET') return json(route, { count: 0 });
    if (path === '/api/notifications/unread/' && method === 'GET') return json(route, []);
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
    if (path === '/api/purchasing/orders/' && method === 'POST') {
      lastOrderPayload = request.postDataJSON();
      return json(route, { ...purchaseOrder, id: 999, ...lastOrderPayload }, 201);
    }
    if (path === '/api/purchasing/suppliers/' && method === 'GET') return json(route, paginated([supplier]));
    if (path === '/api/products/products/' && method === 'GET') return json(route, paginated([product]));
    if (path === '/api/inventory/warehouses/' && method === 'GET') return json(route, paginated([warehouse]));
    if (path === '/api/inventory/locations/' && method === 'GET') return json(route, paginated([location]));
    if (path === '/api/purchasing/material-prices/' && method === 'GET') {
      return json(route, paginated([{
        id: 901,
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
      }]));
    }

    if (method === 'GET') return json(route, paginated([]));
    return json(route, {});
  });

  return { getLastOrderPayload: () => lastOrderPayload };
}

async function selectOption(page: Page, inputSelector: string, optionText: string) {
  await page.locator(inputSelector).click();
  await page.getByText(optionText, { exact: true }).click();
}

test('Purchase order P4B desktop keeps compact actions, column chooser and price suggestion', async ({ page }) => {
  const api = await setupPurchaseOrderMockApi(page);

  await page.goto('/purchase-orders');
  await expect(page.getByTestId('purchase-orders-command-strip')).toBeVisible();
  await expect(page.getByText('PO-P4B-001')).toBeVisible();
  await expect(page.getByTestId('purchase-order-edit-701')).toBeVisible();
  await expect(page.getByTestId('purchase-order-submit-701')).toBeVisible();
  await expect(page.getByTestId('purchase-order-actions-menu-701')).toBeVisible();

  await page.getByTestId('purchase-orders-column-settings').click();
  const columnDialog = page.getByRole('dialog', { name: 'Cột hiển thị' });
  await expect(columnDialog).toBeVisible();
  await expect(columnDialog.getByText('Tiến độ nhận')).toBeVisible();
  await columnDialog.getByRole('button', { name: 'Đóng' }).click();

  await page.getByRole('button', { name: 'Tạo đơn mua' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tạo đơn mua' });
  await expect(dialog).toBeVisible();
  await selectOption(page, 'input#supplier', `${supplier.code} - ${supplier.name}`);
  await selectOption(page, 'input#lines_0_product', `${product.code} - ${product.name}`);
  await expect(dialog.getByText('Theo bảng giá NCC')).toBeVisible();
  await expect.poll(async () => {
    return dialog.getByTestId('purchase-order-line-unit-price-0').evaluate((element) => (
      element instanceof HTMLInputElement ? element.value : element.querySelector('input')?.value ?? ''
    ));
  }).toBe('11750');
  expect(api.getLastOrderPayload()).toBeNull();
});

test('Purchase order P4B mobile uses cards and a viewport-safe form', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupPurchaseOrderMockApi(page);

  await page.goto('/purchase-orders');
  await expect(page.getByTestId('purchase-order-mobile-list')).toBeVisible();
  await expect(page.getByTestId('purchase-order-mobile-card-701')).toBeVisible();

  await page.getByRole('button', { name: 'Tạo đơn mua' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tạo đơn mua' });
  await expect(dialog).toBeVisible();
  const lineCard = dialog.getByTestId('purchase-order-line-card').first();
  await expect(lineCard).toBeVisible();
  const box = await lineCard.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
});
