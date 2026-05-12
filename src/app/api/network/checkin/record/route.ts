/**
 * POST /api/network/checkin/record
 *
 * Commits a validated check-in to the store. Called by the scanner after
 * the staff member presses "Confirm check-in".
 *
 * Body: { visitId, spaceId, userId, method, checkedInBy? }
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { recordCheckIn } from '@/server/network/checkin-service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  visitId:      z.string().uuid(),
  spaceId:      z.string().uuid(),
  userId:       z.string().uuid(),
  method:       z.enum(['QR', 'MANUAL']),
  checkedInBy:  z.string().uuid().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await recordCheckIn(
    input.visitId,
    input.spaceId,
    input.userId,
    input.method,
    input.checkedInBy ?? guard.user.id,
  );

  if (!result.success) {
    return json({ success: false, error: result.error }, { status: 422 });
  }

  return json({ success: true, visit: result.visit });
}
