import { expect, test } from '@playwright/test';
import { adminUser, login, salesUser } from './helpers/auth';

test('admin can inspect finance advance command center policies and workspace', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/advance-transactions');
  await expect(page.locator('main').getByText('Trung tâm tạm ứng và quyết toán')).toBeVisible();
  await expect(page.locator('main').getByText('Điều phối phiếu tạm ứng')).toBeVisible();

  await page.getByRole('tab', { name: 'Chính sách & lịch sử' }).click();
  await expect(page.getByText('Chính sách nhắc quyết toán', { exact: true })).toBeVisible();
  await expect(page.getByText('Chính sách SLA duyệt', { exact: true })).toBeVisible();
  await expect(page.getByText('Lịch sử nhắc SLA duyệt', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Cấu hình SLA duyệt' }).click();
  await expect(page.getByRole('dialog').getByText('Chính sách SLA duyệt tạm ứng')).toBeVisible();
  await expect(page.getByLabel('Ngưỡng escalation cấp 1 (giờ)')).toBeVisible();
  await expect(page.getByLabel('Ngưỡng escalation cấp 2 (giờ)')).toBeVisible();
  await expect(page.getByLabel('Cooldown escalation (giờ)')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Tác nghiệp phiếu' }).click();
  await expect(page.getByText('Phiếu tạm ứng', { exact: true })).toBeVisible();
  await expect(page.getByText('Quyết toán', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Tìm kiếm mã phiếu, người nhận, mục đích...')).toBeVisible();
});

test('admin can inspect workforce salary advance command center policy and reminder history', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/salary-advance');
  await expect(page.locator('main').getByText('Trung tâm điều phối ứng lương')).toBeVisible();
  await expect(page.getByText('Hàng đợi duyệt và cảnh báo tắc nghẽn')).toBeVisible();
  await expect(page.getByText('Chính sách SLA duyệt ứng lương')).toBeVisible();
  await expect(page.getByText('Chi tiết lịch sử nhắc SLA duyệt ứng lương')).toBeVisible();

  await page.getByRole('button', { name: 'Cấu hình SLA' }).first().click();
  await expect(page.getByRole('dialog').getByText('Chính sách SLA duyệt ứng lương')).toBeVisible();
  await expect(page.getByLabel('Ngưỡng escalation L1 (giờ)')).toBeVisible();
  await expect(page.getByLabel('Ngưỡng escalation L2 (giờ)')).toBeVisible();
  await expect(page.getByLabel('Cooldown escalation (giờ)')).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(page.getByRole('button', { name: 'Mô phỏng nhắc duyệt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nhắc phê duyệt ngay' })).toBeVisible();
});

test('admin can inspect access review center safeguards and filters', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/access-reviews');
  await expect(page.locator('main').getByText('Trung tâm review truy cập')).toBeVisible();
  await expect(page.getByPlaceholder('Tìm chiến dịch theo tên, khóa hoặc mô tả')).toBeVisible();
  await expect(page.getByPlaceholder('Tìm theo tóm tắt, người thao tác hoặc mã đối tượng')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tạo campaign' })).toBeVisible();

  await page.getByRole('button', { name: 'Tạo campaign' }).click();
  await expect(page.locator('.ant-drawer').getByText('Tạo campaign review truy cập')).toBeVisible();
  await expect(page.getByLabel('Khóa campaign')).toBeVisible();
  await expect(page.getByLabel('Tên campaign')).toBeVisible();
  await expect(page.getByLabel('Bộ lọc vai trò')).toBeVisible();
  await expect(page.getByLabel('Bộ lọc nhóm')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('admin can inspect user provisioning desk watchlist and activity controls', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/user-provisioning');
  await expect(page.locator('main').getByText('Bàn cấp tài khoản người dùng')).toBeVisible();
  await expect(page.getByLabel('Tên đăng nhập')).toBeVisible();
  await expect(page.getByPlaceholder('Tìm theo tài khoản, email hoặc preset')).toBeVisible();
  await expect(page.getByPlaceholder('Tìm theo tóm tắt, người thao tác hoặc preset')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xem trước' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cấp tài khoản' })).toBeVisible();
});

test('admin can inspect access exception center filters and export controls', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/access-exceptions');
  await expect(page.locator('main').getByText('Trung tâm ngoại lệ truy cập')).toBeVisible();
  await expect(page.getByPlaceholder('Tìm theo tên, khóa hoặc mô tả chính sách')).toBeVisible();
  await expect(page.getByPlaceholder('Tìm theo mã request, người nhận quyền hoặc chính sách')).toBeVisible();
  await expect(page.getByPlaceholder('Tìm theo tóm tắt, actor, action hoặc mã request')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tạo chính sách' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xuất CSV' }).first()).toBeVisible();
  await expect(page.getByLabel('Chính sách')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xem trước yêu cầu' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gửi yêu cầu' })).toBeVisible();
});

test('admin can inspect user offboarding desk watchlists and export controls', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/user-lifecycle');
  await expect(page.locator('main').getByText('Bàn kết thúc vòng đời tài khoản')).toBeVisible();
  await expect(page.getByLabel('Tài khoản cần xử lý')).toBeVisible();
  await expect(page.getByPlaceholder('Tìm theo tài khoản, email hoặc trạng thái')).toBeVisible();
  await expect(page.getByPlaceholder('Tìm theo tóm tắt, người thao tác hoặc tài khoản')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xuất CSV' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xem trước' })).toBeVisible();
});

test('sales user is redirected away from finance and workforce command centers', async ({ page }) => {
  await login(page, salesUser.username, salesUser.password);

  await page.goto('/advance-transactions');
  await expect(page).not.toHaveURL(/\/advance-transactions$/);

  await page.goto('/salary-advance');
  await expect(page).not.toHaveURL(/\/salary-advance$/);
});
