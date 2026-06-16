# Guest-or-Signup booking flow

When a **logged-out** visitor books a **space**, **program**, or **consultation**,
the booking surface now offers two paths:

1. **Book as a guest** — the existing tokenized card-payment / pay-after-approval
   flow. **Unchanged.**
2. **Book & create an account** — set a password, verify by **email OTP**
   (WhatsApp/SMS available as a resend fallback), and land directly on the next
   step for *this* booking:
   - **Space / Program** → the hosted-checkout **pay page**.
   - **Consultation** → the dashboard **consultations** view (the request is
     still pending admin approval; the pay link is emailed once approved).

No new auth logic was written — the flow reuses the existing signup helpers
(`issuePendingUser` → `/api/auth/verify-otp` → `promotePendingUser`), the
`scrypt` password hasher, the card-booking intent engine, and the guest
consultation endpoint.

---

## Flow in words

### Space / Program (card flows)
1. Guest fills contact details (name/email/phone) + **password, confirm, city,
   Terms/Privacy consent**, then clicks **Book & create an account**.
2. Client → `POST /api/auth/signup-pending` with a `CARD` intent
   (`target`, `paymentMode`, `promoCode`, a stable `clientReference`).
3. Server:
   - Rejects if the email/phone already belongs to a real user (409 — "log in").
   - Creates a **guest** card-booking intent (`createCardBookingIntent`,
     `userId: null`, `membershipDiscount: 0`) — T/D/fee recomputed server-side.
   - Hashes the password, `issuePendingUser({ role: 'ENTREPRENEUR', city,
     pendingBooking: { kind: 'CARD', ref: <payToken> } })`.
   - **Emails** the OTP (primary channel).
   - Returns `{ userId, maskedEmail, maskedPhone }`.
4. Client → `/verify-otp?userId=…&email=…&phone=…`.
5. User enters the code → `POST /api/auth/verify-otp`:
   - `verifyPendingOtp` → `promotePendingUser` (atomic pending→user), session set.
   - Because the promoted pending record carries `pendingBooking`, the booking is
     **re-assigned** to the new user (guarded: only an unclaimed, unsettled guest
     booking) and the response includes `redirect = /{locale}/booking/pay/{token}`.
6. The OTP form does `window.location.assign(redirect)` → the pay page, which
   re-verifies the amount server-side and charges via the hosted checkout.

### Consultation (pay-after-approval)
1. From the booking dialog's chooser the guest picks **Book & create an account**,
   then completes the schedule + details steps (which already collect
   name/email/phone) plus the password/city/consent panel.
2. Client first creates the guest request via the existing
   `POST /api/mentors/:id/guest-book` (returns the `mentorBooking.id`).
3. Client → `POST /api/auth/signup-pending` with a `CONSULTATION` intent
   (`mentorBookingId`). Server links the **unclaimed** guest request
   (`userId === null`, `source === 'guest'`), stores
   `pendingBooking: { kind: 'CONSULTATION', ref: <mentorBookingId> }`, emails OTP.
4. `/verify-otp` → on success the request is re-assigned to the new user and the
   response `redirect = /{locale}/dashboard/entrepreneur/consultations` (the
   consultations page lists `mentorBookings` by `userId`, so the freshly-attached
   PENDING request shows immediately). The pay link is emailed after admin approval.

---

## Files

### New
- `src/app/api/auth/signup-pending/route.ts` — registers a pending account tied
  to a booking; conflict-check → build carry → issue email OTP.
- `src/components/features/booking/booking-create-account-fields.tsx` — shared
  password + confirm + city + Terms/Privacy panel; exports `isBookingAccountValid`
  and `bookingAccountError`.

### Changed
- `src/server/db/store.ts` — `PendingUserRecord.pendingBooking?` (nullable).
- `src/server/auth/pending-users.ts` — `PendingUserInput.pendingBooking?` + writer.
- `src/app/api/auth/verify-otp/route.ts` — additive branch: `attachCarriedBooking`
  re-assigns the booking and returns `redirect` (normal signups unaffected).
- `src/services/auth.service.ts` — `signupPending()` + types; `verifyOtp()`
  surfaces optional `redirect`.
- `src/components/features/auth/otp-form.tsx` — follows `redirect` when present.
- `src/components/features/spaces/space-booking-form.tsx`,
  `src/components/features/programs/program-apply-form.tsx`,
  `src/components/features/mentors/book-consultation-dialog.tsx` — two-button UI +
  account panel + create-account submit.
- `src/i18n/messages/{en,fr,ar}.json` — `booking.createAccount.*` (23 keys each).

---

## Security notes

- **Server-side money.** The client never sends a price. The card intent
  recomputes T / D / fee in `createCardBookingIntent`; the pay page re-verifies
  the frozen `onlineChargeAmount` and only confirms via the provider. A brand-new
  account is `EXPLORER` tier (no `membershipCode`), so its discount is 0 — the
  account price equals the guest price (no re-price surprise).
- **No price/details in the redirect.** Only the pay token / dashboard path
  travels through the URL; the carry pointer lives server-side on the pending
  user, and the booking owns the amount.
- **Idempotency.** One stable `clientReference` per attempt → `issuePendingUser`
  overwrites a prior pending entry for the same email/phone, and
  `createCardBookingIntent` replays on `(userId=null, clientReference)`.
  Settlement remains idempotent (`settledAt` claim) — double-submit ≠ double-charge.
- **Conflict first.** Email/phone conflicts are checked before any booking is
  created, so a "please log in" 409 never leaves an orphan booking.
- **Claim guard.** A booking is re-assigned only when it's an unclaimed
  (`userId === null`), unsettled **guest** booking — a settled or already-owned
  booking is never hijacked.
- **OTP.** Hashed by `issuePendingUser` (HMAC-SHA256). Email is the primary
  delivery channel; WhatsApp/SMS remain available via the resend switcher.

---

## How to test

Prereqs: `USE_LOCAL_DB=1`, `SMS_PROVIDER=mock` (or real), email provider mock
(OTP prints to the server console). Run `npm run dev`.

- **Guest path unchanged** — book a space/program as a guest with **Book as a
  guest**; confirm you reach `/booking/pay/<token>` exactly as before.
- **Password mismatch rejected** — different confirm value → inline
  `errorMismatch`, no request sent.
- **Wrong OTP rejected** — bad code on `/verify-otp` → `invalidOtp`.
- **Lands on the right page** — correct OTP →
  - space/program → `/booking/pay/<token>` (re-priced server-side),
  - consultation → `/dashboard/entrepreneur/consultations` showing the PENDING
    request.
- **Server re-prices** — the pay page total equals the server amount (not any
  client value); membership discount = 0 for the new account.
- **Double-submit not double-charged** — refresh/replay the pay page → still one
  settled booking (`settledAt` claim).
- **All three** — repeat for space, program, consultation.
