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
  ],
});
