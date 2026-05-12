/**
 * Check-in audit log — separate from the admin AuditLogRecord because it's
 * per-attempt (high volume) and the schema is specialised for fraud
 * investigation.
 *
 * Every call to validate / record a check-in must append exactly one
 * NetworkCheckInAuditRecord, regardless of outcome (success or failure).
 * Writes are fire-and-forget: an audit log failure must never block a
 * legitimate check-in or block a security rejection.
 *
 * Retention: indefinite (kept for fraud investigation). The store caps the
 * collection at 50 000 entries — adjust if call volume warrants.
 */

import { randomUUID } from 'node:crypto';
import {
  db,
  type NetworkCheckInAuditRecord,
  type NetworkCheckInResult,
} from '@/server/db/store';

const MAX_AUDIT_ENTRIES = 50_000;

export interface AppendCheckInAuditInput {
  spaceId: string;
  bookingId: string | null;
  userId: string | null;
  method: 'QR' | 'MANUAL';
  result: NetworkCheckInResult;
  staffUserId?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Append one entry to the check-in audit log. Never throws — errors are
 * caught and logged to stderr so the caller can proceed unaffected.
 */
export async function appendCheckInAudit(
  input: AppendCheckInAuditInput,
): Promise<void> {
  try {
    await db.update((d) => {
      if (!Array.isArray(d.networkCheckInAuditLogs)) d.networkCheckInAuditLogs = [];

      const record: NetworkCheckInAuditRecord = {
        id: randomUUID(),
        attemptedAt: new Date().toISOString(),
        spaceId: input.spaceId,
        bookingId: input.bookingId,
        userId: input.userId,
        method: input.method,
        result: input.result,
        staffUserId: input.staffUserId ?? null,
        details: input.details ?? {},
      };
      d.networkCheckInAuditLogs.push(record);

      // Trim oldest if over the cap
      if (d.networkCheckInAuditLogs.length > MAX_AUDIT_ENTRIES) {
        d.networkCheckInAuditLogs = d.networkCheckInAuditLogs.slice(-MAX_AUDIT_ENTRIES);
      }
    });
  } catch (err) {
    // Audit failure MUST NOT block the caller.
    // eslint-disable-next-line no-console
    console.error('[checkin-audit] append failed', { input, err });
  }
}

/**
 * List recent check-in audit entries, newest first. Used by the admin
 * fraud-investigation UI and by spot-check tooling.
 */
export async function listCheckInAudit(opts: {
  spaceId?: string;
  userId?: string;
  bookingId?: string;
  result?: NetworkCheckInResult;
  limit?: number;
} = {}): Promise<NetworkCheckInAuditRecord[]> {
  const data = await db.read();
  let rows = [...(data.networkCheckInAuditLogs ?? [])];

  if (opts.spaceId)    rows = rows.filter((r) => r.spaceId   === opts.spaceId);
  if (opts.userId)     rows = rows.filter((r) => r.userId    === opts.userId);
  if (opts.bookingId)  rows = rows.filter((r) => r.bookingId === opts.bookingId);
  if (opts.result)     rows = rows.filter((r) => r.result    === opts.result);

  rows.sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt));
  return rows.slice(0, opts.limit ?? 200);
}
