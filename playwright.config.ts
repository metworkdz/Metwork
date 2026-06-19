import { defineConfig, devices } from '@playwright/test';
import { authStatePath } from './tests/e2e/global-setup';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: 1,
  workers: 5,
  reporter: [
    ['html', { outputFolder: 'tests/report', open: 'never' }],
    ['json', { outputFile: 'tests/results.json' }],
    ['list'],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    locale: 'fr-FR',
  },
  projects: [
    {
      name: 'admin',
      testMatch: '**/admin.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authStatePath('admin'),
      },
    },
    {
      name: 'incubator',
      testMatch: '**/incubator.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authStatePath('incubator'),
      },
    },
    {
      name: 'entrepreneur-builder',
      testMatch: '**/entrepreneur-builder.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authStatePath('builder'),
      },
    },
    {
      name: 'entrepreneur-founder',
      testMatch: '**/entrepreneur-founder.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authStatePath('founder'),
      },
    },
    {
      name: 'entrepreneur-explorer',
      testMatch: '**/entrepreneur-explorer.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authStatePath('explorer'),
      },
    },
    {
      // Instant-book consultation suite (P1–P7). API-driven specs build their own
      // role contexts via the saved storage states, so this project needs no
      // storageState of its own. The UI i18n smoke runs here too. SERIAL by
      // intent: every spec reconfigures the shared seeded mentor — run with
      // `--workers=1`. Retries disabled so a flake never re-spends the per-mentor
      // PIN rate-limit budget.
      name: 'consultation',
      testMatch: ['**/api/consultation*.spec.ts', '**/consultation-i18n.spec.ts'],
      retries: 0,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
