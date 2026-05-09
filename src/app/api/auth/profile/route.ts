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

  // Verify & hash password outside the DB critical section (scrypt is async & slow).
  let newPasswordHash: string | null = null;
  if (input.newPassword) {
    const data = await db.read();
    const user = data.users.find((u) => u.id === guard.user.id);
    if (!user) return jsonError(404, 'NOT_FOUND', 'User not found');

    const valid = await verifyPassword(input.currentPassword ?? '', user.passwordHash);
    if (!valid) return jsonError(422, 'WRONG_PASSWORD', 'Current password is incorrect');

    newPasswordHash = await hashPassword(input.newPassword);
  }

  const updated = await db.update((store) => {
    const user = store.users.find((u) => u.id === guard.user.id);
    if (!user) return null;

    if (newPasswordHash)             user.passwordHash = newPasswordHash;
    if (input.fullName !== undefined) user.fullName    = input.fullName.trim();
    if (input.city     !== undefined) user.city        = input.city.trim();
    if (input.locale   !== undefined) user.locale      = input.locale;
    user.updatedAt = new Date().toISOString();

    const { passwordHash: _, ...safe } = user;
    void _;
    return safe;
  });

  if (updated === null) return jsonError(404, 'NOT_FOUND', 'User not found');
  return json({ user: updated });
}
