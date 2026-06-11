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
  await sizeRowSelects.nth(2).selectOption('1');

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
