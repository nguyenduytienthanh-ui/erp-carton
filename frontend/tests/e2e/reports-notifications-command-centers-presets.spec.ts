import { expect, test, type Locator, type Page } from '@playwright/test';

import { adminUser, login } from './helpers/auth';

async function chooseVisibleAntdOptionByIndex(page: Page, trigger: Locator, index: number) {
  await trigger.click({ force: true });
  const option = page.locator('.ant-select-dropdown:visible .ant-select-item-option').nth(index);
  await expect(option).toBeVisible();
  const label = (await option.textContent())?.trim() || '';
  await option.evaluate((element) => element.scrollIntoView({ block: 'nearest' }));
  const box = await option.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  return label;
}

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

test('admin can save and re-apply preset in reports center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `reports-center-${seed}`;
  const presetName = `Reports ${seed}`;

  await page.goto('/reports');
  await expect(page.getByTestId('reports-center-command-strip')).toBeVisible();

  const searchInput = page.getByTestId('reports-center-search');
  await searchInput.fill(searchValue);
  await page.getByTestId('reports-center-save-view').click();
  await page.reload();
  await expect(page.getByTestId('reports-center-command-strip')).toBeVisible();
  await page.getByTestId('reports-center-search').fill('tam-thoi-reports-center');
  await page.getByTestId('reports-center-restore-view').click();
  await expect(page.getByTestId('reports-center-search')).toHaveValue(searchValue);

  await page.getByTestId('reports-center-open-preset-modal').click();
  const reportsPresetModal = page.getByRole('dialog', { name: /Lưu mẫu lọc báo cáo/i });
  await expect(reportsPresetModal).toBeVisible();
  await page.getByTestId('reports-center-preset-name').fill(presetName);
  await reportsPresetModal.getByRole('button', { name: /Lưu mẫu|Luu mau/i }).click();
  await expect(page.getByText('Đã lưu mẫu lọc báo cáo.')).toBeVisible({ timeout: 20_000 });
  await expect(reportsPresetModal).toBeHidden({ timeout: 20_000 });
  await page.getByTestId('reports-center-search').fill('sau-khi-luu-reports-center');
  await chooseVisibleAntdOptionByLabel(page, page.getByTestId('reports-center-preset-select').locator('.ant-select'), presetName);
  await page.getByTestId('reports-center-apply-preset').click();
  await expect(page.getByTestId('reports-center-search')).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in notification center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `notification-center-${seed}`;
  const presetName = `Notifications ${seed}`;

  await page.goto('/notifications');
  await expect(page.getByTestId('notification-center-command-strip')).toBeVisible();

  await page.getByTestId('notification-center-search').fill(searchValue);
  const unreadLabel = await chooseVisibleAntdOptionByIndex(
    page,
    page.locator('.workspace-toolbar .ant-select').nth(1),
    1,
  );
  await page.getByTestId('notification-center-save-view').click();
  await page.reload();
  await expect(page.getByTestId('notification-center-command-strip')).toBeVisible();
  await page.getByTestId('notification-center-search').fill('tam-thoi-notification-center');
  await chooseVisibleAntdOptionByIndex(
    page,
    page.locator('.workspace-toolbar .ant-select').nth(1),
    2,
  );
  await page.getByTestId('notification-center-restore-view').click();
  await expect(page.getByTestId('notification-center-search')).toHaveValue(searchValue);
  await expect(page.getByTestId('notification-center-read-filter')).toContainText(unreadLabel);

  await page.getByTestId('notification-center-open-preset-modal').click();
  const notificationPresetModal = page.getByRole('dialog', { name: /Lưu mẫu lọc thông báo/i });
  await expect(notificationPresetModal).toBeVisible();
  await page.getByTestId('notification-center-preset-name').fill(presetName);
  await notificationPresetModal.getByRole('button', { name: /Lưu mẫu|Luu mau/i }).click();
  await expect(page.getByText('Đã lưu mẫu lọc thông báo.')).toBeVisible({ timeout: 20_000 });
  await expect(notificationPresetModal).toBeHidden({ timeout: 20_000 });
  await page.getByTestId('notification-center-search').fill('sau-khi-luu-notification-center');
  await chooseVisibleAntdOptionByIndex(
    page,
    page.locator('.workspace-toolbar .ant-select').nth(1),
    0,
  );
  await chooseVisibleAntdOptionByLabel(page, page.getByTestId('notification-center-preset-select').locator('.ant-select'), presetName);
  await page.getByTestId('notification-center-apply-preset').click();
  await expect(page.getByTestId('notification-center-search')).toHaveValue(searchValue);
  await expect(page.getByTestId('notification-center-read-filter')).toContainText(unreadLabel);
});
