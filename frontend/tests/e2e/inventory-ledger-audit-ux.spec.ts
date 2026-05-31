import { readFile } from 'node:fs/promises';

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
  const option = page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: label }).first();
  await expect(option).toBeVisible();
  await option.click({ force: true });
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
            in_qty: '14',
            out_qty: '6',
            closing_qty: '18',
            source_breakdown: {
              PURCHASE: {
                source_type: 'PURCHASE',
                source_label: 'Mua hàng',
                in_qty: '5',
                out_qty: '0',
                net_qty: '5',
                count: 1,
                source_document_types: { PURCHASE_RECEIPT: 1 },
                source_warnings: {},
              },
              PRODUCTION: {
                source_type: 'PRODUCTION',
                source_label: 'Sản xuất',
                in_qty: '3',
                out_qty: '2',
                net_qty: '1',
                count: 2,
                source_document_types: { PRODUCTION_ISSUE: 1, PRODUCTION_RECEIPT: 1 },
                source_warnings: { PRODUCTION_REFERENCE_ONLY: 1 },
              },
              STOCKTAKE: {
                source_type: 'STOCKTAKE',
                source_label: 'Kiểm tồn',
                in_qty: '0',
                out_qty: '1',
                net_qty: '-1',
                count: 1,
                source_document_types: { STOCKTAKE: 1 },
                source_warnings: {},
              },
              TRANSFER: {
                source_type: 'TRANSFER',
                source_label: 'Chuyển kho',
                in_qty: '4',
                out_qty: '3',
                net_qty: '1',
                count: 2,
                source_document_types: { TRANSFER_TRANSACTION: 1, WAREHOUSE_TRANSFER_REFERENCE: 1 },
                source_warnings: { TRANSFER_REFERENCE_ONLY: 1 },
              },
              MANUAL: {
                source_type: 'MANUAL',
                source_label: 'Thủ công',
                in_qty: '2',
                out_qty: '0',
                net_qty: '2',
                count: 1,
                source_document_types: { MANUAL: 1 },
                source_warnings: {},
              },
            },
            source_document_types: {
              PURCHASE_RECEIPT: 1,
              PRODUCTION_ISSUE: 1,
              PRODUCTION_RECEIPT: 1,
              STOCKTAKE: 1,
              TRANSFER_TRANSACTION: 1,
              WAREHOUSE_TRANSFER_REFERENCE: 1,
              MANUAL: 1,
            },
            source_warnings: {
              PRODUCTION_REFERENCE_ONLY: 1,
              TRANSFER_REFERENCE_ONLY: 1,
            },
          },
        ],
      });
    }

    if (path === '/api/inventory/transactions/' && method === 'GET') {
      transactionUrls.push(url.toString());
      return json(route, {
        count: 3,
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
            source_type: 'STOCKTAKE',
            source_label: 'Kiểm tồn',
            source_code: 'STKT-AUDIT',
            source_document_type: 'STOCKTAKE',
            source_warnings: [],
            source_audit: {
              type: 'STOCKTAKE',
              label: 'Kiểm tồn',
              document_type: 'STOCKTAKE',
              code: 'STKT-AUDIT',
              reference: 'STKT-AUDIT',
              warning_flags: [],
              related: { stocktake_id: 501, stocktake_code: 'STKT-AUDIT' },
            },
            posted_at: '2026-05-15T08:00:00Z',
            posted_by: 1,
            cancelled_at: null,
            cancelled_by: null,
            cancel_reason: '',
            created_at: '2026-05-15T08:00:00Z',
            updated_at: '2026-05-15T08:00:00Z',
          },
          {
            id: 102,
            code: 'INVTX-PURCHASE-001',
            transaction_type: 'RECEIPT',
            status: 'POSTED',
            transaction_date: '2026-05-16',
            reference: 'GRN-AUDIT-001',
            reason: 'Nhap mua hang',
            note: '',
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
            quantity: '5',
            unit_cost: '0',
            amount: '0.00',
            purchase_order: 201,
            purchase_order_code: 'PO-AUDIT-001',
            purchase_order_line: null,
            purchase_receipt: 202,
            purchase_receipt_code: 'GRN-AUDIT-001',
            source_type: 'PURCHASE',
            source_label: 'Mua hàng',
            source_code: 'GRN-AUDIT-001',
            source_document_type: 'PURCHASE_RECEIPT',
            source_warnings: [],
            source_audit: {
              type: 'PURCHASE',
              label: 'Mua hàng',
              document_type: 'PURCHASE_RECEIPT',
              code: 'GRN-AUDIT-001',
              reference: 'GRN-AUDIT-001',
              warning_flags: [],
              related: { purchase_order_id: 201, purchase_order_code: 'PO-AUDIT-001', purchase_receipt_id: 202, purchase_receipt_code: 'GRN-AUDIT-001' },
            },
            posted_at: '2026-05-16T08:00:00Z',
            posted_by: 1,
            cancelled_at: null,
            cancelled_by: null,
            cancel_reason: '',
            created_at: '2026-05-16T08:00:00Z',
            updated_at: '2026-05-16T08:00:00Z',
          },
          {
            id: 103,
            code: 'INVTX-PROD-ISSUE-001',
            transaction_type: 'ISSUE',
            status: 'POSTED',
            transaction_date: '2026-05-17',
            reference: 'PMI-AUDIT-001',
            reason: 'Cap vat tu san xuat',
            note: '',
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
            quantity: '2',
            unit_cost: '0',
            amount: '0.00',
            production_order: 301,
            production_order_code: 'MO-AUDIT-001',
            production_issue: 302,
            production_issue_code: 'PMI-AUDIT-001',
            production_receipt: null,
            production_receipt_code: null,
            source_type: 'PRODUCTION',
            source_label: 'Sản xuất',
            source_code: 'PMI-AUDIT-001',
            source_document_type: 'PRODUCTION_ISSUE',
            source_warnings: ['PRODUCTION_REFERENCE_ONLY'],
            source_audit: {
              type: 'PRODUCTION',
              label: 'Sản xuất',
              document_type: 'PRODUCTION_ISSUE',
              code: 'PMI-AUDIT-001',
              reference: 'PMI-AUDIT-001',
              warning_flags: ['PRODUCTION_REFERENCE_ONLY'],
              related: { production_order_id: 301, production_order_code: 'MO-AUDIT-001', production_issue_id: 302, production_issue_code: 'PMI-AUDIT-001' },
            },
            posted_at: '2026-05-17T08:00:00Z',
            posted_by: 1,
            cancelled_at: null,
            cancelled_by: null,
            cancel_reason: '',
            created_at: '2026-05-17T08:00:00Z',
            updated_at: '2026-05-17T08:00:00Z',
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
  await expect(page.getByText('INVTX-PURCHASE-001')).toBeVisible();
  await expect(page.getByText('INVTX-PROD-ISSUE-001')).toBeVisible();
  await expect(page.getByText('STKT-AUDIT').first()).toBeVisible();
  await expect(page.getByTestId('inventory-source-audit-102')).toContainText('Mua hàng');
  await expect(page.getByTestId('inventory-source-audit-102')).toContainText('Phiếu nhập mua');
  await expect(page.getByTestId('inventory-source-audit-103')).toContainText('Sản xuất');
  await expect(page.getByTestId('inventory-source-audit-103')).toContainText('Nhận diện từ tham chiếu');
  await expect(page.getByTestId('inventory-nxt-table')).toContainText('P-AUDIT');
  await expect(page.getByTestId('inventory-nxt-table')).toContainText('14');
  await expect(page.getByTestId('inventory-nxt-table')).toContainText('18');
  const nxtBreakdown = page.getByTestId('inventory-nxt-source-breakdown-10-1');
  await expect(nxtBreakdown).toContainText('Mua hàng: +5');
  await expect(nxtBreakdown).toContainText('Sản xuất: +3 / -2');
  await expect(nxtBreakdown).toContainText('Kiểm tồn: +0 / -1');
  await expect(nxtBreakdown).toContainText('Chuyển kho: +4 / -3');
  await expect(nxtBreakdown).toContainText('Thủ công: +2');
  await expect(page.getByTestId('inventory-nxt-source-documents-10-1')).toContainText('Phiếu nhập mua');
  await expect(page.getByTestId('inventory-nxt-source-documents-10-1')).toContainText('Nhập thành phẩm');
  await expect(page.getByTestId('inventory-nxt-source-warnings-10-1')).toContainText('Nhận diện từ tham chiếu');
  await expect(page.getByTestId('inventory-transactions-export-csv')).toBeEnabled();
  await expect(page.getByTestId('inventory-nxt-export-csv')).toBeEnabled();

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('inventory-nxt-export-csv').click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const csv = await readFile(downloadPath as string, 'utf-8');
  expect(csv).toContain('Mua hàng - Nhập');
  expect(csv).toContain('Sản xuất - Xuất');
  expect(csv).toContain('Kiểm tồn - Net');
  expect(csv).toContain('Chuyển kho - Số GD');
  expect(csv).toContain('Thủ công - Nhập');
  expect(csv).toContain('Cảnh báo nguồn');
  expect(csv).toContain('Loại chứng từ nguồn');

  await page.getByTestId('inventory-transactions-date-from').fill('2026-05-01');
  await page.getByTestId('inventory-transactions-date-to').fill('2026-05-31');
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('inventory-transactions-source-filter').locator('.ant-select'),
    'Mua hàng',
  );

  await expect.poll(() => state.transactionUrls.some((item) => item.includes('transaction_date__gte=2026-05-01'))).toBe(true);
  await expect.poll(() => state.transactionUrls.some((item) => item.includes('source_type=PURCHASE'))).toBe(true);

  await page.getByTestId('inventory-nxt-date-from').fill('2026-05-01');
  await page.getByTestId('inventory-nxt-date-to').fill('2026-05-31');
  await expect.poll(() => state.nxtUrls.some((item) => item.includes('date_from=2026-05-01'))).toBe(true);
});
