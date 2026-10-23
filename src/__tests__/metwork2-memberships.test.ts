/**
 * Metwork 2.0 memberships — Free/Founder for entrepreneurs, Free/Premium for
 * freelancers, monthly auto-renewal from the wallet, and the one-time move to
 * the new terms.
 *
 * Drives the real purchase route and the real renewal run against the
 * in-memory store, and asserts the ledger (wallet, transactions, membership
 * records) — not only the response.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type * as NotificationsModule from '@/server/notifications/mock';

const session = vi.hoisted(() => ({ user: { id: 'u-ent', email: 'e@x.dz', role: 'ENTREPRENEUR' as string } }));
vi.mock('@/server/auth/api-guards', () => {
  const guard = vi.fn(async () => ({ ok: true, user: session.user }));
  return { requireApiRole: guard, requireApprovedApiRole: guard, requireApiSession: guard, requireApprovedApiSession: guard };
});
// Premium is off sale until phase 3; these tests exercise it as if on sale.
vi.mock('@/config/feature-flags', () => ({ isNetworkPassEnabled: () => false, isFreelancerPremiumOnSale: () => true }));
vi.mock('@/server/notifications/mock', async (orig) => {
  const actual = await orig<typeof NotificationsModule>();
  return { ...actual, sendMembershipRenewalNotice: vi.fn(async () => undefined) };
});

import { db } from '@/server/db/store';
import { sendMembershipRenewalNotice } from '@/server/notifications/mock';
import { runMembershipRenewals } from '@/server/memberships/renewals';
import { applyMetwork2PlanTerms, planConfigsFrom, pricesForConfig } from '@/server/memberships/plan-config';
import { resolveMemberBenefits } from '@/server/memberships/service';
import { meetsMinTier } from '@/server/perks/service';
import { DEFAULT_PLAN_BENEFITS, purchasablePlansFor } from '@/lib/membership-benefits';
import { entitlementsForUser, withinLimit } from '@/lib/entitlements';
import { memberBadgeFor } from '@/lib/member-badge';

const T0 = '2026-11-01T10:00:00.000Z';

function user(id: string, role: string, extra: Record<string, unknown> = {}) {
  return {
    id, email: `${id}@x.dz`, fullName: 'Amine Kaci', phone: '+213550000001', city: '16',
    role, status: 'ACTIVE', passwordHash: 'x', phoneVerified: true, emailVerified: true,
    membershipCode: null, membershipTier: 'EXPLORER', avatarUrl: null, locale: 'fr',
    createdAt: T0, updatedAt: T0, ...extra,
  } as never;
}

async function seed(balance = 100_000) {
  await db.update((d) => {
    d.users = [user('u-ent', 'ENTREPRENEUR'), user('u-fl', 'FREELANCER'), user('u-inv', 'INVESTOR')];
    d.wallets = ['u-ent', 'u-fl', 'u-inv'].map((id) => ({
      id: `w-${id}`, userId: id, balance, currency: 'DZD', status: 'ACTIVE', createdAt: T0, updatedAt: T0,
    })) as never;
    d.transactions = [];
    d.userMemberships = [];
    d.membershipPlanConfigs = [];
  });
}

async function buy(as: { id: string; role: string }, body: Record<string, unknown>) {
  session.user = { id: as.id, email: `${as.id}@x.dz`, role: as.role };
  const { POST } = await import('@/app/api/memberships/purchase/route');
  const res = await POST(new NextRequest('http://localhost/api/memberships/purchase', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }));
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  vi.mocked(sendMembershipRenewalNotice).mockClear();
  await seed();
});

describe('plan terms', () => {
  it('prices Founder and Premium monthly and 20 % off annually', () => {
    const configs = planConfigsFrom({});
    const founder = pricesForConfig(configs.find((c) => c.planCode === 'STARTUP')!);
    const premium = pricesForConfig(configs.find((c) => c.planCode === 'FREELANCER_PREMIUM')!);
    expect([founder.monthly, founder.annual]).toEqual([1_900, 18_240]);
    expect([premium.monthly, premium.annual]).toEqual([2_500, 24_000]);
    expect(DEFAULT_PLAN_BENEFITS.STARTUP).toMatchObject({ consultationDiscountRate: 0.10, spaceDiscountRate: 0.10 });
    expect(DEFAULT_PLAN_BENEFITS.FREELANCER_PREMIUM).toMatchObject({ consultationDiscountRate: 0.10, spaceDiscountRate: 0.10 });
  });

  it('sells each role only its own plan', () => {
    expect(purchasablePlansFor('ENTREPRENEUR')).toEqual(['STARTUP']);
    expect(purchasablePlansFor('FREELANCER')).toEqual(['FREELANCER_PREMIUM']);
    expect(purchasablePlansFor('INVESTOR')).toEqual([]);
    expect(purchasablePlansFor('INCUBATOR')).toEqual([]);
  });
});

describe('purchase route', () => {
  it('charges an entrepreneur 1 900 for a monthly Founder plan that auto-renews', async () => {
    const r = await buy({ id: 'u-ent', role: 'ENTREPRENEUR' }, { plan: 'STARTUP', billingPeriod: 'monthly', clientReference: 'ref-ent-0001' });
    expect(r.status).toBe(201);
    expect(r.body.amountCharged).toBe(1_900);
    const d = await db.read();
    expect(d.wallets.find((w) => w.userId === 'u-ent')!.balance).toBe(98_100);
    const m = d.userMemberships.find((x) => x.userId === 'u-ent')!;
    expect(m).toMatchObject({ plan: 'STARTUP', billingPeriod: 'monthly', autoRenew: true, spaceDiscountRate: 0.10 });
    expect(new Date(m.expiresAt!).getUTCMonth()).toBe((new Date(m.startsAt).getUTCMonth() + 1) % 12);
    const u = d.users.find((x) => x.id === 'u-ent')!;
    expect(u.membershipTier).toBe('FOUNDER');
    expect(u.membershipRenewalDate).toBe(m.expiresAt);
  });

  it('charges 24 000 for an annual Premium plan that does not auto-renew', async () => {
    const r = await buy({ id: 'u-fl', role: 'FREELANCER' }, { plan: 'FREELANCER_PREMIUM', billingPeriod: 'yearly' });
    expect(r.status).toBe(201);
    expect(r.body.amountCharged).toBe(24_000);
    const d = await db.read();
    const m = d.userMemberships.find((x) => x.userId === 'u-fl')!;
    expect(m.autoRenew).toBe(false);
    expect(d.users.find((x) => x.id === 'u-fl')!.membershipCode).toBe('FREELANCER_PREMIUM');
  });

  it('refuses another role\'s plan, the retired plan and other roles, without charging', async () => {
    const cases = [
      [{ id: 'u-fl', role: 'FREELANCER' }, 'STARTUP'],
      [{ id: 'u-ent', role: 'ENTREPRENEUR' }, 'FREELANCER_PREMIUM'],
      [{ id: 'u-ent', role: 'ENTREPRENEUR' }, 'ENTREPRENEUR'],
      [{ id: 'u-inv', role: 'INVESTOR' }, 'STARTUP'],
    ] as const;
    for (const [who, plan] of cases) {
      const r = await buy(who, { plan, billingPeriod: 'monthly' });
      expect(r.status, `${who.role} → ${plan}`).toBe(403);
    }
    const d = await db.read();
    expect(d.transactions).toHaveLength(0);
    expect(d.wallets.every((w) => w.balance === 100_000)).toBe(true);
  });

  it('no longer sells the semester cycle', async () => {
    const r = await buy({ id: 'u-ent', role: 'ENTREPRENEUR' }, { plan: 'STARTUP', billingPeriod: 'semesterly' });
    expect(r.status).toBe(422);
  });

  it('clears a scheduled downgrade when the member buys again', async () => {
    await db.update((d) => {
      const u = d.users.find((x) => x.id === 'u-ent')!;
      u.scheduledMembershipChange = 'FREE';
      u.scheduledChangeDate = '2026-12-01T00:00:00.000Z';
    });
    await buy({ id: 'u-ent', role: 'ENTREPRENEUR' }, { plan: 'STARTUP', billingPeriod: 'monthly' });
    const u = (await db.read()).users.find((x) => x.id === 'u-ent')!;
    expect(u.scheduledMembershipChange).toBeNull();
  });
});

describe('freelancer Premium benefits', () => {
  it('resolves 10 % / 10 % and ranks with the top tier for perks', async () => {
    await buy({ id: 'u-fl', role: 'FREELANCER' }, { plan: 'FREELANCER_PREMIUM', billingPeriod: 'monthly' });
    const d = await db.read();
    const u = d.users.find((x) => x.id === 'u-fl')!;
    const b = resolveMemberBenefits(d, u);
    expect(b).toMatchObject({ planCode: 'FREELANCER_PREMIUM', spaceDiscountRate: 0.10, consultationDiscountRate: 0.10, monthlyPassCount: 0, source: 'snapshot' });
    expect(meetsMinTier(u, 'FOUNDER')).toBe(true);
  });
});

describe('auto-renewal', () => {
  async function monthlyFounder(balanceAfterPurchase: number) {
    await buy({ id: 'u-ent', role: 'ENTREPRENEUR' }, { plan: 'STARTUP', billingPeriod: 'monthly' });
    await db.update((d) => { d.wallets.find((w) => w.userId === 'u-ent')!.balance = balanceAfterPurchase; });
    return (await db.read()).userMemberships.find((m) => m.userId === 'u-ent' && m.status === 'ACTIVE')!;
  }
  const after = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms);
  const DAY = 86_400_000;

  it('reminds once, 3 days before the period ends', async () => {
    const m = await monthlyFounder(5_000);
    const r1 = await runMembershipRenewals(after(m.expiresAt!, -2 * DAY));
    const r2 = await runMembershipRenewals(after(m.expiresAt!, -1 * DAY));
    expect(r1.reminded).toEqual([m.id]);
    expect(r2.reminded).toEqual([]);
    expect(sendMembershipRenewalNotice).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendMembershipRenewalNotice).mock.calls[0]![0]).toMatchObject({ kind: 'REMINDER', amount: 1_900, walletShort: false });
  });

  it('flags a short wallet in the reminder', async () => {
    const m = await monthlyFounder(500);
    await runMembershipRenewals(after(m.expiresAt!, -DAY));
    expect(vi.mocked(sendMembershipRenewalNotice).mock.calls[0]![0]).toMatchObject({ kind: 'REMINDER', walletShort: true });
  });

  it('renews at the live price, chains the period, and never charges twice', async () => {
    const m = await monthlyFounder(5_000);
    const runAt = after(m.expiresAt!, 60_000);
    const first = await runMembershipRenewals(runAt);
    const second = await runMembershipRenewals(runAt);
    expect(first.renewed).toEqual([m.id]);
    expect(second.renewed).toEqual([]);

    const d = await db.read();
    expect(d.wallets.find((w) => w.userId === 'u-ent')!.balance).toBe(3_100);
    expect(d.transactions.filter((t) => t.reference === `membership-renew-${m.id}`)).toHaveLength(1);
    const next = d.userMemberships.find((x) => x.renewedFromId === m.id)!;
    expect(next).toMatchObject({ status: 'ACTIVE', startsAt: m.expiresAt, autoRenew: true, amountCharged: 1_900 });
    expect(d.userMemberships.find((x) => x.id === m.id)!.status).toBe('EXPIRED');
    expect(d.users.find((x) => x.id === 'u-ent')!.membershipExpiresAt).toBe(next.expiresAt);
  });

  it('drops the member to Free when the wallet is short, without charging', async () => {
    const m = await monthlyFounder(1_000);
    const r = await runMembershipRenewals(after(m.expiresAt!, 60_000));
    expect(r.lapsed).toEqual([m.id]);
    const d = await db.read();
    const u = d.users.find((x) => x.id === 'u-ent')!;
    expect(d.wallets.find((w) => w.userId === 'u-ent')!.balance).toBe(1_000);
    expect(u).toMatchObject({ membershipCode: null, membershipTier: 'EXPLORER', membershipExpiresAt: null, networkCreditsMax: 0 });
    expect(u.membershipSpaceDiscountRate).toBeUndefined();
    expect(d.userMemberships.some((x) => x.userId === 'u-ent' && x.status === 'ACTIVE')).toBe(false);
    expect(vi.mocked(sendMembershipRenewalNotice).mock.calls.at(-1)![0]).toMatchObject({ kind: 'LAPSED', reason: 'INSUFFICIENT_FUNDS' });
  });

  it('skips a member who cancelled (scheduled downgrade)', async () => {
    const m = await monthlyFounder(5_000);
    await db.update((d) => {
      const u = d.users.find((x) => x.id === 'u-ent')!;
      u.scheduledMembershipChange = 'FREE';
      u.scheduledChangeDate = m.expiresAt;
    });
    const r = await runMembershipRenewals(after(m.expiresAt!, 60_000));
    expect(r.renewed).toEqual([]);
    expect((await db.read()).wallets.find((w) => w.userId === 'u-ent')!.balance).toBe(5_000);
  });

  it('never renews annual plans', async () => {
    await buy({ id: 'u-ent', role: 'ENTREPRENEUR' }, { plan: 'STARTUP', billingPeriod: 'yearly' });
    const m = (await db.read()).userMemberships.find((x) => x.userId === 'u-ent')!;
    const r = await runMembershipRenewals(after(m.expiresAt!, 60_000));
    expect(r.renewed).toEqual([]);
    expect(r.lapsed).toEqual([]);
  });
});

describe('Metwork 2.0 terms migration', () => {
  it('grandfathers active Startup members, then moves the config to Founder terms', async () => {
    await db.update((d) => {
      d.membershipPlanConfigs = [
        { planCode: 'ENTREPRENEUR', monthlyPrice: 1_500, semesterlyMonths: 6, annualDiscountPercent: 30, consultationDiscountRate: 0.10, spaceDiscountRate: 0.15, recommended: true, isActive: true, updatedAt: T0 },
        { planCode: 'STARTUP', monthlyPrice: 3_500, semesterlyMonths: 6, annualDiscountPercent: 30, consultationDiscountRate: 0.20, spaceDiscountRate: 0.15, recommended: false, isActive: true, updatedAt: T0 },
      ];
      // Admin grant with no frozen rates, and a tier-only member with no record.
      d.userMemberships = [{ id: 'm-old', userId: 'u-ent', plan: 'STARTUP', startsAt: T0, expiresAt: '2027-01-01T00:00:00.000Z', status: 'ACTIVE', createdAt: T0, updatedAt: T0 }];
      d.users.find((x) => x.id === 'u-ent')!.membershipCode = 'STARTUP';
      d.users.find((x) => x.id === 'u-ent')!.membershipExpiresAt = '2027-01-01T00:00:00.000Z';
      d.users.push(user('u-tier', 'ENTREPRENEUR', { membershipTier: 'FOUNDER' }));
    });

    const draft = await db.read();
    const report = applyMetwork2PlanTerms(draft, new Date(T0));
    expect(report.frozenMembershipIds).toEqual(['m-old']);
    expect(report.mirroredUserIds).toEqual(['u-tier']);
    expect(report.startupBefore).toMatchObject({ monthlyPrice: 3_500, consultationDiscountRate: 0.20 });

    // Existing members keep 20 % / 15 % …
    const ent = draft.users.find((x) => x.id === 'u-ent')!;
    const tier = draft.users.find((x) => x.id === 'u-tier')!;
    expect(resolveMemberBenefits(draft, ent)).toMatchObject({ consultationDiscountRate: 0.20, spaceDiscountRate: 0.15 });
    expect(resolveMemberBenefits(draft, tier)).toMatchObject({ consultationDiscountRate: 0.20, spaceDiscountRate: 0.15 });
    // … while new purchases get the Founder terms.
    const startup = planConfigsFrom(draft).find((c) => c.planCode === 'STARTUP')!;
    expect(startup).toMatchObject({ monthlyPrice: 1_900, annualDiscountPercent: 20, consultationDiscountRate: 0.10, spaceDiscountRate: 0.10 });
    expect(planConfigsFrom(draft).some((c) => c.planCode === 'FREELANCER_PREMIUM')).toBe(true);

    // Second run is a no-op.
    expect(applyMetwork2PlanTerms(draft).alreadyApplied).toBe(true);
  });
});

describe('entitlements and badges', () => {
  const FUTURE = '2030-01-01T00:00:00.000Z';
  it('splits limits by audience and plan', () => {
    const free = entitlementsForUser({ role: 'ENTREPRENEUR', membershipCode: null });
    const founder = entitlementsForUser({ role: 'ENTREPRENEUR', membershipCode: 'STARTUP', membershipExpiresAt: FUTURE });
    const premium = entitlementsForUser({ role: 'FREELANCER', membershipCode: 'FREELANCER_PREMIUM', membershipExpiresAt: FUTURE });
    expect(free).toMatchObject({ audience: 'ENTREPRENEUR', invoicesPerMonth: 5, publicStartupPage: false, cofounderChat: false });
    expect(founder).toMatchObject({ invoicesPerMonth: null, publicStartupPage: true, cofounderChat: true, paymentLinkFeePercent: 0 });
    expect(premium).toMatchObject({ audience: 'FREELANCER', gigs: null, sourcedCommissionPercent: 7, searchPriority: true });
    expect(entitlementsForUser({ role: 'INVESTOR', membershipCode: 'STARTUP' })).toBeNull();
    expect(withinLimit(5, 4)).toBe(true);
    expect(withinLimit(5, 5)).toBe(false);
    expect(withinLimit(null, 10_000)).toBe(true);
  });

  it('does not count a plan of the other audience or an expired one', () => {
    expect(entitlementsForUser({ role: 'FREELANCER', membershipCode: 'STARTUP', membershipExpiresAt: FUTURE })).toMatchObject({ gigs: 2 });
    expect(entitlementsForUser({ role: 'ENTREPRENEUR', membershipCode: 'STARTUP', membershipExpiresAt: '2020-01-01T00:00:00.000Z' })).toMatchObject({ invoicesPerMonth: 5 });
  });

  it('gives gold to Founder and verified only to approved Premium freelancers', () => {
    expect(memberBadgeFor({ role: 'ENTREPRENEUR', membershipCode: 'STARTUP', membershipExpiresAt: FUTURE })).toBe('GOLD');
    expect(memberBadgeFor({ role: 'ENTREPRENEUR', membershipCode: 'ENTREPRENEUR', membershipExpiresAt: FUTURE })).toBeNull();
    expect(memberBadgeFor({ role: 'FREELANCER', membershipCode: 'FREELANCER_PREMIUM', membershipExpiresAt: FUTURE })).toBeNull();
    expect(memberBadgeFor({ role: 'FREELANCER', membershipCode: 'FREELANCER_PREMIUM', membershipExpiresAt: FUTURE, legalVerificationStatus: 'APPROVED' })).toBe('VERIFIED');
    expect(memberBadgeFor({ role: 'ENTREPRENEUR', membershipCode: 'STARTUP', membershipExpiresAt: '2020-01-01T00:00:00.000Z' })).toBeNull();
  });
});

describe('Premium sale switch', () => {
  it('sells freelancers nothing while the switch is off', async () => {
    vi.resetModules();
    vi.doMock('@/config/feature-flags', () => ({ isNetworkPassEnabled: () => false, isFreelancerPremiumOnSale: () => false }));
    const { purchasablePlansFor: offSale } = await import('@/lib/membership-benefits');
    expect(offSale('FREELANCER')).toEqual([]);
    expect(offSale('ENTREPRENEUR')).toEqual(['STARTUP']);
    vi.doUnmock('@/config/feature-flags');
  });
});
