import { expect, type Locator, type Page } from '@playwright/test';

export const adminUser = {
  username: process.env.E2E_ADMIN_USERNAME || 'uat_admin',
  password: process.env.E2E_ADMIN_PASSWORD || 'Demo123!',
};

export const salesUser = {
  username: process.env.E2E_SALES_USERNAME || 'uat_sales',
  password: process.env.E2E_SALES_PASSWORD || 'Demo123!',
};

export const financeUser = {
  username: process.env.E2E_FINANCE_USERNAME || 'uat_finance',
  password: process.env.E2E_FINANCE_PASSWORD || 'Demo123!',
};

export const hrUser = {
  username: process.env.E2E_HR_USERNAME || 'uat_hr',
  password: process.env.E2E_HR_PASSWORD || 'Demo123!',
};

export const PLAYWRIGHT_API_BASE_URL = process.env.PLAYWRIGHT_API_BASE_URL || 'http://127.0.0.1:8000/api';

type LoginApiResponse = {
  access: string;
  refresh: string;
};

async function loginViaApi(page: Page, username: string, password: string) {
  const loginResponse = await page.request.post(`${PLAYWRIGHT_API_BASE_URL}/auth/login/`, {
    data: { username, password },
  });
  expect(loginResponse.ok(), 'Đăng nhập API phải thành công').toBeTruthy();
  const tokens = await loginResponse.json() as LoginApiResponse;

  const profileResponse = await page.request.get(`${PLAYWRIGHT_API_BASE_URL}/users/me/`, {
    headers: {
      Authorization: `Bearer ${tokens.access}`,
    },
  });
  expect(profileResponse.ok(), 'Lấy hồ sơ người dùng phải thành công').toBeTruthy();
  const profile = await profileResponse.json();

  await page.goto('/login');
  await page.evaluate(({ access, refresh, user }) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem('access_token', access);
    window.localStorage.setItem('refresh_token', refresh);
    window.localStorage.setItem('user', JSON.stringify(user));
  }, {
    access: tokens.access,
    refresh: tokens.refresh,
    user: profile,
  });
}

export async function login(page: Page, username: string, password: string) {
  await page.goto('/login');

  await page.context().clearCookies();
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  await page.locator('#login_username').fill(username);
  await page.locator('#login_password').fill(password);
  await page.getByRole('button', { name: /Đăng nhập/i }).click();
  try {
    await page.waitForURL(/\/$/, { timeout: 15_000 });
    await page.waitForLoadState('networkidle');
  } catch {
    await loginViaApi(page, username, password);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  }
  await expect(page).toHaveURL(/\/$/);
}

/**
 * Click a save-view button and wait for the preferences API response to
 * complete before continuing. Prevents race conditions where page.reload()
 * is called before the POST /api/preferences/ finishes writing to the DB.
 */
export async function saveViewAndWait(page: Page, testId: string) {
  const prefSaved = page.waitForResponse(
    (r) => r.url().includes('/api/preferences/') && r.request().method() === 'POST',
  );
  await page.getByTestId(testId).click();
  await prefSaved;
}

export async function chooseSelectOptionByTestId(scope: Page | Locator, testId: string, optionLabel: string) {
  const page = 'page' in scope && typeof scope.page === 'function' ? scope.page() : scope as Page;
  const container = scope.getByTestId(testId);
  const nestedSelect = container.locator('.ant-select');
  if (await nestedSelect.count()) {
    await nestedSelect.first().click({ force: true });
  } else {
    await container.click({ force: true });
  }
  const focusedSearchInput = page.locator('input.ant-select-selection-search-input:focus').last();
  if (await focusedSearchInput.count()) {
    await focusedSearchInput.fill(optionLabel);
  } else {
    const inlineSearchInput = container.locator('input.ant-select-selection-search-input').last();
    if (await inlineSearchInput.count()) {
      await inlineSearchInput.fill(optionLabel);
    } else {
      await page.keyboard.type(optionLabel);
    }
  }
  const option = page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: optionLabel })
    .first();
  await expect(option).toBeVisible({ timeout: 20_000 });
  await option.evaluate((element) => element.scrollIntoView({ block: 'nearest' }));
  try {
    await option.click({ force: true });
  } catch {
    const box = await option.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      throw new Error(`Không thể chọn option ${optionLabel} cho ${testId}`);
    }
  }
  await page.waitForTimeout(150);
}

export async function savePresetDialogAndWait(page: Page, presetFieldTestId: string) {
  const presetDialog = page
    .getByRole('dialog')
    .filter({ has: page.getByTestId(presetFieldTestId) })
    .last();
  const presetField = page.getByTestId(presetFieldTestId);
  const saveButtonTestId = presetFieldTestId.replace(/-preset-name$/, '-save-preset');
  await expect(presetDialog).toBeVisible();
  await expect(presetField).toBeVisible();

  let preferenceSaved = page.waitForResponse(
    (r) => r.url().includes('/api/preferences/') && r.request().method() === 'POST',
    { timeout: 2_000 },
  ).catch(() => null);
  await presetField.press('Enter');
  let response = await preferenceSaved;

  if (!response) {
    preferenceSaved = page.waitForResponse(
      (r) => r.url().includes('/api/preferences/') && r.request().method() === 'POST',
      { timeout: 20_000 },
    );
    const explicitSaveButton = presetDialog.getByTestId(saveButtonTestId);
    if (await explicitSaveButton.count()) {
      await explicitSaveButton.click({ force: true });
    } else {
      await presetDialog.getByRole('button', { name: /Lưu mẫu|Lưu mẫu|Luu mau/i }).click({ force: true });
    }
    response = await preferenceSaved;
  }

  await expect(presetField).toBeHidden({ timeout: 20_000 });
}
