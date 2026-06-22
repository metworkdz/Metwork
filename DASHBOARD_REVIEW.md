# Dashboard Review — Incubator & Admin (post Prompts 1–3)

**Date:** 2026-06-22
**Branch:** `chore/dashboard-review`
**Type:** Read-only audit. No application code changed.
**Method:** Traced each UI action → API route → server service → JSONB store, and
confirmed the response is rendered. `tsc --noEmit` run. i18n key parity diffed across
en/fr/ar. Live device testing was **not** performed (static trace only) — mobile/RTL
notes are code-level observations, flagged for manual verification.

## Headline results

- **TypeScript:** `npm run type-check` → **0 errors**.
- **i18n JSON parity:** en = fr = ar = **3430 keys**, zero missing on any side. All i18n
  gaps below are *hardcoded strings in components that bypass the message files*, not
  missing translation keys.
- **No hard P0 breakage found** — every module traces end-to-end and renders. The most
  serious issues are a latent correctness risk (incubator-lookup inconsistency) and two
  fully-untranslated management surfaces.
- **Non-blocking external calls:** verified — booking notification helpers
  (`sendBookingUpdatedEmail`, `sendBookingProviderCancelledEmail`, approval emails) wrap
  the provider call in `try/catch` and never throw; mutations are not rolled back by mail
  failures.
- **Idempotency:** booking confirm/cancel wallet movements use stable `reference` keys;
  income/expense CSV import replays on `clientReference`; account-approval is a no-op when
  re-applied.

---

## INCUBATOR DASHBOARD

| Module | Status | File(s) | Note |
|---|---|---|---|
| Dashboard home / KPIs | PASS (i18n NEEDS-FIX) | `app/[locale]/dashboard/incubator/page.tsx` | KPIs (spaces/bookings/income/clients) load from real store data. Greeting + every StatCard label hardcoded English. **Wallet** StatCard shows hardcoded `—` (never wired to a real balance). |
| Spaces — list/create/edit/delete | PASS | `spaces-manager.tsx`, `space-form-dialog.tsx`, `spaces-mobile-list.tsx`, `api/incubator/spaces/**` | Full CRUD + availability dialog. Edit/delete wired (BUG-2 fix). |
| Spaces — image upload / city / hours / payment methods | PASS | `space-form-dialog.tsx` (`GalleryUploadField`) | Image upload, working days/hours, accepted payment methods, cash-deposit config all present and POST/PATCH to `/api/incubator/spaces`. |
| Programs — CRUD | PASS | `programs-manager.tsx`, `program-form-dialog.tsx`, `api/incubator/programs/**` | Wired. `confirm()/alert()` strings hardcoded English. |
| Events — CRUD | PASS | `events-manager.tsx`, `event-form-dialog.tsx`, `api/incubator/events/**` | Wired. Uses `t()` for confirm/delete (good example). |
| Manual bookings — create (existing + new client) | PASS (i18n BROKEN) | `manual-booking-dialog.tsx` → `POST /api/incubator/bookings`; `client-picker.tsx` | Live page uses `ManualBookingDialog` **with** the searchable `ClientPicker` (inline add works). The dialog is **fully hardcoded English** (no `useTranslations`). See duplication note below. |
| Manual bookings — list + status transitions | PASS | `app/[locale]/dashboard/incubator/bookings/page.tsx`, `booking-row-actions.tsx`, `cancel-unpaid-button.tsx`, `api/incubator/bookings/[id]` | Server-rendered table; PATCH confirm/cancel + cancel-unpaid + mark-cash-paid all wired with correct wallet ledger reversal logic. |
| Clients / CRM — list/search/add (incl. inline)/edit | PASS | `clients-manager.tsx`, `client-picker.tsx`, `api/incubator/clients`, `.../clients/search` | Wired. `confirm()` hardcoded English. |
| Services — list/create/edit | PASS | `services-manager.tsx`, `api/incubator/services/**` | Wired (soft-delete). `confirm()` hardcoded English. |
| Income & Expenses — list/add | PASS | `income-manager.tsx`, `expenses-manager.tsx`, `api/incubator/income`, `.../expenses` | Wired. `confirm()/alert()` hardcoded English. |
| Income & Expenses — CSV import | PASS (i18n NEEDS-FIX) | `csv-import-dialog.tsx`, `api/incubator/{income,expenses}/import`, `server/incubator/import-service.ts` | Import is idempotent on `clientReference`, rate-limited (30/h), find-or-create client+service. `csv-import-dialog.tsx` is **fully hardcoded English** (no `useTranslations`). |
| Invoicing / receipts — generate + PDF + email | PASS | `receipt-modal.tsx`, `api/incubator/receipts/[id]` | Receipt data served; **"PDF" = `window.print()`** (Print → Save as PDF). Booking emails fire-and-forget, non-throwing. Notes: receipt body is **EN/FR only (no AR)**; invoices/receipts list **excludes EVENT bookings** (SPACE+PROGRAM only). |
| Analytics — charts on real data | PASS | `analytics-dashboard.tsx`, `api/incubator/analytics` | Fully i18n; KPIs + CSS bar chart + SVG trend chart render from `/analytics`. (SVG chart is not RTL-mirrored — cosmetic.) |
| Subscription & payments — FLAT vs COMMISSION | PASS (i18n BROKEN) | `subscription-manager.tsx`, `api/incubator/subscription`, `server/incubator/service.ts` | Activate/renew/switch all wired; effective-plan read-time expiry correct. **Entire component is hardcoded English (no `useTranslations`).** |
| Subscription — cash/online gating | PASS | `space-form-dialog.tsx`, `server/payments/commission.ts`, `server/bookings/card-payment.ts` | Payment-method gating is enforced at space config + booking-intent layer, not the subscription UI. Functions correctly. |
| Wallet / payouts | PASS | `app/[locale]/dashboard/incubator/wallet/page.tsx` → `features/wallet/wallet-dashboard.tsx`, `services/wallet.service.ts` | Shared dashboard (entrepreneur + incubator) via `walletService.getMyWallet/listTransactions/createPayment`. i18n present. |
| Revenue | PASS | `app/[locale]/dashboard/incubator/revenue/page.tsx`, `revenue-dashboard.tsx`, `api/incubator/revenue` | Real bookings + commission engine + effective subscription code. Excludes EVENT (consistent with invoices). |

---

## ADMIN DASHBOARD

| Module | Status | File(s) | Note |
|---|---|---|---|
| Incubators — list/add/edit/delete | PASS | `incubators-manager.tsx`, `api/admin/incubators/**` | Add/edit/approve/reject/archive/restore all wired + i18n. See two notes below. |
| Incubators — page chrome | NEEDS-FIX (i18n) | `app/[locale]/dashboard/admin/incubators/page.tsx` | `title`/`subtitle`/`"{n} active"` hardcoded English (the loaded `t` is unused). `SUB_LABEL` renders hardcoded **"Commission (20%)" / "Flat (6,000 DZD/mo)"** — stale vs admin-configurable platform rates. |
| Incubators — admin "Add" creates no login | NEEDS-FIX (design) | `api/admin/incubators/route.ts` (POST) | Creates an `IncubatorRecord` with **no `managerId` and no user account** → directory-only entry whose owner can never log in. Confirm whether intended (vs. self-signup being the only onboarding path). |
| Mentors / consultants | PASS | `mentors-manager.tsx`, `mentor-form-dialog.tsx`, `mentor-availability-dialog.tsx`, `api/admin/mentors/**` | Wired + i18n. |
| Bookings — all-bookings view | PASS (view-only) | `app/[locale]/dashboard/admin/bookings/page.tsx`, `admin-bookings-table.tsx` | Lists `data.bookings`. **Read-only — no approve/cancel actions** (incubators act on their own; admin monitors). Status label hardcoded English (`charAt+toLowerCase` → "Pending_payment"). `"{n} pending"` hardcoded. |
| Account approvals (NEW — Prompt 3) | PASS | `app/[locale]/dashboard/admin/approvals/page.tsx`, `account-approvals-manager.tsx`, `api/admin/accounts/[id]/approval`, `server/auth/approval.ts` | Lists pending/approved/rejected INCUBATOR/INVESTOR/BUSINESS; approve/reject wired. `setAccountApproval` is idempotent, syncs unified `approvalStatus` + legacy per-surface gate, appends audit log, fires role-correct email fire-and-forget. Signup sets PENDING on **both** `user.approvalStatus` and `IncubatorRecord.status`. |
| Consultation / mentor bookings — visible & actionable | PASS (read-only by design) | `app/[locale]/dashboard/admin/mentor-bookings/page.tsx`, `mentor-bookings-table.tsx` | Consultations live in `data.mentorBookings` (separate page, not admin/bookings). **Visible** with full filters; intentionally **read-only** (instant-book retired the approval gate; consultant sets link / marks complete). Admin link/complete endpoints exist (`api/admin/consultations/[id]/{link,complete}`) but have **no admin UI button** — only a gap if product wants admin to act on a consultant's behalf. |
| Payouts | PASS | `app/[locale]/dashboard/admin/withdrawals/page.tsx`, `withdrawals-manager.tsx`, `mentor-withdrawals-manager.tsx` | Page mounts **both** incubator/entrepreneur and mentor payout managers; PATCH approve/reject wired + i18n. |
| Promo codes — list/create/validate | PASS | `create-promo-code-form.tsx` (`/api/admin/promo-codes`), `promo-code-manager.tsx` (partner codes), `api/promo-codes/validate` | Both regular and partner promo flows wired + i18n. (`promo-code-toggle.tsx` lacks i18n — tiny.) |
| Memberships | PASS | `memberships-manager.tsx`, `api/admin/memberships/**` | Assign/clear membership wired + i18n. |
| Analytics | PASS (spot-checked) | `app/[locale]/dashboard/admin/analytics/page.tsx` (543 lines) | Renders server-side from store; uses `getTranslations`. Not exhaustively line-traced — recommend a quick manual pass with real data. |

---

## CROSS-CUTTING

| Check | Status | Note |
|---|---|---|
| i18n key parity (en/fr/ar) | PASS | 3430 keys each, zero missing. |
| i18n — hardcoded strings | NEEDS-FIX | 4 components with **no** `useTranslations`: `subscription-manager`, `manual-booking-dialog`, `csv-import-dialog`, `promo-code-toggle`. Plus scattered `confirm()/alert()`/`title=`/status-casing literals (see punch-list P2). |
| TypeScript (`tsc --noEmit`) | PASS | 0 errors. |
| Auth / role gating (read-only-until-approved) | PASS | `requireApprovedApiRole` / `requireApprovedApiSession` centralize the write-gate; gated roles default to APPROVED only when the field is absent (legacy grandfathering), and signup explicitly stamps PENDING. Entrepreneurs/admin are non-gated (`isAccountApproved` → true). Pending accounts get typed `403 ACCOUNT_PENDING`. |
| Entrepreneurs unaffected | PASS | ENTREPRENEUR is not an approval-gated role; `getApprovalStatus` short-circuits to APPROVED. |
| Non-blocking notifications | PASS | Mock/email helpers swallow errors internally; awaited post-commit sends cannot roll back booking/account mutations. |
| Incubator lookup consistency | NEEDS-FIX | **Two lookup strategies coexist:** ~24 routes use `findIncubatorByUserEmail` (email→managerId fallback, self-healing); ~20 pages/routes use inline `data.incubators.find(i => i.managerId === user.id)` (managerId only). For self-registered incubators both coincide (signup sets `managerId` and `email` to the same user), but admin-created/legacy records can diverge. See P1. |
| Mobile responsiveness | NOT TESTED (code-level OK) | Home/spaces/programs ship explicit mobile variants (`MobileOverview`, `spaces-mobile-list`, `programs-mobile-list`); tables use `overflow-x-auto`. No live device run in this audit. Prior known iOS-Safari dashboard crash is tracked separately on `feat/booking-form-ux` (see memory) — re-verify the bookings page + receipt-print + manual-booking dialog on iPhone Safari. |
| Hydration / stale-render | PASS (static) | Affected pages use `export const dynamic = 'force-dynamic'` / `revalidate = 0`; no obvious client/server text mismatch found. Not runtime-observed. |
| Code duplication | NEEDS-FIX | Two parallel manual-booking implementations: `ManualBookingDialog` → `POST /api/incubator/bookings` (real incubator dashboard, untranslated) vs `ManualBookingForm`/`BookingsManager` → `POST /api/incubator/manual-bookings` (admin's own incubator at `/dashboard/admin/incubator/*`, translated). |
| Nav reachability | NEEDS-FIX (minor) | `/dashboard/incubator/members` exists (page + `/api/incubator/members`) but is **not** in the incubator nav — reachable by URL only. |

---

## Prioritized punch-list

### P0 — broken / blocking
None found. Every audited module traces end-to-end and renders.

### P1 — degraded
1. **Incubator-lookup inconsistency (latent money/booking-state risk).**
   `app/.../incubator/{spaces,settings,invoices,programs,events,revenue,members}/page.tsx`
   and write routes `api/incubator/bookings/[id]`, `.../bookings/[id]/mark-cash-paid`,
   `.../spaces/[id]`, `.../profile`, `.../manual-bookings`, etc. use managerId-only `find`,
   while the bookings *page* and ~24 other routes use `findIncubatorByUserEmail`. If a record's
   `managerId` ever diverges from the logged-in user (admin-created or legacy), the list
   renders (email path) but confirm/cancel/edit returns `404 NO_INCUBATOR`.
   *Suspected fix:* introduce one shared `resolveIncubatorForUser(user)` helper and route
   every page/route through it. **Model: Opus** (auth/store).
2. **`subscription-manager.tsx` is fully untranslated.** A core monetization surface
   (Pro/Commission, billing cycle, trial, renewal) renders English for FR/AR users.
   *Fix:* add `useTranslations` + `incubator.subscription.*` keys to en/fr/ar (RTL).
   **Model: Sonnet** (string extraction; verify currency/plurals).
3. **`manual-booking-dialog.tsx` is fully untranslated.** The primary incubator booking-
   entry surface (billing unit, payment method, labels, buttons) is English-only.
   *Fix:* add i18n keys to en/fr/ar; reuse existing `incubator.bookings.*` namespace.
   **Model: Sonnet.**
4. **Incubator home Wallet card shows hardcoded `—`.** `incubator/page.tsx` never reads the
   wallet; the "Platform wallet balance" StatCard is a dead placeholder.
   *Fix:* read the manager's wallet balance in the RSC and `formatCurrency` it.
   **Model: Opus** (touches wallet read) or Sonnet if scoped to display only.

### P2 — polish / i18n
5. **Hardcoded `confirm()/alert()` in 6 managers** — `spaces-`, `programs-`, `services-`,
   `clients-`, `income-`, `expenses-manager`. Replace with i18n strings (and ideally a styled
   dialog so RTL/locale apply; native `confirm` ignores both). **Model: Sonnet.**
6. **`csv-import-dialog.tsx` untranslated** — add `useTranslations`. **Model: Sonnet.**
7. **`bookings-manager.tsx`** `title="Confirm"/"Cancel"/"View receipt"` + English title-casing
   of `itemKind`/`status` (`Space`, `Pending_payment`). (Note: this component is only live in
   the admin's-own-incubator subtree.) **Model: Sonnet.**
8. **`admin-bookings-table.tsx`** status rendered via `charAt+toLowerCase` (English, and
   `Pending_payment`); use the shared `BookingStatusBadge`/`t()`. **Model: Sonnet.**
9. **`admin/incubators/page.tsx`** hardcoded title/subtitle/"{n} active" (loaded `t` unused).
   **Model: Sonnet.**
10. **`admin/bookings/page.tsx`** `"{pending} pending"` hardcoded. **Model: Sonnet.**
11. **`incubators-manager.tsx` `SUB_LABEL`** hardcoded "Commission (20%)" / "Flat (6,000 DZD/mo)"
    — stale vs admin-configured `platformConfig`. Derive from config + i18n. **Model: Sonnet.**
12. **`spaces-manager.tsx` `categoryLabel`** hardcoded English map (Coworking/Private office/…).
    **Model: Sonnet.**
13. **Receipt body EN/FR only (no AR)** in `receipt-modal.tsx` (`L` map). Acceptable for a
    legal/print bilingual receipt — decide whether AR is required and, if so, add it. **Model: Sonnet.**
14. **Duplicate manual-booking paths** (`/api/incubator/bookings` vs `/api/incubator/manual-bookings`,
    `ManualBookingDialog` vs `ManualBookingForm`). Consolidate onto one endpoint + one translated
    component. **Model: Opus** (booking/store semantics differ between the two).
15. **`/dashboard/incubator/members` not in nav** — add a nav entry or retire the page.
    **Model: Sonnet.**
16. **Admin consultation oversight has no action UI** — if product wants admin to set
    link / mark complete on a consultant's behalf, wire buttons in `mentor-bookings-table.tsx`
    to the existing `api/admin/consultations/[id]/{link,complete}` endpoints. **Model: Sonnet.**
17. **Admin-created incubators have no `managerId`/login** (`api/admin/incubators` POST) — confirm
    intent; if these should be operable, also create/link a manager user. **Model: Opus** (auth/store).
18. **SVG analytics chart not RTL-mirrored** (cosmetic). **Model: Sonnet.**

### Verification still owed (not doable in a static audit)
- iPhone Safari pass on: incubator **bookings** page, **receipt** print, **manual-booking**
  dialog, **CSV import** dialog (these combine tables/dialogs/print most likely to break on iOS).
- Live data pass on **admin analytics** (only spot-checked).
- Runtime hydration check on the dashboards under all three locales (incl. `dir="rtl"`).
