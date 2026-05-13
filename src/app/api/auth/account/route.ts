/**
 * DELETE /api/auth/account — Self-service account deletion (GDPR Article 17)
 * Requires: active session + password confirmation
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
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

  // Verify password before deletion
  const data = await db.read();
  const user = data.users?.find((u) => u.id === guard.user.id);
  if (!user) return jsonError(404, 'USER_NOT_FOUND', 'User not found');

  const passwordValid = user.passwordHash
    ? await verifyPassword(input.password, user.passwordHash)
    : false;
  if (!passwordValid) {
    return jsonError(401, 'INVALID_PASSWORD', 'Password is incorrect');
  }

  // Delete the user and all their data; anonymize bookings for accounting
  await db.update((d) => {
    d.users = (d.users ?? []).filter((u) => u.id !== guard.user.id);
    d.sessions = (d.sessions ?? []).filter((s) => s.userId !== guard.user.id);
    d.wallets = (d.wallets ?? []).filter((w) => w.userId !== guard.user.id);
    // Anonymize bookings — keep for accounting but remove PII
    for (const b of (d.bookings ?? [])) {
      if (b.userId === guard.user.id) {
        b.userId = 'deleted';
        b.clientName = 'Deleted User';
      }
    }
  });

  // Clear the session cookie in the response
  const cookieName = process.env.AUTH_COOKIE_NAME ?? 'metwork_session';
  const res = json({ message: 'Account deleted successfully' });
  res.cookies.set(cookieName, '', { maxAge: 0, path: '/' });
  return res;
}
