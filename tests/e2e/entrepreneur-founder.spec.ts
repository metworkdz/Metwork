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

  // ── E2-02: Dashboard mentions Founder tier ───────────────────────────────
  test('E2-02 — Dashboard shows FOUNDER membership tier', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await capture(page, 'founder-E2-02-dashboard-tier');
    const text = (await mainText(page)).toLowerCase();
    if (text.includes('founder')) {
      log(A, 'E2-02', 'Dashboard Shows FOUNDER', 'PASS');
    } else {
      log(A, 'E2-02', 'Dashboard Shows FOUNDER', 'FAIL', 'Word "founder" not on dashboard');
    }
  });

  // ── E2-03: Membership page shows FOUNDER benefits ────────────────────────
  test('E2-03 — Membership page shows FOUNDER tier', async ({ page }) => {
    await page.goto(`${BASE}/membership`);
    await page.waitForLoadState('networkidle');
    await capture(page, 'founder-E2-03-membership');
    const text = (await mainText(page)).toLowerCase();
    if (text.includes('founder')) {
      log(A, 'E2-03', 'Membership Shows FOUNDER', 'PASS');
    } else {
      log(A, 'E2-03', 'Membership Shows FOUNDER', 'FAIL', 'No "founder" on membership page');
    }
  });

  // ── E2-04: Network Pass shows 10 credits ─────────────────────────────────
  test('E2-04 — Network Pass shows 10 free sessions', async ({ page }) => {
    await page.goto(`${BASE}/network-pass`);
    await page.waitForLoadState('networkidle');
    await capture(page, 'founder-E2-04-network-pass');
    const text = await mainText(page);
    const has10 = text.includes('10') && /crédit|credit|session/i.test(text);
    if (has10) {
      log(A, 'E2-04', 'Network Pass 10 Sessions', 'PASS');
    } else {
      log(A, 'E2-04', 'Network Pass 10 Sessions', 'FAIL', 'Did not see 10 sessions/credits');
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

  // ── E2-09: Pricing page shows all tiers ──────────────────────────────────
  test('E2-09 — Pricing page shows BUILDER and FOUNDER tiers', async ({ page }) => {
    await page.goto('/en/pricing');
    await page.waitForLoadState('networkidle');
    await capture(page, 'founder-E2-09-pricing');
    const text = (await mainText(page)).toLowerCase();
    const hasBuilder  = text.includes('builder');
    const hasFounder  = text.includes('founder');
    if (hasBuilder && hasFounder) {
      log(A, 'E2-09', 'Pricing Shows All Tiers', 'PASS');
    } else {
      log(A, 'E2-09', 'Pricing Shows All Tiers', 'FAIL', `builder:${hasBuilder} founder:${hasFounder}`);
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
