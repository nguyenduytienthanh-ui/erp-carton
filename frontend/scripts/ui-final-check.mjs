import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

function readArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

const args = readArgs(process.argv.slice(2));
const baseUrl = String(args['base-url'] || '').trim().replace(/\/$/, '');
const route = String(args.route || '').trim();
const username = String(args.username || '').trim();
const password = String(args.password || '').trim();
const waitSelector = String(args['wait-selector'] || 'main').trim();
const settleMs = Number(args['settle-ms'] || 1200);
const viewportWidth = Number(args['viewport-width'] || 1440);
const viewportHeight = Number(args['viewport-height'] || 960);
const isMobile = String(args['is-mobile'] || '').trim().toLowerCase() === 'true';
const uploadFilePath = String(args['upload-file-path'] || '').trim();
const selectTestId = String(args['select-testid'] || '').trim();
const selectOptionText = String(args['select-option-text'] || '').trim();
const clickTestId = String(args['click-testid'] || '').trim();
const postClickWaitSelector = String(args['post-click-wait-selector'] || waitSelector).trim();
const assertText = String(args['assert-text'] || '').trim();
const forceFailure = Boolean(args['force-failure']);

if (!baseUrl || !route || !username || !password) {
  console.error('Missing required args: --base-url, --route, --username, --password');
  process.exit(1);
}

const loginUrl = new URL('/login', `${baseUrl}/`).toString();
const targetUrl = new URL(route, `${baseUrl}/`).toString();
const inferredApiBaseUrl = ['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname)
  ? 'http://127.0.0.1:8000/api'
  : new URL('/api', `${baseUrl}/`).toString().replace(/\/$/, '');
const apiBaseUrl = String(args['api-base-url'] || inferredApiBaseUrl).trim().replace(/\/$/, '');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-ui-final-check-'));

let context;
let failed = false;

async function settlePage(page, waitSelector, settleMs) {
  await page.waitForLoadState('domcontentloaded');
  try {
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
  } catch {
    // Một số command center có polling/live updates; selector hiển thị mới là điều kiện chốt.
  }
  await page.locator(waitSelector).waitFor({ state: 'visible', timeout: 45_000 });
  if (Number.isFinite(settleMs) && settleMs > 0) {
    await page.waitForTimeout(settleMs);
  }
}

async function loginViaApi(page, username, password) {
  const loginResponse = await page.request.post(`${apiBaseUrl}/auth/login/`, {
    data: { username, password },
  });
  if (!loginResponse.ok()) {
    throw new Error(`API login failed with status ${loginResponse.status()}.`);
  }
  const tokens = await loginResponse.json();

  const profileResponse = await page.request.get(`${apiBaseUrl}/users/me/`, {
    headers: {
      Authorization: `Bearer ${tokens.access}`,
    },
  });
  if (!profileResponse.ok()) {
    throw new Error(`API users/me failed with status ${profileResponse.status()}.`);
  }
  const profile = await profileResponse.json();

  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
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

try {
  context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: {
      width: Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1440,
      height: Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 960,
    },
    isMobile,
  });

  let [page] = context.pages();
  if (!page) {
    page = await context.newPage();
  }
  for (const extraPage of context.pages().slice(1)) {
    await extraPage.close();
  }

  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  await context.clearCookies();
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  await page.locator('#login_username').fill(username);
  await page.locator('#login_password').fill(password);
  await page.getByRole('button', { name: /đăng nhập/i }).click();
  try {
    await page.waitForURL(/\/$/, { timeout: 15_000 });
  } catch {
    await loginViaApi(page, username, password);
    await page.goto(new URL('/', `${baseUrl}/`).toString(), { waitUntil: 'domcontentloaded' });
  }
  await settlePage(page, 'body', 0);

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await settlePage(page, waitSelector, settleMs);

  if (uploadFilePath) {
    await page.locator('input[type="file"]').setInputFiles(uploadFilePath);
    await settlePage(page, waitSelector, settleMs);
  }

  if (selectTestId && selectOptionText) {
    await page.getByTestId(selectTestId).click();
    try {
      await page.getByRole('option', { name: selectOptionText, exact: true }).waitFor({ state: 'visible', timeout: 5000 });
    } catch {
      try {
        await page.locator(`[role="option"][aria-label="${selectOptionText}"]`).waitFor({ state: 'visible', timeout: 5000 });
      } catch {
        await page.keyboard.press('ArrowDown');
      }
    }
    await page.waitForTimeout(300);
  }

  if (clickTestId) {
    await page.getByTestId(clickTestId).click();
    await settlePage(page, postClickWaitSelector || waitSelector, settleMs);
  }

  if (assertText) {
    await page.getByText(assertText, { exact: false }).first().waitFor({ state: 'visible', timeout: 30_000 });
  }

  if (forceFailure) {
    throw new Error('Forced failure after UI final check.');
  }

  console.log(`UI final check passed at ${targetUrl}`);
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  if (context) {
    await context.close();
  }
  fs.rmSync(profileDir, { recursive: true, force: true });
  console.log('Closed UI final check browser session.');
}

if (failed) {
  process.exit(1);
}
