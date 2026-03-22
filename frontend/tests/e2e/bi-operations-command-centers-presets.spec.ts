import { expect, test, type Page } from '@playwright/test';

import { adminUser, login } from './helpers/auth';

async function chooseSelectOptionByTestId(page: Page, testId: string, optionLabel: string) {
  await page.getByTestId(testId).locator('.ant-select').click({ force: true });
  await page.getByTitle(optionLabel).last().click();
  await expect(page.getByTestId(testId)).toContainText(optionLabel);
}

test('admin can save and re-apply preset in BI dashboard', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const presetName = `BI ${seed}`;

  await page.goto('/bi-dashboard');
  await expect(page.getByTestId('bi-dashboard-command-strip')).toBeVisible();

  await chooseSelectOptionByTestId(page, 'bi-dashboard-period-select', 'Quý');
  await page.getByTestId('bi-dashboard-save-view').click();
  await page.reload();
  await expect(page.getByTestId('bi-dashboard-command-strip')).toBeVisible();
  await chooseSelectOptionByTestId(page, 'bi-dashboard-period-select', 'Năm');
  await page.getByTestId('bi-dashboard-restore-view').click();
  await expect(page.getByTestId('bi-dashboard-period-select')).toContainText('Quý');

  await page.getByTestId('bi-dashboard-open-preset-modal').click();
  await page.getByTestId('bi-dashboard-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Luu mau/i }).click();
  await expect(page.getByTestId('bi-dashboard-preset-name')).toBeHidden();
  await chooseSelectOptionByTestId(page, 'bi-dashboard-period-select', 'Tháng');
  await chooseSelectOptionByTestId(page, 'bi-dashboard-preset-select', presetName);
  await page.getByTestId('bi-dashboard-apply-preset').click();
  await expect(page.getByTestId('bi-dashboard-period-select')).toContainText('Quý');
});

test('admin can save and re-apply preset in operations log workspace', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `ops-log-${seed}`;
  const presetName = `Ops ${seed}`;

  await page.goto('/operations-log');
  await expect(page.getByTestId('operations-log-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('operations-log-command-search').locator('input');
  await searchInput.fill(searchValue);
  await chooseSelectOptionByTestId(page, 'operations-log-success-filter', 'Thanh cong');
  await page.getByTestId('operations-log-save-view').click();
  await page.reload();
  await expect(page.getByTestId('operations-log-command-strip')).toBeVisible();
  searchInput = page.getByTestId('operations-log-command-search').locator('input');
  await searchInput.fill('tam-thoi-ops-log');
  await chooseSelectOptionByTestId(page, 'operations-log-success-filter', 'That bai');
  await page.getByTestId('operations-log-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);
  await expect(page.getByTestId('operations-log-success-filter')).toContainText('Thanh cong');

  await page.getByTestId('operations-log-open-preset-modal').click();
  await page.getByTestId('operations-log-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Luu mau/i }).click();
  await expect(page.getByTestId('operations-log-preset-name')).toBeHidden();
  await searchInput.fill('sau-khi-luu-ops-log');
  await chooseSelectOptionByTestId(page, 'operations-log-success-filter', 'Moi ket qua');
  await chooseSelectOptionByTestId(page, 'operations-log-preset-select', presetName);
  await page.getByTestId('operations-log-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
  await expect(page.getByTestId('operations-log-success-filter')).toContainText('Thanh cong');
});
