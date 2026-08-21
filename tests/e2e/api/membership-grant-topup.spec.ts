/**
 * Membership grant / revoke / under-funded-purchase e2e.
 *
 * WHY THIS SUITE EXISTS
 * Three reported symptoms, three different root causes, all in the same money
 * path, so they are asserted together here:
 *
 *  1. GRANT PERSISTS AND IS VISIBLE. An admin "Assign plan" must be readable by
 *     the member on their very next request — not on the member's cached copy
 *     of the session.
 *  2. REVOKE ACTUALLY REVOKES. `getEffectiveMembershipCode` falls back to
 *     `membershipTier`, and `resolveMemberBenefits` falls back to the
 *     `membership*DiscountRate` mirror. The revoke handler used to clear only
 *     `membershipCode`, so a "revoked" member stayed BUILDER and kept being
 *     charged the discounted price. That is the regression this file guards.
 *  3. AN UNDER-FUNDED WALLET IS NOT A CRASH. The purchase route must answer
 *     422 INSUFFICIENT_FUNDS with balance / required / shortfall so the UI can
 *     offer a top-up instead of a generic "Purchase failed" banner — and a
 *     retry with the same clientReference must never debit twice.
 *
 * DESIGN
 *  • SERIAL and state-sharing (one dev server, one JSON doc) — run with
 *    `--workers=1`. Retries are disabled in the project config so a flake can
 *    never re-run a side-effectful purchase.
 *  • Tests sign up their OWN member wherever they can, so seeded fixtures other
 *    suites rely on are never mutated. Signups carry a unique X-Forwarded-For to
 *    dodge the per-IP limit. The one exception is the page-render test, which
 *    needs a saved session — it borrows the seeded explorer and puts it back.
 *
 * Run: npx playwright test --project=entrepreneur-fixes --workers=1
 */
import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { BASE, SEED, roleContext, topUp, readLocalDb, xff, clientRef } from './_helpers';
import { MENTOR_ID } from './_consult-helpers';
import { getSignupOtpByPendingId } from './_otp';

test.describe.configure({ mode: 'serial' });

/** Shipped Builder terms — mirrors DEFAULT_PLAN_BENEFITS in src/lib/membership-benefits.ts. */
const BUILDER_SEMESTERLY = 9_000;   // 1 500 × 6
const BUILDER_CONSULT_RATE = 0.10;
const BUILDER_SPACE_RATE = 0.15;

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

/** Sign up + verify a brand-new ENTREPRENEUR. The verify response sets the session cookie. */
async function newMember(): Promise<Member> {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const email = `qa.grant.${uniq()}@metwork.test`;

  const signup = await ctx.post('/api/auth/signup', {
    headers: xff(),
    data: {
      role: 'ENTREPRENEUR',
      fullName: `QA Grant ${uniq()}`,
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

/** What the member's own session reports — the exact source the dashboard reads. */
async function sessionOf(member: Member): Promise<Record<string, unknown>> {
  const res = await member.ctx.get('/api/auth/me');
  expect(res.status(), `auth/me → ${res.status()}`).toBe(200);
  return res.json();
}

/** Consultation quote for the member — the tier discount as actually applied. */
async function quote(ctx: APIRequestContext, durationMinutes = 60) {
  const qs = new URLSearchParams({ mentorId: MENTOR_ID, durationMinutes: String(durationMinutes) });
  const res = await ctx.get(`/api/consultations/quote?${qs.toString()}`);
  expect(res.status(), `quote → ${res.status()} ${await res.text()}`).toBe(200);
  return res.json() as Promise<{
    amountDzd: number;
    basePrice: number;
    tierDiscountAmount: number;
    appliedSource: 'none' | 'tier' | 'promo';
  }>;
}

/** The member's record straight from the authoritative document. */
function memberRecord(userId: string) {
  const db = readLocalDb() as unknown as {
    users: Array<Record<string, unknown> & { id: string }>;
  };
  const u = db.users.find((x) => x.id === userId);
  expect(u, `user ${userId} must exist in the document`).toBeTruthy();
  return u!;
}

function walletBalance(userId: string): number {
  const db = readLocalDb() as unknown as {
    wallets: Array<{ userId: string; balance: number }>;
  };
  return db.wallets.find((w) => w.userId === userId)?.balance ?? 0;
}

/** Grant a plan through the real admin endpoint the Assign-plan dialog calls. */
async function assignPlan(
  admin: APIRequestContext,
  userId: string,
  plan: 'FREE' | 'ENTREPRENEUR' | 'STARTUP',
): Promise<{ id: string }> {
  const res = await admin.post('/api/admin/memberships', {
    data: { userId, plan, expiresAt: null },
  });
  expect(res.status(), `assign ${plan} → ${res.status()} ${await res.text()}`).toBe(201);
  return (await res.json()).membership;
}

/* ─────────────────────────── Tests ─────────────────────────── */

test.describe('Admin grant → member sees the plan', () => {
  // The seeded explorer is a SHARED fixture (the `entrepreneur-explorer`
  // project asserts against it). Whatever this suite grants it, put back.
  test.afterAll(async () => {
    const admin = await roleContext('admin');
    await admin.post('/api/admin/memberships', {
      data: { userId: SEED.explorerId, plan: 'FREE', expiresAt: null },
    });
    await admin.dispose();
  });

  test('assigning Builder is visible to the member and applies the tier discount', async () => {
    const admin = await roleContext('admin');
    const member = await newMember();

    // Baseline: a fresh member is Explorer and pays list price.
    const before = await sessionOf(member);
    expect(before.membershipCode, 'fresh signup starts with no plan').toBeFalsy();
    const q0 = await quote(member.ctx);
    expect(q0.appliedSource, 'Explorer gets no automatic discount').toBe('none');
    expect(q0.amountDzd).toBe(q0.basePrice);

    await assignPlan(admin, member.userId, 'ENTREPRENEUR');

    // 1. Persisted on the user record, both halves of the pair.
    const rec = memberRecord(member.userId);
    expect(rec.membershipCode, 'code written').toBe('ENTREPRENEUR');
    expect(rec.membershipTier, 'tier written').toBe('BUILDER');
    expect(rec.membershipSpaceDiscountRate).toBe(BUILDER_SPACE_RATE);
    expect(rec.membershipConsultationDiscountRate).toBe(BUILDER_CONSULT_RATE);

    // 2. Visible on the member's very next request — no stale session copy.
    const after = await sessionOf(member);
    expect(after.membershipCode, 'the member reads Builder, not Explorer').toBe('ENTREPRENEUR');
    expect(after.membershipTier).toBe('BUILDER');

    // 3. And the grant actually buys something: the tier discount is applied.
    const q1 = await quote(member.ctx);
    expect(q1.appliedSource, 'Builder consultation discount is applied').toBe('tier');
    expect(q1.tierDiscountAmount).toBe(Math.floor(q1.basePrice * BUILDER_CONSULT_RATE));
    expect(q1.amountDzd).toBe(q1.basePrice - q1.tierDiscountAmount);

    await admin.dispose();
    await member.ctx.dispose();
  });

  /**
   * Run against the SEEDED explorer rather than a fresh signup, for two
   * reasons: it has a saved session so the page can be fetched as the member
   * would see it, and its id (`qa-explorer-id`) is not a UUID — which the
   * assign endpoint used to reject outright with a bare "Invalid input", the
   * failure mode that reads as "the grant silently did nothing". Restored to
   * FREE in `afterAll` so the shared fixture is left as it was found.
   */
  test('the membership page renders Builder, not Explorer', async () => {
    const admin = await roleContext('admin');
    const explorer = await roleContext('explorer');

    // Only the current-plan card renders the tier at this size; the three tier
    // cards below it name every plan, so anchor on the card's exact markup.
    const currentPlan = (html: string): string | null =>
      html.match(/class="mt-1 text-xl font-semibold">([^<]+)</)?.[1] ?? null;

    const before = await explorer.get('/en/dashboard/entrepreneur/membership');
    expect(before.status()).toBe(200);
    expect(currentPlan(await before.text()), 'starts on the free tier').toBe('Explorer');

    await assignPlan(admin, SEED.explorerId, 'ENTREPRENEUR');

    const after = await explorer.get('/en/dashboard/entrepreneur/membership');
    expect(after.status()).toBe(200);
    expect(currentPlan(await after.text()), 'the grant is visible to the member').toBe('Builder');

    await admin.dispose();
    await explorer.dispose();
  });

  test('revoking clears the whole plan footprint, not just the code', async () => {
    const admin = await roleContext('admin');
    const member = await newMember();
    const membership = await assignPlan(admin, member.userId, 'ENTREPRENEUR');

    // Sanity: the grant landed.
    expect((await quote(member.ctx)).appliedSource).toBe('tier');

    const del = await admin.delete(`/api/admin/memberships/${membership.id}`);
    expect(del.status(), `revoke → ${del.status()} ${await del.text()}`).toBe(200);

    const rec = memberRecord(member.userId);
    expect(rec.membershipCode, 'code cleared').toBeNull();
    expect(rec.membershipExpiresAt, 'expiry cleared').toBeNull();
    // The three fallbacks that used to keep a revoked member on Builder:
    expect(rec.membershipTier, 'tier must drop to EXPLORER').toBe('EXPLORER');
    expect(rec.membershipSpaceDiscountRate, 'space mirror cleared').toBeUndefined();
    expect(rec.membershipConsultationDiscountRate, 'consultation mirror cleared').toBeUndefined();
    expect(rec.networkCreditsMax, 'pass allowance cleared').toBe(0);

    // And the money consequence: full price again.
    const q = await quote(member.ctx);
    expect(q.appliedSource, 'a revoked member gets no discount').toBe('none');
    expect(q.amountDzd).toBe(q.basePrice);

    await admin.dispose();
    await member.ctx.dispose();
  });
});

test.describe('Under-funded wallet purchase', () => {
  test('answers 422 INSUFFICIENT_FUNDS with the shortfall, then succeeds after top-up', async () => {
    const member = await newMember();

    // ── Attempt 1: empty wallet. ──────────────────────────────────────────
    expect(walletBalance(member.userId), 'fresh member starts empty').toBe(0);
    const ref = clientRef('qa-upgrade');

    const poor = await member.ctx.post('/api/memberships/purchase', {
      data: { plan: 'ENTREPRENEUR', billingPeriod: 'semesterly', clientReference: ref },
    });
    expect(poor.status(), 'an under-funded wallet is a 422, not a 500').toBe(422);
    const err = (await poor.json()).error as {
      code: string;
      details: { balance: number; required: number; shortfall: number };
    };
    expect(err.code, 'a specific code the UI can branch on').toBe('INSUFFICIENT_FUNDS');
    expect(err.details.required).toBe(BUILDER_SEMESTERLY);
    expect(err.details.balance).toBe(0);
    expect(err.details.shortfall, 'the exact amount to top up').toBe(BUILDER_SEMESTERLY);

    // Nothing was charged and no plan was granted by the failed attempt.
    expect(walletBalance(member.userId)).toBe(0);
    expect((await sessionOf(member)).membershipCode).toBeFalsy();

    // ── Attempt 2: funded. ────────────────────────────────────────────────
    await topUp(member.ctx, BUILDER_SEMESTERLY + 1_000);
    const funded = walletBalance(member.userId);
    expect(funded).toBe(BUILDER_SEMESTERLY + 1_000);

    const ok = await member.ctx.post('/api/memberships/purchase', {
      data: { plan: 'ENTREPRENEUR', billingPeriod: 'semesterly', clientReference: ref },
    });
    expect(ok.status(), `purchase → ${ok.status()} ${await ok.text()}`).toBe(201);
    const body = await ok.json();
    expect(body.plan).toBe('ENTREPRENEUR');
    expect(body.amountCharged).toBe(BUILDER_SEMESTERLY);

    expect(walletBalance(member.userId), 'debited exactly the plan price').toBe(
      funded - BUILDER_SEMESTERLY,
    );
    expect((await sessionOf(member)).membershipCode).toBe('ENTREPRENEUR');

    // ── Attempt 3: resubmit the SAME reference — replay, never a 2nd debit. ─
    const replay = await member.ctx.post('/api/memberships/purchase', {
      data: { plan: 'ENTREPRENEUR', billingPeriod: 'semesterly', clientReference: ref },
    });
    expect(replay.status()).toBe(201);
    expect(walletBalance(member.userId), 'no double-charge on resubmit').toBe(
      funded - BUILDER_SEMESTERLY,
    );

    await member.ctx.dispose();
  });
});
