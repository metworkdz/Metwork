/**
 * PATCH /api/auth/profile
 * Update the current user's profile fields (fullName, city, locale)
 * and optionally change password.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z
  .object({
    fullName:        z.string().min(2).max(120).optional(),
    city:            z.string().min(2).max(100).optional(),
    locale:          z.enum(['en', 'fr', 'ar']).optional(),
    currentPassword: z.string().optional(),
    newPassword:     z.string().min(8).max(200).optional(),
  })
  .refine(
    (d) =>
      d.fullName !== undefined ||
      d.city !== undefined ||
      d.locale !== undefined ||
      d.newPassword !== undefined,
    { message: 'At least one field must be provided' },
  )
  .refine(
    (d) => !d.newPassword || d.currentPassword !== undefined,
    { message: 'currentPassword is required when changing password', path: ['currentPassword'] },
  );

export async function PATCH(req: NextRequest) {
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

  // Pre-hash the new password OUTSIDE the lock (scrypt is slow — ~200 ms).
  // Current-password verification happens INSIDE db.update() to eliminate the
  // read-verify-then-write race (TOCTOU): the lock ensures no other write can
  // change passwordHash between verification and update.
  let newPasswordHash: string | null = null;
  if (input.newPassword) {
    newPasswordHash = await hashPassword(input.newPassword);
  }

  type UpdateResult =
    | { ok: true; user: Record<string, unknown> }
    | { ok: false; reason: 'NOT_FOUND' | 'WRONG_PASSWORD' };

  const result = await db.update<UpdateResult>(async (store) => {
    const user = store.users.find((u) => u.id === guard.user.id);
    if (!user) return { ok: false, reason: 'NOT_FOUND' };

    // Verify current password atomically inside the lock
    if (newPasswordHash) {
      const valid = await verifyPassword(input.currentPassword ?? '', user.passwordHash);
      if (!valid) return { ok: false, reason: 'WRONG_PASSWORD' };
      user.passwordHash = newPasswordHash;
    }

    if (input.fullName !== undefined) user.fullName = input.fullName.trim();
    if (input.city     !== undefined) user.city     = input.city.trim();
    if (input.locale   !== undefined) user.locale   = input.locale;
    user.updatedAt = new Date().toISOString();

    const { passwordHash: _, ...safe } = user;
    void _;
    return { ok: true, user: safe };
  });

  if (!result.ok) {
    if (result.reason === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'User not found');
    return jsonError(422, 'WRONG_PASSWORD', 'Current password is incorrect');
  }
  const updated = result.user;
  return json({ user: updated });
}
