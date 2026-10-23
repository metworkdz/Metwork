/**
 * Cofounder swipes and matches. Like chat, these are many small writes, so
 * they live in the Postgres tables `cofounder_swipes` / `cofounder_matches`
 * (service-role only, RLS on, no policies) — not in the JSONB store.
 *
 * Same shape as `messaging/repo`: one interface, a Supabase backend for
 * production and a memory backend (file-persisted under USE_LOCAL_DB, re-read
 * before every operation for the same reason) for dev and tests.
 */
import { randomUUID } from 'node:crypto';
import type * as NodeFs from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type SwipeDecision = 'LIKE' | 'PASS';

export interface CofounderMatch {
  id: string;
  /** Ordered pair: userA < userB. */
  userA: string;
  userB: string;
  conversationId: string | null;
  createdAt: string;
}

export interface CofounderRepo {
  /** Record a swipe. First decision wins: a swipe is never changed. Returns false if it already existed. */
  swipe(swiperId: string, targetId: string, decision: SwipeDecision): Promise<boolean>;
  /** Everyone this user has swiped, with the decision. */
  swipesBy(swiperId: string): Promise<Map<string, SwipeDecision>>;
  /** Swipes made since `since` (for the daily limit). */
  swipesSince(swiperId: string, since: string): Promise<number>;
  /** Did `a` like `b`? */
  liked(a: string, b: string): Promise<boolean>;
  /** Who liked this user — server-side only, never sent to the client before a match. */
  likersOf(targetId: string): Promise<{ swiperId: string; createdAt: string }[]>;
  /** Create the match for a pair (idempotent); returns it. */
  match(a: string, b: string): Promise<CofounderMatch>;
  matchesFor(userId: string): Promise<CofounderMatch[]>;
  getMatch(id: string): Promise<CofounderMatch | null>;
  setConversation(matchId: string, conversationId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

export class CofounderUnavailableError extends Error {}

const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

/* ─────────────────────────── Memory backend ─────────────────────────── */

interface MemoryState {
  swipes: { swiperId: string; targetId: string; decision: SwipeDecision; createdAt: string }[];
  matches: CofounderMatch[];
}

export function createMemoryCofounderRepo(persistPath?: string): CofounderRepo & { reset(): void } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- dev-only file backend
  const fs = persistPath ? (require('node:fs') as typeof NodeFs) : null;
  let s: MemoryState = { swipes: [], matches: [] };
  const load = () => {
    if (!fs || !persistPath || !fs.existsSync(persistPath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(persistPath, 'utf8')) as Partial<MemoryState>;
      s = { swipes: parsed.swipes ?? [], matches: parsed.matches ?? [] };
    } catch { /* keep */ }
  };
  const save = () => { if (fs && persistPath) fs.writeFileSync(persistPath, JSON.stringify(s), 'utf8'); };
  const now = () => new Date().toISOString();
  return {
    reset() { s = { swipes: [], matches: [] }; save(); },
    async swipe(swiperId, targetId, decision) {
      load();
      if (s.swipes.some((x) => x.swiperId === swiperId && x.targetId === targetId)) return false;
      s.swipes.push({ swiperId, targetId, decision, createdAt: now() });
      save();
      return true;
    },
    async swipesBy(swiperId) {
      load();
      return new Map(s.swipes.filter((x) => x.swiperId === swiperId).map((x) => [x.targetId, x.decision]));
    },
    async swipesSince(swiperId, since) {
      load();
      return s.swipes.filter((x) => x.swiperId === swiperId && x.createdAt >= since).length;
    },
    async liked(a, b) {
      load();
      return s.swipes.some((x) => x.swiperId === a && x.targetId === b && x.decision === 'LIKE');
    },
    async likersOf(targetId) {
      load();
      return s.swipes.filter((x) => x.targetId === targetId && x.decision === 'LIKE').map(({ swiperId, createdAt }) => ({ swiperId, createdAt }));
    },
    async match(a, b) {
      load();
      const [userA, userB] = pair(a, b);
      let m = s.matches.find((x) => x.userA === userA && x.userB === userB);
      if (!m) {
        m = { id: randomUUID(), userA, userB, conversationId: null, createdAt: now() };
        s.matches.push(m);
        save();
      }
      return { ...m };
    },
    async matchesFor(userId) {
      load();
      return s.matches.filter((m) => m.userA === userId || m.userB === userId).map((m) => ({ ...m }));
    },
    async getMatch(id) {
      load();
      const m = s.matches.find((x) => x.id === id);
      return m ? { ...m } : null;
    },
    async setConversation(matchId, conversationId) {
      load();
      const m = s.matches.find((x) => x.id === matchId);
      if (m) { m.conversationId = conversationId; save(); }
    },
    async deleteUser(userId) {
      load();
      s.swipes = s.swipes.filter((x) => x.swiperId !== userId && x.targetId !== userId);
      s.matches = s.matches.filter((m) => m.userA !== userId && m.userB !== userId);
      save();
    },
  };
}

/* ─────────────────────────── Supabase backend ─────────────────────────── */

type Row = Record<string, unknown>;

function check<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new CofounderUnavailableError(`${res.error.code ?? ''} ${res.error.message}`.trim());
  return res.data as T;
}

function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new CofounderUnavailableError('Invalid id');
  return id;
}

const toMatch = (r: Row): CofounderMatch => ({
  id: r.id as string,
  userA: r.user_a as string,
  userB: r.user_b as string,
  conversationId: (r.conversation_id as string | null) ?? null,
  createdAt: r.created_at as string,
});

export function createSupabaseCofounderRepo(client: SupabaseClient): CofounderRepo {
  return {
    async swipe(swiperId, targetId, decision) {
      const rows = check(await client.from('cofounder_swipes')
        .upsert({ swiper_id: swiperId, target_id: targetId, decision }, { onConflict: 'swiper_id,target_id', ignoreDuplicates: true })
        .select('swiper_id')) as Row[];
      return rows.length > 0;
    },
    async swipesBy(swiperId) {
      const rows = check(await client.from('cofounder_swipes').select('target_id, decision').eq('swiper_id', swiperId)) as Row[];
      return new Map(rows.map((r) => [r.target_id as string, r.decision as SwipeDecision]));
    },
    async swipesSince(swiperId, since) {
      const res = await client.from('cofounder_swipes').select('swiper_id', { count: 'exact', head: true }).eq('swiper_id', swiperId).gte('created_at', since);
      if (res.error) throw new CofounderUnavailableError(res.error.message);
      return res.count ?? 0;
    },
    async liked(a, b) {
      const rows = check(await client.from('cofounder_swipes').select('decision').eq('swiper_id', a).eq('target_id', b).eq('decision', 'LIKE')) as Row[];
      return rows.length > 0;
    },
    async likersOf(targetId) {
      const rows = check(await client.from('cofounder_swipes').select('swiper_id, created_at').eq('target_id', targetId).eq('decision', 'LIKE')) as Row[];
      return rows.map((r) => ({ swiperId: r.swiper_id as string, createdAt: r.created_at as string }));
    },
    async match(a, b) {
      const [userA, userB] = pair(a, b);
      check(await client.from('cofounder_matches').upsert({ user_a: userA, user_b: userB }, { onConflict: 'user_a,user_b', ignoreDuplicates: true }));
      const rows = check(await client.from('cofounder_matches').select('*').eq('user_a', userA).eq('user_b', userB)) as Row[];
      return toMatch(rows[0]!);
    },
    async matchesFor(userId) {
      const rows = check(await client.from('cofounder_matches').select('*').or(`user_a.eq.${safeId(userId)},user_b.eq.${safeId(userId)}`)) as Row[];
      return rows.map(toMatch);
    },
    async getMatch(id) {
      const rows = check(await client.from('cofounder_matches').select('*').eq('id', id)) as Row[];
      return rows[0] ? toMatch(rows[0]) : null;
    },
    async setConversation(matchId, conversationId) {
      check(await client.from('cofounder_matches').update({ conversation_id: conversationId }).eq('id', matchId));
    },
    async deleteUser(userId) {
      check(await client.from('cofounder_swipes').delete().or(`swiper_id.eq.${safeId(userId)},target_id.eq.${safeId(userId)}`));
      check(await client.from('cofounder_matches').delete().or(`user_a.eq.${safeId(userId)},user_b.eq.${safeId(userId)}`));
    },
  };
}

/* ─────────────────────────── Selection ─────────────────────────── */

let repo: CofounderRepo | null = null;

export function cofounderRepo(): CofounderRepo {
  if (repo) return repo;
  if (process.env.NODE_ENV === 'test') repo = createMemoryCofounderRepo();
  else if (process.env.USE_LOCAL_DB === 'true') repo = createMemoryCofounderRepo(process.env.LOCAL_COFOUNDER_PATH ?? '.local-cofounder.json');
  else {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new CofounderUnavailableError('Supabase is not configured');
    repo = createSupabaseCofounderRepo(createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    }));
  }
  return repo;
}

/** Tests only. */
export function setCofounderRepoForTests(r: CofounderRepo | null): void {
  repo = r;
}
