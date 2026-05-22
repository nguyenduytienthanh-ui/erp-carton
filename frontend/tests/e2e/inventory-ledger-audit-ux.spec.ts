import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

test.use({ channel: 'msedge', video: 'off' });

const warehouse = { id: 1, code: 'WH-A', name: 'Kho A' };
const product = { id: 10, code: 'P-AUDIT', name: 'San pham audit' };

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function chooseVisibleAntdOptionByLabel(page: Page, trigger: Locator, label: string) {
  await trigger.click({ force: true });
  const option = page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: label }).last();
  await expect(option).toBeVisible();
  await option.evaluate((element) => element.scrollIntoView({ block: 'nearest' }));
  const box = await option.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
}

async function setupMockApi(page: Page) {
  const transactionUrls: string[] = [];
  const nxtUrls: string[] = [];

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

    if (path === '/api/inventory/warehouses/' && method === 'GET') {
      return json(route, { count: 1, next: null, previous: null, results: [warehouse] });
    }

    if (path === '/api/products/products/' && method === 'GET') {
      return json(route, { count: 1, next: null, previous: null, results: [product] });
    }

    if (path === '/api/inventory/transactions/nxt_report/' && method === 'GET') {
      nxtUrls.push(url.toString());
      return json(route, {
        date_from: url.searchParams.get('date_from') ?? '2026-05-01',
        date_to: url.searchParams.get('date_to') ?? '2026-05-31',
        results: [
          {
            product_id: product.id,
            product_code: product.code,
            product_name: product.name,
            warehouse_id: warehouse.id,
            warehouse_code: warehouse.code,
            warehouse_name: warehouse.name,
            opening_qty: '10',
            in_qty: '4',
            out_qty: '6',
            closing_qty: '8',
          },
        ],
      });
    }

    if (path === '/api/inventory/transactions/' && method === 'GET') {
      transactionUrls.push(url.toString());
      return json(route, {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: 101,
            code: 'INVTX-AUDIT-001',
            transaction_type: 'ADJUSTMENT_IN',
            status: 'POSTED',
            transaction_date: '2026-05-15',
            reference: 'STKT-AUDIT',
            reason: 'Kiem ton',
            note: 'Audit note',
            product: product.id,
            product_code: product.code,
            product_name: product.name,
            warehouse: warehouse.id,
            warehouse_name: warehouse.name,
            location: null,
            location_name: null,
            target_warehouse: null,
            target_warehouse_name: null,
            target_location: null,
            target_location_name: null,
            quantity: '4',
            unit_cost: '0',
            amount: '0.00',
            sales_order: null,
            sales_order_code: null,
            sales_order_line: null,
            reservation: null,
            reservation_code: null,
            shipment_batch: null,
            shipment_batch_code: null,
            stocktake: 501,
            stocktake_code: 'STKT-AUDIT',
            stocktake_line: 502,
            stocktake_line_number: 1,
            posted_at: '2026-05-15T08:00:00Z',
            posted_by: 1,
            cancelled_at: null,
            cancelled_by: null,
            cancel_reason: '',
            created_at: '2026-05-15T08:00:00Z',
            updated_at: '2026-05-15T08:00:00Z',
          },
        ],
      });
    }

    if (method === 'GET') {
      return json(route, { count: 0, next: null, previous: null, results: [] });
    }
    return json(route, {});
  });

  return { transactionUrls, nxtUrls };
}

test('inventory ledger exposes audit filters and NXT panel', async ({ page }) => {
  const state = await setupMockApi(page);

  await page.goto('/inventory-transactions');
  await expect(page.getByTestId('inventory-transactions-command-strip')).toBeVisible();
  await expect(page.getByTestId('inventory-nxt-panel')).toBeVisible();
  await expect(page.getByText('INVTX-AUDIT-001')).toBeVisible();
  await expect(page.getByText('STKT-AUDIT').first()).toBeVisible();
  await expect(page.getByTestId('inventory-nxt-table')).toContainText('P-AUDIT');
  await expect(page.getByTestId('inventory-transactions-export-csv')).toBeEnabled();
  await expect(page.getByTestId('inventory-nxt-export-csv')).toBeEnabled();

  await page.getByTestId('inventory-transactions-date-from').fill('2026-05-01');
  await page.getByTestId('inventory-transactions-date-to').fill('2026-05-31');
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('inventory-transactions-source-filter').locator('.ant-select'),
    'Kiểm tồn',
  );

  await expect.poll(() => state.transactionUrls.some((item) => item.includes('transaction_date__gte=2026-05-01'))).toBe(true);
  await expect.poll(() => state.transactionUrls.some((item) => item.includes('source_type=STOCKTAKE'))).toBe(true);

  await page.getByTestId('inventory-nxt-date-from').fill('2026-05-01');
  await page.getByTestId('inventory-nxt-date-to').fill('2026-05-31');
  await expect.poll(() => state.nxtUrls.some((item) => item.includes('date_from=2026-05-01'))).toBe(true);
});
