import { expect, test, type Page, type Route } from '@playwright/test';

test.use({ channel: 'msedge', video: 'off' });

const product = {
  id: 701,
  code: 'SO-SNAP-FG',
  name: 'San pham snapshot',
  category: null,
  category_name: '',
  unit: 1,
  unit_name: 'Cai',
  product_kind: 'GENERIC',
  requires_order_spec: true,
  requires_order_operations_review: true,
  size_order: '',
  size_production: '',
  cost_price: '0',
  sale_price: '40000',
  min_stock: '0',
  delivery_tolerance: '',
  commission_per_unit: '',
  commission_percent: '',
  process_in: 20000,
  operations: [],
  routing_steps: [],
  film_code: '',
  color_count: 0,
  print_color_1: '',
  print_color_2: '',
  print_color_3: '',
  print_color_4: '',
  print_color_5: '',
  print_colors: [],
  status: 'ACTIVE',
  is_active: true,
};

const order = {
  id: 9001,
  code: 'SO-SNAPSHOT-001',
  doc_type: 'SO',
  order_date: '2026-05-23',
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
  created_at: '2026-05-23T00:00:00Z',
  updated_at: '2026-05-23T00:00:00Z',
  lines: [
    {
      id: 9101,
      line_number: 1,
      product: product.id,
      internal_product_code: product.code,
      product_code: product.code,
      product_name: product.name,
      product_name_snapshot: product.name,
      trace_code: 'SO-SNAP-FG|20260523|SO-SNAPSHOT-001|L001',
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
        product_id: product.id,
        product_code: product.code,
        product_name: product.name,
        code: product.code,
        name: product.name,
        product_kind: 'GENERIC',
        requires_order_spec: true,
        requires_order_operations_review: true,
        order_spec_confirmed: false,
        order_operations_reviewed: false,
        unit_name: 'Cai',
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

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

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

    if (path === '/api/sales/orders/' && method === 'GET') {
      return json(route, { count: 1, next: null, previous: null, results: [order] });
    }

    if (path === `/api/sales/orders/${order.id}/` && method === 'GET') {
      return json(route, order);
    }

    if (path === '/api/products/products/' && method === 'GET') {
      return json(route, { count: 1, next: null, previous: null, results: [product] });
    }

    if (path === '/api/customers/' && method === 'GET') {
      return json(route, { count: 0, next: null, previous: null, results: [] });
    }

    if (method === 'GET') {
      return json(route, { count: 0, next: null, previous: null, results: [] });
    }
    return json(route, {});
  });
}

test('sales order form shows snapshot readiness advisory without blocking edits', async ({ page }) => {
  await setupMockApi(page);

  await page.goto('/sales-orders');
  await expect(page.getByText('SO-SNAPSHOT-001')).toBeVisible();
  await page.getByTestId('sales-order-edit-9001').click();

  const panel = page.getByTestId('sales-snapshot-readiness-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('sales-snapshot-readiness-status')).toContainText('WARNING');
  await expect(page.getByTestId('sales-snapshot-blocker-count')).toContainText('0 BLOCKER');
  await expect(page.getByTestId('sales-snapshot-warning-count')).toContainText('6 WARNING');
  await expect(panel).toContainText('Quy cách');
  await expect(panel).toContainText('Công đoạn/routing');
  await expect(panel).toContainText('Metadata in');
  await expect(panel).toContainText('không tự refresh snapshot');
  await expect(page.getByText('Dòng 1')).toBeVisible();
});
