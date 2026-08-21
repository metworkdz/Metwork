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
import * as fs from 'node:fs';
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
  /** Space category. Defaults to COWORKING. */
  category?: 'COWORKING' | 'PRIVATE_OFFICE' | 'TRAINING_ROOM' | 'DOMICILIATION';
  /** Per-space duration discounts (0 < percent < 100, minQty > 0). */
  durationDiscounts?: { unit: 'HOUR' | 'DAY'; minQty: number; percent: number }[];
  /** Accepted surfaces. Defaults to ['ONLINE']; pass ['ONLINE','CASH'] for split/deposit. */
  acceptedPaymentMethods?: ('ONLINE' | 'CASH')[];
  /** Configured cash deposit (CASH_DEPOSIT non-split path). */
  cashDepositType?: 'FIXED' | 'PERCENT';
  cashDepositValue?: number;
  /** COWORKING desk names — capacity is derived from these server-side. */
  deskNames?: string[];
  /** DOMICILIATION address-slot count. */
  domiciliationSlots?: number;
  /** Reservation mode. Omit for the legacy pay-escrow-then-approve flow. */
  reservationMode?: 'INSTANT' | 'REQUEST';
}

/** Create a space fixture as the incubator. Returns the full SpaceRecord (has `id` UUID). */
export async function createSpace(
  inc: APIRequestContext,
  opts: SpaceOpts = {},
): Promise<{ id: string; capacity: number; durationDiscounts?: unknown[]; [k: string]: unknown }> {
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
      category: opts.category ?? 'COWORKING',
      city: 'Alger',
      pricePerHour,
      pricePerDay,
      pricePerMonth,
      capacity: opts.capacity ?? 20,
      amenities: ['wifi'],
      acceptedPaymentMethods: opts.acceptedPaymentMethods ?? ['ONLINE'],
      workingDays: opts.workingDays ?? [1, 2, 3, 4, 5],
      openingTime: opts.openingTime ?? '09:00',
      closingTime: opts.closingTime ?? '18:00',
      ...(opts.durationDiscounts ? { durationDiscounts: opts.durationDiscounts } : {}),
      ...(opts.cashDepositType ? { cashDepositType: opts.cashDepositType } : {}),
      ...(opts.cashDepositValue !== undefined ? { cashDepositValue: opts.cashDepositValue } : {}),
      ...(opts.deskNames ? { deskNames: opts.deskNames } : {}),
      ...(opts.domiciliationSlots !== undefined ? { domiciliationSlots: opts.domiciliationSlots } : {}),
      ...(opts.reservationMode ? { reservationMode: opts.reservationMode } : {}),
    },
  });
  expect(res.status(), `createSpace failed → ${res.status()} ${await res.text()}`).toBe(201);
  return res.json();
}

/**
 * Replace a space's blocked dates / time-range blackouts (PUT availability).
 * Send `unavailableDates: []` to clear all full-day blocks. As the incubator.
 */
export async function setSpaceBlackouts(
  inc: APIRequestContext,
  spaceId: string,
  body: { unavailableDates: string[]; blackouts?: { date: string; from?: string; to?: string }[] },
): Promise<void> {
  const res = await inc.put(`/api/incubator/spaces/${spaceId}/availability`, { data: body });
  expect(res.status(), `setSpaceBlackouts → ${res.status()} ${await res.text()}`).toBe(200);
}

/**
 * Create an offline/manual booking as the incubator (auto-CONFIRMED,
 * paymentMethod 'manual', holds a seat in the availability gate).
 */
export async function manualBooking(
  inc: APIRequestContext,
  body: {
    itemKind: 'SPACE' | 'PROGRAM';
    itemId: string;
    unit: 'HOUR' | 'HALF_DAY' | 'DAY' | 'MONTH';
    startsAt: string;
    endsAt: string;
    quantity?: number;
    totalAmount?: number;
    clientName?: string;
    clientPhone?: string;
    /** Desk / office unit — REQUIRED for COWORKING / PRIVATE_OFFICE manual bookings. */
    deskName?: string;
  },
) {
  return inc.post('/api/incubator/manual-bookings', {
    data: {
      itemKind: body.itemKind,
      itemId: body.itemId,
      clientName: body.clientName ?? `QA Walk-in ${uniq()}`,
      clientPhone: body.clientPhone ?? '+213700112233',
      unit: body.unit,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      quantity: body.quantity ?? 1,
      totalAmount: body.totalAmount ?? 0,
      ...(body.deskName ? { deskName: body.deskName } : {}),
    },
  });
}

/** Public canonical desk availability (`GET /api/spaces/:id/desks?date=`). */
export async function getPublicDesks(
  ctx: APIRequestContext,
  spaceId: string,
  date: string,
): Promise<string[]> {
  const res = await ctx.get(`/api/spaces/${spaceId}/desks?date=${date}`);
  expect(res.status(), `getPublicDesks → ${res.status()} ${await res.text()}`).toBe(200);
  const body = await res.json();
  return Array.isArray(body.available) ? body.available : [];
}

/**
 * Top up the caller's wallet via the mock provider (sync mode → settles in
 * the request). Returns the new balance. Throws if the top-up didn't complete.
 */
export async function topUp(ctx: APIRequestContext, amount: number): Promise<number> {
  const res = await ctx.post('/api/wallet/topup', {
    data: { amount, returnUrl: `${BASE}/fr/dashboard/entrepreneur/wallet` },
  });
  expect(res.status(), `topUp → ${res.status()} ${await res.text()}`).toBe(201);
  const body = await res.json();
  expect(body.status, `top-up should settle synchronously (mock sync) → ${JSON.stringify(body)}`).toBe(
    'COMPLETED',
  );
  return typeof body.balance === 'number' ? body.balance : Number(body.balance ?? 0);
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

/* ───────────────────────────── Server-state reads (local DB) ───────────────────────────── */
/*
 * The e2e server runs with USE_LOCAL_DB=true and flushes every write
 * synchronously to `.local-db.json`. These helpers read that file so a spec can
 * assert against the AUTHORITATIVE server state (booking lifecycle, refunds,
 * promo counters) — not just whatever a response DTO happened to surface. Safe
 * because the server is the only writer; the test process only ever reads.
 */

export interface BookingView {
  id: string;
  userId: string | null;
  status: string;
  paymentMethod?: string;
  paymentMode?: string;
  paymentStatus?: string;
  source?: string;
  clientReference?: string;
  payToken?: string | null;
  totalAmount?: number;
  onlinePaidAmount?: number;
  cashRemainingAmount?: number;
  itemId?: string;
  itemKind?: string;
  unit?: string;
  startsAt?: string;
  endsAt?: string;
  settledAt?: string | null;
  /** Receipt / refund dedup stamps — assert "dispatched exactly once". */
  depositReceiptSentAt?: string | null;
  finalReceiptSentAt?: string | null;
  refundAlertSentAt?: string | null;
}

export interface LocalDbView {
  users: Array<{ id: string; email: string; role: string }>;
  bookings: BookingView[];
  mentorBookings: Array<Record<string, unknown>>;
  wallets: Array<{ id: string; userId: string; balance: number }>;
  transactions: Array<Record<string, unknown>>;
  promoCodes: Array<{ id: string; code: string; isActive: boolean; usedCount: number; discountPercent: number }>;
  withdrawalRequests: Array<Record<string, unknown>>;
}

/** Parse the local DB document (the server's source of truth in e2e mode). */
export function readLocalDb(): LocalDbView {
  const p = process.env.LOCAL_DB_PATH ?? '.local-db.json';
  return JSON.parse(fs.readFileSync(p, 'utf8')) as LocalDbView;
}

/** Find a SPACE/PROGRAM/EVENT booking by its clientReference (or undefined). */
export function findBookingByRef(ref: string): BookingView | undefined {
  return readLocalDb().bookings.find((b) => b.clientReference === ref);
}

/** Find a booking by its pay token (card/guest hosted-checkout intent). */
export function findBookingByPayToken(token: string): BookingView | undefined {
  return readLocalDb().bookings.find((b) => b.payToken === token);
}

/**
 * Read the REQUEST-mode approval pay link for a booking from the e2e email
 * sink (`.e2e-emails.jsonl`, written by the notifier under USE_LOCAL_DB).
 * The DB stores only the token's SHA-256 hash, so the raw link is observable
 * ONLY via the recorded would-be email — exactly like a real client.
 * Returns the LAST recorded link (a re-approve must not mint a new one).
 */
export function lastPayLinkFor(bookingId: string): { payUrl: string; token: string } | undefined {
  const dbPath = process.env.LOCAL_DB_PATH ?? '.local-db.json';
  const sink = `${dbPath.slice(0, dbPath.lastIndexOf('/') + 1)}.e2e-emails.jsonl`;
  let raw: string;
  try {
    raw = fs.readFileSync(sink, 'utf8');
  } catch {
    return undefined;
  }
  const lines = raw.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const rec = JSON.parse(lines[i]!) as { kind?: string; bookingId?: string; payUrl?: string };
      if (rec.kind === 'booking-approved-pay-link' && rec.bookingId === bookingId && rec.payUrl) {
        const token = new URL(rec.payUrl).searchParams.get('token') ?? '';
        return { payUrl: rec.payUrl, token };
      }
    } catch { /* skip malformed line */ }
  }
  return undefined;
}

/** Count e2e-sink emails of a kind for a booking (idempotency assertions). */
export function countSinkEmails(kind: string, bookingId: string): number {
  const dbPath = process.env.LOCAL_DB_PATH ?? '.local-db.json';
  const sink = `${dbPath.slice(0, dbPath.lastIndexOf('/') + 1)}.e2e-emails.jsonl`;
  let raw: string;
  try {
    raw = fs.readFileSync(sink, 'utf8');
  } catch {
    return 0;
  }
  return raw
    .trim()
    .split('\n')
    .filter((l) => {
      try {
        const rec = JSON.parse(l) as { kind?: string; bookingId?: string };
        return rec.kind === kind && rec.bookingId === bookingId;
      } catch {
        return false;
      }
    }).length;
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
  /** Pass an explicit idempotency key to exercise the replay path; defaults to a fresh one. */
  clientReference: string = clientRef('book'),
) {
  return ctx.post('/api/bookings', {
    data: { spaceId, unit, startsAt, endsAt, clientReference, paymentMethod },
  });
}

/* ───────────────── Availability calendar (single canonical source) ───────────────── */

/** One unavailable span from the public availability read. */
export interface AvailabilityInterval {
  start: string;
  end: string;
  kind: 'BOOKING' | 'BLOCK';
  allDay: boolean;
}

export interface AvailabilityView {
  spaceId: string;
  from: string;
  to: string;
  capacity: number;
  workingDays: number[];
  openingTime: string;
  closingTime: string;
  intervals: AvailabilityInterval[];
}

/**
 * Read the SINGLE canonical public availability endpoint (`GET
 * /api/spaces/:id/availability?from&to`). Public — any context works.
 */
export async function getAvailability(
  ctx: APIRequestContext,
  spaceId: string,
  from: string,
  to: string,
): Promise<AvailabilityView> {
  const res = await ctx.get(`/api/spaces/${spaceId}/availability?from=${from}&to=${to}`);
  expect(res.status(), `availability → ${res.status()} ${await res.text()}`).toBe(200);
  return res.json();
}

/** True iff `date` (YYYY-MM-DD) carries an interval of the given kind. */
export function hasInterval(
  view: AvailabilityView,
  date: string,
  kind: 'BOOKING' | 'BLOCK',
): boolean {
  return view.intervals.some((iv) => iv.kind === kind && iv.start.slice(0, 10) === date);
}

/** POST block — block full-day dates (additive, idempotent), as the incubator. */
export function blockSpaceDates(inc: APIRequestContext, spaceId: string, dates: string[]) {
  return inc.post(`/api/incubator/spaces/${spaceId}/availability`, { data: { dates } });
}

/** DELETE unblock — release full-day dates (idempotent), as the incubator. */
export function unblockSpaceDates(inc: APIRequestContext, spaceId: string, dates: string[]) {
  return inc.delete(`/api/incubator/spaces/${spaceId}/availability`, { data: { dates } });
}

/** Cancel a booking as its owner (PATCH /api/bookings/:id → CANCELLED, releases seat). */
export function cancelBooking(ctx: APIRequestContext, bookingId: string) {
  return ctx.patch(`/api/bookings/${bookingId}`, { data: {} });
}

/** N consecutive YYYY-MM-DD days (UTC) starting `daysAhead` from today. */
export function consecutiveUtcDates(daysAhead: number, count: number): string[] {
  const out: string[] = [];
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + daysAhead);
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/* ───────────────── Card hosted-checkout + public booking-intent ───────────────── */

export type SpaceUnit = 'HOUR' | 'HALF_DAY' | 'DAY' | 'MONTH';
export type CardPaymentMode = 'ONLINE_FULL' | 'CASH_DEPOSIT';

/** Create a card-booking intent (account-only space/program/event). Returns the raw response. */
export function cardIntent(
  ctx: APIRequestContext,
  body: {
    target:
      | { itemKind: 'SPACE'; spaceId: string; unit: SpaceUnit; startsAt: string; endsAt: string }
      | { itemKind: 'PROGRAM'; programId: string }
      | { itemKind: 'EVENT'; eventId: string };
    paymentMode: CardPaymentMode;
    splitHalf?: boolean;
    customer: { fullName: string; email: string; phone: string };
    clientReference: string;
    promoCode?: string;
  },
) {
  return ctx.post('/api/bookings/card', { headers: xff(), data: body });
}

/** Drive the hosted-checkout pay page action (`init` settles in mock-sync; `verify` re-checks). */
export function payCard(ctx: APIRequestContext, token: string, action: 'init' | 'verify') {
  return ctx.post(`/api/bookings/pay/${token}`, { headers: xff(), data: { action } });
}

/**
 * Settle a card intent end-to-end on the mock-sync provider: `init` settles
 * inside the request, then `verify` confirms it (idempotent). Returns nothing —
 * assert from server state (findBookingByRef / findBookingByPayToken).
 */
export async function settleCard(ctx: APIRequestContext, token: string): Promise<void> {
  const init = await payCard(ctx, token, 'init');
  expect(init.status(), `card pay init → ${init.status()} ${await init.text()}`).toBe(200);
  await payCard(ctx, token, 'verify');
}

/** PUBLIC: persist a guest's space selection (date/time + payment option). Returns the raw response. */
export function createSpaceBookingIntent(
  ctx: APIRequestContext,
  body: {
    spaceId: string;
    unit: SpaceUnit;
    startsAt: string;
    endsAt: string;
    paymentMode: CardPaymentMode;
    splitHalf?: boolean;
  },
) {
  return ctx.post('/api/bookings/intent', { headers: xff(), data: body });
}

/** AUTH: resume a persisted selection once signed in → returns the raw response ({ payPath } on success). */
export function resumeBookingIntent(ctx: APIRequestContext, intentId: string) {
  return ctx.post(`/api/bookings/intent/${intentId}/resume`, { headers: xff(), data: {} });
}
