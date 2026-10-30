import { describe, it, expect } from 'vitest';
import { db, type MentorBookingRecord, type UserRecord } from '@/server/db/store';
import { buildAdminAnalytics } from '@/server/analytics/admin-analytics';

const now = () => new Date().toISOString();
const booking = (id: string, over: Partial<MentorBookingRecord> = {}) =>
  ({
    id, mentorId: 'm1', userId: 'u1', userName: 'C', userEmail: 'c@x.dz', userPhone: '', message: '', status: 'READY',
    adminNote: null, chargeType: 'PAID', amountCharged: 6_400, paymentStatus: 'PAID', createdAt: now(), updatedAt: now(), ...over,
  }) as unknown as MentorBookingRecord;

describe('admin analytics builder', () => {
  it('reads the store directly and counts instant-book paid consultations, not refunded ones', async () => {
    await db.update((d) => {
      d.users.push({ id: 'u1', role: 'ENTREPRENEUR', email: 'c@x.dz', fullName: 'C', status: 'ACTIVE' } as unknown as UserRecord);
      d.mentorBookings = [booking('b1'), booking('b2'), booking('b3', { refundTransactionId: 'tx' }), booking('b4', { paymentStatus: 'PENDING' as never })];
      d.refundRequests = [{ id: 'r', sourceKind: 'MENTOR_BOOKING', sourceId: 'b2', status: 'REFUNDED' } as never];
    });
    const a = await buildAdminAnalytics();
    expect(a.demographics.totalUsers).toBe(1);
    expect(a.consultations.paid).toEqual({ count: 1, revenue: 6_400 });
  });
});
