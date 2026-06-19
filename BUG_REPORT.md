# BUG_REPORT.md — Phase 0 Audit

**Date:** 2026-06-19
**Branch:** main @ `0c678fd`
**Scope:** Read-only audit. No code changed. `npx tsc --noEmit` baseline = **0 errors**.
**i18n key parity:** en / fr / ar all **3142** leaf keys, **0** missing on any side. ✅

## Method & coverage

This is a **prioritised deep-read** of the money / auth / booking / consultation core
(where P0/P1 bugs live), plus cross-cutting checks (i18n parity, route guards, type-check).
It is **not** a line-by-line read of all ~200 route/page files. The coverage matrix at the
bottom states exactly what was read deeply vs. spot-checked vs. not-yet-opened, so a follow-up
pass can close the gaps.

Severity key: **P0** catastrophic data/payment/auth · **P1** money/credits/security correctness ·
**P2** functional / settlement-reliability / access-control · **P3** cosmetic / latent.

---

## P1 — fix first

### P1-1 · Network-Pass check-in `record` route: missing authorization **and** validation bypass
**Files:**
- `src/app/api/network/checkin/record/route.ts:26-53` (guard = `requireApiSession()` only)
- `src/server/network/checkin-service.ts:524-596` (`recordCheckIn`)
- `src/app/api/network/checkin/validate/route.ts:39-41` (same guard, read-only)

**Root cause:** `recordCheckIn` is the money-affecting commit (creates a `NetworkVisitRecord`
with `payoutStatus:'PENDING'` + `payoutAmount`, consumes the check-in code, stamps the booking).
Two compounding defects:
1. **No space-ownership check.** The route requires only *any* authenticated session. It does
   not verify the caller is staff/`managerId` of `spaceId`. `spaceId`, `userId`, `visitId`,
   `checkedInBy` are all taken from the request body (`route.ts:18-24`).
2. **The validation pipeline is not enforced at commit.** `recordCheckIn` re-derives the code
   by `(spaceId, userId, !consumed)` (`checkin-service.ts:538-540`) instead of requiring the
   validated code hash. So it can be called **without ever presenting the QR/code** — bypassing
   every control the service header advertises (code-hash compare, `WRONG_DATE`, `EXPIRED`,
   replay/`consumed`, and `detectFraudulentCheckIn`, which the route never calls).

**Impact:** Any logged-in user who knows a victim's `userId` + a partner `spaceId` (both appear
in API responses) can, while an unconsumed code exists for that pair: (a) consume the code →
the victim's real staff scan later returns `ALREADY_CHECKED_IN` (griefing / denial of the visit);
(b) record a visit → create a **PENDING partner payout liability** with no real attendance;
(c) forge `checkedInBy` in the audit log. This defeats a module explicitly labelled
"security-critical fraud prevention."

**Fix direction (Phase 1):** Authorize the caller against the space's incubator/`managerId`
(reuse an incubator/admin guard); and make `record` consume the **exact** validated code
(pass `bookingId`/code-hash through, re-check date/expiry/`consumed` inside the write lock)
rather than re-finding any unconsumed code. Keep idempotency on `visitId`.

### P1-2 · `createSpaceBooking` idempotency replay leaks for cash & Network-Pass
**File:** `src/server/bookings/service.ts:333-344`

```ts
const existing = d.bookings.find(b => b.userId === args.userId && b.clientReference === args.clientReference);
if (existing) {
  const tx = existing.transactionId ? d.transactions.find(...) ?? null : null;
  const w  = d.wallets.find(...) ?? newWallet(args.userId);
  if (tx) return { ok: true, replayed: true, booking: existing, transaction: tx, wallet: w }; // ← only returns when tx exists
}
```

**Root cause:** the replay short-circuit only fires `if (tx)`. Cash (`manual`) and `NETWORK_PASS`
bookings are written with `transactionId: null` (`service.ts:434, 511`), so on a replay with the
**same `clientReference`** the guard falls through and the function **creates a second booking**.
For `NETWORK_PASS` it also re-runs the redemption block (`service.ts:385-489`): a **second network
credit is decremented and a second partner-payout `networkVisit` is written**. This violates the
function's own contract (file header: *"Replay (same clientReference) → original booking is returned,
the wallet is NOT touched a second time"*). The schema permits both methods on the public route
(`bookings/schemas.ts:18-25, 51`).

**Impact:** money/credits. Duplicate manual reservations (double cash-revenue recording); for
Network-Pass, double credit burn + double partner payout (only blocked when capacity == 1; succeeds
on capacity ≥ 2, i.e. exactly the high-capacity coworking spaces Network-Pass targets).
**Reachability caveat:** the web form sends a fresh `crypto.randomUUID()` per click
(`space-booking-form.tsx:549`), so it isn't trivially triggered from the primary UI today — but any
API client / retry middleware that reuses the documented idempotency key hits it. It is a latent
correctness bug in a money function that promises idempotency.

**Fix direction:** drop the `if (tx)` condition — return the existing booking on replay regardless
of `tx` (the success type already allows `transaction: null`, see `applyToProgram` cash path
`service.ts:737`).

### P1-3 · SlickPay top-up never registers `external_id` → webhook reconciliation can never match *(conditional on SlickPay being the live provider)*
**Files:**
- `src/server/payments/slickpay-provider.ts:77-85` (init body omits any external id/metadata)
- `src/server/payments/slickpay-provider.ts:156-157` (`verifyWebhook` keys on `body.external_id`)
- `src/app/api/webhooks/payments/[provider]/route.ts:50-58` (`confirmTopUp({ topUpId: event.topUpId })`)

**Root cause:** `initTopUp` posts only `{ amount, url, cancel_url }` to SlickPay — it never sends
our `input.topUpId` as `external_id`. The webhook verifier then reads `body.external_id`
(undefined) → returns `null` → route 401s. So the webhook path **can never settle** a top-up.
The same gap means guest-consultation and card-booking payments (which pass `booking.id` as the
provider `topUpId` with no `external_id`) are also unreachable by webhook. Everything relies on
**poll-on-return** (`getSlickPayTransferStatus` on the success/pay pages).

**Impact:** if a payer completes the hosted checkout but does not return to the success/pay page
(closes the tab, network drop), the payment is **taken by SlickPay but never credited / settled**,
and there is no cron reconciliation to recover it. With the mock provider (default) this is hidden
because sync mode settles in-request and the async loopback carries `topUpId`. **Severity is P1 if
SlickPay is the live production provider; P2 if mock-only is currently deployed.**

**Flag (per rule 8):** please confirm `PAYMENT_PROVIDER` in production. If SlickPay is live, this is
P1 and needs: (a) send `external_id: input.topUpId` (or SlickPay's metadata field) on init, and
(b) a reconciliation cron that polls PENDING intents older than N minutes. I did **not** change any
payment code pending your call.

---

## P2 — functional / access-control / settlement reliability

### P2-1 · `checkin/validate` route: broad access + PII disclosure + audit `staffUserId` spoofing
**File:** `src/app/api/network/checkin/validate/route.ts:39-78`
**Root cause:** guarded only by `requireApiSession()`; no space-ownership check, and the caller may
supply an arbitrary `staffUserId` (`:55`) that is written to the audit log. It's read-only but
returns `user.fullName` / `user.email` / booking details (`:71-78`).
**Impact:** any authenticated user can probe codes for any space and harvest the bound user's PII,
and poison the check-in audit trail with a forged staff id. Pair the fix with P1-1 (shared
space-staff guard).

### P2-2 · Booking forms generate a fresh `clientReference` per submit → server idempotency unused on network-retry
**Files:** `src/components/features/spaces/space-booking-form.tsx:523,549`;
`programs/program-apply-form.tsx:247,269`; `events/event-register-form.tsx:182,204`
**Root cause:** each submit calls `crypto.randomUUID()` inline, so the documented idempotency key
changes on every attempt. The only guard against a double-charge when the first request succeeds
but its response is lost (timeout) is the `submitting` button-disable, which is reset on error.
**Impact:** a genuine network retry after a silently-successful booking can double-book / double-debit
(wallet) because the server can't dedupe two different references. Mitigation today is purely the
disabled button. **Fix direction:** mint the reference once per booking attempt in a `useRef` (the
create-account path already does this via `accountRef.current`) so honest retries replay.

### P2-3 · Guest consultation / card webhook settlement is non-functional (same root as P1-3)
**Files:** `src/server/consultations/guest-payment.ts:230-241`; `card-payment.ts:865-876`
The guest/card flows create a provider transfer with `topUpId = booking.id` and **no `external_id`**,
and there is no `TopUpIntent` for a guest, so even a correctly-signed SlickPay webhook hitting
`/api/webhooks/payments/[provider]` resolves to `confirmTopUp(topUpId=booking.id)` →
`INTENT_NOT_FOUND` → 404. Guest/card settlement therefore depends **entirely** on the payer
returning to the pay page. Abandoned returns never settle (consultant never credited; money taken).
Folds into the P1-3 reconciliation fix.

---

## P3 — cosmetic / latent

### P3-1 · SlickPay `cancel_url` hard-codes the `en` locale
**File:** `src/server/payments/slickpay-provider.ts:83` — `cancel_url: ${base}/en/payment/cancel`.
A fr/ar payer who cancels lands on the English cancel page. Use the booking/top-up locale.

### P3-2 · `verify-otp` welcome-email dashboard link vs. role-path consistency (low risk)
`src/app/api/auth/verify-otp/route.ts:139-151` builds the welcome link from
`dashboardPathForRole(user.role)`; fine for current roles, but worth a spot-check that every role
returned by signup maps to an existing `/dashboard/*` route (e.g. TRAINER/INVESTOR) to avoid a 404
in the welcome email. Verify in Phase 1.

---

## Surfaces audited — coverage matrix

| Surface | Depth | Result |
|---|---|---|
| Wallet service (charge/topup/confirm idempotency) | deep | clean ✅ |
| `/api/payments/{create,status}`, webhook `[provider]` | deep | clean ✅ (but see P1-3) |
| SlickPay + mock providers | deep | **P1-3, P3-1** |
| `createSpaceBooking` / program / event wallet flow | deep | **P1-2** |
| Card-booking intent + settlement (`card-payment.ts`) | deep | clean ✅ (idempotent via `settledAt`) |
| Consultation instant-book + member top-up settle | deep | clean ✅ |
| Guest consultation payment | deep | clean ✅ (but see P2-3) |
| Consultation cancel / refund | deep | clean ✅ (idempotent) |
| Consultation lifecycle (complete/release/meeting link) | deep | clean ✅ |
| Mentor earnings ledger + withdrawals | deep | clean ✅ (idempotent per ref) |
| Admin withdrawals resolve | deep | clean ✅ (PENDING-guard idempotent) |
| Network-Pass check-in (validate + record) | deep | **P1-1, P2-1** |
| Auth: OTP issue/verify, pending→promote | deep | clean ✅ (HMAC, timing-safe, attempt cap) |
| Auth: forgot / reset password | deep | clean ✅ (atomic consume, session purge, anti-enum) |
| Middleware + `requireRole` / `requireApiRole` | deep | clean ✅ |
| Consultant portal auth (magic-link, PIN, device) | deep | clean ✅ |
| All `/api/admin/*` + `/api/incubator/*` route guards | scripted | clean ✅ (every route guarded) |
| i18n key parity en/fr/ar | scripted | clean ✅ (3142/3142/3142) |
| TypeScript (`tsc --noEmit`) | scripted | clean ✅ (0 errors) |
| Booking UI forms (clientReference handling) | spot | **P2-2** |

## Not yet deep-audited (recommend before sign-off)
- Incubator CRUD UIs: spaces/programs/events/working-hours/blackouts/discounts **pages** (server
  flows verified via card/wallet path; the dashboard *pages* themselves and manual-booking +
  invoicing/receipts UI not line-read).
- Incubator income/expenses import endpoints (`/api/incubator/{income,expenses}/import`) — file
  upload parsing not reviewed.
- Admin pages (analytics, CMS, promo-code manager, partner-promo bulk-generate) — server logic
  spot-checked via guards only.
- Memberships purchase/downgrade + cron jobs (`/api/cron/*`) — not opened.
- Google Calendar sync (prompt 4) — referenced in the brief but **no integration code located** in
  this repo (no `calendar`/`googleapis` references found); confirm where it lives.
- Digital pass / QR rendering pages, dashboard hydration/Safari/mobile — not exercised in a browser
  (no dev-server run in this read-only phase).

---

## Recommended Phase 1 fix order
1. **P1-1** check-in `record` authorization + validation bypass (security/fraud, surgical).
2. **P1-2** `createSpaceBooking` replay guard (one-line correctness fix).
3. **P1-3 / P2-3** SlickPay `external_id` + reconciliation — **after** you confirm the live provider.
4. **P2-1** `checkin/validate` guard + PII (shares the P1-1 guard).
5. **P2-2** stable `clientReference` in booking forms.
6. **P3** locale on cancel_url; role→dashboard path spot-check.

**Stopping here for approval before any code changes (Phase 0 → Phase 1 gate).**
