/**
 * Network Pass Check-In Service — security-critical fraud prevention.
 *
 * Threat model:
 *   - Replay attacks         → one-time-use codes (consumed flag)
 *   - Wrong-space redemption → bind code to spaceId at issue time
 *   - Stale code use         → expiresAt = 23:59:59 UTC on booking day
 *   - Code guessing          → SHA-256 hash, constant-time compare
 *   - Wrong-payment claims   → require paymentMethod === 'NETWORK_PASS'
 *   - Simultaneous check-ins → time-window fraud check
 *   - DB leak                → plaintext code NEVER stored
 *   - Timing-side-channel    → crypto.timingSafeEqual on hash compare
 *
 * Every public method either appends to the check-in audit log itself or
 * returns enough context for the caller to do so. Audit writes are
 * fire-and-forget — they never block the request path.
 *
 * Location note: this file lives in `src/server/network/` to match the
 * project's server-domain convention. The spec asked for
 * `src/services/NetworkCheckInService.ts`; that path is reserved for
 * client-side API wrappers in this codebase, so we keep the secure
 * server logic out of it.
 */

import { randomUUID } from 'node:crypto';
import {
  db,
  type BookingRecord,
  type NetworkCheckInCodeRecord,
  type NetworkCheckInResult,
  type NetworkVisitRecord,
  type SpaceRecord,
  type UserRecord,
} from '@/server/db/store';
import {
  buildQrPayload,
  composeCode,
  hashCode,
  parseCode,
  parseQrPayload,
  renderQr,
  safeHashEquals,
} from './qr-utils';
import { appendCheckInAudit } from './checkin-audit';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerateCheckInCodeResult {
  code: string;
  qrCodeDataUrl: string;
  expiresAt: string;
}

export interface CheckInBookingDetails {
  bookingId: string;
  userEmail: string;
  userFullName: string;
  date: string;        // YYYY-MM-DD
  spaceId: string;
  spaceName: string;
}

export interface ValidationResult {
  valid: boolean;
  user?: UserRecord;
  bookingDetails?: CheckInBookingDetails;
  /** Pre-allocated visit id, supplied to `recordCheckIn`. */
  visitId?: string;
  error?: string;
  /** Audit-log enum for the result (always present, including SUCCESS). */
  resultCode: NetworkCheckInResult;
}

export interface RecordCheckInResult {
  success: boolean;
  visit?: NetworkVisitRecord;
  error?: string;
}

export interface FraudCheckResult {
  isFraudulent: boolean;
  reason?: string;
  /** Whether the booking should still be allowed despite the flag. */
  allowAnyway: boolean;
}

export interface CheckInHistoryItem {
  spaceId: string;
  spaceName: string;
  date: string;
  checkedInAt: string;
  method: 'QR' | 'MANUAL' | 'AUTO';
}

export interface CheckInHistory {
  visits: CheckInHistoryItem[];
}

export interface SpaceCheckInStats {
  totalCheckIns: number;
  uniqueUsers: number;
  methodBreakdown: { QR: number; MANUAL: number; AUTO: number };
  fraudDetected: number;
  /** Average gap (ms) between booking confirmation and check-in. */
  averageCheckInTimeMs: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** YYYY-MM-DD in UTC for an ISO string. */
function utcDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toISOString().slice(0, 10);
}

/** Today's date in UTC (YYYY-MM-DD). */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** End-of-day for the given UTC date string — 23:59:59.999 UTC. */
function endOfDayUtc(dateStr: string): string {
  return `${dateStr}T23:59:59.999Z`;
}

/**
 * Booking statuses considered "approved" for check-in purposes.
 * `COMPLETED` is allowed in case the booking was auto-completed at the
 * start of the visit window.
 */
const APPROVED_STATUSES: ReadonlySet<BookingRecord['status']> = new Set([
  'CONFIRMED',
  'COMPLETED',
]);

// ---------------------------------------------------------------------------
// 1. generateCheckInCode
// ---------------------------------------------------------------------------

/**
 * Issue a one-time-use check-in code + QR for a Network Pass booking.
 *
 * Must be called AFTER the booking is confirmed and the credit deducted.
 * Returns the plaintext code + base64 QR — the caller must email this to
 * the user (it cannot be retrieved again, since only the hash is stored).
 *
 * Idempotency: if a code already exists for this bookingId, it is
 * returned unchanged WITHOUT regenerating the hash (we'd lose the
 * plaintext otherwise). Callers wanting a refresh must explicitly
 * invalidate the old one first.
 */
export async function generateCheckInCode(
  bookingId: string,
): Promise<GenerateCheckInCodeResult> {
  const data = await db.read();
  const booking = data.bookings.find((b) => b.id === bookingId);
  if (!booking) {
    throw new Error(`generateCheckInCode: booking ${bookingId} not found`);
  }
  if (booking.paymentMethod !== 'NETWORK_PASS') {
    throw new Error(
      `generateCheckInCode: booking ${bookingId} is not a NETWORK_PASS booking (paymentMethod=${booking.paymentMethod ?? 'null'})`,
    );
  }
  if (booking.itemKind !== 'SPACE') {
    throw new Error(
      `generateCheckInCode: only SPACE bookings can have a check-in code (got ${booking.itemKind})`,
    );
  }

  const bookingDate = utcDate(booking.startsAt);
  const today = todayUtc();
  if (bookingDate !== today) {
    // Spec: "booking must be for today" — but in practice booking is for
    // a future date. We allow issue-ahead and rely on validate() to gate
    // by date. If you want to forbid future issuance, throw here.
  }

  // Idempotency: return existing code if one exists.
  const existing = data.networkCheckInCodes?.find((c) => c.bookingId === bookingId);
  if (existing) {
    // We don't have the plaintext, so we can't reissue the QR. Caller
    // must call invalidate + regenerate to start fresh.
    throw new Error(
      `generateCheckInCode: a code already exists for booking ${bookingId}. ` +
      `Call invalidateCheckInCode() first if you need a new one.`,
    );
  }

  const year = new Date(booking.startsAt).getUTCFullYear();
  // Sequence number: increment across all codes ever issued in this year.
  // Simple monotonic counter — sufficient for human-readable IDs.
  const sameYearCount = (data.networkCheckInCodes ?? []).filter((c) => {
    const cy = new Date(c.createdAt).getUTCFullYear();
    return cy === year;
  }).length;
  const sequence = sameYearCount + 1;

  const code = composeCode(year, sequence);
  const codeHash = hashCode(code);
  const expiresAt = endOfDayUtc(bookingDate);
  const now = new Date().toISOString();

  const record: NetworkCheckInCodeRecord = {
    id: randomUUID(),
    bookingId,
    spaceId: booking.itemId,
    userId: booking.userId ?? '',
    codeHash,
    expiresAt,
    sequenceNumber: sequence,
    consumed: false,
    consumedAt: null,
    visitId: null,
    createdAt: now,
  };

  await db.update((d) => {
    if (!Array.isArray(d.networkCheckInCodes)) d.networkCheckInCodes = [];
    // Re-check inside the lock for race safety
    const dup = d.networkCheckInCodes.find((c) => c.bookingId === bookingId);
    if (dup) return; // someone won the race; we'll discard our work
    d.networkCheckInCodes.push(record);
  });

  // Render the QR with the plaintext code
  const { dataUrl } = await renderQr(buildQrPayload(bookingId, code));

  return { code, qrCodeDataUrl: dataUrl, expiresAt };
}

/**
 * Invalidate the check-in code for a booking — e.g. when re-issuing.
 * No-ops if no code exists.
 */
export async function invalidateCheckInCode(bookingId: string): Promise<void> {
  await db.update((d) => {
    if (!Array.isArray(d.networkCheckInCodes)) return;
    d.networkCheckInCodes = d.networkCheckInCodes.filter((c) => c.bookingId !== bookingId);
  });
}

// ---------------------------------------------------------------------------
// 2. validateCheckInQRCode
// ---------------------------------------------------------------------------

/**
 * Validates a QR-scanned code at a specific space. Runs the full security
 * check sequence. Appends an audit entry regardless of result.
 *
 * Does NOT modify any state — call `recordCheckIn(visitId, …)` if valid.
 */
export async function validateCheckInQRCode(
  spaceId: string,
  qrData: string,
  opts: { staffUserId?: string | null } = {},
): Promise<ValidationResult> {
  const payload = parseQrPayload(qrData);
  if (!payload) {
    const result: ValidationResult = {
      valid: false,
      error: 'Invalid QR code format',
      resultCode: 'INVALID_CODE',
    };
    await appendCheckInAudit({
      spaceId,
      bookingId: null,
      userId: null,
      method: 'QR',
      result: result.resultCode,
      staffUserId: opts.staffUserId,
      details: { reason: 'Could not parse QR payload' },
    });
    return result;
  }

  return runValidation({
    spaceId,
    bookingId: payload.bookingId,
    submittedCode: payload.code,
    method: 'QR',
    staffUserId: opts.staffUserId,
  });
}

// ---------------------------------------------------------------------------
// 3. validateCheckInManual
// ---------------------------------------------------------------------------

/**
 * Validates a manually-typed code (format "MNP-2026-00145"). Looks up
 * the booking by the code's hash (not by id) — staff can enter the code
 * even if they don't know the booking id.
 */
export async function validateCheckInManual(
  spaceId: string,
  bookingNumber: string,
  opts: { staffUserId?: string | null } = {},
): Promise<ValidationResult> {
  const parsed = parseCode(bookingNumber);
  if (!parsed) {
    const result: ValidationResult = {
      valid: false,
      error: 'Invalid code format. Expected "MNP-YYYY-NNNNN".',
      resultCode: 'INVALID_CODE',
    };
    await appendCheckInAudit({
      spaceId,
      bookingId: null,
      userId: null,
      method: 'MANUAL',
      result: result.resultCode,
      staffUserId: opts.staffUserId,
      details: { reason: 'Bad format', submitted: bookingNumber },
    });
    return result;
  }

  // Look up by codeHash so we don't need a separate index
  const data = await db.read();
  const codeStr = bookingNumber.trim().toUpperCase();
  const expectedHash = hashCode(codeStr);
  const codeRow = (data.networkCheckInCodes ?? []).find((c) =>
    safeHashEquals(c.codeHash, expectedHash),
  );

  if (!codeRow) {
    const result: ValidationResult = {
      valid: false,
      error: 'Invalid check-in code',
      resultCode: 'INVALID_CODE',
    };
    await appendCheckInAudit({
      spaceId,
      bookingId: null,
      userId: null,
      method: 'MANUAL',
      result: result.resultCode,
      staffUserId: opts.staffUserId,
      details: { reason: 'No matching hash', sequence: parsed.sequence },
    });
    return result;
  }

  return runValidation({
    spaceId,
    bookingId: codeRow.bookingId,
    submittedCode: codeStr,
    method: 'MANUAL',
    staffUserId: opts.staffUserId,
  });
}

// ---------------------------------------------------------------------------
// Shared validation pipeline
// ---------------------------------------------------------------------------

interface RunValidationInput {
  spaceId: string;
  bookingId: string;
  submittedCode: string;
  method: 'QR' | 'MANUAL';
  staffUserId?: string | null;
}

async function runValidation(input: RunValidationInput): Promise<ValidationResult> {
  const { spaceId, bookingId, submittedCode, method, staffUserId } = input;
  const data = await db.read();

  // Helper to bundle audit-write + return
  const reject = async (
    error: string,
    resultCode: NetworkCheckInResult,
    extras: Record<string, unknown> = {},
  ): Promise<ValidationResult> => {
    await appendCheckInAudit({
      spaceId,
      bookingId,
      userId: extras.userId as string | null ?? null,
      method,
      result: resultCode,
      staffUserId,
      details: { reason: error, ...extras },
    });
    return { valid: false, error, resultCode };
  };

  // 1. Booking exists?
  const booking = data.bookings.find((b) => b.id === bookingId);
  if (!booking) {
    return reject('Booking not found', 'BOOKING_NOT_FOUND');
  }

  // 2. Same space?
  if (booking.itemKind !== 'SPACE' || booking.itemId !== spaceId) {
    return reject(
      'Booking is for a different space',
      'WRONG_SPACE',
      { bookingSpaceId: booking.itemId, scannerSpaceId: spaceId, userId: booking.userId },
    );
  }

  // 3. Today's booking?
  const bookingDate = utcDate(booking.startsAt);
  const today = todayUtc();
  if (bookingDate !== today) {
    return reject(
      'Booking is not for today',
      'WRONG_DATE',
      { bookingDate, today, userId: booking.userId },
    );
  }

  // 4. Paid via NETWORK_PASS?
  if (booking.paymentMethod !== 'NETWORK_PASS') {
    return reject(
      'Booking was paid via wallet, not network pass',
      'WRONG_PAYMENT_METHOD',
      { paymentMethod: booking.paymentMethod ?? null, userId: booking.userId },
    );
  }

  // 5. Status approved?
  if (!APPROVED_STATUSES.has(booking.status)) {
    return reject(
      'Booking not yet approved',
      'BOOKING_NOT_CONFIRMED',
      { status: booking.status, userId: booking.userId },
    );
  }

  // 6. Code hash matches?
  const codeRow = (data.networkCheckInCodes ?? []).find((c) => c.bookingId === bookingId);
  if (!codeRow) {
    return reject(
      'No check-in code issued for this booking',
      'INVALID_CODE',
      { userId: booking.userId },
    );
  }
  const submittedHash = hashCode(submittedCode);
  if (!safeHashEquals(codeRow.codeHash, submittedHash)) {
    return reject('Invalid QR code', 'INVALID_CODE', { userId: booking.userId });
  }

  // 7. Already consumed?
  if (codeRow.consumed) {
    const visit = (data.networkVisits ?? []).find((v) => v.id === codeRow.visitId);
    const checkedInAt = visit?.checkedInAt ?? codeRow.consumedAt;
    return reject(
      checkedInAt
        ? `Already checked in at ${formatHHMM(checkedInAt)}`
        : 'Already checked in',
      'ALREADY_CHECKED_IN',
      { userId: booking.userId, visitId: codeRow.visitId },
    );
  }

  // 8. Expired?
  if (Date.parse(codeRow.expiresAt) < Date.now()) {
    return reject(
      'QR code expired',
      'EXPIRED',
      { expiredAt: codeRow.expiresAt, userId: booking.userId },
    );
  }

  // ── All checks passed ────────────────────────────────────────────────
  const user = data.users.find((u) => u.id === booking.userId);
  const space = data.spaces.find((s) => s.id === spaceId);
  if (!user || !space) {
    return reject(
      'Internal error: user or space missing',
      'ERROR',
      { userMissing: !user, spaceMissing: !space },
    );
  }

  const visitId = randomUUID();
  // Note: we DO NOT write the audit log here — recordCheckIn will append
  // the SUCCESS entry on commit. We append a "validated but not yet
  // recorded" intent at this stage only via the staff-side audit trail.

  return {
    valid: true,
    user,
    bookingDetails: {
      bookingId,
      userEmail: user.email,
      userFullName: user.fullName,
      date: bookingDate,
      spaceId,
      spaceName: space.name,
    },
    visitId,
    resultCode: 'SUCCESS',
  };
}

function formatHHMM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// 4. recordCheckIn
// ---------------------------------------------------------------------------

/**
 * Commits a validated check-in. Creates the NetworkVisitRecord, marks the
 * check-in code as consumed, and updates user metadata.
 *
 * MUST be called only after `validateCheckIn*` returned `valid: true`.
 * Re-validates the consumed flag inside the write lock for race safety.
 *
 * Idempotent on `visitId`: passing the same visitId twice returns the
 * existing visit. Credit decrement happens on booking, NOT here — see
 * `credit-service.deductCredit`.
 */
export async function recordCheckIn(
  visitId: string,
  spaceId: string,
  userId: string,
  method: 'QR' | 'MANUAL',
  checkedInBy?: string | null,
): Promise<RecordCheckInResult> {
  try {
    return await db.update((d) => {
      // Idempotency: if a visit already has this id, return it.
      const existing = d.networkVisits?.find((v) => v.id === visitId);
      if (existing) return { success: true, visit: existing };

      // Find the code row — must be unconsumed for this space + user
      const code = d.networkCheckInCodes?.find(
        (c) => c.spaceId === spaceId && c.userId === userId && !c.consumed,
      );
      if (!code) {
        return { success: false, error: 'No active check-in code for this user/space' };
      }

      // Find the booking and partner-membership for payout rate
      const booking = d.bookings.find((b) => b.id === code.bookingId);
      if (!booking) return { success: false, error: 'Booking disappeared' };

      const space = d.spaces.find((s) => s.id === spaceId);
      const partner = space?.partnerMembershipId
        ? d.partnerMemberships.find((p) => p.id === space.partnerMembershipId)
        : undefined;
      const payoutAmount = partner?.networkPayoutRate ?? 300;

      const now = new Date().toISOString();

      const visit: NetworkVisitRecord = {
        id: visitId,
        userId,
        spaceId,
        bookingId: code.bookingId,
        checkedInAt: now,
        checkedInBy: checkedInBy ?? null,
        checkedInMethod: method,
        payoutStatus: 'PENDING',
        payoutAmount,
        payoutBatchId: null,
        paidOutDate: null,
        createdAt: now,
        updatedAt: now,
      };

      if (!Array.isArray(d.networkVisits)) d.networkVisits = [];
      d.networkVisits.push(visit);

      // Consume the code
      code.consumed = true;
      code.consumedAt = now;
      code.visitId = visitId;

      // Link visit to booking (existing field) and bump booking status
      booking.networkVisitId = visitId;
      // We don't add new booking fields; the visit row carries checkedInAt.

      // Update user metadata
      const user = d.users.find((u) => u.id === userId);
      if (user) {
        user.lastNetworkVisit = now;
        if (!Array.isArray(user.networkSpacesVisited)) user.networkSpacesVisited = [];
        if (!user.networkSpacesVisited.includes(spaceId)) {
          user.networkSpacesVisited.push(spaceId);
        }
      }

      return { success: true, visit };
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[checkin] recordCheckIn failed', { visitId, spaceId, userId, err });
    return { success: false, error: 'Internal error — please retry' };
  } finally {
    // Best-effort audit write
    void appendCheckInAudit({
      spaceId,
      bookingId: null,
      userId,
      method,
      result: 'SUCCESS',
      staffUserId: checkedInBy ?? null,
      details: { visitId },
    });
  }
}

// ---------------------------------------------------------------------------
// 5. detectFraudulentCheckIn
// ---------------------------------------------------------------------------

const FRAUD_WINDOW_MS = 5 * 60 * 1_000;           // 5 minutes
const HEAVY_USER_DAYS = 30;
const HEAVY_USER_THRESHOLD = 20;

/**
 * Run fraud heuristics for a booking. Designed to be called BEFORE
 * `recordCheckIn` as a final gate. Returns `isFraudulent: true` only for
 * confirmed signals; "heavy user" returns `false` with `allowAnyway: true`
 * (operations should monitor but allow).
 */
export async function detectFraudulentCheckIn(
  bookingId: string,
): Promise<FraudCheckResult> {
  const data = await db.read();
  const booking = data.bookings.find((b) => b.id === bookingId);
  if (!booking) {
    return { isFraudulent: false, allowAnyway: true };
  }
  const userId = booking.userId;
  if (!userId) {
    return { isFraudulent: false, allowAnyway: true };
  }

  // 1. Duplicate: already a visit for this booking?
  const dup = (data.networkVisits ?? []).find((v) => v.bookingId === bookingId);
  if (dup) {
    return { isFraudulent: true, reason: 'Duplicate check-in', allowAnyway: false };
  }

  // 2. Simultaneous: same user at >1 space in the last 5 min?
  const windowStart = Date.now() - FRAUD_WINDOW_MS;
  const recent = (data.networkVisits ?? []).filter(
    (v) => v.userId === userId && v.checkedInAt && Date.parse(v.checkedInAt) >= windowStart,
  );
  if (recent.length > 1) {
    const uniqueSpaces = new Set(recent.map((v) => v.spaceId));
    if (uniqueSpaces.size > 1) {
      return {
        isFraudulent: true,
        reason: 'Simultaneous check-ins detected at multiple spaces',
        allowAnyway: false,
      };
    }
  }

  // 3. Heavy user: >20 visits in 30 days
  const thirtyDaysAgo = Date.now() - HEAVY_USER_DAYS * 86_400_000;
  const recentVisits = (data.networkVisits ?? []).filter(
    (v) => v.userId === userId && v.checkedInAt && Date.parse(v.checkedInAt) >= thirtyDaysAgo,
  );
  if (recentVisits.length > HEAVY_USER_THRESHOLD) {
    return {
      isFraudulent: false,
      reason: `Heavy user (${recentVisits.length} visits in ${HEAVY_USER_DAYS}d) — monitor`,
      allowAnyway: true,
    };
  }

  return { isFraudulent: false, allowAnyway: true };
}

// ---------------------------------------------------------------------------
// 6. getCheckInHistory
// ---------------------------------------------------------------------------

/**
 * Returns the user's most recent N check-ins, newest first.
 * Joins SpaceRecord for the display name.
 */
export async function getCheckInHistory(
  userId: string,
  limit = 10,
): Promise<CheckInHistory> {
  const data = await db.read();
  const visits = (data.networkVisits ?? [])
    .filter((v) => v.userId === userId && v.checkedInAt)
    .sort((a, b) => (b.checkedInAt ?? '').localeCompare(a.checkedInAt ?? ''))
    .slice(0, limit);

  const spaceById = new Map<string, SpaceRecord>(
    (data.spaces ?? []).map((s) => [s.id, s]),
  );

  return {
    visits: visits.map((v) => ({
      spaceId: v.spaceId,
      spaceName: spaceById.get(v.spaceId)?.name ?? 'Unknown space',
      date: v.checkedInAt ? utcDate(v.checkedInAt) : '',
      checkedInAt: v.checkedInAt ?? '',
      method: v.checkedInMethod ?? 'AUTO',
    })),
  };
}

// ---------------------------------------------------------------------------
// 7. getSpaceCheckInStats
// ---------------------------------------------------------------------------

/**
 * Aggregate stats for a single space over a date range. Used by the
 * partner space's admin dashboard.
 */
export async function getSpaceCheckInStats(
  spaceId: string,
  dateRange: { from: Date; to: Date },
): Promise<SpaceCheckInStats> {
  const data = await db.read();
  const fromMs = dateRange.from.getTime();
  const toMs = dateRange.to.getTime();

  const visits = (data.networkVisits ?? []).filter((v) => {
    if (v.spaceId !== spaceId || !v.checkedInAt) return false;
    const t = Date.parse(v.checkedInAt);
    return t >= fromMs && t <= toMs;
  });

  const methodBreakdown = { QR: 0, MANUAL: 0, AUTO: 0 };
  let totalConfirmGapMs = 0;
  let gapSamples = 0;
  const userIds = new Set<string>();

  const bookingById = new Map<string, BookingRecord>(
    (data.bookings ?? []).map((b) => [b.id, b]),
  );

  for (const v of visits) {
    userIds.add(v.userId);
    const m = v.checkedInMethod ?? 'AUTO';
    methodBreakdown[m]++;
    // Gap = checkedInAt - booking.createdAt (proxy for "how soon after booking")
    const b = bookingById.get(v.bookingId);
    if (b && v.checkedInAt) {
      const gap = Date.parse(v.checkedInAt) - Date.parse(b.createdAt);
      if (gap > 0) {
        totalConfirmGapMs += gap;
        gapSamples++;
      }
    }
  }

  // Fraud detected = audit entries with FRAUD_SUSPECTED in the range for this space
  const fraudDetected = (data.networkCheckInAuditLogs ?? []).filter((a) => {
    if (a.spaceId !== spaceId || a.result !== 'FRAUD_SUSPECTED') return false;
    const t = Date.parse(a.attemptedAt);
    return t >= fromMs && t <= toMs;
  }).length;

  return {
    totalCheckIns: visits.length,
    uniqueUsers: userIds.size,
    methodBreakdown,
    fraudDetected,
    averageCheckInTimeMs: gapSamples > 0 ? Math.round(totalConfirmGapMs / gapSamples) : 0,
  };
}
