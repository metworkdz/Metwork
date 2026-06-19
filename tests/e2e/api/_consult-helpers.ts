/**
 * Shared helpers for the instant-book, pay-first CONSULTATION e2e suite.
 *
 * Like `_helpers.ts`, these tests drive the JSON API directly (Playwright
 * `request` contexts) rather than the UI, so they are deterministic and can
 * build their own fixtures. They reuse the seeded `qa-mentor-id` mentor.
 *
 * IMPORTANT run constraints (mirrors the existing api suite):
 *   • The consultation project is meant to run SERIALLY (`--workers=1`) — every
 *     spec reconfigures the ONE shared `qa-mentor` (availability, minNotice) and
 *     mints a consultant session by ROTATING the mentor access token, which
 *     invalidates any other live token. Serial execution makes that safe.
 *   • Payments must be in MOCK SYNC mode (`MOCK_PAYMENT_MODE=sync`, the default)
 *     so a member top-up / guest checkout settles inside the request, giving an
 *     instantly-CONFIRMED booking with no second round-trip.
 *   • The consultant has no role login; we mint a portal session at runtime:
 *     admin generates the durable access token → POST /api/consultant/pin sets
 *     (first run) or verifies (reruns) the PIN and drops the session cookie.
 */
import { request as pwRequest, expect, type APIRequestContext } from '@playwright/test';
import { authStatePath } from '../global-setup';

export const BASE = 'http://localhost:3000';

/** Seeded consultant — see scripts/seed-test-users.ts (consultationFee 5000 DZD/h). */
export const MENTOR_ID = 'qa-mentor-id';
export const MENTOR_FEE_PER_HOUR = 5000;

/** Stable PIN: first run sets it on the seeded (PIN-less) mentor; reruns verify it. */
export const CONSULT_PIN = '4321';

export type Role = 'admin' | 'incubator' | 'builder' | 'founder' | 'explorer';

/* ───────────────────────────── Request contexts ───────────────────────────── */

export async function roleContext(role: Role): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: BASE, storageState: authStatePath(role) });
}

export async function guestContext(): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: BASE });
}

/* ───────────────────────────── Rate-limit evasion ───────────────────────────── */

function octet(): number {
  return 1 + Math.floor(Math.random() * 253);
}

/** Fresh random RFC-1918 IP, unique per call (collision-improbable). */
export function freshIp(): string {
  return `10.${octet()}.${octet()}.${octet()}`;
}

/** Header bag carrying a unique X-Forwarded-For for per-IP rate-limit isolation. */
export function xff(ip = freshIp()): Record<string, string> {
  return { 'x-forwarded-for': ip };
}

/** Idempotency key for instant-book (min 8 chars). */
export function clientRef(prefix = 'consult'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Consultant credit under the locked SUBSIDIZE split: round(base × 0.7), where
 * base = full undiscounted price (fee × dur/60). Independent of the user's
 * membership tier or any promo — the platform absorbs every discount.
 */
export function expectedConsultantShare(durationMinutes: number, feePerHour = MENTOR_FEE_PER_HOUR): number {
  const base = Math.round((durationMinutes / 60) * feePerHour);
  return Math.round(base * 0.7);
}

/* ───────────────────────────── Slot helpers ───────────────────────────── */

/** Template start times we seed into the mentor's weekly availability. */
export const SLOT_STARTS = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'] as const;

/** YYYY-MM-DD for `daysAhead` days from now (UTC date arithmetic). */
export function dateAhead(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Run-unique base day, seeded from the clock at module load. The local DB
 * persists bookings across runs, so a FIXED base day would collide with slots a
 * previous run already booked (→ spurious SLOT_NOT_BOOKABLE). A clock-seeded
 * base gives each run a fresh window, kept well under computeBookableSlots'
 * 366-day ceiling.
 */
const SLOT_BASE_DAY = 12 + (Math.floor(Date.now() / 1000) % 320);
let slotSeq = 0;

/**
 * Dispense a globally-UNIQUE future (date, time) slot. The module is a singleton
 * in the (single) consultation worker, so the sequence is shared across every
 * spec file — two tests anywhere never collide on the shared mentor. ~12+ days
 * out clears the 24h advance guard with comfortable margin.
 */
export function nextUniqueSlot(): { date: string; time: string } {
  const i = slotSeq++;
  const day = SLOT_BASE_DAY + Math.floor(i / SLOT_STARTS.length);
  const time = SLOT_STARTS[i % SLOT_STARTS.length]!;
  return { date: dateAhead(day), time };
}

/* ───────────────────────────── Mentor setup ───────────────────────────── */

/**
 * Generate a fresh durable access token for the seeded mentor (admin), then
 * establish a consultant portal session on a NEW request context by setting /
 * verifying the PIN. Returns the authenticated consultant context + the token.
 */
export async function mintConsultantContext(
  admin: APIRequestContext,
): Promise<{ ctx: APIRequestContext; token: string }> {
  const tokRes = await admin.post(`/api/admin/mentors/${MENTOR_ID}/access-token`);
  expect(tokRes.status(), `access-token → ${tokRes.status()} ${await tokRes.text()}`).toBe(200);
  const { token } = await tokRes.json();
  expect(token, 'access token missing').toBeTruthy();

  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const pinRes = await ctx.post('/api/consultant/pin', {
    headers: xff(),
    data: { token, pin: CONSULT_PIN, rememberDevice: false },
  });
  expect(
    pinRes.status(),
    `consultant pin sign-in → ${pinRes.status()} ${await pinRes.text()} (seeded PIN drift? reseed the local DB)`,
  ).toBe(200);
  return { ctx, token };
}

/**
 * Set the mentor's weekly availability (all 7 weekdays, the SLOT_STARTS hours),
 * timezone, notice window and buffer — as the consultant. Idempotent (overwrite).
 */
export async function setupMentorAvailability(
  consultant: APIRequestContext,
  opts: { minNoticeHours?: number; bufferMinutes?: number } = {},
): Promise<void> {
  const slots = SLOT_STARTS.map((start) => {
    const [h, m] = start.split(':').map(Number);
    const end = `${String(h! + 1).padStart(2, '0')}:${String(m!).padStart(2, '0')}`;
    return { start, end };
  });
  const weeklyAvailability = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots }));

  const res = await consultant.patch('/api/consultant/availability', {
    data: {
      weeklyAvailability,
      availabilityTimezone: 'Africa/Algiers',
      blockedDates: [],
      minNoticeHours: opts.minNoticeHours ?? 1,
      bufferMinutes: opts.bufferMinutes ?? 0,
    },
  });
  expect(res.status(), `set availability → ${res.status()} ${await res.text()}`).toBe(200);
}

/**
 * Update the notice window (used to force the reschedule TOO_LATE guard). The
 * availability schema requires the full weekly template, so we re-send it.
 */
export async function setMinNotice(consultant: APIRequestContext, hours: number): Promise<void> {
  await setupMentorAvailability(consultant, { minNoticeHours: hours });
}

/* ───────────────────────────── Booking actions ───────────────────────────── */

export interface InstantBookBody {
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
  date: string;
  time: string;
  durationMinutes?: number;
  promoCode?: string | null;
  clientReference?: string;
  locale?: 'en' | 'fr' | 'ar';
}

/** POST /api/mentors/:id/instant-book with sensible defaults. */
export async function instantBook(ctx: APIRequestContext, body: InstantBookBody) {
  return ctx.post(`/api/mentors/${MENTOR_ID}/instant-book`, {
    headers: xff(),
    data: {
      name: body.name ?? 'QA Client',
      email: body.email ?? 'qa.client@metwork.test',
      phone: body.phone ?? '+213700000000',
      message: body.message ?? 'Automated e2e consultation booking. Safe to ignore.',
      consultationDate: body.date,
      consultationTime: body.time,
      durationMinutes: body.durationMinutes ?? 60,
      promoCode: body.promoCode ?? null,
      locale: body.locale ?? 'fr',
      clientReference: body.clientReference ?? clientRef(),
    },
  });
}

/** Drive the guest hosted-checkout to a settled state (mock sync settles on init). */
export async function settleGuest(token: string, ip = freshIp()) {
  const ctx = await guestContext();
  try {
    const init = await ctx.post(`/api/consultation/pay/${token}`, {
      headers: xff(ip),
      data: { action: 'init' },
    });
    const verify = await ctx.post(`/api/consultation/pay/${token}`, {
      headers: xff(ip),
      data: { action: 'verify' },
    });
    return { initStatus: init.status(), verifyBody: await verify.json() };
  } finally {
    await ctx.dispose();
  }
}

/* ───────────────────────────── Reads ───────────────────────────── */

/** The consultant's earnings wallet (pending / available DZD). */
export async function consultantWallet(
  consultant: APIRequestContext,
): Promise<{ pending: number; available: number }> {
  const res = await consultant.get('/api/consultant/earnings');
  expect(res.status(), `earnings → ${res.status()} ${await res.text()}`).toBe(200);
  const body = await res.json();
  const w = body.wallet ?? {};
  return {
    pending: Number(w.pendingBalance ?? 0),
    available: Number(w.availableBalance ?? 0),
  };
}

/** A single consultant booking by id (PII + amount + status), or undefined. */
export async function consultantBooking(consultant: APIRequestContext, id: string) {
  const res = await consultant.get('/api/consultant/bookings');
  expect(res.status(), `bookings → ${res.status()} ${await res.text()}`).toBe(200);
  const { items } = await res.json();
  return (items as Array<Record<string, unknown>>).find((b) => b.id === id);
}

/** The seeded mentor's live per-hour consultation fee (DZD) — read at runtime
 *  so the amount assertions never hard-code a value that can drift in the seed. */
export async function getMentorFee(ctx: APIRequestContext): Promise<number> {
  const res = await ctx.get(`/api/mentors/${MENTOR_ID}`);
  expect(res.status(), `mentor fetch → ${res.status()} ${await res.text()}`).toBe(200);
  const body = await res.json();
  const m = body.mentor ?? body;
  const fee = Number(m.consultationFee ?? 0);
  expect(fee, 'mentor consultationFee should be > 0').toBeGreaterThan(0);
  return fee;
}

/** Read the caller's user wallet balance (DZD). */
export async function userWalletBalance(ctx: APIRequestContext): Promise<number> {
  const res = await ctx.get('/api/wallet/me');
  expect(res.status(), `wallet/me → ${res.status()} ${await res.text()}`).toBe(200);
  const w = await res.json();
  return typeof w.balance === 'number' ? w.balance : Number(w.balance ?? 0);
}

/** Create (or reuse) a CONSULTATION promo code at `percent`. Tolerates re-runs. */
export async function ensureConsultationPromo(
  admin: APIRequestContext,
  percent: number,
): Promise<string> {
  const code = `QACONSULT${percent}`;
  const res = await admin.post('/api/admin/promo-codes', {
    data: { code, discountPercent: percent, appliesTo: 'CONSULTATION', expiresAt: null, usageLimit: null },
  });
  // 201 created, or 409 already exists from a prior run — both are fine.
  expect([201, 409], `create promo ${code} → ${res.status()} ${await res.text()}`).toContain(res.status());
  return code;
}
