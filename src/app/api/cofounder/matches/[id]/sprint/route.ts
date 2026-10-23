/**
 * GET  /api/cofounder/matches/[id]/sprint — the match's trial sprint (null before it starts).
 * POST /api/cofounder/matches/[id]/sprint — `{ item: key | null, done }`: start it / tick an item.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { setSprintItem, sprintFor } from '@/server/cofounder/sprint';
import { SPRINT_ITEMS } from '@/lib/cofounder-sprint';
import { withCofounder } from '@/server/cofounder/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx { params: Promise<{ id: string }> }

const schema = z.object({ item: z.enum(SPRINT_ITEMS).nullable(), done: z.boolean() }).strict();

export async function GET(_req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['ENTREPRENEUR', 'FREELANCER']);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  return withCofounder(async () => {
    const s = await sprintFor(guard.user.id, id);
    return s === 'NOT_FOUND' ? jsonError(404, 'NOT_FOUND', 'Match not found') : json({ sprint: s });
  });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['ENTREPRENEUR', 'FREELANCER']);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);
  return withCofounder(async () => {
    const s = await setSprintItem(guard.user.id, id, parsed.data.item, parsed.data.done);
    return s ? json({ sprint: s }) : jsonError(404, 'NOT_FOUND', 'Match not found');
  });
}
