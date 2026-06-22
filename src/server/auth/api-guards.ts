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
import { isAccountApproved } from '@/lib/approval-guard';
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

/**
 * Like `requireApiSession`, but additionally enforces the unified
 * account-approval gate (see `requireApprovedApiRole`). Use on session-scoped
 * (non role-restricted) mutating routes such as wallet top-up, bookings,
 * membership purchase and withdrawals.
 */
export async function requireApprovedApiSession(): Promise<ApiAuthResult> {
  const guard = await requireApiSession();
  if (!guard.ok) return guard;
  if (!isAccountApproved(guard.user)) {
    return {
      ok: false,
      response: jsonError(
        403,
        'ACCOUNT_PENDING',
        'Your account is pending approval. You have read-only access until an admin approves it.',
      ),
    };
  }
  return guard;
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

/**
 * Like `requireApiRole`, but additionally enforces the unified account-approval
 * gate: a session whose account is not APPROVED (a PENDING/REJECTED gated role)
 * is rejected with a typed 403 `ACCOUNT_PENDING`. This is the single, centralized
 * write-gate — mutating routes opt in by calling this instead of `requireApiRole`.
 * Entrepreneurs, admins and approved accounts pass through unchanged.
 */
export async function requireApprovedApiRole(roles: UserRole[]): Promise<ApiAuthResult> {
  const guard = await requireApiRole(roles);
  if (!guard.ok) return guard;
  if (!isAccountApproved(guard.user)) {
    return {
      ok: false,
      response: jsonError(
        403,
        'ACCOUNT_PENDING',
        'Your account is pending approval. You have read-only access until an admin approves it.',
      ),
    };
  }
  return guard;
}
