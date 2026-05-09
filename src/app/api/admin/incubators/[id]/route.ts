/**
 * PATCH /api/admin/incubators/:id  — update an incubator (admin only)
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name:             z.string().min(2).max(120).optional(),
  email:            z.string().email().max(200).optional(),
  phone:            z.string().min(6).max(30).optional(),
  city:             z.string().min(1).max(80).optional(),
  status:           z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  subscriptionCode: z.enum(['COMMISSION', 'FLAT']).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
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

  const result = await db.update((d) => {
    if (!Array.isArray(d.incubators)) d.incubators = [];
    const inc = d.incubators.find((x) => x.id === id);
    if (!inc) return null;

    if (input.name !== undefined)             inc.name             = input.name.trim();
    if (input.email !== undefined)            inc.email            = input.email.trim();
    if (input.phone !== undefined)            inc.phone            = input.phone.trim();
    if (input.city !== undefined)             inc.city             = input.city.trim();
    if (input.status !== undefined)           inc.status           = input.status;
    if (input.subscriptionCode !== undefined) inc.subscriptionCode = input.subscriptionCode;
    inc.updatedAt = new Date().toISOString();
    return inc;
  });

  if (!result) return jsonError(404, 'NOT_FOUND', 'Incubator not found');
  return json(result);
}
