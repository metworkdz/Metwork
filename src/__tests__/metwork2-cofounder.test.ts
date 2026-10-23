/**
 * Metwork 2.0 phase 8a — find my cofounder. The locked rules:
 * on by default for entrepreneurs (off switch), every like announced without
 * a name, names only on a mutual match, daily cards from the plan, chat when
 * either side is paid, safety filters (phone, blocks, visibility).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db/store';
import { createMemoryRepo, setMessagingRepoForTests } from '@/server/messaging/repo';
import { createMemoryCofounderRepo, setCofounderRepoForTests } from '@/server/cofounder/repo';
import { matchScore } from '@/lib/cofounder';

const sdk = vi.hoisted(() => ({ create: vi.fn(), key: { value: undefined as string | undefined } }));
vi.mock('@/lib/env', () => ({ serverEnvVars: { get ANTHROPIC_API_KEY() { return sdk.key.value; } } }));
vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic { beta = { messages: { create: sdk.create } }; }
  return { default: Anthropic };
});

const { deckFor, swipe, matchesFor, openMatchChat, setEnabled, profileOf, cofounderBadge } = await import('@/server/cofounder/service');
const { inbox } = await import('@/server/messaging/service');

const T0 = '2026-01-01T10:00:00.000Z';
const FUTURE = '2030-01-01T00:00:00.000Z';
const DAY1 = new Date('2026-10-23T10:00:00Z');
const DAY2 = new Date('2026-10-24T10:00:00Z');
const messaging = createMemoryRepo();
const cofounder = createMemoryCofounderRepo();

function user(id: string, role = 'ENTREPRENEUR', extra: Record<string, unknown> = {}) {
  return {
    id, email: `${id}@x.dz`, fullName: `Prénom${id} Nom${id}`, phone: '+213550000001', city: 'algiers', role, status: 'ACTIVE',
    passwordHash: 'x', phoneVerified: true, emailVerified: true, membershipCode: null, membershipTier: 'EXPLORER',
    avatarUrl: null, locale: 'fr', createdAt: T0, updatedAt: T0, ...extra,
  } as never;
}

function cof(userId: string, brings: string[], lookingFor: string[], extra: Record<string, unknown> = {}) {
  return {
    userId, enabled: true, brings, lookingFor, commitment: 'FULL_TIME', sectors: ['AGRITECH'],
    pitch: 'Je construis une plateforme qui relie les agriculteurs aux restaurants, depuis Alger.',
    remoteOk: true, values: { pace: 4, risk: 4, decisions: 3, equity: 3, workplace: 2 }, visibleTo: 'EVERYONE',
    createdAt: T0, updatedAt: T0, ...extra,
  } as never;
}

const FOUNDER = { membershipCode: 'STARTUP', membershipTier: 'FOUNDER', membershipExpiresAt: FUTURE };

beforeEach(async () => {
  messaging.reset();
  cofounder.reset();
  setMessagingRepoForTests(messaging);
  setCofounderRepoForTests(cofounder);
  sdk.create.mockReset();
  sdk.key.value = undefined;
  await db.update((d) => {
    d.users = [
      user('biz'), user('tech'), user('tech2'), user('design'), user('off'), user('nophone', 'ENTREPRENEUR', { phoneVerified: false }),
      user('fl', 'FREELANCER'), user('private'), user('gold', 'ENTREPRENEUR', FOUNDER),
    ];
    d.cofounderProfiles = [
      cof('biz', ['BUSINESS'], ['TECH']),
      cof('tech', ['TECH'], ['BUSINESS']),
      cof('tech2', ['TECH'], ['BUSINESS'], { values: { pace: 1, risk: 1, decisions: 1, equity: 1, workplace: 5 }, commitment: 'EVENINGS' }),
      cof('design', ['DESIGN'], ['DESIGN']),
      cof('off', ['TECH'], ['BUSINESS'], { enabled: false }),
      cof('nophone', ['TECH'], ['BUSINESS']),
      cof('fl', ['TECH'], ['BUSINESS']),
      cof('private', ['TECH'], ['BUSINESS'], { visibleTo: 'ENTREPRENEURS' }),
      cof('gold', ['TECH'], ['BUSINESS']),
    ];
    d.cofounderDecks = [];
    d.notifications = [];
    d.ventures = [];
  });
});

describe('profile and visibility', () => {
  it('is on by default for entrepreneurs, off for freelancers', async () => {
    const d = await db.read();
    expect(profileOf(d, { id: 'new-en', role: 'ENTREPRENEUR' }).enabled).toBe(true);
    expect(profileOf(d, { id: 'new-fl', role: 'FREELANCER' }).enabled).toBe(false);
  });

  it('ranks complementary profiles first and filters unsafe or hidden ones', async () => {
    const deck = await deckFor('biz', DAY1);
    expect(deck).toMatchObject({ state: 'READY', perDay: 3 });
    const ids = deck.cards.map((c) => c.id);
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain('off');
    expect(ids).not.toContain('nophone');
    expect(ids).not.toContain('design');
    // No names before a match: first name + initial only.
    expect(deck.cards[0]!.displayName).toMatch(/^Prénom\w+ N\.$/);
    expect(JSON.stringify(deck)).not.toContain('@x.dz');
  });

  it('honours "founders only" and blocks', async () => {
    const asFreelancer = await deckFor('fl', DAY1);
    expect(asFreelancer.state).toBe('READY');
    expect(asFreelancer.cards.map((c) => c.id)).not.toContain('private');
    await messaging.block('tech', 'biz');
    await db.update((d) => { d.cofounderDecks = []; });
    expect((await deckFor('biz', DAY1)).cards.map((c) => c.id)).not.toContain('tech');
  });

  it('switching off leaves every deck', async () => {
    await setEnabled('tech', false);
    expect((await deckFor('biz', DAY1)).cards.map((c) => c.id)).not.toContain('tech');
    expect((await deckFor('tech', DAY1)).state).toBe('DISABLED');
  });

  it('scores values and commitment, not just roles', () => {
    const base = { brings: ['BUSINESS'], lookingFor: ['TECH'], commitment: 'FULL_TIME', sectors: [], remoteOk: true, city: 'algiers', values: { pace: 4, risk: 4 } };
    const close = { ...base, brings: ['TECH'], lookingFor: ['BUSINESS'] };
    const far = { ...close, commitment: 'EVENINGS', values: { pace: 1, risk: 1 } };
    expect(matchScore(base, close)).toBeGreaterThan(matchScore(base, far));
  });
});

describe('likes and matches', () => {
  it('announces every like without a name, and swipes only today\'s cards', async () => {
    const deck = await deckFor('biz', DAY1);
    const target = deck.cards[0]!.id;
    expect(await swipe('biz', 'design', 'LIKE', DAY1)).toEqual({ ok: false, reason: 'NOT_IN_DECK' });
    expect(await swipe('biz', target, 'LIKE', DAY1)).toEqual({ ok: true, match: null });
    const notes = (await db.read()).notifications.filter((n) => n.userId === target);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe('Quelqu’un a aimé votre profil');
    expect(JSON.stringify(notes[0])).not.toContain('Prénombiz');
    expect((await deckFor(target, DAY1)).likesWaiting).toBe(1);
    expect(await cofounderBadge(target, '')).toBe(1);
    // A second swipe on the same card changes nothing: no second notice.
    expect(await swipe('biz', target, 'LIKE', DAY1)).toEqual({ ok: true, match: null });
    expect((await db.read()).notifications.filter((n) => n.userId === target)).toHaveLength(1);
  });

  it('reveals names on a mutual like; Free/Free must upgrade to chat', async () => {
    await deckFor('biz', DAY1);
    await swipe('biz', 'tech', 'LIKE', DAY1);
    const techDeck = await deckFor('tech', DAY1);
    expect(techDeck.cards.map((c) => c.id)).toContain('biz');
    const r = await swipe('tech', 'biz', 'LIKE', DAY1);
    expect(r.ok && r.match).toMatchObject({ other: { id: 'biz', fullName: 'Prénombiz Nombiz' }, chatAllowed: false, conversationId: null });
    const [m] = await matchesFor('biz');
    expect(m!.other.fullName).toBe('Prénomtech Nomtech');
    expect(await openMatchChat('biz', m!.id)).toEqual({ ok: false, reason: 'UPGRADE_REQUIRED' });
    expect(await openMatchChat('design', m!.id)).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('opens the chat at once when one side is paid', async () => {
    for (const id of ['tech', 'tech2', 'fl', 'private']) await setEnabled(id, false);
    const goldDeck = await deckFor('gold', DAY1);
    expect(goldDeck.perDay).toBe(30);
    await swipe('gold', 'biz', 'LIKE', DAY1);
    await deckFor('biz', DAY1);
    const r = await swipe('biz', 'gold', 'LIKE', DAY1);
    expect(r.ok && r.match?.chatAllowed).toBe(true);
    expect(r.ok && r.match?.conversationId).toBeTruthy();
    expect((await inbox('biz'))[0]!.context.type).toBe('COFOUNDER_MATCH');
  });

  it('still enforces the allowance when this instance has not seen today\'s deck yet', async () => {
    const deck = await deckFor('biz', DAY1);
    // Simulate a stale snapshot: the deck is not in the store this instance reads.
    await db.update((d) => { d.cofounderDecks = []; });
    for (const c of deck.cards) expect((await swipe('biz', c.id, 'PASS', DAY1)).ok).toBe(true);
    // 3 swipes done today on the Free plan: the next one is refused.
    expect(await swipe('biz', 'gold', 'LIKE', DAY1)).toEqual({ ok: false, reason: 'NOT_IN_DECK' });
    expect(await swipe('biz', 'off', 'LIKE', DAY1)).toEqual({ ok: false, reason: 'NOT_IN_DECK' });
  });

  it('builds a new deck each day without already swiped people', async () => {
    const day1 = await deckFor('biz', DAY1);
    for (const c of day1.cards) await swipe('biz', c.id, 'PASS', DAY1);
    expect((await deckFor('biz', DAY1)).cards).toEqual([]);
    const day2 = await deckFor('biz', DAY2);
    expect(day2.cards.some((c) => day1.cards.some((x) => x.id === c.id))).toBe(false);
  });
});

describe('AI rerank', () => {
  it('reorders only the candidates it was given and keeps their why lines', async () => {
    sdk.key.value = 'test-key';
    sdk.create.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ items: [{ id: 'c3', reasons: ['Vous cherchez un profil tech', 'Même rythme'] }, { id: 'evil', reasons: ['x'] }] }) }],
    });
    const deck = await deckFor('biz', DAY1);
    const prompt = JSON.stringify(sdk.create.mock.calls[0]![0]);
    expect(prompt).not.toContain('Prénom');
    expect(prompt).not.toContain('@x.dz');
    expect(deck.cards[0]!.reasons).toEqual(['Vous cherchez un profil tech', 'Même rythme']);
    expect(deck.cards.map((c) => c.id)).not.toContain('evil');
  });
});
