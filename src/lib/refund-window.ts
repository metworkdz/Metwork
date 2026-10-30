/**
 * Consultation refund window — client-safe (no server imports) so the button
 * and the API apply the exact same rule.
 *
 * A client may ask for a refund up to 24 hours before the session starts. From
 * that moment on — which includes the whole day of the session — and once the
 * session is over, the client can no longer ask. Admins can still open a refund
 * themselves (e.g. a consultant no-show).
 */
export const CONSULTATION_REFUND_CUTOFF_HOURS = 24;

interface SessionTimes {
  status?: string;
  scheduledAt?: string | null;
  consultationDate?: string | null;
  consultationTime?: string | null;
}

/** Session start in epoch ms, or null when no time was ever set. */
export function consultationStartMs(b: SessionTimes): number | null {
  if (b.scheduledAt) {
    const t = Date.parse(b.scheduledAt);
    if (!Number.isNaN(t)) return t;
  }
  if (b.consultationDate && b.consultationTime) {
    // Africa/Algiers is UTC+1 all year (no DST), so the fixed offset is exact.
    const t = Date.parse(`${b.consultationDate}T${b.consultationTime}:00+01:00`);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

/** Last instant a client can still ask for a refund, or null when unscheduled. */
export function consultationRefundDeadlineMs(b: SessionTimes): number | null {
  const start = consultationStartMs(b);
  return start === null ? null : start - CONSULTATION_REFUND_CUTOFF_HOURS * 3_600_000;
}

/** True while a client may still ask. A finished session never qualifies. */
export function isConsultationRefundWindowOpen(b: SessionTimes, nowMs: number = Date.now()): boolean {
  if (b.status === 'COMPLETED') return false;
  const deadline = consultationRefundDeadlineMs(b);
  return deadline === null || nowMs <= deadline;
}
