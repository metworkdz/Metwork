/**
 * Notification source registry — the SINGLE definition of what each activity
 * count means, per role. Purely read-only over the store document; no source
 * here ever mutates data.
 *
 * Each source declares:
 *  - `key`   — stable source key ('approvals', 'users', …). This is what the
 *              seen map (`UserRecord.notificationsSeen`) and the API speak.
 *              Keys may repeat across roles with DISJOINT `roles` sets (a
 *              user has exactly one role, so 'bookings' can mean the admin
 *              queue for admins and the owned-items queue for incubators).
 *  - `roles` — which roles see the source.
 *  - `mode`  — 'view' (default): "N new since notificationsSeen[key]" — never
 *              seen ⇒ counts from the beginning; clears once the surface is
 *              opened (markSeen). 'pending': "N items currently actionable" —
 *              independent of seen; only clears when the records change state.
 *  - `href`  — the dashboard nav item this source attaches to (badge UI).
 *  - `count(ctx)` → integer for the current user.
 *
 * ISO datetimes compare lexicographically (same convention as the rest of
 * the codebase), so `createdAt > seen` string compares are correct.
 *
 * Documented approximation: entrepreneur 'view' sources over own records use
 * `updatedAt > createdAt` as the mutation signal — the count means "something
 * changed on one of your records", not a per-event feed.
 */
import type { db, UserRecord } from '@/server/db/store';
import type { UserRole } from '@/types/auth';
import { getApprovalStatus, isApprovalGatedRole } from '@/lib/approval-guard';
import { getMentorApprovalStatus } from '@/lib/mentor-approval';

/** The whole store document, as returned by `db.read()`. */
export type StoreDoc = Awaited<ReturnType<typeof db.read>>;

export type SourceMode = 'view' | 'pending';

/** Per-request context shared by every source of a role (computed once). */
export interface BadgeContext {
  data: StoreDoc;
  user: UserRecord;
  /** ISO "seen" stamp for a source key. '' (sorts before everything) = never. */
  seenOf: (key: string) => string;
  /** Resolved for INCUBATOR role only: the incubator managed by this user. */
  incubatorId: string | null;
  /** Item ids owned by that incubator (spaces / programs / events). */
  ownedSpaceIds: Set<string>;
  ownedProgramIds: Set<string>;
  ownedEventIds: Set<string>;
}

export interface NotificationSource {
  /** Stable source key — what the seen map and the API speak. */
  key: string;
  /** Roles that see this source. */
  roles: readonly UserRole[];
  /** Counting semantics — 'view' is the default (see module doc). */
  mode: SourceMode;
  /** Dashboard nav href this source's badge attaches to. */
  href: string;
  /** Pure count of "new / actionable" records for this surface. */
  count: (ctx: BadgeContext) => number;
}

/* ────────────────────────────── Registry ────────────────────────────── */

export const NOTIFICATION_SOURCES: readonly NotificationSource[] = [
  /* ── ADMIN ──────────────────────────────────────────────────────────── */
  {
    // Unified account approvals (INCUBATOR / INVESTOR / BUSINESS in PENDING).
    key: 'approvals',
    roles: ['ADMIN'],
    mode: 'pending',
    href: '/dashboard/admin/approvals',
    count: ({ data }) =>
      (data.users ?? []).filter(
        (u) => isApprovalGatedRole(u.role) && getApprovalStatus(u) === 'PENDING',
      ).length,
  },
  {
    // Incubator records awaiting activation.
    key: 'incubators',
    roles: ['ADMIN'],
    mode: 'pending',
    href: '/dashboard/admin/incubators',
    count: ({ data }) => (data.incubators ?? []).filter((i) => i.status === 'PENDING').length,
  },
  {
    // Self-signed-up consultants awaiting approval.
    key: 'consultants',
    roles: ['ADMIN'],
    mode: 'pending',
    href: '/dashboard/admin/mentors',
    count: ({ data }) =>
      (data.mentors ?? []).filter(
        (m) => m.source === 'SELF' && getMentorApprovalStatus(m) === 'PENDING',
      ).length,
  },
  {
    // Consultation booking requests awaiting admin action.
    key: 'consultations',
    roles: ['ADMIN'],
    mode: 'pending',
    href: '/dashboard/admin/mentor-bookings',
    count: ({ data }) =>
      (data.mentorBookings ?? []).filter((b) => b.status === 'PENDING').length,
  },
  {
    // Space/program/event bookings awaiting approval (mirrors the page stat).
    key: 'bookings',
    roles: ['ADMIN'],
    mode: 'pending',
    href: '/dashboard/admin/bookings',
    count: ({ data }) => (data.bookings ?? []).filter((b) => b.status === 'PENDING').length,
  },
  {
    // New user signups since the admin last opened the Users page.
    key: 'users',
    roles: ['ADMIN'],
    mode: 'view',
    href: '/dashboard/admin/users',
    count: ({ data, seenOf }) => {
      const seen = seenOf('users');
      return (data.users ?? []).filter((u) => u.createdAt > seen).length;
    },
  },
  {
    // Contact-form submissions not yet marked handled.
    key: 'contacts',
    roles: ['ADMIN'],
    mode: 'pending',
    href: '/dashboard/admin/contacts',
    count: ({ data }) =>
      (data.contactSubmissions ?? []).filter((c) => c.handled !== true).length,
  },
  {
    // Investor → startup contact requests awaiting review.
    key: 'investor-contacts',
    roles: ['ADMIN'],
    mode: 'pending',
    href: '/dashboard/admin/investor-contacts',
    count: ({ data }) =>
      (data.investorContacts ?? []).filter((c) => c.status === 'PENDING').length,
  },
  {
    // Manual payout queue: pending withdrawals on BOTH ledgers.
    key: 'withdrawals',
    roles: ['ADMIN'],
    mode: 'pending',
    href: '/dashboard/admin/payments',
    count: ({ data }) =>
      (data.withdrawalRequests ?? []).filter((w) => w.status === 'PENDING').length +
      (data.mentorWithdrawals ?? []).filter((w) => w.status === 'PENDING').length,
  },

  /* ── INCUBATOR (scoped through the resolved incubator; counts are 0 when
   *    the user manages no incubator) ─────────────────────────────────── */
  {
    // Bookings needing action on owned items: awaiting approval, awaiting
    // cash collection — plus new online desk reservations since last seen
    // (desk bookings have no nav home of their own; folded here by design,
    // which is why this 'pending' source also consults the seen stamp).
    key: 'bookings',
    roles: ['INCUBATOR'],
    mode: 'pending',
    href: '/dashboard/incubator/bookings',
    count: (ctx) => {
      if (!ctx.incubatorId) return 0;
      const owned = (itemKind: string, itemId: string) =>
        (itemKind === 'SPACE' && ctx.ownedSpaceIds.has(itemId)) ||
        (itemKind === 'PROGRAM' && ctx.ownedProgramIds.has(itemId)) ||
        (itemKind === 'EVENT' && ctx.ownedEventIds.has(itemId));
      const actionable = (ctx.data.bookings ?? []).filter(
        (b) =>
          owned(b.itemKind, b.itemId) &&
          (b.status === 'PENDING' ||
            (b.status === 'CONFIRMED' && b.paymentStatus === 'AWAITING_CASH')),
      ).length;
      const seen = ctx.seenOf('bookings');
      const newDesks = (ctx.data.deskBookings ?? []).filter(
        (d) =>
          d.incubatorId === ctx.incubatorId &&
          d.source === 'online' &&
          d.status === 'CONFIRMED' &&
          d.createdAt > seen,
      ).length;
      return actionable + newDesks;
    },
  },
  {
    // Domiciliation requests awaiting first contact.
    key: 'domiciliation',
    roles: ['INCUBATOR'],
    mode: 'pending',
    href: '/dashboard/incubator/domiciliation',
    count: (ctx) =>
      ctx.incubatorId
        ? (ctx.data.domiciliationRequests ?? []).filter(
            (r) => r.incubatorId === ctx.incubatorId && r.status === 'PENDING',
          ).length
        : 0,
  },
  {
    // New CRM clients since last seen.
    key: 'clients',
    roles: ['INCUBATOR'],
    mode: 'view',
    href: '/dashboard/incubator/clients',
    count: (ctx) => {
      if (!ctx.incubatorId) return 0;
      const seen = ctx.seenOf('clients');
      return (ctx.data.clients ?? []).filter(
        (c) => c.incubatorId === ctx.incubatorId && c.createdAt > seen,
      ).length;
    },
  },
  {
    // New program registrations since last seen (registrations have no nav
    // item of their own; attached to Programs by design).
    key: 'programs',
    roles: ['INCUBATOR'],
    mode: 'view',
    href: '/dashboard/incubator/programs',
    count: (ctx) => {
      if (!ctx.incubatorId) return 0;
      const seen = ctx.seenOf('programs');
      return (ctx.data.registrations ?? []).filter(
        (r) =>
          r.incubatorId === ctx.incubatorId &&
          r.entityType === 'PROGRAM' &&
          r.status !== 'CANCELLED' &&
          r.createdAt > seen,
      ).length;
    },
  },
  {
    // New event registrations since last seen (same design as programs).
    key: 'events',
    roles: ['INCUBATOR'],
    mode: 'view',
    href: '/dashboard/incubator/events',
    count: (ctx) => {
      if (!ctx.incubatorId) return 0;
      const seen = ctx.seenOf('events');
      return (ctx.data.registrations ?? []).filter(
        (r) =>
          r.incubatorId === ctx.incubatorId &&
          r.entityType === 'EVENT' &&
          r.status !== 'CANCELLED' &&
          r.createdAt > seen,
      ).length;
    },
  },

  /* ── ENTREPRENEUR ("news" = one of THEIR records was mutated after it was
   *    created — status change by an admin/incubator — or a new wallet
   *    ledger entry appeared) ──────────────────────────────────────────── */
  {
    key: 'bookings',
    roles: ['ENTREPRENEUR'],
    mode: 'view',
    href: '/dashboard/entrepreneur/bookings',
    count: ({ data, user, seenOf }) => {
      const seen = seenOf('bookings');
      return (data.bookings ?? []).filter(
        (b) => b.userId === user.id && b.updatedAt > b.createdAt && b.updatedAt > seen,
      ).length;
    },
  },
  {
    key: 'consultations',
    roles: ['ENTREPRENEUR'],
    mode: 'view',
    href: '/dashboard/entrepreneur/consultations',
    count: ({ data, user, seenOf }) => {
      const seen = seenOf('consultations');
      return (data.mentorBookings ?? []).filter(
        (b) => b.userId === user.id && b.updatedAt > b.createdAt && b.updatedAt > seen,
      ).length;
    },
  },
  {
    // New wallet ledger entries since last seen (transactions are immutable
    // and carry no updatedAt — new rows are the only usable signal).
    key: 'wallet',
    roles: ['ENTREPRENEUR'],
    mode: 'view',
    href: '/dashboard/entrepreneur/wallet',
    count: ({ data, user, seenOf }) => {
      const seen = seenOf('wallet');
      return (data.transactions ?? []).filter(
        (t) => t.userId === user.id && t.createdAt > seen,
      ).length;
    },
  },
];

/* ────────────────────────────── Lookups ────────────────────────────── */

/** Sources visible to a role. Roles without sources get []. */
export function sourcesForRole(role: string): NotificationSource[] {
  return NOTIFICATION_SOURCES.filter((s) => (s.roles as readonly string[]).includes(role));
}

/** Source keys registered for a role — used to validate mark-seen writes. */
export function sourceKeysForRole(role: string): string[] {
  return sourcesForRole(role).map((s) => s.key);
}
