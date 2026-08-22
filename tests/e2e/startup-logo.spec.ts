/**
 * Startup logo field — UI e2e.
 *
 * 1. Founder logs in, fills out (or edits) their startup listing, uploads a
 *    logo through the profile form, publishes it, and saves.
 * 2. We assert the API confirms `logoUrl` persisted on the founder's listing.
 * 3. A second listing (no logo) is created directly via the API as the
 *    `builder` founder, so the marketplace has one listing WITH a logo and
 *    one WITHOUT.
 * 4. An investor session (separate browser context) opens the marketplace and
 *    we assert: the logo renders as a `rounded-full` <img> with the uploaded
 *    URL, and the no-logo listing renders an initials fallback occupying the
 *    exact same footprint (proving no layout shift between the two states).
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import * as path from 'node:path';
import { authStatePath } from './global-setup';
import { roleContext } from './api/_helpers';

const LOGO_FIXTURE = path.resolve(__dirname, 'fixtures/test-logo.png');

test.describe('Startup logo field', () => {
  let builderCtx: APIRequestContext;
  let noLogoName: string;

  test.beforeAll(async () => {
    builderCtx = await roleContext('builder');
    noLogoName = `QA NoLogo Startup ${Date.now()}`;

    const createRes = await builderCtx.post('/api/startups', {
      data: {
        name: noLogoName,
        description: 'Automated e2e fixture startup with no logo. Safe to delete.',
        industry: 'SaaS',
        fundingGoal: 500_000,
        equityOffered: 10,
        maturityStage: 'IDEA',
      },
    });
    expect(createRes.status(), `create no-logo startup → ${createRes.status()} ${await createRes.text()}`).toBe(201);
    const created = await createRes.json();

    const patchRes = await builderCtx.patch(`/api/startups/${created.id}`, { data: { status: 'ACTIVE' } });
    expect(patchRes.status(), `publish no-logo startup → ${patchRes.status()}`).toBe(200);
  });

  test.afterAll(async () => {
    await builderCtx.dispose();
  });

  test('founder uploads a logo, it persists, and renders correctly across the marketplace', async ({ page, browser }) => {
    const founderName = `QA Founder Logo Startup ${Date.now()}`;

    // ── 1. Founder: My Startup → fill form, upload logo, publish, save ──
    // Already authenticated via the project's storageState (founder).
    await page.goto('/en/dashboard/entrepreneur/startup');
    await page.waitForLoadState('networkidle');

    await page.fill('#su-name', founderName);
    await page.fill('#su-funding', '500000');
    await page.fill('#su-equity', '10');
    await page.locator('#su-stage').click();
    await page.getByRole('option', { name: 'Idea', exact: true }).click();
    await page.fill('#su-desc', 'Automated e2e fixture startup with a logo. Safe to delete.');

    const uploadResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/startups/logo') && r.request().method() === 'POST',
    );
    await page.locator('input[type="file"][accept*="image/jpeg"]').setInputFiles(LOGO_FIXTURE);
    const uploadResponse = await uploadResponsePromise;
    expect(uploadResponse.ok(), `logo upload → ${uploadResponse.status()}`).toBeTruthy();
    const { url: uploadedLogoUrl } = (await uploadResponse.json()) as { url: string };
    expect(uploadedLogoUrl).toBeTruthy();

    // Publish so it appears on the investor marketplace.
    await page.locator('#su-status').click();
    await page.getByRole('option', { name: 'Active', exact: true }).click();

    await page.getByRole('button', { name: /create listing|save changes/i }).click();
    await expect(page.getByText('Startup profile saved successfully.')).toBeVisible();

    // ── 2. Assert persisted server-side ──
    const mineRes = await page.request.get('/api/startups?mine=true');
    expect(mineRes.ok(), `mine listing → ${mineRes.status()}`).toBeTruthy();
    const mine = (await mineRes.json()) as { items: Array<{ name: string; logoUrl: string | null; status: string }> };
    const founderListing = mine.items.find((s) => s.name === founderName);
    expect(founderListing, 'founder listing should exist').toBeTruthy();
    expect(founderListing!.logoUrl).toBe(uploadedLogoUrl);
    expect(founderListing!.status).toBe('ACTIVE');

    // ── 3./4. Investor view: marketplace renders both cards correctly ──
    const investorCtx = await browser.newContext({ storageState: authStatePath('investor') });
    const investorPage = await investorCtx.newPage();
    try {
      await investorPage.goto('/en/dashboard/investor/startups');
      await investorPage.waitForLoadState('networkidle');

      // Founder's card: rounded-full <img> with the uploaded logo.
      const founderHeading = investorPage.getByText(founderName, { exact: true });
      await expect(founderHeading).toBeVisible();
      const founderLogo = founderHeading.locator('xpath=preceding-sibling::span[1]');
      const founderImg = founderLogo.locator('img');
      await expect(founderImg).toHaveCount(1);
      await expect(founderImg).toHaveClass(/rounded-full/);
      const src = await founderImg.getAttribute('src');
      expect(src).toBeTruthy();
      expect(decodeURIComponent(src!)).toContain(uploadedLogoUrl);

      // No-logo card: initials fallback, no <img>, same fixed footprint.
      const noLogoHeading = investorPage.getByText(noLogoName, { exact: true });
      await expect(noLogoHeading).toBeVisible();
      const noLogoAvatar = noLogoHeading.locator('xpath=preceding-sibling::span[1]');
      await expect(noLogoAvatar.locator('img')).toHaveCount(0);
      await expect(noLogoAvatar).toHaveText(/^[A-Z]{1,2}$/);

      const founderBox = await founderLogo.boundingBox();
      const noLogoBox = await noLogoAvatar.boundingBox();
      expect(founderBox).toBeTruthy();
      expect(noLogoBox).toBeTruthy();
      expect(founderBox!.width).toBeGreaterThan(0);
      expect(founderBox!.width).toBe(noLogoBox!.width);
      expect(founderBox!.height).toBe(noLogoBox!.height);
    } finally {
      await investorCtx.close();
    }
  });
});
