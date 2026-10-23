/**
 * GET   /api/cofounder/profile — the caller's cofounder profile (default if none yet).
 * PUT   /api/cofounder/profile — save it.
 * PATCH /api/cofounder/profile — `{ enabled }`: switch matching on or off.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { profileOf, saveProfile, setEnabled } from '@/server/cofounder/service';
import { COFOUNDER_ROLES, COMMITMENTS, PITCH_MAX, SECTORS, VALUE_KEYS } from '@/lib/cofounder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const roles = z.array(z.enum(COFOUNDER_ROLES)).max(COFOUNDER_ROLES.length).transform((a) => [...new Set(a)]);
const profileSchema = z.object({
  enabled: z.boolean(),
  brings: roles,
  lookingFor: roles,
  commitment: z.enum(COMMITMENTS).nullable(),
  sectors: z.array(z.enum(SECTORS)).max(SECTORS.length).transform((a) => [...new Set(a)]),
  pitch: z.string().trim().max(PITCH_MAX),
  remoteOk: z.boolean(),
  values: z.record(z.enum(VALUE_KEYS), z.number().int().min(1).max(5)),
  visibleTo: z.enum(['EVERYONE', 'ENTREPRENEURS']),
}).strict();

async function body(req: NextRequest): Promise<unknown | Response> {
  try { return await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
}

export async function GET() {
  const guard = await requireApiRole(['ENTREPRENEUR', 'FREELANCER']);
  if (!guard.ok) return guard.response;
  const data = await db.read();
  const user = data.users.find((u) => u.id === guard.user.id);
  return user ? json(profileOf(data, user)) : jsonError(404, 'NOT_FOUND', 'User not found');
}

export async function PUT(req: NextRequest) {
  const guard = await requireApiRole(['ENTREPRENEUR', 'FREELANCER']);
  if (!guard.ok) return guard.response;
  const raw = await body(req);
  if (raw instanceof Response) return raw;
  let input;
  try { input = profileSchema.parse(raw); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  const saved = await saveProfile(guard.user.id, input);
  return saved ? json(saved) : jsonError(403, 'NOT_ALLOWED', 'Not available for this account');
}

export async function PATCH(req: NextRequest) {
  const guard = await requireApiRole(['ENTREPRENEUR', 'FREELANCER']);
  if (!guard.ok) return guard.response;
  const raw = await body(req);
  if (raw instanceof Response) return raw;
  const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(raw);
  if (!parsed.success) return fromZod(parsed.error);
  return (await setEnabled(guard.user.id, parsed.data.enabled))
    ? json({ enabled: parsed.data.enabled })
    : jsonError(403, 'NOT_ALLOWED', 'Not available for this account');
}
