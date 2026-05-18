/**
 * DELETE /api/auth/account — Self-service account deletion (GDPR Article 17)
 * Requires: active session + password confirmation
 */
import type { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { db, type AuditLogRecord } from '@/server/db/store';
import { verifyPassword } from '@/server/auth/password';
import { json, jsonError, fromZod } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  password: z.string().min(1),
});

export async function DELETE(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input: z.infer<typeof schema>;
  try { input = schema.parse(body); }
  catch (err) { if (err instanceof ZodError) return fromZod(err); throw err; }

  // Verify password before deletion. We do the (async) password check OUTSIDE
  // db.update, then re-check user existence INSIDE the update callback so that
  // two concurrent DELETE requests can't both pass and produce duplicate audit
  // log entries — only the first one to enter the callback finds the user.
  const userId = guard.user.id;
  const data = await db.read();
  const user = data.users?.find((u) => u.id === userId);
  if (!user) return jsonError(404, 'USER_NOT_FOUND', 'User not found');

  const passwordValid = user.passwordHash
    ? await verifyPassword(input.password, user.passwordHash)
    : false;
  if (!passwordValid) {
    return jsonError(401, 'INVALID_PASSWORD', 'Password is incorrect');
  }

  // Delete the user and all their data; anonymize bookings for accounting
  const deletionResult = await db.update<{ deleted: boolean }>((d) => {
    const stillExists = (d.users ?? []).some((u) => u.id === userId);
    if (!stillExists) return { deleted: false };

    // Per-user sentinel — keeps deleted users distinguishable in revenue
    // reports without leaking PII.
    const deletedSentinel = `deleted-${userId.slice(0, 8)}`;

    // Bookings — anonymize all PII fields but keep the row for accounting.
    for (const b of (d.bookings ?? [])) {
      if (b.userId === userId) {
        b.userId      = deletedSentinel;
        b.clientName  = 'Deleted User';
        b.clientPhone = null;
        b.clientEmail = null;
        if ('clientIdNumber' in b) (b as unknown as Record<string, unknown>).clientIdNumber = null;
      }
    }

    // Mentor bookings — anonymize identifying fields.
    for (const mb of (d.mentorBookings ?? [])) {
      if (mb.userId === userId) {
        mb.userId = deletedSentinel;
        if ('clientName'  in mb) (mb as unknown as Record<string, unknown>).clientName  = 'Deleted User';
        if ('clientEmail' in mb) (mb as unknown as Record<string, unknown>).clientEmail = null;
        if ('clientPhone' in mb) (mb as unknown as Record<string, unknown>).clientPhone = null;
        if ('userName'    in mb) (mb as unknown as Record<string, unknown>).userName    = 'Deleted User';
        if ('userEmail'   in mb) (mb as unknown as Record<string, unknown>).userEmail   = '';
        if ('userPhone'   in mb) (mb as unknown as Record<string, unknown>).userPhone   = '';
      }
    }

    // Mentor consultations — re-attribute to sentinel.
    for (const c of (d.mentorConsultations ?? [])) {
      if (c.userId === userId) c.userId = deletedSentinel;
    }

    // Transactions — keep for accounting, re-attribute.
    for (const t of (d.transactions ?? [])) {
      if (t.userId === userId) t.userId = deletedSentinel;
    }

    // Contact submissions — strip identifying fields if they were linked to
    // the user.  The base record has no userId so we only touch rows that
    // carry one (older / extended records may).
    for (const cs of (d.contactSubmissions ?? [])) {
      const csAny = cs as unknown as Record<string, unknown>;
      if ('userId' in cs && csAny.userId === userId) {
        csAny.userId = deletedSentinel;
        if ('email' in cs) csAny.email = '';
        if ('phone' in cs) csAny.phone = null;
        if ('name'  in cs) csAny.name  = 'Deleted User';
      }
    }

    // Withdrawal requests — keep for accounting, re-attribute.
    for (const w of (d.withdrawalRequests ?? [])) {
      if (w.userId === userId) w.userId = deletedSentinel;
    }

    // Notifications and user memberships have no post-deletion value.
    d.notifications   = (d.notifications   ?? []).filter((n)  => n.userId  !== userId);
    d.userMemberships = (d.userMemberships ?? []).filter((um) => um.userId !== userId);

    // Sessions and wallets removed entirely.
    d.sessions = (d.sessions ?? []).filter((s) => s.userId !== userId);
    d.wallets  = (d.wallets  ?? []).filter((w) => w.userId !== userId);

    // Finally, delete the user record itself.
    d.users = (d.users ?? []).filter((u) => u.id !== userId);

    // Append an audit log record so admins can see deletion analytics.
    // GDPR: do NOT persist the deleted user's email — they just exercised
    // their right-to-erasure. We use a sentinel string in adminEmail (the
    // closest existing field) since self-deletion isn't admin-initiated.
    if (!Array.isArray(d.auditLogs)) d.auditLogs = [];
    const auditRecord: AuditLogRecord = {
      id: randomUUID(),
      adminId: userId,
      adminEmail: '[self-deleted]',
      action: 'ACCOUNT_DELETED',
      targetType: 'user',
      targetId: userId,
      details: { role: user.role ?? 'UNKNOWN' },
      createdAt: new Date().toISOString(),
    };
    d.auditLogs.push(auditRecord);
    if (d.auditLogs.length > 2_000) {
      d.auditLogs = d.auditLogs.slice(-2_000);
    }
    return { deleted: true };
  });

  if (!deletionResult.deleted) {
    return jsonError(404, 'USER_NOT_FOUND', 'User not found');
  }

  // Clear the session cookie in the response
  const cookieName = process.env.AUTH_COOKIE_NAME ?? 'metwork_session';
  const res = json({ message: 'Account deleted successfully' });
  res.cookies.set(cookieName, '', { maxAge: 0, path: '/' });
  return res;
}
