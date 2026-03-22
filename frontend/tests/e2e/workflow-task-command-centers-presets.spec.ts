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

test('admin can save and re-apply preset in workflow task templates', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `workflow-template-${seed}`;
  const presetName = `Workflow template ${seed}`;

  await page.goto('/workflow-task-templates');
  await expect(page.getByTestId('workflow-task-templates-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('workflow-task-templates-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('workflow-task-templates-save-view').click();

  await page.reload();
  await expect(page.getByTestId('workflow-task-templates-command-strip')).toBeVisible();
  searchInput = page.getByTestId('workflow-task-templates-search').locator('input');
  await searchInput.fill('tam-thoi-workflow-template');
  await page.getByTestId('workflow-task-templates-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('workflow-task-templates-open-preset-modal').click();
  await page.getByTestId('workflow-task-templates-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu|Luu mau/i }).click();
  await expect(page.getByTestId('workflow-task-templates-preset-name')).toBeHidden();

  await searchInput.fill('sau-khi-luu-template');
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('workflow-task-templates-preset-select').locator('.ant-select'),
    presetName,
  );
  await page.getByTestId('workflow-task-templates-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in workflow pipeline board', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `workflow-pipeline-${seed}`;
  const presetName = `Workflow pipeline ${seed}`;

  await page.goto('/workflow-pipeline');
  await expect(page.getByTestId('workflow-pipeline-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('workflow-pipeline-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('workflow-pipeline-save-view').click();

  await page.reload();
  await expect(page.getByTestId('workflow-pipeline-command-strip')).toBeVisible();
  searchInput = page.getByTestId('workflow-pipeline-search').locator('input');
  await searchInput.fill('tam-thoi-workflow-pipeline');
  await page.getByTestId('workflow-pipeline-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('workflow-pipeline-open-preset-modal').click();
  await page.getByTestId('workflow-pipeline-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu|Luu/i }).click();
  await expect(page.getByTestId('workflow-pipeline-preset-name')).toBeHidden();

  await searchInput.fill('sau-khi-luu-pipeline');
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('workflow-pipeline-preset-select').locator('.ant-select'),
    presetName,
  );
  await page.getByTestId('workflow-pipeline-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in task inbox', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `task-inbox-${seed}`;
  const presetName = `Task inbox ${seed}`;

  await page.goto('/task-inbox');
  await expect(page.getByTestId('task-inbox-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('task-inbox-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('task-inbox-save-view').click();

  await page.reload();
  await expect(page.getByTestId('task-inbox-command-strip')).toBeVisible();
  searchInput = page.getByTestId('task-inbox-search').locator('input');
  await searchInput.fill('tam-thoi-task-inbox');
  await page.getByTestId('task-inbox-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('task-inbox-open-preset-modal').click();
  await page.getByTestId('task-inbox-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu|Luu/i }).click();
  await expect(page.getByTestId('task-inbox-preset-name')).toBeHidden();

  await searchInput.fill('sau-khi-luu-task-inbox');
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('task-inbox-preset-select').locator('.ant-select'),
    presetName,
  );
  await page.getByTestId('task-inbox-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});
