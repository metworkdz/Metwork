/**
 * "Find my cofounder" — THE service (Metwork 2.0 phase 8). Locked rules:
 *
 *   - Entrepreneurs are in matching by default, with an on/off switch;
 *     freelancers opt in. Off = out of every deck at once, no more likes.
 *   - Every like tells its target "someone liked you" — never who. A name is
 *     revealed only on a mutual match.
 *   - Cards per day come from the plan (Free 3, paid 30). You swipe only the
 *     cards of today's deck, so the limit and the deck are the same thing.
 *   - Chat opens on a match when at least one of the two is on a paid plan
 *     (the upgrade moment for a Free/Free match).
 *   - Safety: verified phone required to appear, blocks honoured both ways,
 *     no contact details before a match, "visible to" control.
 *
 * Ranking is code (`lib/cofounder.matchScore`); the AI only reorders the
 * best candidates and writes the "why you match" lines, once per day.
 */
import { db, type CofounderProfileRecord, type UserRecord } from '@/server/db/store';
import { entitlementsForUser, hasPaidPlanForAudience } from '@/lib/entitlements';
import { memberBadgeFor, type MemberBadge } from '@/lib/member-badge';
import { findCityCode } from '@/config/cities';
import { algiersDay, isComplete, matchScore, type MatchProfile } from '@/lib/cofounder';
import { ventureOf } from '@/server/ventures/service';
import { cofounderRepo, type CofounderMatch } from '@/server/cofounder/repo';
import { messagingRepo } from '@/server/messaging/repo';
import { createNotification } from '@/server/notifications/create-notification';
import { rerankDeck } from '@/server/cofounder/ai';

type Store = Awaited<ReturnType<typeof db.read>>;

/* ─────────────────────────── Profile ─────────────────────────── */

export function canUseCofounder(user: Pick<UserRecord, 'role' | 'status'> | null | undefined): boolean {
  return Boolean(user && user.status === 'ACTIVE' && (user.role === 'ENTREPRENEUR' || user.role === 'FREELANCER'));
}

/** The stored profile, or the default one (on for entrepreneurs, off for freelancers). */
export function profileOf(data: Store, user: Pick<UserRecord, 'id' | 'role'>): CofounderProfileRecord {
  const p = (data.cofounderProfiles ?? []).find((x) => x.userId === user.id);
  if (p) return p;
  const now = new Date(0).toISOString();
  return {
    userId: user.id,
    enabled: user.role === 'ENTREPRENEUR',
    brings: [],
    lookingFor: [],
    commitment: null,
    sectors: [],
    pitch: '',
    remoteOk: true,
    values: {},
    visibleTo: 'EVERYONE',
    createdAt: now,
    updatedAt: now,
  };
}

export type ProfileInput = Omit<CofounderProfileRecord, 'userId' | 'createdAt' | 'updatedAt'>;

export async function saveProfile(userId: string, input: ProfileInput): Promise<CofounderProfileRecord | null> {
  const data = await db.read();
  const user = data.users.find((u) => u.id === userId);
  if (!canUseCofounder(user)) return null;
  const now = new Date().toISOString();
  return db.update((d) => {
    const list = (d.cofounderProfiles ??= []);
    let p = list.find((x) => x.userId === userId);
    if (!p) {
      p = { ...profileOf(d, user!), createdAt: now };
      list.push(p);
    }
    Object.assign(p, input, { updatedAt: now });
    // A profile change may change who belongs in today's deck: rebuild it.
    d.cofounderDecks = (d.cofounderDecks ?? []).filter((x) => x.userId !== userId);
    return { ...p };
  });
}

export async function setEnabled(userId: string, enabled: boolean): Promise<boolean> {
  const data = await db.read();
  const user = data.users.find((u) => u.id === userId);
  if (!canUseCofounder(user)) return false;
  const now = new Date().toISOString();
  await db.update((d) => {
    const list = (d.cofounderProfiles ??= []);
    let p = list.find((x) => x.userId === userId);
    if (!p) { p = { ...profileOf(d, user!), createdAt: now }; list.push(p); }
    p.enabled = enabled;
    p.updatedAt = now;
  });
  return true;
}

/* ─────────────────────────── Cards ─────────────────────────── */

export interface CofounderCard {
  id: string;
  /** First name and last initial — the full name comes with a match. */
  displayName: string;
  avatarUrl: string | null;
  role: string;
  city: string | null;
  badge: MemberBadge | null;
  brings: string[];
  lookingFor: string[];
  commitment: string | null;
  sectors: string[];
  pitch: string;
  remoteOk: boolean;
  venture: { name: string; stage: string; sector: string } | null;
  reasons: string[];
}

function displayName(fullName: string): string {
  const [first, ...rest] = fullName.trim().split(/\s+/);
  const last = rest[rest.length - 1];
  return last ? `${first} ${last[0]!.toUpperCase()}.` : first ?? '—';
}

function matchProfileOf(data: Store, u: UserRecord): MatchProfile {
  const p = profileOf(data, u);
  return { brings: p.brings, lookingFor: p.lookingFor, commitment: p.commitment, sectors: p.sectors, remoteOk: p.remoteOk, values: p.values, city: findCityCode(u.city) };
}

function card(data: Store, u: UserRecord, reasons: string[]): CofounderCard {
  const p = profileOf(data, u);
  const v = ventureOf(data, u.id);
  return {
    id: u.id,
    displayName: displayName(u.fullName),
    avatarUrl: u.avatarUrl ?? null,
    role: u.role,
    city: findCityCode(u.city),
    badge: memberBadgeFor(u),
    brings: p.brings,
    lookingFor: p.lookingFor,
    commitment: p.commitment,
    sectors: p.sectors,
    pitch: p.pitch,
    remoteOk: p.remoteOk,
    venture: v ? { name: v.name, stage: v.stage, sector: v.sector } : null,
    reasons,
  };
}

/** Whether `target` may be in `viewer`'s deck (blocks are checked separately). */
function canAppearFor(data: Store, viewer: UserRecord, target: UserRecord): boolean {
  if (target.id === viewer.id || !isVisible(data, target)) return false;
  return !(profileOf(data, target).visibleTo === 'ENTREPRENEURS' && viewer.role !== 'ENTREPRENEUR');
}

/** Who may appear in decks at all. */
function isVisible(data: Store, u: UserRecord): boolean {
  if (!canUseCofounder(u) || !u.phoneVerified) return false;
  const p = profileOf(data, u);
  return p.enabled && isComplete(p);
}

export function cardsPerDay(user: UserRecord): number {
  return entitlementsForUser(user)?.cofounderCardsPerDay ?? 0;
}

/* ─────────────────────────── Deck ─────────────────────────── */

export type DeckState = 'READY' | 'NEEDS_PROFILE' | 'DISABLED' | 'PHONE_UNVERIFIED';

export interface DeckView {
  state: DeckState;
  cards: CofounderCard[];
  /** Cards of today's deck already swiped. */
  used: number;
  perDay: number;
  /** People who liked me and whom I haven't answered — a number, never names. */
  likesWaiting: number;
}

/** Today's deck. Built once per Algiers day; swiped cards drop out. */
export async function deckFor(userId: string, now = new Date()): Promise<DeckView> {
  const data = await db.read();
  const me = data.users.find((u) => u.id === userId);
  const perDay = me ? cardsPerDay(me) : 0;
  const likesWaiting = me ? await likesWaitingFor(userId) : 0;
  const empty = (state: DeckState): DeckView => ({ state, cards: [], used: 0, perDay, likesWaiting });
  if (!me || !canUseCofounder(me)) return empty('DISABLED');
  const mine = profileOf(data, me);
  if (!mine.enabled) return empty('DISABLED');
  if (!isComplete(mine)) return empty('NEEDS_PROFILE');
  if (!me.phoneVerified) return empty('PHONE_UNVERIFIED');

  const today = algiersDay(now);
  const swiped = await cofounderRepo().swipesBy(userId);
  let deck = (data.cofounderDecks ?? []).find((x) => x.userId === userId && x.date === today);
  if (!deck) {
    const blocked = await messagingRepo().blockedBy(userId);
    const myProfile = matchProfileOf(data, me);
    const scored: { u: UserRecord; score: number }[] = [];
    for (const u of data.users) {
      if (swiped.has(u.id) || blocked.has(u.id) || !canAppearFor(data, me, u)) continue;
      // Blocks are honoured both ways.
      if (await messagingRepo().isBlockedEitherWay(userId, u.id)) continue;
      scored.push({ u, score: matchScore(myProfile, matchProfileOf(data, u)) });
    }
    scored.sort((a, b) => b.score - a.score);
    const pool = scored.slice(0, Math.min(30, Math.max(perDay * 3, perDay)));
    const ranked = await rerankDeck(mine, pool.map(({ u }) => ({ id: u.id, profile: profileOf(data, u), city: findCityCode(u.city) })), perDay, me.locale ?? 'fr')
      .catch(() => null);
    const ids = (ranked?.ids ?? pool.map(({ u }) => u.id)).slice(0, perDay);
    deck = { userId, date: today, ids, reasons: ranked?.reasons ?? {} };
    const built = deck;
    await db.update((d) => {
      d.cofounderDecks = [...(d.cofounderDecks ?? []).filter((x) => x.userId !== userId), built];
    });
  }
  const remaining = deck.ids.filter((id) => !swiped.has(id));
  const cards = remaining
    .map((id) => data.users.find((u) => u.id === id))
    .filter((u): u is UserRecord => Boolean(u && isVisible(data, u)))
    .map((u) => card(data, u, deck!.reasons[u.id] ?? []));
  return { state: 'READY', cards, used: deck.ids.length - remaining.length, perDay, likesWaiting };
}

async function likesWaitingFor(userId: string): Promise<number> {
  const [likers, mine] = await Promise.all([cofounderRepo().likersOf(userId), cofounderRepo().swipesBy(userId)]);
  return likers.filter((l) => !mine.has(l.swiperId)).length;
}

/* ─────────────────────────── Swipe ─────────────────────────── */

const LIKE_TITLE = { fr: 'Quelqu’un a aimé votre profil', en: 'Someone liked your profile', ar: 'أحدهم أعجب بملفك' } as const;
const MATCH_TITLE = { fr: 'C’est un match !', en: 'It’s a match!', ar: 'لديك تطابق!' } as const;
const langOf = (u: UserRecord) => (u.locale === 'ar' || u.locale === 'en' ? u.locale : 'fr');
const pathOf = (u: UserRecord) => `/dashboard/${u.role === 'FREELANCER' ? 'freelancer' : 'entrepreneur'}/cofounder`;

export type SwipeResult =
  | { ok: true; match: MatchView | null }
  | { ok: false; reason: 'NOT_IN_DECK' | 'NOT_ALLOWED' };

export async function swipe(userId: string, targetId: string, decision: 'LIKE' | 'PASS', now = new Date()): Promise<SwipeResult> {
  const data = await db.read();
  const me = data.users.find((u) => u.id === userId);
  if (!me || !canUseCofounder(me) || !profileOf(data, me).enabled) return { ok: false, reason: 'NOT_ALLOWED' };
  const target = data.users.find((u) => u.id === targetId);
  if (!target || targetId === userId || !isVisible(data, target)) return { ok: false, reason: 'NOT_IN_DECK' };
  const repo = cofounderRepo();
  // Today's cards only: that is the daily limit, and no scripted swiping of
  // arbitrary ids. The deck may be missing from this instance's snapshot of
  // the store (another instance just built it — the store caches for a few
  // seconds), so when TODAY'S deck is missing from it, the card is re-checked
  // the slow way: same filters as the deck, and today's swipes (Postgres,
  // always fresh) under the plan's allowance. A deck that is there but does
  // not hold the card is a refusal.
  const deck = (data.cofounderDecks ?? []).find((x) => x.userId === userId && x.date === algiersDay(now));
  if (deck && !deck.ids.includes(targetId)) return { ok: false, reason: 'NOT_IN_DECK' };
  if (!deck) {
    const startOfDay = new Date(`${algiersDay(now)}T00:00:00+01:00`).toISOString();
    const eligible = canAppearFor(data, me, target) && !(await messagingRepo().isBlockedEitherWay(userId, targetId));
    if (!eligible || (await repo.swipesSince(userId, startOfDay)) >= cardsPerDay(me)) return { ok: false, reason: 'NOT_IN_DECK' };
  }

  const fresh = await repo.swipe(userId, targetId, decision);
  if (!fresh || decision === 'PASS') return { ok: true, match: null };

  if (!(await repo.liked(targetId, userId))) {
    // Every like is announced — never who sent it.
    await createNotification({ userId: targetId, type: 'GENERAL', title: LIKE_TITLE[langOf(target)], body: '', href: pathOf(target) });
    return { ok: true, match: null };
  }
  const m = await repo.match(userId, targetId);
  if (chatAllowed(me, target)) await ensureConversation(m);
  await Promise.allSettled([
    createNotification({ userId: targetId, type: 'GENERAL', title: MATCH_TITLE[langOf(target)], body: me.fullName, href: pathOf(target) }),
    createNotification({ userId, type: 'GENERAL', title: MATCH_TITLE[langOf(me)], body: target.fullName, href: pathOf(me) }),
  ]);
  const after = await db.read();
  return { ok: true, match: matchView(after, (await repo.getMatch(m.id))!, userId) };
}

/* ─────────────────────────── Matches ─────────────────────────── */

/** Chat opens when at least one of the two holds a paid plan. */
export function chatAllowed(a: UserRecord, b: UserRecord): boolean {
  return hasPaidPlanForAudience(a) || hasPaidPlanForAudience(b);
}

async function ensureConversation(m: CofounderMatch): Promise<string> {
  if (m.conversationId) return m.conversationId;
  const conv = await messagingRepo().createConversation({
    contextType: 'COFOUNDER_MATCH',
    contextId: m.id,
    createdBy: m.userA,
    userIds: [m.userA, m.userB],
  });
  await cofounderRepo().setConversation(m.id, conv.id);
  return conv.id;
}

export interface MatchView {
  id: string;
  other: { id: string; fullName: string; avatarUrl: string | null; role: string; city: string | null; badge: MemberBadge | null; pitch: string; brings: string[] };
  chatAllowed: boolean;
  conversationId: string | null;
  createdAt: string;
}

function matchView(data: Store, m: CofounderMatch, viewerId: string): MatchView | null {
  const otherId = m.userA === viewerId ? m.userB : m.userB === viewerId ? m.userA : null;
  const me = data.users.find((u) => u.id === viewerId);
  const other = otherId ? data.users.find((u) => u.id === otherId) : undefined;
  if (!me || !other) return null;
  const p = profileOf(data, other);
  return {
    id: m.id,
    other: { id: other.id, fullName: other.fullName, avatarUrl: other.avatarUrl ?? null, role: other.role, city: findCityCode(other.city), badge: memberBadgeFor(other), pitch: p.pitch, brings: p.brings },
    chatAllowed: chatAllowed(me, other),
    conversationId: m.conversationId,
    createdAt: m.createdAt,
  };
}

export async function matchesFor(userId: string): Promise<MatchView[]> {
  const [data, matches] = await Promise.all([db.read(), cofounderRepo().matchesFor(userId)]);
  return matches
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((m) => matchView(data, m, userId))
    .filter((v): v is MatchView => v !== null);
}

/** Open the chat of a match (after an upgrade, for a match made Free/Free). */
export async function openMatchChat(userId: string, matchId: string): Promise<{ ok: true; conversationId: string } | { ok: false; reason: 'NOT_FOUND' | 'UPGRADE_REQUIRED' }> {
  const m = await cofounderRepo().getMatch(matchId);
  if (!m || (m.userA !== userId && m.userB !== userId)) return { ok: false, reason: 'NOT_FOUND' };
  const data = await db.read();
  const me = data.users.find((u) => u.id === userId);
  const other = data.users.find((u) => u.id === (m.userA === userId ? m.userB : m.userA));
  if (!me || !other) return { ok: false, reason: 'NOT_FOUND' };
  if (!m.conversationId && !chatAllowed(me, other)) return { ok: false, reason: 'UPGRADE_REQUIRED' };
  return { ok: true, conversationId: await ensureConversation(m) };
}

/** Badge: likes waiting plus matches since the member last opened the tab. */
export async function cofounderBadge(userId: string, seen: string): Promise<number> {
  const [likers, mine, matches] = await Promise.all([
    cofounderRepo().likersOf(userId),
    cofounderRepo().swipesBy(userId),
    cofounderRepo().matchesFor(userId),
  ]);
  return likers.filter((l) => !mine.has(l.swiperId) && l.createdAt > seen).length + matches.filter((m) => m.createdAt > seen).length;
}
