/**
 * API-driven e2e: AUTH (password reset) + WALLET (insufficient-funds gate).
 *
 * These tests hit the JSON API directly (no UI) to assert two business gates:
 *
 *  • POST /api/auth/reset-password — the REJECTION paths only. We never drive a
 *    successful reset (that would need a real DB token AND would invalidate the
 *    seeded login cookie other specs reuse). We only confirm that:
 *      - a bogus/unknown token → 400 INVALID_OR_EXPIRED_TOKEN (anti-enumeration:
 *        invalid and expired are indistinguishable, see route.ts),
 *      - a body that fails the zod schema is rejected BEFORE the token lookup.
 *
 *  • POST /api/programs/:id/apply — for a PAID program with paymentMethod
 *    'ONLINE' (wallet debit), a balance < price → 422 INSUFFICIENT_FUNDS, while
 *    a FREE program skips the wallet entirely (control case → 201).
 *
 * Error envelope (verified in src/server/http/json.ts):
 *   { error: { code, message, details?: { ... } } }
 * — extra fields (balance/required for INSUFFICIENT_FUNDS) live under
 * `error.details`. We read defensively (error.details OR top-level OR error.*)
 * so the assertions survive any future un-nesting.
 *
 * Rate-limit note: reset-password is capped at 10 attempts per IP per hour
 * (key `reset-password:ip:<ip>`). Every reset-password call below attaches a
 * UNIQUE x-forwarded-for (`freshXff()`) so the limiter never bleeds across the
 * suite. The shared helper only exports an xff() bag for /api/registrations, so
 * we build our own header bag here.
 *
 * Zod-validation status note: the route runs `resetPasswordRequestSchema.parse`
 * and on failure returns `fromZod(err)`, which (see src/server/http/json.ts)
 * responds 422 VALIDATION_ERROR — NOT 400. The key invariant we assert for the
 * validation cases is that the code is NOT INVALID_OR_EXPIRED_TOKEN, i.e. zod
 * runs and rejects the body *before* the token is ever looked up.
 */
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  roleContext,
  guestContext,
  createProgram,
  applyToProgram,
  walletBalance,
} from './_helpers';

/** Shape of a JSON error body — code/details may be nested or flat. */
interface MaybeErrorBody {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
  code?: string;
  [k: string]: unknown;
}

/** Pull the error code regardless of nesting. */
function errCode(body: MaybeErrorBody): string | undefined {
  return body?.error?.code ?? body?.code;
}

/** Pull an extra error field (e.g. balance/required) regardless of nesting. */
function errField(body: MaybeErrorBody, key: string): unknown {
  return body?.error?.details?.[key] ?? body?.error?.[key as keyof typeof body.error] ?? body?.[key];
}

/** Read an error response body once, returning it for assertions/messages. */
async function readError(res: APIResponse): Promise<MaybeErrorBody> {
  return (await res.json()) as MaybeErrorBody;
}

/** A fresh random RFC-1918 IP, unique per call (collision-improbable). */
function freshIp(): string {
  const octet = (): number => 1 + Math.floor(Math.random() * 253);
  return `10.${octet()}.${octet()}.${octet()}`;
}

/** Header bag carrying a unique X-Forwarded-For for the per-IP reset limiter. */
function freshXff(): Record<string, string> {
  return { 'x-forwarded-for': freshIp() };
}

/** POST the reset-password endpoint with a guaranteed-unique source IP. */
async function postReset(
  guest: APIRequestContext,
  data: { token: string; password: string; confirmPassword: string },
): Promise<APIResponse> {
  return guest.post('/api/auth/reset-password', { headers: freshXff(), data });
}

test.describe('Auth + wallet', () => {
  let guest: APIRequestContext;
  let inc: APIRequestContext;
  let explorer: APIRequestContext;

  test.beforeAll(async () => {
    guest = await guestContext();
    inc = await roleContext('incubator');
    explorer = await roleContext('explorer');
  });

  test.afterAll(async () => {
    await guest.dispose();
    await inc.dispose();
    await explorer.dispose();
  });

  // 1. Bogus token → 400 INVALID_OR_EXPIRED_TOKEN.
  test('reset-password with a bogus token returns 400 INVALID_OR_EXPIRED_TOKEN', async () => {
    // Strong password so we get past zod and actually hit the token check.
    const res = await postReset(guest, {
      token: `totally-bogus-token-${Date.now()}`,
      password: 'NewPassw0rd!',
      confirmPassword: 'NewPassw0rd!',
    });
    const body = await readError(res);
    expect(res.status(), `bogus token should be 400 → ${JSON.stringify(body)}`).toBe(400);
    expect(errCode(body), `expected INVALID_OR_EXPIRED_TOKEN → ${JSON.stringify(body)}`).toBe(
      'INVALID_OR_EXPIRED_TOKEN',
    );
  });

  // 2. A second, different bogus token → same 400 INVALID_OR_EXPIRED_TOKEN.
  test('reset-password with a second bogus token is indistinguishable (400 INVALID_OR_EXPIRED_TOKEN)', async () => {
    const res = await postReset(guest, {
      token: `another-bogus-token-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      password: 'An0therGoodPass!',
      confirmPassword: 'An0therGoodPass!',
    });
    const body = await readError(res);
    expect(res.status(), `second bogus token should be 400 → ${JSON.stringify(body)}`).toBe(400);
    expect(errCode(body), `expected INVALID_OR_EXPIRED_TOKEN → ${JSON.stringify(body)}`).toBe(
      'INVALID_OR_EXPIRED_TOKEN',
    );
  });

  // 3. Weak password → rejected by zod BEFORE the token lookup (code != token code).
  test('reset-password with a weak password is rejected by validation, not the token check', async () => {
    const res = await postReset(guest, {
      token: `whatever-${Date.now()}`,
      password: 'short',
      confirmPassword: 'short',
    });
    const body = await readError(res);
    // `fromZod` (src/server/http/json.ts) returns 422 VALIDATION_ERROR, so the
    // validation rejection happens before the token is ever read.
    expect(res.status(), `weak password should be a 4xx validation error → ${JSON.stringify(body)}`).toBe(422);
    expect(
      errCode(body),
      `validation error must NOT be the token code (zod runs first) → ${JSON.stringify(body)}`,
    ).not.toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  // 4. Password / confirmPassword mismatch → rejected by zod refine.
  test('reset-password with mismatched passwords is rejected by validation', async () => {
    const res = await postReset(guest, {
      token: 'x'.repeat(20),
      password: 'GoodPass1',
      confirmPassword: 'GoodPass2',
    });
    const body = await readError(res);
    expect(res.status(), `mismatched passwords should be a 4xx validation error → ${JSON.stringify(body)}`).toBe(422);
    expect(
      errCode(body),
      `mismatch must NOT be the token code (zod refine runs first) → ${JSON.stringify(body)}`,
    ).not.toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  // 5. Wallet insufficient-funds gate on a PAID program.
  test('applying to a paid program over the wallet balance returns 422 INSUFFICIENT_FUNDS', async () => {
    const startBalance = await walletBalance(explorer);

    // 1 billion DZD — guaranteed above any seeded test balance.
    const required = 1_000_000_000;
    const program = await createProgram(inc, { price: required, seatsTotal: 5 });

    const res = await applyToProgram(explorer, program.id, 'ONLINE');
    const body = await readError(res);
    expect(
      res.status(),
      `paid apply over balance (start=${startBalance}) should be 422 → ${JSON.stringify(body)}`,
    ).toBe(422);
    expect(errCode(body), `expected INSUFFICIENT_FUNDS → ${JSON.stringify(body)}`).toBe('INSUFFICIENT_FUNDS');

    const bodyRequired = errField(body, 'required');
    const bodyBalance = errField(body, 'balance');
    expect(bodyRequired, `required must equal program price → ${JSON.stringify(body)}`).toBe(required);
    expect(typeof bodyBalance, `balance must be a number → ${JSON.stringify(body)}`).toBe('number');
    expect(
      bodyBalance as number,
      `balance must be below required → ${JSON.stringify(body)}`,
    ).toBeLessThan(required);
  });

  // 6. Control: a FREE program still applies with an empty wallet (gate untouched).
  test('applying to a free program succeeds even with an empty wallet (gate is paid-only)', async () => {
    const program = await createProgram(inc, { price: 0, seatsTotal: 5 });

    const res = await applyToProgram(explorer, program.id, 'ONLINE');
    expect(
      res.status(),
      `free apply should be 201 (wallet untouched) → ${await res.text()}`,
    ).toBe(201);
  });
});
