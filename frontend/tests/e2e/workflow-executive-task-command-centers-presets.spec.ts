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

test('admin can save and re-apply preset in workflow analytics dashboard', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const presetName = `Workflow analytics ${seed}`;
  const actorValue = `actor-${seed}`;

  await page.goto('/workflow-analytics');
  await expect(page.getByTestId('workflow-analytics-command-strip')).toBeVisible();
  await expect(page.getByTestId('workflow-analytics-save-view')).toBeEnabled();

  const selectedWindow = await chooseVisibleAntdOptionByIndex(
    page,
    page.getByTestId('workflow-analytics-window-filter').locator('.ant-select'),
    3,
  );
  await expect(page.getByTestId('workflow-analytics-window-filter')).toContainText(selectedWindow);
  await page.getByTestId('workflow-analytics-save-view').click();
  await expect(page.locator('.ant-message-notice').last()).toContainText(/Lưu chế độ xem|lưu chế độ xem/i);

  await page.reload();
  await expect(page.getByTestId('workflow-analytics-command-strip')).toBeVisible();
  await chooseVisibleAntdOptionByIndex(
    page,
    page.getByTestId('workflow-analytics-window-filter').locator('.ant-select'),
    0,
  );
  await expect(page.getByTestId('workflow-analytics-window-filter')).not.toContainText(selectedWindow);
  await page.getByTestId('workflow-analytics-restore-view').click();
  await expect(page.getByTestId('workflow-analytics-window-filter')).toContainText(selectedWindow);

  await page.getByTestId('workflow-analytics-history-actor-search').fill(actorValue);
  await page.getByTestId('workflow-analytics-open-preset-modal').click();
  await page.getByTestId('workflow-analytics-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu|Luu mau/i }).click();
  await expect(page.getByTestId('workflow-analytics-preset-name')).toBeHidden();
  await page.getByTestId('workflow-analytics-history-actor-search').fill('tam-thoi-workflow-analytics');
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('workflow-analytics-preset-select').locator('.ant-select'),
    presetName,
  );
  await page.getByTestId('workflow-analytics-apply-preset').click();
  await expect(page.getByTestId('workflow-analytics-history-actor-search')).toHaveValue(actorValue);
});

test('admin can save and re-apply preset in executive cockpit', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const presetName = `Executive ${seed}`;

  await page.goto('/executive-cockpit');
  await expect(page.getByTestId('executive-cockpit-command-strip')).toBeVisible();
  await expect(page.getByTestId('executive-cockpit-save-view')).toBeEnabled();

  const selectedShift = await chooseVisibleAntdOptionByIndex(
    page,
    page.getByTestId('executive-cockpit-shift-filter').locator('.ant-select'),
    1,
  );
  await expect(page.getByTestId('executive-cockpit-shift-filter')).toContainText(selectedShift);
  await page.getByTestId('executive-cockpit-save-view').click();
  await expect(page.locator('.ant-message-notice').last()).toContainText(/Lưu chế độ xem|lưu chế độ xem/i);

  await page.reload();
  await expect(page.getByTestId('executive-cockpit-command-strip')).toBeVisible();
  await expect(page.getByTestId('executive-cockpit-restore-view')).toBeEnabled();
  await chooseVisibleAntdOptionByIndex(
    page,
    page.getByTestId('executive-cockpit-shift-filter').locator('.ant-select'),
    2,
  );
  await expect(page.getByTestId('executive-cockpit-shift-filter')).not.toContainText(selectedShift);
  await page.getByTestId('executive-cockpit-restore-view').click();
  await expect(page.getByTestId('executive-cockpit-shift-filter')).toContainText(selectedShift);

  await page.getByTestId('executive-cockpit-open-preset-modal').click();
  await page.getByTestId('executive-cockpit-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu|Luu mau/i }).click();
  await expect(page.getByTestId('executive-cockpit-preset-name')).toBeHidden();

  await chooseVisibleAntdOptionByIndex(
    page,
    page.getByTestId('executive-cockpit-shift-filter').locator('.ant-select'),
    3,
  );
  await expect(page.getByTestId('executive-cockpit-shift-filter')).not.toContainText(selectedShift);
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('executive-cockpit-preset-select').locator('.ant-select'),
    presetName,
  );
  await page.getByTestId('executive-cockpit-apply-preset').click();
  await expect(page.getByTestId('executive-cockpit-shift-filter')).toContainText(selectedShift);
});

test('admin can save and re-apply preset in task operations board', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `task-operations-${seed}`;
  const presetName = `Task operations ${seed}`;

  await page.goto('/task-operations');
  await expect(page.getByTestId('task-operations-command-strip')).toBeVisible();

  await page.getByTestId('task-operations-search').fill(searchValue);
  const selectedFilter = await chooseVisibleAntdOptionByIndex(
    page,
    page.getByTestId('task-operations-filter-select').locator('.ant-select'),
    2,
  );
  await page.getByTestId('task-operations-save-view').click();

  await page.reload();
  await expect(page.getByTestId('task-operations-command-strip')).toBeVisible();
  await page.getByTestId('task-operations-search').fill('tam-thoi-task-operations');
  await chooseVisibleAntdOptionByIndex(
    page,
    page.getByTestId('task-operations-filter-select').locator('.ant-select'),
    0,
  );
  await page.getByTestId('task-operations-restore-view').click();
  await expect(page.getByTestId('task-operations-search')).toHaveValue(searchValue);
  await expect(page.getByTestId('task-operations-filter-select')).toContainText(selectedFilter);

  await page.getByTestId('task-operations-open-preset-modal').click();
  await page.getByTestId('task-operations-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu|Luu mau/i }).click();
  await expect(page.getByTestId('task-operations-preset-name')).toBeHidden();

  await page.getByTestId('task-operations-search').fill('sau-khi-luu-task-operations');
  await chooseVisibleAntdOptionByIndex(
    page,
    page.getByTestId('task-operations-filter-select').locator('.ant-select'),
    4,
  );
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('task-operations-preset-select').locator('.ant-select'),
    presetName,
  );
  await page.getByTestId('task-operations-apply-preset').click();
  await expect(page.getByTestId('task-operations-search')).toHaveValue(searchValue);
  await expect(page.getByTestId('task-operations-filter-select')).toContainText(selectedFilter);
});
