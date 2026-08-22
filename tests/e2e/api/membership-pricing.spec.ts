/**
 * Membership repricing e2e — pricing config, purchase amounts, frozen
 * snapshots, discount application, pass allowances and promo stacking.
 *
 * WHY THIS SUITE EXISTS
 * Membership terms became admin-editable in this release. The invariant that
 * matters is NOT "the admin can change a price" — it is that changing one can
 * never reach backwards into a billing period somebody already paid for. The
 * frozen-snapshot test below is the point of the whole file.
 *
 * DESIGN
 *  • SERIAL and state-sharing (one dev server, one JSON doc) — run with
 *    `--workers=1`. Retries are disabled in the project config so a flake can
 *    never re-run a side-effectful purchase.
 *  • Every money test uses a FRESHLY SIGNED-UP member rather than a seeded
 *    account, so a purchase can never corrupt the fixtures other suites rely
 *    on. Signups carry a unique X-Forwarded-For to dodge the per-IP limit.
 *  • `afterAll` restores the plan config to its shipped defaults, so the shared
 *    document is left exactly as it was found.
 *
 * Run: npx playwright test --project=membership-pricing --workers=1
 */
import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import {
  BASE,
  roleContext,
  topUp,
  createSpace,
  bookSpace,
  futureWeekdayUtc,
  utcWindow,
  readLocalDb,
  xff,
  clientRef,
} from './_helpers';
import { ensureConsultationPromo, MENTOR_ID } from './_consult-helpers';
import { getSignupOtpByPendingId } from './_otp';

test.describe.configure({ mode: 'serial' });

/* ─────────────────────────── Expected terms ─────────────────────────── */

/**
 * Shipped defaults — mirrors DEFAULT_PLAN_BENEFITS in src/lib/membership-benefits.ts.
 *
 * The plans are named Entrepreneur and Startup; the constants keep the store
 * codes they are keyed by. The two DIVERGE on consultations (10 % vs 20 %) and
 * agree on spaces (15 %) — see the note at DEFAULT_PLAN_BENEFITS for why.
 */
const BUILDER = {
  code: 'ENTREPRENEUR',
  monthly: 1_500,
  semesterly: 9_000,   // 1 500 × 6
  annual: 12_600,      // round(1 500 × 12 × 0.7)
  consultationRate: 0.10,
  spaceRate: 0.15,
  passes: 0,
} as const;

const FOUNDER = {
  code: 'STARTUP',
  monthly: 3_500,
  semesterly: 21_000,  // 3 500 × 6
  annual: 29_400,      // round(3 500 × 12 × 0.7)
  consultationRate: 0.20,
  spaceRate: 0.15,
  passes: 5,
} as const;

/**
 * The seeded mentor's hourly fee is NOT hardcoded here: other suites in this
 * repo reconfigure the one shared `qa-mentor` fixture. Every consultation
 * assertion below derives its expectations from the base price the quote
 * endpoint itself reports, so this suite is order-independent.
 */
async function baseConsultationPrice(ctx: APIRequestContext): Promise<number> {
  const q = await quote(ctx, 60);
  expect(q.basePrice, 'seeded mentor must have a positive fee').toBeGreaterThan(0);
  return q.basePrice;
}

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
}

/**
 * Sign up + OTP-verify a brand-new ENTREPRENEUR and return an authenticated
 * context. ENTREPRENEUR is never approval-gated, and verify-otp sets the
 * session cookie, so no login call (and no login rate-limit pressure).
 */
async function newMember(): Promise<Member> {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const email = `qa.member.${uniq()}@metwork.test`;

  const signup = await ctx.post('/api/auth/signup', {
    headers: xff(),
    data: {
      role: 'ENTREPRENEUR',
      fullName: `QA Member ${uniq()}`,
      email,
      phone: freshPhone(),
      password: 'QaMember2026!',
      confirmPassword: 'QaMember2026!',
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
  const userId = (await verify.json()).user.id as string;

  return { ctx, userId, email };
}

/** Purchase a plan as `member`. Returns the parsed 201 body. */
async function purchase(
  member: Member,
  plan: 'ENTREPRENEUR' | 'STARTUP',
  billingPeriod: 'semesterly' | 'yearly',
  extra: { promoCode?: string; clientReference?: string } = {},
): Promise<{ plan: string; expiresAt: string; amountCharged: number; discountApplied: number }> {
  const res = await member.ctx.post('/api/memberships/purchase', {
    data: { plan, billingPeriod, ...extra },
  });
  expect(res.status(), `purchase ${plan}/${billingPeriod} → ${res.status()} ${await res.text()}`).toBe(201);
  return res.json();
}

/** PATCH one plan's config as admin. */
async function setPlan(
  admin: APIRequestContext,
  planCode: string,
  body: Record<string, number | boolean>,
) {
  const res = await admin.patch(`/api/admin/membership-plans/${planCode}`, { data: body });
  expect(res.status(), `setPlan ${planCode} → ${res.status()} ${await res.text()}`).toBe(200);
  return res.json();
}

/** Consultation quote — side-effect-free view of what the member would be charged. */
async function quote(
  ctx: APIRequestContext,
  durationMinutes: number,
  promoCode?: string,
): Promise<{
  amountDzd: number;
  basePrice: number;
  tierDiscountAmount: number;
  promoDiscountAmount: number;
  appliedSource: 'none' | 'tier' | 'promo';
}> {
  const qs = new URLSearchParams({ mentorId: MENTOR_ID, durationMinutes: String(durationMinutes) });
  if (promoCode) qs.set('promoCode', promoCode);
  const res = await ctx.get(`/api/consultations/quote?${qs.toString()}`);
  expect(res.status(), `quote → ${res.status()} ${await res.text()}`).toBe(200);
  return res.json();
}

/** The member's own record straight from the authoritative document. */
function memberRecord(userId: string) {
  const db = readLocalDb() as unknown as {
    users: Array<Record<string, unknown>>;
    userMemberships: Array<Record<string, unknown>>;
  };
  const user = db.users.find((u) => u.id === userId);
  const memberships = (db.userMemberships ?? []).filter((m) => m.userId === userId);
  const active = memberships.find((m) => m.status === 'ACTIVE');
  return { user, memberships, active };
}

/* ─────────────────────────── Suite ─────────────────────────── */

test.describe('Membership pricing — config, purchase, frozen snapshot', () => {
  let admin: APIRequestContext;
  let inc: APIRequestContext;
  const openContexts: APIRequestContext[] = [];

  test.beforeAll(async () => {
    admin = await roleContext('admin');
    inc = await roleContext('incubator');
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
    // Restore the shipped defaults so the shared document is left as found.
    await setPlan(admin, 'ENTREPRENEUR', {
      monthlyPrice: BUILDER.monthly,
      annualDiscountPercent: 30,
      consultationDiscountRate: BUILDER.consultationRate,
      spaceDiscountRate: BUILDER.spaceRate,
      monthlyPassCount: BUILDER.passes,
      recommended: true,
    });
    await setPlan(admin, 'STARTUP', {
      monthlyPrice: FOUNDER.monthly,
      annualDiscountPercent: 30,
      consultationDiscountRate: FOUNDER.consultationRate,
      spaceDiscountRate: FOUNDER.spaceRate,
      monthlyPassCount: FOUNDER.passes,
    });
    await admin.dispose();
    await inc.dispose();
    for (const c of openContexts) await c.dispose();
  });

  // ── 1. Public pricing page ────────────────────────────────────────────────
  test('public pricing page shows the configured terms, the cycle toggle, and Recommended on Entrepreneur only', async ({ page }) => {
    await page.goto('/en/pricing');
    await page.waitForLoadState('networkidle');

    const body = page.locator('body');

    // Semesterly is the default cycle.
    await expect(body).toContainText('1,500 DZD');
    await expect(body).toContainText('9,000 DZD billed every 6 months');
    await expect(body).toContainText('3,500 DZD');
    await expect(body).toContainText('21,000 DZD billed every 6 months');

    // Consultations diverge, spaces agree.
    expect(await page.getByText('10% off mentor consultations').count()).toBe(1);
    expect(await page.getByText('20% off mentor consultations').count()).toBe(1);
    expect(await page.getByText('15% off space bookings').count()).toBe(2);

    // Network Pass is switched off, so it is advertised on no plan at all —
    // regardless of the allowance the Startup plan still carries in config.
    await expect(body).not.toContainText('Network Pass');

    // Exactly one Recommended tag, and it sits on the Entrepreneur card. Resolved by
    // walking up from the badge to its owning card rather than by guessing at a
    // class name, so a styling change cannot silently void this assertion.
    expect(await page.getByText('Recommended', { exact: true }).count()).toBe(1);
    const recommendedPlan = await page.evaluate(() => {
      const badge = Array.from(document.querySelectorAll('*')).find(
        (el) => el.children.length === 0 && el.textContent?.trim() === 'Recommended',
      );
      let node: Element | null = badge ?? null;
      while (node && !node.querySelector('h3')) node = node.parentElement;
      return node?.querySelector('h3')?.textContent?.trim() ?? null;
    });
    expect(recommendedPlan?.toUpperCase(), 'Recommended belongs to Entrepreneur').toBe('ENTREPRENEUR');

    // Annual toggle switches both plans to the discounted lump sum.
    await page.getByRole('button', { name: /Yearly/ }).click();
    await expect(body).toContainText('12,600 DZD billed yearly');
    await expect(body).toContainText('29,400 DZD billed yearly');
  });

  // ── 2. Purchase amounts ───────────────────────────────────────────────────
  test('Entrepreneur charges exactly 9 000 semesterly and 12 600 annually', async () => {
    const member = await newMember();
    openContexts.push(member.ctx);
    await topUp(member.ctx, BUILDER.semesterly + BUILDER.annual + 1_000);

    const semesterly = await purchase(member, 'ENTREPRENEUR', 'semesterly');
    expect(semesterly.amountCharged, 'Entrepreneur semesterly').toBe(BUILDER.semesterly);

    const annual = await purchase(member, 'ENTREPRENEUR', 'yearly');
    expect(annual.amountCharged, 'Entrepreneur annual (-30 %)').toBe(BUILDER.annual);
  });

  test('Startup charges exactly 21 000 semesterly and 29 400 annually', async () => {
    const member = await newMember();
    openContexts.push(member.ctx);
    await topUp(member.ctx, FOUNDER.semesterly + FOUNDER.annual + 1_000);

    const semesterly = await purchase(member, 'STARTUP', 'semesterly');
    expect(semesterly.amountCharged, 'Startup semesterly').toBe(FOUNDER.semesterly);

    const annual = await purchase(member, 'STARTUP', 'yearly');
    expect(annual.amountCharged, 'Startup annual (-30 %)').toBe(FOUNDER.annual);
  });

  test('a repeated purchase with the same clientReference never charges twice', async () => {
    const member = await newMember();
    openContexts.push(member.ctx);
    const funded = await topUp(member.ctx, BUILDER.semesterly + 1_000);
    const ref = clientRef('membership');

    const first = await purchase(member, 'ENTREPRENEUR', 'semesterly', { clientReference: ref });
    expect(first.amountCharged).toBe(BUILDER.semesterly);

    const replay = await purchase(member, 'ENTREPRENEUR', 'semesterly', { clientReference: ref });
    expect(replay.amountCharged, 'replay echoes the original charge').toBe(BUILDER.semesterly);

    const { user, memberships } = memberRecord(member.userId);
    expect(memberships.length, 'replay must not append a second membership').toBe(1);
    void user;

    const db = readLocalDb();
    const wallet = db.wallets.find((w) => w.userId === member.userId);
    expect(wallet?.balance, 'wallet debited exactly once').toBe(funded - BUILDER.semesterly);
  });

  // ── 3. Discounts granted by a purchased plan ──────────────────────────────
  test('an Entrepreneur member gets exactly 10 % off a consultation and 15 % off a space booking', async () => {
    const member = await newMember();
    openContexts.push(member.ctx);
    await topUp(member.ctx, 40_000);

    // Baseline BEFORE buying: FREE tier gets nothing.
    const free = await quote(member.ctx, 60);
    const base = free.basePrice;
    expect(base).toBeGreaterThan(0);
    expect(free.tierDiscountAmount, 'FREE tier gets no discount').toBe(0);
    expect(free.amountDzd).toBe(base);
    expect(free.appliedSource).toBe('none');

    await purchase(member, 'ENTREPRENEUR', 'semesterly');

    const member10 = await quote(member.ctx, 60);
    const expected10 = Math.round(base * BUILDER.consultationRate);
    expect(member10.tierDiscountAmount, `10 % of ${base}`).toBe(expected10);
    expect(member10.amountDzd).toBe(base - expected10);
    expect(member10.appliedSource).toBe('tier');

    // Space: 15 % off the computed base.
    const space = await createSpace(inc, { category: 'TRAINING_ROOM', pricePerHour: 1_000, pricePerDay: null });
    const day = futureWeekdayUtc(9);
    const { startsAt, endsAt } = utcWindow(day, 10, 12); // 2 h → 2 000 base
    const res = await bookSpace(member.ctx, space.id, 'HOUR', startsAt, endsAt, 'ONLINE');
    expect(res.status(), `book → ${res.status()} ${await res.text()}`).toBe(201);
    const { booking } = await res.json();
    expect(booking.totalAmount, '2 000 base − 15 %').toBe(1_700);
  });

  test('a Startup member gets 5 coworking passes and an Entrepreneur member gets none', async () => {
    const founderMember = await newMember();
    openContexts.push(founderMember.ctx);
    await topUp(founderMember.ctx, FOUNDER.semesterly + 1_000);
    await purchase(founderMember, 'STARTUP', 'semesterly');

    const founderRec = memberRecord(founderMember.userId);
    expect(founderRec.user?.networkCreditsMax, 'Startup allowance').toBe(FOUNDER.passes);
    expect(founderRec.user?.networkCredits, 'Startup starts with a full allowance').toBe(FOUNDER.passes);
    expect(founderRec.active?.monthlyPassCount, 'allowance frozen on the record').toBe(FOUNDER.passes);

    const builderMember = await newMember();
    openContexts.push(builderMember.ctx);
    await topUp(builderMember.ctx, BUILDER.semesterly + 1_000);
    await purchase(builderMember, 'ENTREPRENEUR', 'semesterly');

    const builderRec = memberRecord(builderMember.userId);
    expect(builderRec.user?.networkCreditsMax, 'Entrepreneur grants no passes').toBe(0);
    expect(builderRec.active?.monthlyPassCount).toBe(0);
  });

  // ── 4. THE frozen-snapshot regression ─────────────────────────────────────
  test('an admin price change reaches new purchases only — an active member keeps the terms they bought', async () => {
    // Member A buys at the shipped terms.
    const memberA = await newMember();
    openContexts.push(memberA.ctx);
    // Funded for the purchase AND the post-repricing space booking below.
    await topUp(memberA.ctx, BUILDER.semesterly + 10_000);
    const boughtA = await purchase(memberA, 'ENTREPRENEUR', 'semesterly');
    expect(boughtA.amountCharged).toBe(BUILDER.semesterly);

    const quoteBefore = await quote(memberA.ctx, 60);
    const base = quoteBefore.basePrice;
    const frozenDiscount = Math.round(base * BUILDER.consultationRate); // 10 %
    expect(quoteBefore.tierDiscountAmount).toBe(frozenDiscount);

    // Admin reprices Entrepreneur and slashes its benefits.
    const NEW_MONTHLY = 2_500;
    await setPlan(admin, 'ENTREPRENEUR', {
      monthlyPrice: NEW_MONTHLY,
      consultationDiscountRate: 0.02,
      spaceDiscountRate: 0.03,
      monthlyPassCount: 2,
    });

    // ── The invariant: member A is untouched. ──
    const recA = memberRecord(memberA.userId);
    expect(recA.active?.basePrice, 'frozen price on the record').toBe(BUILDER.semesterly);
    expect(recA.active?.amountCharged, 'frozen charge on the record').toBe(BUILDER.semesterly);
    expect(recA.active?.consultationDiscountRate, 'frozen consultation rate').toBe(BUILDER.consultationRate);
    expect(recA.active?.spaceDiscountRate, 'frozen space rate').toBe(BUILDER.spaceRate);
    expect(recA.active?.monthlyPassCount, 'frozen pass allowance').toBe(BUILDER.passes);

    const quoteAfter = await quote(memberA.ctx, 60);
    expect(
      quoteAfter.tierDiscountAmount,
      'an active member is still quoted the rate they bought, not the new one',
    ).toBe(frozenDiscount);
    expect(quoteAfter.amountDzd).toBe(base - frozenDiscount);

    const spaceA = await createSpace(inc, { category: 'TRAINING_ROOM', pricePerHour: 1_000, pricePerDay: null });
    const dayA = futureWeekdayUtc(11);
    const windowA = utcWindow(dayA, 14, 16); // 2 h → 2 000 base
    const bookA = await bookSpace(memberA.ctx, spaceA.id, 'HOUR', windowA.startsAt, windowA.endsAt, 'ONLINE');
    expect(bookA.status()).toBe(201);
    expect(
      (await bookA.json()).booking.totalAmount,
      'active member still charged at their frozen 15 %',
    ).toBe(1_700);

    // ── And the new price DOES apply to somebody buying now. ──
    const memberB = await newMember();
    openContexts.push(memberB.ctx);
    await topUp(memberB.ctx, NEW_MONTHLY * 6 + 1_000);
    const boughtB = await purchase(memberB, 'ENTREPRENEUR', 'semesterly');
    expect(boughtB.amountCharged, 'new buyer pays the new price').toBe(NEW_MONTHLY * 6);

    const quoteB = await quote(memberB.ctx, 60);
    expect(quoteB.tierDiscountAmount, 'new buyer gets the new 2 % rate').toBe(
      Math.round(quoteB.basePrice * 0.02),
    );

    const recB = memberRecord(memberB.userId);
    expect(recB.user?.networkCreditsMax, 'new buyer gets the new allowance').toBe(2);

    // Restore the shipped Entrepreneur terms before leaving. This suite runs
    // serially, so a test that mutates shared config cleans up after itself
    // rather than leaving the next test to guess at the current price.
    await setPlan(admin, 'ENTREPRENEUR', {
      monthlyPrice: BUILDER.monthly,
      consultationDiscountRate: BUILDER.consultationRate,
      spaceDiscountRate: BUILDER.spaceRate,
      monthlyPassCount: BUILDER.passes,
    });

    // And member A is STILL on their frozen terms after the restore — the
    // snapshot is not merely "the config happened to match".
    const recAfterRestore = memberRecord(memberA.userId);
    expect(recAfterRestore.active?.basePrice).toBe(BUILDER.semesterly);
  });

  // ── 5. Promo vs membership — no stacking ──────────────────────────────────
  test('a promo code and the membership discount never combine — only the larger applies', async () => {
    const member = await newMember();
    openContexts.push(member.ctx);
    await topUp(member.ctx, BUILDER.semesterly + 1_000);
    await purchase(member, 'ENTREPRENEUR', 'semesterly'); // 10 % consultations

    const base = await baseConsultationPrice(member.ctx);
    const tierAmount = Math.round(base * BUILDER.consultationRate); // 10 %
    const smallPromo = await ensureConsultationPromo(admin, 5);
    const bigPromo = await ensureConsultationPromo(admin, 40);
    const bigPromoAmount = Math.round(base * 0.40);

    // Promo smaller than the tier → the tier wins, promo contributes nothing.
    const tierWins = await quote(member.ctx, 60, smallPromo);
    expect(tierWins.appliedSource).toBe('tier');
    expect(tierWins.tierDiscountAmount).toBe(tierAmount);
    expect(tierWins.promoDiscountAmount, 'the losing discount is never also applied').toBe(0);
    expect(tierWins.amountDzd).toBe(base - tierAmount);

    // Promo larger than the tier → the promo wins, tier contributes nothing.
    const promoWins = await quote(member.ctx, 60, bigPromo);
    expect(promoWins.appliedSource).toBe('promo');
    expect(promoWins.promoDiscountAmount).toBe(bigPromoAmount);
    expect(promoWins.tierDiscountAmount, 'the losing discount is never also applied').toBe(0);
    expect(promoWins.amountDzd).toBe(base - bigPromoAmount);

    // Neither case ever sums to the stacked total.
    expect(promoWins.amountDzd, 'discounts must never compound').not.toBe(
      base - bigPromoAmount - tierAmount,
    );
  });

  // ── 6. FREE tier is untouched by any of this ──────────────────────────────
  test('a FREE-tier account gets no discount, no passes, and pays list price', async () => {
    const member = await newMember();
    openContexts.push(member.ctx);
    await topUp(member.ctx, 20_000);

    const q = await quote(member.ctx, 60);
    expect(q.tierDiscountAmount).toBe(0);
    expect(q.amountDzd, 'full mentor fee').toBe(q.basePrice);
    expect(q.appliedSource).toBe('none');

    const space = await createSpace(inc, { category: 'TRAINING_ROOM', pricePerHour: 1_000, pricePerDay: null });
    const day = futureWeekdayUtc(13);
    const { startsAt, endsAt } = utcWindow(day, 9, 11); // 2 h → 2 000 base
    const res = await bookSpace(member.ctx, space.id, 'HOUR', startsAt, endsAt, 'ONLINE');
    expect(res.status()).toBe(201);
    expect((await res.json()).booking.totalAmount, 'no membership discount').toBe(2_000);

    const rec = memberRecord(member.userId);
    expect(rec.user?.networkCreditsMax ?? 0).toBe(0);
    expect(rec.active, 'no membership record for a FREE account').toBeUndefined();
  });
});
