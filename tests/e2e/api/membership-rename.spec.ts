/**
 * Entrepreneur/Startup rename, price consistency, and Network Pass gating.
 *
 * WHY THIS SUITE EXISTS
 * The bug class being guarded against is *one price, four places*. Membership
 * terms are rendered on the public pricing page, in the dashboard membership
 * widget, and on the admin Pricing & Commissions page — and charged by the
 * purchase API. Those four had drifted before. The consistency tests below
 * read all four for the SAME plan and cycle and require them to be the same
 * number, rather than each asserting a hardcoded literal (four literals in a
 * test file is the same bug, just moved).
 *
 * It also covers the two things the rename touched that nothing else asserts:
 * the plan NAMES in all three locales, and the Network Pass gate — which has to
 * hold at the API, not merely in the UI that hides the button.
 *
 * DESIGN
 *  • SERIAL and state-sharing (one dev server, one JSON doc) — run with
 *    `--workers=1`. Retries disabled in the project config so a flake can never
 *    re-run a side-effectful purchase.
 *  • Money tests sign up their OWN member so the seeded accounts stay clean.
 *  • The `page` fixture carries no session, so dashboard tests attach the saved
 *    role cookies to the browser context explicitly.
 *
 * Run: npx playwright test --project=membership-rename --workers=1
 */
import { test, expect, request as pwRequest, type APIRequestContext, type Page, type BrowserContext } from '@playwright/test';
import * as fs from 'node:fs';
import { BASE, roleContext, topUp, xff } from './_helpers';
import { authStatePath } from '../global-setup';
import { getSignupOtpByPendingId } from './_otp';

test.describe.configure({ mode: 'serial' });

/* ─────────────────────────── Expected terms ─────────────────────────── */

/**
 * The ONE place this file states the target numbers. Every consistency test
 * compares surfaces against each other; only the tests that verify the value
 * itself is right compare against these.
 */
const ENTREPRENEUR = {
  code: 'ENTREPRENEUR' as const,
  monthly: 1_500,
  semesterly: 9_000,
  annual: 12_600,
  consultationRate: 0.10,
  spaceRate: 0.15,
};

const STARTUP = {
  code: 'STARTUP' as const,
  monthly: 3_500,
  semesterly: 21_000,   // 3 500 × 6
  annual: 29_400,       // round(3 500 × 12 × 0.7)
  consultationRate: 0.20,
  spaceRate: 0.15,
};

/** Plan names as a member should see them, per locale. */
const PLAN_NAMES = {
  en: { entrepreneur: 'Entrepreneur', startup: 'Startup' },
  fr: { entrepreneur: 'Entrepreneur', startup: 'Startup' },
  ar: { entrepreneur: 'رائد أعمال',   startup: 'شركة ناشئة' },
} as const;

/** Names the rename retired. None of these may appear on a plan surface. */
const RETIRED_NAMES = ['Builder', 'Founder', 'Bâtisseur', 'Fondateur', 'باني', 'مؤسِّس'];

/* ─────────────────────────── Helpers ─────────────────────────── */

function uniq(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function freshPhone(): string {
  return `+2136${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
}

interface Member {
  ctx: APIRequestContext;
  userId: string;
  email: string;
  password: string;
}

/** Sign up + OTP-verify a brand-new ENTREPRENEUR; returns an authed context. */
async function newMember(): Promise<Member> {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const email = `qa.rename.${uniq()}@metwork.test`;
  const password = 'QaMember2026!';

  const signup = await ctx.post('/api/auth/signup', {
    headers: xff(),
    data: {
      role: 'ENTREPRENEUR',
      fullName: `QA Rename ${uniq()}`,
      email,
      phone: freshPhone(),
      password,
      confirmPassword: password,
      city: 'Alger',
      acceptTerms: true,
      acceptPrivacy: true,
    },
  });
  expect(signup.status(), `signup → ${signup.status()} ${await signup.text()}`).toBe(201);
  const pendingId = (await signup.json()).userId as string;

  const verify = await ctx.post('/api/auth/verify-otp', {
    headers: xff(),
    data: { userId: pendingId, code: getSignupOtpByPendingId(pendingId) },
  });
  expect(verify.status(), `verify-otp → ${verify.status()} ${await verify.text()}`).toBe(200);

  return { ctx, userId: (await verify.json()).user.id as string, email, password };
}

async function purchase(
  member: Member,
  plan: 'ENTREPRENEUR' | 'STARTUP',
  billingPeriod: 'semesterly' | 'yearly',
): Promise<{ amountCharged: number }> {
  const res = await member.ctx.post('/api/memberships/purchase', {
    data: { plan, billingPeriod },
  });
  expect(res.status(), `purchase ${plan}/${billingPeriod} → ${res.status()} ${await res.text()}`).toBe(201);
  return res.json();
}

async function setPlan(
  admin: APIRequestContext,
  planCode: string,
  body: Record<string, number | boolean>,
) {
  const res = await admin.patch(`/api/admin/membership-plans/${planCode}`, { data: body });
  expect(res.status(), `setPlan ${planCode} → ${res.status()} ${await res.text()}`).toBe(200);
  return res.json();
}

/** Attach a saved role's cookies to a browser context, so `page` is authed. */
async function signInBrowser(context: BrowserContext, role: string): Promise<void> {
  const state = JSON.parse(fs.readFileSync(authStatePath(role), 'utf8')) as {
    cookies: Array<Record<string, unknown>>;
  };
  await context.addCookies(state.cookies as never);
}

/**
 * Every DZD integer on the page, with locale separators stripped.
 *
 * Currency is rendered per locale (`1,500` / `1 500` / `1.500`), so an
 * exact-string assertion would only ever prove one locale. Extracting the
 * numbers lets the same assertion run in all three.
 */
function amountsIn(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/(\d[\d\s.,  ]*)\s*(?:DZD|د\.ج)/g)) {
    const n = Number(m[1]!.replace(/[\s.,  ]/g, ''));
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

async function pageAmounts(page: Page, url: string): Promise<Set<number>> {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  return amountsIn(await page.locator('body').innerText());
}

/**
 * The plan-card TITLES on the current page, upper-cased.
 *
 * Scoped to the card headings rather than the whole page, for two reasons the
 * page text cannot satisfy:
 *   • the titles are `text-transform: uppercase`, so `innerText` returns
 *     "ENTREPRENEUR" and a substring match on "Entrepreneur" would never fire;
 *   • marketing prose says "founders" all over these pages ("For founders &
 *     startups", "500+ founders"), so a page-wide search for the retired name
 *     "Founder" is a guaranteed false positive.
 * A retired plan name would show up as a card title, which is exactly what this
 * reads.
 */
async function planCardTitles(page: Page): Promise<string[]> {
  const titles = await page.locator('h3').allInnerTexts();
  return titles.map((t) => t.trim().toUpperCase()).filter(Boolean);
}

/** Assert the plan cards are named correctly for `locale`, with nothing retired. */
async function expectPlanNames(page: Page, locale: keyof typeof PLAN_NAMES, where: string) {
  const titles = await planCardTitles(page);

  for (const expected of Object.values(PLAN_NAMES[locale])) {
    expect(titles, `${where} (${locale}): no plan card titled "${expected}"`)
      .toContain(expected.toUpperCase());
  }
  for (const retired of RETIRED_NAMES) {
    expect(titles, `${where} (${locale}): retired plan name "${retired}" still on a card`)
      .not.toContain(retired.toUpperCase());
  }
}

/* ─────────────────────────── Suite ─────────────────────────── */

test.describe('Rename, price consistency, and Network Pass gating', () => {
  let admin: APIRequestContext;
  const openContexts: APIRequestContext[] = [];

  test.beforeAll(async () => {
    admin = await roleContext('admin');
    // A GET on the admin Commissions PAGE is what runs
    // `ensureMembershipPlanConfigs()` in normal use — it seeds any missing plan
    // code, backfills legacy snapshots, AND applies the one-time Startup
    // repricing migration. A PATCH is NOT equivalent: the PATCH route seeds a
    // plan code only when its record is entirely ABSENT, and never touches the
    // repricing migration at all, so a STARTUP record already sitting at the
    // pre-repricing 7 900 price is a permanent no-op for it. This suite must
    // trigger the real page path, not assume the PATCH covers it.
    const seedVisit = await admin.get('/en/dashboard/admin/commissions');
    expect(seedVisit.ok(), `admin Commissions page → ${seedVisit.status()}`).toBeTruthy();

    // No-op PATCHes as a secondary smoke check that the endpoint itself works.
    await setPlan(admin, 'ENTREPRENEUR', { isActive: true });
    await setPlan(admin, 'STARTUP', { isActive: true });
  });

  test.afterAll(async () => {
    await setPlan(admin, 'ENTREPRENEUR', {
      monthlyPrice: ENTREPRENEUR.monthly,
      annualDiscountPercent: 30,
      consultationDiscountRate: ENTREPRENEUR.consultationRate,
      spaceDiscountRate: ENTREPRENEUR.spaceRate,
      recommended: true,
    });
    await setPlan(admin, 'STARTUP', {
      monthlyPrice: STARTUP.monthly,
      annualDiscountPercent: 30,
      consultationDiscountRate: STARTUP.consultationRate,
      spaceDiscountRate: STARTUP.spaceRate,
    });
    await admin.dispose();
    for (const c of openContexts) await c.dispose();
  });

  /* ── 1. THE price-consistency regression ──────────────────────────────── */
  //
  // The specific bug this suite exists for. Four surfaces, one number each,
  // compared to EACH OTHER rather than to four separate literals.

  for (const plan of [STARTUP, ENTREPRENEUR]) {
    const label = plan.code === 'STARTUP' ? 'Startup' : 'Entrepreneur';

    test(`${label}: pricing page, dashboard widget, admin page and checkout all show the same price`, async ({ page, context }) => {
      // ── Surface 1: public pricing page (semesterly is the default cycle) ──
      const publicSemesterly = await pageAmounts(page, '/en/pricing');
      expect(publicSemesterly, `${label} semesterly on /pricing`).toContain(plan.semesterly);

      // Annual cycle, same page.
      await page.getByRole('button', { name: /Yearly/ }).click();
      await expect(page.locator('body')).toContainText('billed yearly');
      const publicAnnual = amountsIn(await page.locator('body').innerText());
      expect(publicAnnual, `${label} annual on /pricing`).toContain(plan.annual);

      // ── Surface 2: admin Pricing & Commissions ──
      await signInBrowser(context, 'admin');
      const adminAmounts = await pageAmounts(page, '/en/dashboard/admin/commissions');
      expect(adminAmounts, `${label} semesterly on the admin page`).toContain(plan.semesterly);
      expect(adminAmounts, `${label} annual on the admin page`).toContain(plan.annual);

      // ── Surface 3: entrepreneur dashboard membership widget ──
      // Seeded `explorer` is on FREE, so every paid card renders an Upgrade
      // dialog carrying the price a purchase would charge.
      await context.clearCookies();
      await signInBrowser(context, 'explorer');
      await page.goto('/en/dashboard/entrepreneur/membership');
      await page.waitForLoadState('networkidle');

      const dashboardAmounts = amountsIn(await page.locator('body').innerText());
      expect(dashboardAmounts, `${label} monthly on the dashboard`).toContain(plan.monthly);
      expect(dashboardAmounts, `${label} annual on the dashboard`).toContain(plan.annual);

      // Open THIS plan's upgrade panel — targeted by its exact button name, so
      // a card-ordering change cannot silently point the assertion at the other
      // plan. The panel is inline (no modal portal), so it replaces the button.
      await page.getByRole('button', { name: `Upgrade to ${label}`, exact: true }).click();

      // The cadence line carries exactly one amount: the total for the cycle —
      // the figure the member is agreeing to pay.
      const semesterlyLine = page.getByText(/billed every 6 months/).first();
      await expect(semesterlyLine).toBeVisible();
      expect(
        amountsIn(await semesterlyLine.innerText()),
        `${label} semesterly in the upgrade panel — the figure the member agrees to`,
      ).toContain(plan.semesterly);

      await page.getByRole('button', { name: 'Yearly', exact: true }).click();
      const annualLine = page.getByText(/billed yearly/).first();
      await expect(annualLine).toBeVisible();
      expect(
        amountsIn(await annualLine.innerText()),
        `${label} annual in the upgrade panel`,
      ).toContain(plan.annual);

      // ── Surface 4: what checkout actually charges ──
      const member = await newMember();
      openContexts.push(member.ctx);
      await topUp(member.ctx, plan.semesterly + plan.annual + 5_000);

      const semesterly = await purchase(member, plan.code, 'semesterly');
      const annual = await purchase(member, plan.code, 'yearly');

      // The point of the test: the charged amounts equal the advertised ones.
      expect(
        semesterly.amountCharged,
        `charged ≠ advertised semesterly for ${label} — this is the double-pricing bug`,
      ).toBe(plan.semesterly);
      expect(
        annual.amountCharged,
        `charged ≠ advertised annual for ${label} — this is the double-pricing bug`,
      ).toBe(plan.annual);
    });
  }

  test('Startup is charged exactly 21 000 semesterly and 29 400 annually', async () => {
    const member = await newMember();
    openContexts.push(member.ctx);
    await topUp(member.ctx, STARTUP.semesterly + STARTUP.annual + 2_000);

    expect((await purchase(member, 'STARTUP', 'semesterly')).amountCharged).toBe(21_000);
    expect((await purchase(member, 'STARTUP', 'yearly')).amountCharged).toBe(29_400);
  });

  /* ── 2. The rename, in every locale ───────────────────────────────────── */

  for (const locale of ['en', 'fr', 'ar'] as const) {
    test(`pricing page shows the current plan names in ${locale}, and none of the retired ones`, async ({ page }) => {
      await page.goto(`/${locale}/pricing`);
      await page.waitForLoadState('networkidle');
      await expectPlanNames(page, locale, 'pricing page');
    });
  }

  test('the dashboard plan-selection UI uses the current names in every locale', async ({ page, context }) => {
    await signInBrowser(context, 'explorer');
    for (const locale of ['en', 'fr', 'ar'] as const) {
      await page.goto(`/${locale}/dashboard/entrepreneur/membership`);
      await page.waitForLoadState('networkidle');
      await expectPlanNames(page, locale, 'dashboard plan cards');
    }
  });

  /* ── 3. Divergent discount rates ──────────────────────────────────────── */

  test('a Startup member gets 20 % off consultations and 15 % off spaces; Entrepreneur keeps 10 % / 15 %', async () => {
    const startupMember = await newMember();
    openContexts.push(startupMember.ctx);
    await topUp(startupMember.ctx, STARTUP.semesterly + 40_000);

    // Baseline while still on FREE.
    const before = await startupMember.ctx.get(
      `/api/consultations/quote?mentorId=qa-mentor-id&durationMinutes=60`,
    );
    expect(before.status()).toBe(200);
    const base = (await before.json()).basePrice as number;
    expect(base, 'seeded mentor must have a positive fee').toBeGreaterThan(0);

    await purchase(startupMember, 'STARTUP', 'semesterly');

    const after = await startupMember.ctx.get(
      `/api/consultations/quote?mentorId=qa-mentor-id&durationMinutes=60`,
    );
    const q = await after.json();
    expect(q.tierDiscountAmount, `Startup: 20 % of ${base}`).toBe(Math.round(base * 0.20));
    expect(q.amountDzd).toBe(base - Math.round(base * 0.20));
    expect(q.appliedSource).toBe('tier');

    // Entrepreneur is unchanged at 10 % — the two plans must NOT share a rate.
    const entMember = await newMember();
    openContexts.push(entMember.ctx);
    await topUp(entMember.ctx, ENTREPRENEUR.semesterly + 40_000);
    await purchase(entMember, 'ENTREPRENEUR', 'semesterly');

    const entQuote = await (
      await entMember.ctx.get(`/api/consultations/quote?mentorId=qa-mentor-id&durationMinutes=60`)
    ).json();
    expect(entQuote.tierDiscountAmount, `Entrepreneur: 10 % of ${base}`).toBe(Math.round(base * 0.10));
    expect(
      entQuote.tierDiscountAmount,
      'the two plans must resolve DIFFERENT consultation rates',
    ).not.toBe(q.tierDiscountAmount);
  });

  /* ── 4. Network Pass is off ───────────────────────────────────────────── */

  test('Network Pass is advertised on no plan, in any locale', async ({ page }) => {
    for (const locale of ['en', 'fr', 'ar'] as const) {
      await page.goto(`/${locale}/pricing`);
      await page.waitForLoadState('networkidle');
      const text = await page.locator('body').innerText();
      expect(text, `${locale}: Network Pass still marketed on the pricing page`)
        .not.toContain('Network Pass');
    }
  });

  test('a direct Network Pass redemption is rejected while the flag is off', async () => {
    // A member who WOULD qualify: Startup plan, full allowance, partner space.
    const member = await newMember();
    openContexts.push(member.ctx);
    await topUp(member.ctx, STARTUP.semesterly + 20_000);
    await purchase(member, 'STARTUP', 'semesterly');

    const res = await member.ctx.post('/api/bookings', {
      data: {
        itemKind: 'SPACE',
        itemId: 'qa-space-id-001',
        unit: 'HOUR',
        startsAt: new Date(Date.now() + 7 * 864e5).toISOString(),
        endsAt: new Date(Date.now() + 7 * 864e5 + 2 * 36e5).toISOString(),
        paymentMethod: 'NETWORK_PASS',
        clientReference: `np-gated-${uniq()}`,
      },
    });

    // Whatever else is wrong with the request, it must NEVER be accepted.
    expect(res.status(), 'a Network Pass booking must not succeed while the feature is off')
      .not.toBe(201);
    expect([400, 403, 422]).toContain(res.status());
  });

  test('the pass QR and check-in endpoints are closed', async () => {
    const member = await newMember();
    openContexts.push(member.ctx);

    const qr = await member.ctx.get('/api/network/pass/qr');
    expect(qr.status(), 'pass QR endpoint').toBe(403);
    expect((await qr.json()).error?.code).toBe('NETWORK_PASS_DISABLED');

    const validate = await admin.post('/api/network/checkin/validate', {
      data: { code: '000000', spaceId: 'qa-space-id-001' },
    });
    expect(validate.status(), 'check-in validate endpoint').toBe(403);
    expect((await validate.json()).error?.code).toBe('NETWORK_PASS_DISABLED');
  });

  /* ── 5. The dashboard placeholder ─────────────────────────────────────── */

  for (const [role, expectedPlan] of [
    ['builder', PLAN_NAMES.en.entrepreneur],
    ['founder', PLAN_NAMES.en.startup],
  ] as const) {
    test(`Network Pass screen shows plan, gold Upgrade and "coming soon" for a ${expectedPlan} member`, async ({ page, context }) => {
      await signInBrowser(context, role);
      await page.goto('/en/dashboard/entrepreneur/network-pass');
      await page.waitForLoadState('networkidle');

      const body = page.locator('body');
      await expect(body).toContainText('Your current plan');
      await expect(body).toContainText(expectedPlan);
      await expect(body).toContainText('Network Pass — coming soon');

      // No functional pass UI leaks through.
      await expect(body).not.toContainText('Refresh QR');
      await expect(body).not.toContainText('Download PDF');

      // The Upgrade CTA links into the plan comparison and is actually gold.
      const cta = page.getByRole('link', { name: /Upgrade your plan/i });
      await expect(cta).toBeVisible();
      await expect(cta).toHaveAttribute('href', /\/dashboard\/entrepreneur\/membership$/);

      const bg = await cta.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg, 'Upgrade CTA must render the gold accent #D4AF37').toBe('rgb(212, 175, 55)');
    });
  }

  /* ── 6. Frozen snapshot, carried over from the prior pass ─────────────── */

  test('an admin Startup price change does not reach an already-active member', async () => {
    const member = await newMember();
    openContexts.push(member.ctx);
    await topUp(member.ctx, STARTUP.semesterly + 60_000);

    const bought = await purchase(member, 'STARTUP', 'semesterly');
    expect(bought.amountCharged).toBe(STARTUP.semesterly);

    const quoteBefore = await (
      await member.ctx.get('/api/consultations/quote?mentorId=qa-mentor-id&durationMinutes=60')
    ).json();
    const frozenDiscount = quoteBefore.tierDiscountAmount as number;
    expect(frozenDiscount).toBe(Math.round((quoteBefore.basePrice as number) * 0.20));

    // Admin doubles the price and guts the discount.
    await setPlan(admin, 'STARTUP', { monthlyPrice: 7_000, consultationDiscountRate: 0.01 });

    try {
      const quoteAfter = await (
        await member.ctx.get('/api/consultations/quote?mentorId=qa-mentor-id&durationMinutes=60')
      ).json();
      expect(
        quoteAfter.tierDiscountAmount,
        'an active member is still quoted the rate they bought',
      ).toBe(frozenDiscount);

      // And a NEW buyer does pay the new price — proving the change took effect
      // and the member above was protected by the snapshot, not by a no-op.
      const newBuyer = await newMember();
      openContexts.push(newBuyer.ctx);
      await topUp(newBuyer.ctx, 7_000 * 6 + 2_000);
      expect((await purchase(newBuyer, 'STARTUP', 'semesterly')).amountCharged).toBe(7_000 * 6);
    } finally {
      await setPlan(admin, 'STARTUP', {
        monthlyPrice: STARTUP.monthly,
        consultationDiscountRate: STARTUP.consultationRate,
      });
    }
  });

  /* ── 7. FREE / Explorer is untouched ──────────────────────────────────── */

  test('a FREE account still gets no discount and no membership record', async () => {
    const member = await newMember();
    openContexts.push(member.ctx);

    const q = await (
      await member.ctx.get('/api/consultations/quote?mentorId=qa-mentor-id&durationMinutes=60')
    ).json();
    expect(q.tierDiscountAmount).toBe(0);
    expect(q.amountDzd).toBe(q.basePrice);
    expect(q.appliedSource).toBe('none');
  });
});
