/**
 * Audit log service.
 *
 * Records admin actions to the persistent store so they can be reviewed
 * in the admin dashboard. All writes are fire-and-forget — an audit log
 * failure must never crash a request.
 */
import { randomUUID } from 'node:crypto';
import { db, type AuditAction, type AuditLogRecord } from '@/server/db/store';

export interface AppendAuditLogInput {
  adminId: string;
  adminEmail: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  details?: Record<string, unknown>;
}

/**
 * Append one audit log entry.  Returns the created record, or null when the
 * write fails (so callers can ignore the return value safely).
 */
export async function appendAuditLog(
  input: AppendAuditLogInput,
): Promise<AuditLogRecord | null> {
  try {
    return await db.update((d) => {
      if (!Array.isArray(d.auditLogs)) d.auditLogs = [];

      const record: AuditLogRecord = {
        id: randomUUID(),
        adminId: input.adminId,
        adminEmail: input.adminEmail,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        details: input.details ?? {},
        createdAt: new Date().toISOString(),
      };
      d.auditLogs.push(record);

      // Keep the last 2 000 entries to avoid unbounded growth
      if (d.auditLogs.length > 2_000) {
        d.auditLogs = d.auditLogs.slice(-2_000);
      }

      return record;
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] Failed to write audit log:', err);
    return null;
  }
}

/** Return audit log entries, newest first. */
export async function listAuditLogs(limit = 200): Promise<AuditLogRecord[]> {
  const data = await db.read();
  return [...(data.auditLogs ?? [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
