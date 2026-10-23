/**
 * Metwork 2.0 phase 2 — freelancer profile completion, automatic document
 * review, the Premium trial, and entrepreneur ventures.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const extraction = vi.hoisted(() => ({ value: null as unknown, fail: false }));
vi.mock('@/server/freelancers/legal-review', async (orig) => {
  const actual = await orig<typeof LegalReviewModule>();
  return {
    ...actual,
    extractLegalDocument: vi.fn(async () => {
      if (extraction.fail) throw new actual.LegalExtractionError('down');
      return extraction.value;
    }),
  };
});
vi.mock('@/lib/cloudinary', async (orig) => {
  const actual = await orig<typeof CloudinaryModule>();
  return {
    ...actual,
    isConfigured: () => true,
    uploadAuthenticatedRaw: vi.fn(async (_b: Buffer, o: { publicId: string }) => ({ publicId: `metwork/legal-documents/${o.publicId}`, bytes: 1 })),
  };
});
const flags = vi.hoisted(() => ({ premiumOnSale: true }));
vi.mock('@/config/feature-flags', () => ({ isNetworkPassEnabled: () => false, isFreelancerPremiumOnSale: () => flags.premiumOnSale }));

import type * as LegalReviewModule from '@/server/freelancers/legal-review';
import type * as CloudinaryModule from '@/lib/cloudinary';
import { db } from '@/server/db/store';
import { computeCompletion } from '@/lib/freelancer-completion';
import { decideLegalReview, namesMatch, numberKeyOf } from '@/server/freelancers/legal-review';
import {
  decideLegalDocumentByAdmin,
  startPremiumTrial,
  submitLegalDocument,
  updateFreelancerProfile,
} from '@/server/freelancers/service';
import { publicVentureBySlug, saveVenture, type VentureInput } from '@/server/ventures/service';
import { slugifyVentureName } from '@/lib/venture-options';

const T0 = '2026-11-01T10:00:00.000Z';
const FUTURE = '2030-01-01T00:00:00.000Z';
const GOOD = {
  documentType: 'AUTO_ENTREPRENEUR_CARD',
  holderName: 'KACI Amine',
  documentNumber: 'AE 16-0012345',
  activity: 'Design graphique',
  issueDate: '2025-02-01',
  expiryDate: null,
  legible: true,
  confidence: 0.95,
} as const;

function user(id: string, role: string, extra: Record<string, unknown> = {}) {
  return {
    id, email: `${id}@x.dz`, fullName: 'Amine Kaci', phone: '+213550000001', city: 'alger',
    role, status: 'ACTIVE', passwordHash: 'x', phoneVerified: true, emailVerified: true,
    membershipCode: null, membershipTier: 'EXPLORER', avatarUrl: 'https://res.cloudinary.com/x/a.jpg', locale: 'fr',
    payoutAccount: { accountType: 'bank', accountNumber: '00799999000123456789', holderName: 'Amine Kaci' },
    createdAt: T0, updatedAt: T0, ...extra,
  } as never;
}

const FULL_PROFILE = {
  headline: 'Designer UI/UX',
  bio: 'Je conçois des sites et des applications pour les startups et les PME algériennes, de la maquette au lancement.',
  skills: ['Figma', 'UX', 'Next.js'],
  languages: ['fr', 'ar'],
  remote: true,
  dayRate: 15_000,
  address: '12 rue Didouche Mourad, Alger',
  portfolio: [
    { title: 'App A', imageUrl: 'https://res.cloudinary.com/x/1.jpg', url: null },
    { title: 'Site B', imageUrl: null, url: 'https://example.dz' },
  ],
};

beforeEach(async () => {
  extraction.value = { ...GOOD };
  extraction.fail = false;
  flags.premiumOnSale = true;
  await db.update((d) => {
    d.users = [user('fl-1', 'FREELANCER'), user('fl-2', 'FREELANCER', { fullName: 'Sara Meziane' }), user('ent-1', 'ENTREPRENEUR')];
    d.freelancerProfiles = [];
    d.userMemberships = [];
    d.membershipPlanConfigs = [];
    d.ventures = [];
    d.startupListings = [];
  });
});

const submit = (userId: string) =>
  submitLegalDocument({ userId, status: 'AUTO_ENTREPRENEUR', kind: 'AUTO_ENTREPRENEUR_CARD', buffer: Buffer.from('%PDF-1.4'), mimeType: 'application/pdf' });

describe('completion', () => {
  it('weighs to exactly 100 and needs every item', () => {
    const empty = computeCompletion({ fullName: 'A B' }, null);
    expect(empty.items.reduce((s, i) => s + i.weight, 0)).toBe(100);
    expect(empty.percent).toBe(0);
    const almost = computeCompletion(
      { fullName: 'Amine Kaci', phone: '+213', city: 'alger', avatarUrl: 'x', payoutAccount: { accountNumber: '1' }, legalVerificationStatus: 'PENDING' },
      { ...FULL_PROFILE, portfolio: [1, 2] },
    );
    expect(almost.percent).toBe(75);
    expect(almost.items.find((i) => i.key === 'document')!.done).toBe(false);
  });
});

describe('document review rules', () => {
  const ctx = { expectedKind: 'AUTO_ENTREPRENEUR_CARD' as const, profileName: 'Amine Kaci', takenNumberKeys: new Set<string>() };

  it('approves a clean, matching card', () => {
    expect(decideLegalReview({ ...GOOD }, ctx)).toEqual({ state: 'APPROVED', reasons: [], numberKey: 'AE160012345' });
  });

  it('never rejects — every doubt goes to the queue with its reason', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ legible: false }, 'NOT_LEGIBLE'],
      [{ confidence: 0.5 }, 'LOW_CONFIDENCE'],
      [{ documentType: 'COMMERCE_REGISTER' }, 'WRONG_DOCUMENT'],
      [{ holderName: 'Karim Benali' }, 'NAME_MISMATCH'],
      [{ holderName: null }, 'NAME_MISMATCH'],
      [{ documentNumber: '12' }, 'NUMBER_MISSING'],
      [{ expiryDate: '2020-01-01' }, 'EXPIRED'],
    ];
    for (const [patch, reason] of cases) {
      const d = decideLegalReview({ ...GOOD, ...patch } as never, ctx);
      expect(d.state, reason).toBe('PENDING');
      expect(d.reasons).toContain(reason);
    }
    expect(decideLegalReview({ ...GOOD }, { ...ctx, takenNumberKeys: new Set(['AE160012345']) }).reasons).toEqual(['DUPLICATE_NUMBER']);
    expect(decideLegalReview(null, ctx)).toMatchObject({ state: 'PENDING', reasons: ['AI_UNAVAILABLE'] });
  });

  it('matches names regardless of order and accents, never on one shared part', () => {
    expect(namesMatch('KACI Amine', 'Amine Kaci')).toBe(true);
    expect(namesMatch('Amine Kaci', 'Amine Kaci Benali')).toBe(true);
    expect(namesMatch('Hélène Bensaïd', 'helene bensaid')).toBe(true);
    expect(namesMatch('Amine', 'Amine Kaci')).toBe(false);
    expect(namesMatch('Amine Benali', 'Amine Kaci')).toBe(false);
    expect(numberKeyOf(' ae-16/0012345 ')).toBe('AE160012345');
  });
});

describe('document submission', () => {
  it('approves automatically and sets the badge field', async () => {
    const r = await submit('fl-1');
    expect(r).toMatchObject({ ok: true, decision: { state: 'APPROVED' } });
    const d = await db.read();
    expect(d.users.find((u) => u.id === 'fl-1')!.legalVerificationStatus).toBe('APPROVED');
    expect(d.freelancerProfiles!.find((p) => p.userId === 'fl-1')!.legal!.documentPublicId).toMatch(/^metwork\/legal-documents\/fl-1-/);
  });

  it('queues a second account presenting the same document number', async () => {
    await submit('fl-1');
    extraction.value = { ...GOOD, holderName: 'MEZIANE Sara' };
    const r = await submit('fl-2');
    expect(r).toMatchObject({ ok: true, decision: { state: 'PENDING', reasons: ['DUPLICATE_NUMBER'] } });
  });

  it('queues when the reader is down, and lets an admin decide', async () => {
    extraction.fail = true;
    expect(await submit('fl-1')).toMatchObject({ ok: true, decision: { state: 'PENDING', reasons: ['AI_UNAVAILABLE'] } });
    await decideLegalDocumentByAdmin({ userId: 'fl-1', adminId: 'adm', decision: 'REJECTED', note: 'Photo floue' });
    const d = await db.read();
    expect(d.users.find((u) => u.id === 'fl-1')!.legalVerificationStatus).toBe('REJECTED');
    expect(d.freelancerProfiles![0]!.legal!.review).toMatchObject({ state: 'REJECTED', by: 'adm', reasons: ['Photo floue'] });
  });

  it('refuses a document that does not prove the declared status', async () => {
    const r = await submitLegalDocument({ userId: 'fl-1', status: 'LIBERAL_PROFESSION', kind: 'AUTO_ENTREPRENEUR_CARD', buffer: Buffer.from('x'), mimeType: 'image/png' });
    expect(r).toEqual({ ok: false, reason: 'DOCUMENT_NOT_ACCEPTED' });
  });
});

describe('Premium trial', () => {
  async function complete(userId: string) {
    await updateFreelancerProfile(userId, FULL_PROFILE);
    await submit(userId);
  }

  it('unlocks at 100 % and grants one free, non-renewing Premium month', async () => {
    await complete('fl-1');
    const before = await db.read();
    expect(before.freelancerProfiles![0]!.trial?.unlockedAt).toBeTruthy();
    const r = await startPremiumTrial('fl-1', new Date(T0));
    expect(r).toMatchObject({ ok: true });
    const d = await db.read();
    const m = d.userMemberships.find((x) => x.userId === 'fl-1')!;
    expect(m).toMatchObject({ plan: 'FREELANCER_PREMIUM', trial: true, autoRenew: false, amountCharged: 0 });
    expect(d.users.find((u) => u.id === 'fl-1')!.membershipCode).toBe('FREELANCER_PREMIUM');
    expect(await startPremiumTrial('fl-1')).toEqual({ ok: false, reason: 'ALREADY_USED' });
  });

  it('refuses below 100 %, while Premium is off sale, and for a document already used', async () => {
    await updateFreelancerProfile('fl-1', { ...FULL_PROFILE, bio: 'short' });
    await submit('fl-1');
    expect(await startPremiumTrial('fl-1')).toEqual({ ok: false, reason: 'NOT_UNLOCKED' });

    await complete('fl-1');
    flags.premiumOnSale = false;
    expect(await startPremiumTrial('fl-1')).toEqual({ ok: false, reason: 'NOT_ON_SALE' });
    flags.premiumOnSale = true;
    expect((await startPremiumTrial('fl-1')).ok).toBe(true);

    // Same card on a second account: an admin approves it, the trial still refuses.
    await updateFreelancerProfile('fl-2', FULL_PROFILE);
    extraction.value = { ...GOOD, holderName: 'MEZIANE Sara' };
    await submit('fl-2');
    await decideLegalDocumentByAdmin({ userId: 'fl-2', adminId: 'adm', decision: 'APPROVED', note: null });
    expect(await startPremiumTrial('fl-2')).toEqual({ ok: false, reason: 'DOCUMENT_ALREADY_USED' });
  });
});

describe('ventures', () => {
  const base: VentureInput = {
    name: 'Fellah Connect', kind: 'STARTUP', legal: { status: 'UNREGISTERED' }, stage: 'PROTOTYPE',
    sector: 'AgriTech', wilaya: 'oran', description: 'Marketplace agricole', website: null, lookingFor: ['COFOUNDER', 'FREELANCER'], isPublic: false,
  };

  it('creates one venture per entrepreneur and keeps its slug unique', async () => {
    await db.update((d) => { d.users.push(user('ent-2', 'ENTREPRENEUR')); });
    const a = await saveVenture('ent-1', base);
    const b = await saveVenture('ent-2', base);
    expect(a.ok && a.venture.slug).toBe('fellah-connect');
    expect(b.ok && b.venture.slug).toBe('fellah-connect-2');
    await saveVenture('ent-1', { ...base, sector: 'Logistique' });
    expect((await db.read()).ventures!.filter((v) => v.ownerId === 'ent-1')).toHaveLength(1);
    expect(slugifyVentureName('Café Djurdjura !')).toBe('cafe-djurdjura');
  });

  it('only Founder can turn the public page on, and it hides when the plan lapses', async () => {
    expect(await saveVenture('ent-1', { ...base, isPublic: true })).toEqual({ ok: false, reason: 'PUBLIC_PAGE_REQUIRES_FOUNDER' });
    expect((await db.read()).ventures).toHaveLength(0);

    await db.update((d) => {
      const u = d.users.find((x) => x.id === 'ent-1')!;
      u.membershipCode = 'STARTUP';
      u.membershipTier = 'FOUNDER';
      u.membershipExpiresAt = FUTURE;
    });
    const saved = await saveVenture('ent-1', { ...base, isPublic: true });
    expect(saved.ok).toBe(true);
    expect(await publicVentureBySlug('fellah-connect')).not.toBeNull();

    await db.update((d) => { d.users.find((x) => x.id === 'ent-1')!.membershipExpiresAt = '2020-01-01T00:00:00.000Z'; });
    expect(await publicVentureBySlug('fellah-connect')).toBeNull();
  });

  it('refuses non-entrepreneurs', async () => {
    expect(await saveVenture('fl-1', base)).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });
});
