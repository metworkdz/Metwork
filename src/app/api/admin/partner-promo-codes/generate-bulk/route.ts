/**
 * POST /api/admin/partner-promo-codes/generate-bulk
 * Generate a batch of partner promo codes in one call.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { generateBulkCodes } from '@/server/network/partner-promo-service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bulkSchema = z.object({
  partnerId:          z.string().uuid(),
  membershipTier:     z.enum(['BUILDER', 'FOUNDER']),
  count:              z.number().int().min(1).max(10_000),
  discountPercentage: z.number().int().min(1).max(99).optional(),
  validUntil:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Optional list of emails — parallel with count. Extra/missing are tolerated. */
  emails:             z.array(z.string().email()).optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = bulkSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  try {
    const result = await generateBulkCodes(
      {
        partnerId:          input.partnerId,
        membershipTier:     input.membershipTier,
        count:              input.count,
        discountPercentage: input.discountPercentage,
        validUntil:         input.validUntil,
        emails:             input.emails,
      },
      guard.user.id,
      guard.user.email,
    );

    return json(
      {
        batch:  result.batch,
        count:  result.codes.length,
        // Return the plaintexts — caller must download / distribute them immediately
        codes:  result.codes,
      },
      { status: 201 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Bulk generation failed';
    if (msg.includes('not found')) return jsonError(404, 'PARTNER_NOT_FOUND', msg);
    return jsonError(400, 'GENERATE_FAILED', msg);
  }
}
