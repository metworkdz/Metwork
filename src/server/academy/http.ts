/** Shared bits of the Academy API routes (admin guard + JSON body parsing). */
import type { NextRequest } from 'next/server';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { requireApiRole, requireApprovedApiSession } from '@/server/auth/api-guards';
import { isAcademyEnabled } from '@/config/feature-flags';
import { fromZod, jsonError } from '@/server/http/json';

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

export async function parseBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<Parsed<z.output<S>>> {
  let body: unknown;
  try { body = await req.json(); } catch {
    return { ok: false, response: jsonError(400, 'INVALID_JSON', 'Request body must be JSON') };
  }
  try {
    return { ok: true, data: schema.parse(body) as z.output<S> };
  } catch (err) {
    if (err instanceof ZodError) return { ok: false, response: fromZod(err) };
    throw err;
  }
}

/** Admin-only, with the admin's id and email for the audit log. */
export async function requireAcademyAdmin() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard;
  return { ok: true as const, admin: { id: guard.user.id, email: guard.user.email } };
}

/** Signed-in, approved account on a live Academy (404 while the launch flag is off). */
export async function requireAcademyLearner() {
  if (!isAcademyEnabled()) return { ok: false as const, response: jsonError(404, 'NOT_FOUND', 'Not found') };
  return requireApprovedApiSession();
}
