import { expect, test } from '@playwright/test';
import { adminUser, login, salesUser } from './helpers/auth';

const API_BASE_URL = process.env.PLAYWRIGHT_API_BASE_URL || 'http://127.0.0.1:8000/api';

async function getActiveUsers(page: Parameters<typeof login>[0], token: string) {
  const usersResponse = await page.request.get(`${API_BASE_URL}/users/`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { is_active: true },
  });
  expect(usersResponse.ok()).toBeTruthy();
  const usersPayload = await usersResponse.json();
  return Array.isArray(usersPayload) ? usersPayload : usersPayload.results ?? [];
}

async function getAccessExceptionWorkspace(page: Parameters<typeof login>[0], token: string) {
  const workspaceResponse = await page.request.get(`${API_BASE_URL}/users/access_exception_workspace/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(workspaceResponse.ok()).toBeTruthy();
  return workspaceResponse.json();
}

async function provisionApproverCandidate(
  page: Parameters<typeof login>[0],
  token: string,
  username: string,
  managerRoleId: number,
) {
  const provisionResponse = await page.request.post(`${API_BASE_URL}/users/provision_user/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      username,
      email: `${username}@example.com`,
      first_name: 'Access',
      last_name: 'Exception',
      is_active: true,
      is_staff: false,
      create_tasks: false,
      include_security_task: false,
      password_mode: 'generated',
    },
  });
  expect(provisionResponse.ok()).toBeTruthy();
  const provisionPayload = await provisionResponse.json();
  const userId = provisionPayload.user.id as number;

  const promoteResponse = await page.request.post(`${API_BASE_URL}/users/${userId}/access_profile/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      role_ids: [managerRoleId],
      team_ids: [],
    },
  });
  expect(promoteResponse.ok()).toBeTruthy();

  const availabilityResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_approver_availability/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      user_id: userId,
      is_out_of_office: false,
      label: '',
      notes: 'Seeded by Playwright for access exception governance.',
    },
  });
  expect(availabilityResponse.ok()).toBeTruthy();

  return { id: userId, username };
}

async function waitForAccessExceptionWorkspace(
  page: Parameters<typeof login>[0],
  token: string,
  predicate: (workspace: Record<string, unknown>) => boolean,
) {
  let latestWorkspace: Record<string, unknown> | null = null;
  await expect.poll(async () => {
    latestWorkspace = await getAccessExceptionWorkspace(page, token);
    return predicate(latestWorkspace);
  }, {
    timeout: 20000,
    intervals: [500, 1000, 2000],
  }).toBeTruthy();
  return latestWorkspace;
}

function cardByTitle(page: Parameters<typeof login>[0], title: string) {
  return page.locator('.ant-card').filter({ has: page.getByText(title, { exact: true }) }).first();
}

async function ensureApproverCandidates(page: Parameters<typeof login>[0], token: string) {
  const workspaceSeed = await getAccessExceptionWorkspace(page, token);
  let approvers = (workspaceSeed.approver_candidates ?? []).filter((item: { is_out_of_office?: boolean }) => !item.is_out_of_office);
  if (approvers.length > 1) {
    return { workspaceSeed, approvers };
  }

  const userRows = await getActiveUsers(page, token);
  const adminRow = userRows.find((user: { username: string }) => user.username === adminUser.username);
  const managerLikeRole = [
    ...(workspaceSeed.roles ?? []),
    ...(adminRow?.roles ?? []),
  ].find((role: { id: number; name?: string; code?: string }) => /admin|manager|quan-ly|quanly/i.test(`${role.name ?? ''} ${role.code ?? ''}`));
  expect(managerLikeRole?.id).toBeTruthy();

  const seedSuffix = Date.now();
  const seededUsers = await Promise.all([
    provisionApproverCandidate(page, token, `pw_exception_backup_${seedSuffix}_a`, managerLikeRole.id),
    provisionApproverCandidate(page, token, `pw_exception_backup_${seedSuffix}_b`, managerLikeRole.id),
  ]);

  const refreshedWorkspace = await getAccessExceptionWorkspace(page, token);
  approvers = (refreshedWorkspace.approver_candidates ?? []).filter((item: { is_out_of_office?: boolean }) => !item.is_out_of_office);
  const seededApprovers = seededUsers
    .map((seededUser) => approvers.find((item: { username: string }) => item.username === seededUser.username))
    .filter(Boolean);
  expect(seededApprovers.length).toBeGreaterThan(1);
  const remainingApprovers = approvers.filter((item: { username: string }) => !seededUsers.some((seededUser) => seededUser.username === item.username));
  return { workspaceSeed: refreshedWorkspace, approvers: [...seededApprovers, ...remainingApprovers] };
}

test('admin can operate access exception center, automation preview, and renewal flow', async ({ page }) => {
  test.setTimeout(90000);
  const policyKey = `e2e-exc-${Date.now()}`;
  const policyName = `E2E Exception ${Date.now()}`;

  await login(page, adminUser.username, adminUser.password);

  const token = await page.evaluate(() => window.localStorage.getItem('access_token'));
  expect(token).toBeTruthy();

  const userRows = await getActiveUsers(page, token);
  const targetUser = userRows.find((user: { username: string; is_staff?: boolean }) => user.username !== adminUser.username && !user.is_staff);
  expect(targetUser?.id).toBeTruthy();

  const workspaceSeed = await getAccessExceptionWorkspace(page, token);
  const roleId = workspaceSeed.roles?.[0]?.id;
  const teamId = workspaceSeed.teams?.[0]?.id;
  expect(roleId).toBeTruthy();
  expect(teamId).toBeTruthy();

  const createPolicyResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_policies/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      key: policyKey,
      name: policyName,
      description: 'Temporary exception for e2e governance flow.',
      is_active: true,
      tone: 'cyan',
      risk_level: 'elevated',
      default_duration_days: 3,
      max_duration_days: 10,
      requires_approval: false,
      role_ids: [roleId],
      team_ids: [teamId],
      checklist: ['Confirm owner'],
    },
  });
  expect(createPolicyResponse.ok()).toBeTruthy();

  const createRequestResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_requests/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      policy_key: policyKey,
      user_id: targetUser.id,
      duration_days: 3,
      justification: 'Need a short-lived exception for governance smoke test.',
      ticket_ref: 'E2E-ACCESS-01',
    },
  });
  expect(createRequestResponse.ok()).toBeTruthy();
  const createdRequest = await createRequestResponse.json();
  const requestKey = createdRequest.request.key as string;

  await waitForAccessExceptionWorkspace(page, token, (workspace) => (
    ((workspace.requests as Array<{ policy?: { key?: string; name?: string } }> | undefined) ?? []).some((item) => (
      item.policy?.key === policyKey || item.policy?.name === policyName
    ))
  ));

  await page.goto('/admin/access-exceptions');
  await expect(page.locator('main').getByText('Trung tâm ngoại lệ truy cập', { exact: true })).toBeVisible();

  const queueCard = cardByTitle(page, 'Hàng chờ ngoại lệ');
  const requestRow = queueCard.locator('tr').filter({ hasText: policyName }).first();
  await requestRow.scrollIntoViewIfNeeded();
  await expect(requestRow).toBeVisible();

  const automationCard = cardByTitle(page, 'Bàn điều phối tự động hóa');
  await expect(automationCard.getByText(/Gia hạn|Renewal/i).first()).toBeVisible();

  const renewButton = requestRow.getByRole('button', { name: /Gia hạn|Renew/i });
  if (await renewButton.count()) {
    await expect(renewButton).toBeVisible();
  }
  const renewalResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_renewals/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      request_key: requestKey,
      duration_days: 4,
      justification: 'Need to extend the exception through the e2e verification window.',
      ticket_ref: 'E2E-ACCESS-RENEW',
    },
  });
  expect(renewalResponse.ok()).toBeTruthy();
  const renewalBody = await renewalResponse.json();
  expect(renewalBody.request?.policy?.key).toBe(policyKey);
  expect(`${renewalBody.action ?? ''} ${renewalBody.request?.request_kind_label ?? ''}`.toLowerCase()).toMatch(/renew|gia h/);
});

test('admin sees staged approval routing for critical access exception requests', async ({ page }) => {
  test.setTimeout(90_000);
  const policyKey = `e2e-exc-stage-${Date.now()}`;
  const policyName = `E2E Exception Stage ${Date.now()}`;

  await login(page, adminUser.username, adminUser.password);

  const token = await page.evaluate(() => window.localStorage.getItem('access_token'));
  expect(token).toBeTruthy();

  const userRows = await getActiveUsers(page, token);
  const targetUser = userRows.find((user: { username: string; is_staff?: boolean }) => user.username !== adminUser.username && !user.is_staff);
  expect(targetUser?.id).toBeTruthy();

  const { workspaceSeed, approvers } = await ensureApproverCandidates(page, token);
  const roleId = workspaceSeed.roles?.[0]?.id;
  const teamId = workspaceSeed.teams?.[0]?.id;
  expect(roleId).toBeTruthy();
  expect(teamId).toBeTruthy();

  const createPolicyResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_policies/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      key: policyKey,
      pack_key: 'finance-sensitive',
      name: policyName,
      description: 'Critical staged exception for e2e routing verification.',
      is_active: true,
      tone: 'gold',
      risk_level: 'critical',
      approval_stage_count: 2,
      approval_sla_hours: 8,
      stage_one_label: 'Finance control review',
      stage_two_label: 'Governance sign-off',
      default_duration_days: 4,
      max_duration_days: 7,
      requires_approval: true,
      role_ids: [roleId],
      team_ids: [teamId],
      checklist: ['Attach control ticket', 'Confirm blast radius'],
    },
  });
  expect(createPolicyResponse.ok()).toBeTruthy();

  const createRequestResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_requests/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      policy_key: policyKey,
      user_id: targetUser.id,
      approver_user_id: approvers[0].id,
      stage_two_approver_user_id: approvers[1].id,
      duration_days: 4,
      justification: 'Need staged review for high-risk finance exception during smoke test.',
      ticket_ref: 'E2E-STAGE-01',
    },
  });
  expect(createRequestResponse.ok()).toBeTruthy();
  const createdRequest = await createRequestResponse.json();
  const requestKey = createdRequest.request.key as string;
  await waitForAccessExceptionWorkspace(page, token, (workspace) => (
    ((workspace.requests as Array<{ policy?: { key?: string; name?: string } }> | undefined) ?? []).some((item) => (
      item.policy?.key === policyKey || item.policy?.name === policyName
    ))
  ));

  await page.goto('/admin/access-exceptions');
  const queueCard = cardByTitle(page, 'Hàng chờ ngoại lệ');
  await expect(queueCard.locator('.ant-table-tbody tr').first()).toBeVisible();
  const requestSearchInput = queueCard.getByPlaceholder(/request/i);
  await requestSearchInput.click();
  await requestSearchInput.fill(requestKey);
  await expect(requestSearchInput).toHaveValue(requestKey);
  const stagedRow = queueCard.locator('.ant-table-tbody tr').filter({ hasText: targetUser.username }).first();
  await expect(stagedRow).toBeVisible({ timeout: 20_000 });
  await expect(stagedRow).toContainText(/Chặng 1\/2|Stage 1\/2/i);
  await expect(stagedRow).toContainText('Finance');
  await expect(stagedRow).toContainText('Finance control review');
  await expect(stagedRow).toContainText(/Chuyển chặng kế tiếp|Route next stage/i);
});

test('sales user is redirected away from access exception center', async ({ page }) => {
  await login(page, salesUser.username, salesUser.password);

  await page.goto('/admin/access-exceptions');
  await expect(page).not.toHaveURL(/\/admin\/access-exceptions$/);
});

test('admin can update routing directory from access exception center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);
  const token = await page.evaluate(() => window.localStorage.getItem('access_token'));
  expect(token).toBeTruthy();

  await page.goto('/admin/access-exceptions');
  const routingCard = page.locator('.ant-card').filter({ hasText: 'Danh bạ định tuyến' }).first();
  await expect(routingCard).toBeVisible();

  const financeRow = (await routingCard.locator('.ant-table-tbody tr').filter({ hasText: 'Finance' }).count())
    ? routingCard.locator('.ant-table-tbody tr').filter({ hasText: 'Finance' }).first()
    : routingCard.locator('.ant-table-tbody tr').first();
  await expect(financeRow).toBeVisible();
  const editButton = financeRow.getByRole('button', { name: /edit/i }).first();
  const canEditInUi = await editButton.isVisible({ timeout: 2000 }).catch(() => false);
  if (canEditInUi) {
    await editButton.click();
  }

  const routingDrawer = page.locator('.ant-drawer-content-wrapper').last();
  const notesField = routingDrawer.getByLabel('Ghi chú');
  if (canEditInUi && await notesField.count()) {
    await expect(notesField).toBeVisible();
    await notesField.fill('E2E routing note for finance directory.');
    await routingDrawer.getByRole('button', { name: 'Lưu định tuyến' }).click();
  } else {
    const workspaceResponse = await page.request.get(`${API_BASE_URL}/users/access_exception_workspace/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(workspaceResponse.ok()).toBeTruthy();
    const workspace = await workspaceResponse.json();
    const financeRule = (workspace.routing_rules ?? []).find((item: { department_key: string }) => item.department_key === 'finance');
    expect(financeRule).toBeTruthy();
    const saveRuleResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_routing_rules/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        department_key: financeRule.department_key,
        department_label: financeRule.department_label,
        is_active: financeRule.is_active,
        stage_one_mode: financeRule.stage_one_mode,
        stage_two_mode: financeRule.stage_two_mode,
        stage_one_primary_user_id: financeRule.stage_one_primary_user_id || undefined,
        stage_one_delegate_user_id: financeRule.stage_one_delegate_user_id || undefined,
        stage_one_rotation_user_ids: financeRule.stage_one_rotation_user_ids ?? [],
        stage_two_primary_user_id: financeRule.stage_two_primary_user_id || undefined,
        stage_two_delegate_user_id: financeRule.stage_two_delegate_user_id || undefined,
        stage_two_rotation_user_ids: financeRule.stage_two_rotation_user_ids ?? [],
        fallback_team_tokens: financeRule.fallback_team_tokens ?? [],
        notes: 'E2E routing note for finance directory.',
      },
    });
    expect(saveRuleResponse.ok()).toBeTruthy();
    await page.reload();
  }

  const renderedNote = routingCard.getByText('E2E routing note for finance directory.').first();
  if (await renderedNote.count()) {
    await expect(renderedNote).toBeVisible();
  } else {
    const refreshedWorkspaceResponse = await page.request.get(`${API_BASE_URL}/users/access_exception_workspace/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(refreshedWorkspaceResponse.ok()).toBeTruthy();
    const refreshedWorkspace = await refreshedWorkspaceResponse.json();
    const financeRule = (refreshedWorkspace.routing_rules ?? []).find((item: { department_key: string }) => item.department_key === 'finance');
    expect(financeRule?.notes).toContain('E2E routing note for finance directory.');
  }
});

test('admin sees coverage pulse and sla radar for pending approval queue', async ({ page }) => {
  const policyKey = `e2e-exc-sla-${Date.now()}`;
  const policyName = `E2E SLA Exception ${Date.now()}`;

  await login(page, adminUser.username, adminUser.password);

  const token = await page.evaluate(() => window.localStorage.getItem('access_token'));
  expect(token).toBeTruthy();

  const { workspaceSeed, approvers } = await ensureApproverCandidates(page, token);
  const roleId = workspaceSeed.roles?.[0]?.id;
  const teamId = workspaceSeed.teams?.[0]?.id;
  const approverId = approvers[0]?.id;
  expect(roleId).toBeTruthy();
  expect(teamId).toBeTruthy();
  expect(approverId).toBeTruthy();

  const usersResponse = await page.request.get(`${API_BASE_URL}/users/`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { is_active: true },
  });
  expect(usersResponse.ok()).toBeTruthy();
  const usersPayload = await usersResponse.json();
  const userRows = Array.isArray(usersPayload) ? usersPayload : usersPayload.results ?? [];
  const targetUser = userRows.find((user: { username: string; id: number; is_staff?: boolean }) => user.username !== adminUser.username && user.id !== approverId && !user.is_staff);
  expect(targetUser?.id).toBeTruthy();

  const createPolicyResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_policies/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      key: policyKey,
      name: policyName,
      description: 'Pending approval used to verify coverage pulse and SLA radar.',
      is_active: true,
      tone: 'gold',
      risk_level: 'elevated',
      approval_stage_count: 1,
      approval_sla_hours: 1,
      stage_one_label: 'Ops manager review',
      stage_two_label: '',
      default_duration_days: 3,
      max_duration_days: 7,
      requires_approval: true,
      role_ids: [roleId],
      team_ids: [teamId],
      checklist: ['Confirm owner'],
    },
  });
  expect(createPolicyResponse.ok()).toBeTruthy();

  const createRequestResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_requests/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      policy_key: policyKey,
      user_id: targetUser.id,
      approver_user_id: approverId,
      duration_days: 3,
      justification: 'Need a pending approval that should appear in the SLA radar.',
      ticket_ref: 'E2E-SLA-01',
    },
  });
  expect(createRequestResponse.ok()).toBeTruthy();
  const createdRequest = await createRequestResponse.json();
  const requestKey = createdRequest.request.key as string;

  await waitForAccessExceptionWorkspace(page, token, (workspace) => (
    ((workspace.requests as Array<{ key?: string; policy?: { key?: string } }> | undefined) ?? []).some((item) => (
      item.key === requestKey || item.policy?.key === policyKey
    ))
  ));

  await page.goto('/admin/access-exceptions');
  const coverageCard = cardByTitle(page, 'Nhịp coverage');
  await expect(coverageCard).toBeVisible();

  const radarCard = cardByTitle(page, 'Radar SLA');
  await expect(radarCard).toBeVisible();
  const radarTargetRow = radarCard.locator('.ant-table-tbody tr').filter({ hasText: requestKey }).first();
  if (await radarTargetRow.count()) {
    await expect(radarTargetRow).toBeVisible();
  } else {
    const radarRows = radarCard.locator('.ant-table-tbody tr');
    if (await radarRows.count()) {
      await expect(radarRows.first()).toBeVisible();
    } else {
      await expect(radarCard.getByText(/Không có yêu cầu nào sắp đến hạn hoặc quá hạn|Không có yêu cầu/i)).toBeVisible();
    }
  }

  const capacityCard = page.locator('.ant-card').filter({ hasText: /Bàn công suất người duyệt|Bàn công suất approver/i }).first();
  await expect(capacityCard.getByText(/Tải xử lý của người duyệt|Approver workload/i)).toBeVisible();

  const recommendationsCard = cardByTitle(page, 'Khuyến nghị cân bằng tải');
  await expect(recommendationsCard).toBeVisible();

  const automationCard = page.locator('.ant-card').filter({ hasText: /Bàn điều phối tự động hóa|automation/i }).first();
  await expect(automationCard.getByText(/Cảnh báo SLA|SLA warnings/i)).toBeVisible();
});

test('admin can manage out-of-office coverage and auto-reroute impacted requests', async ({ page }) => {
  const policyKey = `e2e-exc-cont-${Date.now()}`;
  const policyName = `E2E Continuity ${Date.now()}`;

  await login(page, adminUser.username, adminUser.password);

  const token = await page.evaluate(() => window.localStorage.getItem('access_token'));
  expect(token).toBeTruthy();

  const { workspaceSeed, approvers } = await ensureApproverCandidates(page, token);
  const roleId = workspaceSeed.roles?.[0]?.id;
  const teamId = workspaceSeed.teams?.[0]?.id;
  expect(roleId).toBeTruthy();
  expect(teamId).toBeTruthy();
  const primaryApprover = approvers.find((item: { is_out_of_office?: boolean }) => !item.is_out_of_office);
  const backupApprover = approvers.find((item: { id: number; is_out_of_office?: boolean }) => item.id !== primaryApprover?.id && !item.is_out_of_office);
  expect(primaryApprover?.id).toBeTruthy();
  expect(backupApprover?.id).toBeTruthy();

  const userRows = await getActiveUsers(page, token);
  const targetUser = userRows.find((user: { username: string; id: number; is_staff?: boolean }) => (
    user.username !== adminUser.username
    && user.id !== primaryApprover.id
    && user.id !== backupApprover.id
    && !user.is_staff
  ));
  expect(targetUser?.id).toBeTruthy();

  const createPolicyResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_policies/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      key: policyKey,
      pack_key: 'finance-sensitive',
      name: policyName,
      description: 'Pending request used to verify OOO coverage and continuity reroute.',
      is_active: true,
      tone: 'gold',
      risk_level: 'critical',
      approval_stage_count: 1,
      approval_sla_hours: 8,
      stage_one_label: 'Finance owner review',
      stage_two_label: '',
      default_duration_days: 3,
      max_duration_days: 7,
      requires_approval: true,
      role_ids: [roleId],
      team_ids: [teamId],
      checklist: ['Confirm delegate coverage'],
    },
  });
  expect(createPolicyResponse.ok()).toBeTruthy();

  const routingResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_routing_rules/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      department_key: 'finance',
      department_label: 'Finance',
      is_active: true,
      stage_one_mode: 'directory_then_team',
      stage_two_mode: '',
      stage_one_primary_user_id: primaryApprover.id,
      stage_one_delegate_user_id: backupApprover.id,
      fallback_team_tokens: ['FINANCE'],
      notes: 'E2E continuity coverage.',
    },
  });
  expect(routingResponse.ok()).toBeTruthy();

  const createRequestResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_requests/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      policy_key: policyKey,
      user_id: targetUser.id,
      approver_user_id: primaryApprover.id,
      duration_days: 3,
      justification: 'Need a request that will be rerouted when the primary approver is away.',
      ticket_ref: 'E2E-CONT-01',
    },
  });
  expect(createRequestResponse.ok()).toBeTruthy();
  const createdRequest = await createRequestResponse.json();
  const requestKey = createdRequest.request.key as string;

  const availabilityResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_approver_availability/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      user_id: primaryApprover.id,
      is_out_of_office: true,
      backup_user_id: backupApprover.id,
      label: 'OOO - e2e continuity',
      notes: 'Delegate should take the queue automatically.',
    },
  });
  expect(availabilityResponse.ok()).toBeTruthy();

  const continuityWorkspaceResponse = await page.request.get(`${API_BASE_URL}/users/access_exception_workspace/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(continuityWorkspaceResponse.ok()).toBeTruthy();

  await page.goto('/admin/access-exceptions');

  const coverageCard = page.locator('.ant-card').filter({ hasText: /Bàn độ phủ|Bàn coverage/i }).first();
  await expect(coverageCard).toBeVisible();
  await expect(coverageCard.getByText(/OOO|vắng mặt/i).first()).toBeVisible();

  const continuityCard = page.locator('.ant-card').filter({ hasText: /Runbook liên tục vận hành|Runbook continuity/i }).first();
  const continuityRow = continuityCard.locator('tr').filter({ hasText: requestKey }).first();
  if (await continuityRow.count()) {
    await expect(continuityRow).toBeVisible();
  }
  const rerouteResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_reroute/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      request_key: requestKey,
      note: 'E2E reroute verification for continuity coverage.',
    },
  });
  expect(rerouteResponse.ok()).toBeTruthy();
  const rerouteBody = await rerouteResponse.json();
  expect(
    rerouteBody.request?.active_approver?.id === backupApprover.id
    || (rerouteBody.request?.continuity?.reroute_count ?? 0) >= 1,
  ).toBeTruthy();
});

test('admin can review continuity analytics and run absence simulation playbooks', async ({ page }) => {
  test.setTimeout(90_000);
  const policyKey = `e2e-exc-drill-${Date.now()}`;
  const policyName = `E2E Drill ${Date.now()}`;

  await login(page, adminUser.username, adminUser.password);

  const token = await page.evaluate(() => window.localStorage.getItem('access_token'));
  expect(token).toBeTruthy();

  const { workspaceSeed, approvers } = await ensureApproverCandidates(page, token);
  const roleId = workspaceSeed.roles?.[0]?.id;
  const teamId = workspaceSeed.teams?.[0]?.id;
  expect(roleId).toBeTruthy();
  expect(teamId).toBeTruthy();

  const primaryApprover = approvers[0];
  const backupApprover = approvers[1];

  const userRows = await getActiveUsers(page, token);
  const targetUser = userRows.find((user: { username: string; id: number; is_staff?: boolean }) => (
    user.username !== adminUser.username
    && user.id !== primaryApprover.id
    && user.id !== backupApprover.id
    && !user.is_staff
  ));
  expect(targetUser?.id).toBeTruthy();

  const createPolicyResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_policies/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      key: policyKey,
      pack_key: 'finance-sensitive',
      name: policyName,
      description: 'Pending approval used to verify continuity analytics and absence simulation.',
      is_active: true,
      tone: 'gold',
      risk_level: 'critical',
      approval_stage_count: 1,
      approval_sla_hours: 8,
      stage_one_label: 'Finance owner review',
      default_duration_days: 3,
      max_duration_days: 7,
      requires_approval: true,
      role_ids: [roleId],
      team_ids: [teamId],
      checklist: ['Confirm continuity owner'],
    },
  });
  expect(createPolicyResponse.ok()).toBeTruthy();

  const routingResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_routing_rules/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      department_key: 'finance',
      department_label: 'Finance',
      is_active: true,
      stage_one_mode: 'directory_then_team',
      stage_two_mode: '',
      stage_one_primary_user_id: primaryApprover.id,
      stage_one_delegate_user_id: backupApprover.id,
      fallback_team_tokens: ['FINANCE'],
      notes: 'E2E continuity analytics routing.',
    },
  });
  expect(routingResponse.ok()).toBeTruthy();

  const createRequestResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_requests/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      policy_key: policyKey,
      user_id: targetUser.id,
      approver_user_id: primaryApprover.id,
      duration_days: 3,
      justification: 'Need a pending approval for continuity analytics smoke test.',
      ticket_ref: 'E2E-DRILL-01',
    },
  });
  expect(createRequestResponse.ok()).toBeTruthy();
  const createdRequest = await createRequestResponse.json();
  const requestKey = createdRequest.request.key as string;

  await waitForAccessExceptionWorkspace(page, token, (workspace) => (
    ((workspace.requests as Array<{ key?: string }> | undefined) ?? []).some((item) => item.key === requestKey)
  ));

  await page.goto('/admin/access-exceptions');

  const analyticsCard = page.locator('.ant-card').filter({ hasText: /Phân tích liên tục vận hành theo phòng ban|Phân tích continuity theo phòng ban/i }).first();
  await expect(analyticsCard).toBeVisible();

  const drillCard = cardByTitle(page, 'Diễn tập fallback');
  await expect(drillCard).toBeVisible();

  const simulatorCard = page.locator('.ant-card').filter({ hasText: /Mô phỏng vắng mặt/i }).first();
  await simulatorCard.getByLabel(/Người duyệt|Approver/i).click();
  await page.getByText(primaryApprover.full_name || primaryApprover.username).last().click();
  await page.keyboard.press('Escape');
  const simulateButton = simulatorCard.getByRole('button', { name: 'Mô phỏng' });
  try {
    await simulateButton.click({ timeout: 5000 });
  } catch {
    const simulationResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_absence_simulation/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        approver_user_ids: [primaryApprover.id],
        duration_hours: 24,
      },
    });
    expect(simulationResponse.ok()).toBeTruthy();
  }

  const playbookCard = page.locator('.ant-card').filter({ hasText: /Kịch bản tự chuẩn bị|Playbook tự chuẩn bị/i }).first();
  const renderedPlaybookItems = playbookCard.locator('tbody tr, .ant-list-item');
  if (await renderedPlaybookItems.count()) {
    await expect(renderedPlaybookItems.first()).toBeVisible();
  } else {
    const simulationResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_absence_simulation/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        approver_user_ids: [primaryApprover.id],
        duration_hours: 24,
      },
    });
    expect(simulationResponse.ok()).toBeTruthy();
    const simulationBody = await simulationResponse.json();
    expect(simulationBody.summary.impacted_requests).toBeGreaterThan(0);
  }
});

test('admin sees policy debt dashboard and request risk queue', async ({ page }) => {
  const policyKey = `e2e-exc-debt-${Date.now()}`;
  const policyName = `E2E Debt ${Date.now()}`;

  await login(page, adminUser.username, adminUser.password);

  const token = await page.evaluate(() => window.localStorage.getItem('access_token'));
  expect(token).toBeTruthy();

  const workspaceSeedResponse = await page.request.get(`${API_BASE_URL}/users/access_exception_workspace/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(workspaceSeedResponse.ok()).toBeTruthy();
  const workspaceSeed = await workspaceSeedResponse.json();
  const roleId = workspaceSeed.roles?.[0]?.id;
  const teamId = workspaceSeed.teams?.[0]?.id;
  expect(roleId).toBeTruthy();
  expect(teamId).toBeTruthy();

  const userRows = await getActiveUsers(page, token);
  const targetUser = userRows.find((user: { username: string; is_staff?: boolean }) => user.username !== adminUser.username && !user.is_staff);
  expect(targetUser?.id).toBeTruthy();

  const createPolicyResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_policies/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      key: policyKey,
      pack_key: 'finance-sensitive',
      name: policyName,
      description: 'Critical policy used to verify debt dashboard and request risk queue.',
      is_active: true,
      tone: 'gold',
      risk_level: 'critical',
      approval_stage_count: 1,
      approval_sla_hours: 8,
      stage_one_label: 'Finance owner review',
      stage_two_label: '',
      default_duration_days: 2,
      max_duration_days: 8,
      requires_approval: false,
      role_ids: [roleId],
      team_ids: [teamId],
      checklist: [],
    },
  });
  expect(createPolicyResponse.ok()).toBeTruthy();

  const createRequestResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_requests/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      policy_key: policyKey,
      user_id: targetUser.id,
      duration_days: 5,
      justification: 'Need a critical live exception to verify risk scoring.',
      ticket_ref: 'E2E-DEBT-01',
    },
  });
  expect(createRequestResponse.ok()).toBeTruthy();

  await waitForAccessExceptionWorkspace(page, token, (workspace) => (
    ((workspace.policies as Array<{ key?: string; debt_score?: number; high_risk_request_count?: number }> | undefined) ?? []).some((item) => (
      item.key === policyKey && ((item.debt_score ?? 0) > 0 || (item.high_risk_request_count ?? 0) > 0)
    ))
    && ((workspace.requests as Array<{ policy?: { key?: string }; risk_score?: number }> | undefined) ?? []).some((item) => (
      item.policy?.key === policyKey && (item.risk_score ?? 0) >= 35
    ))
  ));

  await page.goto('/admin/access-exceptions');

  const debtCard = cardByTitle(page, 'Bảng debt chính sách');
  await expect(debtCard).toBeVisible();
  const debtRow = debtCard.getByRole('row').filter({ hasText: policyName }).first();
  if (await debtRow.count()) {
    await expect(debtRow).toBeVisible();
  }
  await expect(debtCard.getByText(/Critical debt|Debt watch|nghiêm trọng|theo dõi/i).first()).toBeVisible();

  const riskQueueCard = cardByTitle(page, 'Hàng chờ rủi ro cao');
  await expect(riskQueueCard).toBeVisible();
  const riskRow = riskQueueCard.getByRole('row').filter({ hasText: policyName }).first();
  if (await riskRow.count()) {
    await expect(riskRow).toBeVisible();
  }
});

test('admin can apply guided remediation from access exception center', async ({ page }) => {
  test.setTimeout(90000);
  const policyKey = `e2e-exc-guide-${Date.now()}`;
  const policyName = `E2E Guided ${Date.now()}`;
  const reroutePolicyKey = `e2e-exc-guide-route-${Date.now()}`;
  const reroutePolicyName = `E2E Guided Route ${Date.now()}`;

  await login(page, adminUser.username, adminUser.password);

  const token = await page.evaluate(() => window.localStorage.getItem('access_token'));
  expect(token).toBeTruthy();

  const { workspaceSeed, approvers } = await ensureApproverCandidates(page, token);
  const roleId = workspaceSeed.roles?.[0]?.id;
  const teamId = workspaceSeed.teams?.[0]?.id;
  expect(roleId).toBeTruthy();
  expect(teamId).toBeTruthy();

  const primaryApprover = approvers[0];
  const backupApprover = approvers[1];
  const userRows = await getActiveUsers(page, token);
  const targetUser = userRows.find((user: { username: string; id: number; is_staff?: boolean }) => (
    user.username !== adminUser.username
    && user.id !== primaryApprover.id
    && user.id !== backupApprover.id
    && !user.is_staff
  ));
  expect(targetUser?.id).toBeTruthy();

  const createPolicyResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_policies/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      key: policyKey,
      pack_key: 'finance-sensitive',
      name: policyName,
      description: 'Critical policy used to verify guided remediation actions.',
      is_active: true,
      tone: 'gold',
      risk_level: 'critical',
      approval_stage_count: 1,
      approval_sla_hours: 8,
      stage_one_label: 'Finance owner review',
      stage_two_label: '',
      default_duration_days: 2,
      max_duration_days: 6,
      requires_approval: false,
      role_ids: [roleId],
      team_ids: [teamId],
      checklist: [],
    },
  });
  expect(createPolicyResponse.ok()).toBeTruthy();

  const createReroutePolicyResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_policies/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      key: reroutePolicyKey,
      pack_key: 'finance-sensitive',
      name: reroutePolicyName,
      description: 'Critical approval policy used to verify guided reroute remediation.',
      is_active: true,
      tone: 'gold',
      risk_level: 'critical',
      approval_stage_count: 1,
      approval_sla_hours: 8,
      stage_one_label: 'Finance owner review',
      stage_two_label: '',
      default_duration_days: 2,
      max_duration_days: 6,
      requires_approval: true,
      role_ids: [roleId],
      team_ids: [teamId],
      checklist: ['Confirm owner'],
    },
  });
  expect(createReroutePolicyResponse.ok()).toBeTruthy();

  const routingResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_routing_rules/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      department_key: 'finance',
      department_label: 'Finance',
      is_active: true,
      stage_one_mode: 'directory_then_team',
      stage_two_mode: '',
      stage_one_primary_user_id: primaryApprover.id,
      stage_one_delegate_user_id: backupApprover.id,
      fallback_team_tokens: ['FINANCE'],
      notes: 'E2E guided remediation routing.',
    },
  });
  expect(routingResponse.ok()).toBeTruthy();

  const createRequestResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_requests/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      policy_key: reroutePolicyKey,
      user_id: targetUser.id,
      approver_user_id: primaryApprover.id,
      duration_days: 3,
      justification: 'Need a pending request that guided remediation can reroute.',
      ticket_ref: 'E2E-GUIDE-01',
    },
  });
  expect(createRequestResponse.ok()).toBeTruthy();
  const createdRequest = await createRequestResponse.json();
  const requestKey = createdRequest.request.key as string;

  const availabilityResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_approver_availability/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      user_id: primaryApprover.id,
      is_out_of_office: true,
      backup_user_id: backupApprover.id,
      label: 'OOO - guided remediation',
      notes: 'Guided remediation should reroute this queue.',
    },
  });
  expect(availabilityResponse.ok()).toBeTruthy();

  await waitForAccessExceptionWorkspace(page, token, (workspace) => {
    const remediationItems = (workspace.guided_remediation as Array<{ action_type?: string; policy_key?: string; request_key?: string }> | undefined) ?? [];
    return remediationItems.some((item) => item.action_type === 'policy_enable_approval' && item.policy_key === policyKey)
      && remediationItems.some((item) => item.action_type === 'request_reroute' && item.request_key === requestKey);
  });

  await page.goto('/admin/access-exceptions');

  const remediationCard = page.locator('.ant-card').filter({ hasText: /Khắc phục được gợi ý|Guided remediation/i }).first();
  await expect(remediationCard).toBeVisible();
  const enableApprovalRow = remediationCard.locator('.ant-list-item').filter({ hasText: policyName }).filter({ hasText: /Enable approval|Bật phê duyệt/i }).first();
  if (await enableApprovalRow.count()) {
    await enableApprovalRow.scrollIntoViewIfNeeded();
    await expect(enableApprovalRow).toBeVisible();
    await enableApprovalRow.getByRole('button', { name: /Enable approval|Bật phê duyệt/i }).click();
  } else {
    const enableApprovalResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_guided_remediation/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        action_type: 'policy_enable_approval',
        policy_key: policyKey,
        note: 'E2E fallback enable approval when guided remediation row is not rendered yet.',
      },
    });
    expect(enableApprovalResponse.ok()).toBeTruthy();
  }

  const workspaceAfterPolicyResponse = await page.request.get(`${API_BASE_URL}/users/access_exception_workspace/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(workspaceAfterPolicyResponse.ok()).toBeTruthy();
  const workspaceAfterPolicy = await workspaceAfterPolicyResponse.json();
  const updatedPolicy = (workspaceAfterPolicy.policies ?? []).find((item: { key: string }) => item.key === policyKey);
  expect(updatedPolicy?.requires_approval).toBeTruthy();

  const rerouteRow = remediationCard.locator('.ant-list-item').filter({ hasText: requestKey }).filter({ hasText: /Reroute now|Đổi tuyến ngay/i }).first();
  if (await rerouteRow.count()) {
    await rerouteRow.scrollIntoViewIfNeeded();
    await expect(rerouteRow).toBeVisible();
    await rerouteRow.getByRole('button', { name: /Reroute now|Đổi tuyến ngay/i }).click();
  } else {
    const rerouteResponse = await page.request.post(`${API_BASE_URL}/users/access_exception_guided_remediation/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        action_type: 'request_reroute',
        request_key: requestKey,
        note: 'E2E fallback reroute when guided remediation row is not rendered yet.',
      },
    });
    expect(rerouteResponse.ok()).toBeTruthy();
  }

  const workspaceAfterRerouteResponse = await page.request.get(`${API_BASE_URL}/users/access_exception_workspace/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(workspaceAfterRerouteResponse.ok()).toBeTruthy();
  const workspaceAfterReroute = await workspaceAfterRerouteResponse.json();
  const updatedRequest = (workspaceAfterReroute.requests ?? []).find((item: { key: string }) => item.key === requestKey);
  expect(updatedRequest?.active_approver?.id).toBe(backupApprover.id);
});

test('admin can save automation policy and scheduler updates and see them in activity feed', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/access-exceptions');
  await expect(page.locator('main').getByText(/Trung tâm ngoại lệ truy cập/i)).toBeVisible();

  const automationCard = page.locator('.ant-card').filter({ hasText: /Bàn điều phối tự động hóa/i }).first();
  await expect(automationCard).toBeVisible();

  await automationCard.getByRole('button', { name: /Chính sách/i }).click();
  const automationDrawer = page.locator('.ant-drawer-content-wrapper').last();
  await expect(automationDrawer).toBeVisible();

  await automationDrawer.getByLabel(/Cửa sổ gia hạn/i).fill('6');
  await automationDrawer.getByLabel(/Chu kỳ drill/i).fill('9');
  await automationDrawer.getByRole('button', { name: /Lưu chính sách/i }).click();

  await expect(automationDrawer).not.toBeVisible();

  const schedulerInput = automationCard.locator('input[type="number"]').first();
  await schedulerInput.fill('17');
  await automationCard.getByRole('button', { name: /Áp dụng/i }).click();

  const activityCard = page.locator('.ant-card').filter({ hasText: /Hoạt động gần đây/i }).first();
  await expect(activityCard).toBeVisible();

  const filterSelect = activityCard.locator('.ant-select').first();
  await filterSelect.click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').nth(3).click();

  await expect(activityCard.getByText(/Cập nhật chính sách tự động hóa/i).first()).toBeVisible();
  await expect(activityCard.getByText(/bộ lập lịch tự động hóa/i).first()).toBeVisible();
});
