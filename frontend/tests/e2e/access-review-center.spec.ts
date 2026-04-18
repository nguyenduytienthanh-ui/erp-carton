import { expect, test } from '@playwright/test';

import { adminUser, login, salesUser } from './helpers/auth';
import { apiGet, apiPost, getAccessToken } from './helpers/adminApi';

test('admin can create a destructive access review, manually select targets, and lock the chosen account', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, adminUser.username, adminUser.password);

  const token = await getAccessToken(page);
  const seedKey = Date.now();
  const targetUsername = `0000_accessreview_a_${seedKey}`;
  const team = await apiPost<{ id: number; name: string; code: string }>(
    page,
    token,
    '/teams/',
    {
      code: `PW_ACCESS_REVIEW_${seedKey}`,
      name: `PW Access Review ${seedKey}`,
      description: 'Nhóm tạm phục vụ regression access review.',
      is_active: true,
      sort_order: 0,
    },
  );
  const targetUser = (await apiPost<{ user: { id: number; username: string } }>(
    page,
    token,
    '/users/provision_user/',
    {
      username: targetUsername,
      email: `${targetUsername}@example.com`,
      first_name: 'Access',
      last_name: 'Review',
      is_active: true,
      is_staff: false,
      create_tasks: false,
      include_security_task: false,
      password_mode: 'generated',
    },
  )).user;
  await apiPost(
    page,
    token,
    `/users/${targetUser.id}/access_profile/`,
    {
      role_ids: [],
      team_ids: [team.id],
    },
  );
  for (let index = 0; index < 10; index += 1) {
    const batchUsername = `0000_accessreview_b${index}_${seedKey}`;
    const batchUser = (await apiPost<{ user: { id: number; username: string } }>(
      page,
      token,
      '/users/provision_user/',
      {
        username: batchUsername,
        email: `${batchUsername}@example.com`,
        first_name: 'Access',
        last_name: `Batch ${index}`,
        is_active: true,
        is_staff: false,
        create_tasks: false,
        include_security_task: false,
        password_mode: 'generated',
      },
    )).user;
    await apiPost(
      page,
      token,
      `/users/${batchUser.id}/access_profile/`,
      {
        role_ids: [],
        team_ids: [team.id],
      },
    );
  }

  const uniqueId = Date.now();
  const campaignKey = `pw-access-review-${uniqueId}`;
  const campaignName = `Rà soát khóa tài khoản ${uniqueId}`;

  await page.goto('/admin/access-reviews');
  await expect(page.locator('main').getByText(/Trung tâm rà soát truy cập/i)).toBeVisible();

  await page.getByRole('button', { name: /Tạo chiến dịch/i }).click();
  await page.getByLabel(/Khóa chiến dịch/i).fill(campaignKey);
  await page.getByLabel(/Tên chiến dịch/i).fill(campaignName);
  await page.getByLabel(/Mô tả/i).fill('Chiến dịch kiểm tra thao tác khóa tài khoản với lựa chọn thủ công.');

  await page.getByLabel(/Phạm vi/i).click();
  await page.getByText('Tài khoản hoạt động', { exact: true }).last().click();

  await page.getByLabel(/Hành động rà soát/i).click();
  await page.getByText('Khóa tài khoản', { exact: true }).last().click();

  await page.getByLabel(/Bộ lọc nhóm/i).click();
  await page.keyboard.type(team.name);
  await expect(page.getByRole('combobox', { name: /Bộ lọc nhóm/i })).toHaveValue(team.name);
  await page.keyboard.press('Enter');

  await page.getByRole('button', { name: /Lưu chiến dịch/i }).click();
  await expect(page.getByText(campaignName, { exact: true }).first()).toBeVisible();

  const campaignRow = page.locator('.ant-table-tbody tr').filter({ hasText: campaignName }).first();
  await campaignRow.click();

  const workspaceCard = page.locator('.ant-card').filter({ hasText: /Không gian rà soát/i }).first();
  await workspaceCard.getByRole('button', { name: /Xem trước chiến dịch|Xem trước lựa chọn/i }).click();

  await expect(workspaceCard.getByText(/Bắt buộc chọn thủ công trước khi áp dụng/i)).toBeVisible();
  await workspaceCard.getByRole('button', { name: /Chọn tất cả/i }).click();

  await workspaceCard.getByPlaceholder(/Ghi chú thêm cho đợt rà soát này/i).fill('Playwright kiểm tra khóa tài khoản sau bước chọn thủ công.');
  await workspaceCard.getByRole('button', { name: /Áp dụng rà soát/i }).click();

  await expect.poll(async () => {
    const directory = await apiGet<{ results: Array<{ username: string; is_locked: boolean }> }>(
      page,
      token,
      '/users/directory/',
      { search: targetUser.username },
    );
    return directory.results.find((item) => item.username === targetUser.username)?.is_locked ?? false;
  }, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBeTruthy();

  const activityCard = page.locator('.ant-card').filter({ hasText: /Hoạt động gần đây/i }).first();
  await expect(activityCard.getByText(/Khóa tài khoản|UPDATE/i).first()).toBeVisible();
});

test('sales user is redirected away from access review center', async ({ page }) => {
  await login(page, salesUser.username, salesUser.password);

  await page.goto('/admin/access-reviews');
  await expect(page).not.toHaveURL(/\/admin\/access-reviews$/);
});
