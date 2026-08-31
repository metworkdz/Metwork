/**
 * 🔵 AGENT-E2 (FOUNDER) — Premium features, 20% discount, 10 sessions, 3 consultations.
 */
import { test, expect } from '@playwright/test';
import { capture, log, mainText } from './helpers/utils';

const A = 'FOUNDER';
const BASE = '/en/dashboard/entrepreneur';

test.describe('🔵 Entrepreneur Founder Agent', () => {

  // ── E2-01: Auth & dashboard ───────────────────────────────────────────────
  test('E2-01 — Login and dashboard loads', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/login/);
    await capture(page, 'founder-E2-01-dashboard');
    log(A, 'E2-01', 'Login & Dashboard', 'PASS');
  });

  // ── E2-02: Dashboard mentions the Startup plan ───────────────────────────
  test('E2-02 — Dashboard shows the Startup membership plan', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await capture(page, 'founder-E2-02-dashboard-tier');
    const text = (await mainText(page)).toLowerCase();
    if (text.includes('startup')) {
      log(A, 'E2-02', 'Dashboard Shows Startup', 'PASS');
    } else {
      log(A, 'E2-02', 'Dashboard Shows Startup', 'FAIL', 'Word "startup" not on dashboard');
    }
  });

  // ── E2-03: Membership page shows the Startup plan ────────────────────────
  test('E2-03 — Membership page shows the Startup plan', async ({ page }) => {
    await page.goto(`${BASE}/membership`);
    await page.waitForLoadState('networkidle');
    await capture(page, 'founder-E2-03-membership');
    const text = (await mainText(page)).toLowerCase();
    // The retired name must be absent: this account's tier value is still
    // FOUNDER internally, so "Founder" on the page means a raw value leaked.
    const hasStartup = text.includes('startup');
    const hasRetired = text.includes('founder');
    if (hasStartup && !hasRetired) {
      log(A, 'E2-03', 'Membership Shows Startup', 'PASS');
    } else {
      log(A, 'E2-03', 'Membership Shows Startup', 'FAIL',
        `startup:${hasStartup} retired-"founder":${hasRetired}`);
    }
  });

  // ── E2-04: Network Pass placeholder while the feature is off ─────────────
  test('E2-04 — Network Pass shows the coming-soon placeholder', async ({ page }) => {
    await page.goto(`${BASE}/network-pass`);
    await page.waitForLoadState('networkidle');
    await capture(page, 'founder-E2-04-network-pass');
    const text = await mainText(page);
    // Network Pass is switched off (src/config/feature-flags.ts). A Startup
    // member still HOLDS an allowance — it is simply not redeemable or shown.
    const hasComingSoon = /coming soon|bientôt|قريبا|قريباً/i.test(text);
    const noQr = !/refresh qr|actualiser qr/i.test(text);
    if (hasComingSoon && noQr) {
      log(A, 'E2-04', 'Network Pass Placeholder', 'PASS');
    } else {
      log(A, 'E2-04', 'Network Pass Placeholder', 'FAIL', `comingSoon:${hasComingSoon} noQr:${noQr}`);
    }
  });

  // ── E2-05: Consultations page is accessible ───────────────────────────────
  test('E2-05 — Consultations page accessible', async ({ page }) => {
    await page.goto(`${BASE}/consultations`);
    await page.waitForLoadState('networkidle');
    await capture(page, 'founder-E2-05-consultations');
    await expect(page).not.toHaveURL(/login/);
    const text = await mainText(page);
    expect(text.length).toBeGreaterThan(10);
    log(A, 'E2-05', 'Consultations Page', 'PASS');
  });

  // ── E2-06: Wallet page accessible ────────────────────────────────────────
  test('E2-06 — Wallet page accessible', async ({ page }) => {
    await page.goto(`${BASE}/wallet`);
    await page.waitForLoadState('networkidle');
    await capture(page, 'founder-E2-06-wallet');
    await expect(page).not.toHaveURL(/login/);
    log(A, 'E2-06', 'Wallet Page', 'PASS');
  });

  // ── E2-07: All sidebar nav links resolve ─────────────────────────────────
  test('E2-07 — All dashboard sidebar links resolve without 404', async ({ page }) => {
    test.setTimeout(90_000); // Extended for sequential navigation
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    const anchors = await page.locator('nav a[href], aside a[href]').all();
    const hrefs = (await Promise.all(anchors.map((a) => a.getAttribute('href'))))
      .filter((h): h is string => !!h && !h.startsWith('mailto') && h !== '#')
      .slice(0, 12); // cap at 12 links to stay within timeout
    const broken: string[] = [];
    for (const href of hrefs) {
      const resp = await page.goto(
        href.startsWith('/') ? href : `/en${href}`,
        { waitUntil: 'domcontentloaded', timeout: 8_000 },
      ).catch(() => null);
      if (resp?.status() === 404) broken.push(href);
    }
    if (broken.length === 0) {
      log(A, 'E2-07', 'All Nav Links Resolve', 'PASS');
    } else {
      log(A, 'E2-07', 'All Nav Links Resolve', 'FAIL', `404s: ${broken.join(', ')}`);
    }
    await capture(page, 'founder-E2-07-nav-links');
  });

  // ── E2-08: LinkedIn button on mentors page has valid href ─────────────────
  test('E2-08 — Mentors page LinkedIn buttons have valid hrefs', async ({ page }) => {
    await page.goto('/en/mentors');
    await page.waitForLoadState('networkidle');
    await capture(page, 'founder-E2-08-mentors');
    const linkedinLinks = await page.locator('a[href*="linkedin"]').all();
    if (linkedinLinks.length === 0) {
      log(A, 'E2-08', 'Mentors LinkedIn Buttons', 'SKIP', 'No mentors with LinkedIn shown');
      return;
    }
    const badLinks: string[] = [];
    for (const link of linkedinLinks) {
      const href = await link.getAttribute('href');
      if (!href || href.trim() === '' || href === '#') badLinks.push(href ?? 'empty');
    }
    if (badLinks.length === 0) {
      log(A, 'E2-08', 'Mentors LinkedIn Buttons', 'PASS', `${linkedinLinks.length} valid link(s)`);
    } else {
      log(A, 'E2-08', 'Mentors LinkedIn Buttons', 'FAIL', `Bad hrefs: ${badLinks.join(', ')}`);
    }
  });

  // ── E2-09: Pricing page shows all plans ──────────────────────────────────
  test('E2-09 — Pricing page shows the Entrepreneur and Startup plans', async ({ page }) => {
    await page.goto('/en/pricing');
    await page.waitForLoadState('networkidle');
    await capture(page, 'founder-E2-09-pricing');
    // Plan CARD TITLES, not page prose: the titles are uppercased by CSS, and
    // the marketing copy on this page says "founders" in several places, which
    // would false-positive any page-wide search for the retired name.
    const titles = (await page.locator('h3').allInnerTexts()).map((t) => t.trim().toUpperCase());
    const hasEntrepreneur = titles.includes('ENTREPRENEUR');
    const hasStartup      = titles.includes('STARTUP');
    if (hasEntrepreneur && hasStartup) {
      log(A, 'E2-09', 'Pricing Shows All Plans', 'PASS');
    } else {
      log(A, 'E2-09', 'Pricing Shows All Plans', 'FAIL',
        `entrepreneur:${hasEntrepreneur} startup:${hasStartup}`);
    }
  });

  // ── E2-10: Perks page accessible ─────────────────────────────────────────
  test('E2-10 — Perks page accessible', async ({ page }) => {
    await page.goto(`${BASE}/perks`);
    await page.waitForLoadState('networkidle');
    await capture(page, 'founder-E2-10-perks');
    await expect(page).not.toHaveURL(/login/);
    log(A, 'E2-10', 'Perks Page', 'PASS');
  });
});
