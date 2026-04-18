import { expect, test } from '@playwright/test';

import { adminUser, login } from './helpers/auth';
import { apiGet, getAccessToken, provisionDisposableUser } from './helpers/adminApi';

test('admin can provision a user and operate it from user control center', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, adminUser.username, adminUser.password);

  const uniqueId = Date.now();
  const username = `ops_reg_${uniqueId}`;
  const email = `${username}@example.com`;

  await page.goto('/admin/user-provisioning');
  await expect(page.getByText('Bàn cấp tài khoản người dùng', { exact: true })).toBeVisible();

  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Email công việc').fill(email);
  await page.getByLabel('Họ').fill('Playwright');
  await page.getByRole('textbox', { name: /^Tên$/ }).fill('Regression');

  await page.getByRole('button', { name: 'Xem trước' }).click();
  await expect(page.getByText('Kiểm tra trước khi tạo', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Cấp tài khoản' }).click();
  await expect(page.getByText('Bàn giao thông tin đăng nhập', { exact: true })).toBeVisible();
  await expect(page.getByText(username, { exact: true })).toBeVisible();

  const token = await getAccessToken(page);
  await expect.poll(async () => {
    const directory = await apiGet<{ results: Array<{ username: string }> }>(
      page,
      token,
      '/users/directory/',
      { search: username },
    );
    return directory.results.some((item) => item.username === username);
  }, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBeTruthy();

  await page.goto('/admin/users');
  await expect(page.getByText('Trung tâm điều phối người dùng', { exact: true })).toBeVisible();

  await page.getByPlaceholder('Tìm username, họ tên, email hoặc số điện thoại').fill(username);
  await expect(page.getByText(new RegExp(username)).first()).toBeVisible();

  await page.getByRole('button', { name: 'Mở chi tiết' }).first().click();
  await expect(page.getByText(`@${username}`, { exact: true }).last()).toBeVisible();

  await page.getByRole('button', { name: 'Tạm ngưng' }).last().click();
  await page.getByRole('button', { name: 'Tạm ngưng' }).last().click();
  await expect(page.getByText('Tạm ngưng', { exact: true }).last()).toBeVisible();

  await page.getByRole('button', { name: 'Kích hoạt' }).last().click();
  await expect(page.getByText('Hoạt động', { exact: true }).last()).toBeVisible();
});

test('admin can create, preview, and apply an onboarding preset for a disposable user', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, adminUser.username, adminUser.password);
  const token = await getAccessToken(page);
  const disposableUser = await provisionDisposableUser(page, token, 'onboard');

  const uniqueId = Date.now();
  const presetKey = `pw-onboard-${uniqueId}`;
  const presetName = `Preset Onboarding ${uniqueId}`;

  await page.goto('/admin/onboarding-studio');
  await expect(page.getByText('Xưởng preset onboarding', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Tạo preset' }).click();
  await page.getByLabel('Khóa preset').fill(presetKey);
  await page.getByLabel('Tên preset').fill(presetName);
  await page.getByLabel('Mô tả').fill('Preset tạo bởi Playwright để kiểm tra rollout onboarding.');
  await page.getByLabel('Checklist').fill('Welcome call\nReview SOP\nKiểm tra bàn giao');
  await page.getByRole('button', { name: 'Lưu preset' }).click();

  await expect(page.getByText(presetName, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Chọn dùng' }).first().click();

  const rolloutCard = page.locator('.ant-card').filter({ hasText: 'Không gian rollout' }).first();
  const targetUserSelect = rolloutCard.locator('.ant-select').nth(1);
  await targetUserSelect.click();
  await page.keyboard.type(disposableUser.username);
  await page.locator('.ant-select-dropdown .ant-select-item-option').filter({ hasText: disposableUser.username }).first().click();

  await rolloutCard.getByRole('button', { name: 'Xem trước' }).click();
  await expect(page.getByText('Checklist bàn giao', { exact: true })).toBeVisible();

  await rolloutCard.getByRole('button', { name: 'Áp dụng preset' }).click();
  await expect(page.getByText(/Đã áp dụng preset onboarding cho người dùng\./)).toBeVisible();

  const activityCard = page.locator('.ant-card').filter({ hasText: 'Nhật ký hoạt động' }).first();
  await expect(activityCard.getByText(presetName, { exact: false })).toBeVisible();
});

test('admin can preview and apply lifecycle offboarding for a disposable user', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, adminUser.username, adminUser.password);
  const token = await getAccessToken(page);
  const disposableUser = await provisionDisposableUser(page, token, 'offboard');

  await page.goto('/admin/user-lifecycle');
  await expect(page.getByText('Bàn kết thúc vòng đời tài khoản', { exact: true })).toBeVisible();

  const userSelect = page.getByRole('combobox', { name: 'Tài khoản cần xử lý' });
  await userSelect.click();
  await page.keyboard.type(disposableUser.username);
  await expect(userSelect).toHaveValue(disposableUser.username);
  await page.keyboard.press('Enter');

  await page.getByRole('button', { name: 'Xem trước' }).click();
  await expect(page.getByText('Kiểm tra trước khi xử lý', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Áp dụng xử lý' }).click();
  await expect(page.getByText('Đã áp dụng xử lý vòng đời', { exact: true })).toBeVisible();

  const directory = await apiGet<{ count: number; results: Array<{ username: string; is_active: boolean; is_locked: boolean }> }>(
    page,
    token,
    '/users/directory/',
    { search: disposableUser.username },
  );

  expect(directory.results[0]?.username).toBe(disposableUser.username);
  expect(directory.results[0]?.is_active || directory.results[0]?.is_locked).toBeTruthy();
});
