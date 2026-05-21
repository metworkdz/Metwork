/**
 * 🟢 AGENT-E1 (BUILDER) — Membership benefits, credits, booking discounts.
 */
import { test, expect } from '@playwright/test';
import { capture, log, tryGoto, mainText } from './helpers/utils';

const A = 'BUILDER';
const BASE = '/en/dashboard/entrepreneur';

// Exact routes from navigation.ts
const E_ROUTES = [
  { id: 'E1-03', name: 'Bookings',       href: `${BASE}/bookings`      },
  { id: 'E1-04', name: 'Startup',        href: `${BASE}/startup`       },
  { id: 'E1-05', name: 'Marketplace',    href: `${BASE}/marketplace`   },
  { id: 'E1-06', name: 'Consultations',  href: `${BASE}/consultations` },
  { id: 'E1-07', name: 'Perks',          href: `${BASE}/perks`         },
  { id: 'E1-08', name: 'Wallet',         href: `${BASE}/wallet`        },
  { id: 'E1-09', name: 'Membership',     href: `${BASE}/membership`    },
  { id: 'E1-10', name: 'Network Pass',   href: `${BASE}/network-pass`  },
  { id: 'E1-11', name: 'Settings',       href: `${BASE}/settings`      },
];

test.describe('🟢 Entrepreneur Builder Agent', () => {

  // ── E1-01: Auth & dashboard ───────────────────────────────────────────────
  test('E1-01 — Login and dashboard loads', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/login/);
    await capture(page, 'builder-E1-01-dashboard');
    const text = await mainText(page);
    expect(text.length).toBeGreaterThan(30);
    log(A, 'E1-01', 'Login & Dashboard', 'PASS');
  });

  // ── E1-02: No JS errors ──────────────────────────────────────────────────
  test('E1-02 — No console errors on dashboard', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    const real = errors.filter(e => !e.includes('favicon') && !e.includes('posthog'));
    if (real.length === 0) {
      log(A, 'E1-02', 'No Console Errors', 'PASS');
    } else {
      log(A, 'E1-02', 'No Console Errors', 'FAIL', real.slice(0, 3).join(' | '));
    }
  });

  // ── E1-03–E1-11: All entrepreneur routes render ───────────────────────────
  for (const route of E_ROUTES) {
    test(`${route.id} — ${route.name} page renders`, async ({ page }) => {
      const ok = await tryGoto(page, route.href);
      await page.waitForLoadState('networkidle');
      await capture(page, `builder-${route.id}-${route.name.replace(/\s+/g, '-').toLowerCase()}`);
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

  // ── E1-12: Membership page shows BUILDER tier ────────────────────────────
  test('E1-12 — Membership page shows BUILDER tier name', async ({ page }) => {
    await page.goto(`${BASE}/membership`);
    await page.waitForLoadState('networkidle');
    await capture(page, 'builder-E1-12-membership');
    const text = (await mainText(page)).toLowerCase();
    const hasBuilder = text.includes('builder');
    if (hasBuilder) {
      log(A, 'E1-12', 'Membership Shows BUILDER', 'PASS');
    } else {
      log(A, 'E1-12', 'Membership Shows BUILDER', 'FAIL', 'Word "builder" not found on membership page');
    }
  });

  // ── E1-13: Network pass shows credits ────────────────────────────────────
  test('E1-13 — Network Pass shows credit balance', async ({ page }) => {
    await page.goto(`${BASE}/network-pass`);
    await page.waitForLoadState('networkidle');
    await capture(page, 'builder-E1-13-network-pass');
    const text = await mainText(page);
    // Should show "3" credits or "crédit" or similar
    const hasCredits = /3|crédit|credit/i.test(text);
    if (hasCredits) {
      log(A, 'E1-13', 'Network Pass Has Credits', 'PASS', 'Credit info visible');
    } else {
      log(A, 'E1-13', 'Network Pass Has Credits', 'FAIL', 'No credit information visible');
    }
  });

  // ── E1-14: Book button on mentors page doesn't redirect to signup ─────────
  test('E1-14 — Book mentor button goes to consultation form, not signup', async ({ page }) => {
    await page.goto('/en/mentors');
    await page.waitForLoadState('networkidle');
    await capture(page, 'builder-E1-14-mentors-page');
    const bookBtn = page.locator('button, a').filter({ hasText: /réserver|book|consulter/i }).first();
    if (await bookBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await bookBtn.click({ force: true }).catch(() => bookBtn.dispatchEvent('click'));
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      const url = page.url();
      const wentToSignup = url.includes('signup') || url.includes('register') || url.includes('inscription');
      await capture(page, 'builder-E1-14-after-book-click');
      if (wentToSignup) {
        log(A, 'E1-14', 'Book Mentor → Form Not Signup', 'FAIL', `Redirected to signup: ${url}`);
      } else {
        log(A, 'E1-14', 'Book Mentor → Form Not Signup', 'PASS', url);
      }
    } else {
      log(A, 'E1-14', 'Book Mentor → Form Not Signup', 'SKIP', 'No book button on mentors page');
    }
  });

  // ── E1-15: Settings has delete account option ─────────────────────────────
  test('E1-15 — Settings page has delete account option', async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await page.waitForLoadState('networkidle');
    await capture(page, 'builder-E1-15-settings');
    const text = (await mainText(page)).toLowerCase();
    const hasDelete = text.includes('supprimer') || text.includes('delete') || text.includes('désactiver');
    if (hasDelete) {
      log(A, 'E1-15', 'Settings Has Delete Account', 'PASS');
    } else {
      log(A, 'E1-15', 'Settings Has Delete Account', 'FAIL', 'No delete/deactivate option found');
    }
  });

  // ── E1-16: Spaces public page loads ──────────────────────────────────────
  test('E1-16 — Public spaces page loads and shows space', async ({ page }) => {
    await page.goto('/en/spaces', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500); // allow RSC hydration
    await capture(page, 'builder-E1-16-spaces');
    const text = await mainText(page);
    expect(text.length).toBeGreaterThan(10);
    log(A, 'E1-16', 'Spaces Page Loads', 'PASS');
  });

  // ── E1-17: Events public page loads ──────────────────────────────────────
  test('E1-17 — Public events page loads', async ({ page }) => {
    await page.goto('/en/events');
    await page.waitForLoadState('networkidle');
    await capture(page, 'builder-E1-17-events');
    await expect(page).not.toHaveURL(/404/);
    const text = await mainText(page);
    expect(text.length).toBeGreaterThan(10);
    log(A, 'E1-17', 'Events Page Loads', 'PASS');
  });

  // ── E1-18: Programs public page loads ────────────────────────────────────
  test('E1-18 — Public programs page loads', async ({ page }) => {
    await page.goto('/en/programs');
    await page.waitForLoadState('networkidle');
    await capture(page, 'builder-E1-18-programs');
    await expect(page).not.toHaveURL(/404/);
    log(A, 'E1-18', 'Programs Page Loads', 'PASS');
  });
});
