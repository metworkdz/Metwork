/**
 * GET  /api/admin/perks  — list all perks with stock / claim counts (newest first)
 * POST /api/admin/perks  — create a new partner perk
 *
 * Admin-only endpoint.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { listPerks, createPerk } from '@/server/perks/service';
import { createPerkSchema } from '@/server/perks/schemas';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const perks = await listPerks();
  return json({ items: perks, total: perks.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = createPerkSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  try {
    const perk = await createPerk(input);
    return json(perk, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === 'THRESHOLD_NOT_APPLICABLE') {
      return jsonError(
        422,
        'THRESHOLD_NOT_APPLICABLE',
        'lowStockThreshold only applies to CODE_POOL perks',
      );
    }
    throw err;
  }
}
