import { expect, test } from '@playwright/test';
import { adminUser, login, salesUser } from './helpers/auth';

test('admin can open the global command palette, jump to observability, and see recent destinations', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.getByTestId('command-palette-open-button').click();
  await expect(page.getByTestId('command-palette-modal')).toBeVisible();

  const searchInput = page.getByTestId('command-palette-search-input');
  await searchInput.fill('suc khoe he thong');
  const observabilityResult = page.getByTestId('command-palette-result-admin-observability');
  await expect(observabilityResult).toBeVisible();
  await observabilityResult.click();
  await expect(page).toHaveURL(/\/admin\/observability$/);

  await page.getByTestId('command-palette-open-button').click();
  await expect(page.getByTestId('command-palette-recent-admin-observability')).toBeVisible();
});

test('sales user only sees allowed destinations in the global command palette', async ({ page }) => {
  await login(page, salesUser.username, salesUser.password);

  await page.getByTestId('command-palette-open-button').click();
  await expect(page.getByTestId('command-palette-modal')).toBeVisible();

  const searchInput = page.getByTestId('command-palette-search-input');
  await searchInput.fill('suc khoe he thong');
  await expect(page.getByTestId('command-palette-result-admin-observability')).toHaveCount(0);

  await searchInput.clear();
  await searchInput.fill('don hang xuat');
  const salesOrdersResult = page.getByTestId('command-palette-result-sales-orders');
  await expect(salesOrdersResult).toBeVisible();
  await salesOrdersResult.click();
  await expect(page).toHaveURL(/\/sales-orders$/);
});

test('admin can pin a destination in the global command palette for quick access', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.getByTestId('command-palette-open-button').click();
  await expect(page.getByTestId('command-palette-modal')).toBeVisible();

  const searchInput = page.getByTestId('command-palette-search-input');
  await searchInput.fill('bao cao');

  const reportsResult = page.getByTestId('command-palette-result-reports');
  await expect(reportsResult).toBeVisible();

  await page.getByTestId('command-palette-toggle-favorite-reports').click();
  await expect(page.getByTestId('command-palette-favorite-reports')).toBeVisible();
});
