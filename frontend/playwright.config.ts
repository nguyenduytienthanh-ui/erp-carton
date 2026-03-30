import { defineConfig, devices } from '@playwright/test';

const configuredWorkers = Number(process.env.PLAYWRIGHT_WORKERS ?? '1');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  workers: Number.isFinite(configuredWorkers) && configuredWorkers > 0 ? configuredWorkers : 1,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
