import { expect, test } from '@playwright/test';

import { adminUser, login } from './helpers/auth';

test('admin can open approval control tower and inspect approval queues', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/approval-control-tower');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveURL(/\/admin\/approval-control-tower$/);
  await expect(page.getByText('Hàng chờ hiện tại')).toBeVisible();
  await expect(page.getByTestId('approval-control-tower-lane-critical')).toBeVisible();
  await expect(page.getByTestId('approval-control-tower-hot-items')).toBeVisible();
  await expect(page.getByTestId('approval-control-tower-timeline')).toBeVisible();
  await expect(page.getByText('Quyết định duyệt gần đây')).toBeVisible();

  const openButtons = page.getByRole('button', { name: 'Mở' });
  const openCount = await openButtons.count();
  if (openCount > 0) {
    await openButtons.first().click();
    await expect(page).not.toHaveURL(/\/admin\/approval-control-tower$/);
  }
});
