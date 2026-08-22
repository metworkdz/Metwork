import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the METWORK OS CRM suite — deliberately SEPARATE from
 * the platform's `playwright.config.ts`.
 *
 * WHY A SECOND CONFIG RATHER THAN ONE MORE PROJECT:
 * the platform config declares a `globalSetup` that signs in as six customer
 * roles against the platform dev server and writes their storage state to
 * disk. `globalSetup` is config-level in Playwright — there is no way to opt a
 * single project out of it. Adding a `metworkcrm` project there would mean the
 * CRM suite could not run unless the platform server was up and its six seeded
 * customer accounts existed, coupling an isolated internal tool to fixtures it
 * has nothing to do with. That is exactly the dependency the CRM's whole
 * design avoids (own database, own auth space, own cookie).
 *
 * Keeping it separate also leaves `playwright.config.ts` untouched, so the
 * CRM's platform footprint stays at the six files Prompt 1 declared — see
 * METWORK_OS_RUNBOOK.md §7.
 *
 * Run (dev server must already be up — no `webServer` block here, matching the
 * platform config's convention):
 *
 *   USE_LOCAL_DB=true npx next dev -p 3999
 *   npx playwright test -c playwright.metworkcrm.config.ts --workers=1
 */
export default defineConfig({
  testDir: './tests/e2e/metworkcrm',
  // The suite shares ONE SQLite file. Parallel workers would interleave writes
  // against the same rows; serial execution is a correctness requirement, not
  // a performance preference.
  workers: 1,
  fullyParallel: false,
  // A side-effectful retry could double-create fixtures whose uniqueness the
  // assertions depend on.
  retries: 0,
  reporter: [['line']],
  // A `next dev` server compiles each route on FIRST hit, and on a loaded
  // machine that has been measured here at ~33s for an API route and ~170s for
  // a page. The suite warms the routes it drives (see `warmRoutes` in the spec),
  // but these ceilings stay deliberately generous: a tight timeout against a
  // dev server measures compilation, not the application, and produces flakes
  // that look like product bugs.
  timeout: 240_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env.CRM_E2E_BASE_URL ?? 'http://localhost:3999',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 90_000,
    navigationTimeout: 120_000,
  },
  projects: [
    {
      name: 'metworkcrm',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
