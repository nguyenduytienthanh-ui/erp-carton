import { expect, test } from '@playwright/test';

import { adminUser, login } from './helpers/auth';
import { apiGet, apiPost, getAccessToken } from './helpers/adminApi';
import {
  createProductionIssueSeed,
  createProductionOrderSeed,
  createPurchaseReturnSeed,
} from './helpers/operationsApi';

type ProductionIssueRecord = {
  id: number;
  code: string;
  status: 'POSTED' | 'CANCELLED';
  cancel_reason?: string;
};

test('purchase return detail shows full lifecycle after workflow transitions', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, adminUser.username, adminUser.password);
  const token = await getAccessToken(page);
  const seed = await createPurchaseReturnSeed(page, token, `${Date.now()}ret`);

  await apiPost(page, token, `/purchasing/returns/${seed.purchaseReturn.id}/submit_return/`);
  await apiPost(page, token, `/purchasing/returns/${seed.purchaseReturn.id}/approve_return/`);
  await apiPost(page, token, `/purchasing/returns/${seed.purchaseReturn.id}/post_return/`);

  await page.goto('/purchase-returns');
  const searchInput = page.getByTestId('purchase-returns-command-search').locator('input');
  await searchInput.fill(seed.purchaseReturn.code);
  await expect(page.getByTestId(`purchase-return-view-${seed.purchaseReturn.id}`)).toBeVisible();
  await page.getByTestId(`purchase-return-view-${seed.purchaseReturn.id}`).click();

  await expect(page.getByTestId('purchase-return-detail-panel')).toBeVisible();
  await expect(page.getByTestId('purchase-return-next-states')).toContainText('Hiện tại: Đã vào sổ');
  await expect(page.getByTestId('purchase-return-next-states')).toContainText('Đã đảo');
  await expect(page.getByTestId('purchase-return-approval-history')).toContainText('Đã duyệt');
  await expect(page.getByTestId('purchase-return-approval-history')).toContainText('Gửi duyệt');
  await expect(page.getByTestId('purchase-return-lifecycle-history')).toContainText('Đã vào sổ');
  await expect(page.getByTestId('purchase-return-lifecycle-history')).toContainText('Đã duyệt');
  await expect(page.getByTestId('purchase-return-lifecycle-history')).toContainText('Gửi duyệt');
});

test('material issue detail blocks direct cancel for posted production ledger', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, adminUser.username, adminUser.password);
  const token = await getAccessToken(page);
  const seed = await createProductionIssueSeed(page, token, `${Date.now()}iss`);

  await page.goto('/material-issues');
  const searchInput = page.getByTestId('material-issues-command-search').locator('input');
  await searchInput.fill(seed.issue.code);
  await expect(page.getByTestId(`material-issue-view-${seed.issue.id}`)).toBeVisible();
  await page.getByTestId(`material-issue-view-${seed.issue.id}`).click();

  await expect(page.getByTestId('material-issue-detail-panel')).toBeVisible();
  await expect(page.getByTestId('material-issue-detail-panel')).toContainText(seed.order.code);
  await expect(page.getByTestId('material-issue-detail-panel')).toContainText(seed.issue.reference || '');
  await expect(page.getByTestId('material-issue-next-states')).toContainText('Hiện tại: Đã ghi nhận');
  await expect(page.getByTestId('material-issue-next-states')).toContainText('Không còn bước tiếp theo');
  await expect(page.getByTestId('material-issue-next-states')).toContainText('immutable reversal');
  await expect(page.getByTestId('material-issue-lifecycle-history')).toContainText('Đã cấp vật tư');
  await page.keyboard.press('Escape');

  await expect(page.getByTestId(`material-issue-cancel-${seed.issue.id}`)).toBeDisabled();
  const payload = await apiGet<ProductionIssueRecord>(page, token, `/production/issues/${seed.issue.id}/`);
  expect(payload.status).toBe('POSTED');

  await page.getByTestId(`material-issue-view-${seed.issue.id}`).click();
  await expect(page.getByTestId('material-issue-next-states')).toContainText('Hiện tại: Đã ghi nhận');
  await expect(page.getByTestId('material-issue-next-states')).toContainText('Không còn bước tiếp theo');
  await expect(page.getByTestId('material-issue-next-states')).toContainText('immutable reversal');
  await expect(page.getByTestId('material-issue-lifecycle-history')).toContainText('Đã cấp vật tư');
});

test('production order detail shows approval history and next states after release', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, adminUser.username, adminUser.password);
  const token = await getAccessToken(page);
  const seed = await createProductionOrderSeed(page, token, `${Date.now()}lsx`);

  await apiPost(page, token, `/production/orders/${seed.order.id}/submit/`);
  await apiPost(page, token, `/production/orders/${seed.order.id}/approve/`);
  await apiPost(page, token, `/production/orders/${seed.order.id}/release/`);

  await page.goto('/production-orders');
  const searchInput = page.getByTestId('production-orders-command-search').locator('input');
  await searchInput.fill(seed.order.code);
  await expect(page.getByTestId(`production-order-view-${seed.order.id}`)).toBeVisible();
  await page.getByTestId(`production-order-view-${seed.order.id}`).click();

  await expect(page.getByTestId('production-order-detail-panel')).toBeVisible();
  await expect(page.getByTestId('production-order-next-states')).toContainText('Hiện tại: Đã phát lệnh');
  await expect(page.getByTestId('production-order-next-states')).toContainText('Đang sản xuất');
  await expect(page.getByTestId('production-order-next-states')).toContainText('Hoàn thành');
  await expect(page.getByTestId('production-order-approval-history')).toContainText('Đã duyệt');
  await expect(page.getByTestId('production-order-approval-history')).toContainText('Gửi duyệt');
});
