# AUDIT — Consultant Portal & Consultation Booking

**Branch:** `audit/consultant-portal` · **Date:** 2026-07-06 · **Mode:** READ-ONLY (no app code modified)

This is a fact-finding pass over the real codebase. Every claim below is anchored to a file
path and line. A numbered risk list and a recommended build sequence follow the findings.
No implementation has begun — awaiting explicit approval.

---

## A. CONSULTANT / MENTOR DATA MODEL

**A1. The record type is `MentorRecord`** — `src/server/db/store.ts:1563-1672`. Full field list:

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | `randomUUID()` |
| `fullName`, `position`, `imageUrl` | string | required; `imageUrl` = **avatar** |
| `slug` | string? | SEO slug, kebab-case, deduped; back-filled on read (see A4) |
| `bio` | string \| null | |
| `linkedinUrl` | string \| null | |
| `email` | string? \| null | **contact + OTP login identity** (`:1572`) — optional, **NOT unique** |
| `phone` | string? \| null | PRIVATE WhatsApp recipient (`:1581`) |
| `city` | string? \| null | PUBLIC (`:1588`) |
| `consultationFee` | number? | per-hour DZD, admin-controlled |
| `createdAt` | string | |
| `weeklyAvailability`, `blockedDates`, `availabilityTimezone` | — | Airbnb-style scheduling (`:1599-1603`) |
| `defaultMeetingMode/Link/Address/MapsLink` | — | instant-book meeting defaults (`:1605-1623`) |
| `minNoticeHours`, `bufferMinutes`, `topics`, `ratePer30`, `ratePer60`, `freeIntroEnabled` | — | booking policy (`:1629-1652`) |
| `pinHash`, `pinSetAt` | string? \| null | scrypt PIN for trusted-device unlock (`:1663-1665`) |
| `payoutAccount` | PayoutAccount \| null | manual withdrawals (`:1671`) |

**Fields that EXIST already:** `email`, `phone`, `city`, `bio`, `imageUrl` (avatar), `slug`,
`topics` (≈ expertise/"field"), `position`.

**Fields that DO NOT exist (must be added, nullable + safe defaults):**
- ❌ **`approvalStatus`** — mentors have no approval gate at all (see A2). Prime gap for self-signup.
- ❌ **`visibility` / `published`** — no way to hide a mentor from the public list.
- ❌ **`cv`** — no CV/resume file field.
- ❌ **`field`** as a distinct scalar — `topics: string[]` is the closest existing analogue.
- ❌ **`source` / `createdBy`** — cannot distinguish admin-created vs self-signed-up mentors.

**A2. How the public mentors page decides who to show** — `src/server/mentors/service.ts:52-56`
`listMentors()` returns **every** mentor sorted by `createdAt`. There is **no** approval or
visibility filter. The public list (`src/app/[locale]/(public)/mentors/page.tsx:29`), the admin
list, and the entrepreneur consultations page all call the same unfiltered `listMentors()`.
⇒ Any self-created consultant would appear publicly the instant the record is written, unless a
new `approvalStatus`/`visibility` field is introduced **and** `listMentors()` (or a new public
resolver) filters on it.

**A3. Admin-added mentor creation** — `POST /api/mentors` (`src/app/api/mentors/route.ts:23-49`),
admin-guarded via `requireApiRole(['ADMIN'])`, validated by `createMentorSchema`
(`src/server/mentors/schemas.ts:21-38`), persisted by `createMentor()`
(`src/server/mentors/service.ts:79-110`). **Email is set here** and is `optional().nullable()`
(`schemas.ts:27`) — **not enforced unique**. `createMentor` never sets any approval/visibility
field (none exists).

**A4. Slug back-fill** — `backfillMentorSlugs()` (`service.ts:41-50`) lazily assigns slugs on read;
`findMentorBySlugOrId()` (`service.ts:66-76`) resolves **slug first, then id**, so pre-slug
mentors stay reachable.

**A5. Public per-mentor profile / booking URL** — pattern
`/{locale}/mentors/{slug}` → `src/app/[locale]/(public)/mentors/[slug]/page.tsx`, resolved by
`findMentorBySlugOrId(slug)` (slug **or** id). Booking is mounted via
`mentor-profile-booking.tsx` → `BookConsultationDialog`
(`src/components/features/mentors/book-consultation-dialog.tsx`).

---

## B. CONSULTANT AUTH (feat/consultant-otp-auth) — already shipped & solid

**B1. Login page** — `src/app/[locale]/mentordashboard/login/page.tsx`. Server component; bounces
already-authed consultants to `/mentordashboard` (`:39`); renders
`<EmailOtpSignIn />` (`src/components/features/consultant/portal/email-otp-signin.tsx`) inside a
dark, self-scoped PWA shell (own `mentor.webmanifest`, `robots: noindex`).

**B2. Endpoints** (all under `src/app/api/consultant/`, all gated by `isInstantBookEnabled()`
which currently hard-returns `true` — `instant-book.ts`):
- `otp/request` → `issueConsultantOtp(email)` + `sendOtpEmail` (enumeration-safe, dual rate-limit).
- `otp/verify` → `verifyConsultantOtp` → `createMentorSession` + cookie; returns `{ pinSet }`.
- `pin/set`, `pin/change`, `pin/unlock`; `me`, `logout`; plus profile/availability/bookings/
  earnings/withdrawals/payout-account.

**B3. Access layer** — `src/server/mentors/access.ts` (canonical, reusable):
- `findMentorByEmail` (`:54`), `issueConsultantOtp` (`:75`), `verifyConsultantOtp` (`:83`).
- Sessions: `createMentorSession` (`:98`, 30-day, sha256-hashed id), cookie `metwork_consultant`.
- PIN (scrypt via `hashPassword`/`verifyPassword`): `setMentorPin` (`:209`, first-set only),
  `changeMentorPin` (`:236`, revokes devices), `verifyMentorPin` (`:260`).
- Remember-device: `issueMentorDeviceToken` (`:276`, 60-day), `resolveMentorIdByDeviceToken`,
  `validateMentorDeviceToken`, cookie `metwork_consultant_device`.
- Guard: `requireConsultant()` (`:175`).
- **Reuses** the user OTP table (`d.otps`, namespaced `mentor:` — `:49`) and the user password
  scrypt util. No parallel crypto.

**B4. Where a "create account" branch hooks in:**
- **UI:** add a "Sign up as consultant" affordance to `email-otp-signin.tsx` (or a sibling
  component on the login page).
- **API:** a **new** `POST /api/consultant/signup` that (a) validates a signup schema, (b) rejects
  if `findMentorByEmail` already matches (dedupe — see Risk R2), (c) `createMentor(...)` with the
  **new** `approvalStatus:'PENDING'` + `source:'SELF'` fields, (d) issues an OTP via the **existing**
  `issueConsultantOtp`. Sign-in itself needs no change — the existing OTP flow works the moment a
  `MentorRecord` with that email exists.
- **Gate:** `requireConsultant()` stays as-is, but portal pages/routes must additionally check
  `approvalStatus === 'APPROVED'` before exposing bookings/earnings (read-only-until-approved,
  mirroring §C).

---

## C. ADMIN APPROVALS — exists, and is the correct pattern to reuse

**C1. It exists** — `src/app/[locale]/dashboard/admin/approvals/page.tsx` renders
`AdminAccountApprovalsManager`. Today it gates **`INCUBATOR`, `INVESTOR`, `BUSINESS`** user roles
(`GATED_ROLES`, `:21`). **Mentors/consultants are NOT part of it** (they are `MentorRecord`s, not
`UserRecord`s, and have no `approvalStatus`).

**C2. State machine** — `src/lib/approval-guard.ts`: `getApprovalStatus(user)` returns `APPROVED`
for non-gated/legacy accounts (grandfathering), else `user.approvalStatus`. `ApprovalStatus` =
`PENDING | APPROVED | REJECTED` (`src/types/auth.ts`).

**C3. Endpoint + notifications** — `PATCH /api/admin/accounts/[id]/approval`
(`route.ts:25-64`) → `setAccountApproval()` in `src/server/auth/approval.ts` (single logic path;
also drives the legacy investor route). Emails on approve **and** reject; reject requires a reason.

**C4. Reuse decision for consultants:** because consultants are a **separate entity** keyed by
`MentorRecord`, the cleanest reuse is a **parallel-but-thin** admin surface:
a new `PATCH /api/admin/mentors/[id]/approval` + a new `setMentorApproval()` service that mirrors
`setAccountApproval`'s shape (decision/reason/notify) but writes `MentorRecord.approvalStatus`.
Do **not** shoehorn mentors into `AdminAccountApprovalsManager` (which is `UserRecord`-typed).
Reuse the **email sender** and the PENDING→APPROVED/REJECTED semantics verbatim.

---

## D. ENTREPRENEUR CONSULTATION BOOKING — the Builder free-session bug is REAL

**D1. Two distinct booking dialogs exist (this is the "complex/broken" part):**

| Surface | Component | Free-credit handling |
|---------|-----------|----------------------|
| Public mentor profile / directory / slideshow | `book-consultation-dialog.tsx` | ✅ **Correct** — fetches quota from `/api/consultations` (`:165-179`), auto-checks the credit when `remaining>0` (`:179`), posts `useFreeCredit: applyFreeCredit` (`:339`, `:409`). |
| Entrepreneur **dashboard** → Consultations page | `consultations-panel.tsx` | ❌ **BROKEN** — posts **`useFreeCredit: false` hardcoded** (`:270`). |

**D2. THE PRIME BUG** — `src/components/features/entrepreneur/consultations-panel.tsx:270`.
The dashboard page (`.../entrepreneur/consultations/page.tsx:65-78`) computes and passes the correct
`freeQuota` / `freeSessionsRemaining` and the panel **renders a prominent "X free sessions
remaining" card** (`:369-402`), but the submit handler sends `useFreeCredit: false` to
`/api/mentors/[id]/instant-book`. Result: a Builder/Founder who is *told* they have a free session
**can never actually consume it from the dashboard** — they get charged (or the flow stalls). The
public dialog works; the dashboard one does not. **This — not the quota keys — is the root cause of
"Builder can't book free session."**

**D3. The quota resolver is CORRECT (not the culprit)** — `src/server/memberships/service.ts`:
- `CONSULTATION_QUOTA` (`:33-38`) is keyed by **both** naming systems:
  `ENTREPRENEUR:1, STARTUP:3, BUILDER:1, FOUNDER:3`. Not stale.
- `getEffectiveMembershipCode()` (`:93-106`) prefers `membershipCode` (`ENTREPRENEUR`/`STARTUP`),
  falls back to `membershipTier` (`BUILDER`/`FOUNDER`), else `FREE`. `EXPLORER` correctly collapses
  to `FREE` → 0 quota.
- The instant-book **write path** resolves the credit correctly via `getUserConsultationQuota()` +
  `tierDiscountFraction()` (`src/app/api/mentors/[id]/instant-book/route.ts:127-140, 50-55`) — but
  **only if the client passes `useFreeCredit: true`**, which the dashboard panel refuses to do (D2).

**D4. Secondary display bug** — `consultations-panel.tsx:190-193` maps the tier label with
`membershipCode === 'ENTREPRENEUR' → Builder`, `'STARTUP' → Founder`. But `page.tsx:72` passes
`effectiveCode`, which for a partner-promo user is literally `'BUILDER'`/`'FOUNDER'` — those cases
fall through and render **no** tier label. Cosmetic, but confirms the dual-naming seam leaks into UI.

**D5. Quota logic is duplicated in 3 places** (centralization target):
`service.getUserConsultationQuota()` (`:111-136`), the dashboard page inline count
(`consultations/page.tsx:49-57`), and `GET /api/consultations` (`route.ts:24-45`). All three
re-implement "count FREE_QUOTA mentorConsultations for this month". They currently agree, but any
future change must touch all three.

**D6. Legacy `/book` route is retired** — `POST /api/mentors/[id]/book` returns `410 GONE`
(`route.ts:14-20`). The **only** live booking path is `instant-book`. (Note: the dashboard panel
still contains dead code for the retired route at `consultations-panel.tsx:306-364`, reachable only
if `instantBookEnabled` were false — it never is, since `isInstantBookEnabled()` hard-returns `true`.)

**D7. Mobile behaviour** — both dialogs are standard modal/sheet dialogs; layout is Tailwind-only,
no JS breakpoints (confirmed in §E). No mobile-specific crash observed in the booking dialog itself.

---

## E. MOBILE / NAV

**E1. Entrepreneur mobile bottom-nav** — `src/components/layout/mobile-tab-bar.tsx` (Revolut-style,
`lg:hidden`, pure Tailwind). Order from `src/config/mobile-nav.ts:32-37`:
1. Overview (`/dashboard/entrepreneur`)
2. Bookings
3. **Marketplace** ← center cell (5-col grid: `grid-cols-5`, `mobile-tab-bar.tsx:46`; positions
   1-4 are tabs, position 5 is the "More" sheet trigger — so the visual center of the 5 cells is #3,
   Marketplace).
4. Wallet
5. **More** (opens bottom sheet with everything else)

⚠️ **Consultations is NOT a primary tab** — it lives only in the "More" overflow sheet
(`getMobileMoreItems`, `mobile-nav.ts:89-92`), i.e. buried on mobile. There is no center FAB/CTA.

**E2. `useMediaQuery` / `window.innerWidth` / `matchMedia`** — **ZERO occurrences anywhere in
`src/`** (grep clean). All responsive logic is Tailwind breakpoints. ✅ Fully compliant with rule #6
already; any new work must preserve this.

---

## F. UPLOADS + SMS

**F1. File-upload pattern** — `POST /api/mentors/upload` (`src/app/api/mentors/upload/route.ts`),
**admin-only** (`requireApiRole(['ADMIN'])`, `:30`). Uploads to **Cloudinary** when configured
(`@/lib/cloudinary`, folder `metwork/mentors`), else falls back to `public/uploads` on disk in dev.
Limits: `MAX_UPLOAD_BYTES` (5 MB), MIME-restricted to jpg/png/webp/gif/avif. Returns `{ url }`.
Mentor `imageUrl` (avatar) is stored as that returned URL. **There is no CV upload path** — a CV
feature would extend this pattern (new MIME allow-list incl. PDF, new field).
⚠️ The route is admin-gated; a **consultant self-upload** (avatar/CV) needs either a
consultant-guarded variant (`requireConsultant()`) or a shared helper — do **not** loosen the admin
route.

**F2. Infobip SMS/WhatsApp** — `src/server/notifications/sms.ts` re-exports from `@/lib/infobip`:
`sendWhatsAppMessage(phone, text)` (`:30`), `sendWhatsAppOTP(phone, code)` (`:92`),
`sendWhatsAppNewBookingTemplate(...)` (`:158`), `sendSMSOTP(phone, code)` (`:225`). Infobip is the
sole SMS/WhatsApp provider (Twilio removed). **Note:** consultant sign-in OTP currently goes over
**email only** (`otp/request/route.ts:62-65` → `sendOtpEmail`); SMS is used for user-account OTP and
booking notifications, not consultant login.

---

## RISK LIST

| # | Risk | Severity | Mitigation |
|---|------|----------|-----------|
| R1 | Public mentor list has **no visibility gate** — a self-signed-up (or PENDING) consultant would appear publicly + be bookable immediately. | **High** | Add `approvalStatus`/`visibility` to `MentorRecord`; filter in a single public resolver. Grandfather existing mentors as APPROVED/visible (default when field absent). |
| R2 | `MentorRecord.email` is **not unique**; `findMentorByEmail` returns the first match. Self-signup could create a duplicate email → OTP/login ambiguity, or collide with an admin-added mentor. | **High** | Signup route must reject when `findMentorByEmail` already matches; consider a normalized-email uniqueness check in `createMentor`. |
| R3 | Fixing `useFreeCredit` on the dashboard panel must not double-charge or let a non-member force a free credit. | **Med** | Server already re-verifies quota (`instant-book.ts:131-140`) — client flag is only a *request*, server is authoritative. Keep it that way; just stop hardcoding `false`. |
| R4 | Quota logic duplicated ×3 (D5) — a fix in one place can silently diverge. | **Med** | Centralize on `getUserConsultationQuota()`; have the page + `/api/consultations` consume it. |
| R5 | Consultant avatar/CV self-upload could weaken the admin-only upload route if the guard is loosened. | **Med** | New consultant-guarded route or shared helper; never relax the admin route. |
| R6 | Grandfathering: existing admin-added mentors lack every new field. | **Med** | All new fields nullable; `getApprovalStatus`-style helper returns APPROVED/visible when absent (mirror `approval-guard.ts:31-34`). |
| R7 | Non-blocking external calls: signup email/SMS/upload failure must not corrupt the `MentorRecord`. | **Med** | Persist the record first, fire notifications after, surface resend/retry (mirrors existing OTP `sendOtpEmail` fire-and-forget at `otp/request:63`). |
| R8 | Dual naming (`ENTREPRENEUR`/`STARTUP` vs `BUILDER`/`FOUNDER`) leaks into UI labels (D4). | **Low** | Resolve labels off `getEffectiveMembershipCode` consistently. |
| R9 | Consultations buried in mobile "More" sheet (E1) — low discoverability for a portal push. | **Low** | Consider promoting Consultations to a primary tab (config-only change in `mobile-nav.ts`). |

---

## RECOMMENDED BUILD SEQUENCE (for approval — not yet started)

1. **Schema foundation (backward-compatible):** add `approvalStatus?`, `visibility?`/`published?`,
   `source?`, optional `cv?` to `MentorRecord` (all nullable, default APPROVED/visible when absent).
   Add a `getMentorApprovalStatus()` helper mirroring `approval-guard.ts`.
2. **Public-visibility gate:** introduce one canonical `listPublicMentors()` (or a filter param on
   `listMentors`) that hides non-APPROVED/hidden mentors; point the public page + booking resolvers
   at it. Admin/portal keep the unfiltered view.
3. **Fix the Builder free-session bug (smallest, highest-value):** stop hardcoding
   `useFreeCredit:false` in `consultations-panel.tsx:270`; wire it to real remaining-quota state like
   `book-consultation-dialog.tsx` does. Centralize quota reads (R4). Fix the tier label (D4).
4. **Consultant self-signup:** `POST /api/consultant/signup` (dedupe R2 → `createMentor` with
   `PENDING`/`SELF`) + a "Sign up" branch in `email-otp-signin.tsx`. Reuse existing OTP end-to-end.
5. **Admin mentor approvals:** `PATCH /api/admin/mentors/[id]/approval` + `setMentorApproval()`
   mirroring `setAccountApproval` (reuse email sender); admin UI surface for PENDING consultants.
6. **Consultant self-upload (avatar/CV):** consultant-guarded upload variant reusing the Cloudinary
   helper; extend MIME allow-list for CV (PDF).
7. **(Optional) Mobile discoverability:** promote Consultations to a primary tab in `mobile-nav.ts`.
8. **i18n + type-check gate:** fr/en/ar for every new string, ar RTL verified; `npm run type-check`
   at zero; append `SESSION_LOG.md`; print MANUAL TEST STEPS.

---

**STOP — awaiting explicit "approved" before writing any code.**
