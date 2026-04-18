import { expect, test } from '@playwright/test';
import { adminUser, login, salesUser } from './helpers/auth';

test('admin can open offboarding desk and preview lifecycle cleanup', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/user-lifecycle');
  await expect(page.locator('main').getByText(/Bàn kết thúc vòng đời tài khoản|Offboarding desk/i)).toBeVisible();
  const userSelect = page.getByRole('combobox', { name: /Tài khoản cần xử lý/i });
  await expect(userSelect).toBeVisible();
  await expect(page.locator('main').getByText(/Watchlist xử lý vòng đời|Danh sách ưu tiên xử lý vòng đời/i)).toBeVisible();

  await userSelect.click();
  await page.locator('.ant-select-dropdown .ant-select-item-option').first().click();

  await page.getByRole('button', { name: /Xem trước|Preview/i }).click();
  await expect(page.getByText(/Kiểm tra trước khi xử lý|Preflight checks/i)).toBeVisible();
});

test('sales user is redirected away from offboarding desk', async ({ page }) => {
  await login(page, salesUser.username, salesUser.password);

  await page.goto('/admin/user-lifecycle');
  await expect(page).not.toHaveURL(/\/admin\/user-lifecycle$/);
});
