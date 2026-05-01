/**
 * POST /api/auth/login
 *
 * Verifies email + password, then issues a session cookie. Returns the
 * same shape as verify-otp: { user, expiresAt }.
 *
 * Security choices:
 *  - Always run the password hash even on user-not-found, so timing
 *    can't be used to enumerate accounts.
 *  - Generic 401 / INVALID_CREDENTIALS — never reveals which field was wrong.
 *  - Pending / suspended / banned accounts also return 401 to avoid
 *    leaking account state.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { loginSchema } from '@/lib/validators';
import { db } from '@/server/db/store';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { createSession, setSessionCookie } from '@/server/auth/session';
import { toSessionUser } from '@/server/auth/serialize';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Constant-ish fallback hash, computed once at module load, used to keep
// the timing of the user-not-found branch close to the user-found branch.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword('not-a-real-password');
  return dummyHashPromise;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = loginSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const email = input.email.trim().toLowerCase();
  const data = await db.read();
  const user = data.users.find((u) => u.email === email);

  // Always verify *something* so timing is similar in both branches.
  const targetHash = user?.passwordHash ?? (await getDummyHash());
  const passwordOk = await verifyPassword(input.password, targetHash);

  if (!user || !passwordOk) {
    return jsonError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  if (user.status !== 'ACTIVE') {
    return jsonError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const issued = await createSession(user.id, { remember: input.rememberMe });
  await setSessionCookie(issued);

  return json({
    user: toSessionUser(user),
    expiresAt: issued.expiresAt,
  });
}
