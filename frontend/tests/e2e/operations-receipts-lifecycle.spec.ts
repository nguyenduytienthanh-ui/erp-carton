import { expect, test } from '@playwright/test';

import { adminUser, login } from './helpers/auth';
import { apiGet, getAccessToken } from './helpers/adminApi';
import {
  createProductionReceiptSeed,
  createPurchaseReceiptSeed,
} from './helpers/operationsApi';

type ReceiptRecord = {
  id: number;
  code: string;
  status: 'POSTED' | 'CANCELLED';
  cancel_reason?: string;
};

test('purchase receipt detail shows next states and lifecycle history after cancel', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, adminUser.username, adminUser.password);
  const token = await getAccessToken(page);
  const seed = await createPurchaseReceiptSeed(page, token, `${Date.now()}prc`);
  const cancelReason = `Đối soát lại phiếu nhập ${Date.now()}`;

  await page.goto('/purchase-receipts');
  await expect(page.getByTestId('purchase-receipts-command-strip')).toBeVisible();
  await page.getByTestId('purchase-receipts-command-search').locator('input').fill(seed.receipt.code);

  await expect(page.getByTestId(`purchase-receipt-view-${seed.receipt.id}`)).toBeVisible();
  await page.getByTestId(`purchase-receipt-view-${seed.receipt.id}`).click();

  await expect(page.getByTestId('purchase-receipt-detail-panel')).toBeVisible();
  await expect(page.getByTestId('purchase-receipt-next-states')).toContainText('Đã ghi sổ');
  await expect(page.getByTestId('purchase-receipt-next-states')).toContainText('Đã hủy');
  await expect(page.getByTestId('purchase-receipt-lifecycle-history')).toContainText('Đã ghi sổ');

  await page.locator('.ant-drawer-close').last().click();
  await expect(page.getByTestId('purchase-receipt-detail-panel')).toBeHidden();

  await expect(page.getByTestId(`purchase-receipt-cancel-${seed.receipt.id}`)).toBeEnabled();
  await page.getByTestId(`purchase-receipt-cancel-${seed.receipt.id}`).click();
  const cancelDialog = page.getByRole('dialog').last();
  await cancelDialog.getByLabel('Lý do hủy').fill(cancelReason);
  await cancelDialog.getByRole('button', { name: 'Xác nhận hủy' }).click();

  await expect.poll(async () => {
    const payload = await apiGet<ReceiptRecord>(page, token, `/purchasing/receipts/${seed.receipt.id}/`);
    return payload.status;
  }, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('CANCELLED');

  await page.getByTestId(`purchase-receipt-view-${seed.receipt.id}`).click();
  await expect(page.getByTestId('purchase-receipt-next-states')).toContainText('Hiện tại: Đã hủy');
  await expect(page.getByTestId('purchase-receipt-next-states')).toContainText('Không còn bước tiếp theo');
  await expect(page.getByTestId('purchase-receipt-lifecycle-history')).toContainText('Đã hủy');
  await expect(page.getByTestId('purchase-receipt-lifecycle-history')).toContainText(cancelReason);
});

test('production receipt detail shows next states and lifecycle history after cancel', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, adminUser.username, adminUser.password);
  const token = await getAccessToken(page);
  const seed = await createProductionReceiptSeed(page, token, `${Date.now()}frc`);
  const cancelReason = `Điều chỉnh nhập thành phẩm ${Date.now()}`;

  await page.goto('/production-receipts');
  await expect(page.getByTestId('production-receipts-command-strip')).toBeVisible();
  await page.getByTestId('production-receipts-command-search').locator('input').fill(seed.receipt.code);

  await expect(page.getByTestId(`production-receipt-view-${seed.receipt.id}`)).toBeVisible();
  await page.getByTestId(`production-receipt-view-${seed.receipt.id}`).click();

  await expect(page.getByTestId('production-receipt-detail-panel')).toBeVisible();
  await expect(page.getByTestId('production-receipt-next-states')).toContainText('Đã ghi nhận');
  await expect(page.getByTestId('production-receipt-next-states')).toContainText('Đã hủy');
  await expect(page.getByTestId('production-receipt-lifecycle-history')).toContainText('Đã ghi nhận');

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('production-receipt-detail-panel')).toBeHidden();

  await page.getByTestId(`production-receipt-cancel-${seed.receipt.id}`).click();
  const cancelDialog = page.getByRole('dialog').last();
  await cancelDialog.getByLabel('Lý do hủy').fill(cancelReason);
  await cancelDialog.getByRole('button', { name: 'Xác nhận hủy' }).click();

  await expect.poll(async () => {
    const payload = await apiGet<ReceiptRecord>(page, token, `/production/receipts/${seed.receipt.id}/`);
    return payload.status;
  }, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('CANCELLED');

  await page.getByTestId(`production-receipt-view-${seed.receipt.id}`).click();
  await expect(page.getByTestId('production-receipt-next-states')).toContainText('Hiện tại: Đã hủy');
  await expect(page.getByTestId('production-receipt-next-states')).toContainText('Không còn bước tiếp theo');
  await expect(page.getByTestId('production-receipt-lifecycle-history')).toContainText('Đã hủy');
  await expect(page.getByTestId('production-receipt-lifecycle-history')).toContainText(cancelReason);
});
