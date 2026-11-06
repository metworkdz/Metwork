/**
 * Startup Academy referral (owner decision 2026-11-02): any account gets a
 * link; a member new to the Academy who comes through it gets 10 % off their
 * first purchase (course, Pass or bundle — not a gift), and the referrer gets
 * 10 % of what that member paid, capped at 1 000 DA, in their wallet once the
 * refund window has passed (`releaseReferralRewards` in orders.ts).
 *
 * The link sets an HttpOnly cookie with the code for 30 days; the checkout
 * reads it on the server. The discount is never taken from the browser.
 */
import { randomBytes } from 'node:crypto';
import { db, type AcademyOrderRecord, type UserRecord } from '@/server/db/store';
import { allocateBundle, referralDiscountDzd } from '@/lib/academy';

export const REFERRAL_COOKIE = 'metwork_academy_ref';
export const REFERRAL_COOKIE_MAX_AGE = 30 * 24 * 3600;
export const REFERRAL_CODE_RE = /^[A-Z2-9]{8}$/;

type StoreData = Awaited<ReturnType<typeof db.read>>;

/** No 0/O/1/I: codes are read out loud and typed from a phone. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** The member's referral code, created the first time it is asked for. */
export async function getOrCreateReferralCode(userId: string): Promise<string | null> {
  return db.update((d) => {
    const u = d.users.find((x) => x.id === userId);
    if (!u) return null;
    if (u.academyReferralCode) return u.academyReferralCode;
    const taken = new Set(d.users.map((x) => x.academyReferralCode).filter(Boolean));
    let code = newCode();
    while (taken.has(code)) code = newCode();
    u.academyReferralCode = code;
    return code;
  });
}

const digits = (p: string | null | undefined) => (p ?? '').replace(/\D/g, '').replace(/^213/, '').replace(/^0+/, '');

/** Has this member already bought anything in the Academy (any paid order)? */
export function hasAcademyPurchase(d: Pick<StoreData, 'academyOrders'>, userId: string): boolean {
  return (d.academyOrders ?? []).some((o) => o.userId === userId && o.status === 'PAID');
}

/**
 * The referrer behind a code, when it applies to this buyer: a real other
 * account (not the same phone), and a buyer with no Academy purchase and no
 * referral yet.
 */
export function referrerFor(d: StoreData, buyer: Pick<UserRecord, 'id' | 'phone'>, code: string | null | undefined): UserRecord | null {
  if (!code || !REFERRAL_CODE_RE.test(code)) return null;
  const referrer = d.users.find((u) => u.academyReferralCode === code);
  if (!referrer || referrer.id === buyer.id) return null;
  if (digits(referrer.phone) && digits(referrer.phone) === digits(buyer.phone)) return null;
  if (hasAcademyPurchase(d, buyer.id)) return null;
  if ((d.academyReferrals ?? []).some((r) => r.refereeId === buyer.id)) return null;
  return referrer;
}

/** The 10 % this buyer would get off `amountDzd` through `code`, or 0. For display and for orders. */
export async function referralDiscountFor(buyer: Pick<UserRecord, 'id' | 'phone'>, code: string | null | undefined, amountDzd: number): Promise<number> {
  const d = await db.read();
  return referrerFor(d, buyer, code) ? referralDiscountDzd(amountDzd) : 0;
}

/**
 * Take the referral discount off a new order (before it is paid). The mentors'
 * shares are unchanged: they are computed on the full list price.
 */
export async function applyReferralToOrder(order: AcademyOrderRecord, buyer: Pick<UserRecord, 'id' | 'phone'>, code: string | null | undefined): Promise<void> {
  const d = await db.read();
  const referrer = referrerFor(d, buyer, code);
  if (!referrer) return;
  const discountDzd = referralDiscountDzd(order.amountDzd);
  if (discountDzd <= 0) return;
  order.amountDzd -= discountDzd;
  order.referral = { referrerId: referrer.id, discountDzd };
  // A bundle's courses each carry their part of the price (refunds return it): rescale them.
  if (order.bundleItems?.length) {
    const parts = allocateBundle(order.amountDzd, order.bundleItems.map((i) => i.listPriceDzd));
    order.bundleItems.forEach((item, k) => { item.amountDzd = parts[k]!; });
  }
}

export interface ReferralSummary {
  code: string;
  invited: number;
  pending: number;
  earnedDzd: number;
}

export async function referralSummary(userId: string): Promise<ReferralSummary | null> {
  const code = await getOrCreateReferralCode(userId);
  if (!code) return null;
  const mine = ((await db.read()).academyReferrals ?? []).filter((r) => r.referrerId === userId);
  return {
    code,
    invited: mine.length,
    pending: mine.filter((r) => r.status === 'PENDING').length,
    earnedDzd: mine.filter((r) => r.status === 'CREDITED').reduce((s, r) => s + r.rewardDzd, 0),
  };
}
