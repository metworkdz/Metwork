# Metwork — E2E Test Plan (critical-flow coverage)

End-to-end coverage for every critical flow, driven through the JSON API with
Playwright `request` contexts (deterministic, server-state assertions). New
business-flow specs live in `tests/e2e/api/` and run under the **serial** API
config (`playwright.api.config.ts`, `workers:1`) — the right home for tests that
mutate the single shared JSON document. The UI smoke projects keep `workers=5`.

---

## How to run

The suite runs against a **seeded local server** in mock-payment mode. The dev
server is started separately (the configs have no `webServer` block).

```bash
# 1. Seed the 5 role accounts + incubator/space/mentor into .local-db.json
USE_LOCAL_DB=true npx tsx scripts/seed-test-users.ts

# 2. Start the dev server with local DB + mock SlickPay (sync) + WhatsApp/SMS/email mock
USE_LOCAL_DB=true PAYMENT_PROVIDER=mock MOCK_PAYMENT_MODE=sync npm run dev

# 3a. Run the full API business-flow suite (new specs + the existing API specs)
npx playwright test --config=playwright.api.config.ts

# 3b. …or a subset
npx playwright test --config=playwright.api.config.ts auth payments guest-book

# 4. The UI smoke + consultation projects (unchanged, workers=5 / consultation workers=1)
npx playwright test                                   # admin/incubator/entrepreneur UI smoke
npx playwright test --project=consultation --workers=1
```

> **Required env:** `PAYMENT_PROVIDER=mock` and `MOCK_PAYMENT_MODE=sync` are
> mandatory — the wallet/card/guest settlements assert synchronous completion.
> `AUTH_SECRET` must match between the server and the test runner (the OTP helper
> reads it from `process.env` or `.env.local`). `.env.local`'s default
> `PAYMENT_PROVIDER=slickpay` is overridden by the shell var in step 2.

---

## How the mocking works

### OTP (no real SMS/email)
The app **never** stores or exposes a plaintext OTP — only `HMAC-SHA256(code,
AUTH_SECRET)` is persisted (`pendingUsers.otpHash`, `otps.codeHash`), and the
plaintext is handed to the mock notifier (a `console.log`). So a `request`-based
test can't "read the email."

`tests/e2e/api/_otp.ts` recovers the code the way an attacker holding the key
would — except the key is **ours**: the e2e server runs with a known
`AUTH_SECRET` and `USE_LOCAL_DB=true`, flushing every write synchronously to
`.local-db.json`. The helper reads that file, takes the stored HMAC, and reverses
it by enumerating all 10⁶ six-digit codes through the same HMAC (a one-time
~1-1.5 s reverse index per worker). **Zero production code is touched.**
`getSignupOtpByPendingId(id)` / `getSignupOtpByEmail(email)` / `getUserOtp(userId)`.

### Payments (no real SlickPay)
`PAYMENT_PROVIDER=mock` + `MOCK_PAYMENT_MODE=sync`:
- **Wallet top-up** — `POST /api/wallet/topup` settles in-request and returns the
  new balance (`_helpers.topUp`).
- **Card / guest hosted-checkout** — `POST /api/bookings/pay/[token]` (and
  `/api/consultation/pay/[token]`) `init` calls `provider.initTopUp` which returns
  `COMPLETED`, so settlement (`applyCardSettlement`) runs immediately. `_helpers`
  drives card links; `_consult-helpers.settleGuest` drives consultation links.
- All amounts are recomputed server-side; specs assert wallet/booking state, never
  client-supplied money.

### Calendar
**Not covered — by decision.** The codebase has **no** Google Calendar (or any
external calendar) integration: there is no `createCalendarEvent` /
`deleteCalendarEvent`, no `googleapis`, no ICS. Consultations instead use a
manual *meeting-link / meeting-mode* lifecycle (`READY` / `AWAITING_LINK`,
`setBookingMeetingLink`, `completeConsultation` in
`src/server/consultations/lifecycle.ts`). The "calendar" spec area from the brief
cannot be implemented against existing code and was intentionally skipped rather
than testing a feature that does not exist.

---

## Coverage matrix (new specs)

| Area | Spec | Key flows asserted |
|------|------|--------------------|
| **auth** | `auth.spec.ts` (12) | signup for each signup role (ENTREPRENEUR/INVESTOR/INCUBATOR/TRAINER); OTP recover + verify → promotion; single-use OTP; resend via **email** and **WhatsApp** (+ invalidates prior code); resend no-enumeration 204; login success + wrong-password 401; forgot-password 204 **and issues a reset token**; unknown-email 204. *(Reset-password rejection paths live in `auth-wallet.spec.ts`; the green path is infeasible E2E — 32-byte hashed token.)* |
| **incubator** | `incubator-manage.spec.ts` (4) | create spaces in COWORKING / PRIVATE_OFFICE / TRAINING_ROOM with custom working hours + duration discounts; set & clear blackouts; create program + event; manual offline booking auto-confirmed |
| **availability** | `availability.spec.ts` (3) | blocked date rejects **public + manual**; unblock re-allows manual; hourly-held day rejects full-day but accepts more hourly; full-day-held day rejects everything (capacity-1 spaces) |
| **user-book** | `user-book.spec.ts` (5) | space FULL-DAY (charged pricePerDay); space HOURLY from–to (pricePerHour × hours); paid program apply (wallet debit); consultation full-price (member wallet debited by fee); consultation **with promo** (debited by fee − discount) |
| **guest-book** | `guest-book.spec.ts` (5) | book-as-guest: space (card), program (card), consultation (instant-book + pay token); book-&-create-account: CARD space (signup-pending → email OTP → pay page attaches booking) and CONSULTATION (guest request linked to new account on verify) |
| **payments** | `payments.spec.ts` (7) | wallet top-up; charge wallet on booking; idempotent booking replay (no double-charge); card CASH_DEPOSIT → AWAITING_CASH → mark-cash-paid → PAID (idempotent); guest tokenized link + **no double-credit on replayed verify**; 100% promo → 0 DZD auto-confirm; decline → refund **once** (no double-refund) |
| **admin** | `admin-ops.spec.ts` (4) | booking approval (PENDING → CONFIRMED + incubator payout credit); withdrawal approve (escrow held, re-decision 409); withdrawal reject (escrow refunded); promo-code CRUD (create / list / update / deactivate) |

**Total new: 40 tests across 7 specs.** New helpers: `_otp.ts` (OTP reverse),
`_helpers.ts` extensions (`setSpaceBlackouts`, `manualBooking`, `topUp`,
`readLocalDb` / `findBookingByRef` / `findBookingByPayToken`, `createSpace`
category + duration-discount options, `bookSpace` explicit clientReference).

---

## Stability model

- **Serial, `workers:1`** under `playwright.api.config.ts` — the suite mutates one
  shared JSON document; serial execution avoids read-modify-write races (the same
  reason the pre-existing API suite is serial).
- **Deterministic seed** via `scripts/seed-test-users.ts` (idempotent — re-running
  replaces the QA records). Each test creates its **own** fresh fixtures
  (spaces/programs/events) so assertions never depend on global counts.
- **Unique-per-call isolation** — signups use unique email/phone; every
  rate-limited call sends a unique `x-forwarded-for` (`xff()`); top-ups are batched
  once per spec `beforeAll` to stay under the 10/user/hour cap.
- **Server-state assertions** — money/lifecycle is read from the authoritative
  `.local-db.json` (`readLocalDb`) or read APIs, not just response DTOs.

## Fixed pre-existing failures

Two specs failed on `main` independently of the new work and were fixed (test/fixture
only — no production change). Full API suite is now **81 passed, 0 failed**.
1. `space-booking.spec.ts` › *OVERLAP_CONFLICT…* — booked two `CASH` bookings, which
   are `PENDING_PAYMENT` and hold no seat (`availability.ts` `seatHolding`), so they
   never conflicted; also used a capacity-20 space (overlap there is `CAPACITY_EXCEEDED`,
   not `OVERLAP_CONFLICT`). Fixed: a free, **capacity-1** space booked **ONLINE** (status
   `PENDING` → holds a seat) so the overlap gate fires. *(Open product question, left
   untouched: should an unpaid `CASH`/`PENDING_PAYMENT` reservation hold the slot?)*
2. `consultation-portal.spec.ts` › *11b — reschedule inside notice window* — `nextUniqueSlot`'s
   clock-seeded base day can land >30 days out, beyond the 720h (max) notice window, so the
   booking was never "too late". Fixed: a new `nearUniqueSlot()` (2–8 days out, < the 720h
   window, > the 24h booking guard, day-range disjoint from `nextUniqueSlot`), with a
   walk-past-taken-slots loop and a cancel-on-exit so reruns stay collision-free.
