/**
 * GET  /api/network/pass/qr
 * POST /api/network/pass/qr     (refresh — invalidates the existing code and issues a fresh one)
 *
 * Used by the entrepreneur Network Pass page to display a live check-in QR.
 *
 * Strategy:
 *   - Find the user's most-relevant NETWORK_PASS booking — today first,
 *     then the next upcoming day.
 *   - If a check-in code already exists, the plaintext is NOT recoverable
 *     (we only store the SHA-256 hash). In that case we invalidate and
 *     re-issue, so the user always sees a usable QR on this page.
 *   - GET: issues a code if none exists, otherwise re-issues (we cannot
 *     reconstruct the plaintext of an existing record).
 *   - POST: same as GET, but explicit "I want a fresh code" semantics.
 *
 * Security:
 *   - Caller must be authenticated.
 *   - Code is bound to a single bookingId + spaceId; the booking must
 *     belong to the requesting user. A stolen QR cannot be replayed
 *     across users because the validate flow rejects mismatched bookings.
 *   - Plaintext is returned ONLY to the booking owner over their session.
 */
import { requireApiSession } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import {
  generateCheckInCode,
  invalidateCheckInCode,
} from '@/server/network/checkin-service';
import { json, jsonError } from '@/server/http/json';
import { isNetworkPassEnabled } from '@/config/feature-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface QrResponseOk {
  hasPass: true;
  qrCodeDataUrl: string;
  checkInCode: string;
  expiresAt: string;
  bookingId: string;
  bookingDate: string;
  spaceId: string;
  spaceName: string;
}

interface QrResponseNone {
  hasPass: false;
  reason:
    | 'NO_NETWORK_PASS_BOOKING'
    | 'NOT_ENTREPRENEUR';
  message: string;
}

type QrResponse = QrResponseOk | QrResponseNone;

function utcDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Pick the most relevant NETWORK_PASS booking for the user.
 *   1. Confirmed booking for TODAY (UTC).
 *   2. Otherwise, the earliest future confirmed booking.
 *   3. Otherwise, null.
 */
async function pickRelevantBooking(userId: string) {
  const data = await db.read();
  const today = new Date().toISOString().slice(0, 10);

  const eligible = data.bookings.filter(
    (b) =>
      b.userId === userId &&
      b.itemKind === 'SPACE' &&
      b.paymentMethod === 'NETWORK_PASS' &&
      (b.status === 'CONFIRMED' || b.status === 'COMPLETED'),
  );

  const todays = eligible.filter((b) => utcDate(b.startsAt) === today);
  if (todays.length > 0) {
    // Earliest today
    todays.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return todays[0];
  }

  const future = eligible
    .filter((b) => utcDate(b.startsAt) > today)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return future[0] ?? null;
}

async function issueResponseForUser(
  userId: string,
  opts: { forceRefresh: boolean },
): Promise<QrResponse> {
  const booking = await pickRelevantBooking(userId);
  if (!booking) {
    return {
      hasPass: false,
      reason: 'NO_NETWORK_PASS_BOOKING',
      message:
        'No upcoming Network Pass booking. Book a partner space using your network credits to get a check-in QR.',
    };
  }

  // We can't reconstruct plaintext from an existing record's hash, so we
  // always invalidate and re-issue from the pass page. This is safe:
  // (a) only the booking owner can hit this endpoint; (b) the old code
  // was never the only way to check in (manual entry still works); (c)
  // the new code is bound to the same bookingId/spaceId, so previously
  // emailed plaintext is also invalidated — exactly the "Refresh QR"
  // semantics users expect.
  if (opts.forceRefresh) {
    await invalidateCheckInCode(booking.id);
  } else {
    // First call too: always reset for predictable plaintext.
    await invalidateCheckInCode(booking.id);
  }

  const { code, qrCodeDataUrl, expiresAt } = await generateCheckInCode(booking.id);

  const data = await db.read();
  const space = data.spaces.find((s) => s.id === booking.itemId);

  return {
    hasPass: true,
    qrCodeDataUrl,
    checkInCode: code,
    expiresAt,
    bookingId: booking.id,
    bookingDate: utcDate(booking.startsAt),
    spaceId: booking.itemId,
    spaceName: space?.name ?? 'Partner space',
  };
}

export async function GET() {
  // Feature gate — Network Pass is switched off platform-wide. Enforced at the
  // endpoint, not only in the UI: a stale tab or a direct call must not be able
  // to work a redemption path the product is not offering yet.
  if (!isNetworkPassEnabled()) {
    return jsonError(403, 'NETWORK_PASS_DISABLED', 'Network Pass is not available yet.');
  }

  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  if (guard.user.role !== 'ENTREPRENEUR') {
    const body: QrResponseNone = {
      hasPass: false,
      reason: 'NOT_ENTREPRENEUR',
      message: 'Network Pass is only available to entrepreneur accounts.',
    };
    return json(body);
  }

  try {
    const body = await issueResponseForUser(guard.user.id, { forceRefresh: false });
    return json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return jsonError(500, 'QR_GENERATION_FAILED', message);
  }
}

export async function POST() {
  // Feature gate — Network Pass is switched off platform-wide. Enforced at the
  // endpoint, not only in the UI: a stale tab or a direct call must not be able
  // to work a redemption path the product is not offering yet.
  if (!isNetworkPassEnabled()) {
    return jsonError(403, 'NETWORK_PASS_DISABLED', 'Network Pass is not available yet.');
  }

  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  if (guard.user.role !== 'ENTREPRENEUR') {
    const body: QrResponseNone = {
      hasPass: false,
      reason: 'NOT_ENTREPRENEUR',
      message: 'Network Pass is only available to entrepreneur accounts.',
    };
    return json(body);
  }

  try {
    const body = await issueResponseForUser(guard.user.id, { forceRefresh: true });
    return json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return jsonError(500, 'QR_GENERATION_FAILED', message);
  }
}
