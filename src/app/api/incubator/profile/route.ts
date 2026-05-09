/**
 * GET   /api/incubator/profile  — get current incubator profile
 * PATCH /api/incubator/profile  — update incubator name, description, city, website, logoUrl
 *                                  + update user's fullName and avatarUrl
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  incubatorName: z.string().min(2).max(100).optional(),
  description: z.string().max(1000).optional(),
  city: z.string().min(1).optional(),
  website: z.string().url().nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  // Legal & billing fields
  address: z.string().max(500).nullable().optional(),
  commercialRegNumber: z.string().max(100).nullable().optional(),
  nif: z.string().max(100).nullable().optional(),
  // User-level fields
  fullName: z.string().min(2).max(120).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  subscriptionTier: z.enum(['COMMISSION', 'FLAT']).optional(),
});

export async function GET() {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const data = await db.read();
  const incubator = data.incubators.find((i) => i.managerId === guard.user.id);
  if (!incubator) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile found');

  return json({
    incubator,
    user: {
      id: guard.user.id,
      fullName: guard.user.fullName,
      email: guard.user.email,
      avatarUrl: guard.user.avatarUrl,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = patchSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await db.update((d) => {
    const incubator = d.incubators.find((i) => i.managerId === guard.user.id);
    if (!incubator) return null;

    const user = d.users.find((u) => u.id === guard.user.id);
    const now = new Date().toISOString();

    if (input.incubatorName !== undefined) incubator.name = input.incubatorName;
    if (input.description !== undefined) incubator.description = input.description;
    if (input.city !== undefined) incubator.city = input.city;
    if (input.website !== undefined) incubator.website = input.website ?? null;
    if (input.logoUrl !== undefined) incubator.logoUrl = input.logoUrl ?? null;
    if (input.address !== undefined) incubator.address = input.address ?? null;
    if (input.commercialRegNumber !== undefined) incubator.commercialRegNumber = input.commercialRegNumber ?? null;
    if (input.nif !== undefined) incubator.nif = input.nif ?? null;
    if (input.subscriptionTier !== undefined) incubator.subscriptionTier = input.subscriptionTier;
    incubator.updatedAt = now;

    // Also sync name into all spaces/programs (denormalized)
    if (input.incubatorName !== undefined) {
      for (const s of d.incubatorSpaces) {
        if (s.incubatorId === incubator.id) s.incubatorName = input.incubatorName;
      }
      for (const p of d.incubatorPrograms) {
        if (p.incubatorId === incubator.id) p.incubatorName = input.incubatorName;
      }
    }

    if (user) {
      if (input.fullName !== undefined) user.fullName = input.fullName;
      if (input.avatarUrl !== undefined) user.avatarUrl = input.avatarUrl ?? null;
      user.updatedAt = now;
    }

    return { incubator: { ...incubator }, user: user ? { ...user } : null };
  });

  if (!result) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile found');
  return json(result);
}
