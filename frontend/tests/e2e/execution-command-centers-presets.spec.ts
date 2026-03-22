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

test('admin can save and re-apply preset in shipment center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `shipment-${seed}`;
  const presetName = `Shipment ${seed}`;

  await page.goto('/shipments');
  await expect(page.getByTestId('shipments-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('shipments-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('shipments-save-view').click();

  await page.reload();
  await expect(page.getByTestId('shipments-command-strip')).toBeVisible();
  searchInput = page.getByTestId('shipments-search').locator('input');
  await searchInput.fill('tam-thoi-shipment');
  await page.getByTestId('shipments-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('shipments-open-preset-modal').click();
  await page.getByTestId('shipments-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu|Luu mau/i }).click();
  await expect(page.getByTestId('shipments-preset-name')).toBeHidden();

  await searchInput.fill('sau-khi-luu-shipment');
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('shipments-preset-select').locator('.ant-select'),
    presetName,
  );
  await page.getByTestId('shipments-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in inventory transactions center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `inventory-tx-${seed}`;
  const presetName = `Inventory tx ${seed}`;

  await page.goto('/inventory-transactions');
  await expect(page.getByTestId('inventory-transactions-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('inventory-transactions-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('inventory-transactions-save-view').click();

  await page.reload();
  await expect(page.getByTestId('inventory-transactions-command-strip')).toBeVisible();
  searchInput = page.getByTestId('inventory-transactions-search').locator('input');
  await searchInput.fill('tam-thoi-inventory-tx');
  await page.getByTestId('inventory-transactions-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('inventory-transactions-open-preset-modal').click();
  await page.getByTestId('inventory-transactions-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu|Luu mau/i }).click();
  await expect(page.getByTestId('inventory-transactions-preset-name')).toBeHidden();

  await searchInput.fill('sau-khi-luu-inventory-tx');
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('inventory-transactions-preset-select').locator('.ant-select'),
    presetName,
  );
  await page.getByTestId('inventory-transactions-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in stocktake center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const presetName = `Stocktake ${seed}`;

  await page.goto('/stocktakes');
  await expect(page.getByTestId('stocktakes-command-strip')).toBeVisible();

  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('stocktakes-status-filter').locator('.ant-select'),
    'Nháp',
  );
  await page.getByTestId('stocktakes-save-view').click();
  await expect(page.getByText('Có chế độ xem đã lưu')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('stocktakes-command-strip')).toBeVisible();
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('stocktakes-status-filter').locator('.ant-select'),
    'Đã hoàn tất',
  );
  await page.getByTestId('stocktakes-restore-view').click();
  await expect(page.getByTestId('stocktakes-status-filter')).toContainText('Nháp');

  await page.getByTestId('stocktakes-open-preset-modal').click();
  await page.getByTestId('stocktakes-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu|Luu mau/i }).click();
  await expect(page.getByTestId('stocktakes-preset-name')).toBeHidden();

  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('stocktakes-status-filter').locator('.ant-select'),
    'Đã hoàn tất',
  );
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('stocktakes-preset-select').locator('.ant-select'),
    presetName,
  );
  await page.getByTestId('stocktakes-apply-preset').click();
  await expect(page.getByTestId('stocktakes-status-filter')).toContainText('Nháp');
});
