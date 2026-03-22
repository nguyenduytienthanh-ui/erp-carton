import { expect, test } from '@playwright/test';

import { adminUser, login } from './helpers/auth';
import { apiGet, apiPost, getAccessToken, provisionDisposableUser } from './helpers/adminApi';

type ActiveUser = {
  id: number;
  username: string;
  is_staff?: boolean;
};

type AccessExceptionWorkspace = {
  roles?: Array<{ id: number }>;
  teams?: Array<{ id: number }>;
};

async function listActiveUsers(page: Parameters<typeof login>[0], token: string) {
  const response = await apiGet<{ count?: number; results?: ActiveUser[] } | ActiveUser[]>(
    page,
    token,
    '/users/',
    { is_active: true },
  );
  return Array.isArray(response) ? response : (response.results ?? []);
}

test('deep link focus opens access review and access exception workspaces', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, adminUser.username, adminUser.password);

  const token = await getAccessToken(page);
  const key = String(Date.now());
  const team = await apiPost<{ id: number; name: string }>(page, token, '/teams/', {
    code: `PW_ACCESS_TEAM_${key}`,
    name: `PW Access Team ${key}`,
    description: 'Team seeded for access review focus.',
    is_active: true,
    sort_order: 0,
  });
  const reviewTarget = await provisionDisposableUser(page, token, `review_focus_${key}`);
  await apiPost(page, token, `/users/${reviewTarget.id}/access_profile/`, {
    role_ids: [],
    team_ids: [team.id],
  });

  const campaignKey = `pw-access-focus-${key}`;
  const campaignName = `PW Access Focus ${key}`;
  await apiPost(page, token, '/users/access_review_campaigns/', {
    key: campaignKey,
    name: campaignName,
    description: 'Campaign seeded for focus drilldown.',
    is_active: true,
    tone: 'volcano',
    scope: 'all_active',
    review_action: 'lock_account',
    team_ids: [team.id],
    role_ids: [],
    inactivity_days: 45,
    include_locked: false,
    only_active_users: true,
    checklist: ['Verify owner'],
  });

  await page.goto(`/admin/access-reviews?campaign_key=${campaignKey}&search=${campaignKey}`);
  await expect(page.getByTestId('access-review-focus-banner')).toBeVisible();
  await expect(page.getByTestId('access-review-campaign-search').locator('input')).toHaveValue(campaignKey);
  await expect(page.locator('main')).toContainText(campaignName);

  const exceptionWorkspace = await apiGet<AccessExceptionWorkspace>(page, token, '/users/access_exception_workspace/');
  const roleId = exceptionWorkspace.roles?.[0]?.id;
  const teamId = exceptionWorkspace.teams?.[0]?.id;
  expect(roleId).toBeTruthy();
  expect(teamId).toBeTruthy();

  const activeUsers = await listActiveUsers(page, token);
  const exceptionTarget = activeUsers.find((user) => user.username !== adminUser.username && !user.is_staff);
  expect(exceptionTarget?.id).toBeTruthy();

  const policyKey = `pw-exception-focus-${key}`;
  const policyName = `PW Exception Focus ${key}`;
  await apiPost(page, token, '/users/access_exception_policies/', {
    key: policyKey,
    name: policyName,
    description: 'Policy seeded for focus drilldown.',
    is_active: true,
    tone: 'cyan',
    risk_level: 'elevated',
    default_duration_days: 3,
    max_duration_days: 10,
    requires_approval: false,
    role_ids: [roleId],
    team_ids: [teamId],
    checklist: ['Confirm owner'],
  });
  const createdRequest = await apiPost<{ request: { key: string } }>(page, token, '/users/access_exception_requests/', {
    policy_key: policyKey,
    user_id: exceptionTarget?.id,
    duration_days: 3,
    justification: 'Seeded for focus drilldown.',
    ticket_ref: `PW-EX-${key}`,
  });
  const requestKey = createdRequest.request.key;

  await expect.poll(async () => {
    const workspace = await apiGet<{
      policies?: Array<{ key: string }>;
      requests?: Array<{ key: string }>;
    }>(page, token, '/users/access_exception_workspace/');
    const hasPolicy = workspace.policies?.some((item) => item.key === policyKey) ?? false;
    const hasRequest = workspace.requests?.some((item) => item.key === requestKey) ?? false;
    return hasPolicy && hasRequest;
  }, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBeTruthy();

  await page.goto(`/admin/access-exceptions?request_key=${requestKey}&policy_key=${policyKey}&search=${requestKey}`);
  await expect(page.getByTestId('access-exception-focus-banner')).toBeVisible();
  await expect(page.getByTestId('access-exception-request-search').locator('input')).toHaveValue(requestKey);
  await expect(page.getByTestId('access-exception-policy-search').locator('input')).toHaveValue(policyKey);
});

test('admin audit center drills into governance, access review, and access exception targets', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, adminUser.username, adminUser.password);

  const token = await getAccessToken(page);
  const key = String(Date.now());
  const role = await apiPost<{ id: number; code: string; name: string }>(page, token, '/roles/', {
    code: `PW_AUDIT_ROLE_${key}`,
    name: `PW Audit Role ${key}`,
    description: 'Role seeded for audit center drilldown.',
    is_active: true,
    sort_order: 0,
    permission_ids: [],
  });

  const reviewTeam = await apiPost<{ id: number; name: string }>(page, token, '/teams/', {
    code: `PW_AUDIT_TEAM_${key}`,
    name: `PW Audit Team ${key}`,
    description: 'Team seeded for audit center drilldown.',
    is_active: true,
    sort_order: 0,
  });
  const reviewTarget = await provisionDisposableUser(page, token, `audit_review_${key}`);
  await apiPost(page, token, `/users/${reviewTarget.id}/access_profile/`, {
    role_ids: [],
    team_ids: [reviewTeam.id],
  });
  const campaignKey = `pw-audit-review-${key}`;
  await apiPost(page, token, '/users/access_review_campaigns/', {
    key: campaignKey,
    name: `PW Audit Review ${key}`,
    description: 'Campaign seeded for audit drilldown.',
    is_active: true,
    tone: 'blue',
    scope: 'all_active',
    review_action: 'certify',
    team_ids: [reviewTeam.id],
    role_ids: [],
    inactivity_days: 30,
    include_locked: false,
    only_active_users: true,
    checklist: ['Check ownership'],
  });

  const exceptionWorkspace = await apiGet<AccessExceptionWorkspace>(page, token, '/users/access_exception_workspace/');
  const roleId = exceptionWorkspace.roles?.[0]?.id;
  const teamId = exceptionWorkspace.teams?.[0]?.id;
  expect(roleId).toBeTruthy();
  expect(teamId).toBeTruthy();
  const activeUsers = await listActiveUsers(page, token);
  const exceptionTarget = activeUsers.find((user) => user.username !== adminUser.username && !user.is_staff);
  expect(exceptionTarget?.id).toBeTruthy();

  const policyKey = `pw-audit-policy-${key}`;
  await apiPost(page, token, '/users/access_exception_policies/', {
    key: policyKey,
    name: `PW Audit Policy ${key}`,
    description: 'Policy seeded for audit drilldown.',
    is_active: true,
    tone: 'gold',
    risk_level: 'elevated',
    default_duration_days: 3,
    max_duration_days: 7,
    requires_approval: false,
    role_ids: [roleId],
    team_ids: [teamId],
    checklist: ['Check owner'],
  });
  const createdRequest = await apiPost<{ request: { key: string } }>(page, token, '/users/access_exception_requests/', {
    policy_key: policyKey,
    user_id: exceptionTarget?.id,
    duration_days: 3,
    justification: 'Seeded for audit drilldown.',
    ticket_ref: `PW-AUDIT-${key}`,
  });
  const requestKey = createdRequest.request.key;

  let auditWorkspace: { roleCode: string; reviewCode: string; exceptionCode: string } | null = null;
  await expect.poll(async () => {
    const workspace = await apiGet<{ recent_activity?: Array<{ entity_code?: string; entity_id_str?: string; entity_type?: string }> }>(
      page,
      token,
      '/users/admin_audit_workspace/',
      { hours: 72, limit: 200 },
    );
    const items = workspace.recent_activity ?? [];
    const roleItem = items.find((item) => item.entity_type === 'Role');
    const reviewItem = items.find((item) => item.entity_type === 'UserAccessReviewCampaign');
    const exceptionItem = items.find((item) => item.entity_type === 'UserAccessExceptionRequest');
    if (!roleItem || !reviewItem || !exceptionItem) {
      return false;
    }
    auditWorkspace = {
      roleCode: roleItem.entity_code || role.code,
      reviewCode: reviewItem.entity_id_str || reviewItem.entity_code || campaignKey,
      exceptionCode: exceptionItem.entity_id_str || exceptionItem.entity_code || requestKey,
    };
    return true;
  }, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBeTruthy();
  expect(auditWorkspace).not.toBeNull();
  const roleAuditCode = auditWorkspace?.roleCode || role.code;
  const reviewAuditCode = auditWorkspace?.reviewCode || campaignKey;
  const exceptionAuditCode = auditWorkspace?.exceptionCode || requestKey;

  await page.goto('/admin/audit-center');
  await page.getByTestId('admin-audit-center-search').locator('input').fill(roleAuditCode);
  await expect(page.getByTestId('admin-audit-center-recent-activity').locator('tr').filter({ hasText: roleAuditCode }).first()).toBeVisible();
  await page.getByTestId('admin-audit-center-recent-activity').locator('tr').filter({ hasText: roleAuditCode }).first().getByTestId('admin-audit-center-open-activity').click();
  await expect(page.getByTestId('role-governance-focus-banner')).toBeVisible();
  await expect(page.getByTestId('role-governance-role-drawer')).toBeVisible();

  await page.goto('/admin/audit-center');
  await page.getByTestId('admin-audit-center-search').locator('input').fill(reviewAuditCode);
  await expect(page.getByTestId('admin-audit-center-recent-activity').locator('tr').filter({ hasText: reviewAuditCode }).first()).toBeVisible();
  await page.getByTestId('admin-audit-center-recent-activity').locator('tr').filter({ hasText: reviewAuditCode }).first().getByTestId('admin-audit-center-open-activity').click();
  await expect(page.getByTestId('access-review-focus-banner')).toBeVisible();
  await expect(page.getByTestId('access-review-campaign-search').locator('input')).toHaveValue(campaignKey);

  await page.goto('/admin/audit-center');
  await page.getByTestId('admin-audit-center-search').locator('input').fill(exceptionAuditCode);
  await expect(page.getByTestId('admin-audit-center-recent-activity').locator('tr').filter({ hasText: exceptionAuditCode }).first()).toBeVisible();
  await page.getByTestId('admin-audit-center-recent-activity').locator('tr').filter({ hasText: exceptionAuditCode }).first().getByTestId('admin-audit-center-open-activity').click();
  await expect(page.getByTestId('access-exception-focus-banner')).toBeVisible();
  await expect(page.getByTestId('access-exception-request-search').locator('input')).toHaveValue(requestKey);
});
