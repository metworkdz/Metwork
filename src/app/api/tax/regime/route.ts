/** PUT /api/tax/regime — `{ regime: 'IFU' | 'REEL' }`: the regime the tax calendar uses. */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { setTaxRegime } from '@/server/taxes/service';
import { TAX_REGIMES } from '@/types/legal-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ regime: z.enum(TAX_REGIMES) }).strict();

export async function PUT(req: NextRequest) {
  const guard = await requireApiRole(['FREELANCER', 'ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  let input;
  try { input = bodySchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  return (await setTaxRegime(guard.user, input.regime))
    ? json({ regime: input.regime })
    : jsonError(409, 'NO_TAX_PROFILE', 'Set your legal status first');
}
