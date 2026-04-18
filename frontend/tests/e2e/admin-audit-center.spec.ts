import { expect, test } from '@playwright/test';

import { apiPost, getAccessToken } from './helpers/adminApi';
import { adminUser, login } from './helpers/auth';

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

test('admin can open audit center from observability and see audit sections', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/observability');
  await page.waitForLoadState('networkidle');

  const auditCenterButton = page.getByTestId('admin-observability-route-audit-center');
  await expect(auditCenterButton).toBeVisible();
  await auditCenterButton.click();

  await expect(page).toHaveURL(/\/admin\/audit-center$/);
  await expect(page.getByTestId('admin-audit-center-actor-hotspot')).toBeVisible();
  await expect(page.getByTestId('admin-audit-center-hot-entities')).toBeVisible();
  await expect(page.getByTestId('admin-audit-center-timeline')).toBeVisible();
  await expect(page.getByTestId('admin-audit-center-recent-activity')).toBeVisible();
});

test('admin can drill from audit center into purchase request detail and approval history', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, adminUser.username, adminUser.password);
  const token = await getAccessToken(page);
  const seedKey = Date.now();

  const request = await apiPost<PurchaseRequestRecord>(page, token, '/purchasing/requests/', {
    request_date: formatDate(new Date()),
    reference: `AUDIT-PR-${seedKey}`,
    notes: `Yeu cau audit regression ${seedKey}`,
  });
  await apiPost(page, token, `/purchasing/requests/${request.id}/submit/`, {});

  await page.goto('/admin/audit-center');
  await page.waitForLoadState('networkidle');

  const searchInput = page.getByPlaceholder(/Tim actor|Tìm actor/i);
  await searchInput.fill(request.code);

  const row = page.locator('.ant-table-tbody tr').filter({ hasText: request.code }).first();
  await expect(row).toBeVisible();
  await expect(page.getByTestId('admin-audit-center-hot-entities')).toBeVisible();
  await row.getByTestId('admin-audit-center-open-activity').click();

  await expect(page).toHaveURL(/\/purchase-requests(\?|$)/);
  await expect(page.getByTestId('purchase-request-detail-panel')).toBeVisible();
  await expect(page.getByTestId('purchase-request-approval-history')).toBeVisible();
  await expect(page.getByTestId('purchase-request-detail-panel')).toContainText(request.code);
});

test('admin can run retention preview and server exports from audit center', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/audit-center');
  await page.waitForLoadState('networkidle');

  const retentionButton = page.getByTestId('admin-audit-center-retention-preview');
  await expect(retentionButton).toBeVisible();
  await retentionButton.click();
  await expect(page.getByText(/Da chay retention dry-run:/i)).toBeVisible();

  const exportJsonButton = page.getByTestId('admin-audit-center-export-server-json');
  await expect(exportJsonButton).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportJsonButton.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/admin-audit-all\.json/i);
});
