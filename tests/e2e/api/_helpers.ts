/**
 * Shared helpers for the API-driven business-logic e2e suite.
 *
 * These tests exercise the capacity gates, price guards, waitlist trigger and
 * wallet rules DIRECTLY through the JSON API (Playwright `request` contexts),
 * rather than driving the UI. That makes them deterministic — no flaky sheet /
 * modal interactions — and lets one test create its OWN isolated fixtures.
 *
 * IMPORTANT design constraints baked into these helpers:
 *
 *  1. Auth: we REUSE the cookies saved by `tests/e2e/global-setup.ts` (one
 *     login per role, written to tests/.auth/<role>.json). We never re-login
 *     per test, because the login route caps each EMAIL at 10 logins/hour.
 *
 *  2. Registration rate-limit: POST /api/registrations is capped at 5 requests
 *     per IP per 10 min, keyed on the `x-forwarded-for` header. We therefore
 *     send a UNIQUE fake IP on every registration call (`freshIp()`), so the
 *     limit can never bleed across tests. ALWAYS pass `xff()` headers when
 *     hitting /api/registrations.
 *
 *  3. Shared JSON document: the whole suite runs SERIALLY (workers:1) against
 *     ONE dev server + ONE local DB. Each test still creates its own fixtures
 *     (unique programs/events) so assertions never depend on global counts.
 */
import { request as pwRequest, expect, type APIRequestContext } from '@playwright/test';
import { authStatePath } from '../global-setup';

export const BASE = 'http://localhost:3000';

export type Role = 'admin' | 'incubator' | 'builder' | 'founder' | 'explorer';

/** Seeded entity ids — see scripts/seed-test-users.ts. */
export const SEED = {
  adminId: 'qa-admin-id',
  incubatorUserId: 'qa-incubator-user-id',
  incubatorProfileId: 'qa-incubator-profile-id',
  builderId: 'qa-builder-id',
  founderId: 'qa-founder-id',
  explorerId: 'qa-explorer-id',
  spaceId: 'qa-space-id-001',
  mentorId: 'qa-mentor-id',
} as const;

/* ───────────────────────────── Request contexts ───────────────────────────── */

/**
 * Build a request context authenticated as `role`, reusing the cookies saved
 * by global-setup. No fresh login → no login-rate-limit pressure.
 *
 * Remember to `await ctx.dispose()` in a finally / afterEach.
 */
export async function roleContext(role: Role): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: BASE, storageState: authStatePath(role) });
}

/** Unauthenticated context — for public/guest endpoints. */
export async function guestContext(): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: BASE });
}

/* ───────────────────────────── Rate-limit evasion ───────────────────────────── */

function octet(): number {
  return 1 + Math.floor(Math.random() * 253);
}

/** A fresh random RFC-1918 IP, unique per call (collision-improbable). */
export function freshIp(): string {
  return `10.${octet()}.${octet()}.${octet()}`;
}

/**
 * Header bag carrying a unique X-Forwarded-For. Spread into the `headers`
 * option of any rate-limited request (esp. POST /api/registrations) so each
 * call lands in its own rate-limit bucket.
 */
export function xff(ip = freshIp()): Record<string, string> {
  return { 'x-forwarded-for': ip };
}

/* ───────────────────────────── Misc helpers ───────────────────────────── */

/** Idempotency key for apply/register/booking endpoints (min 8 chars). */
export function clientRef(prefix = 'qa'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** ISO datetime `days` from now (negative = past). */
export function isoFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/** Unique-ish suffix for fixture titles/slugs. */
function uniq(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ───────────────────────────── Fixture creators ───────────────────────────── */
/*
 * All fixtures are created as the INCUBATOR (qa-incubator). That account is on
 * the COMMISSION plan, so the API forces acceptedPaymentMethods to ['ONLINE'].
 * Free fixtures (price 0) skip the wallet entirely, so payment method is moot
 * for capacity tests. Use a high price only when you explicitly want to test
 * the wallet/insufficient-funds path.
 */

export interface ProgramOpts {
  price?: number;
  seatsTotal?: number;
  /** Days from now until the application deadline. Negative = already passed. */
  deadlineDays?: number;
  type?: 'INCUBATION' | 'ACCELERATION' | 'TRAINING' | 'BOOTCAMP' | 'WORKSHOP';
  title?: string;
}

/** Create a program fixture as the incubator. Returns the full ProgramRecord (has `id` UUID). */
export async function createProgram(
  inc: APIRequestContext,
  opts: ProgramOpts = {},
): Promise<{ id: string; seatsTotal: number; price: number; slug: string; [k: string]: unknown }> {
  const deadlineDays = opts.deadlineDays ?? 30;
  const res = await inc.post('/api/incubator/programs', {
    data: {
      title: opts.title ?? `QA Program ${uniq()}`,
      description: 'Automated e2e capacity-test fixture program. Safe to delete.',
      type: opts.type ?? 'INCUBATION',
      city: 'Alger',
      price: opts.price ?? 0,
      seatsTotal: opts.seatsTotal ?? 2,
      deadline: isoFromNow(deadlineDays),
      // startDate/endDate must be valid ISO; keep them after the deadline.
      startDate: isoFromNow(Math.max(deadlineDays, 0) + 10),
      endDate: isoFromNow(Math.max(deadlineDays, 0) + 40),
      acceptedPaymentMethods: ['ONLINE'],
    },
  });
  expect(res.status(), `createProgram failed → ${res.status()} ${await res.text()}`).toBe(201);
  return res.json();
}

export interface EventOpts {
  price?: number;
  capacity?: number;
  /** Days from now until the event happens. Negative = already passed. */
  eventDays?: number;
  title?: string;
}

/** Create an event fixture as the incubator. Returns the full EventRecord (has `id` UUID). */
export async function createEvent(
  inc: APIRequestContext,
  opts: EventOpts = {},
): Promise<{ id: string; capacity: number; price: number; slug: string; [k: string]: unknown }> {
  const res = await inc.post('/api/incubator/events', {
    data: {
      title: opts.title ?? `QA Event ${uniq()}`,
      description: 'Automated e2e capacity-test fixture event. Safe to delete.',
      city: 'Alger',
      price: opts.price ?? 0,
      isOnline: false,
      capacity: opts.capacity ?? 2,
      eventDate: isoFromNow(opts.eventDays ?? 30),
      acceptedPaymentMethods: ['ONLINE'],
    },
  });
  expect(res.status(), `createEvent failed → ${res.status()} ${await res.text()}`).toBe(201);
  return res.json();
}

export interface SpaceOpts {
  pricePerHour?: number | null;
  pricePerDay?: number | null;
  pricePerMonth?: number | null;
  capacity?: number;
  workingDays?: number[];
  openingTime?: string;
  closingTime?: string;
  name?: string;
}

/** Create a space fixture as the incubator. Returns the full SpaceRecord (has `id` UUID). */
export async function createSpace(
  inc: APIRequestContext,
  opts: SpaceOpts = {},
): Promise<{ id: string; [k: string]: unknown }> {
  // Distinguish an explicit `null` (no price for that unit) from `undefined`
  // (use the default). `??` would wrongly coerce an intentional null to the
  // default, breaking the UNIT_NOT_AVAILABLE fixture.
  const pricePerHour = opts.pricePerHour !== undefined ? opts.pricePerHour : 500;
  const pricePerDay = opts.pricePerDay !== undefined ? opts.pricePerDay : 3000;
  const pricePerMonth = opts.pricePerMonth !== undefined ? opts.pricePerMonth : null;
  const res = await inc.post('/api/incubator/spaces', {
    data: {
      name: opts.name ?? `QA Space ${uniq()}`,
      description: 'Automated e2e space-booking fixture. Safe to delete.',
      category: 'COWORKING',
      city: 'Alger',
      pricePerHour,
      pricePerDay,
      pricePerMonth,
      capacity: opts.capacity ?? 20,
      amenities: ['wifi'],
      acceptedPaymentMethods: ['ONLINE'],
      workingDays: opts.workingDays ?? [1, 2, 3, 4, 5],
      openingTime: opts.openingTime ?? '09:00',
      closingTime: opts.closingTime ?? '18:00',
    },
  });
  expect(res.status(), `createSpace failed → ${res.status()} ${await res.text()}`).toBe(201);
  return res.json();
}

/* ───────────────────────────── Action helpers ───────────────────────────── */

/** Apply to a program as the given (already-authenticated) context. */
export async function applyToProgram(
  ctx: APIRequestContext,
  programId: string,
  paymentMethod: 'ONLINE' | 'CASH' = 'ONLINE',
) {
  return ctx.post(`/api/programs/${programId}/apply`, {
    data: { clientReference: clientRef('apply'), paymentMethod },
  });
}

/** Register for an event as the given (already-authenticated) context. */
export async function registerForEvent(
  ctx: APIRequestContext,
  eventId: string,
  paymentMethod: 'ONLINE' | 'CASH' = 'ONLINE',
) {
  return ctx.post(`/api/events/${eventId}/register`, {
    data: { clientReference: clientRef('reg'), paymentMethod },
  });
}

/**
 * Submit a public/guest registration. ALWAYS sends a unique X-Forwarded-For so
 * the 5/IP/10min limit never crosses tests. `ctx` may be a guest OR an
 * authenticated context (authenticated → registration gets a userId attached).
 */
export async function submitRegistration(
  ctx: APIRequestContext,
  entityType: 'PROGRAM' | 'EVENT',
  entityId: string,
  email: string,
  fullName = 'QA Guest',
) {
  return ctx.post('/api/registrations', {
    headers: xff(),
    data: { entityType, entityId, fullName, email, phone: '+213700112233', answers: [] },
  });
}

/** GET the unified attendance/status for a program. */
export async function programStatus(ctx: APIRequestContext, programId: string) {
  const res = await ctx.get(`/api/programs/${programId}/status`);
  expect(res.status(), `programStatus → ${res.status()}`).toBe(200);
  return res.json() as Promise<{
    programId: string;
    capacity: number;
    taken: number;
    deadline: string;
    deadlinePassed: boolean;
    mine: { bookingId: string; status: string; createdAt: string } | null;
  }>;
}

/** GET the unified attendance/status for an event. */
export async function eventStatus(ctx: APIRequestContext, eventId: string) {
  const res = await ctx.get(`/api/events/${eventId}/status`);
  expect(res.status(), `eventStatus → ${res.status()}`).toBe(200);
  return res.json() as Promise<{
    eventId: string;
    capacity: number;
    taken: number;
    eventDate: string;
    eventPassed: boolean;
    mine: { bookingId: string; status: string; createdAt: string } | null;
  }>;
}

/** Read the caller's wallet balance (in DZD). */
export async function walletBalance(ctx: APIRequestContext): Promise<number> {
  const res = await ctx.get('/api/wallet/me');
  expect(res.status(), `walletBalance → ${res.status()}`).toBe(200);
  const w = await res.json();
  return typeof w.balance === 'number' ? w.balance : Number(w.balance ?? 0);
}

/* ───────────────────────────── Space-booking time helpers ───────────────────────────── */
/*
 * The booking working-hours / working-day gate computes day-of-week and HH:MM
 * from the ISO timestamp in **UTC** (see src/server/bookings/service.ts:
 * isoToUtcDow / isoToUtcMinutes). Build all booking windows in UTC so the
 * assertions are deterministic regardless of the machine timezone.
 */

/** A future date (time zeroed in UTC) guaranteed to be a Mon–Fri (UTC). */
export function futureWeekdayUtc(daysAhead = 4): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(0, 0, 0, 0);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** A future Sunday (UTC, dow 0), time zeroed. Useful for NOT_A_WORKING_DAY. */
export function futureSundayUtc(daysAhead = 2): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(0, 0, 0, 0);
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** Build an ISO [start, end) window on `base` between two UTC hours. */
export function utcWindow(
  base: Date,
  startHour: number,
  endHour: number,
): { startsAt: string; endsAt: string } {
  const s = new Date(base); s.setUTCHours(startHour, 0, 0, 0);
  const e = new Date(base); e.setUTCHours(endHour, 0, 0, 0);
  return { startsAt: s.toISOString(), endsAt: e.toISOString() };
}

/**
 * Create a space booking as the given context.
 * Use paymentMethod 'CASH' (reserve-only) in tests so a 0-balance wallet does
 * not trip INSUFFICIENT_FUNDS — the booking is still CONFIRMED-equivalent for
 * the overlap / capacity gates we want to exercise.
 */
export async function bookSpace(
  ctx: APIRequestContext,
  spaceId: string,
  unit: 'HOUR' | 'DAY' | 'MONTH',
  startsAt: string,
  endsAt: string,
  paymentMethod: 'ONLINE' | 'CASH' = 'CASH',
) {
  return ctx.post('/api/bookings', {
    data: { spaceId, unit, startsAt, endsAt, clientReference: clientRef('book'), paymentMethod },
  });
}
