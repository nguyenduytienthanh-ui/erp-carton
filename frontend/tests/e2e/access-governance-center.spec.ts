import { expect, test } from '@playwright/test';

import { adminUser, login, salesUser } from './helpers/auth';

test('admin can open access governance center and drill down into a governance command center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/access-governance');
  await expect(page.locator('main').getByText(/Trung tâm giám sát truy cập/i)).toBeVisible();
  await expect(page.getByTestId('access-governance-health-signals')).toBeVisible();
  await expect(page.getByTestId('access-governance-triage-immediate')).toBeVisible();

  const exceptionRouteButton = page.getByTestId('access-governance-route-exception');
  await expect(exceptionRouteButton).toBeVisible();
  await exceptionRouteButton.click();

  await expect(page).toHaveURL(/\/admin\/access-exceptions$/);
});

test('admin can export governance surface audit from the command strip', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/access-governance');
  await expect(page.getByTestId('access-governance-command-strip')).toBeVisible();

  const exportButton = page.getByTestId('access-governance-export-surface-audit');
  await expect(exportButton).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportButton.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/access-governance-surface-audit\.json/i);
});

test('sales user is redirected away from access governance center', async ({ page }) => {
  await login(page, salesUser.username, salesUser.password);

  await page.goto('/admin/access-governance');
  await expect(page).not.toHaveURL(/\/admin\/access-governance$/);
});
