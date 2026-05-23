import { expect, test, type Page, type Route } from '@playwright/test';

test.use({ channel: 'msedge', video: 'off' });

const product = {
  id: 501,
  code: 'P-READINESS',
  name: 'San pham readiness',
  category: null,
  category_name: '',
  unit: 1,
  unit_name: 'Cai',
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
  created_at: '2026-05-23T00:00:00Z',
  updated_at: '2026-05-23T00:00:00Z',
};

const readiness = {
  product_id: product.id,
  product_code: product.code,
  product_name: product.name,
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
  rules: {
    workflow_enforced: false,
  },
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

    if (path === '/api/products/products/' && method === 'GET') {
      return json(route, { count: 1, next: null, previous: null, results: [product] });
    }

    if (path === `/api/products/products/${product.id}/` && method === 'GET') {
      return json(route, product);
    }

    if (path === `/api/products/products/${product.id}/readiness/` && method === 'GET') {
      return json(route, readiness);
    }

    if (path === '/api/products/units/' && method === 'GET') {
      return json(route, { count: 1, next: null, previous: null, results: [{ id: 1, code: 'CAI', name: 'Cai', is_active: true }] });
    }

    if (method === 'GET') {
      return json(route, { count: 0, next: null, previous: null, results: [] });
    }
    return json(route, {});
  });
}

test('product form displays routing readiness without blocking edits', async ({ page }) => {
  await setupMockApi(page);

  await page.goto('/products');
  await expect(page.getByText('P-READINESS', { exact: true }).first()).toBeVisible();
  await page.getByText('P-READINESS', { exact: true }).first().click();

  const panel = page.getByTestId('product-readiness-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('product-readiness-status')).toContainText('BLOCKER');
  await expect(page.getByTestId('product-readiness-status-label')).toBeVisible();
  await expect(page.getByTestId('product-readiness-blocker-count')).toContainText('1 BLOCKER');
  await expect(page.getByTestId('product-readiness-warning-count')).toContainText('2 WARNING');
  await expect(page.getByTestId('product-readiness-summary-operation_count')).toContainText('0');
  await expect(page.getByTestId('product-readiness-summary-routing_step_count')).toContainText('0');
  await expect(page.getByTestId('product-readiness-summary-active_machine_count')).toContainText('0');
  await expect(panel).toContainText('Routing/công đoạn');
  await expect(panel).toContainText('Máy/tổ sản xuất');
  await expect(panel).toContainText('Print metadata');
  await expect(panel).toContainText('Chỉ cảnh báo/đánh giá, chưa chặn workflow.');
  await expect(page.getByRole('button', { name: 'Cập nhật' })).toBeVisible();
});
