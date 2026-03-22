import { expect, test } from '@playwright/test';

import { adminUser, login } from './helpers/auth';
import { apiGet, getAccessToken } from './helpers/adminApi';
import { createProductionOrderSeed, createPurchaseReturnSeed } from './helpers/operationsApi';

type PurchaseReturnRecord = {
  id: number;
  code: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED';
};

type ProductionOrderRecord = {
  id: number;
  code: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RELEASED';
};

test('purchase return row actions can open edit modal and progress draft to approved', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, adminUser.username, adminUser.password);
  const token = await getAccessToken(page);
  const seed = await createPurchaseReturnSeed(page, token, `${Date.now()}retui`);

  await page.goto('/purchase-returns');
  await expect(page.getByTestId('purchase-returns-command-strip')).toBeVisible();
  await page.getByTestId('purchase-returns-command-search').locator('input').fill(seed.purchaseReturn.code);

  await expect(page.getByTestId(`purchase-return-edit-${seed.purchaseReturn.id}`)).toBeVisible();
  await page.getByTestId(`purchase-return-edit-${seed.purchaseReturn.id}`).click();

  const editDialog = page.getByRole('dialog').last();
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByLabel('Ngày trả')).toBeVisible();
  await expect(editDialog.getByLabel('Lý do trả')).toBeVisible();
  await editDialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(editDialog).toBeHidden();

  await page.getByTestId(`purchase-return-submit-${seed.purchaseReturn.id}`).click();
  await expect.poll(async () => {
    const payload = await apiGet<PurchaseReturnRecord>(page, token, `/purchasing/returns/${seed.purchaseReturn.id}/`);
    return payload.status;
  }).toBe('SUBMITTED');

  await page.getByTestId(`purchase-return-approve-${seed.purchaseReturn.id}`).click();
  await expect.poll(async () => {
    const payload = await apiGet<PurchaseReturnRecord>(page, token, `/purchasing/returns/${seed.purchaseReturn.id}/`);
    return payload.status;
  }).toBe('APPROVED');

  await page.getByTestId(`purchase-return-view-${seed.purchaseReturn.id}`).click();
  await expect(page.getByTestId('purchase-return-detail-panel')).toBeVisible();
  await expect(page.getByTestId('purchase-return-next-states')).toContainText('Hiện tại: Đã duyệt');
  await expect(page.getByTestId('purchase-return-next-states')).toContainText('Đã vào sổ');
  await expect(page.getByTestId('purchase-return-approval-history')).toContainText('Đã duyệt');
  await expect(page.getByTestId('purchase-return-approval-history')).toContainText('Gửi duyệt');
});

test('production order row actions can open edit modal and progress draft to released', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, adminUser.username, adminUser.password);
  const token = await getAccessToken(page);
  const seed = await createProductionOrderSeed(page, token, `${Date.now()}ordui`);

  await page.goto('/production-orders');
  await expect(page.getByTestId('production-orders-command-strip')).toBeVisible();
  await page.getByTestId('production-orders-command-search').locator('input').fill(seed.order.code);

  await expect(page.getByTestId(`production-order-edit-${seed.order.id}`)).toBeVisible();
  await page.getByTestId(`production-order-edit-${seed.order.id}`).click();

  const editDialog = page.getByRole('dialog').last();
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByLabel('Ngày lệnh')).toBeVisible();
  await expect(editDialog.getByTestId('production-order-form-reference')).toBeVisible();
  await expect(editDialog.getByTestId('production-order-form-notes')).toBeVisible();
  await editDialog.getByRole('button', { name: 'Đóng' }).click();
  await expect(editDialog).toBeHidden();

  await page.getByTestId(`production-order-submit-${seed.order.id}`).click();
  await expect.poll(async () => {
    const payload = await apiGet<ProductionOrderRecord>(page, token, `/production/orders/${seed.order.id}/`);
    return payload.status;
  }).toBe('SUBMITTED');

  await page.getByTestId(`production-order-approve-${seed.order.id}`).click();
  await expect.poll(async () => {
    const payload = await apiGet<ProductionOrderRecord>(page, token, `/production/orders/${seed.order.id}/`);
    return payload.status;
  }).toBe('APPROVED');

  await page.getByTestId(`production-order-release-${seed.order.id}`).click();
  await expect.poll(async () => {
    const payload = await apiGet<ProductionOrderRecord>(page, token, `/production/orders/${seed.order.id}/`);
    return payload.status;
  }).toBe('RELEASED');

  await page.getByTestId(`production-order-view-${seed.order.id}`).click();
  await expect(page.getByTestId('production-order-detail-panel')).toBeVisible();
  await expect(page.getByTestId('production-order-next-states')).toContainText('Hiện tại: Đã phát lệnh');
  await expect(page.getByTestId('production-order-approval-history')).toContainText('Đã duyệt');
  await expect(page.getByTestId('production-order-approval-history')).toContainText('Gửi duyệt');
});
