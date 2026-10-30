/**
 * Academy progress and watch-time storage. Many small writes (a heartbeat
 * every 30 s per viewer), so NOT the JSONB store: the Postgres tables of
 * `supabase/migrations/20261026000000_academy_foundation.sql`, reached with the
 * service-role key only.
 *
 * One interface, two backends (same pattern as `server/messaging/repo.ts`):
 *   - Supabase (production);
 *   - memory, persisted to `.local-academy.json` under USE_LOCAL_DB=true,
 *     purely in memory under tests.
 */
import { randomUUID } from 'node:crypto';
import type * as NodeFs from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { creditableWatchSeconds, watchCaps } from '@/lib/academy';

export type WatchAccess = 'PASS' | 'OWNED' | 'PREVIEW';

export interface LessonProgress {
  userId: string;
  lessonId: string;
  courseId: string;
  positionSec: number;
  completedAt: string | null;
  updatedAt: string;
}

export interface WatchTotal {
  userId: string;
  mentorId: string;
  seconds: number;
}

export interface AddWatchInput {
  userId: string;
  lessonId: string;
  courseId: string;
  /** Lead mentor of the course when the time is counted. */
  mentorId: string;
  access: WatchAccess;
  /** Algiers calendar day, YYYY-MM-DD. */
  day: string;
  /** Wall-clock seconds since the viewer's previous heartbeat. */
  elapsedSec: number;
  lessonDurationSec: number;
}

export interface AcademyRepo {
  progressFor(userId: string, courseId: string): Promise<LessonProgress[]>;
  /** Save the resume point; `completed` marks the lesson done (it stays done). */
  saveProgress(input: { userId: string; courseId: string; lessonId: string; positionSec: number; completed?: boolean }): Promise<void>;
  /** Count watch time within the per-heartbeat and per-day caps. */
  addWatch(input: AddWatchInput): Promise<{ credited: number; totalToday: number }>;
  /** Seconds per user and mentor between two days (inclusive). */
  watchTotals(from: string, to: string, access: WatchAccess): Promise<WatchTotal[]>;
  /** Everything this user watched of one course, all days (refund rule). */
  courseWatchSeconds(userId: string, courseId: string): Promise<number>;
  /**
   * Open a stream for the user, replacing any other: one stream per account.
   * Returns the new stream id.
   */
  startStream(userId: string, input: { courseId: string; lessonId: string }): Promise<string>;
  /**
   * A heartbeat from a stream. `elapsedSec` is measured on the server since the
   * stream's previous heartbeat (the browser never says how long it watched).
   * `TAKEN` = another device opened a stream since.
   */
  touchStream(userId: string, streamId: string): Promise<{ ok: true; elapsedSec: number } | { ok: false; reason: 'TAKEN' }>;
  /** Erase a user's rows (account deletion). */
  deleteUser(userId: string): Promise<void>;
}

export class AcademyStorageUnavailableError extends Error {}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDay(day: string): string {
  if (!DAY_RE.test(day)) throw new AcademyStorageUnavailableError('Invalid day');
  return day;
}

/* ─────────────────────────── Memory backend ─────────────────────────── */

interface LedgerRow {
  userId: string; lessonId: string; day: string; courseId: string; mentorId: string; access: WatchAccess; seconds: number;
}
interface StreamRow { userId: string; streamId: string; courseId: string; lessonId: string; lastSeenAt: string }
interface MemoryState { progress: LessonProgress[]; ledger: LedgerRow[]; streams: StreamRow[] }
const emptyState = (): MemoryState => ({ progress: [], ledger: [], streams: [] });

export function createMemoryAcademyRepo(persistPath?: string): AcademyRepo & { reset(): void } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- dev-only file backend, kept out of client bundles
  const fs = persistPath ? (require('node:fs') as typeof NodeFs) : null;
  let s: MemoryState = emptyState();
  // Re-read before every operation: in dev each route bundle has its own copy of this module.
  const load = () => {
    if (!fs || !persistPath || !fs.existsSync(persistPath)) return;
    try { s = { ...emptyState(), ...(JSON.parse(fs.readFileSync(persistPath, 'utf8')) as MemoryState) }; } catch { /* keep current */ }
  };
  const save = () => { if (fs && persistPath) fs.writeFileSync(persistPath, JSON.stringify(s), 'utf8'); };

  return {
    reset() { s = emptyState(); save(); },
    async progressFor(userId, courseId) {
      load();
      return s.progress.filter((p) => p.userId === userId && p.courseId === courseId).map((p) => ({ ...p }));
    },
    async saveProgress({ userId, courseId, lessonId, positionSec, completed }) {
      load();
      const at = new Date().toISOString();
      let row = s.progress.find((p) => p.userId === userId && p.lessonId === lessonId);
      if (!row) {
        row = { userId, lessonId, courseId, positionSec: 0, completedAt: null, updatedAt: at };
        s.progress.push(row);
      }
      row.positionSec = Math.max(0, Math.floor(positionSec));
      if (completed && !row.completedAt) row.completedAt = at;
      row.updatedAt = at;
      save();
    },
    async addWatch(input) {
      load();
      const day = assertDay(input.day);
      let row = s.ledger.find((r) => r.userId === input.userId && r.lessonId === input.lessonId && r.day === day);
      if (!row) {
        row = { userId: input.userId, lessonId: input.lessonId, day, courseId: input.courseId, mentorId: input.mentorId, access: input.access, seconds: 0 };
        s.ledger.push(row);
      }
      const credited = creditableWatchSeconds({ elapsedSec: input.elapsedSec, alreadyTodaySec: row.seconds, lessonDurationSec: input.lessonDurationSec });
      row.seconds += credited;
      save();
      return { credited, totalToday: row.seconds };
    },
    async watchTotals(from, to, access) {
      load();
      assertDay(from); assertDay(to);
      const totals = new Map<string, WatchTotal>();
      for (const r of s.ledger) {
        if (r.access !== access || r.day < from || r.day > to) continue;
        const k = `${r.userId}\u0000${r.mentorId}`;
        const t = totals.get(k) ?? { userId: r.userId, mentorId: r.mentorId, seconds: 0 };
        t.seconds += r.seconds;
        totals.set(k, t);
      }
      return [...totals.values()];
    },
    async courseWatchSeconds(userId, courseId) {
      load();
      return s.ledger.filter((r) => r.userId === userId && r.courseId === courseId).reduce((n, r) => n + r.seconds, 0);
    },
    async startStream(userId, { courseId, lessonId }) {
      load();
      const streamId = randomUUID();
      s.streams = s.streams.filter((x) => x.userId !== userId);
      s.streams.push({ userId, streamId, courseId, lessonId, lastSeenAt: new Date().toISOString() });
      save();
      return streamId;
    },
    async touchStream(userId, streamId) {
      load();
      const row = s.streams.find((x) => x.userId === userId);
      if (!row || row.streamId !== streamId) return { ok: false, reason: 'TAKEN' };
      const now = Date.now();
      const elapsedSec = Math.max(0, Math.floor((now - new Date(row.lastSeenAt).getTime()) / 1000));
      row.lastSeenAt = new Date(now).toISOString();
      save();
      return { ok: true, elapsedSec };
    },
    async deleteUser(userId) {
      load();
      s.progress = s.progress.filter((p) => p.userId !== userId);
      s.ledger = s.ledger.filter((r) => r.userId !== userId);
      s.streams = s.streams.filter((r) => r.userId !== userId);
      save();
    },
  };
}

/* ─────────────────────────── Supabase backend ─────────────────────────── */

type Row = Record<string, unknown>;

function check<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  // 42P01 = undefined table: the migration was not applied.
  if (res.error) throw new AcademyStorageUnavailableError(`${res.error.code ?? ''} ${res.error.message}`.trim());
  return res.data as T;
}

const toProgress = (r: Row): LessonProgress => ({
  userId: r.user_id as string,
  lessonId: r.lesson_id as string,
  courseId: r.course_id as string,
  positionSec: Number(r.position_sec ?? 0),
  completedAt: (r.completed_at as string | null) ?? null,
  updatedAt: r.updated_at as string,
});

export function createSupabaseAcademyRepo(client: SupabaseClient): AcademyRepo {
  return {
    async progressFor(userId, courseId) {
      return (check(await client.from('academy_progress').select('*').eq('user_id', userId).eq('course_id', courseId)) as Row[]).map(toProgress);
    },
    async saveProgress({ userId, courseId, lessonId, positionSec, completed }) {
      const row: Row = {
        user_id: userId, lesson_id: lessonId, course_id: courseId,
        position_sec: Math.max(0, Math.floor(positionSec)), updated_at: new Date().toISOString(),
      };
      // Omitted columns keep their value on conflict, so completion is never undone.
      if (completed) row.completed_at = new Date().toISOString();
      check(await client.from('academy_progress').upsert(row, { onConflict: 'user_id,lesson_id' }));
    },
    async addWatch(input) {
      const { add, dailyCap } = watchCaps(input.elapsedSec, input.lessonDurationSec);
      const rows = check(await client.rpc('academy_add_watch', {
        p_user_id: input.userId, p_lesson_id: input.lessonId, p_course_id: input.courseId, p_mentor_id: input.mentorId,
        p_access: input.access, p_day: assertDay(input.day), p_add: add, p_daily_cap: dailyCap,
      })) as Row[];
      const r = rows[0] ?? {};
      return { credited: Number(r.credited ?? 0), totalToday: Number(r.total ?? 0) };
    },
    async watchTotals(from, to, access) {
      const rows = check(await client.rpc('academy_watch_totals', { p_from: assertDay(from), p_to: assertDay(to), p_access: access })) as Row[];
      return rows.map((r) => ({ userId: r.user_id as string, mentorId: r.mentor_id as string, seconds: Number(r.seconds ?? 0) }));
    },
    async courseWatchSeconds(userId, courseId) {
      const rows = check(await client.from('academy_watch_ledger').select('seconds').eq('user_id', userId).eq('course_id', courseId)) as Row[];
      return rows.reduce((n, r) => n + Number(r.seconds ?? 0), 0);
    },
    async startStream(userId, { courseId, lessonId }) {
      const streamId = randomUUID();
      check(await client.from('academy_streams').upsert(
        { user_id: userId, stream_id: streamId, course_id: courseId, lesson_id: lessonId, last_seen_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      ));
      return streamId;
    },
    async touchStream(userId, streamId) {
      const rows = check(await client.rpc('academy_touch_stream', { p_user_id: userId, p_stream_id: streamId })) as Row[];
      const r = rows[0];
      if (!r || r.elapsed_sec === null || r.elapsed_sec === undefined) return { ok: false, reason: 'TAKEN' };
      return { ok: true, elapsedSec: Math.max(0, Number(r.elapsed_sec)) };
    },
    async deleteUser(userId) {
      check(await client.from('academy_progress').delete().eq('user_id', userId));
      check(await client.from('academy_watch_ledger').delete().eq('user_id', userId));
      check(await client.from('academy_streams').delete().eq('user_id', userId));
    },
  };
}

/* ─────────────────────────── Selection ─────────────────────────── */

let repo: AcademyRepo | null = null;

export function academyRepo(): AcademyRepo {
  if (repo) return repo;
  if (process.env.NODE_ENV === 'test') repo = createMemoryAcademyRepo();
  else if (process.env.USE_LOCAL_DB === 'true') repo = createMemoryAcademyRepo(process.env.LOCAL_ACADEMY_PATH ?? '.local-academy.json');
  else {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new AcademyStorageUnavailableError('Supabase is not configured');
    repo = createSupabaseAcademyRepo(createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    }));
  }
  return repo;
}

/** Tests only. */
export function setAcademyRepoForTests(r: AcademyRepo | null): void {
  repo = r;
}
