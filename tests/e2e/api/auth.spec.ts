/**
 * API-driven e2e: AUTH — signup (every signup role) · OTP delivery + verify ·
 * resend (email + WhatsApp channels) · login · forgot-password.
 *
 * Why API-level: the OTP is never exposed as plaintext (only HMAC is stored),
 * so a UI flow couldn't "read the code". Instead we recover it from the local
 * DB via `_otp.ts` (HMAC reverse with the known AUTH_SECRET) — see that file.
 *
 * Rate-limit hygiene (every limiter keyed on IP / email / phone):
 *   • signup            5 / IP / hour      → unique xff() per signup
 *   • verify-otp        30 / IP / 15m, 20 / user / hour
 *   • resend-otp        10 / IP / hour, 5 / phone / hour
 *   • login             20 / IP / 15m, 10 / email / hour → fresh users + xff()
 *   • forgot-password   5 / IP / hour, 3 / email / hour  → fresh users + xff()
 * Every account uses a UNIQUE email + phone so reruns never collide with the
 * seeded users or each other.
 *
 * Reset-password REJECTION paths (bogus / weak / mismatched) are covered in
 * auth-wallet.spec.ts; the green path is infeasible to assert E2E (the reset
 * token is a 32-byte random value stored only as a SHA-256 hash). Here we cover
 * the part that IS observable: forgot-password always 204s AND issues a token.
 */
import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import * as fs from 'node:fs';
import { BASE, xff, freshIp } from './_helpers';
import { getSignupOtpByPendingId } from './_otp';

type SignupRole = 'ENTREPRENEUR' | 'INVESTOR' | 'INCUBATOR' | 'TRAINER';

/** Unique-ish suffix so emails/phones never collide across reruns. */
function uniq(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** A unique, schema-valid Algerian mobile (+213 6 ######## = 8 trailing digits). */
function freshPhone(): string {
  const eight = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  return `+2136${eight}`;
}

interface NewAccount {
  email: string;
  phone: string;
  password: string;
  fullName: string;
}

function newAccount(role: SignupRole): NewAccount {
  return {
    email: `qa.signup.${role.toLowerCase()}.${uniq()}@metwork.test`,
    phone: freshPhone(),
    password: 'QaSignup2026!',
    fullName: `QA ${role} ${uniq()}`,
  };
}

/** POST /api/auth/signup with a guaranteed-unique source IP. Returns pending id. */
async function signup(
  ctx: APIRequestContext,
  role: SignupRole,
  acc: NewAccount,
): Promise<string> {
  const res = await ctx.post('/api/auth/signup', {
    headers: xff(),
    data: {
      role,
      fullName: acc.fullName,
      email: acc.email,
      phone: acc.phone,
      city: 'Alger',
      password: acc.password,
      confirmPassword: acc.password,
      acceptTerms: true,
      acceptPrivacy: true,
      ...(role === 'INCUBATOR' ? { incubatorName: `QA Hub ${uniq()}` } : {}),
    },
  });
  expect(res.status(), `signup ${role} → ${res.status()} ${await res.text()}`).toBe(201);
  const body = await res.json();
  expect(body.requiresOtp, 'signup should require OTP').toBe(true);
  expect(typeof body.userId, 'signup should return a pending userId').toBe('string');
  return body.userId as string;
}

/** POST /api/auth/verify-otp. */
async function verifyOtp(ctx: APIRequestContext, pendingId: string, code: string) {
  return ctx.post('/api/auth/verify-otp', { headers: xff(), data: { userId: pendingId, code } });
}

test.describe('Auth — signup / OTP / resend / login / forgot-password', () => {
  let ctx: APIRequestContext;

  test.beforeAll(async () => {
    ctx = await pwRequest.newContext({ baseURL: BASE });
  });
  test.afterAll(async () => {
    await ctx.dispose();
  });

  // 1. Signup → OTP → verify → promotion, for every signup role.
  for (const role of ['ENTREPRENEUR', 'INVESTOR', 'INCUBATOR', 'TRAINER'] as const) {
    test(`signup as ${role} issues an OTP, verifies, and promotes to an ACTIVE account`, async () => {
      // Fresh cookie jar per account so the session cookie doesn't bleed.
      const guest = await pwRequest.newContext({ baseURL: BASE });
      try {
        const acc = newAccount(role);
        const pendingId = await signup(guest, role, acc);

        const code = getSignupOtpByPendingId(pendingId);
        const res = await verifyOtp(guest, pendingId, code);
        expect(res.status(), `verify ${role} → ${res.status()} ${await res.text()}`).toBe(200);

        const body = await res.json();
        expect(body.user?.email).toBe(acc.email);
        // INCUBATOR becomes ADMIN only on a fresh platform (no admin yet). The
        // seed always creates an admin, so it stays INCUBATOR — but accept the
        // bootstrap case so the suite is robust on an un-seeded DB.
        const allowed = role === 'INCUBATOR' ? ['INCUBATOR', 'ADMIN'] : [role];
        expect(allowed, `role should be one of ${allowed} → ${body.user?.role}`).toContain(
          body.user?.role,
        );

        // Session cookie was set by verify-otp → /auth/me is now authenticated.
        const me = await guest.get('/api/auth/me');
        expect(me.status(), 'authenticated /auth/me after verify').toBe(200);
        const meBody = await me.json();
        expect(meBody.user?.email ?? meBody.email).toBe(acc.email);
      } finally {
        await guest.dispose();
      }
    });
  }

  // 2. The signup OTP is single-use: a verified code cannot be replayed.
  test('a consumed signup OTP cannot be reused', async () => {
    const guest = await pwRequest.newContext({ baseURL: BASE });
    try {
      const acc = newAccount('ENTREPRENEUR');
      const pendingId = await signup(guest, 'ENTREPRENEUR', acc);
      const code = getSignupOtpByPendingId(pendingId);

      const first = await verifyOtp(guest, pendingId, code);
      expect(first.status(), 'first verify succeeds').toBe(200);

      // Pending record is gone (promoted) → second attempt is rejected.
      const second = await verifyOtp(guest, pendingId, code);
      expect(second.status(), 'replayed OTP is rejected').toBe(400);
      const body = await second.json();
      expect(body.error?.code).toBe('INVALID_OTP');
    } finally {
      await guest.dispose();
    }
  });

  // 3. resend-otp via EMAIL: 204, and the freshly-issued code verifies.
  test('resend-otp via email re-issues a code that verifies', async () => {
    const guest = await pwRequest.newContext({ baseURL: BASE });
    try {
      const acc = newAccount('ENTREPRENEUR');
      const pendingId = await signup(guest, 'ENTREPRENEUR', acc);

      const resend = await guest.post('/api/auth/resend-otp', {
        headers: xff(),
        data: { userId: pendingId, channel: 'email' },
      });
      expect(resend.status(), `resend(email) → ${resend.status()}`).toBe(204);

      // Brute-force AFTER the resend — it overwrote the original otpHash.
      const code = getSignupOtpByPendingId(pendingId);
      const res = await verifyOtp(guest, pendingId, code);
      expect(res.status(), `verify after email resend → ${await res.text()}`).toBe(200);
    } finally {
      await guest.dispose();
    }
  });

  // 4. resend-otp via WHATSAPP: 204, and the freshly-issued code verifies. Also
  //    proves the resend INVALIDATES the prior code (a new code is minted).
  test('resend-otp via whatsapp re-issues a code and invalidates the previous one', async () => {
    const guest = await pwRequest.newContext({ baseURL: BASE });
    try {
      const acc = newAccount('ENTREPRENEUR');
      const pendingId = await signup(guest, 'ENTREPRENEUR', acc);
      const original = getSignupOtpByPendingId(pendingId);

      const resend = await guest.post('/api/auth/resend-otp', {
        headers: xff(),
        data: { userId: pendingId, channel: 'whatsapp' },
      });
      expect(resend.status(), `resend(whatsapp) → ${resend.status()}`).toBe(204);

      const fresh = getSignupOtpByPendingId(pendingId);
      // Overwhelmingly likely to differ; assert the OLD code now fails either way.
      const stale = await verifyOtp(guest, pendingId, original);
      if (fresh !== original) {
        expect(stale.status(), 'previous code should be rejected after resend').toBe(400);
      }

      const ok = await verifyOtp(guest, pendingId, fresh);
      expect(ok.status(), `verify with resent whatsapp code → ${await ok.text()}`).toBe(200);
    } finally {
      await guest.dispose();
    }
  });

  // 5. resend-otp NEVER reveals account existence — 204 for an unknown id.
  test('resend-otp for an unknown user still returns 204 (no enumeration)', async () => {
    const res = await ctx.post('/api/auth/resend-otp', {
      headers: xff(),
      data: { userId: `nonexistent-${uniq()}`, channel: 'email' },
    });
    expect(res.status()).toBe(204);
  });

  // 6. Login with correct credentials on a freshly-verified account.
  test('login with correct credentials returns the user and sets a session', async () => {
    const setup = await pwRequest.newContext({ baseURL: BASE });
    const acc = newAccount('ENTREPRENEUR');
    try {
      const pendingId = await signup(setup, 'ENTREPRENEUR', acc);
      const code = getSignupOtpByPendingId(pendingId);
      expect((await verifyOtp(setup, pendingId, code)).status()).toBe(200);
    } finally {
      await setup.dispose();
    }

    // Fresh context (no session) → login must establish one.
    const guest = await pwRequest.newContext({ baseURL: BASE });
    try {
      const res = await guest.post('/api/auth/login', {
        headers: xff(),
        data: { email: acc.email, password: acc.password },
      });
      expect(res.status(), `login → ${res.status()} ${await res.text()}`).toBe(200);
      const body = await res.json();
      expect(body.user?.email).toBe(acc.email);

      const me = await guest.get('/api/auth/me');
      expect(me.status(), 'login set a usable session').toBe(200);
    } finally {
      await guest.dispose();
    }
  });

  // 7. Login with a wrong password → generic 401 INVALID_CREDENTIALS.
  test('login with a wrong password returns 401 INVALID_CREDENTIALS', async () => {
    const setup = await pwRequest.newContext({ baseURL: BASE });
    const acc = newAccount('ENTREPRENEUR');
    try {
      const pendingId = await signup(setup, 'ENTREPRENEUR', acc);
      expect((await verifyOtp(setup, pendingId, getSignupOtpByPendingId(pendingId))).status()).toBe(200);
    } finally {
      await setup.dispose();
    }

    const res = await ctx.post('/api/auth/login', {
      headers: xff(),
      data: { email: acc.email, password: 'WrongPassword9!' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe('INVALID_CREDENTIALS');
  });

  // 8. forgot-password ALWAYS 204s, and for a real user it issues a reset token
  //    row (asserted directly against the local DB — the plaintext token is only
  //    ever emailed, so we verify the side-effect, not the value).
  test('forgot-password returns 204 and issues a single-use reset token for a real user', async () => {
    const setup = await pwRequest.newContext({ baseURL: BASE });
    const acc = newAccount('ENTREPRENEUR');
    let userId: string;
    try {
      const pendingId = await signup(setup, 'ENTREPRENEUR', acc);
      const verified = await verifyOtp(setup, pendingId, getSignupOtpByPendingId(pendingId));
      expect(verified.status()).toBe(200);
      userId = (await verified.json()).user.id as string;
    } finally {
      await setup.dispose();
    }

    const res = await ctx.post('/api/auth/forgot-password', {
      headers: xff(),
      data: { email: acc.email },
    });
    expect(res.status(), 'forgot-password always 204s').toBe(204);

    // A passwordResets row now exists for this user (unconsumed).
    const dbPath = process.env.LOCAL_DB_PATH ?? '.local-db.json';
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8')) as {
      passwordResets?: Array<{ userId: string; consumed: boolean }>;
    };
    const token = (db.passwordResets ?? []).find((t) => t.userId === userId && !t.consumed);
    expect(token, 'a reset token should have been issued for the user').toBeTruthy();
  });

  // 9. forgot-password for an unknown email is indistinguishable — still 204.
  test('forgot-password for an unknown email also returns 204 (no enumeration)', async () => {
    const res = await ctx.post('/api/auth/forgot-password', {
      headers: xff(freshIp()),
      data: { email: `nobody.${uniq()}@metwork.test` },
    });
    expect(res.status()).toBe(204);
  });
});
