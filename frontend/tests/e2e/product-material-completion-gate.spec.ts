import { expect, test, type Page, type Route } from '@playwright/test';

test.use({ channel: 'msedge', video: 'off' });

type ProductRow = {
  id: number;
  code: string;
  name: string;
  category: number | null;
  category_name: string;
  unit: number;
  unit_name: string;
  item_type: 'general' | 'finished_good' | 'semi_finished' | 'raw_material' | 'accessory' | 'service';
  product_kind: 'SPECIFIC' | 'GENERIC';
  cost_price: string;
  sale_price: string;
  status: 'DRAFT' | 'ACTIVE' | 'DISCONTINUED';
  is_active: boolean;
  parent: number | null;
  components: ProductRow[];
  created_at: string;
  updated_at: string;
};

type ApiLog = {
  productListUrls: string[];
  createPayloads: Record<string, unknown>[];
};

const paginated = <T,>(results: T[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

const baseProduct = (patch: Partial<ProductRow> = {}): ProductRow => ({
  id: 1001,
  code: 'P-UAT-001',
  name: 'Owner UAT carton',
  category: 1,
  category_name: 'Carton',
  unit: 1,
  unit_name: 'Cai',
  item_type: 'finished_good',
  product_kind: 'SPECIFIC',
  cost_price: '1000',
  sale_price: '1500',
  status: 'ACTIVE',
  is_active: true,
  parent: null,
  components: [],
  created_at: '2026-06-11T00:00:00Z',
  updated_at: '2026-06-11T00:00:00Z',
  ...patch,
});

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function setupProductModuleMock(page: Page, seedProducts: ProductRow[] = []) {
  const products = [...seedProducts];
  const log: ApiLog = {
    productListUrls: [],
    createPayloads: [],
  };

  await page.addInitScript(() => {
    window.localStorage.setItem('access_token', 'mock-access-token');
    window.localStorage.setItem(
      'user',
      JSON.stringify({ username: 'uat_admin', is_staff: true, is_superuser: true, roles: [] }),
    );
  });

  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const currentUrl = new URL(request.url());
    const path = currentUrl.pathname;
    const method = request.method();

    if (path === '/api/users/me/' && method === 'GET') {
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
    if (path === '/api/notifications/unread_count/' && method === 'GET') return json(route, { count: 0 });
    if (path === '/api/activity/operations_live_updates/' && method === 'GET') {
      return json(route, { has_changes: false, latest_at: null, server_time: '2026-06-11T00:00:00Z', changed_count: 0 });
    }

    if (path === '/api/products/categories/' && method === 'GET') {
      return json(route, paginated([{ id: 1, code: 'CARTON', name: 'Carton', is_active: true }]));
    }

    if (path === '/api/products/units/' && method === 'GET') {
      return json(route, paginated([{ id: 1, code: 'CAI', name: 'Cai', is_active: true }]));
    }

    if (path === '/api/products/waves/' && method === 'GET') {
      return json(route, paginated([{ id: 1, code: 'BC', name: 'BC', is_active: true }]));
    }

    if (path === '/api/products/box-types/' && method === 'GET') {
      return json(route, paginated([{ id: 1, code: 'A1', name: 'A1', is_active: true }]));
    }

    const readinessMatch = path.match(/^\/api\/products\/products\/(\d+)\/readiness\/$/);
    if (readinessMatch && method === 'GET') {
      const productId = Number(readinessMatch[1]);
      const product = products.find((item) => item.id === productId);
      return json(route, {
        product_id: productId,
        product_code: product?.code ?? '',
        product_name: product?.name ?? '',
        status: 'BLOCKER',
        is_ready: false,
        workflow_blocking: false,
        summary: {
          blocker_count: 1,
          warning_count: 1,
          issue_count: 2,
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
            message: 'Missing routing for production readiness.',
            workflow_blocking: false,
            details: {},
          },
        ],
        rules: { workflow_enforced: false },
      });
    }

    const detailMatch = path.match(/^\/api\/products\/products\/(\d+)\/$/);
    if (detailMatch && method === 'GET') {
      const productId = Number(detailMatch[1]);
      const product = products.find((item) => item.id === productId);
      return product ? json(route, product) : json(route, { detail: 'Not found' }, 404);
    }

    if (path === '/api/products/products/' && method === 'GET') {
      log.productListUrls.push(request.url());
      const search = (currentUrl.searchParams.get('search') || currentUrl.searchParams.get('q') || '').toLowerCase();
      const itemType = currentUrl.searchParams.get('item_type');
      const searchedRows = search
        ? products.filter((product) => `${product.code} ${product.name}`.toLowerCase().includes(search))
        : products;
      const rows = itemType
        ? searchedRows.filter((product) => product.item_type === itemType)
        : searchedRows;
      return json(route, paginated(rows));
    }

    if (path === '/api/products/products/' && method === 'POST') {
      const payload = request.postDataJSON() as Record<string, unknown>;
      log.createPayloads.push(payload);
      const created = baseProduct({
        id: 2001,
        code: String(payload.code || 'P-UAT-NEW'),
        name: String(payload.name || 'Owner UAT new'),
        unit: Number(payload.unit || 1),
        category: typeof payload.category === 'number' ? payload.category : null,
        item_type: typeof payload.item_type === 'string' ? (payload.item_type as ProductRow['item_type']) : 'general',
        cost_price: String(payload.cost_price ?? '0'),
        sale_price: String(payload.sale_price ?? '0'),
        product_kind: payload.product_kind === 'GENERIC' ? 'GENERIC' : 'SPECIFIC',
      });
      products.push(created);
      return json(route, created, 201);
    }

    if (method === 'GET') return json(route, paginated([]));
    return json(route, {});
  });

  return log;
}

const productTableHeaderLabels = [
  'M\u00e3 h\u00e0ng',
  'T\u00ean h\u00e0ng',
  'Lo\u1ea1i item',
  'Danh m\u1ee5c',
  '\u0110VT',
  'Quy c\u00e1ch',
  'Gi\u00e1 v\u1ed1n',
  '\u0110\u01a1n gi\u00e1',
  'Tr\u1ea1ng th\u00e1i',
  'Thao t\u00e1c',
];

async function expectProductTableHeadersReadable(page: Page) {
  const header = page.locator('.enterprise-data-table .ant-table-thead').first();
  await expect(header).toBeVisible();
  for (const label of productTableHeaderLabels) {
    await expect(header).toContainText(label);
  }

  const unreadableLabels = await page.evaluate((labels) => {
    const normalize = (value: string | null | undefined) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element: Element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const cells = Array.from(document.querySelectorAll('.enterprise-data-table .ant-table-thead th'));

    return labels.flatMap((label) => {
      const candidates = cells.filter((cell) => normalize(cell.textContent).includes(label));
      if (candidates.length === 0) return [`${label}: missing`];

      const readable = candidates.some((cell) => {
        const title = cell.querySelector('.ant-table-column-title') || cell;
        const cellRect = cell.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const minWidth = label === '\u0110VT' ? 16 : 24;
        const x = titleRect.left + titleRect.width / 2;
        const y = titleRect.top + titleRect.height / 2;
        const centerInViewport = x >= 0 && x < window.innerWidth && y >= 0 && y < window.innerHeight;
        const topElement = centerInViewport ? document.elementFromPoint(x, y) : null;
        const covered = topElement
          ? !(cell === topElement || cell.contains(topElement) || topElement.contains(cell))
          : false;
        return (
          visible(cell) &&
          visible(title) &&
          cellRect.width >= minWidth &&
          cellRect.height >= 24 &&
          titleRect.width >= minWidth &&
          titleRect.height >= 12 &&
          !covered
        );
      });

      return readable ? [] : [`${label}: unreadable`];
    });
  }, productTableHeaderLabels);

  expect(unreadableLabels).toEqual([]);
}

test('product material owner path covers empty state create validation and save payload', async ({ page }) => {
  const apiLog = await setupProductModuleMock(page);

  await page.goto('/products');
  await expect(page.locator('.ant-empty')).toBeVisible();
  await expect(page.locator('.ant-empty .ant-btn-primary')).toBeVisible();

  await page.locator('.ant-empty .ant-btn-primary').click();
  const modal = page.locator('.ant-modal').filter({ has: page.locator('.pf-container') }).first();
  await expect(modal).toBeVisible();

  await modal.locator('.pf-footer .ant-btn-primary').click();
  await expect(modal.locator('.ant-alert-error')).toBeVisible();
  await expect(modal.locator('.ant-alert-error')).toContainText('Mã');
  expect(apiLog.createPayloads).toHaveLength(0);

  const priceRowInputs = modal.locator('.pf-section-mother .pf-row-price input.pf-input');
  await priceRowInputs.nth(0).fill('P-UAT-001');
  await priceRowInputs.nth(1).fill('Owner UAT carton');
  await priceRowInputs.nth(2).fill('1000');
  await priceRowInputs.nth(3).fill('1500');
  await modal.getByTestId('product-item-type-select').selectOption('finished_good');
  await expect(modal.getByText(/nên nhập quy cách/i)).toBeVisible();

  const sizeRowSelects = modal.locator('.pf-section-mother .pf-row-size select.pf-select');
  await sizeRowSelects.nth(0).selectOption('1');
  await sizeRowSelects.nth(1).selectOption('1');

  await modal.locator('.pf-footer .ant-btn-primary').click();
  await expect(modal).toBeHidden();
  expect(apiLog.createPayloads).toHaveLength(1);
  expect(apiLog.createPayloads[0]).toMatchObject({
    code: 'P-UAT-001',
    name: 'Owner UAT carton',
    unit: 1,
    item_type: 'finished_good',
    wave: 1,
    box_type: 1,
    product_kind: 'SPECIFIC',
    status: 'ACTIVE',
  });
  await expect(page.getByText('P-UAT-001').first()).toBeVisible();
  await expect(page.getByText('Thành phẩm carton').first()).toBeVisible();
});

test('product material list search sends the backend query contract', async ({ page }) => {
  const apiLog = await setupProductModuleMock(page, [baseProduct()]);

  await page.goto('/products?item_type=finished_good&activeFilters=item_type');
  await expect(page.getByText('P-UAT-001').first()).toBeVisible();

  await expect.poll(() => {
    return apiLog.productListUrls
      .map((rawUrl) => new URL(rawUrl))
      .some((url) => url.searchParams.get('item_type') === 'finished_good');
  }).toBe(true);

  await page.locator('.list-page-toolbar input[type="text"]').first().fill('P-UAT-001');

  await expect.poll(() => {
    const searchedRequest = apiLog.productListUrls
      .map((rawUrl) => new URL(rawUrl))
      .find((url) => url.searchParams.get('search') === 'P-UAT-001');
    return searchedRequest?.searchParams.get('q') ?? null;
  }).toBe('P-UAT-001');
});

test('product material item type filter and raw material form readiness stay visually scoped', async ({ page }) => {
  const apiLog = await setupProductModuleMock(page, [
    baseProduct({
      id: 3001,
      code: 'UAT-FG-001',
      name: 'UAT finished carton',
      item_type: 'finished_good',
    }),
    baseProduct({
      id: 3002,
      code: 'UAT-RM-001',
      name: 'UAT raw material',
      item_type: 'raw_material',
    }),
  ]);

  await page.goto('/products?q=UAT&pageSize=50');
  await expectProductTableHeadersReadable(page);

  await page.goto('/products?q=UAT&item_type=finished_good&activeFilters=item_type&pageSize=50');
  const table = page.locator('.ant-table-tbody');
  await expect.poll(() => new URL(page.url()).searchParams.get('item_type')).toBe('finished_good');
  await expect(table.getByText('UAT-FG-001')).toBeVisible();
  await expect(table.getByText('UAT-RM-001')).toHaveCount(0);

  await expect.poll(() => {
    return apiLog.productListUrls
      .map((rawUrl) => new URL(rawUrl))
      .some((url) => url.searchParams.get('item_type') === 'finished_good');
  }).toBe(true);

  await page.goto('/products?q=UAT&item_type=raw_material&activeFilters=item_type&pageSize=50');
  await expect.poll(() => new URL(page.url()).searchParams.get('item_type')).toBe('raw_material');
  await expect(table.getByText('UAT-RM-001')).toBeVisible();
  await expect(table.getByText('UAT-FG-001')).toHaveCount(0);

  await expect.poll(() => {
    return apiLog.productListUrls
      .map((rawUrl) => new URL(rawUrl))
      .some((url) => url.searchParams.get('item_type') === 'raw_material');
  }).toBe(true);

  await table.getByText('UAT-RM-001', { exact: true }).click();
  const modal = page.locator('.ant-modal').filter({ has: page.locator('.pf-container') }).first();
  await expect(modal).toBeVisible();
  await expect(modal.getByTestId('product-non-production-readiness-note')).toBeVisible();
  await expect(modal.getByTestId('product-readiness-panel')).toHaveCount(0);
});
