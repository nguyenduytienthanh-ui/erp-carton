import { expect, test } from '@playwright/test';
import { adminUser, login, salesUser } from './helpers/auth';

test('admin can open onboarding studio and save a preset', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/onboarding-studio');
  await expect(page.getByRole('button', { name: /Tạo preset/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('main')).toContainText('Trợ lý triển khai công việc', { timeout: 20_000 });
  await expect(page.locator('main')).toContainText('Danh mục preset', { timeout: 20_000 });
  await expect(page.locator('main')).toContainText('Không gian rollout', { timeout: 20_000 });

  await page.getByRole('button', { name: /Tạo preset/i }).click();
  await expect(page.getByText('Studio preset', { exact: true }).last()).toBeVisible();

  await page.getByLabel('Khóa preset').fill('ops-checklist-ui');
  await page.getByLabel('Tên preset').fill('Ops Checklist UI');
  await page.getByLabel('Mô tả').fill('Preset tạo từ Playwright cho trợ lý triển khai công việc.');
  await page.getByLabel('Checklist').fill('Welcome call\nReview SOP');

  await page.getByRole('button', { name: /Lưu preset/i }).click();
  await expect(page.getByText('Ops Checklist UI', { exact: true }).first()).toBeVisible();
});

test('sales user is redirected away from onboarding studio', async ({ page }) => {
  await login(page, salesUser.username, salesUser.password);

  await page.goto('/admin/onboarding-studio');
  await expect(page).not.toHaveURL(/\/admin\/onboarding-studio$/);
});
