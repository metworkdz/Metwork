/**
 * METWORK OS CRM — the login route never crashes into a non-JSON response.
 *
 * Regression coverage for a real bug: the login route used to let ANY
 * database exception (unreachable Turso, a misconfigured
 * `METWORKCRM_DATABASE_URL`, a transient connection blip) propagate
 * uncaught. Next.js then returns a raw, non-JSON error response, and the
 * login form's `res.json()` throws — which the form previously reported as
 * "Erreur réseau. Réessayez.", a message that actively misleads: the
 * problem was the server's database, not the user's network. Reproduced
 * live in the browser before this fix existed (see SESSION_LOG.md), by
 * pointing `METWORKCRM_DATABASE_URL` at an unreachable host and confirming
 * the exact symptom, then confirming this fix resolves it.
 *
 * SCOPE NOTE — why this only covers the failure path, and only login:
 * calling a route handler directly (not through a real HTTP request) means
 * `next/headers`'s `cookies()` has no request-scoped context and throws
 * "called outside a request scope" the moment anything touches it — which
 * happens on the SUCCESS path here (`setCrmSessionCookie`) and on
 * essentially every line of `change-password`'s route (its very first call
 * is `requireCrmApiUser()`, which reads the session cookie before touching
 * the database at all, healthy or not). That happy path has no service-layer
 * equivalent to fall back on and is already covered twice over by real e2e
 * (`crm-critical-paths.spec.ts`, `seed-admin-login.spec.ts`, both running
 * through an actual server where `cookies()` works correctly). What e2e
 * CANNOT easily cover is deliberately breaking the database mid-request
 * without restarting the server — that's what this file adds.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import { internalUsers } from '@/server/metworkcrm/db/schema';
import { hashPassword } from '@/server/auth/password';
import { POST as loginPOST } from '@/app/api/metworkcrm/auth/login/route';

const MEM = 'file::memory:';
let db: CrmDatabase;
const EMAIL = 'resilience-test@metwork.dz';
const PASSWORD = 'ResilienceTest!2026';

/** Stands in for `getCrmDb()`'s return value with every query throwing — simulates an unreachable database. */
const BROKEN_DB = {
  select: () => {
    throw new Error('simulated: database unreachable (e.g. misconfigured METWORKCRM_DATABASE_URL)');
  },
} as unknown as CrmDatabase;

function loginRequest(email: string, password: string): NextRequest {
  return new NextRequest('http://localhost/api/metworkcrm/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

beforeAll(async () => {
  db = createCrmDb(MEM);
  __setCrmDbForTests(db);
  await runCrmMigrations(db, MEM);
  const now = new Date().toISOString();
  await db.insert(internalUsers).values({
    id: randomUUID(),
    name: 'Resilience Test',
    email: EMAIL,
    passwordHash: await hashPassword(PASSWORD),
    role: 'ADMIN',
    mustChangePassword: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
});

// A leaked broken db would fail every later test in the shared vitest
// process (this suite runs with singleFork: true).
afterEach(() => {
  __setCrmDbForTests(db);
});

describe('POST /api/metworkcrm/auth/login — resilience', () => {
  it('returns a valid JSON 500 — never throws, never a non-JSON body — when the database is unreachable', async () => {
    __setCrmDbForTests(BROKEN_DB);

    let thrown: unknown = null;
    let res: Response | undefined;
    try {
      res = await loginPOST(loginRequest(EMAIL, PASSWORD));
    } catch (err) {
      thrown = err;
    }

    // The bug: this used to throw, which is exactly what produced the raw
    // non-JSON response the login form couldn't parse.
    expect(thrown, 'the route handler itself must not throw').toBeNull();
    expect(res!.status).toBe(500);
    expect(res!.headers.get('content-type')).toContain('application/json');

    // Must actually parse — this is the specific failure mode that showed
    // up as "Erreur réseau" client-side.
    const body = await res!.json();
    expect(body.error).toBeTruthy();
    expect(body.error.code).toBe('CRM_INTERNAL_ERROR');
  });
});
