import { expect, test } from '@playwright/test';

import { adminUser, login } from './helpers/auth';
import { apiPost, getAccessToken, provisionDisposableUser } from './helpers/adminApi';

test('admin sees provisioning and offboarding activity flow through observability center', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, adminUser.username, adminUser.password);

  const token = await getAccessToken(page);
  const disposableUser = await provisionDisposableUser(page, token, 'obsflow');

  await apiPost(page, token, '/users/offboard_user/', {
    user_id: disposableUser.id,
    deactivate_account: true,
    lock_account: true,
    revoke_access: true,
    revoke_sessions: true,
  });

  await page.goto('/admin/observability');
  await expect(page.getByText(/Trung tâm sức khỏe hệ thống/i)).toBeVisible();

  const searchInput = page.getByPlaceholder(/Tìm theo hành động, actor, mã đối tượng hoặc tóm tắt/i);
  await searchInput.fill(disposableUser.username);
  await expect(page.getByText(new RegExp(disposableUser.username, 'i')).first()).toBeVisible();
  await expect(page.getByText(/PROVISION|OFFBOARD/i).first()).toBeVisible();
});

test('admin sees access review lock activity surface in observability center', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, adminUser.username, adminUser.password);

  const token = await getAccessToken(page);
  const seedKey = Date.now();
  const team = await apiPost<{ id: number }>(page, token, '/teams/', {
    code: `OBS_ACCESS_${seedKey}`,
    name: `OBS Access ${seedKey}`,
    description: 'Nhom phuc vu regression observability.',
    is_active: true,
    sort_order: 0,
  });
  const targetUser = await provisionDisposableUser(page, token, `review_${seedKey}`);

  await apiPost(page, token, `/users/${targetUser.id}/access_profile/`, {
    role_ids: [],
    team_ids: [team.id],
  });

  const campaignKey = `obs-access-review-${seedKey}`;
  await apiPost(page, token, '/users/access_review_campaigns/', {
    key: campaignKey,
    name: `OBS Lock Review ${seedKey}`,
    description: 'Regression khoa tai khoan va kiem tra observability.',
    is_active: true,
    tone: 'volcano',
    scope: 'all_active',
    review_action: 'lock_account',
    team_ids: [team.id],
    role_ids: [],
    inactivity_days: 45,
    include_locked: false,
    only_active_users: true,
    checklist: ['Xac nhan muc dich khoa tai khoan'],
  });

  await apiPost(page, token, '/users/apply_access_review/', {
    campaign_key: campaignKey,
    selected_user_ids: [targetUser.id],
    note: 'Regression lock account for observability center.',
  });

  await page.goto('/admin/observability');
  const searchInput = page.getByPlaceholder(/Tìm theo hành động, actor, mã đối tượng hoặc tóm tắt/i);
  await searchInput.fill(targetUser.username);

  await expect(page.getByText(new RegExp(targetUser.username, 'i')).first()).toBeVisible();
  await expect(page.getByText(/LOCK_ACCOUNT|Khóa tài khoản/i).first()).toBeVisible();
});
