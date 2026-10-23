/**
 * Metwork 2.0 phase 7a — the hiring directory (who is listed, ranking with
 * Premium priority above the quality bar), the AI matcher (Claude mocked:
 * it extracts and explains, code ranks), and quote requests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db/store';
import { createMemoryRepo, setMessagingRepoForTests } from '@/server/messaging/repo';
import { freelancerProfile, rankFreelancers, isListed, PREMIUM_BOOST } from '@/server/hiring/directory';

const sdk = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/lib/env', () => ({ serverEnvVars: { ANTHROPIC_API_KEY: 'test-key' } }));
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error { status = 500; }
  class Anthropic {
    static APIError = APIError;
    beta = { messages: { create: sdk.create } };
  }
  return { default: Anthropic };
});
vi.mock('@/server/notifications/mock', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/server/notifications/mock')),
  sendNewMessageAlert: vi.fn(async () => undefined),
}));

const { matchFreelancers, parseNeed } = await import('@/server/hiring/matcher');
const { requestQuote } = await import('@/server/hiring/quotes');
const { inbox, sendMessage, setBlocked } = await import('@/server/messaging/service');

const T0 = '2026-01-01T10:00:00.000Z';
const FUTURE = '2030-01-01T00:00:00.000Z';
const PREMIUM = { membershipCode: 'FREELANCER_PREMIUM', membershipTier: 'FOUNDER', membershipExpiresAt: FUTURE };
const repo = createMemoryRepo();

function user(id: string, role: string, extra: Record<string, unknown> = {}) {
  return {
    id, email: `${id}@x.dz`, fullName: `Name ${id}`, phone: '+213550000001', city: 'Alger', role, status: 'ACTIVE',
    passwordHash: 'x', phoneVerified: true, emailVerified: true, membershipCode: null, membershipTier: 'EXPLORER',
    avatarUrl: null, locale: 'fr', createdAt: T0, updatedAt: T0, ...extra,
  } as never;
}

function profile(userId: string, headline: string, skills: string[], extra: Record<string, unknown> = {}) {
  return {
    userId, headline, bio: 'Je conçois des interfaces web et mobiles pour des startups algériennes depuis cinq ans, du wireframe au site livré.',
    skills, languages: ['fr', 'ar'], remote: true, dayRate: 15_000, address: 'Rue secrète 12', portfolio: [], legal: null,
    createdAt: T0, updatedAt: T0, ...extra,
  } as never;
}

const gig = (id: string, freelancerId: string, title: string, price: number) =>
  ({ id, freelancerId, title, description: '', price, deliveryDays: 7, revisions: 2, isActive: true, createdAt: T0, updatedAt: T0 }) as never;

beforeEach(async () => {
  repo.reset();
  setMessagingRepoForTests(repo);
  sdk.create.mockReset();
  await db.update((d) => {
    d.users = [
      user('web-free', 'FREELANCER'),
      user('web-prem', 'FREELANCER', PREMIUM),
      user('weak-prem', 'FREELANCER', PREMIUM),
      user('thin', 'FREELANCER'),
      user('en-1', 'ENTREPRENEUR'),
      user('en-gold', 'ENTREPRENEUR', { membershipCode: 'STARTUP', membershipTier: 'FOUNDER', membershipExpiresAt: FUTURE }),
    ];
    d.freelancerProfiles = [
      profile('web-free', 'Développeuse web', ['next.js', 'react', 'site vitrine', 'arabe rtl'], { avatarUrl: null }),
      profile('web-prem', 'Développeur web', ['react', 'site vitrine', 'wordpress']),
      profile('weak-prem', 'Photographe', ['photo produit', 'retouche', 'lightroom']),
      profile('thin', 'Designer', ['figma']),
    ];
    d.gigs = [gig('g-1', 'web-free', 'Site vitrine bilingue', 95_000), gig('g-2', 'weak-prem', 'Shooting produit', 30_000)];
    d.quoteRequests = [];
    d.ventures = [];
  });
});

describe('directory', () => {
  it('lists only freelancers who say what they do, without private fields', async () => {
    const d = await db.read();
    expect(isListed(d, 'thin')).toBe(false);
    expect(rankFreelancers(d, null).map((r) => r.card.id).sort()).toEqual(['weak-prem', 'web-free', 'web-prem']);
    const p = freelancerProfile(d, 'web-free')!;
    expect(JSON.stringify(p)).not.toContain('Rue secrète');
    expect(JSON.stringify(p)).not.toContain('@x.dz');
    expect(p.gigs.map((g) => g.title)).toEqual(['Site vitrine bilingue']);
  });

  it('boosts Premium only among good matches', async () => {
    const d = await db.read();
    const need = { skills: ['site vitrine', 'react'], keywords: [], budgetMax: null, wilaya: null, remoteOk: true };
    const ranked = rankFreelancers(d, need);
    // The photographer matches nothing: left out, Premium or not.
    expect(ranked.map((r) => r.card.id)).not.toContain('weak-prem');
    const prem = ranked.find((r) => r.card.id === 'web-prem')!;
    expect(prem.score).toBeCloseTo(prem.base * PREMIUM_BOOST);
    expect(ranked.find((r) => r.card.id === 'web-free')!.score).toBe(ranked.find((r) => r.card.id === 'web-free')!.base);
  });

  it('filters by text, price and wilaya', async () => {
    const d = await db.read();
    expect(rankFreelancers(d, null, { q: 'photo' }).map((r) => r.card.id)).toEqual(['weak-prem']);
    expect(rankFreelancers(d, null, { maxPrice: 50_000 }).map((r) => r.card.id).sort()).toEqual(['weak-prem', 'web-prem']);
    expect(rankFreelancers(d, null, { city: 'oran' })).toEqual([]);
    expect(rankFreelancers(d, null, { city: 'alger' })).toHaveLength(3);
  });
});

describe('matcher', () => {
  it('only trusts a well-formed need', () => {
    expect(parseNeed({ skills: ['react', 7, ''], keywords: [], budgetMax: -5, city: 'Atlantis', remoteOk: true })).toEqual({
      skills: ['react'], keywords: [], budgetMax: null, wilaya: null, remoteOk: true,
    });
    expect(parseNeed({ skills: ['react'], keywords: [], budgetMax: 1000, city: 'Alger', remoteOk: true })!.wilaya).toBe('algiers');
    expect(parseNeed('nope')).toBeNull();
  });

  it('extracts, ranks in code, explains the top results only', async () => {
    sdk.create
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ skills: ['site vitrine', 'arabe rtl'], keywords: ['agritech'], budgetMax: 120000, city: null, remoteOk: true }) }] })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ items: [{ id: 'web-free', reasons: ['Site vitrine bilingue à 95 000 DA', 'Spécialiste arabe RTL'] }, { id: 'intruder', reasons: ['x'] }] }) }] });
    const r = await matchFreelancers('أحتاج موقعًا بالعربية والفرنسية', 'ar');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.matches[0]!.card.id).toBe('web-free');
    expect(r.matches[0]!.reasons).toEqual(['Site vitrine bilingue à 95 000 DA', 'Spécialiste arabe RTL']);
    expect(r.matches.some((m) => m.card.id === 'weak-prem')).toBe(false);
    // The explain call saw public profiles only.
    expect(JSON.stringify(sdk.create.mock.calls[1]![0])).not.toContain('Rue secrète');
  });

  it('says so when the text is not a need', async () => {
    sdk.create.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ skills: [], keywords: [], budgetMax: null, city: null, remoteOk: true }) }] });
    expect(await matchFreelancers('bonjour, ça va ?', 'fr')).toEqual({ ok: false, reason: 'NOT_A_NEED' });
  });
});

describe('quote requests', () => {
  const labels = { locale: 'fr' as const, budget: 'Budget', deadline: 'Délai' };
  const ask = (from = 'en-1', to = 'web-free', gigId: string | null = null) =>
    requestQuote(from, { freelancerId: to, gigId, title: 'Site vitrine', details: 'Un site FR/AR avec inscription.', budget: 120_000, deadline: '2026-12-15' }, labels);

  it('opens a thread titled after the request and counts it', async () => {
    const r = await ask('en-1', 'web-free', 'g-1');
    expect(r.ok).toBe(true);
    const threads = await inbox('web-free');
    expect(threads[0]).toMatchObject({ context: { type: 'QUOTE_REQUEST', title: 'Site vitrine' }, unread: true });
    expect(threads[0]!.preview).toContain('Site vitrine');
  });

  it('allows 3 a month on Free, unlimited on Founder', async () => {
    for (let i = 0; i < 3; i++) expect((await ask()).ok).toBe(true);
    expect(await ask()).toMatchObject({ ok: false, reason: 'QUOTE_LIMIT', limit: 3 });
    for (let i = 0; i < 5; i++) expect((await ask('en-gold')).ok).toBe(true);
  });

  it('does not count a request that could not be delivered', async () => {
    const first = await ask();
    const conversationId = first.ok ? first.conversationId : '';
    await setBlocked('web-free', conversationId, true);
    expect(await ask()).toMatchObject({ ok: false, reason: 'BLOCKED' });
    expect((await db.read()).quoteRequests).toHaveLength(1);
  });

  it('is marked answered when the freelancer sends a devis in the thread', async () => {
    await db.update((d) => {
      d.invoices = [{ id: 'dv-1', freelancerId: 'web-free', kind: 'DEVIS', number: 'D-1', status: 'ISSUED', totals: { ht: 1, tva: 0, ttc: 1, timbre: 0, net: 1 }, createdAt: T0, issuedAt: T0 } as never];
    });
    const r = await ask();
    const conversationId = r.ok ? r.conversationId : '';
    await sendMessage({ userId: 'web-free', conversationId, body: '', attachment: { kind: 'INVOICE', invoiceId: 'dv-1' } });
    expect((await db.read()).quoteRequests![0]!.status).toBe('ANSWERED');
  });

  it('refuses unlisted freelancers and other people\'s gigs', async () => {
    expect(await ask('en-1', 'thin')).toMatchObject({ ok: false, reason: 'NOT_FOUND' });
    expect(await ask('en-1', 'web-free', 'g-2')).toMatchObject({ ok: false, reason: 'NOT_FOUND' });
    expect(await ask('web-prem', 'web-free')).toMatchObject({ ok: false, reason: 'NOT_ALLOWED' });
  });
});
