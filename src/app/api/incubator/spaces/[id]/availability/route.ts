/**
 * GET  /api/incubator/spaces/:id/availability — public; returns blocked dates
 * PUT  /api/incubator/spaces/:id/availability — incubator manager; replaces blocked dates
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const putSchema = z.object({
  /** Array of YYYY-MM-DD date strings to block. Empty array clears all. */
  unavailableDates: z.array(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Each date must be YYYY-MM-DD'),
  ).max(365),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await db.read();
  const space = data.incubatorSpaces?.find((s) => s.id === id);
  if (!space) return jsonError(404, 'NOT_FOUND', 'Space not found');
  return json({ unavailableDates: space.unavailableDates ?? [] });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
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
    const space = d.incubatorSpaces?.find((s) => s.id === id);
    if (!space) return null;

    // Incubator managers can only manage their own spaces
    if (guard.user.role !== 'ADMIN' && space.managerId !== guard.user.id) return 'FORBIDDEN';

    // Deduplicate and sort
    space.unavailableDates = [...new Set(input.unavailableDates)].sort();
    space.updatedAt = new Date().toISOString();
    return space;
  });

  if (result === null) return jsonError(404, 'NOT_FOUND', 'Space not found');
  if (result === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'You do not manage this space');

  return json({ unavailableDates: result.unavailableDates ?? [] });
}
