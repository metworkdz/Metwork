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
import { requireApiRole } from '@/server/auth/api-guards';
import {
  validateCheckInQRCode,
  validateCheckInManual,
  authorizeSpaceCheckIn,
} from '@/server/network/checkin-service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { isNetworkPassEnabled } from '@/config/feature-flags';

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
  // Feature gate — Network Pass is switched off platform-wide. Enforced at the
  // endpoint, not only in the UI: a stale tab or a direct call must not be able
  // to work a redemption path the product is not offering yet.
  if (!isNetworkPassEnabled()) {
    return jsonError(403, 'NETWORK_PASS_DISABLED', 'Network Pass is not available yet.');
  }

  // Reception is run by the partner space's owning incubator (or an admin) —
  // not just any authenticated user (the response carries the member's PII).
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
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

  // The caller must own (or admin) the space being scanned.
  if (!(await authorizeSpaceCheckIn(guard.user, input.spaceId))) {
    return jsonError(403, 'FORBIDDEN', 'You are not authorised to scan check-ins for this space');
  }

  // Attribution is the authenticated reception user — never trusted from the
  // body (prevents audit-trail spoofing).
  const staffUserId = guard.user.id;

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
