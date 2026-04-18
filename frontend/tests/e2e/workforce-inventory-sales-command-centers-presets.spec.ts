import { expect, test, type Locator, type Page } from '@playwright/test';

import { adminUser, login } from './helpers/auth';

async function chooseVisibleAntdOptionByLabel(page: Page, trigger: Locator, label: string) {
  await trigger.click({ force: true });
  const option = page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: label }).last();
  await expect(option).toBeVisible();
  await option.evaluate((element) => element.scrollIntoView({ block: 'nearest' }));
  const box = await option.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
}

test('admin can save and re-apply preset in employee center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `employee-${seed}`;
  const presetName = `Employees ${seed}`;

  await page.goto('/employees');
  await expect(page.getByTestId('employees-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('employees-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('employees-save-view').click();

  await page.reload();
  await expect(page.getByTestId('employees-command-strip')).toBeVisible();
  searchInput = page.getByTestId('employees-search').locator('input');
  await searchInput.fill('tam-thoi-employees');
  await page.getByTestId('employees-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('employees-open-preset-modal').click();
  await page.getByTestId('employees-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu|Luu mau/i }).click();
  await expect(page.getByTestId('employees-preset-name')).toBeHidden();

  await searchInput.fill('sau-khi-luu-employees');
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('employees-preset-select').locator('.ant-select'),
    presetName,
  );
  await page.getByTestId('employees-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in warehouse transfer center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `warehouse-transfer-${seed}`;
  const presetName = `Warehouse transfer ${seed}`;

  await page.goto('/warehouse-transfers');
  await expect(page.getByTestId('warehouse-transfers-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('warehouse-transfers-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('warehouse-transfers-save-view').click();

  await page.reload();
  await expect(page.getByTestId('warehouse-transfers-command-strip')).toBeVisible();
  searchInput = page.getByTestId('warehouse-transfers-search').locator('input');
  await searchInput.fill('tam-thoi-warehouse-transfer');
  await page.getByTestId('warehouse-transfers-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('warehouse-transfers-open-preset-modal').click();
  await page.getByTestId('warehouse-transfers-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu|Luu mau/i }).click();
  await expect(page.getByTestId('warehouse-transfers-preset-name')).toBeHidden();

  await searchInput.fill('sau-khi-luu-warehouse-transfer');
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('warehouse-transfers-preset-select').locator('.ant-select'),
    presetName,
  );
  await page.getByTestId('warehouse-transfers-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in sales orders center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `sales-order-${seed}`;
  const presetName = `Sales orders ${seed}`;

  await page.goto('/sales-orders');
  await expect(page.getByTestId('sales-orders-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('sales-orders-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('sales-orders-save-view').click();

  await page.reload();
  await expect(page.getByTestId('sales-orders-command-strip')).toBeVisible();
  searchInput = page.getByTestId('sales-orders-search').locator('input');
  await searchInput.fill('tam-thoi-sales-orders');
  await page.getByTestId('sales-orders-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('sales-orders-open-preset-modal').click();
  await page.getByTestId('sales-orders-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu|Luu mau/i }).click();
  await expect(page.getByTestId('sales-orders-preset-name')).toBeHidden();

  await searchInput.fill('sau-khi-luu-sales-orders');
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('sales-orders-preset-select').locator('.ant-select'),
    presetName,
  );
  await page.getByTestId('sales-orders-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});
