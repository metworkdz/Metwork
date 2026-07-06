# AUDIT — Nav Activity Badges + Landing Visibility

**Status: READ-ONLY audit. No code written. Awaiting explicit "approved" before any implementation.**

Scope investigated: nav surfaces (admin / incubator / entrepreneur), countable store collections, session/user record, landing routes. Everything below is grounded in the current code on branch `main`; file/line refs are clickable.

---

## A. NAV SURFACES

### Single source of truth for nav items
- [src/config/navigation.ts](src/config/navigation.ts) — `dashboardNavByRole: Record<UserRole, NavItem[]>`. Every dashboard nav item is defined here, keyed by a **stable `href`** (e.g. `/dashboard/admin/approvals`). `NavItem` = `{ labelKey, href, icon?, external?, sectionHeader?, roles? }`. **`href` is the natural stable key to attach a badge to.**
- [src/config/mobile-nav.ts](src/config/mobile-nav.ts) — mobile derives 100% from `dashboardNavByRole`; it only *selects* which hrefs are promoted:
  - `getMobilePrimaryTabs(role)` → 4 primary bottom-tab items (looked up by href).
  - `getMobileMoreItems(role)` → every remaining non-primary item (the "More" overflow sheet).
  - `MORE_NAV` → the sentinel for the "More" trigger.

### Rendering surfaces (all consume the config above; no per-page nav)
| Surface | Component | Visibility | Keyed by |
|---|---|---|---|
| Desktop sidebar | [src/components/layout/dashboard-sidebar.tsx](src/components/layout/dashboard-sidebar.tsx) | `hidden … lg:block` | `item.href` (map at :26) |
| Mobile bottom tab bar | [src/components/layout/mobile-tab-bar.tsx](src/components/layout/mobile-tab-bar.tsx) | `lg:hidden` (fixed bottom) | `item.href` (primary tabs :47) |
| Mobile "More" sheet | same file, `<Sheet>` at :72 | opened from bottom bar | `item.href` (:79) |
| "More" trigger cell | same file, `<button>` at :53 | mobile only | `MORE_NAV` sentinel |

- Both surfaces are wired in the dashboard shell [src/app/[locale]/dashboard/layout.tsx](src/app/[locale]/dashboard/layout.tsx): `<DashboardSidebar role>` + `<MobileTabBar role>`. `INVESTOR` has an extra nested layout ([src/app/[locale]/dashboard/investor/layout.tsx](src/app/[locale]/dashboard/investor/layout.tsx)) but still renders the shared shell — **no investor sources are in scope for this feature (admin/incubator/entrepreneur only), so no investor badge work.**
- **Collapsed state:** there is NO collapsible/mini desktop sidebar variant. The only "collapsed" surface is mobile, where non-primary items live inside the **"More" sheet**. Requirement 7 (badges on collapsed states) therefore maps to: **the "More" trigger must show an aggregate badge = sum of badges of the items hidden inside the sheet**, and each item inside the sheet shows its own badge.

### Consequence for design
A **single per-role badge map `{ [href]: number }`** feeds all three surfaces. Both nav components already `map` over items keyed by href, so a badge slot can be attached at each render point (sidebar `<Link>`, tab `<TabLink>`, sheet `<Link>`) plus a computed aggregate on the `MORE_NAV` button. No nav restructuring required — additive only.

---

## B. COUNTABLE COLLECTIONS

Store = single JSONB doc, `DbShape` at [src/server/db/store.ts:2416](src/server/db/store.ts). Server components read it directly via `db.read()` (e.g. [approvals/page.tsx](src/app/[locale]/dashboard/admin/approvals/page.tsx) :30, [contacts/page.tsx](src/app/[locale]/dashboard/admin/contacts/page.tsx) :22). **All candidate collections carry `createdAt` (ISO string). Most also carry `updatedAt`.** Verified per-record below.

### ADMIN candidate sources (global collections)
| Nav key (href) | Collection | Count rule | `createdAt` | `updatedAt` | Verdict |
|---|---|---|---|---|---|
| `/dashboard/admin/approvals` | `users` | `approvalStatus === 'PENDING'` (gated roles INCUBATOR/INVESTOR/BUSINESS) | ✅ :56 | ✅ :57 | **Countable.** `ApprovalStatus` gate at store :121. |
| `/dashboard/admin/incubators` | `incubators` | `status === 'PENDING'` | ✅ :665 | — | **Countable.** `IncubatorStatus` :580. |
| `/dashboard/admin/mentors` | `mentors` | `source === 'SELF' && approvalStatus === 'PENDING'` | ✅ :1593 | — | **Countable** (self-signup consultant approvals; fields at store :122/:126). |
| `/dashboard/admin/mentor-bookings` | `mentorBookings` *(or* `mentorConsultations`*)* | `status === 'PENDING'` | ✅ :1561 | ✅ :1561-region | **Countable.** Two overlapping collections — see RISK-1. |
| `/dashboard/admin/bookings` | `bookings` | `status ∈ {PENDING, PENDING_PAYMENT}` | ✅ :562 | ✅ :563 | **Countable.** `BookingStatus` :384. |
| `/dashboard/admin/users` | `users` | `createdAt > lastSeen` (all new signups) | ✅ :56 | — | **Countable** (new-signups feed). |
| `/dashboard/admin/contacts` | `contactSubmissions` | `handled !== true` | ✅ :575 | — | **Countable.** `handled?: boolean` :574. |
| `/dashboard/admin/investor-contacts` | `investorContacts` | `status === 'PENDING'` | ✅ :2039 | ✅ :2040 | **Countable.** `InvestorContactStatus` :2026. |
| `/dashboard/admin/payments` | `withdrawalRequests` + `mentorWithdrawals` | `status === 'PENDING'` (both ledgers) | ✅ :2135 / :2223 | ✅ :2136 | **Countable.** `WithdrawalStatus` :2081. No dedicated withdrawals nav item exists → attach to the manual-queue `payments` page. |

### INCUBATOR candidate sources (scoped by `incubators.find(i => i.managerId === user.id)` → then space/program/event ids; pattern confirmed at [incubator/bookings/page.tsx](src/app/[locale]/dashboard/incubator/bookings/page.tsx) :86-100)
| Nav key (href) | Collection | Count rule | Timestamp | Verdict |
|---|---|---|---|---|
| `/dashboard/incubator/bookings` | `bookings` (items owned by incubator) | `status ∈ {PENDING, PENDING_PAYMENT}` OR `paymentStatus === 'AWAITING_CASH'` | `createdAt` ✅ | **Countable.** Scope = booking.itemId ∈ owned space/program/event ids. |
| `/dashboard/incubator/domiciliation` | `domiciliationRequests` | `incubatorId === inc.id && status === 'PENDING'` | `createdAt` ✅ :2413 | **Countable.** Has direct `incubatorId`. |
| `/dashboard/incubator/clients` | `clients` | `incubatorId === inc.id && createdAt > lastSeen` (new CRM clients) | `createdAt` ✅ :1743 | **Countable.** Direct `incubatorId`. |
| `/dashboard/incubator/spaces` *(or bookings)* | `deskBookings` | `incubatorId === inc.id && source === 'online' && status === 'CONFIRMED' && createdAt > lastSeen` | `createdAt` ✅ :2389 | **Countable** (new online desk bookings). Direct `incubatorId`. Attach location TBD (see RISK-3). |
| *(no dedicated nav item)* | `registrations` | `incubatorId === inc.id && createdAt > lastSeen` | `createdAt` ✅ :1071 | **Countable but no home** — registrations surface inside programs/events pages, not a top-level nav item. See RISK-3; recommend attaching to `programs`/`events` or deferring. |

### ENTREPRENEUR candidate sources (scoped by `userId === user.id`)
> Design note: for entrepreneur, a record they *created* is not "news"; the relevant signal is a **status change by someone else** → use `updatedAt > lastSeen` (not `createdAt`).

| Nav key (href) | Collection | Count rule | Timestamp used | Verdict |
|---|---|---|---|---|
| `/dashboard/entrepreneur/bookings` | `bookings` | `userId === user.id && updatedAt > lastSeen` | `updatedAt` ✅ :563 | **Countable.** Coarse signal — see RISK-2. |
| `/dashboard/entrepreneur/consultations` | `mentorConsultations` (+/or `mentorBookings`) | `userId === user.id && updatedAt > lastSeen` | `updatedAt` ✅ :2319 / :1561 | **Countable.** |
| `/dashboard/entrepreneur/wallet` | `transactions` | `userId === user.id && createdAt > lastSeen` | `createdAt` ✅ :296 (**no `updatedAt`**) | **Countable** as *new* wallet events only. Status transitions (PENDING→COMPLETED) are NOT separately timestamped → see RISK-2. |

### Flagged / rejected sources
- **`registrations`** — real, timestamped, `incubatorId`-scoped, but no nav item to hang it on. Flag, don't invent nav.
- **entrepreneur `membership` events** — no per-user membership *event* collection with its own timestamp; `userMemberships` has `createdAt`/`status` but membership changes mutate `UserRecord` fields (`membershipCode`, etc.) without an event row. **No usable "membership changed" signal → exclude.**
- **`sessions`, `otps`, `emailTokens`, `passwordResets`, `bookingIntents`, slot-locks** — auth/ephemeral, not activity. Exclude.

**Timestamp coverage conclusion:** every proposed source is backed by a real collection with `createdAt`. No candidate silently assumed — the only gaps (transactions lacking `updatedAt`; registrations lacking a nav home; membership lacking an event row) are called out above and in RISK.

---

## C. SESSION / USER RECORD (where "last seen" lives)

- Current user resolved server-side by `getServerSession()` → `/api/auth/me` → `toSessionUser(ctx.user)` ([src/lib/session.ts](src/lib/session.ts), [src/app/api/auth/me/route.ts](src/app/api/auth/me/route.ts)). Role guard: `requireRole()` ([src/lib/auth-guards.ts](src/lib/auth-guards.ts)).
- **Critical confirmed linkage:** `/auth/me` reads `ctx.user` **from the local store** and `SessionUser.id === UserRecord.id`. Proof: incubator pages do `data.incubators.find(i => i.managerId === user.id)` using the session `user.id` against store records. So the current user is always a real `UserRecord` in `db`.
- **Proposed home for "last seen":** a new nullable field on `UserRecord` ([store.ts:31](src/server/db/store.ts)):
  ```ts
  /** Per-nav-key ISO timestamp of when the user last opened that surface. Absent ⇒ never seen (treated as epoch/all-new). */
  navLastSeen?: Record<string, string> | null;
  ```
  Keyed by nav `href`. **This is the ONLY write the feature performs** (Requirement 2), via `db.update(d => { … })` on the matching user. It is NOT serialized to `SessionUser` (no need on the client; badge counts come from the server hook).
- Safe default: missing key ⇒ epoch ⇒ every existing record counts as "new" on first load. Backward-compatible (Requirement 5).

---

## D. LANDING PAGES

### How the public nav is built
- Desktop navbar consumes `publicNavItems` ([src/components/layout/navbar.tsx](src/components/layout/navbar.tsx) :54) from [navigation.ts:68](src/config/navigation.ts). Footer consumes `footerNavGroups` :87. **Single config source, same pattern as dashboard nav.**
- `publicNavItems` groups: *For Entrepreneurs* (dropdown → programs, events, spaces, mentors, academy), *For Incubators* (`/incubators`), *For Investors* (`/investors`), *Memberships* (`/pricing`).

### Toggleable landing routes (file-based, under `src/app/[locale]/(public)/`)
| Section | Route | Page file |
|---|---|---|
| Home | `/` | `(public)/page.tsx` |
| Memberships | `/pricing` | `(public)/pricing/page.tsx` |
| Investors (network/partner) | `/investors`, `/investors/[id]` | `(public)/investors/…` |
| Startups marketplace | `/startups` | `(public)/startups/page.tsx` |
| Consultant | `/consultant` | `(public)/consultant/page.tsx` |
| Spaces | `/spaces`, `/spaces/[id]` | `(public)/spaces/…` |
| Programs | `/programs`, `/programs/[slug]` | `(public)/programs/…` |
| Events | `/events`, `/events/[slug]` | `(public)/events/…` |
| Mentors | `/mentors`, `/mentors/[slug]` | `(public)/mentors/…` |
| Incubators | `/incubators` | `(public)/incubators/page.tsx` |
| Academy | `/academy` | `(public)/academy/page.tsx` |
| About | `/about` | `(public)/about/page.tsx` |
| Contact | `/contact` | `(public)/contact/page.tsx` |
| Legal | `/privacy-policy`, `/terms` | `(public)/…` |

- **404 enforcement point:** each landing `page.tsx` is a server component that already calls `setRequestLocale(locale)` at top. A centralized `getLandingVisibility()` helper (read once) + `notFound()` guard can be added per page (server-side) — no client visibility checks, no nav-only hiding that leaves the route reachable.
- **Where a visibility config could live (read-only for this feature except its own admin toggle later):** `platformSettings` ([store.ts:771](src/server/db/store.ts), `PlatformSettingsRecord`) or `meta.platformConfig` ([store.ts:1943](src/server/db/store.ts)). **No landing-visibility flags exist today** — a new nullable `landingVisibility?: Record<string, boolean>` (default: all visible) would be additive. Both nav (`publicNavItems` render) and page `notFound()` guards read the same helper → Requirement 4 "one `getLandingVisibility()`".

---

## PROPOSED PER-ROLE SOURCE REGISTRY (design sketch — for approval, not yet built)

One centralized module (e.g. `src/server/notifications/activity-sources.ts`) exporting:

```ts
// Each source: pure reader over db + the user's navLastSeen, returns a count.
interface ActivitySource {
  navKey: string;                    // === nav item href (stable key)
  count(db, user, lastSeenISO): number;
}
type Registry = Record<UserRole, ActivitySource[]>;
```

- **ADMIN:** approvals(users.PENDING), incubators(PENDING), mentors(SELF+PENDING), mentor-bookings(PENDING), bookings(PENDING|PENDING_PAYMENT), users(new since lastSeen), contacts(!handled), investor-contacts(PENDING), payments(withdrawals+mentorWithdrawals PENDING).
- **INCUBATOR:** bookings(owned items, PENDING|PENDING_PAYMENT|AWAITING_CASH), domiciliation(PENDING), clients(new). *(deskBookings / registrations flagged — RISK-3.)*
- **ENTREPRENEUR:** bookings(updatedAt>lastSeen), consultations(updatedAt>lastSeen), wallet(new transactions). 

One `getNavBadges(user)` server function iterates `Registry[user.role]`, returns `{ [navKey]: number }`, capped at "9+" in the UI. Fetched server-side in the dashboard layout, passed as SSR fallback to a client hook that revalidates (Requirement 6). Failure → return `{}` (no badge, no crash — Requirement 8).

---

## RISK LIST

- **RISK-1 (data model overlap):** consultations exist as BOTH `mentorBookings` (legacy + inquiry) and `mentorConsultations` (newer lifecycle). Admin "pending consultations" and entrepreneur "consultation updates" must pick ONE authoritative collection per surface to avoid double-counting. **Must confirm which the admin `/mentor-bookings` page and the entrepreneur `/consultations` page actually render before wiring counts.**
- **RISK-2 (coarse entrepreneur signal):** `updatedAt` flips on *any* mutation, and `transactions` have no `updatedAt` (status transitions aren't timestamped). Entrepreneur badges will be approximate ("something changed") rather than precise ("your booking was approved"). Acceptable for a badge, but call it out; do not claim per-event precision.
- **RISK-3 (sources without a nav home):** `registrations` and new `deskBookings` are countable but have no dedicated nav item. Either attach to an existing key (`programs`/`events`/`spaces`/`bookings`) or defer. Needs a product decision — flag, don't guess.
- **RISK-4 (booking→incubator scoping cost):** incubator booking counts require resolving owned space/program/event id-sets per request (already done by the bookings page). Centralize this resolution once in the source module to avoid N re-reads / duplication (Requirement 4).
- **RISK-5 (write-path safety):** the `navLastSeen` write is the only mutation. It must be a targeted `db.update` on the current user only, must never touch any other field, and must be debounced/idempotent (writing on every dashboard nav hit is fine but should not race the atomic document — the single-doc store serializes writes, but concurrent tabs could clobber sibling keys if the whole map is replaced; merge keys, don't overwrite the map).
- **RISK-6 (SSR/hydration):** badge counts MUST be computed server-side in the layout and passed as the client hook's `fallback`, or the first client paint will differ from SSR (Requirement 6). No `window`/`useMediaQuery` (Requirement 7) — surfaces differ by Tailwind breakpoint only, already the case.
- **RISK-7 (landing 404):** hiding a landing item in `publicNavItems` alone leaves the route reachable by URL. Real enforcement requires a per-page `notFound()` guard reading the SAME `getLandingVisibility()` helper. Dynamic child routes (`/programs/[slug]`, etc.) need the parent-section flag applied too.
- **RISK-8 (branch):** this audit was produced on `main`. **No feature branch was named in the prompt.** Per Requirement 11, implementation must NOT happen on `main` — a branch name is needed before any code. (This `.md` is documentation only, no code/commit.)
- **RISK-9 (i18n + design tokens):** new badge `aria-label` strings need fr (default) + en + ar in [src/i18n/messages/{en,fr,ar}.json], RTL-verified. Badge visual = solid red circle, white number, Space Grotesk, "9+" cap; primary green `#30a735` and existing nav styling must remain untouched (Requirements 9-10).

---

## OPEN QUESTIONS BEFORE IMPLEMENTATION
1. **Branch name** for the work (Requirement 11 / RISK-8).
2. **Consultations collection** authority: `mentorBookings` vs `mentorConsultations` per surface (RISK-1).
3. **RISK-3 sources** (`registrations`, `deskBookings`): attach where, or defer?
4. **Landing visibility** — is the admin toggle UI in scope now, or only the read-side `getLandingVisibility()` + `notFound()` enforcement (with the flag defaulting to all-visible)?

**STOP — awaiting "approved".**
