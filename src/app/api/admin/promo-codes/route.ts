/**
 * GET  /api/admin/promo-codes  — list all promo codes (newest first)
 * POST /api/admin/promo-codes  — create a new promo code
 *
 * Admin-only endpoint.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { listPromoCodes, createPromoCode } from '@/server/promo-codes/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[A-Z0-9_-]+$/i, 'Code may only contain letters, digits, hyphens, and underscores'),
  discountPercent: z.number().int().min(1).max(100),
  appliesTo: z.enum(['ALL', 'MEMBERSHIP', 'SPACE', 'CONSULTATION']).default('ALL'),
  expiresAt: z.string().datetime().nullable().default(null),
  usageLimit: z.number().int().min(1).nullable().default(null),
});

export async function GET() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const codes = await listPromoCodes();
  return json({ items: codes, total: codes.length });
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
    input = createSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  try {
    const code = await createPromoCode(input);
    return json(code, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === 'PROMO_CODE_EXISTS') {
      return jsonError(409, 'PROMO_CODE_EXISTS', 'A promo code with this name already exists');
    }
    throw err;
  }
}
