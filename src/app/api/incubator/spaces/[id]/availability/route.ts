/**
 * Owner-side availability WRITE surface for a single space.
 *
 *   GET    → { unavailableDates, blackouts }   — raw current block config.
 *   PUT    → replace the full block set (legacy; used by the test fixture).
 *   POST   → block one/many full-day dates and/or time ranges (additive, idempotent).
 *   DELETE → unblock one/many full-day dates and/or time ranges (idempotent).
 *
 * The CALENDAR READ path lives elsewhere: every availability *view* (public
 * booking picker AND the owner block editor) reads the single canonical endpoint
 * `GET /api/spaces/:id/availability?from&to`, which aggregates bookings + blocks
 * via the SAME helpers the booking write gate uses. This route only mutates the
 * `unavailableDates` / `blackouts` fields that endpoint (and `checkSpaceAvailability`)
 * consult — there is no parallel block store.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { db, type SpaceRecord } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const putSchema = z.object({
  /** Array of YYYY-MM-DD date strings to block full-day. Empty array clears all. */
  unavailableDates: z.array(
    z.string().regex(DATE_RE, 'Each date must be YYYY-MM-DD'),
  ).max(365),
  /**
   * Optional time-range blackouts. When `from`/`to` are present only that range
   * on `date` is blocked; otherwise the whole day. Omit the field to leave
   * existing blackouts untouched; send [] to clear them.
   */
  blackouts: z.array(z.object({
    date: z.string().regex(DATE_RE, 'date must be YYYY-MM-DD'),
    from: z.string().regex(TIME_RE).optional(),
    to:   z.string().regex(TIME_RE).optional(),
  })).max(365).optional(),
});

/**
 * Additive block / unblock body for POST and DELETE. Either or both of `dates`
 * (full-day) and `ranges` (time-range) may be supplied; at least one entry total.
 * Both verbs are idempotent — see the handlers.
 */
const blockSchema = z.object({
  dates: z.array(z.string().regex(DATE_RE, 'date must be YYYY-MM-DD')).max(365).optional(),
  ranges: z.array(z.object({
    date: z.string().regex(DATE_RE, 'date must be YYYY-MM-DD'),
    from: z.string().regex(TIME_RE, 'from must be HH:MM'),
    to:   z.string().regex(TIME_RE, 'to must be HH:MM'),
  })).max(365).optional(),
}).refine((d) => (d.dates?.length ?? 0) + (d.ranges?.length ?? 0) > 0, {
  message: 'Provide at least one date or range',
});

/* ───────────────────────────── helpers ───────────────────────────── */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** "HH:MM" → minutes since midnight. */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(mins: number): string {
  return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}

/** ADMIN manages every space; an incubator manager only their own. */
function userManagesSpace(
  incubators: { id: string; managerId?: string | null }[],
  space: SpaceRecord,
  user: { id: string; role: string },
): boolean {
  if (user.role === 'ADMIN') return true;
  const inc = incubators.find((i) => i.id === space.incubatorId);
  return !!inc && inc.managerId === user.id;
}

/**
 * Normalise a set of time-range blocks: group by date, then merge overlapping or
 * adjacent ranges so blocking an already-blocked (or overlapping) range is a
 * no-op that collapses into one entry. Returns sorted { date, from, to } objects.
 */
function mergeDateRanges(
  ranges: { date: string; from: string; to: string }[],
): { date: string; from: string; to: string }[] {
  const byDate = new Map<string, { from: number; to: number }[]>();
  for (const r of ranges) {
    if (timeToMinutes(r.from) >= timeToMinutes(r.to)) continue; // drop empty/inverted
    const arr = byDate.get(r.date) ?? [];
    arr.push({ from: timeToMinutes(r.from), to: timeToMinutes(r.to) });
    byDate.set(r.date, arr);
  }
  const out: { date: string; from: string; to: string }[] = [];
  for (const [date, arr] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    arr.sort((a, b) => a.from - b.from || a.to - b.to);
    let cur = { ...arr[0]! };
    for (let i = 1; i < arr.length; i++) {
      const nx = arr[i]!;
      if (nx.from <= cur.to) cur.to = Math.max(cur.to, nx.to); // overlap / adjacent
      else { out.push({ date, from: minutesToTime(cur.from), to: minutesToTime(cur.to) }); cur = { ...nx }; }
    }
    out.push({ date, from: minutesToTime(cur.from), to: minutesToTime(cur.to) });
  }
  return out;
}

/* ─────────────────────────────── GET ─────────────────────────────── */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await db.read();
  const space = (data.spaces ?? []).find((s) => s.id === id);
  if (!space) return jsonError(404, 'NOT_FOUND', 'Space not found');
  return json({ unavailableDates: space.unavailableDates ?? [], blackouts: space.blackouts ?? [] });
}

/* ─────────────────────────────── PUT ─────────────────────────────── */

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = putSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await db.update((d) => {
    const space = (d.spaces ?? []).find((s) => s.id === id);
    if (!space) return null;

    // Incubator managers can only manage their own spaces.
    if (!userManagesSpace(d.incubators, space, guard.user)) return 'FORBIDDEN';

    // Deduplicate and sort full-day blocks.
    space.unavailableDates = [...new Set(input.unavailableDates)].sort();
    // Replace time-range blackouts when provided (omit field = leave untouched).
    if (input.blackouts !== undefined) {
      space.blackouts = input.blackouts
        .filter((b) => b.from && b.to) // whole-day blocks live in unavailableDates
        .map((b) => ({ date: b.date, from: b.from!, to: b.to! }));
    }
    space.updatedAt = new Date().toISOString();
    return space;
  });

  if (result === null) return jsonError(404, 'NOT_FOUND', 'Space not found');
  if (result === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'You do not manage this space');

  return json({
    unavailableDates: result.unavailableDates ?? [],
    blackouts: result.blackouts ?? [],
  });
}

/* ──────────────────────── POST / DELETE (block APIs) ──────────────────────── */

type BlockInput = z.infer<typeof blockSchema>;

/**
 * Additive, idempotent block / unblock of full-day dates and/or time ranges,
 * mutating the space's existing `unavailableDates` / `blackouts` (the same fields
 * the public read and the booking gate consult — no parallel block store).
 *   - block:   union full-day dates; merge overlapping ranges; a whole-day block
 *              supersedes (and drops) any partial range on that date.
 *   - unblock: remove the given dates/ranges; removing what isn't there is a no-op.
 */
function applyBlockMutation(
  id: string,
  op: 'block' | 'unblock',
  input: BlockInput,
  user: { id: string; role: string },
) {
  return db.update<SpaceRecord | null | 'FORBIDDEN'>((d) => {
    const space = (d.spaces ?? []).find((s) => s.id === id);
    if (!space) return null;
    if (!userManagesSpace(d.incubators, space, user)) return 'FORBIDDEN';

    const dates = input.dates ?? [];
    const ranges = input.ranges ?? [];

    if (op === 'block') {
      const blockedDates = [...new Set([...(space.unavailableDates ?? []), ...dates])].sort();
      space.unavailableDates = blockedDates;
      const existingPartial = (space.blackouts ?? [])
        .filter((b) => b.from && b.to)
        .map((b) => ({ date: b.date, from: b.from!, to: b.to! }));
      space.blackouts = mergeDateRanges([...existingPartial, ...ranges])
        .filter((r) => !blockedDates.includes(r.date)); // whole-day supersedes the range
    } else {
      const removeDates = new Set(dates);
      space.unavailableDates = (space.unavailableDates ?? []).filter((dd) => !removeDates.has(dd));
      const removeRanges = ranges.map((r) => ({ date: r.date, from: timeToMinutes(r.from), to: timeToMinutes(r.to) }));
      space.blackouts = (space.blackouts ?? []).filter((b) => {
        if (removeDates.has(b.date)) return false;   // unblocking the whole day clears its ranges too
        if (!b.from || !b.to) return true;            // keep other whole-day entries
        const bf = timeToMinutes(b.from);
        const bt = timeToMinutes(b.to);
        const covered = removeRanges.some((r) => r.date === b.date && r.from <= bf && r.to >= bt);
        return !covered;
      });
    }

    space.updatedAt = new Date().toISOString();
    return space;
  });
}

async function readBlockBody(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return { ok: false as const, response: jsonError(400, 'INVALID_JSON', 'Request body must be JSON') }; }
  try { return { ok: true as const, input: blockSchema.parse(body) }; }
  catch (err) {
    if (err instanceof ZodError) return { ok: false as const, response: fromZod(err) };
    throw err;
  }
}

function blockResponse(result: SpaceRecord | null | 'FORBIDDEN') {
  if (result === null) return jsonError(404, 'NOT_FOUND', 'Space not found');
  if (result === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'You do not manage this space');
  return json({ unavailableDates: result.unavailableDates ?? [], blackouts: result.blackouts ?? [] });
}

/** POST — block one or many full-day dates and/or time ranges. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const parsed = await readBlockBody(req);
  if (!parsed.ok) return parsed.response;
  return blockResponse(await applyBlockMutation(id, 'block', parsed.input, guard.user));
}

/** DELETE — unblock one or many full-day dates and/or time ranges (idempotent). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const parsed = await readBlockBody(req);
  if (!parsed.ok) return parsed.response;
  return blockResponse(await applyBlockMutation(id, 'unblock', parsed.input, guard.user));
}
