import { defineConfig } from '@playwright/test';

/**
 * API-driven business-logic suite (capacity gates, price guards, waitlist,
 * wallet rules). Kept SEPARATE from the UI smoke config because:
 *
 *  - These tests mutate the single shared JSON document, so they MUST run
 *    serially (workers: 1, fullyParallel: false) to avoid read-modify-write
 *    races between concurrent db.update() calls.
 *  - retries: 0 — every assertion is deterministic; a retry would only
 *    re-run side-effectful fixture creation and muddy results.
 *
 * It reuses the same global-setup so the per-role auth cookies in
 * tests/.auth/<role>.json are fresh before the run.
 *
 * Run:  npx playwright test --config=playwright.api.config.ts
 */
export default defineConfig({
  testDir: './tests/e2e/api',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [
    ['html', { outputFolder: 'tests/report-api', open: 'never' }],
    ['json', { outputFile: 'tests/results-api.json' }],
    ['list'],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    locale: 'fr-FR',
  },
  projects: [{ name: 'api', testMatch: '**/*.spec.ts' }],
});
