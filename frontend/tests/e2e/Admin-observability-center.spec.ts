import { expect, test } from '@playwright/test';

import { adminUser, login, salesUser } from './helpers/auth';

test('admin can open admin observability center and drill down into workflow analytics', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/observability');
  await expect(page.getByText(/Trung tâm sức khỏe hệ thống/i)).toBeVisible();
  await expect(page.getByText(/Sức khỏe tổng thể/i)).toBeVisible();

  const workflowRouteButton = page.getByTestId('admin-observability-route-workflow');
  if (await workflowRouteButton.count()) {
    await expect(workflowRouteButton).toBeVisible();
    await workflowRouteButton.click();
    await expect(page).toHaveURL(/\/workflow-analytics$/);
  }
});

test('admin can inspect business flow radar and drill down into finance operations', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/observability');
  await page.waitForLoadState('networkidle');

  await expect(page.getByText(/Radar tài chính/i)).toBeVisible();
  await expect(page.getByText(/Radar mua hàng/i)).toBeVisible();
  await expect(page.getByText(/Radar sản xuất/i)).toBeVisible();

  const financeRouteButton = page.getByTestId('admin-observability-route-finance-flow');
  await expect(financeRouteButton).toBeVisible();
  await financeRouteButton.click();

  await expect(page).toHaveURL(/\/advance-transactions(\?|$)/);
  await expect.poll(() => page.url()).toContain('/advance-transactions');
});

test('admin can inspect approval audit radar and open purchasing operations', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/observability');
  await page.waitForLoadState('networkidle');

  await expect(page.getByText(/Approval Pulse/i)).toBeVisible();
  await expect(page.getByTestId('admin-observability-approval-queue-pulse')).toBeVisible();
  await expect(page.getByText(/Bảng kiểm soát duyệt trọng yếu/i)).toBeVisible();
  await expect(page.getByText(/Nhật ký quyết định duyệt 7 ngày/i)).toBeVisible();

  const controlTowerButton = page.getByTestId('admin-observability-route-approval-control-tower');
  await expect(controlTowerButton).toBeVisible();
  await controlTowerButton.click();

  await expect(page).toHaveURL(/\/admin\/approval-control-tower(\?|$)/);
});

test('admin can trigger scheduler quick actions from observability center', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/observability');
  await page.waitForLoadState('networkidle');

  const notifyButton = page.getByTestId('admin-observability-notify-admins');
  await expect(notifyButton).toBeVisible({ timeout: 30_000 });
  await notifyButton.click();
  await expect(page.getByText(/Đã gửi cảnh báo tới/i)).toBeVisible();

  const simulateButton = page.getByTestId('admin-observability-simulate-failure');
  await expect(simulateButton).toBeVisible();
  await expect(simulateButton).toBeDisabled();

  const recoverButton = page.getByTestId('admin-observability-recover-scheduler');
  await expect(recoverButton).toBeVisible();
  await recoverButton.click();
  await expect(page.getByText(/Đã khôi phục scheduler workflow/i)).toBeVisible();
});

test('admin can run go-live rail actions from observability center', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/observability');
  await page.waitForLoadState('networkidle');

  const alertDrillButton = page.getByTestId('admin-observability-run-alert-drill');
  await expect(alertDrillButton).toBeVisible();
  await alertDrillButton.click();
  await expect(page.getByText(/Da chay alert drill:/i)).toBeVisible();

  const alertReadinessButton = page.getByTestId('admin-observability-export-alert-readiness');
  await expect(alertReadinessButton).toBeVisible();
  const [alertReadinessDownload] = await Promise.all([
    page.waitForEvent('download'),
    alertReadinessButton.click(),
  ]);
  expect(alertReadinessDownload.suggestedFilename()).toMatch(/alert-channel-readiness\.json/i);

  const handoffButton = page.getByTestId('admin-observability-export-handoff');
  await expect(handoffButton).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    handoffButton.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/go-live-handoff-staging\.json/i);

  const cleanupButton = page.getByTestId('admin-observability-preview-release-cleanup');
  await expect(cleanupButton).toBeVisible();
  const [cleanupDownload] = await Promise.all([
    page.waitForEvent('download'),
    cleanupButton.click(),
  ]);
  expect(cleanupDownload.suggestedFilename()).toMatch(/release-cleanup-preview\.json/i);

  const releaseLockButton = page.getByTestId('admin-observability-export-release-lock');
  await expect(releaseLockButton).toBeVisible();
  const [releaseLockDownload] = await Promise.all([
    page.waitForEvent('download'),
    releaseLockButton.click(),
  ]);
  expect(releaseLockDownload.suggestedFilename()).toMatch(/release-lockfile-staging\.json/i);

  const drilldownButton = page.getByTestId('admin-observability-export-performance-drilldown');
  await expect(drilldownButton).toBeVisible();
  const [drilldownDownload] = await Promise.all([
    page.waitForEvent('download'),
    drilldownButton.click(),
  ]);
  expect(drilldownDownload.suggestedFilename()).toMatch(/performance-drilldown\.json/i);
});

test('sales user is redirected away from admin observability center', async ({ page }) => {
  await login(page, salesUser.username, salesUser.password);

  await page.goto('/admin/observability');
  await expect(page).not.toHaveURL(/\/admin\/observability$/);
});
