/**
 * API-driven e2e — CONSULTATION promo split (P3, owner-locked SUBSIDIZE model,
 * 2026-06-18). The consultant is ALWAYS paid round(base × 0.7) on the FULL,
 * undiscounted price; the platform absorbs every promo/tier discount, so the
 * platform share = collected − consultantShare and MAY go negative. There is NO
 * cap and NO rejection of an "above-ratio" promo (the locked decision).
 *
 * Uses the EXPLORER member (no membership-tier discount) so the only discount in
 * play is the promo, keeping the arithmetic exact. The base price is read from
 * the live mentor fee (60-min session ⇒ base = fee). Serial; MOCK SYNC payments.
 */
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  roleContext,
  mintConsultantContext,
  setupMentorAvailability,
  nextUniqueSlot,
  instantBook,
  consultantWallet,
  consultantBooking,
  ensureConsultationPromo,
  getMentorFee,
} from './_consult-helpers';

async function dump(res: APIResponse): Promise<string> {
  return `${res.status()} ${await res.text()}`;
}

/** Replicates pricing.ts for a no-tier actor: base, what the user pays, and the
 *  consultant credit (always on the full base under the subsidize model). */
function expectedSplit(fee: number, promoPct: number) {
  const base = fee; // 60-min session
  const promoDiscount = promoPct > 0 ? Math.round((base * promoPct) / 100) : 0;
  const collected = Math.max(0, base - promoDiscount);
  const consultantShare = Math.round(base * 0.7);
  return { base, collected, consultantShare, platformShare: collected - consultantShare };
}

test.describe.serial('Consultation promo split (subsidize, no cap)', () => {
  let admin: APIRequestContext;
  let consultant: APIRequestContext;
  let explorer: APIRequestContext;
  let fee: number;
  const slots = nextUniqueSlot;

  test.beforeAll(async () => {
    admin = await roleContext('admin');
    explorer = await roleContext('explorer'); // no membership-tier consultation discount
    ({ ctx: consultant } = await mintConsultantContext(admin));
    await setupMentorAvailability(consultant, { minNoticeHours: 1, bufferMinutes: 0 });
    fee = await getMentorFee(admin);
  });

  test.afterAll(async () => {
    await admin.dispose();
    await consultant.dispose();
    await explorer.dispose();
  });

  test('12a — 30% promo: user pays base−30%, consultant credited on full base, platform ≈ 0', async () => {
    const promo = await ensureConsultationPromo(admin, 30);
    const exp = expectedSplit(fee, 30);
    const pendPre = (await consultantWallet(consultant)).pending;

    const { date, time } = slots();
    const res = await instantBook(explorer, { date, time, durationMinutes: 60, promoCode: promo });
    expect(res.status(), `book → ${await dump(res)}`).toBe(201);
    const { id, mode } = await res.json();
    expect(mode).toBe('confirmed');

    const charged = Number((await consultantBooking(consultant, id))?.amountCharged ?? 0);
    expect(charged, 'user pays base − 30%').toBe(exp.collected);

    const credited = (await consultantWallet(consultant)).pending - pendPre;
    expect(credited, 'consultant credited on full base').toBe(exp.consultantShare);
    // At a 30% promo with the 30/70 split the platform nets ≈ 0 (exact for a round fee).
    expect(charged - credited).toBe(exp.platformShare);
  });

  test('12b — above-ratio (50%) promo is ABSORBED, not capped: consultant still on full base, platform negative', async () => {
    const promo = await ensureConsultationPromo(admin, 50);
    const exp = expectedSplit(fee, 50);
    const pendPre = (await consultantWallet(consultant)).pending;

    const { date, time } = slots();
    const res = await instantBook(explorer, { date, time, durationMinutes: 60, promoCode: promo });
    // Must NOT be rejected — the locked model subsidizes rather than caps/rejects.
    expect(res.status(), `book → ${await dump(res)}`).toBe(201);
    const { id, mode } = await res.json();
    expect(mode).toBe('confirmed');

    const charged = Number((await consultantBooking(consultant, id))?.amountCharged ?? 0);
    expect(charged, 'user pays base − 50%').toBe(exp.collected);

    const credited = (await consultantWallet(consultant)).pending - pendPre;
    expect(credited, 'consultant STILL paid on the full base').toBe(exp.consultantShare);
    // Platform share is negative — the discount is the platform's expense.
    expect(charged - credited, 'platform subsidizes the gap (negative share)').toBeLessThan(0);
    expect(charged - credited).toBe(exp.platformShare);
  });
});
