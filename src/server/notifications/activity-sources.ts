/**
 * Per-role nav-activity source registry — the SINGLE place that defines what
 * each dashboard nav badge counts. Purely read-only over the store document;
 * no source here ever mutates data.
 *
 * Every source is keyed by the nav item's `href` from `dashboardNavByRole`
 * (see `@/config/navigation`) so badges attach to nav surfaces by a stable key.
 *
 * Two counting styles coexist:
 *  - STATUS sources ("N items need action", e.g. PENDING approvals) — the
 *    badge persists until the underlying status changes; visiting the page
 *    does not clear it.
 *  - SINCE-LAST-SEEN sources ("N new since you last looked") — compared
 *    against `user.navLastSeen[navKey]` (ISO strings compare lexicographically,
 *    same convention as the rest of the codebase). Visiting the page marks the
 *    key seen and the badge clears.
 *
 * Documented approximation: entrepreneur "status change" sources use
 * `updatedAt > createdAt` as the mutation signal — the badge means
 * "something changed on one of your records", not a per-event feed.
 */
import type { db, UserRecord } from '@/server/db/store';
import { getApprovalStatus, isApprovalGatedRole } from '@/lib/approval-guard';
import { getMentorApprovalStatus } from '@/lib/mentor-approval';

/** The whole store document, as returned by `db.read()`. */
export type StoreDoc = Awaited<ReturnType<typeof db.read>>;

/** Per-request context shared by every source of a role (computed once). */
export interface BadgeContext {
  data: StoreDoc;
  user: UserRecord;
  /** ISO "last seen" for a nav key. '' (sorts before everything) = never. */
  lastSeenOf: (navKey: string) => string;
  /** Resolved for INCUBATOR role only: the incubator managed by this user. */
  incubatorId: string | null;
  /** Item ids owned by that incubator (spaces / programs / events). */
  ownedSpaceIds: Set<string>;
  ownedProgramIds: Set<string>;
  ownedEventIds: Set<string>;
}

export interface ActivitySource {
  /** Stable nav key — MUST equal the item's `href` in `dashboardNavByRole`. */
  navKey: string;
  /** Pure count of "new / actionable" records for this surface. */
  count: (ctx: BadgeContext) => number;
}

/* ────────────────────────────── ADMIN ────────────────────────────── */

const adminSources: ActivitySource[] = [
  {
    // Unified account approvals (INCUBATOR / INVESTOR / BUSINESS in PENDING).
    navKey: '/dashboard/admin/approvals',
    count: ({ data }) =>
      (data.users ?? []).filter(
        (u) => isApprovalGatedRole(u.role) && getApprovalStatus(u) === 'PENDING',
      ).length,
  },
  {
    // Incubator records awaiting activation.
    navKey: '/dashboard/admin/incubators',
    count: ({ data }) => (data.incubators ?? []).filter((i) => i.status === 'PENDING').length,
  },
  {
    // Self-signed-up consultants awaiting approval.
    navKey: '/dashboard/admin/mentors',
    count: ({ data }) =>
      (data.mentors ?? []).filter(
        (m) => m.source === 'SELF' && getMentorApprovalStatus(m) === 'PENDING',
      ).length,
  },
  {
    // Consultation booking requests awaiting admin action.
    navKey: '/dashboard/admin/mentor-bookings',
    count: ({ data }) =>
      (data.mentorBookings ?? []).filter((b) => b.status === 'PENDING').length,
  },
  {
    // Space/program/event bookings awaiting approval (mirrors the page's stat).
    navKey: '/dashboard/admin/bookings',
    count: ({ data }) => (data.bookings ?? []).filter((b) => b.status === 'PENDING').length,
  },
  {
    // New user signups since the admin last opened the Users page.
    navKey: '/dashboard/admin/users',
    count: ({ data, lastSeenOf }) => {
      const seen = lastSeenOf('/dashboard/admin/users');
      return (data.users ?? []).filter((u) => u.createdAt > seen).length;
    },
  },
  {
    // Contact-form submissions not yet marked handled.
    navKey: '/dashboard/admin/contacts',
    count: ({ data }) =>
      (data.contactSubmissions ?? []).filter((c) => c.handled !== true).length,
  },
  {
    // Investor → startup contact requests awaiting review.
    navKey: '/dashboard/admin/investor-contacts',
    count: ({ data }) =>
      (data.investorContacts ?? []).filter((c) => c.status === 'PENDING').length,
  },
  {
    // Manual payout queue: pending withdrawals on BOTH ledgers.
    navKey: '/dashboard/admin/payments',
    count: ({ data }) =>
      (data.withdrawalRequests ?? []).filter((w) => w.status === 'PENDING').length +
      (data.mentorWithdrawals ?? []).filter((w) => w.status === 'PENDING').length,
  },
];

/* ──────────────────────────── INCUBATOR ──────────────────────────── */
/* All sources scope through the resolved incubator; when the user manages
 * no incubator every count is 0 (guarded by `incubatorId === null`).      */

const incubatorSources: ActivitySource[] = [
  {
    // Bookings needing action on owned items: awaiting approval, awaiting
    // cash collection — plus new online desk reservations since last seen
    // (desk bookings have no nav home of their own; folded here by design).
    navKey: '/dashboard/incubator/bookings',
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
      const seen = ctx.lastSeenOf('/dashboard/incubator/bookings');
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
    navKey: '/dashboard/incubator/domiciliation',
    count: (ctx) =>
      ctx.incubatorId
        ? (ctx.data.domiciliationRequests ?? []).filter(
            (r) => r.incubatorId === ctx.incubatorId && r.status === 'PENDING',
          ).length
        : 0,
  },
  {
    // New CRM clients since last seen.
    navKey: '/dashboard/incubator/clients',
    count: (ctx) => {
      if (!ctx.incubatorId) return 0;
      const seen = ctx.lastSeenOf('/dashboard/incubator/clients');
      return (ctx.data.clients ?? []).filter(
        (c) => c.incubatorId === ctx.incubatorId && c.createdAt > seen,
      ).length;
    },
  },
  {
    // New program registrations since last seen (registrations have no nav
    // item of their own; attached to Programs by design).
    navKey: '/dashboard/incubator/programs',
    count: (ctx) => {
      if (!ctx.incubatorId) return 0;
      const seen = ctx.lastSeenOf('/dashboard/incubator/programs');
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
    navKey: '/dashboard/incubator/events',
    count: (ctx) => {
      if (!ctx.incubatorId) return 0;
      const seen = ctx.lastSeenOf('/dashboard/incubator/events');
      return (ctx.data.registrations ?? []).filter(
        (r) =>
          r.incubatorId === ctx.incubatorId &&
          r.entityType === 'EVENT' &&
          r.status !== 'CANCELLED' &&
          r.createdAt > seen,
      ).length;
    },
  },
];

/* ─────────────────────────── ENTREPRENEUR ────────────────────────── */
/* "News" for an entrepreneur = one of THEIR records was mutated after it
 * was created (status change by an admin/incubator), or a new wallet event
 * appeared. `updatedAt > createdAt` filters out records the user just
 * created themselves.                                                     */

const entrepreneurSources: ActivitySource[] = [
  {
    navKey: '/dashboard/entrepreneur/bookings',
    count: ({ data, user, lastSeenOf }) => {
      const seen = lastSeenOf('/dashboard/entrepreneur/bookings');
      return (data.bookings ?? []).filter(
        (b) => b.userId === user.id && b.updatedAt > b.createdAt && b.updatedAt > seen,
      ).length;
    },
  },
  {
    navKey: '/dashboard/entrepreneur/consultations',
    count: ({ data, user, lastSeenOf }) => {
      const seen = lastSeenOf('/dashboard/entrepreneur/consultations');
      return (data.mentorBookings ?? []).filter(
        (b) => b.userId === user.id && b.updatedAt > b.createdAt && b.updatedAt > seen,
      ).length;
    },
  },
  {
    // New wallet ledger entries since last seen (transactions are immutable
    // and carry no updatedAt — new rows are the only usable signal).
    navKey: '/dashboard/entrepreneur/wallet',
    count: ({ data, user, lastSeenOf }) => {
      const seen = lastSeenOf('/dashboard/entrepreneur/wallet');
      return (data.transactions ?? []).filter(
        (t) => t.userId === user.id && t.createdAt > seen,
      ).length;
    },
  },
];

/* ─────────────────────────── Registry ────────────────────────────── */

/** Roles without badge sources simply get an empty list (no badges). */
export const activitySourcesByRole: Record<string, ActivitySource[]> = {
  ADMIN: adminSources,
  INCUBATOR: incubatorSources,
  ENTREPRENEUR: entrepreneurSources,
};

/** Nav keys registered for a role — used to validate mark-seen writes. */
export function navKeysForRole(role: string): string[] {
  return (activitySourcesByRole[role] ?? []).map((s) => s.navKey);
}
