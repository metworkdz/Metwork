/**
 * POST /api/network/checkin/validate
 *
 * Validates a Network Pass check-in code (QR or manual).
 * Called by the SpaceCheckInScanner component.
 *
 * Body (QR):     { spaceId, qrData, method: 'QR', staffUserId? }
 * Body (MANUAL): { spaceId, bookingNumber, method: 'MANUAL', staffUserId? }
 *
 * Returns: ValidationResult (see checkin-service.ts)
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import {
  validateCheckInQRCode,
  validateCheckInManual,
} from '@/server/network/checkin-service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('method', [
  z.object({
    method:      z.literal('QR'),
    spaceId:     z.string().uuid(),
    qrData:      z.string().min(1).max(2048),
    staffUserId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    method:        z.literal('MANUAL'),
    spaceId:       z.string().uuid(),
    bookingNumber: z.string().min(1).max(50),
    staffUserId:   z.string().uuid().nullable().optional(),
  }),
]);

export async function POST(req: NextRequest) {
  // Reception staff must be authenticated — no anonymous scanning
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

  const staffUserId = input.staffUserId ?? guard.user.id;

  const result =
    input.method === 'QR'
      ? await validateCheckInQRCode(input.spaceId, input.qrData, { staffUserId })
      : await validateCheckInManual(input.spaceId, input.bookingNumber, { staffUserId });

  // Omit user PII from the response when invalid
  if (!result.valid) {
    return json(
      { valid: false, error: result.error },
      { status: 422 },
    );
  }

  // Return only the fields the UI needs
  return json({
    valid: true,
    visitId: result.visitId,
    user: result.user
      ? { id: result.user.id, fullName: result.user.fullName, email: result.user.email }
      : null,
    bookingDetails: result.bookingDetails,
  });
}
