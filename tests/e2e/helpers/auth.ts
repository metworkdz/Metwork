import { type Page, expect } from '@playwright/test';

export const CREDENTIALS = {
  admin:     { email: 'test.admin@metwork.test',     password: 'TestAdmin2026!'     },
  incubator: { email: 'test.incubator@metwork.test', password: 'TestIncubator2026!' },
  builder:   { email: 'test.builder@metwork.test',   password: 'TestBuilder2026!'   },
  founder:   { email: 'test.founder@metwork.test',   password: 'TestFounder2026!'   },
  explorer:  { email: 'test.explorer@metwork.test',  password: 'TestExplorer2026!'  },
};

/**
 * Log in as the given role.  The app uses next-intl routing; the default
 * locale is `en` so login lands at /en/login and redirects to
 * /en/dashboard/<role> after a successful POST to /api/auth/login.
 */
export async function login(page: Page, role: keyof typeof CREDENTIALS): Promise<void> {
  const { email, password } = CREDENTIALS[role];

  await page.goto('/en/login');
  await page.waitForLoadState('networkidle');

  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');

  // Wait for redirect to the role dashboard (locale-prefixed).
  // First request may be slow — dev server compiles the dashboard page cold.
  await page.waitForURL(/\/en\/dashboard/, { timeout: 60_000 });
}

export async function logout(page: Page): Promise<void> {
  // Hit the logout API directly — avoids fragile UI click chains.
  await page.goto('/api/auth/logout');
}
