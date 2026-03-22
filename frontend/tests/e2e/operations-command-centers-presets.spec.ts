import { expect, test, type Page } from '@playwright/test';

import { adminUser, login } from './helpers/auth';

async function chooseSelectOptionByTestId(page: Page, testId: string, optionLabel: string) {
  await page.getByTestId(testId).locator('.ant-select').click({ force: true });
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId(testId)).toContainText(optionLabel);
}

test('admin can save and re-apply preset in purchase order command center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `purchase-orders-${seed}`;
  const presetName = `Đơn mua ${seed}`;

  await page.goto('/purchase-orders');
  await expect(page.getByTestId('purchase-orders-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('purchase-orders-command-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('purchase-orders-save-view').click();
  await page.reload();
  await expect(page.getByTestId('purchase-orders-command-strip')).toBeVisible();
  searchInput = page.getByTestId('purchase-orders-command-search').locator('input');
  await searchInput.fill('tam-thoi-purchase-orders');
  await page.getByTestId('purchase-orders-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('purchase-orders-open-preset-modal').click();
  await page.getByTestId('purchase-orders-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('purchase-orders-preset-name')).toBeHidden();
  await searchInput.fill('sau-khi-luu-purchase-orders');
  await chooseSelectOptionByTestId(page, 'purchase-orders-preset-select', presetName);
  await page.getByTestId('purchase-orders-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in purchase receipt command center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `purchase-receipts-${seed}`;
  const presetName = `Phiếu nhập ${seed}`;

  await page.goto('/purchase-receipts');
  await expect(page.getByTestId('purchase-receipts-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('purchase-receipts-command-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('purchase-receipts-lane-posted-today').click();
  await page.getByTestId('purchase-receipts-save-view').click();
  await page.reload();
  await expect(page.getByTestId('purchase-receipts-command-strip')).toBeVisible();
  searchInput = page.getByTestId('purchase-receipts-command-search').locator('input');
  await searchInput.fill('tam-thoi-purchase-receipts');
  await page.getByTestId('purchase-receipts-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);
  await expect(page.locator('main').getByText('Làn điều phối: Ghi sổ hôm nay', { exact: true })).toBeVisible();

  await page.getByTestId('purchase-receipts-open-preset-modal').click();
  await page.getByTestId('purchase-receipts-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('purchase-receipts-preset-name')).toBeHidden();
  await searchInput.fill('sau-khi-luu-purchase-receipts');
  await page.getByTestId('purchase-receipts-lane-all').click();
  await chooseSelectOptionByTestId(page, 'purchase-receipts-preset-select', presetName);
  await page.getByTestId('purchase-receipts-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
  await expect(page.locator('main').getByText('Làn điều phối: Ghi sổ hôm nay', { exact: true })).toBeVisible();
});

test('admin can save and re-apply preset in purchase return command center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `purchase-returns-${seed}`;
  const presetName = `Trả hàng ${seed}`;

  await page.goto('/purchase-returns');
  await expect(page.getByTestId('purchase-returns-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('purchase-returns-command-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('purchase-returns-lane-pending-approval').click();
  await page.getByTestId('purchase-returns-save-view').click();
  await page.reload();
  await expect(page.getByTestId('purchase-returns-command-strip')).toBeVisible();
  searchInput = page.getByTestId('purchase-returns-command-search').locator('input');
  await searchInput.fill('tam-thoi-purchase-returns');
  await page.getByTestId('purchase-returns-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);
  await expect(page.locator('main').getByText('Làn điều phối: Chờ duyệt', { exact: true })).toBeVisible();

  await page.getByTestId('purchase-returns-open-preset-modal').click();
  await page.getByTestId('purchase-returns-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('purchase-returns-preset-name')).toBeHidden();
  await searchInput.fill('sau-khi-luu-purchase-returns');
  await page.getByTestId('purchase-returns-lane-all').click();
  await chooseSelectOptionByTestId(page, 'purchase-returns-preset-select', presetName);
  await page.getByTestId('purchase-returns-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
  await expect(page.locator('main').getByText('Làn điều phối: Chờ duyệt', { exact: true })).toBeVisible();
});

test('admin can save and re-apply preset in material issue command center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `material-issues-${seed}`;
  const presetName = `Cấp vật tư ${seed}`;

  await page.goto('/material-issues');
  await expect(page.getByTestId('material-issues-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('material-issues-command-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('material-issues-lane-posted-today').click();
  await page.getByTestId('material-issues-save-view').click();
  await page.reload();
  await expect(page.getByTestId('material-issues-command-strip')).toBeVisible();
  searchInput = page.getByTestId('material-issues-command-search').locator('input');
  await searchInput.fill('tam-thoi-material-issues');
  await page.getByTestId('material-issues-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);
  await expect(page.locator('main').getByText('Làn điều phối: Cấp hôm nay', { exact: true })).toBeVisible();

  await page.getByTestId('material-issues-open-preset-modal').click();
  await page.getByTestId('material-issues-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('material-issues-preset-name')).toBeHidden();
  await searchInput.fill('sau-khi-luu-material-issues');
  await page.getByTestId('material-issues-lane-all').click();
  await chooseSelectOptionByTestId(page, 'material-issues-preset-select', presetName);
  await page.getByTestId('material-issues-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
  await expect(page.locator('main').getByText('Làn điều phối: Cấp hôm nay', { exact: true })).toBeVisible();
});

test('admin can save and re-apply preset in production order command center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `production-orders-${seed}`;
  const presetName = `Lệnh sản xuất ${seed}`;

  await page.goto('/production-orders');
  await expect(page.getByTestId('production-orders-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('production-orders-command-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('production-orders-lane-pending-approval').click();
  await page.getByTestId('production-orders-save-view').click();
  await page.reload();
  await expect(page.getByTestId('production-orders-command-strip')).toBeVisible();
  searchInput = page.getByTestId('production-orders-command-search').locator('input');
  await searchInput.fill('tam-thoi-production-orders');
  await page.getByTestId('production-orders-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);
  await expect(page.locator('main').getByText('Làn điều phối: Chờ duyệt', { exact: true })).toBeVisible();

  await page.getByTestId('production-orders-open-preset-modal').click();
  await page.getByTestId('production-orders-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('production-orders-preset-name')).toBeHidden();
  await searchInput.fill('sau-khi-luu-production-orders');
  await page.getByTestId('production-orders-lane-all').click();
  await chooseSelectOptionByTestId(page, 'production-orders-preset-select', presetName);
  await page.getByTestId('production-orders-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
  await expect(page.locator('main').getByText('Làn điều phối: Chờ duyệt', { exact: true })).toBeVisible();
});

test('admin can save and re-apply preset in production receipt command center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `production-receipts-${seed}`;
  const presetName = `Nhập thành phẩm ${seed}`;

  await page.goto('/production-receipts');
  await expect(page.getByTestId('production-receipts-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('production-receipts-command-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('production-receipts-lane-posted-today').click();
  await page.getByTestId('production-receipts-save-view').click();
  await page.reload();
  await expect(page.getByTestId('production-receipts-command-strip')).toBeVisible();
  searchInput = page.getByTestId('production-receipts-command-search').locator('input');
  await searchInput.fill('tam-thoi-production-receipts');
  await page.getByTestId('production-receipts-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);
  await expect(page.locator('main').getByText('Làn điều phối: Nhập hôm nay', { exact: true })).toBeVisible();

  await page.getByTestId('production-receipts-open-preset-modal').click();
  await page.getByTestId('production-receipts-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('production-receipts-preset-name')).toBeHidden();
  await searchInput.fill('sau-khi-luu-production-receipts');
  await page.getByTestId('production-receipts-lane-all').click();
  await chooseSelectOptionByTestId(page, 'production-receipts-preset-select', presetName);
  await page.getByTestId('production-receipts-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
  await expect(page.locator('main').getByText('Làn điều phối: Nhập hôm nay', { exact: true })).toBeVisible();
});
