/**
 * 🔴 AGENT-ADMIN — Platform management, all admin routes.
 */
import { test, expect } from '@playwright/test';
import { capture, log, tryGoto, mainText } from './helpers/utils';

const A = 'ADMIN';
const BASE = '/en/dashboard/admin';

// Known admin routes from navigation.ts
const ADMIN_ROUTES = [
  { id: 'A03', name: 'Analytics',           href: `${BASE}/analytics`         },
  { id: 'A04', name: 'Users',               href: `${BASE}/users`             },
  { id: 'A05', name: 'Incubators',          href: `${BASE}/incubators`        },
  { id: 'A06', name: 'Memberships',         href: `${BASE}/memberships`       },
  { id: 'A07', name: 'Promo Codes',         href: `${BASE}/promo-codes`       },
  { id: 'A08', name: 'Partner Network',     href: `${BASE}/partners`          },
  { id: 'A09', name: 'Partner Promo Codes', href: `${BASE}/partner-promo-codes` },
  { id: 'A10', name: 'Commissions',         href: `${BASE}/commissions`       },
  { id: 'A11', name: 'Bookings',            href: `${BASE}/bookings`          },
  { id: 'A12', name: 'Mentors',             href: `${BASE}/mentors`           },
  { id: 'A13', name: 'Consultations',       href: `${BASE}/mentor-bookings`   },
  { id: 'A14', name: 'Mentor Revenue',      href: `${BASE}/mentor-revenue`    },
  { id: 'A15', name: 'Contacts',            href: `${BASE}/contacts`          },
  { id: 'A16', name: 'Investor Contacts',   href: `${BASE}/investor-contacts` },
  { id: 'A17', name: 'Withdrawals',         href: `${BASE}/withdrawals`       },
  { id: 'A18', name: 'CMS Content',         href: `${BASE}/cms`               },
  { id: 'A19', name: 'Audit Log',           href: `${BASE}/audit-log`         },
  { id: 'A20', name: 'Settings',            href: `${BASE}/settings`          },
];

test.describe('🔴 Admin Agent', () => {

  // ── A01: Auth & dashboard load ────────────────────────────────────────────
  test('A01 — Login and dashboard loads', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/login/);
    await capture(page, 'admin-01-dashboard');
    const text = await mainText(page);
    expect(text.length).toBeGreaterThan(50);
    log(A, 'A01', 'Login & Dashboard', 'PASS');
  });

  // ── A02: No JS errors on dashboard ───────────────────────────────────────
  test('A02 — No console errors on dashboard', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    const realErrors = errors.filter(e =>
      !e.includes('favicon') && !e.includes('_next/static') && !e.includes('posthog'),
    );
    if (realErrors.length === 0) {
      log(A, 'A02', 'No Console Errors', 'PASS');
    } else {
      log(A, 'A02', 'No Console Errors', 'FAIL', realErrors.slice(0, 3).join(' | '));
    }
  });

  // ── A03–A20: All admin routes render without 404 ──────────────────────────
  for (const route of ADMIN_ROUTES) {
    test(`${route.id} — ${route.name} page renders`, async ({ page }) => {
      const ok = await tryGoto(page, route.href);
      await page.waitForLoadState('networkidle');
      await capture(page, `admin-${route.id.toLowerCase()}-${route.name.replace(/\s+/g, '-').toLowerCase()}`);
      if (ok) {
        const text = await mainText(page);
        if (text.trim().length < 30) {
          log(A, route.id, route.name, 'FAIL', 'Page appears empty (<30 chars)');
        } else {
          log(A, route.id, route.name, 'PASS');
        }
      } else {
        log(A, route.id, route.name, 'FAIL', `404 at ${route.href}`);
      }
    });
  }

  // ── A21: Create promo code form visible ──────────────────────────────────
  test('A21 — Create promo code form is visible on promo codes page', async ({ page }) => {
    await page.goto(`${BASE}/promo-codes`);
    await page.waitForLoadState('networkidle');
    await capture(page, 'admin-A21-promo-code-form');
    // Page uses an inline form (not a dialog). Check for the form heading or inputs.
    const formHeading = page.locator('h2, h3, legend').filter({ hasText: /promo code|create|nouveau code/i }).first();
    const formInputs  = page.locator('form input[type="text"], form input:not([type="hidden"])');
    const headingVisible = await formHeading.isVisible({ timeout: 5_000 }).catch(() => false);
    const inputCount    = await formInputs.count();
    if (headingVisible || inputCount > 0) {
      log(A, 'A21', 'Create Promo Code Form', 'PASS', `heading:${headingVisible} inputs:${inputCount}`);
    } else {
      log(A, 'A21', 'Create Promo Code Form', 'FAIL', 'No form heading or inputs found on promo-codes page');
    }
  });

  // ── A22: Admin settings form has fields ──────────────────────────────────
  test('A22 — Settings page has editable fields', async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await page.waitForLoadState('networkidle');
    const inputs = page.locator('input, select, textarea');
    const count = await inputs.count();
    if (count > 0) {
      log(A, 'A22', 'Settings Has Fields', 'PASS', `${count} input(s) found`);
    } else {
      log(A, 'A22', 'Settings Has Fields', 'FAIL', 'No inputs on settings page');
    }
    await capture(page, 'admin-A22-settings');
  });

  // ── A23: Users table loads ───────────────────────────────────────────────
  test('A23 — Users table shows rows', async ({ page }) => {
    await page.goto(`${BASE}/users`);
    await page.waitForLoadState('networkidle');
    await capture(page, 'admin-A23-users');
    const rows = page.locator('table tbody tr, [class*="row"], [class*="card"]');
    const count = await rows.count();
    if (count > 0) {
      log(A, 'A23', 'Users Table Rows', 'PASS', `${count} rows`);
    } else {
      log(A, 'A23', 'Users Table Rows', 'FAIL', 'No rows in users table');
    }
  });

  // ── A24: Incubator list loads ─────────────────────────────────────────────
  test('A24 — Incubators list renders', async ({ page }) => {
    await page.goto(`${BASE}/incubators`);
    await page.waitForLoadState('networkidle');
    await capture(page, 'admin-A24-incubators');
    const text = await mainText(page);
    expect(text.length).toBeGreaterThan(20);
    log(A, 'A24', 'Incubators List', 'PASS');
  });

  // ── A25: Mobile viewport — sidebar collapses ─────────────────────────────
  test('A25 — Dashboard usable on mobile (375px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await capture(page, 'admin-A25-mobile');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    if (scrollWidth <= clientWidth + 5) {
      log(A, 'A25', 'Mobile Responsive', 'PASS');
    } else {
      log(A, 'A25', 'Mobile Responsive', 'FAIL', `Horizontal overflow: scrollWidth=${scrollWidth} clientWidth=${clientWidth}`);
    }
  });
});
