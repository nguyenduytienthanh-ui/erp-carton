import { expect, test } from '@playwright/test';

import { apiPost, getAccessToken } from './helpers/adminApi';
import { adminUser, login } from './helpers/auth';
import { createProductionOrderSeed } from './helpers/operationsApi';

type PurchaseRequestRecord = {
  id: number;
  code: string;
};

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

test('approval control tower drills into purchase request detail with approval history', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, adminUser.username, adminUser.password);
  const token = await getAccessToken(page);
  const seedKey = Date.now();

  const request = await apiPost<PurchaseRequestRecord>(page, token, '/purchasing/requests/', {
    request_date: formatDate(new Date()),
    reference: `TOWER-PR-${seedKey}`,
    notes: `Yeu cau duyet command center ${seedKey}`,
  });
  await apiPost(page, token, `/purchasing/requests/${request.id}/submit/`, {});

  await page.goto('/admin/approval-control-tower');
  await page.waitForLoadState('networkidle');

  const searchInput = page.getByPlaceholder(/Tim ma ho so|Tìm mã hồ sơ/i);
  await searchInput.fill(request.code);

  const row = page.locator('.ant-table-tbody tr').filter({ hasText: request.code }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Mở' }).click();

  await expect(page).toHaveURL(/\/purchase-requests(\?|$)/);
  await expect(page.getByTestId('purchase-request-detail-panel')).toBeVisible();
  await expect(page.getByTestId('purchase-request-approval-history')).toBeVisible();
  await expect(page.getByTestId('purchase-request-detail-panel')).toContainText(request.code);
});

test('approval control tower drills into production order detail with approval history', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, adminUser.username, adminUser.password);
  const token = await getAccessToken(page);
  const seedKey = `${Date.now()}-tower`;

  const seeded = await createProductionOrderSeed(page, token, seedKey);
  await apiPost(page, token, `/production/orders/${seeded.order.id}/submit/`, {});

  await page.goto('/admin/approval-control-tower');
  await page.waitForLoadState('networkidle');

  const searchInput = page.getByPlaceholder(/Tim ma ho so|Tìm mã hồ sơ/i);
  await searchInput.fill(seeded.order.code);

  const row = page.locator('.ant-table-tbody tr').filter({ hasText: seeded.order.code }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Mở' }).click();

  await expect(page).toHaveURL(/\/production-orders(\?|$)/);
  await expect(page.getByTestId('production-order-detail-panel')).toBeVisible();
  await expect(page.getByTestId('production-order-approval-history')).toBeVisible();
  await expect(page.getByTestId('production-order-detail-panel')).toContainText(seeded.order.code);
});
