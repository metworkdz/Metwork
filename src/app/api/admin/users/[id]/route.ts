/**
 * PATCH  /api/admin/users/[id]  — update role / status
 * DELETE /api/admin/users/[id]  — hard-delete user and all related data
 *
 * Admin only.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError, noContent } from '@/server/http/json';
import { appendAuditLog } from '@/server/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  role:   z.enum(['ENTREPRENEUR', 'INVESTOR', 'INCUBATOR', 'ADMIN']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED', 'PENDING_VERIFICATION']).optional(),
}).refine((d) => d.role !== undefined || d.status !== undefined, {
  message: 'At least one of role or status must be provided',
});

interface RouteParams { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  // Prevent admins from modifying their own account through this endpoint
  if (id === guard.user.id) {
    return jsonError(403, 'FORBIDDEN', 'Cannot modify your own account via admin API');
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = patchSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const updated = await db.update((store) => {
    const user = store.users.find((u) => u.id === id);
    if (!user) return null;
    const prev = { role: user.role, status: user.status };
    if (input.role)   user.role   = input.role;
    if (input.status) user.status = input.status;
    user.updatedAt = new Date().toISOString();
    const { passwordHash: _, ...safe } = user;
    void _;
    return { safe, prev };
  });

  if (!updated) return jsonError(404, 'NOT_FOUND', 'User not found');

  // Audit log
  if (input.status) {
    const actionMap: Record<string, Parameters<typeof appendAuditLog>[0]['action']> = {
      BANNED:    'USER_BANNED',
      SUSPENDED: 'USER_SUSPENDED',
      ACTIVE:    'USER_REINSTATED',
    };
    const action = actionMap[input.status] ?? 'USER_REINSTATED';
    await appendAuditLog({
      adminId: guard.user.id,
      adminEmail: guard.user.email,
      action,
      targetType: 'user',
      targetId: id,
      details: { prevStatus: updated.prev.status, newStatus: input.status },
    }).catch(() => undefined);
  }
  if (input.role) {
    await appendAuditLog({
      adminId: guard.user.id,
      adminEmail: guard.user.email,
      action: 'USER_ROLE_CHANGED',
      targetType: 'user',
      targetId: id,
      details: { prevRole: updated.prev.role, newRole: input.role },
    }).catch(() => undefined);
  }

  return json({ user: updated.safe });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  // Prevent self-deletion
  if (id === guard.user.id) {
    return jsonError(403, 'FORBIDDEN', 'Cannot delete your own admin account');
  }

  const result = await db.update((store) => {
    const idx = store.users.findIndex((u) => u.id === id);
    if (idx === -1) return null;

    const user = store.users[idx]!;
    const email = user.email;

    // Remove the user record
    store.users.splice(idx, 1);

    // Cascade deletes — remove all data owned by this user
    store.sessions             = store.sessions.filter((s) => s.userId !== id);
    store.otps                 = store.otps.filter((o) => o.userId !== id);
    store.emailTokens          = store.emailTokens.filter((e) => e.userId !== id);
    store.passwordResets       = store.passwordResets.filter((p) => p.userId !== id);
    store.wallets              = store.wallets.filter((w) => w.userId !== id);
    store.transactions         = store.transactions.filter((t) => t.userId !== id);
    store.topUpIntents         = store.topUpIntents.filter((i) => i.userId !== id);
    store.bookings             = store.bookings.filter((b) => b.userId !== id);
    store.startupListings      = store.startupListings.filter((s) => s.founderId !== id);
    store.mentorBookings       = store.mentorBookings.filter((m) => m.userId !== id);
    store.mentorConsultations  = (store.mentorConsultations ?? []).filter((c) => c.userId !== id);
    store.savedStartups        = (store.savedStartups ?? []).filter((s) => s.userId !== id);
    store.investorContacts     = (store.investorContacts ?? []).filter((c) => c.investorId !== id);
    store.investments          = (store.investments ?? []).filter((i) => i.investorId !== id);
    store.userMemberships      = (store.userMemberships ?? []).filter((m) => m.userId !== id);
    store.notifications        = (store.notifications ?? []).filter((n) => n.userId !== id);

    // Unlink from incubators (don't delete the incubator itself)
    store.incubators
      .filter((i) => i.managerId === id)
      .forEach((i) => { i.managerId = null; i.updatedAt = new Date().toISOString(); });

    // Remove from pendingUsers too (re-signup from scratch)
    store.pendingUsers = store.pendingUsers.filter((p) => p.email !== email);

    return { email, id };
  });

  if (!result) return jsonError(404, 'NOT_FOUND', 'User not found');

  await appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: 'USER_DELETED',
    targetType: 'user',
    targetId: id,
    details: { deletedEmail: result.email },
  }).catch(() => undefined);

  return noContent();
}
