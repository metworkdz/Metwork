/**
 * Entrepreneur dashboard on a phone — layout + booking copy.
 *
 * WHY THIS SUITE EXISTS
 *  • LAYOUT. The Dialog primitive used to centre itself with
 *    `-translate-x-1/2 -translate-y-1/2`, which shares the `transform`
 *    property with its own `zoom-in-95` enter animation. Whenever the
 *    animation was applied the translate lost, and the dialog rendered shoved
 *    half its own width off-centre — most visibly on a phone, where half a
 *    dialog is most of the screen. Centring now happens in layout
 *    (`inset-0 + m-auto + h-fit`), so these assertions pin it there.
 *  • COPY. Consultations are pay-first and confirm on settlement; admin review
 *    was retired (PATCH /api/admin/mentor-bookings/:id is a 410 tombstone).
 *    The booking UI still told members "Requests are reviewed by our team […]
 *    this is not an automatic booking", which is simply not what happens. The
 *    string assertions below stop that model from creeping back.
 *
 * Run: npx playwright test --project=entrepreneur-mobile
 */
import { test, expect, devices, type Browser, type Page } from '@playwright/test';
import { getSignupOtpByPendingId } from './api/_otp';

// iPhone 13 metrics on Chromium — see the project config for why.
test.use({ ...devices['iPhone 13'], browserName: 'chromium' });

/** Every main page of the entrepreneur dashboard. */
const PAGES = [
  { name: 'Overview',      path: '/en/dashboard/entrepreneur' },
  { name: 'Bookings',      path: '/en/dashboard/entrepreneur/bookings' },
  { name: 'Consultations', path: '/en/dashboard/entrepreneur/consultations' },
  { name: 'Wallet',        path: '/en/dashboard/entrepreneur/wallet' },
  { name: 'Membership',    path: '/en/dashboard/entrepreneur/membership' },
  { name: 'Settings',      path: '/en/dashboard/entrepreneur/settings' },
] as const;

/** Old admin-review copy, in all three locales. None of it may survive. */
const RETIRED_COPY = [
  'reviewed by our team',
  'not an automatic booking',
  'Admin confirms the exact amount',
  'examinées par notre équipe',
  "n'est pas une réservation automatique",
  'تُراجع طلباتك فريقنا',
];

async function documentOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

test.describe('Mobile layout — no horizontal scroll', () => {
  for (const p of PAGES) {
    test(`${p.name} fits the viewport`, async ({ page }) => {
      await page.goto(p.path);
      await page.waitForLoadState('networkidle');

      const { scrollWidth, clientWidth } = await documentOverflow(page);
      // 1px of tolerance for sub-pixel rounding at device scale factors.
      expect(
        scrollWidth,
        `${p.name}: document is ${scrollWidth}px wide in a ${clientWidth}px viewport`,
      ).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});

test.describe('Consultation booking dialog on a phone', () => {
  test('is horizontally centred, fits the viewport, and shows its CTA', async ({ page }) => {
    await page.goto('/en/dashboard/entrepreneur/consultations');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Book', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const box = (await dialog.boundingBox())!;
    const viewport = page.viewportSize()!;

    // Centred: the gap on each side is the same, within a pixel.
    const startGap = box.x;
    const endGap = viewport.width - (box.x + box.width);
    expect(
      Math.abs(startGap - endGap),
      `dialog is off-centre: ${Math.round(startGap)}px start vs ${Math.round(endGap)}px end`,
    ).toBeLessThanOrEqual(1);

    // Fully on screen, with a real margin on both sides.
    expect(startGap).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);

    // Opening a dialog must not give the page a horizontal scrollbar.
    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    // The primary CTA is reachable without scrolling sideways.
    const cta = dialog.getByRole('button', { name: /Send|Book|Request/i }).last();
    const ctaBox = await cta.boundingBox();
    if (ctaBox) {
      expect(ctaBox.x).toBeGreaterThanOrEqual(0);
      expect(ctaBox.x + ctaBox.width).toBeLessThanOrEqual(viewport.width + 1);
    }
  });

  test('states that the consultant receives the booking — no team-review copy', async ({ page }) => {
    await page.goto('/en/dashboard/entrepreneur/consultations');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Book', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const body = await page.locator('body').innerText();
    for (const phrase of RETIRED_COPY) {
      expect(body, `retired admin-review copy is still rendered: "${phrase}"`).not.toContain(phrase);
    }

    // And it says the true thing instead: paid now, confirmed instantly.
    expect(body.toLowerCase()).toContain('no waiting for approval');
  });
});

/**
 * A brand-new member in their OWN browser context: verified, signed in, and
 * holding an empty wallet. `page.request` shares the context cookie jar, so
 * the session the signup sets is the session the page renders with.
 */
async function freshMemberPage(browser: Browser): Promise<Page> {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const ip = `10.${1 + Math.floor(Math.random() * 253)}.${1 + Math.floor(Math.random() * 253)}.7`;
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();

  const signup = await page.request.post('/api/auth/signup', {
    headers: { 'x-forwarded-for': ip },
    data: {
      role: 'ENTREPRENEUR',
      fullName: `QA Mobile ${uniq}`,
      email: `qa.mobile.${uniq}@metwork.test`,
      phone: `+2136${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      password: 'QaMember2026!',
      confirmPassword: 'QaMember2026!',
      city: 'Alger',
      acceptTerms: true,
      acceptPrivacy: true,
    },
  });
  expect(signup.status(), `signup → ${signup.status()} ${await signup.text()}`).toBe(201);
  const pendingId = (await signup.json()).userId as string;

  const verify = await page.request.post('/api/auth/verify-otp', {
    headers: { 'x-forwarded-for': ip },
    data: { userId: pendingId, code: getSignupOtpByPendingId(pendingId) },
  });
  expect(verify.status(), `verify-otp → ${verify.status()} ${await verify.text()}`).toBe(200);

  return page;
}

test.describe('Upgrading with an empty wallet', () => {
  test('offers a top-up route, not the generic "Purchase failed" banner', async ({ browser }) => {
    const page = await freshMemberPage(browser);

    await page.goto('/en/dashboard/entrepreneur/membership');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Upgrade to Builder/i }).first().click();
    await page.getByRole('button', { name: /^Pay /i }).first().click();

    // The actionable outcome: how much is missing, and a way to fix it.
    await expect(page.getByText('Not enough in your wallet yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Top up wallet' })).toBeVisible();
    await expect(page.getByText(/you need .* more/i)).toBeVisible();

    // The red banner is reserved for genuinely unexpected failures.
    await expect(page.getByText('Purchase failed. Please try again.')).toHaveCount(0);

    // And the link actually lands on the wallet page.
    await page.getByRole('link', { name: 'Top up wallet' }).click();
    await page.waitForURL(/\/dashboard\/entrepreneur\/wallet/);

    await page.context().close();
  });
});
