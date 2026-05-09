/**
 * POST /api/admin/memberships
 * Assign or update a membership plan for a user. Admin only.
 * If the user already has an ACTIVE membership, the old one is cancelled.
 */
import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  userId:    z.string().uuid(),
  plan:      z.enum(['FREE', 'ENTREPRENEUR', 'STARTUP']),
  expiresAt: z.string().datetime().nullable().default(null),
});

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const now = new Date().toISOString();

  const result = await db.update((store) => {
    const user = store.users.find((u) => u.id === input.userId);
    if (!user) return null;

    // Cancel any existing active membership for this user
    store.userMemberships
      .filter((m) => m.userId === input.userId && m.status === 'ACTIVE')
      .forEach((m) => { m.status = 'CANCELLED'; m.updatedAt = now; });

    const record = {
      id:        crypto.randomUUID(),
      userId:    input.userId,
      plan:      input.plan,
      startsAt:  now,
      expiresAt: input.expiresAt,
      status:    'ACTIVE' as const,
      createdAt: now,
      updatedAt: now,
    };
    store.userMemberships.push(record);

    // Keep user.membershipCode in sync
    user.membershipCode = input.plan === 'FREE' ? null : input.plan;
    user.updatedAt = now;

    return record;
  });

  if (!result) return jsonError(404, 'NOT_FOUND', 'User not found');
  return json({ membership: result }, { status: 201 });
}
