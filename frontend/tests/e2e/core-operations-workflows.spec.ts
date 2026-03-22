import { expect, test, type Locator, type Page } from '@playwright/test';

import { adminUser, login } from './helpers/auth';
import { apiGet, getAccessToken } from './helpers/adminApi';
import { createProductionOrderSeed, createProductionSeedData } from './helpers/operationsApi';

type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

type PurchaseRequestRecord = {
  id: number;
  code: string;
  reference: string;
  notes: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  reject_reason: string;
};

type ProductionOrderRecord = {
  id: number;
  code: string;
  notes?: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RELEASED';
  reject_reason?: string;
};

async function chooseAntSelectOption(page: Page, scope: Locator, label: string, optionText: string) {
  const formItem = scope.locator('.ant-form-item').filter({ hasText: label }).first();
  await formItem.locator('.ant-select').first().click();
  await page.keyboard.type(optionText);
  await page.locator('.ant-select-dropdown .ant-select-item-option').filter({ hasText: optionText }).first().click();
}

async function fillFormTextbox(scope: Locator, label: string, value: string) {
  const formItem = scope.locator('.ant-form-item').filter({ hasText: label }).first();
  await formItem.locator('textarea, input').last().fill(value);
}

async function findPurchaseRequest(page: Page, token: string, search: string): Promise<PurchaseRequestRecord> {
  const payload = await apiGet<PaginatedResponse<PurchaseRequestRecord>>(page, token, '/purchasing/requests/', {
    search,
    page_size: 5,
  });
  expect(payload.results.length).toBeGreaterThan(0);
  return payload.results[0];
}

async function getPurchaseRequest(page: Page, token: string, id: number): Promise<PurchaseRequestRecord> {
  return apiGet<PurchaseRequestRecord>(page, token, `/purchasing/requests/${id}/`);
}

async function findProductionOrderByProduct(page: Page, token: string, productId: number): Promise<ProductionOrderRecord> {
  const payload = await apiGet<PaginatedResponse<ProductionOrderRecord>>(page, token, '/production/orders/', {
    product: productId,
    page_size: 5,
  });
  expect(payload.results.length).toBeGreaterThan(0);
  return payload.results[0];
}

async function getProductionOrder(page: Page, token: string, id: number): Promise<ProductionOrderRecord> {
  return apiGet<ProductionOrderRecord>(page, token, `/production/orders/${id}/`);
}

test('admin can create, edit, approve, and reject purchase requests from the command center', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, adminUser.username, adminUser.password);
  const token = await getAccessToken(page);
  const seedKey = Date.now();

  await page.goto('/purchase-requests');
  await expect(page.locator('main').getByText(/Trung tâm yêu cầu mua/i)).toBeVisible();

  const firstReference = `PW-PR-${seedKey}`;
  const firstNote = `Yêu cầu mua tạo từ Playwright ${seedKey}`;
  const editedNote = `Yêu cầu mua đã chỉnh sửa ${seedKey}`;

  await page.getByRole('button', { name: /Tạo mới/i }).click();
  let dialog = page.getByRole('dialog').last();
  await dialog.getByLabel(/Tham chiếu/i).fill(firstReference);
  await dialog.getByLabel(/Ghi chú/i).fill(firstNote);
  await dialog.getByRole('button', { name: /Tạo yêu cầu/i }).click();

  await expect.poll(async () => {
    const payload = await apiGet<PaginatedResponse<PurchaseRequestRecord>>(page, token, '/purchasing/requests/', {
      search: firstReference,
      page_size: 5,
    });
    return payload.results.length;
  }, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBeGreaterThan(0);

  const firstRequest = await findPurchaseRequest(page, token, firstReference);
  const searchInput = page.getByPlaceholder(/Tìm mã yêu cầu/i);
  await searchInput.fill(firstRequest.code);

  let row = page.locator('.ant-table-tbody tr').filter({ hasText: firstRequest.code }).first();
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: /Sửa/i }).click();
  dialog = page.getByRole('dialog').last();
  await dialog.getByLabel(/Ghi chú/i).fill(editedNote);
  await dialog.getByRole('button', { name: /Lưu thay đổi/i }).click();

  await expect.poll(async () => (await getPurchaseRequest(page, token, firstRequest.id)).notes, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe(editedNote);

  await row.getByRole('button', { name: /Gửi duyệt/i }).click();
  await expect.poll(async () => (await getPurchaseRequest(page, token, firstRequest.id)).status, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('SUBMITTED');
  row = page.locator('.ant-table-tbody tr').filter({ hasText: firstRequest.code }).first();
  await expect(row.getByText(/Chờ duyệt/i)).toBeVisible();

  await row.getByRole('button', { name: /Duyệt/i }).click();
  await expect.poll(async () => (await getPurchaseRequest(page, token, firstRequest.id)).status, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('APPROVED');
  await expect(row.getByText(/Đã duyệt/i)).toBeVisible();

  const secondReference = `PW-PR-REJECT-${seedKey}`;
  const secondNote = `Yêu cầu mua chờ từ chối ${seedKey}`;
  const rejectReason = `Thiếu dữ liệu báo giá NCC ${seedKey}`;

  await searchInput.fill('');
  await page.getByRole('button', { name: /Tạo mới/i }).click();
  dialog = page.getByRole('dialog').last();
  await dialog.getByLabel(/Tham chiếu/i).fill(secondReference);
  await dialog.getByLabel(/Ghi chú/i).fill(secondNote);
  await dialog.getByRole('button', { name: /Tạo yêu cầu/i }).click();

  await expect.poll(async () => {
    const payload = await apiGet<PaginatedResponse<PurchaseRequestRecord>>(page, token, '/purchasing/requests/', {
      search: secondReference,
      page_size: 5,
    });
    return payload.results.length;
  }, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBeGreaterThan(0);

  const secondRequest = await findPurchaseRequest(page, token, secondReference);
  await searchInput.fill(secondRequest.code);
  row = page.locator('.ant-table-tbody tr').filter({ hasText: secondRequest.code }).first();
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: /Gửi duyệt/i }).click();
  await expect.poll(async () => (await getPurchaseRequest(page, token, secondRequest.id)).status, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('SUBMITTED');

  await row.getByRole('button', { name: /Từ chối/i }).click();
  dialog = page.getByRole('dialog').last();
  await fillFormTextbox(dialog, 'Lý do từ chối', rejectReason);
  await dialog.getByRole('button', { name: /Xác nhận từ chối/i }).click();

  await expect.poll(async () => (await getPurchaseRequest(page, token, secondRequest.id)).status, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('REJECTED');
  await expect.poll(async () => (await getPurchaseRequest(page, token, secondRequest.id)).reject_reason, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe(rejectReason);
  await expect(row).toContainText('Từ chối');
});

test('admin can create, update, release, and reject production orders from the command center', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, adminUser.username, adminUser.password);
  const token = await getAccessToken(page);
  const seedKey = `${Date.now()}`;

  const seed = await createProductionSeedData(page, token, seedKey);
  const firstReference = `PW-LSX-${seedKey}`;
  const firstNote = `Lệnh sản xuất Playwright ${seedKey}`;
  const updatedNote = `Lệnh sản xuất đã chỉnh sửa ${seedKey}`;

  await page.goto('/production-orders');
  await expect(page.locator('main').getByText(/Trung tâm lệnh sản xuất/i)).toBeVisible();

  await page.getByRole('button', { name: /Tạo lệnh/i }).click();
  let dialog = page.getByRole('dialog').last();
  await chooseAntSelectOption(page, dialog, 'Thành phẩm', seed.product.code);
  await fillFormTextbox(dialog, 'Số lượng kế hoạch', '7');
  await fillFormTextbox(dialog, 'Tham chiếu', firstReference);
  await chooseAntSelectOption(page, dialog, 'Kho nhập thành phẩm', seed.warehouse.code);
  await chooseAntSelectOption(page, dialog, 'Vị trí thành phẩm', seed.location.code);
  await fillFormTextbox(dialog, 'Ghi chú', firstNote);
  await dialog.getByRole('button', { name: /^Tạo lệnh$/i }).click();

  await expect.poll(async () => {
    const payload = await apiGet<PaginatedResponse<ProductionOrderRecord>>(page, token, '/production/orders/', {
      product: seed.product.id,
      page_size: 5,
    });
    return payload.results.length;
  }, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBeGreaterThan(0);

  const firstOrder = await findProductionOrderByProduct(page, token, seed.product.id);
  const searchInput = page.getByPlaceholder(/Tìm mã lệnh/i);
  await searchInput.fill(firstOrder.code);

  let row = page.locator('.ant-table-tbody tr').filter({ hasText: firstOrder.code }).first();
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: /Sửa/i }).click();
  dialog = page.getByRole('dialog').last();
  await fillFormTextbox(dialog, 'Ghi chú', updatedNote);
  await dialog.getByRole('button', { name: /Lưu thay đổi/i }).click();

  await expect.poll(async () => (await getProductionOrder(page, token, firstOrder.id)).notes ?? '', {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe(updatedNote);

  await row.getByRole('button', { name: /Gửi duyệt/i }).click();
  await expect.poll(async () => (await getProductionOrder(page, token, firstOrder.id)).status, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('SUBMITTED');
  row = page.locator('.ant-table-tbody tr').filter({ hasText: firstOrder.code }).first();
  await expect(row.getByText(/Chờ duyệt/i)).toBeVisible();

  await row.getByRole('button', { name: /Duyệt/i }).click();
  await expect.poll(async () => (await getProductionOrder(page, token, firstOrder.id)).status, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('APPROVED');

  row = page.locator('.ant-table-tbody tr').filter({ hasText: firstOrder.code }).first();
  await row.getByRole('button', { name: /Phát lệnh/i }).click();
  await expect.poll(async () => (await getProductionOrder(page, token, firstOrder.id)).status, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('RELEASED');
  await expect(row.getByText(/Đã phát lệnh/i)).toBeVisible();

  const rejectedSeed = await createProductionOrderSeed(page, token, `${seedKey}r`);
  const rejectReason = `Sai kế hoạch sản xuất ${seedKey}`;

  await searchInput.fill(rejectedSeed.order.code);
  row = page.locator('.ant-table-tbody tr').filter({ hasText: rejectedSeed.order.code }).first();
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: /Gửi duyệt/i }).click();
  await expect.poll(async () => (await getProductionOrder(page, token, rejectedSeed.order.id)).status, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('SUBMITTED');

  await row.getByRole('button', { name: /Từ chối/i }).click();
  dialog = page.getByRole('dialog').last();
  await fillFormTextbox(dialog, 'Lý do', rejectReason);
  await dialog.getByRole('button', { name: /Xác nhận từ chối/i }).click();

  await expect.poll(async () => (await getProductionOrder(page, token, rejectedSeed.order.id)).status, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('REJECTED');
  await expect.poll(async () => (await getProductionOrder(page, token, rejectedSeed.order.id)).reject_reason ?? '', {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe(rejectReason);
  await expect(row.getByText(/Từ chối/i)).toBeVisible();
});
