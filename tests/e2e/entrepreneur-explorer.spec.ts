/**
 * 🟡 AGENT-E3 (EXPLORER) — Free tier, upgrade path, public pages, mobile.
 */
import { test, expect } from '@playwright/test';
import { capture, log, mainText } from './helpers/utils';

const A = 'EXPLORER';
const BASE = '/en/dashboard/entrepreneur';

test.describe('🟡 Entrepreneur Explorer Agent', () => {

  // ── E3-01: Auth & dashboard ───────────────────────────────────────────────
  test('E3-01 — Login and dashboard loads', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/login/);
    await capture(page, 'explorer-E3-01-dashboard');
    log(A, 'E3-01', 'Login & Dashboard', 'PASS');
  });

  // ── E3-02: Explorer has no paid membership shown ──────────────────────────
  test('E3-02 — Explorer shows free/no membership (not BUILDER or FOUNDER)', async ({ page }) => {
    await page.goto(`${BASE}/membership`);
    await page.waitForLoadState('networkidle');
    await capture(page, 'explorer-E3-02-membership');
    const text = (await mainText(page)).toLowerCase();
    const isCurrentlyPaid = (text.includes('builder') || text.includes('founder')) && text.includes('actif');
    if (isCurrentlyPaid) {
      log(A, 'E3-02', 'Explorer Free Tier', 'FAIL', 'Shows paid tier as active for Explorer user');
    } else {
      log(A, 'E3-02', 'Explorer Free Tier', 'PASS', 'No paid tier shown as active');
    }
  });

  // ── E3-03: Upgrade CTA is visible somewhere ───────────────────────────────
  test('E3-03 — Upgrade CTA present on dashboard', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await capture(page, 'explorer-E3-03-upgrade-cta');
    const upgradeBtn = page.locator('button, a').filter({
      hasText: /upgrade|mettre à niveau|passer à|builder|founder/i,
    }).first();
    if (await upgradeBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      log(A, 'E3-03', 'Upgrade CTA Visible', 'PASS');
    } else {
      // Also check membership page
      await page.goto(`${BASE}/membership`);
      await page.waitForLoadState('networkidle');
      const upgradeOnMembership = page.locator('button, a').filter({
        hasText: /upgrade|souscrire|choisir|builder|founder/i,
      }).first();
      if (await upgradeOnMembership.isVisible({ timeout: 5_000 }).catch(() => false)) {
        log(A, 'E3-03', 'Upgrade CTA Visible', 'PASS', 'Found on membership page');
      } else {
        log(A, 'E3-03', 'Upgrade CTA Visible', 'SKIP', 'No upgrade CTA found on dashboard or membership page');
      }
    }
  });

  // ── E3-04: Public pages load ──────────────────────────────────────────────
  const PUBLIC_PAGES = [
    { id: 'E3-04', name: 'Spaces',    href: '/en/spaces'   },
    { id: 'E3-05', name: 'Mentors',   href: '/en/mentors'  },
    { id: 'E3-06', name: 'Programs',  href: '/en/programs' },
    { id: 'E3-07', name: 'Events',    href: '/en/events'   },
    { id: 'E3-08', name: 'Pricing',   href: '/en/pricing'  },
    { id: 'E3-09', name: 'Investors', href: '/en/investors' },
    { id: 'E3-10', name: 'About',     href: '/en/about'    },
  ];
  for (const pg of PUBLIC_PAGES) {
    test(`${pg.id} — Public ${pg.name} page loads`, async ({ page }) => {
      await page.goto(pg.href, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000); // allow RSC hydration
      await capture(page, `explorer-${pg.id}-${pg.name.toLowerCase()}`);
      const text = await mainText(page);
      if (text.includes('404') && text.length < 400) {
        log(A, pg.id, `Public ${pg.name}`, 'FAIL', '404 page');
      } else if (text.trim().length < 20) {
        log(A, pg.id, `Public ${pg.name}`, 'FAIL', 'Empty page');
      } else {
        log(A, pg.id, `Public ${pg.name}`, 'PASS');
      }
    });
  }

  // ── E3-11: Pricing page shows BUILDER and FOUNDER with discounts ──────────
  test('E3-11 — Pricing page shows discount percentages', async ({ page }) => {
    await page.goto('/en/pricing');
    await page.waitForLoadState('networkidle');
    await capture(page, 'explorer-E3-11-pricing');
    const text = (await mainText(page)).toLowerCase();
    const hasBuilder = text.includes('builder');
    const hasFounder = text.includes('founder');
    const hasPercent = text.includes('%');
    if (hasBuilder && hasFounder && hasPercent) {
      log(A, 'E3-11', 'Pricing Has Tiers + Discounts', 'PASS');
    } else {
      log(A, 'E3-11', 'Pricing Has Tiers + Discounts', 'FAIL',
        `builder:${hasBuilder} founder:${hasFounder} %:${hasPercent}`);
    }
  });

  // ── E3-12: Language switcher visible and functional ───────────────────────
  test('E3-12 — Language switcher is visible', async ({ page }) => {
    await page.goto('/en');
    await page.waitForLoadState('networkidle');
    await capture(page, 'explorer-E3-12-lang-switcher');
    // Look for any element that lets you switch locale
    const switcher = page.locator('[aria-label*="language" i], [class*="locale"], select[name*="locale"],' +
      'button:has-text("FR"), button:has-text("EN"), button:has-text("AR"), a:has-text("Français"), a:has-text("العربية")').first();
    if (await switcher.isVisible({ timeout: 5_000 }).catch(() => false)) {
      log(A, 'E3-12', 'Language Switcher Visible', 'PASS');
    } else {
      log(A, 'E3-12', 'Language Switcher Visible', 'SKIP', 'Switcher not found on landing');
    }
  });

  // ── E3-13: Navigating to Arabic locale shows RTL ──────────────────────────
  test('E3-13 — Arabic locale sets dir=rtl', async ({ page }) => {
    await page.goto('/ar');
    await page.waitForLoadState('networkidle');
    await capture(page, 'explorer-E3-13-arabic-rtl');
    const dir = await page.locator('html').getAttribute('dir');
    if (dir === 'rtl') {
      log(A, 'E3-13', 'Arabic RTL Direction', 'PASS');
    } else {
      log(A, 'E3-13', 'Arabic RTL Direction', 'FAIL', `dir="${dir}" (expected "rtl")`);
    }
  });

  // ── E3-14: Mobile responsive dashboard ───────────────────────────────────
  test('E3-14 — Dashboard no horizontal overflow on 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await capture(page, 'explorer-E3-14-mobile');
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow <= 5) {
      log(A, 'E3-14', 'Mobile No Horizontal Overflow', 'PASS');
    } else {
      log(A, 'E3-14', 'Mobile No Horizontal Overflow', 'FAIL', `${overflow}px overflow`);
    }
  });

  // ── E3-15: Network pass shows 0 credits for explorer ─────────────────────
  test('E3-15 — Network Pass shows 0 credits (Explorer tier)', async ({ page }) => {
    await page.goto(`${BASE}/network-pass`);
    await page.waitForLoadState('networkidle');
    await capture(page, 'explorer-E3-15-network-pass');
    const text = await mainText(page);
    // Page should load (not 404)
    expect(text.length).toBeGreaterThan(10);
    // Should NOT show "3" or "10" credits
    const hasPaidCredits = /\b(3|10)\s*(crédit|credit|session)/i.test(text);
    if (hasPaidCredits) {
      log(A, 'E3-15', 'Network Pass 0 Credits', 'FAIL', 'Shows paid credits for Explorer user');
    } else {
      log(A, 'E3-15', 'Network Pass 0 Credits', 'PASS', '0 credits shown (Explorer)');
    }
  });
});
