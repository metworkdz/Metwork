/**
 * Metwork 2.0 phase 3b — the freelancer project board, gigs (Free-plan limit)
 * and the turnover / auto-entrepreneur ceiling figures.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db/store';
import { createProject, deleteProject, listProjects, listGigs, saveGig, updateProject, type GigInput } from '@/server/freelancers/workspace';
import { aeCeilingView, turnoverForYear, AE_ANNUAL_CEILING_DZD } from '@/lib/turnover';
import { resolveMemberBenefits } from '@/server/memberships/service';

const T0 = '2026-11-01T10:00:00.000Z';
const FUTURE = '2030-01-01T00:00:00.000Z';

function user(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, email: `${id}@x.dz`, fullName: 'Amine Kaci', phone: '+213550000001', city: 'alger', role: 'FREELANCER', status: 'ACTIVE',
    passwordHash: 'x', phoneVerified: true, emailVerified: true, membershipCode: null, membershipTier: 'EXPLORER',
    avatarUrl: null, locale: 'fr', createdAt: T0, updatedAt: T0, ...extra,
  } as never;
}

const GIG: GigInput = { title: 'Logo + charte', description: '', price: 45_000, deliveryDays: 7, revisions: 2, isActive: true };
const PROJECT = { title: 'Site vitrine', clientName: 'Atlas', clientId: null, status: 'TODO' as const, dueDate: '2026-11-20', amount: 80_000, notes: null };

beforeEach(async () => {
  await db.update((d) => {
    d.users = [user('fl-1'), user('fl-2')];
    d.freelancerProjects = [];
    d.gigs = [];
    d.clients = [{ id: 'c-other', freelancerId: 'fl-2', fullName: 'X', email: '', phone: '', createdAt: T0, updatedAt: T0 } as never];
    d.userMemberships = [];
    d.membershipPlanConfigs = [];
  });
});

describe('project board', () => {
  it('is private to its owner', async () => {
    const p = await createProject('fl-1', PROJECT);
    expect(listProjects(await db.read(), 'fl-2')).toEqual([]);
    expect(await updateProject('fl-2', p.id, { status: 'PAID' })).toBeNull();
    expect(await deleteProject('fl-2', p.id)).toBe(false);
    expect((await updateProject('fl-1', p.id, { status: 'IN_PROGRESS' }))!.status).toBe('IN_PROGRESS');
  });

  it('never links another freelancer\'s client', async () => {
    const p = await createProject('fl-1', { ...PROJECT, clientId: 'c-other' });
    expect(p.clientId).toBeNull();
    expect((await updateProject('fl-1', p.id, { clientId: 'c-other' }))!.clientId).toBeNull();
  });
});

describe('gigs', () => {
  it('limits live gigs to 2 on Free but keeps drafts', async () => {
    expect((await saveGig('fl-1', GIG)).ok).toBe(true);
    expect((await saveGig('fl-1', GIG)).ok).toBe(true);
    expect(await saveGig('fl-1', GIG)).toMatchObject({ ok: false, reason: 'PLAN_LIMIT_REACHED', limit: 2 });
    const draft = await saveGig('fl-1', { ...GIG, isActive: false });
    expect(draft.ok).toBe(true);
    // Editing a gig that is already live never trips the limit.
    const live = listGigs(await db.read(), 'fl-1').find((g) => g.isActive)!;
    expect((await saveGig('fl-1', { ...GIG, price: 50_000 }, live.id)).ok).toBe(true);
    // Switching the draft on is refused while two are live.
    if (draft.ok) expect(await saveGig('fl-1', { ...GIG }, draft.gig.id)).toMatchObject({ ok: false, reason: 'PLAN_LIMIT_REACHED' });
  });

  it('is unlimited on Premium and owner-scoped', async () => {
    await db.update((d) => {
      const u = d.users.find((x) => x.id === 'fl-1')!;
      u.membershipCode = 'FREELANCER_PREMIUM';
      u.membershipTier = 'FOUNDER';
      u.membershipExpiresAt = FUTURE;
    });
    for (let i = 0; i < 4; i++) expect((await saveGig('fl-1', GIG)).ok).toBe(true);
    const mine = listGigs(await db.read(), 'fl-1')[0]!;
    expect(await saveGig('fl-2', GIG, mine.id)).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });
});

describe('turnover', () => {
  const inv = (over: Record<string, unknown>) => ({ kind: 'FACTURE', status: 'ISSUED', issuedAt: '2026-03-01T00:00:00Z', totals: { ht: 100_000 }, ...over });

  it('counts only issued factures of the year, before tax', () => {
    const list = [
      inv({}),
      inv({ totals: { ht: 50_000 } }),
      inv({ kind: 'DEVIS' }),
      inv({ kind: 'PROFORMA' }),
      inv({ status: 'CANCELLED' }),
      inv({ issuedAt: '2025-12-31T23:00:00Z' }),
      inv({ kind: undefined }), // legacy records are factures
    ];
    expect(turnoverForYear(list, 2026)).toBe(250_000);
  });

  it('raises the 80 % and 95 % alerts against the ceiling', () => {
    // 0.5 % of 1 M is 5 000, below the 10 000 DA minimum.
    expect(aeCeilingView(1_000_000)).toMatchObject({ alert: null, estimatedIfu: 10_000 });
    expect(aeCeilingView(4_000_000).estimatedIfu).toBe(20_000);
    expect(aeCeilingView(AE_ANNUAL_CEILING_DZD * 0.8).alert).toBe(0.8);
    expect(aeCeilingView(AE_ANNUAL_CEILING_DZD * 0.96).alert).toBe(0.95);
    expect(aeCeilingView(AE_ANNUAL_CEILING_DZD * 2).share).toBe(1);
  });
});

describe('Premium discount on bookings', () => {
  it('resolves 10 % on spaces and consultations for a Premium freelancer', async () => {
    await db.update((d) => {
      const u = d.users.find((x) => x.id === 'fl-1')!;
      u.membershipCode = 'FREELANCER_PREMIUM';
      u.membershipTier = 'FOUNDER';
      u.membershipExpiresAt = FUTURE;
    });
    const d = await db.read();
    expect(resolveMemberBenefits(d, d.users.find((u) => u.id === 'fl-1')!)).toMatchObject({ spaceDiscountRate: 0.10, consultationDiscountRate: 0.10 });
  });
});
