/**
 * GET  /api/admin/partner-promo-codes          — list partner promo codes
 * POST /api/admin/partner-promo-codes          — generate a single partner promo code
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { generateSingleCode } from '@/server/network/partner-promo-service';
import { db } from '@/server/db/store';
import { sendResendEmail, partnerPromoCodeEmailHtml } from '@/server/notifications/email';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const generateSchema = z.object({
  partnerId:          z.string().uuid(),
  membershipTier:     z.enum(['BUILDER', 'FOUNDER']),
  discountPercentage: z.number().int().min(1).max(99).optional(),
  validUntil:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  createdFor:         z.string().email('createdFor must be an email address'),
  /** When true, immediately send the code to createdFor via email. */
  sendEmail:          z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const partnerId = searchParams.get('partnerId') ?? undefined;
  const page = Math.max(1, Number(searchParams.get('page') ?? 1));
  const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') ?? 50)));

  const data = await db.read();
  let codes = data.partnerPromoCodes ?? [];
  if (partnerId) codes = codes.filter((c) => c.partnerId === partnerId);

  codes = [...codes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = codes.length;
  const items = codes.slice((page - 1) * limit, page * limit);

  // Strip the hash from the response — it's internal
  const safe = items.map(({ code: _hash, ...rest }) => rest);

  return json({ items: safe, total, page, limit });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = generateSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  try {
    const { record, plaintext } = await generateSingleCode(
      {
        partnerId:          input.partnerId,
        membershipTier:     input.membershipTier,
        discountPercentage: input.discountPercentage,
        validUntil:         input.validUntil,
        createdFor:         input.createdFor,
      },
      guard.user.id,
      guard.user.email,
    );

    if (input.sendEmail) {
      const data = await db.read();
      const partner = (data.partnerMemberships ?? []).find((p) => p.id === input.partnerId);
      const space = partner
        ? (data.spaces ?? []).find((s) => s.id === partner.spaceId)
        : null;
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz';

      void sendResendEmail({
        to: input.createdFor,
        subject: `Your exclusive Metwork membership discount from ${space?.name ?? 'your partner space'}`,
        html: partnerPromoCodeEmailHtml({
          recipientName: input.createdFor,
          partnerName: space?.name ?? 'Metwork Partner',
          promoCode: plaintext,
          membershipTier: input.membershipTier,
          discountPercentage: record.discountPercentage,
          validUntil: record.validUntil,
          redeemUrl: `${appUrl}/dashboard/membership?promo=${encodeURIComponent(plaintext)}`,
        }),
      });
    }

    const { code: _hash, ...safeRecord } = record;
    return json({ record: safeRecord, plaintext }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Code generation failed';
    if (msg.includes('not found')) return jsonError(404, 'PARTNER_NOT_FOUND', msg);
    return jsonError(400, 'GENERATE_FAILED', msg);
  }
}
