/**
 * Mobile screenshots of the consultant portal, for the explainer video.
 *
 * Not an assertion suite — it drives the real portal at phone size and writes
 * one JPEG per section. It still fails loudly if a section doesn't render, so a
 * broken page can never be shipped as a "screenshot".
 *
 * The portal is ONE route (`/mentordashboard`) with client-side tabs and no
 * `?tab=` deep link, so each shot is taken by tapping the bottom bar. Only four
 * tabs are promoted there — Revenus lives behind the "Plus" sheet, which is why
 * that one takes an extra tap.
 *
 * Run against the local dev server, with a session minted for the demo account:
 *
 *   USE_LOCAL_DB=true npx next dev                     # terminal 1
 *   CONSULTANT_SESSION=<metwork_consultant cookie> \
 *   SHOTS_DIR=/tmp/shots \
 *     npx playwright test --project=consultant-demo-shots
 *
 * The cookie comes from signing in once with curl (the OTP is printed to the
 * dev-server console when Resend is unconfigured — see
 * `scripts/consultant-demo-account.ts`).
 */
import { test, expect, devices, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * iPhone 13 metrics (DPR 3, mobile UA, touch) with ONE override: the
 * descriptor's viewport is 390 × 664, the height left over inside Safari's
 * chrome. These frames are composited into a phone mock-up in the video, where
 * there is no browser chrome, so the full 390 × 844 screen is the honest frame
 * — and it fits noticeably more of each section. Output: 1170 × 2532 px.
 */
test.use({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, browserName: 'chromium' });

const SESSION = process.env.CONSULTANT_SESSION ?? '';
const OUT = process.env.SHOTS_DIR ?? 'tests/screenshots/consultant-demo';

/**
 * Tab label in the bottom bar → output filename, in walkthrough order.
 *
 * `framing: 'hero'` keeps the page at the top — that block (approval, public
 * link, balance) IS the home screen. Every other section is framed on its own
 * content instead: the hero repeats above all of them, and five screenshots
 * that all lead with the same card would show the viewer nothing.
 */
const SHOTS = [
  { label: null, file: 'mentordashboard-01-consultations.jpg', anchor: null },
  { label: 'Disponibilités', file: 'mentordashboard-02-disponibilites.jpg', anchor: 'Disponibilités' },
  { label: 'Profil', file: 'mentordashboard-03-profil.jpg', anchor: 'Tarif horaire' },
  { label: 'Revenus', file: 'mentordashboard-04-revenus.jpg', anchor: 'Revenus', viaMore: true },
  { label: 'Portefeuille', file: 'mentordashboard-05-portefeuille.jpg', anchor: 'Portefeuille' },
] as const;

/** The bottom bar; scoped so its labels never collide with the lg: sidebar. */
const bottomBar = (page: Page) => page.locator('nav.fixed').last();

/**
 * Bring the section's own heading to the top of the frame.
 *
 * Anchored on the heading TEXT, not on `<main>`: the hero block (approval
 * banner, public link, balance) is itself inside `<main>`, so scrolling to
 * `main` moves nothing and every screenshot leads with the same card.
 * `scroll-margin-top` keeps the heading clear of the sticky header.
 */
async function frameSection(page: Page, anchor: string): Promise<void> {
  const heading = page.locator('main').getByText(anchor, { exact: true }).first();
  await heading.evaluate((el) => {
    // Exactly the sticky header's height, measured rather than guessed: any
    // gap leaves the tail of the previous field peeking out in a half-cut
    // line under the header, and any excess hides the heading behind it.
    const header = document.querySelector('header');
    const offset = header ? Math.round(header.getBoundingClientRect().height) : 56;
    (el as HTMLElement).style.scrollMarginTop = `${offset}px`;
    el.scrollIntoView({ block: 'start', behavior: 'auto' });
  });
  await page.waitForTimeout(300);
}

async function settle(page: Page): Promise<void> {
  // The sections fetch on mount; give the network a beat, then let the tab
  // transition and any sheet animation finish before the shutter.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
}

test('capture the consultant portal at phone size', async ({ page, context }) => {
  expect(SESSION, 'CONSULTANT_SESSION must hold the metwork_consultant cookie value').not.toBe('');
  fs.mkdirSync(OUT, { recursive: true });

  await context.addCookies([
    { name: 'metwork_consultant', value: SESSION, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' },
    // The portal is French by default, but pin it so a stray cookie from a
    // previous run can't produce a mixed-language set of screenshots.
    { name: 'metwork_consultant_locale', value: 'fr', domain: 'localhost', path: '/', sameSite: 'Lax' },
  ]);

  await page.goto('/mentordashboard');
  // Wait on the bottom bar, not on the consultant's name: the name also appears
  // in the lg: sidebar, which is in the DOM but hidden at phone width — so the
  // first match is an invisible one and the wait never resolves.
  await expect(bottomBar(page).getByRole('button', { name: 'Consultations' })).toBeVisible({ timeout: 60_000 });
  await settle(page);

  for (const shot of SHOTS) {
    if (shot.label) {
      if ('viaMore' in shot && shot.viaMore) {
        await bottomBar(page).getByRole('button', { name: 'Plus' }).click();
        await page.waitForTimeout(400);
        await page.getByRole('button', { name: shot.label }).click();
      } else {
        await bottomBar(page).getByRole('button', { name: shot.label }).click();
      }
      await settle(page);
    }

    if (shot.anchor) await frameSection(page, shot.anchor);

    // A blank section would otherwise be captured as a perfectly valid JPEG.
    await expect(page.locator('main')).not.toBeEmpty();

    await page.screenshot({
      path: path.join(OUT, shot.file),
      type: 'jpeg',
      quality: 92,
    });
  }

  // Same frame for all five — the video compositing depends on it.
  const sizes = SHOTS.map((s) => fs.statSync(path.join(OUT, s.file)).size);
  expect(sizes.every((b) => b > 10_000)).toBe(true);
});
