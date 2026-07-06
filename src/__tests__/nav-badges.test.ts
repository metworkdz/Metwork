/**
 * Nav activity badges — registry counts per role, last-seen semantics, the
 * single permitted write (markNavSeen key-merge), and graceful degradation.
 *
 * READ-ONLY GUARANTEE under test: getNavBadges never mutates the store and
 * never throws; markNavSeen only touches the caller's navLastSeen map.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db/store';
import { getNavBadges, markNavSeen } from '@/server/notifications/nav-badges';
import { navKeysForRole } from '@/server/notifications/activity-sources';

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

describe('navKeysForRole', () => {
  it('returns registered keys per role and [] for roles without sources', () => {
    expect(navKeysForRole('ADMIN')).toContain('/dashboard/admin/approvals');
    expect(navKeysForRole('INCUBATOR')).toContain('/dashboard/incubator/bookings');
    expect(navKeysForRole('ENTREPRENEUR')).toContain('/dashboard/entrepreneur/wallet');
    expect(navKeysForRole('INVESTOR')).toEqual([]);
    expect(navKeysForRole('BUSINESS')).toEqual([]);
  });
});

describe('getNavBadges — ADMIN', () => {
  beforeEach(async () => {
    await seed((d) => {
      d.users.push(
        user('admin-1', 'ADMIN'),
        // Pending gated-role account → approvals badge
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

  it('counts each admin source with its page predicate', async () => {
    const badges = await getNavBadges('admin-1');
    expect(badges['/dashboard/admin/approvals']).toBe(1);
    expect(badges['/dashboard/admin/incubators']).toBe(1);
    expect(badges['/dashboard/admin/mentors']).toBe(1); // SELF+PENDING only
    expect(badges['/dashboard/admin/mentor-bookings']).toBe(1); // PENDING only
    expect(badges['/dashboard/admin/contacts']).toBe(1); // unhandled only
    expect(badges['/dashboard/admin/investor-contacts']).toBe(1);
    expect(badges['/dashboard/admin/payments']).toBe(2); // both ledgers, PENDING only
    // 3 users seeded, admin never opened /users → all count as new
    expect(badges['/dashboard/admin/users']).toBe(3);
  });

  it('last-seen filters the users feed; statuses are unaffected by it', async () => {
    await seed((d) => {
      d.users.find((u: { id: string }) => u.id === 'admin-1')!.navLastSeen = {
        '/dashboard/admin/users': T1,
      };
      d.users.push(user('late-1', 'ENTREPRENEUR', { createdAt: T2 }));
    });
    const badges = await getNavBadges('admin-1');
    expect(badges['/dashboard/admin/users']).toBe(1); // only the T2 signup
    expect(badges['/dashboard/admin/approvals']).toBe(1); // status-based unchanged
  });

  it('omits zero-count keys', async () => {
    await seed((d) => {
      d.contactSubmissions.forEach((c: { handled?: boolean }) => (c.handled = true));
    });
    const badges = await getNavBadges('admin-1');
    expect(badges).not.toHaveProperty('/dashboard/admin/contacts');
  });
});

describe('getNavBadges — INCUBATOR scoping', () => {
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
        // Mine, online, new → folded into bookings badge
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
    const badges = await getNavBadges('mgr-1');
    expect(badges['/dashboard/incubator/bookings']).toBe(3); // b-1 + b-2 + dk-1
    expect(badges['/dashboard/incubator/domiciliation']).toBe(1); // dom-1 only
    expect(badges['/dashboard/incubator/clients']).toBe(1);
    expect(badges['/dashboard/incubator/programs']).toBe(1); // rg-1
    expect(badges).not.toHaveProperty('/dashboard/incubator/events'); // rg-2 cancelled
  });

  it('returns {} for an INCUBATOR user managing no incubator', async () => {
    await seed((d) => d.users.push(user('mgr-3', 'INCUBATOR')));
    expect(await getNavBadges('mgr-3')).toEqual({});
  });
});

describe('getNavBadges — ENTREPRENEUR', () => {
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
    const badges = await getNavBadges('ent-1');
    expect(badges['/dashboard/entrepreneur/bookings']).toBe(1); // b-chg only
    expect(badges['/dashboard/entrepreneur/consultations']).toBe(1);
    expect(badges['/dashboard/entrepreneur/wallet']).toBe(1); // own txn only
  });

  it('clears since-last-seen sources once the surface was seen', async () => {
    await markNavSeen('ent-1', '/dashboard/entrepreneur/bookings');
    await markNavSeen('ent-1', '/dashboard/entrepreneur/wallet');
    const badges = await getNavBadges('ent-1');
    expect(badges).not.toHaveProperty('/dashboard/entrepreneur/bookings');
    expect(badges).not.toHaveProperty('/dashboard/entrepreneur/wallet');
    expect(badges['/dashboard/entrepreneur/consultations']).toBe(1); // untouched key
  });
});

describe('markNavSeen — the single permitted write', () => {
  it('key-merges into navLastSeen and touches nothing else', async () => {
    await seed((d) => {
      d.users.push(user('u-1', 'ENTREPRENEUR', { navLastSeen: { '/dashboard/entrepreneur/wallet': T0 } }));
    });
    await markNavSeen('u-1', '/dashboard/entrepreneur/bookings');
    const data = await db.read();
    const u = data.users.find((x) => x.id === 'u-1')!;
    // Sibling key preserved (merge, not replace)
    expect(u.navLastSeen?.['/dashboard/entrepreneur/wallet']).toBe(T0);
    expect(u.navLastSeen?.['/dashboard/entrepreneur/bookings']).toBeTruthy();
    // No other field mutated
    expect(u.updatedAt).toBe(T0);
    expect(u.status).toBe('ACTIVE');
  });

  it('is a no-op for an unknown user', async () => {
    await expect(markNavSeen('ghost', '/dashboard/admin/users')).resolves.toBeUndefined();
  });
});

describe('graceful degradation', () => {
  it('returns {} for unknown users and roles without sources', async () => {
    await seed((d) => d.users.push(user('biz-1', 'BUSINESS')));
    expect(await getNavBadges('nobody')).toEqual({});
    expect(await getNavBadges('biz-1')).toEqual({});
  });

  it('returns {} when the store read fails (never throws)', async () => {
    const spy = vi.spyOn(db, 'read').mockRejectedValueOnce(new Error('boom'));
    await expect(getNavBadges('admin-1')).resolves.toEqual({});
    spy.mockRestore();
  });
});
