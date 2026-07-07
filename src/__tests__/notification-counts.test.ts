/**
 * Notification counts engine — per-role registry counts, view/pending
 * semantics, the single permitted write (markSeen key-merge), and graceful
 * degradation.
 *
 * READ-ONLY GUARANTEE under test: getNotificationCounts never mutates the
 * store and never throws; markSeen only touches the caller's
 * notificationsSeen map.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db/store';
import { getNotificationCounts, markSeen } from '@/server/notifications/counts';
import {
  NOTIFICATION_SOURCES,
  sourcesForRole,
  sourceKeysForRole,
} from '@/server/notifications/activity-sources';

const T0 = '2026-07-01T10:00:00.000Z';
const T1 = '2026-07-02T10:00:00.000Z';
const T2 = '2026-07-03T10:00:00.000Z';

function user(id: string, role: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    email: `${id}@x.com`,
    passwordHash: 'h',
    fullName: id,
    phone: '0555',
    city: 'Algiers',
    role,
    status: 'ACTIVE',
    phoneVerified: true,
    emailVerified: true,
    membershipCode: null,
    avatarUrl: null,
    locale: 'fr',
    createdAt: T0,
    updatedAt: T0,
    ...extra,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function seed(mutate: (d: any) => void) {
  await db.update((d) => mutate(d as any));
}

describe('registry shape', () => {
  it('exposes role-scoped sources with stable keys and modes', () => {
    expect(sourceKeysForRole('ADMIN')).toEqual([
      'approvals',
      'incubators',
      'consultants',
      'consultations',
      'bookings',
      'users',
      'contacts',
      'investor-contacts',
      'withdrawals',
    ]);
    expect(sourceKeysForRole('INCUBATOR')).toEqual([
      'bookings',
      'domiciliation',
      'clients',
      'programs',
      'events',
    ]);
    expect(sourceKeysForRole('ENTREPRENEUR')).toEqual(['bookings', 'consultations', 'wallet']);
    expect(sourceKeysForRole('INVESTOR')).toEqual([]);
    expect(sourceKeysForRole('BUSINESS')).toEqual([]);
  });

  it('keys are unique within each role and every source has a valid mode + href', () => {
    for (const role of ['ADMIN', 'INCUBATOR', 'ENTREPRENEUR']) {
      const keys = sourceKeysForRole(role);
      expect(new Set(keys).size).toBe(keys.length);
    }
    for (const s of NOTIFICATION_SOURCES) {
      expect(['view', 'pending']).toContain(s.mode);
      expect(s.href.startsWith('/dashboard/')).toBe(true);
      expect(s.roles.length).toBeGreaterThan(0);
    }
  });
});

describe('getNotificationCounts — ADMIN', () => {
  beforeEach(async () => {
    await seed((d) => {
      d.users.push(
        user('admin-1', 'ADMIN'),
        // Pending gated-role account → approvals count
        user('inv-1', 'INVESTOR', { approvalStatus: 'PENDING' }),
        // Approved gated account → not counted
        user('inc-mgr', 'INCUBATOR', { approvalStatus: 'APPROVED' }),
      );
      d.incubators.push({ id: 'inc-1', name: 'Inc', status: 'PENDING', createdAt: T0 });
      d.mentors.push(
        { id: 'm-self', fullName: 'Self', position: 'x', imageUrl: '', bio: null, linkedinUrl: null, source: 'SELF', approvalStatus: 'PENDING', createdAt: T0 },
        { id: 'm-admin', fullName: 'Legacy', position: 'x', imageUrl: '', bio: null, linkedinUrl: null, createdAt: T0 },
      );
      d.mentorBookings.push(
        { id: 'mb-1', mentorId: 'm-admin', userId: null, userName: 'u', userEmail: 'u@x.com', userPhone: '0', message: '', status: 'PENDING', adminNote: null, createdAt: T0, updatedAt: T0 },
        { id: 'mb-2', mentorId: 'm-admin', userId: null, userName: 'u', userEmail: 'u@x.com', userPhone: '0', message: '', status: 'CONFIRMED', adminNote: null, createdAt: T0, updatedAt: T0 },
      );
      d.contactSubmissions.push(
        { id: 'c-1', name: 'a', email: 'a@x.com', message: 'hi', createdAt: T0 },
        { id: 'c-2', name: 'b', email: 'b@x.com', message: 'yo', handled: true, createdAt: T0 },
      );
      d.investorContacts.push(
        { id: 'ic-1', investorId: 'inv-1', investorName: 'I', investorEmail: 'i@x.com', startupId: 's', startupName: 'S', founderName: 'F', message: '', status: 'PENDING', adminNote: null, createdAt: T0, updatedAt: T0 },
      );
      d.withdrawalRequests.push(
        { id: 'w-1', userId: 'inc-mgr', amount: 100, accountDetails: 'x', status: 'PENDING', holdTransactionId: 'tx', createdAt: T0, updatedAt: T0 },
      );
      d.mentorWithdrawals.push(
        { id: 'mw-1', mentorId: 'm-admin', amount: 100, accountDetails: 'x', status: 'PENDING', holdTxnId: 'tx', createdAt: T0, updatedAt: T0 },
        { id: 'mw-2', mentorId: 'm-admin', amount: 100, accountDetails: 'x', status: 'APPROVED', holdTxnId: 'tx', createdAt: T0, updatedAt: T0 },
      );
    });
  });

  it('counts each admin source with its page predicate (zeros included)', async () => {
    const counts = await getNotificationCounts('admin-1');
    expect(counts).toEqual({
      approvals: 1,
      incubators: 1,
      consultants: 1, // SELF+PENDING only
      consultations: 1, // PENDING only
      bookings: 0, // present even at zero
      users: 3, // never seen → all signups count
      contacts: 1, // unhandled only
      'investor-contacts': 1,
      withdrawals: 2, // both ledgers, PENDING only
    });
  });

  it("'view' respects the seen stamp; 'pending' ignores it", async () => {
    await seed((d) => {
      d.users.find((u: { id: string }) => u.id === 'admin-1')!.notificationsSeen = {
        users: T1,
      };
      d.users.push(user('late-1', 'ENTREPRENEUR', { createdAt: T2 }));
    });
    const counts = await getNotificationCounts('admin-1');
    expect(counts.users).toBe(1); // only the T2 signup
    expect(counts.approvals).toBe(1); // pending-mode unchanged
  });
});

describe('getNotificationCounts — INCUBATOR scoping', () => {
  beforeEach(async () => {
    await seed((d) => {
      d.users.push(user('mgr-1', 'INCUBATOR'), user('mgr-2', 'INCUBATOR'));
      d.incubators.push(
        { id: 'inc-1', name: 'Mine', status: 'ACTIVE', managerId: 'mgr-1', createdAt: T0 },
        { id: 'inc-2', name: 'Other', status: 'ACTIVE', managerId: 'mgr-2', createdAt: T0 },
      );
      d.spaces.push(
        { id: 'sp-1', incubatorId: 'inc-1', name: 'Desk', createdAt: T0 },
        { id: 'sp-2', incubatorId: 'inc-2', name: 'Other desk', createdAt: T0 },
      );
      d.bookings.push(
        // Mine, pending → counts
        { id: 'b-1', userId: null, itemKind: 'SPACE', itemId: 'sp-1', itemName: 'Desk', vendorName: 'Mine', city: 'Algiers', unit: 'DAY', quantity: 1, startsAt: T1, endsAt: T1, totalAmount: 100, status: 'PENDING', clientReference: 'r1', transactionId: null, createdAt: T0, updatedAt: T0 },
        // Mine, awaiting cash → counts
        { id: 'b-2', userId: null, itemKind: 'SPACE', itemId: 'sp-1', itemName: 'Desk', vendorName: 'Mine', city: 'Algiers', unit: 'DAY', quantity: 1, startsAt: T1, endsAt: T1, totalAmount: 100, status: 'CONFIRMED', paymentStatus: 'AWAITING_CASH', clientReference: 'r2', transactionId: null, createdAt: T0, updatedAt: T0 },
        // OTHER incubator's pending → excluded
        { id: 'b-3', userId: null, itemKind: 'SPACE', itemId: 'sp-2', itemName: 'Other', vendorName: 'Other', city: 'Algiers', unit: 'DAY', quantity: 1, startsAt: T1, endsAt: T1, totalAmount: 100, status: 'PENDING', clientReference: 'r3', transactionId: null, createdAt: T0, updatedAt: T0 },
      );
      d.deskBookings.push(
        // Mine, online, new → folded into the bookings count
        { id: 'dk-1', spaceId: 'sp-1', incubatorId: 'inc-1', deskName: 'D1', date: '2026-07-05', userId: 'u-1', clientName: null, clientPhone: null, status: 'CONFIRMED', source: 'online', bookingId: null, expiryReminderSentAt: null, createdAt: T1 },
        // Mine but offline (manual) → not "news"
        { id: 'dk-2', spaceId: 'sp-1', incubatorId: 'inc-1', deskName: 'D2', date: '2026-07-05', userId: null, clientName: 'walk-in', clientPhone: null, status: 'CONFIRMED', source: 'offline', bookingId: null, expiryReminderSentAt: null, createdAt: T1 },
      );
      d.domiciliationRequests.push(
        { id: 'dom-1', spaceId: 'sp-1', incubatorId: 'inc-1', userId: null, fullName: 'x', companyName: null, phone: '0', email: 'x@x.com', message: null, status: 'PENDING', createdAt: T0 },
        { id: 'dom-2', spaceId: 'sp-2', incubatorId: 'inc-2', userId: null, fullName: 'y', companyName: null, phone: '0', email: 'y@x.com', message: null, status: 'PENDING', createdAt: T0 },
      );
      d.clients.push(
        { id: 'cl-1', incubatorId: 'inc-1', fullName: 'C', email: 'c@x.com', phone: '0', idCardNumber: null, companyName: null, notes: null, createdAt: T1, updatedAt: T1 },
      );
      d.registrations.push(
        { id: 'rg-1', entityType: 'PROGRAM', entityId: 'p-1', incubatorId: 'inc-1', userId: null, fullName: 'R', email: 'r@x.com', phone: '0', answers: [], status: 'CONFIRMED', clientId: null, createdAt: T1, updatedAt: T1 },
        { id: 'rg-2', entityType: 'EVENT', entityId: 'e-1', incubatorId: 'inc-1', userId: null, fullName: 'R2', email: 'r2@x.com', phone: '0', answers: [], status: 'CANCELLED', clientId: null, createdAt: T1, updatedAt: T1 },
      );
    });
  });

  it('scopes every count to the managed incubator', async () => {
    const counts = await getNotificationCounts('mgr-1');
    expect(counts).toEqual({
      bookings: 3, // b-1 + b-2 + dk-1
      domiciliation: 1, // dom-1 only
      clients: 1,
      programs: 1, // rg-1
      events: 0, // rg-2 cancelled
    });
  });

  it('returns all-zero counts for an INCUBATOR user managing no incubator', async () => {
    await seed((d) => d.users.push(user('mgr-3', 'INCUBATOR')));
    expect(await getNotificationCounts('mgr-3')).toEqual({
      bookings: 0,
      domiciliation: 0,
      clients: 0,
      programs: 0,
      events: 0,
    });
  });
});

describe('getNotificationCounts — ENTREPRENEUR', () => {
  beforeEach(async () => {
    await seed((d) => {
      d.users.push(user('ent-1', 'ENTREPRENEUR'));
      d.bookings.push(
        // Created and never touched → NOT news (user made it themselves)
        { id: 'b-own', userId: 'ent-1', itemKind: 'SPACE', itemId: 's', itemName: 'x', vendorName: 'v', city: 'c', unit: 'DAY', quantity: 1, startsAt: T1, endsAt: T1, totalAmount: 1, status: 'PENDING', clientReference: 'r', transactionId: null, createdAt: T1, updatedAt: T1 },
        // Mutated after creation (status change) → news
        { id: 'b-chg', userId: 'ent-1', itemKind: 'SPACE', itemId: 's', itemName: 'x', vendorName: 'v', city: 'c', unit: 'DAY', quantity: 1, startsAt: T1, endsAt: T1, totalAmount: 1, status: 'CONFIRMED', clientReference: 'r2', transactionId: null, createdAt: T0, updatedAt: T1 },
        // Someone else's → excluded
        { id: 'b-other', userId: 'zzz', itemKind: 'SPACE', itemId: 's', itemName: 'x', vendorName: 'v', city: 'c', unit: 'DAY', quantity: 1, startsAt: T1, endsAt: T1, totalAmount: 1, status: 'CONFIRMED', clientReference: 'r3', transactionId: null, createdAt: T0, updatedAt: T1 },
      );
      d.mentorBookings.push(
        { id: 'mb-chg', mentorId: 'm', userId: 'ent-1', userName: 'e', userEmail: 'e@x.com', userPhone: '0', message: '', status: 'APPROVED', adminNote: null, createdAt: T0, updatedAt: T1 },
      );
      d.transactions.push(
        { id: 'tx-1', userId: 'ent-1', type: 'CREDIT', amount: 100, status: 'COMPLETED', createdAt: T1 },
        { id: 'tx-2', userId: 'zzz', type: 'CREDIT', amount: 100, status: 'COMPLETED', createdAt: T1 },
      );
    });
  });

  it('counts status changes and new wallet entries only', async () => {
    const counts = await getNotificationCounts('ent-1');
    expect(counts).toEqual({ bookings: 1, consultations: 1, wallet: 1 });
  });

  it("markSeen zeroes a 'view' source on the next fetch (DoD flow)", async () => {
    await markSeen('ent-1', 'bookings');
    await markSeen('ent-1', 'wallet');
    const counts = await getNotificationCounts('ent-1');
    expect(counts).toEqual({ bookings: 0, consultations: 1, wallet: 0 });
  });
});

describe('markSeen — the single permitted write', () => {
  it('key-merges into notificationsSeen, returns the stamp, touches nothing else', async () => {
    await seed((d) => {
      d.users.push(user('u-1', 'ENTREPRENEUR', { notificationsSeen: { wallet: T0 } }));
    });
    const seenAt = await markSeen('u-1', 'bookings');
    expect(seenAt).toBeTruthy();
    const data = await db.read();
    const u = data.users.find((x) => x.id === 'u-1')!;
    // Sibling key preserved (merge, not replace)
    expect(u.notificationsSeen?.wallet).toBe(T0);
    expect(u.notificationsSeen?.bookings).toBe(seenAt);
    // No other field mutated
    expect(u.updatedAt).toBe(T0);
    expect(u.status).toBe('ACTIVE');
  });

  it('returns null for an unknown user (no write applied)', async () => {
    expect(await markSeen('ghost', 'users')).toBeNull();
  });
});

describe('graceful degradation', () => {
  it('returns {} for unknown users and roles without sources', async () => {
    await seed((d) => d.users.push(user('biz-1', 'BUSINESS')));
    expect(await getNotificationCounts('nobody')).toEqual({});
    expect(await getNotificationCounts('biz-1')).toEqual({});
  });

  it('a failing source contributes 0 without failing the response', async () => {
    await seed((d) => {
      d.users.push(user('ent-2', 'ENTREPRENEUR'));
      // Poison one collection (non-array, non-null so the `?? []` guard
      // doesn't save it) so only that source's count throws.
      d.transactions = 42;
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const counts = await getNotificationCounts('ent-2');
    expect(counts.wallet).toBe(0);
    expect(counts).toHaveProperty('bookings');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('returns {} when the store read fails (never throws)', async () => {
    const readSpy = vi.spyOn(db, 'read').mockRejectedValueOnce(new Error('boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(getNotificationCounts('admin-1')).resolves.toEqual({});
    readSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe('sourcesForRole', () => {
  it('never leaks another role’s source despite shared keys', () => {
    const adminBookings = sourcesForRole('ADMIN').find((s) => s.key === 'bookings')!;
    const incBookings = sourcesForRole('INCUBATOR').find((s) => s.key === 'bookings')!;
    expect(adminBookings.href).toBe('/dashboard/admin/bookings');
    expect(incBookings.href).toBe('/dashboard/incubator/bookings');
    expect(adminBookings).not.toBe(incBookings);
  });
});
