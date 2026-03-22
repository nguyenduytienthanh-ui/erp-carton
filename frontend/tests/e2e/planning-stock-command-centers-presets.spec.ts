import { expect, test, type Page } from '@playwright/test';

import { adminUser, login } from './helpers/auth';

async function chooseSelectOptionByTestId(page: Page, testId: string, optionLabel: string) {
  await page.getByTestId(testId).locator('.ant-select').click({ force: true });
  await page.getByTitle(optionLabel).last().click();
  await expect(page.getByTestId(testId)).toContainText(optionLabel);
}

test('admin can save and re-apply preset in inventory stock command center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `inventory-stock-${seed}`;
  const presetName = `Tồn kho ${seed}`;

  await page.goto('/inventory-stock');
  await expect(page.getByTestId('inventory-stock-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('inventory-stock-command-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('inventory-stock-save-view').click();
  await page.reload();
  await expect(page.getByTestId('inventory-stock-command-strip')).toBeVisible();
  searchInput = page.getByTestId('inventory-stock-command-search').locator('input');
  await searchInput.fill('tam-thoi-inventory-stock');
  await page.getByTestId('inventory-stock-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('inventory-stock-open-preset-modal').click();
  await page.getByTestId('inventory-stock-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('inventory-stock-preset-name')).toBeHidden();
  await searchInput.fill('sau-khi-luu-inventory-stock');
  await chooseSelectOptionByTestId(page, 'inventory-stock-preset-select', presetName);
  await page.getByTestId('inventory-stock-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in stock alerts command center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `stock-alerts-${seed}`;
  const presetName = `Cảnh báo ${seed}`;

  await page.goto('/stock-alerts');
  await expect(page.getByTestId('stock-alerts-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('stock-alerts-command-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('stock-alerts-save-view').click();
  await page.reload();
  await expect(page.getByTestId('stock-alerts-command-strip')).toBeVisible();
  searchInput = page.getByTestId('stock-alerts-command-search').locator('input');
  await searchInput.fill('tam-thoi-stock-alerts');
  await page.getByTestId('stock-alerts-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('stock-alerts-open-preset-modal').click();
  await page.getByTestId('stock-alerts-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('stock-alerts-preset-name')).toBeHidden();
  await searchInput.fill('sau-khi-luu-stock-alerts');
  await chooseSelectOptionByTestId(page, 'stock-alerts-preset-select', presetName);
  await page.getByTestId('stock-alerts-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in purchase order forecast command center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const presetName = `Forecast mua ${seed}`;

  await page.goto('/purchase-order-forecast');
  await expect(page.getByTestId('purchase-order-forecast-command-strip')).toBeVisible();

  await chooseSelectOptionByTestId(page, 'purchase-order-forecast-months', '6 thang');
  await chooseSelectOptionByTestId(page, 'purchase-order-forecast-lead-time', '21 ngay');
  await page.getByTestId('purchase-order-forecast-save-view').click();
  await page.reload();
  await expect(page.getByTestId('purchase-order-forecast-command-strip')).toBeVisible();
  await chooseSelectOptionByTestId(page, 'purchase-order-forecast-months', '1 thang');
  await chooseSelectOptionByTestId(page, 'purchase-order-forecast-lead-time', '7 ngay');
  await page.getByTestId('purchase-order-forecast-restore-view').click();
  await expect(page.getByTestId('purchase-order-forecast-months')).toContainText('6 thang');
  await expect(page.getByTestId('purchase-order-forecast-lead-time')).toContainText('21 ngay');

  await page.getByTestId('purchase-order-forecast-open-preset-modal').click();
  await page.getByTestId('purchase-order-forecast-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('purchase-order-forecast-preset-name')).toBeHidden();
  await chooseSelectOptionByTestId(page, 'purchase-order-forecast-months', '3 thang');
  await chooseSelectOptionByTestId(page, 'purchase-order-forecast-lead-time', '14 ngay');
  await chooseSelectOptionByTestId(page, 'purchase-order-forecast-preset-select', presetName);
  await page.getByTestId('purchase-order-forecast-apply-preset').click();
  await expect(page.getByTestId('purchase-order-forecast-months')).toContainText('6 thang');
  await expect(page.getByTestId('purchase-order-forecast-lead-time')).toContainText('21 ngay');
});

test('admin can save and re-apply preset in inventory forecast command center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const presetName = `Forecast tồn ${seed}`;

  await page.goto('/inventory-forecast');
  await expect(page.getByTestId('inventory-forecast-command-strip')).toBeVisible();

  await chooseSelectOptionByTestId(page, 'inventory-forecast-months', '6 thang');
  await chooseSelectOptionByTestId(page, 'inventory-forecast-lead-time', '21 ngay');
  await chooseSelectOptionByTestId(page, 'inventory-forecast-sort-by', 'EOQ');
  await page.getByTestId('inventory-forecast-save-view').click();
  await page.reload();
  await expect(page.getByTestId('inventory-forecast-command-strip')).toBeVisible();
  await chooseSelectOptionByTestId(page, 'inventory-forecast-months', '1 thang');
  await chooseSelectOptionByTestId(page, 'inventory-forecast-lead-time', '7 ngay');
  await chooseSelectOptionByTestId(page, 'inventory-forecast-sort-by', 'ABC');
  await page.getByTestId('inventory-forecast-restore-view').click();
  await expect(page.getByTestId('inventory-forecast-months')).toContainText('6 thang');
  await expect(page.getByTestId('inventory-forecast-lead-time')).toContainText('21 ngay');
  await expect(page.getByTestId('inventory-forecast-sort-by')).toContainText('EOQ');

  await page.getByTestId('inventory-forecast-open-preset-modal').click();
  await page.getByTestId('inventory-forecast-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('inventory-forecast-preset-name')).toBeHidden();
  await chooseSelectOptionByTestId(page, 'inventory-forecast-months', '3 thang');
  await chooseSelectOptionByTestId(page, 'inventory-forecast-lead-time', '14 ngay');
  await chooseSelectOptionByTestId(page, 'inventory-forecast-sort-by', 'Rui ro');
  await chooseSelectOptionByTestId(page, 'inventory-forecast-preset-select', presetName);
  await page.getByTestId('inventory-forecast-apply-preset').click();
  await expect(page.getByTestId('inventory-forecast-months')).toContainText('6 thang');
  await expect(page.getByTestId('inventory-forecast-lead-time')).toContainText('21 ngay');
  await expect(page.getByTestId('inventory-forecast-sort-by')).toContainText('EOQ');
});
