import { expect, test } from '@playwright/test';

import { adminUser, login } from './helpers/auth';
import { apiGet, apiPost, findFirstRoleAndTeam, getAccessToken } from './helpers/adminApi';

type RoleTeamCatalog = {
  role_catalog?: Array<{ id: number; name: string }>;
  team_catalog?: Array<{ id: number; name: string }>;
};

type ProvisionUserResponse = {
  user: {
    id: number;
    username: string;
  };
};

async function ensureRoleAndTeam(page: Parameters<typeof login>[0], token: string, key: string) {
  const catalog = await findFirstRoleAndTeam(page, token) as RoleTeamCatalog;
  const roleId = catalog.role_catalog?.[0]?.id;
  const teamId = catalog.team_catalog?.[0]?.id;
  if (roleId && teamId) {
    return { roleId, teamId };
  }

  const role = await apiPost<{ id: number }>(page, token, '/roles/', {
    code: `PW_FOCUS_ROLE_${key}`,
    name: `PW Focus Role ${key}`,
    description: 'Role seeded for governance focus drilldown.',
    is_active: true,
    sort_order: 0,
    permission_ids: [],
  });
  const team = await apiPost<{ id: number }>(page, token, '/teams/', {
    code: `PW_FOCUS_TEAM_${key}`,
    name: `PW Focus Team ${key}`,
    description: 'Team seeded for governance focus drilldown.',
    is_active: true,
    sort_order: 0,
  });
  return { roleId: role.id, teamId: team.id };
}

test('deep link focus works across provisioning, offboarding, and user control', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, adminUser.username, adminUser.password);

  const token = await getAccessToken(page);
  const key = String(Date.now());
  const { roleId, teamId } = await ensureRoleAndTeam(page, token, key);
  const username = `pw_focus_${key}`;
  const provisioned = await apiPost<ProvisionUserResponse>(page, token, '/users/provision_user/', {
    username,
    email: `${username}@example.com`,
    first_name: 'Focus',
    last_name: key,
    role_ids: [roleId],
    team_ids: [teamId],
    is_active: true,
    is_staff: false,
    create_tasks: true,
    include_security_task: true,
    password_mode: 'generated',
  });
  const targetUser = provisioned.user;

  await expect.poll(async () => {
    const workspace = await apiGet<{ watchlist?: Array<{ id: number }> }>(page, token, '/users/provisioning_workspace/');
    return workspace.watchlist?.some((item) => item.id === targetUser.id) ?? false;
  }, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBeTruthy();

  await page.goto(`/admin/user-provisioning?focus_user_id=${targetUser.id}&focus=${targetUser.username}`);
  await expect(page.getByTestId('user-provisioning-focus-banner')).toBeVisible();
  await expect(page.getByTestId('user-provisioning-watchlist-search').locator('input')).toHaveValue(targetUser.username);
  await expect(page.getByTestId('user-provisioning-watchlist-drawer')).toContainText(targetUser.username);

  const offboardingWorkspace = await apiGet<{ candidates?: Array<{ id: number; username: string }> }>(
    page,
    token,
    '/users/offboarding_workspace/',
  );
  const offboardingTarget = offboardingWorkspace.candidates?.find((item) => item.id === targetUser.id) ?? offboardingWorkspace.candidates?.[0];
  expect(offboardingTarget?.id).toBeTruthy();

  await page.goto(`/admin/user-lifecycle?focus_user_id=${offboardingTarget?.id}&focus=${offboardingTarget?.username}`);
  await expect(page.getByTestId('user-offboarding-focus-banner')).toBeVisible();
  await expect(page.getByTestId('user-offboarding-watchlist-search').locator('input')).toHaveValue(offboardingTarget?.username ?? '');

  await page.goto(`/admin/users?focus_id=${targetUser.id}&search=${targetUser.username}`);
  await expect(page.getByTestId('admin-user-control-focus-banner')).toBeVisible();
  await expect(page.getByTestId('admin-user-control-search').locator('input')).toHaveValue(targetUser.username);
  await expect(page.getByTestId('admin-user-control-drawer')).toContainText(targetUser.username);
});

test('deep link focus opens role and team governance drawers', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, adminUser.username, adminUser.password);

  const token = await getAccessToken(page);
  const key = String(Date.now());
  const role = await apiPost<{ id: number; code: string; name: string }>(page, token, '/roles/', {
    code: `PW_GOV_ROLE_${key}`,
    name: `PW Gov Role ${key}`,
    description: 'Role seeded for governance focus drilldown.',
    is_active: true,
    sort_order: 0,
    permission_ids: [],
  });
  const team = await apiPost<{ id: number; code: string; name: string }>(page, token, '/teams/', {
    code: `PW_GOV_TEAM_${key}`,
    name: `PW Gov Team ${key}`,
    description: 'Team seeded for governance focus drilldown.',
    is_active: true,
    sort_order: 0,
  });

  await expect.poll(async () => {
    const [roleResponse, teamResponse] = await Promise.all([
      apiGet<{ id?: number }>(page, token, `/roles/${role.id}/`),
      apiGet<{ id?: number }>(page, token, `/teams/${team.id}/`),
    ]);
    return roleResponse.id === role.id && teamResponse.id === team.id;
  }, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBeTruthy();

  await page.goto(`/admin/roles-teams?focus_kind=role&focus_id=${role.id}&q=${role.code}`);
  await expect(page.getByTestId('role-governance-focus-banner')).toBeVisible();
  await expect(page.getByTestId('role-governance-search').locator('input')).toHaveValue(role.code);
  await expect(page.getByTestId('role-governance-role-drawer')).toBeVisible();

  await page.goto(`/admin/roles-teams?focus_kind=team&focus_id=${team.id}&q=${team.code}`);
  await expect(page.getByTestId('role-governance-focus-banner')).toBeVisible();
  await expect(page.getByTestId('role-governance-search').locator('input')).toHaveValue(team.code);
  await expect(page.getByTestId('role-governance-team-drawer')).toBeVisible();
});
