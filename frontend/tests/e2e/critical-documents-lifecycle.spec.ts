import { expect, test, type Locator } from '@playwright/test';

import { adminUser, login } from './helpers/auth';
import { apiGet, getAccessToken } from './helpers/adminApi';
import { createPurchaseOrderSeed, createSalesOrderSeed } from './helpers/operationsApi';

type PurchaseOrderRecord = {
  id: number;
  code: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PARTIAL_RECEIVED' | 'RECEIVED' | 'CANCELLED';
  notes?: string;
  reject_reason?: string;
};

type SalesOrderRecord = {
  id: number;
  code: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'POSTED' | 'VOID';
  notes?: string;
  reject_reason?: string;
  void_reason?: string;
};

async function confirmPrimaryAction(dialog: Locator) {
  await dialog.locator('.ant-modal-footer .ant-btn-primary').click();
}

test('purchase order covers reject, edit, resubmit, approve, and receive from the command center', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, adminUser.username, adminUser.password);
  const token = await getAccessToken(page);
  const seed = await createPurchaseOrderSeed(page, token, `${Date.now()}po`);
  const rejectedNote = `PO bị từ chối ${Date.now()}`;
  const finalNote = `PO đã cập nhật sau từ chối ${Date.now()}`;
  const rejectReason = `Cần bổ sung bảng giá NCC ${Date.now()}`;

  await page.goto('/purchase-orders');
  await expect(page.getByTestId('purchase-orders-command-strip')).toBeVisible();
  await page.getByTestId('purchase-orders-command-search').locator('input').fill(seed.order.code);

  await expect(page.getByTestId(`purchase-order-edit-${seed.order.id}`)).toBeVisible();
  await page.getByTestId(`purchase-order-edit-${seed.order.id}`).click();

  let dialog = page.getByRole('dialog').last();
  await expect(dialog.getByLabel('Ghi chú')).toBeVisible();
  await dialog.getByLabel('Ghi chú').fill(rejectedNote);
  await confirmPrimaryAction(dialog);

  await expect.poll(async () => {
    const payload = await apiGet<PurchaseOrderRecord>(page, token, `/purchasing/orders/${seed.order.id}/`);
    return payload.notes ?? '';
  }, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe(rejectedNote);

  await page.getByTestId(`purchase-order-submit-${seed.order.id}`).click();
  await expect.poll(async () => {
    const payload = await apiGet<PurchaseOrderRecord>(page, token, `/purchasing/orders/${seed.order.id}/`);
    return payload.status;
  }).toBe('SUBMITTED');

  await page.getByTestId(`purchase-order-reject-${seed.order.id}`).click();
  dialog = page.getByRole('dialog').last();
  await dialog.getByLabel('Lý do').fill(rejectReason);
  await confirmPrimaryAction(dialog);

  await expect.poll(async () => {
    const payload = await apiGet<PurchaseOrderRecord>(page, token, `/purchasing/orders/${seed.order.id}/`);
    return payload.status;
  }).toBe('REJECTED');
  await expect.poll(async () => {
    const payload = await apiGet<PurchaseOrderRecord>(page, token, `/purchasing/orders/${seed.order.id}/`);
    return payload.reject_reason ?? '';
  }).toBe(rejectReason);

  await page.getByTestId(`purchase-order-edit-${seed.order.id}`).click();
  dialog = page.getByRole('dialog').last();
  await dialog.getByLabel('Ghi chú').fill(finalNote);
  await confirmPrimaryAction(dialog);

  await expect.poll(async () => {
    const payload = await apiGet<PurchaseOrderRecord>(page, token, `/purchasing/orders/${seed.order.id}/`);
    return payload.notes ?? '';
  }).toBe(finalNote);

  await page.getByTestId(`purchase-order-submit-${seed.order.id}`).click();
  await expect.poll(async () => {
    const payload = await apiGet<PurchaseOrderRecord>(page, token, `/purchasing/orders/${seed.order.id}/`);
    return payload.status;
  }).toBe('SUBMITTED');

  await page.getByTestId(`purchase-order-approve-${seed.order.id}`).click();
  await expect.poll(async () => {
    const payload = await apiGet<PurchaseOrderRecord>(page, token, `/purchasing/orders/${seed.order.id}/`);
    return payload.status;
  }).toBe('APPROVED');

  await page.getByTestId(`purchase-order-receive-${seed.order.id}`).click();
  dialog = page.getByRole('dialog').last();
  await expect(dialog.getByText(`Nhập kho cho ${seed.order.code}`)).toBeVisible();
  await confirmPrimaryAction(dialog);

  await expect.poll(async () => {
    const payload = await apiGet<PurchaseOrderRecord>(page, token, `/purchasing/orders/${seed.order.id}/`);
    return payload.status;
  }, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('RECEIVED');

  await page.getByTestId(`purchase-order-view-${seed.order.id}`).click();
  const drawer = page.locator('.ant-drawer-content').last();
  await expect(drawer).toContainText(seed.order.code);
  await expect(drawer).toContainText(finalNote);
  await expect(drawer).toContainText('Đã nhập đủ');
});

test('sales order covers reject branch and post-void branch from the command center', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, adminUser.username, adminUser.password);
  const token = await getAccessToken(page);
  const rejectSeed = await createSalesOrderSeed(page, token, `${Date.now()}sor`);
  const postSeed = await createSalesOrderSeed(page, token, `${Date.now()}sop`);
  const rejectReason = `Sai quy cách đơn hàng ${Date.now()}`;
  const updatedNote = `Đơn hàng đã chỉnh sửa trước khi ghi sổ ${Date.now()}`;
  const voidReason = `Khách đổi lịch nhận sau khi ghi sổ ${Date.now()}`;

  await page.goto('/sales-orders');
  await expect(page.getByTestId('sales-orders-command-strip')).toBeVisible();
  const searchInput = page.getByTestId('sales-orders-search').locator('input');

  await searchInput.fill(rejectSeed.order.code);
  const rejectRow = page.locator('.ant-table-tbody tr').filter({ hasText: rejectSeed.order.code }).first();
  await expect(rejectRow).toBeVisible();
  await page.getByTestId(`sales-order-submit-${rejectSeed.order.id}`).click();
  await expect.poll(async () => {
    const payload = await apiGet<SalesOrderRecord>(page, token, `/sales/orders/${rejectSeed.order.id}/`);
    return payload.status;
  }).toBe('SUBMITTED');

  await page.getByTestId(`sales-order-reject-${rejectSeed.order.id}`).click();
  let dialog = page.getByRole('dialog').last();
  await dialog.getByLabel('Lý do').fill(rejectReason);
  await confirmPrimaryAction(dialog);

  await expect.poll(async () => {
    const payload = await apiGet<SalesOrderRecord>(page, token, `/sales/orders/${rejectSeed.order.id}/`);
    return payload.status;
  }).toBe('REJECTED');
  await expect.poll(async () => {
    const payload = await apiGet<SalesOrderRecord>(page, token, `/sales/orders/${rejectSeed.order.id}/`);
    return payload.reject_reason ?? '';
  }).toBe(rejectReason);

  await page.getByTestId(`sales-order-view-${rejectSeed.order.id}`).click();
  dialog = page.getByRole('dialog').last();
  await expect(dialog).toContainText(rejectReason);
  await dialog.locator('.ant-modal-close').click();

  await searchInput.fill(postSeed.order.code);
  const postRow = page.locator('.ant-table-tbody tr').filter({ hasText: postSeed.order.code }).first();
  await expect(postRow).toBeVisible();
  await page.getByTestId(`sales-order-edit-${postSeed.order.id}`).click();

  dialog = page.getByRole('dialog').last();
  await expect(dialog.getByLabel('Ghi chú')).toBeVisible();
  await dialog.getByLabel('Ghi chú').fill(updatedNote);
  await confirmPrimaryAction(dialog);

  await expect.poll(async () => {
    const payload = await apiGet<SalesOrderRecord>(page, token, `/sales/orders/${postSeed.order.id}/`);
    return payload.notes ?? '';
  }, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe(updatedNote);

  await page.getByTestId(`sales-order-submit-${postSeed.order.id}`).click();
  await expect.poll(async () => {
    const payload = await apiGet<SalesOrderRecord>(page, token, `/sales/orders/${postSeed.order.id}/`);
    return payload.status;
  }).toBe('SUBMITTED');

  await page.getByTestId(`sales-order-approve-${postSeed.order.id}`).click();
  await expect.poll(async () => {
    const payload = await apiGet<SalesOrderRecord>(page, token, `/sales/orders/${postSeed.order.id}/`);
    return payload.status;
  }).toBe('APPROVED');

  await page.getByTestId(`sales-order-post-${postSeed.order.id}`).click();
  await expect.poll(async () => {
    const payload = await apiGet<SalesOrderRecord>(page, token, `/sales/orders/${postSeed.order.id}/`);
    return payload.status;
  }, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('POSTED');

  await page.getByTestId(`sales-order-void-${postSeed.order.id}`).click();
  dialog = page.getByRole('dialog').last();
  await dialog.getByLabel('Lý do').fill(voidReason);
  await confirmPrimaryAction(dialog);

  await expect.poll(async () => {
    const payload = await apiGet<SalesOrderRecord>(page, token, `/sales/orders/${postSeed.order.id}/`);
    return payload.status;
  }).toBe('VOID');
  await expect.poll(async () => {
    const payload = await apiGet<SalesOrderRecord>(page, token, `/sales/orders/${postSeed.order.id}/`);
    return payload.void_reason ?? '';
  }).toBe(voidReason);

  await page.getByTestId(`sales-order-view-${postSeed.order.id}`).click();
  dialog = page.getByRole('dialog').last();
  await expect(dialog).toContainText(updatedNote);
  await expect(dialog).toContainText(voidReason);
  await expect(dialog).toContainText('Đã hủy');
});
