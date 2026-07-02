import { defineConfig, devices } from '@playwright/test';

/**
 * Live-data verification suite — runs against a dev server connected to the
 * REAL store (no USE_LOCAL_DB), logging in with a real account supplied via
 * env vars. Deliberately SEPARATE from the main config:
 *
 *  - NO globalSetup: the seeded test users don't exist in the live store, so
 *    the standard 5-role login bootstrap would fail.
 *  - workers 1 / retries 0: the spec mutates live data (creates then deletes
 *    a demo manual booking); a retry would double the side effects.
 *
 * Run:
 *   E2E_EMAIL=<incubator email> E2E_PASSWORD=<password> \
 *     npx playwright test --config=playwright.verify.config.ts
 */
export default defineConfig({
  testDir: './tests/verify',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'verify', testMatch: '**/*.spec.ts' }],
});
