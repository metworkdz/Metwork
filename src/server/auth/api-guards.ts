/**
 * API-level auth guards. Use inside route handlers; for server components
 * use `requireRole()` from `@/lib/auth-guards` instead.
 *
 *   const guard = await requireApiSession();
 *   if (!guard.ok) return guard.response;
 *   const { user } = guard;
 */
import { readSession, type ResolvedSession } from '@/server/auth/session';
import { jsonError } from '@/server/http/json';
import type { UserRole } from '@/types/auth';
import type { NextResponse } from 'next/server';

export type ApiAuthResult =
  | (ResolvedSession & { ok: true })
  | { ok: false; response: NextResponse };

export async function requireApiSession(): Promise<ApiAuthResult> {
  const ctx = await readSession();
  if (!ctx) {
    return {
      ok: false,
      response: jsonError(401, 'UNAUTHENTICATED', 'Not authenticated'),
    };
  }
  return { ok: true, ...ctx };
}

export async function requireApiRole(roles: UserRole[]): Promise<ApiAuthResult> {
  const guard = await requireApiSession();
  if (!guard.ok) return guard;
  if (!roles.includes(guard.user.role)) {
    return {
      ok: false,
      response: jsonError(403, 'FORBIDDEN', 'Role not allowed'),
    };
  }
  return guard;
}
