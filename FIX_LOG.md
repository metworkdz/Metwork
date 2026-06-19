# FIX_LOG.md — Phase 1 (audit fixes)

**Date:** 2026-06-19 · **Provider context:** SlickPay is the **live** provider in **test mode**.
**Gate:** `npx tsc --noEmit` → **0 errors** · `npx vitest run` → **187/187 passing** (16 files) ·
ESLint clean on all changed files.

All fixes are server-authoritative on money, idempotent, backward-compatible (no new required DB
fields), and add en/fr/ar strings where user-facing (none were needed — all changes are backend /
plumbing).

---

## P1-1 + P2-1 · Network-Pass check-in: authorization + validation-bypass
**Why:** `/api/network/checkin/record` (the payout-triggering commit) and `/checkin/validate`
required only *any* authenticated session, and `recordCheckIn` re-derived the code by
`(spaceId,userId)` instead of the validated code — so any logged-in user could consume a victim's
code, forge a partner payout, leak the bound member's PII, and spoof the audit `staffUserId`.

**Changed:**
- `src/server/network/checkin-service.ts`
  - New `authorizeSpaceCheckIn(user, spaceId)` — allows ADMIN, or the INCUBATOR that owns the space
    (`findIncubatorByUserEmail` → `space.incubatorId`). All others rejected.
  - `recordCheckIn` now re-validates at commit time inside the write lock: code not expired; booking
    is an approved `NETWORK_PASS` SPACE booking for `spaceId` **and today** — mirrors `runValidation`'s
    EXPIRED / WRONG_DATE / WRONG_PAYMENT_METHOD / BOOKING_NOT_CONFIRMED gates. Still idempotent on
    `visitId`.
- `src/app/api/network/checkin/record/route.ts` — guard switched to `requireApiRole(['INCUBATOR','ADMIN'])`
  + `authorizeSpaceCheckIn`; attribution (`checkedInBy`) forced to `guard.user.id` (no body override).
- `src/app/api/network/checkin/validate/route.ts` — same guard + ownership check; `staffUserId`
  forced to `guard.user.id` (no body override).

**Verify:** `src/__tests__/checkin-authz.test.ts` (7 tests) — owner/admin allowed, member & non-owning
incubator rejected; record settles a valid today code, refuses expired and not-today (stale) codes.

**Note:** the scanner component (`space-checkin-scanner.tsx`) is not yet wired into any page, so no UI
changed; the routes were nonetheless live and publicly callable.

## P1-2 · `createSpaceBooking` replay idempotency (cash + NETWORK_PASS)
**Why:** the replay short-circuit only fired when the existing booking had a stored transaction.
Cash/NETWORK_PASS bookings carry `transactionId: null`, so a same-`clientReference` retry fell
through and created a duplicate — double-burning a network credit + a second partner-payout visit, or
a duplicate cash reservation.

**Changed:** `src/server/bookings/service.ts` — the replay branch now always returns the existing
booking; when no transaction was stored it synthesises a placeholder matching the original response
shape (cash → PENDING/`cash`, NETWORK_PASS → COMPLETED/`network_pass`). The wallet/credits are never
touched twice.

**Verify:** `src/__tests__/booking-idempotency.test.ts` (3 tests) — NETWORK_PASS replay returns the
original booking, burns exactly one credit, writes exactly one visit; cash replay returns one
reservation; wallet replay still debits once (unchanged behaviour).

## P1-3 + P2-3 · SlickPay `external_id` + webhook booking-settlement + reconciliation cron
**Why:** SlickPay `initTopUp` never sent our id, so the signed webhook had no `external_id` and could
never settle anything (top-up, card booking, or guest consultation). Money completed at the provider
but, if the payer didn't return to the pay page, was never credited.

**Changed:**
- `src/server/payments/slickpay-provider.ts` — `initTopUp` now sends `external_id: input.topUpId`
  (+ `metadata.external_id`); `verifyWebhook` reads `external_id` / `externalId` / `metadata.external_id`
  for resilience. (Also closes **P3**: `cancel_url` now uses the payer's locale, derived from the
  return URL, instead of a hard-coded `/en`.)
- `src/app/api/webhooks/payments/[provider]/route.ts` — after `confirmTopUp` (wallet intent), falls
  through to settle a **card booking** then a **guest consultation** keyed by `external_id == booking.id`.
  FAILED-for-booking events are acknowledged (200) so the provider stops retrying; only a genuinely
  unknown id is a 404.
- `src/server/bookings/card-payment.ts` — new `settleCardBookingFromWebhook(bookingId, ref, status)`
  (delegates to `applyCardSettlement`, idempotent) and `reconcilePendingCardBookings()`.
- `src/server/consultations/guest-payment.ts` — new `settleGuestConsultationFromWebhook(...)`
  (delegates to `markPaidAndConfirm`, idempotent) and `reconcilePendingGuestConsultations()`.
- `src/server/wallet/service.ts` — new `reconcilePendingTopUps()` (polls PENDING intents idle ≥5 min
  via `getSlickPayTransferStatus`, settles via `confirmTopUp`; no-ops on the mock provider).
- `src/app/api/cron/reconcile-payments/route.ts` — new CRON_SECRET-guarded cron (GET+POST) running all
  three reconcilers. Registered in `vercel.json` at `*/15 * * * *`.

**Safety in test mode:** reconcilers only act on intents/bookings idle ≥ 5 min and settle through the
existing idempotent paths; a webhook + return + cron can race without double-crediting. With the mock
provider the reconcilers short-circuit (provider not configured).

**Verify:** `src/__tests__/webhook-settlement.test.ts` (7 tests) — guest & card settle by id, replay
returns `ALREADY`, FAILED → `IGNORED`, unknown id → `NOT_FOUND`; card path credits the incubator wallet.

## P2-2 · Stable `clientReference` in booking forms
**Why:** the forms minted a fresh `crypto.randomUUID()` per submit, so the documented idempotency key
changed on every attempt — a network retry after a silently-successful booking could double-book.

**Changed:** `space-booking-form.tsx`, `program-apply-form.tsx`, `event-register-form.tsx` — each now
mints the key once via a `bookingRef` (`ensureBookingRef()`), reused across retries, reset on success
and regenerated when the booking parameters change (date/unit/payment method/promo) so a changed
resubmit is a NEW booking, never a stale replay. The consultation dialog already used a stable ref.

**Verify:** type-check + full suite green; logic is a client-side idempotency-key lifecycle change
(no behavioural change on the happy path).

---

## Follow-up · Double Network-Pass payout visit — FIXED (`task_b32418e9`)
**Why:** a NETWORK_PASS booking wrote a `networkVisit` at booking time (`checkedInAt: null`) and
`recordCheckIn` pushed a SECOND row at check-in — two rows per booking. All payout/stat consumers
(`getPartnerStats`, admin analytics, member network-pass page, check-in stats/history) gate on
`checkedInAt`, so the booking-time row was invisible to payout — but the two-row shape was fragile
(a naive batch summing all PENDING would double-pay) and broke `detectFraudulentCheckIn` (its
duplicate check matched the booking-time row by `bookingId`).

**Model (confirmed against all 5 consumers):** ONE visit row per booking — created "booked"
(`checkedInAt: null`, invisible everywhere) and STAMPED at check-in (counted exactly once).

**Changed (`src/server/network/checkin-service.ts`):**
- `runValidation` returns the booking's existing `networkVisitId` as `visitId` (fresh id only for
  legacy bookings without a booking-time row), so the scanner round-trips the right row.
- `recordCheckIn` now resolves the single visit row (prefer `booking.networkVisitId`, then any row for
  the booking, else create — legacy fallback) and UPDATES it in place; an already-stamped row replays.
  No second row is ever inserted. Still idempotent (now on the booking's row, not a throwaway id).
- `detectFraudulentCheckIn` duplicate check now requires `checkedInAt`, so a first check-in on a
  booking-time row is not misflagged as a duplicate.

**Verify:** `src/__tests__/network-pass-visit.test.ts` (2 tests) drives the real chain
(`createSpaceBooking` → `generateCheckInCode` → `validateCheckInManual` → `recordCheckIn`): exactly one
visit row before and after check-in (same id, now stamped), and `getPartnerStats.pendingPayout` ==
one payout rate (300, not 600) — including on replay. tsc 0, full suite **189/189**, ESLint clean.
