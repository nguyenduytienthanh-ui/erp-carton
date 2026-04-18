import { expect, test } from '@playwright/test';
import { adminUser, login, salesUser } from './helpers/auth';

test('admin can inspect user control center and access orchestration drawer', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/users');
  await expect(page.getByRole('button', { name: /Xuất CSV/i }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('main')).toContainText('Trung tâm điều phối người dùng', { timeout: 20_000 });
  await expect(page.locator('main')).toContainText('Nhật ký điều phối truy cập', { timeout: 20_000 });
  await expect(page.locator('main')).toContainText('Hàng chờ cần rà soát', { timeout: 20_000 });

  await page.getByRole('button', { name: 'Mở chi tiết' }).first().click();
  await expect(page.getByText('Hồ sơ điều phối', { exact: false }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lưu vai trò và nhóm' })).toBeVisible();
  await expect(page.getByText('Khuyến nghị xử lý', { exact: true })).toBeVisible();
  await expect(page.getByText('Nhật ký truy cập của người dùng', { exact: true })).toBeVisible();
});

test('sales user is redirected away from user control center', async ({ page }) => {
  await login(page, salesUser.username, salesUser.password);

  await page.goto('/admin/users');
  await expect(page).not.toHaveURL(/\/admin\/users$/);
});
