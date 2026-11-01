/** Shared bits of the Academy API routes (admin guard + JSON body parsing). */
import type { NextRequest } from 'next/server';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { requireApiRole, requireApprovedApiSession } from '@/server/auth/api-guards';
import { isAcademyEnabled } from '@/config/feature-flags';
import { requireConsultant } from '@/server/mentors/access';
import { fromZod, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';

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

/** A signed-in consultant (mentor) using the Studio. */
export async function requireStudioMentor() {
  if (!isAcademyEnabled()) return { ok: false as const, response: jsonError(404, 'NOT_FOUND', 'Not found') };
  return requireConsultant();
}

const STUDIO_STATUS: Record<string, number> = {
  NOT_FOUND: 404, READ_ONLY: 403, LOCKED: 409, ADDENDUM_REQUIRED: 403, NOT_READY: 422, NOTHING_TO_SUBMIT: 422, SLUG_TAKEN: 409, HAS_ENROLLMENTS: 409,
};

/** Map a Studio / catalogue error to an HTTP response. */
export function studioError(code: string, problems?: string[]) {
  return jsonError(STUDIO_STATUS[code] ?? 422, code, code, problems ? { problems } : undefined);
}

/** Ids in Academy paths and bodies (uuids, seeded ids). */
export const ACADEMY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isAcademyId(v: string): boolean {
  return ACADEMY_ID_RE.test(v);
}

const LEARNER_STATUS: Record<string, number> = {
  NOT_FOUND: 404, LOCKED: 403, NOT_READY: 409, NO_QUIZ: 404, INVALID_ANSWERS: 422, NOT_ELIGIBLE: 409, NAME_MISSING: 422,
  NOT_LEARNER: 403, WATCH_MORE: 409, ALREADY_REPLIED: 409, NOT_YOUR_COURSE: 403, EMPTY: 422, NOT_A_QUESTION: 422, FULL: 409,
};

/** Map a learner-side Academy error (quiz, certificate, review, Q&A) to an HTTP response. */
export function learnerError(code: string, details?: Record<string, unknown>) {
  return jsonError(LEARNER_STATUS[code] ?? 422, code, code, details);
}

/** One sliding-window budget per account and action. */
export async function rateLimited(key: string, max: number, windowMs: number): Promise<Response | null> {
  if (await checkRateLimitDistributed(key, max, windowMs)) return null;
  return jsonError(429, 'RATE_LIMITED', 'Too many requests. Try again later.');
}
