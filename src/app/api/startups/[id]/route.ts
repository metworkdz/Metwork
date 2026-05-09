/**
 * GET  /api/startups/:id — authenticated; returns any ACTIVE listing,
 *                          or the founder's own listing regardless of status.
 * PATCH /api/startups/:id — authenticated founder; update their own listing.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { findStartupById, updateStartup } from '@/server/startups/service';
import { toStartupDto } from '@/server/startups/serialize';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const listing = await findStartupById(id);

  if (!listing) {
    return jsonError(404, 'STARTUP_NOT_FOUND', 'Startup listing not found');
  }

  // Non-founders can only see active listings.
  if (listing.status !== 'ACTIVE' && listing.founderId !== guard.user.id) {
    return jsonError(404, 'STARTUP_NOT_FOUND', 'Startup listing not found');
  }

  return json(toStartupDto(listing));
}

const patchSchema = z.object({
  name:          z.string().min(2).max(100).optional(),
  description:   z.string().min(10).max(2000).optional(),
  industry:      z.string().min(2).max(100).optional(),
  fundingGoal:   z.number().int().min(100_000).optional(),
  equityOffered: z.number().min(0.1).max(100).optional(),
  valuation:     z.number().int().positive().optional().nullable(),
  status:        z.enum(['DRAFT', 'ACTIVE', 'CLOSED']).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = patchSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await updateStartup(id, guard.user.id, input);

  if (!result.ok) {
    if (result.reason === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Startup not found');
    return jsonError(403, 'FORBIDDEN', 'Not your startup');
  }

  return json({ startup: toStartupDto(result.startup) });
}
