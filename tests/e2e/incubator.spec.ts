/**
 * 🟠 AGENT-INCUBATOR — Spaces, programs, bookings, CRM, finances.
 */
import { test, expect } from '@playwright/test';
import { capture, log, tryGoto, mainText } from './helpers/utils';

const A = 'INCUBATOR';
const BASE = '/en/dashboard/incubator';
const TS = Date.now();

// Known incubator routes from navigation.ts
const INCUBATOR_ROUTES = [
  { id: 'I03', name: 'Analytics',  href: `${BASE}/analytics` },
  { id: 'I04', name: 'Clients',    href: `${BASE}/clients`   },
  { id: 'I05', name: 'Income',     href: `${BASE}/income`    },
  { id: 'I06', name: 'Expenses',   href: `${BASE}/expenses`  },
  { id: 'I07', name: 'Services',   href: `${BASE}/services`  },
  { id: 'I08', name: 'Spaces',     href: `${BASE}/spaces`    },
  { id: 'I09', name: 'Programs',   href: `${BASE}/programs`  },
  { id: 'I10', name: 'Events',     href: `${BASE}/events`    },
  { id: 'I11', name: 'Bookings',   href: `${BASE}/bookings`  },
  { id: 'I12', name: 'Revenue',    href: `${BASE}/revenue`   },
  { id: 'I13', name: 'Invoices',   href: `${BASE}/invoices`  },
  { id: 'I14', name: 'Wallet',     href: `${BASE}/wallet`    },
  { id: 'I15', name: 'Settings',   href: `${BASE}/settings`  },
];

test.describe('🟠 Incubator Agent', () => {

  // ── I01: Auth & dashboard ─────────────────────────────────────────────────
  test('I01 — Login and dashboard loads', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/login/);
    await capture(page, 'incubator-I01-dashboard');
    const text = await mainText(page);
    expect(text.length).toBeGreaterThan(30);
    log(A, 'I01', 'Login & Dashboard', 'PASS');
  });

  // ── I02: No JS errors ────────────────────────────────────────────────────
  test('I02 — No console errors on dashboard', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    const real = errors.filter(e => !e.includes('favicon') && !e.includes('posthog'));
    if (real.length === 0) {
      log(A, 'I02', 'No Console Errors', 'PASS');
    } else {
      log(A, 'I02', 'No Console Errors', 'FAIL', real.slice(0, 3).join(' | '));
    }
  });

  // ── I03–I15: All incubator routes render ─────────────────────────────────
  for (const route of INCUBATOR_ROUTES) {
    test(`${route.id} — ${route.name} page renders`, async ({ page }) => {
      const ok = await tryGoto(page, route.href);
      await page.waitForLoadState('networkidle');
      await capture(page, `incubator-${route.id.toLowerCase()}-${route.name.toLowerCase()}`);
      if (ok) {
        const text = await mainText(page);
        if (text.trim().length < 20) {
          log(A, route.id, route.name, 'FAIL', 'Page appears empty');
        } else {
          log(A, route.id, route.name, 'PASS');
        }
      } else {
        log(A, route.id, route.name, 'FAIL', `404 at ${route.href}`);
      }
    });
  }

  // ── I16: Create space dialog opens ──────────────────────────────────────
  test('I16 — Create space dialog opens', async ({ page }) => {
    await page.goto(`${BASE}/spaces`);
    await page.waitForLoadState('networkidle');
    const addBtn = page.locator('button').filter({ hasText: /ajouter|créer|nouveau|add|new|create/i }).first();
    if (await addBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(800);
      const dialog = page.locator('[role="dialog"], dialog');
      if (await dialog.first().isVisible({ timeout: 4_000 }).catch(() => false)) {
        await capture(page, 'incubator-I16-create-space-dialog');
        log(A, 'I16', 'Create Space Dialog', 'PASS');
        await page.keyboard.press('Escape');
      } else {
        // May navigate to a new page form instead of dialog
        const isForm = (await page.locator('form input').count()) > 0;
        if (isForm) {
          log(A, 'I16', 'Create Space Dialog', 'PASS', 'Opens form page (no dialog)');
        } else {
          log(A, 'I16', 'Create Space Dialog', 'FAIL', 'No dialog or form appeared');
        }
      }
    } else {
      log(A, 'I16', 'Create Space Dialog', 'SKIP', 'Add button not visible');
    }
  });

  // ── I17: Income service field is a dropdown ───────────────────────────────
  test('I17 — Income form: service field is a select/dropdown (not free text)', async ({ page }) => {
    await page.goto(`${BASE}/income`);
    await page.waitForLoadState('networkidle');
    const addBtn = page.locator('button').filter({ hasText: /ajouter|add|nouveau|new|revenu/i }).first();
    if (await addBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(800);
      // Service should be select / combobox, NOT a raw text <input>
      const selectOrCombobox = page.locator(
        'select[name*="service"], [role="combobox"], [data-testid*="service"], [class*="select"]',
      ).first();
      const rawTextForService = page.locator('input[name="service"][type="text"]').first();

      const hasSelect = await selectOrCombobox.isVisible({ timeout: 3_000 }).catch(() => false);
      const hasRawText = await rawTextForService.isVisible({ timeout: 1_000 }).catch(() => false);

      await capture(page, 'incubator-I17-income-form');
      if (hasSelect && !hasRawText) {
        log(A, 'I17', 'Income Service Is Dropdown', 'PASS');
      } else if (hasRawText) {
        log(A, 'I17', 'Income Service Is Dropdown', 'FAIL', 'Service is free-text input, not a dropdown');
      } else {
        log(A, 'I17', 'Income Service Is Dropdown', 'SKIP', 'Could not determine — form may not have opened');
      }
    } else {
      log(A, 'I17', 'Income Service Is Dropdown', 'SKIP', 'Add income button not found');
    }
  });

  // ── I18: Create program flow ──────────────────────────────────────────────
  test('I18 — Create program dialog/form opens', async ({ page }) => {
    await page.goto(`${BASE}/programs`);
    await page.waitForLoadState('networkidle');
    const addBtn = page.locator('button').filter({ hasText: /créer|ajouter|nouveau|new|add/i }).first();
    if (await addBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(800);
      const hasForm = (await page.locator('[role="dialog"] form, form').count()) > 0;
      await capture(page, 'incubator-I18-create-program');
      log(A, 'I18', 'Create Program Form', hasForm ? 'PASS' : 'FAIL', hasForm ? '' : 'No form found');
    } else {
      log(A, 'I18', 'Create Program Form', 'SKIP', 'Add button not found');
    }
  });

  // ── I19: Bookings list renders ───────────────────────────────────────────
  test('I19 — Bookings list renders', async ({ page }) => {
    await page.goto(`${BASE}/bookings`);
    await page.waitForLoadState('networkidle');
    await capture(page, 'incubator-I19-bookings');
    const text = await mainText(page);
    expect(text.length).toBeGreaterThan(10);
    log(A, 'I19', 'Bookings List', 'PASS');
  });

  // ── I20: Mobile responsive ───────────────────────────────────────────────
  test('I20 — Dashboard usable on mobile (375px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await capture(page, 'incubator-I20-mobile');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    if (scrollWidth <= clientWidth + 5) {
      log(A, 'I20', 'Mobile Responsive', 'PASS');
    } else {
      log(A, 'I20', 'Mobile Responsive', 'FAIL', `Overflow: ${scrollWidth} > ${clientWidth}`);
    }
  });
});
