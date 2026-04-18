import { expect, test } from '@playwright/test';
import { adminUser, login } from './helpers/auth';

test('paper optimization is discoverable from palette, dashboard, and direct route for production manager', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/');
  await expect(page.getByText('Tối ưu ghép giấy', { exact: true })).toBeVisible();
  await expect(page.getByTestId('dashboard-restore-paper-optimization')).toBeVisible();

  await page.getByTestId('command-palette-open-button').click();
  const searchInput = page.getByTestId('command-palette-search-input');
  await searchInput.fill('toi uu ghep giay');
  await expect(page.getByTestId('command-palette-result-paper-optimization')).toBeVisible();

  await page.goto('/paper-optimization');
  await expect(page.getByTestId('paper-optimizer-root')).toBeVisible();
  await expect(page.locator('main')).toContainText('Tối ưu ghép giấy');
});
