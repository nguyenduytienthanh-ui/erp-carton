import { expect, test, type Page, type Route } from '@playwright/test';

test.use({ channel: 'msedge', video: 'off' });

type StocktakeStatus = 'DRAFT' | 'COMPLETED' | 'CANCELLED';
type AdjustmentLineStatus = 'READY' | 'SKIPPED' | 'BLOCKED';
type AdjustmentType = 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';

type StocktakeLine = {
  id: number;
  stocktake: number;
  product: number;
  product_code: string;
  product_name: string;
  warehouse: number;
  line_number: number;
  system_qty: string;
  count_qty: string;
  variance_qty: string;
  note: string;
};

type StocktakeRecord = {
  id: number;
  code: string;
  warehouse: number;
  warehouse_name: string;
  count_date: string;
  status: StocktakeStatus;
  note: string;
  created_at: string;
  updated_at: string;
  adjustment_posted_at?: string | null;
  adjustment_posted_by?: number | null;
  lines: StocktakeLine[];
};

type AdjustmentPreviewLine = {
  line_id: number;
  line_number: number;
  product: number;
  product_code: string;
  product_name: string;
  warehouse: number;
  warehouse_code: string;
  warehouse_name: string;
  system_qty: string;
  count_qty: string;
  variance_qty: string;
  status: AdjustmentLineStatus;
  adjustment_type: AdjustmentType | null;
  adjustment_qty: string;
  blocked_reason: string | Record<string, unknown>;
};

type AdjustmentPreview = {
  stocktake: number;
  stocktake_code: string;
  status: StocktakeStatus | 'POSTED';
  adjustment_posted_at?: string | null;
  adjustment_posted_by?: number | null;
  can_post: boolean;
  total_in_lines: number;
  total_out_lines: number;
  skipped_zero_lines: number;
  blocked_lines: number;
  transaction_count: number;
  transaction_ids?: number[];
  lines: AdjustmentPreviewLine[];
};

type MockState = {
  postPayloads: Array<{ reason?: string }>;
};

const warehouse = { id: 1, code: 'WH-A', name: 'Main warehouse' };

function stocktakeLine(
  stocktake: number,
  line_number: number,
  product_code: string,
  system_qty: string,
  count_qty: string,
  variance_qty: string
): StocktakeLine {
  return {
    id: Number(`${stocktake}${line_number}`),
    stocktake,
    product: Number(`${stocktake}${line_number}`),
    product_code,
    product_name: `Product ${product_code}`,
    warehouse: warehouse.id,
    line_number,
    system_qty,
    count_qty,
    variance_qty,
    note: '',
  };
}

function makeStocktake(
  id: number,
  code: string,
  status: StocktakeStatus,
  lines: StocktakeLine[],
  adjustment_posted_at: string | null = null
): StocktakeRecord {
  return {
    id,
    code,
    warehouse: warehouse.id,
    warehouse_name: warehouse.name,
    count_date: '2026-05-14',
    status,
    note: code,
    created_at: '2026-05-14T08:00:00Z',
    updated_at: '2026-05-14T08:00:00Z',
    adjustment_posted_at,
    adjustment_posted_by: adjustment_posted_at ? 1 : null,
    lines,
  };
}

function previewLine(line: StocktakeLine, status: AdjustmentLineStatus, adjustment_type: AdjustmentType | null, adjustment_qty: string, blocked_reason: AdjustmentPreviewLine['blocked_reason'] = ''): AdjustmentPreviewLine {
  return {
    line_id: line.id,
    line_number: line.line_number,
    product: line.product,
    product_code: line.product_code,
    product_name: line.product_name,
    warehouse: warehouse.id,
    warehouse_code: warehouse.code,
    warehouse_name: warehouse.name,
    system_qty: line.system_qty,
    count_qty: line.count_qty,
    variance_qty: line.variance_qty,
    status,
    adjustment_type,
    adjustment_qty,
    blocked_reason,
  };
}

const draftStocktake = makeStocktake(101, 'ST-DRAFT', 'DRAFT', [
  stocktakeLine(101, 1, 'P-DRAFT', '10', '12', '2'),
]);

const completedStocktake = makeStocktake(102, 'ST-COMPLETE', 'COMPLETED', [
  stocktakeLine(102, 1, 'P-IN', '10', '15', '5'),
  stocktakeLine(102, 2, 'P-OUT', '9', '7', '-2'),
  stocktakeLine(102, 3, 'P-ZERO', '3', '3', '0'),
]);

const blockedStocktake = makeStocktake(103, 'ST-BLOCK', 'COMPLETED', [
  stocktakeLine(103, 1, 'P-BLOCK', '1', '4', '3'),
]);

const postedStocktake = makeStocktake(104, 'ST-POSTED', 'COMPLETED', [
  stocktakeLine(104, 1, 'P-POSTED', '1', '2', '1'),
], '2026-05-14T09:30:00Z');

const completedPreview: AdjustmentPreview = {
  stocktake: completedStocktake.id,
  stocktake_code: completedStocktake.code,
  status: 'COMPLETED',
  can_post: true,
  total_in_lines: 1,
  total_out_lines: 1,
  skipped_zero_lines: 1,
  blocked_lines: 0,
  transaction_count: 2,
  lines: [
    previewLine(completedStocktake.lines[0], 'READY', 'ADJUSTMENT_IN', '5'),
    previewLine(completedStocktake.lines[1], 'READY', 'ADJUSTMENT_OUT', '2'),
    previewLine(completedStocktake.lines[2], 'SKIPPED', null, '0'),
  ],
};

const blockedPreview: AdjustmentPreview = {
  stocktake: blockedStocktake.id,
  stocktake_code: blockedStocktake.code,
  status: 'COMPLETED',
  can_post: false,
  total_in_lines: 0,
  total_out_lines: 0,
  skipped_zero_lines: 0,
  blocked_lines: 1,
  transaction_count: 0,
  lines: [
    previewLine(blockedStocktake.lines[0], 'BLOCKED', 'ADJUSTMENT_IN', '3', { warehouse: ['blocked in mock'] }),
  ],
};

const postedPreview: AdjustmentPreview = {
  ...completedPreview,
  stocktake: postedStocktake.id,
  stocktake_code: postedStocktake.code,
  status: 'POSTED',
  adjustment_posted_at: postedStocktake.adjustment_posted_at,
  adjustment_posted_by: 1,
  can_post: false,
  transaction_ids: [9001, 9002],
  lines: [previewLine(postedStocktake.lines[0], 'READY', 'ADJUSTMENT_IN', '1')],
};

const allStocktakes = [draftStocktake, completedStocktake, blockedStocktake, postedStocktake];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function setupMockApi(page: Page, stocktakes: StocktakeRecord[] = allStocktakes): Promise<MockState> {
  const state: MockState = { postPayloads: [] };
  const stocktakeMap = new Map(stocktakes.map((item) => [item.id, item]));

  await page.addInitScript(() => {
    window.localStorage.setItem('access_token', 'mock-access-token');
    window.localStorage.setItem(
      'user',
      JSON.stringify({ username: 'uat_admin', is_staff: true, is_superuser: true, roles: [] })
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
        email: 'admin@example.test',
        first_name: 'UAT',
        last_name: 'Admin',
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

    if (path === '/api/inventory/stocktakes/' && method === 'GET') {
      return json(route, { count: stocktakes.length, next: null, previous: null, results: stocktakes });
    }

    const previewMatch = path.match(/^\/api\/inventory\/stocktakes\/(\d+)\/preview_adjustments\/$/);
    if (previewMatch && method === 'POST') {
      const id = Number(previewMatch[1]);
      if (id === completedStocktake.id) return json(route, completedPreview);
      if (id === blockedStocktake.id) return json(route, blockedPreview);
      if (id === postedStocktake.id) return json(route, postedPreview);
      return json(route, { status: ['Only completed stocktakes can be previewed.'] }, 400);
    }

    const postMatch = path.match(/^\/api\/inventory\/stocktakes\/(\d+)\/post_adjustments\/$/);
    if (postMatch && method === 'POST') {
      state.postPayloads.push(request.postDataJSON() as { reason?: string });
      const id = Number(postMatch[1]);
      if (id !== completedStocktake.id) return json(route, { detail: 'blocked in mock' }, 400);
      return json(route, {
        ...completedPreview,
        status: 'POSTED',
        adjustment_posted_at: '2026-05-14T10:00:00Z',
        adjustment_posted_by: 1,
        transaction_ids: [501, 502],
      });
    }

    const detailMatch = path.match(/^\/api\/inventory\/stocktakes\/(\d+)\/$/);
    if (detailMatch && method === 'GET') {
      const item = stocktakeMap.get(Number(detailMatch[1]));
      return json(route, item ?? { detail: 'Not found' }, item ? 200 : 404);
    }

    if (method === 'GET') {
      return json(route, { count: 0, next: null, previous: null, results: [] });
    }
    return json(route, {});
  });

  return state;
}

async function openStocktake(page: Page, code: string) {
  await page.goto('/stocktakes');
  await expect(page.getByTestId('stocktakes-command-strip')).toBeVisible();
  const row = page.locator('.ant-table-tbody tr').filter({ hasText: code }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByTestId('stocktake-adjustment-panel')).toBeVisible();
}

test('draft stocktake keeps adjustment posting unavailable', async ({ page }) => {
  await setupMockApi(page);

  await openStocktake(page, draftStocktake.code);

  await expect(page.getByTestId('stocktake-adjustment-draft-alert')).toBeVisible();
  await expect(page.getByTestId('stocktake-preview-adjustments')).toHaveCount(0);
  await expect(page.getByTestId('stocktake-post-adjustments')).toHaveCount(0);
  await expect(page.getByTestId(`stocktake-complete-${draftStocktake.id}`)).toBeVisible();
  await expect(page.getByTestId(`stocktake-complete-${draftStocktake.id}`)).toContainText('Hoàn tất kiểm kê');
});

test('completed stocktake previews adjustment ledger and posts trimmed reason', async ({ page }) => {
  const state = await setupMockApi(page);

  await openStocktake(page, completedStocktake.code);
  await expect(page.getByTestId('stocktake-adjustment-ready-alert')).toBeVisible();

  await page.getByTestId('stocktake-preview-adjustments').click();
  await expect(page.getByTestId('stocktake-adjustment-preview')).toBeVisible();
  await expect(page.getByTestId('stocktake-adjustment-summary')).toContainText('Tăng: 1');
  await expect(page.getByTestId('stocktake-adjustment-summary')).toContainText('Giảm: 1');
  await expect(page.getByTestId('stocktake-adjustment-summary')).toContainText('Bỏ qua: 1');
  await expect(page.getByTestId('stocktake-adjustment-summary')).toContainText('Bị chặn: 0');
  await expect(page.getByTestId('stocktake-adjustment-preview-table')).toContainText('P-IN');
  await expect(page.getByTestId('stocktake-adjustment-preview-table')).toContainText('P-OUT');
  await expect(page.getByTestId('stocktake-adjustment-preview-table')).toContainText('P-ZERO');

  await expect(page.getByTestId('stocktake-post-adjustments')).toBeEnabled();
  await page.getByTestId('stocktake-post-adjustments').click();
  await expect(page.getByTestId('stocktake-confirm-post-adjustments')).toBeDisabled();
  await page.getByTestId('stocktake-adjustment-reason').fill('   ');
  await expect(page.getByTestId('stocktake-confirm-post-adjustments')).toBeDisabled();
  await page.getByTestId('stocktake-adjustment-reason').fill('  Cycle count correction  ');
  await expect(page.getByTestId('stocktake-confirm-post-adjustments')).toBeEnabled();
  await page.getByTestId('stocktake-confirm-post-adjustments').click();

  await expect.poll(() => state.postPayloads.length).toBe(1);
  expect(state.postPayloads[0]).toEqual({ reason: 'Cycle count correction' });
  await expect(page.getByTestId('stocktake-adjustment-posted-status')).toBeVisible();
  await expect(page.getByTestId('stocktake-post-adjustments')).toBeDisabled();
});

test('blocked preview prevents posting', async ({ page }) => {
  await setupMockApi(page);

  await openStocktake(page, blockedStocktake.code);
  await page.getByTestId('stocktake-preview-adjustments').click();

  await expect(page.getByTestId('stocktake-adjustment-blocker-alert')).toBeVisible();
  await expect(page.getByTestId('stocktake-adjustment-preview-table')).toContainText('P-BLOCK');
  await expect(page.getByTestId('stocktake-post-adjustments')).toBeDisabled();
});

test('already posted stocktake disables repeat adjustment posting', async ({ page }) => {
  await setupMockApi(page);

  await openStocktake(page, postedStocktake.code);

  await expect(page.getByTestId('stocktake-adjustment-posted-status')).toBeVisible();
  await expect(page.getByTestId('stocktake-preview-adjustments')).toBeDisabled();
  await expect(page.getByTestId('stocktake-post-adjustments')).toBeDisabled();
});

test('empty stocktake list renders without crashing', async ({ page }) => {
  await setupMockApi(page, []);

  await page.goto('/stocktakes');

  await expect(page.getByTestId('stocktakes-command-strip')).toBeVisible();
  await expect(page.locator('.ant-table-placeholder')).toBeVisible();
  await expect(page.getByTestId('stocktake-adjustment-panel')).toHaveCount(0);
});
