/**
 * Playwright global setup — runs ONCE before all tests.
 * Logs in as each role, saves the browser storage state (cookies) to disk
 * so individual tests can load it via `storageState` instead of calling
 * the login endpoint on every `beforeEach`.
 */
import { chromium, type FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const ROLES = [
  { name: 'admin',     email: 'test.admin@metwork.test',     password: 'TestAdmin2026!'     },
  { name: 'incubator', email: 'test.incubator@metwork.test', password: 'TestIncubator2026!' },
  { name: 'builder',   email: 'test.builder@metwork.test',   password: 'TestBuilder2026!'   },
  { name: 'founder',   email: 'test.founder@metwork.test',   password: 'TestFounder2026!'   },
  { name: 'explorer',  email: 'test.explorer@metwork.test',  password: 'TestExplorer2026!'  },
  { name: 'investor',  email: 'test.investor@metwork.test',  password: 'TestInvestor2026!'  },
];

export const AUTH_STATE_DIR = path.resolve('tests/.auth');

export function authStatePath(role: string): string {
  return path.join(AUTH_STATE_DIR, `${role}.json`);
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  fs.mkdirSync(AUTH_STATE_DIR, { recursive: true });

  const browser = await chromium.launch();

  for (const role of ROLES) {
    const context = await browser.newContext({ baseURL: 'http://localhost:3010' });
    const page = await context.newPage();

    await page.goto('/en/login');
    await page.waitForLoadState('networkidle');
    await page.fill('#email', role.email);
    await page.fill('#password', role.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/en\/dashboard/, { timeout: 30_000 });

    await context.storageState({ path: authStatePath(role.name) });
    await context.close();
    console.log(`[setup] ✅ ${role.name} authenticated → ${authStatePath(role.name)}`);
  }

  await browser.close();
}
